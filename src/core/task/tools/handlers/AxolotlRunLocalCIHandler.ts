import { spawn } from "node:child_process";
import * as path from "node:path";
import type { ToolUse } from "@core/assistant-message";
import { formatResponse } from "@core/prompts/responses";
import { ClineDefaultTool } from "@/shared/tools";
import type { ToolResponse } from "../../index";
import type { IToolHandler } from "../ToolExecutorCoordinator";
import type { TaskConfig } from "../types/TaskConfig";
import {
	type CICommand,
	detectCICommands,
	filterByCheckType,
} from "./utils/CIDetector";

const PER_COMMAND_TIMEOUT_MS = 60_000;
const TOTAL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32 * 1024; // per command

interface CommandResult {
	command: string;
	check_type: CICommand["check_type"] | "custom";
	exit_code: number | null;
	duration_ms: number;
	stdout: string;
	stderr: string;
	timed_out: boolean;
	relevant_errors: RelevantError[];
}

interface RelevantError {
	file: string;
	line?: number;
	message: string;
}

interface CIVerificationResult {
	ci_detected: boolean;
	commands_run: string[];
	results: CommandResult[];
	overall_status: "pass" | "fail" | "skipped" | "timeout";
}

export class AxolotlRunLocalCIHandler implements IToolHandler {
	readonly name = ClineDefaultTool.AXOLOTL_RUN_LOCAL_CI;

	getDescription(block: ToolUse): string {
		const checkType = block.params.check_type || "all";
		return `[${block.name} check_type="${checkType}"]`;
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const filePathsRaw: string | undefined = block.params.file_paths;
		const checkTypeParam: string = block.params.check_type || "all";
		const customCommandsRaw: string | undefined = block.params.custom_commands;

		if (!filePathsRaw) {
			config.taskState.consecutiveMistakeCount++;
			return await config.callbacks.sayAndCreateMissingParamError(
				this.name,
				"file_paths",
			);
		}

		if (!["lint", "typecheck", "test", "all"].includes(checkTypeParam)) {
			config.taskState.consecutiveMistakeCount++;
			return formatResponse.toolError(
				`Invalid check_type "${checkTypeParam}". Must be one of: lint, typecheck, test, all`,
			);
		}

		config.taskState.consecutiveMistakeCount = 0;

		const filePaths = parseFilePaths(filePathsRaw);
		const commands = await this.resolveCommands(
			config.cwd,
			checkTypeParam as "lint" | "typecheck" | "test" | "all",
			customCommandsRaw,
		);

		if (commands.length === 0) {
			const result: CIVerificationResult = {
				ci_detected: false,
				commands_run: [],
				results: [],
				overall_status: "skipped",
			};
			const message = formatOutput(result);
			await config.callbacks.say(
				"text",
				formatChatSummary(result),
				undefined,
				undefined,
				false,
			);
			return formatResponse.toolResult(message);
		}

		// Show "running" message before kicking off shell commands so the user sees
		// what is being executed, not just the result.
		await config.callbacks.say(
			"text",
			formatRunningMessage(commands),
			undefined,
			undefined,
			false,
		);

		const results = await runCommandsWithBudget(
			commands,
			config.cwd,
			filePaths,
		);

		const overallStatus = computeOverallStatus(results);
		const ciResult: CIVerificationResult = {
			ci_detected: true,
			commands_run: commands.map((c) => c.command),
			results,
			overall_status: overallStatus,
		};

		// Surface the structured summary to the user — the LLM gets the same
		// content via toolResult below, but the user-visible chat would otherwise
		// only show whatever the LLM decided to narrate.
		await config.callbacks.say(
			"text",
			formatChatSummary(ciResult),
			undefined,
			undefined,
			false,
		);

		return formatResponse.toolResult(formatOutput(ciResult));
	}

	private async resolveCommands(
		cwd: string,
		checkType: "lint" | "typecheck" | "test" | "all",
		customCommandsRaw: string | undefined,
	): Promise<CICommand[]> {
		if (customCommandsRaw) {
			let parsed: string[];
			try {
				parsed = JSON.parse(customCommandsRaw);
			} catch {
				parsed = customCommandsRaw
					.split(/[,\n]/)
					.map((s) => s.trim())
					.filter((s) => s);
			}
			return parsed.map((command) => ({
				check_type: "lint" as const, // Custom commands are not categorized; use lint as a placeholder
				command,
				source: "custom",
			}));
		}
		const detected = await detectCICommands(cwd);
		return filterByCheckType(detected, checkType);
	}
}

function parseFilePaths(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.map(String);
		}
	} catch {
		// fall through
	}
	return raw
		.split(/[,\n]/)
		.map((s) => s.trim())
		.filter((s) => s);
}

async function runCommandsWithBudget(
	commands: CICommand[],
	cwd: string,
	filePaths: string[],
): Promise<CommandResult[]> {
	const results: CommandResult[] = [];
	const start = Date.now();

	for (const cmd of commands) {
		const remaining = TOTAL_TIMEOUT_MS - (Date.now() - start);
		if (remaining <= 0) {
			results.push({
				command: cmd.command,
				check_type: cmd.check_type,
				exit_code: null,
				duration_ms: 0,
				stdout: "",
				stderr: "",
				timed_out: true,
				relevant_errors: [],
			});
			continue;
		}

		const timeout = Math.min(PER_COMMAND_TIMEOUT_MS, remaining);
		const result = await runOne(cmd, cwd, timeout, filePaths);
		results.push(result);
	}

	return results;
}

async function runOne(
	cmd: CICommand,
	cwd: string,
	timeoutMs: number,
	filePaths: string[],
): Promise<CommandResult> {
	const start = Date.now();
	return await new Promise<CommandResult>((resolve) => {
		const child = spawn(cmd.command, {
			cwd,
			shell: true,
			env: { ...process.env, CI: "1" },
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeoutMs);

		child.stdout.on("data", (chunk: Buffer) => {
			if (Buffer.byteLength(stdout, "utf8") < MAX_OUTPUT_BYTES) {
				stdout += chunk.toString("utf8");
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (Buffer.byteLength(stderr, "utf8") < MAX_OUTPUT_BYTES) {
				stderr += chunk.toString("utf8");
			}
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			const combined = `${stdout}\n${stderr}`;
			resolve({
				command: cmd.command,
				check_type: cmd.check_type,
				exit_code: code,
				duration_ms: Date.now() - start,
				stdout: truncate(stdout),
				stderr: truncate(stderr),
				timed_out: timedOut,
				relevant_errors: extractRelevantErrors(combined, filePaths, cwd),
			});
		});

		child.on("error", () => {
			clearTimeout(timer);
			resolve({
				command: cmd.command,
				check_type: cmd.check_type,
				exit_code: null,
				duration_ms: Date.now() - start,
				stdout: truncate(stdout),
				stderr: truncate(stderr),
				timed_out: timedOut,
				relevant_errors: [],
			});
		});
	});
}

function truncate(s: string): string {
	if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
		return s;
	}
	return `${s.slice(0, MAX_OUTPUT_BYTES)}\n[output truncated]`;
}

/**
 * Extract errors from CI output that touch one of the file_paths.
 *
 * Most linters/typecheckers output `<file>:<line>:<col>` or `<file>:<line>`
 * — we match on the file portion and capture the rest of the line as the
 * error message. We normalize file paths to project-relative form so the
 * comparison works whether the tool emits absolute or relative paths.
 */
function extractRelevantErrors(
	combined: string,
	filePaths: string[],
	cwd: string,
): RelevantError[] {
	if (filePaths.length === 0) {
		return [];
	}

	const normalized = new Set(filePaths.map((f) => normalizePath(f, cwd)));
	const errors: RelevantError[] = [];
	const lines = combined.split("\n");
	const seenKeys = new Set<string>();
	const FILE_LINE_RX = /([./\w\-+]+\.[a-z]+):(\d+)(?::(\d+))?/i;

	for (const rawLine of lines) {
		const match = FILE_LINE_RX.exec(rawLine);
		if (!match) {
			continue;
		}
		const fileFromLine = normalizePath(match[1], cwd);
		if (!normalized.has(fileFromLine)) {
			// Also check if any tracked path ends with the matched file
			const matched = [...normalized].some(
				(f) => f === fileFromLine || f.endsWith(`/${fileFromLine}`),
			);
			if (!matched) {
				continue;
			}
		}
		const lineNum = parseInt(match[2], 10);
		const message = rawLine.trim();
		const key = `${fileFromLine}:${lineNum}:${message}`;
		if (seenKeys.has(key)) {
			continue;
		}
		seenKeys.add(key);
		errors.push({
			file: fileFromLine,
			line: lineNum,
			message,
		});
	}

	return errors.slice(0, 50); // cap to keep output bounded
}

function normalizePath(p: string, cwd: string): string {
	if (path.isAbsolute(p)) {
		return path.relative(cwd, p);
	}
	return p.replace(/^\.\//, "");
}

function computeOverallStatus(
	results: CommandResult[],
): CIVerificationResult["overall_status"] {
	if (results.some((r) => r.timed_out)) {
		return "timeout";
	}
	if (results.some((r) => r.exit_code !== 0)) {
		return "fail";
	}
	return "pass";
}

/**
 * Short markdown shown to the user before commands run, so they see what the
 * tool is about to execute. Markdown is rendered in the VS Code chat panel.
 */
function formatRunningMessage(commands: CICommand[]): string {
	const lines: string[] = [];
	lines.push("**🧪 Axolotl Local CI** — running these commands:");
	for (const c of commands) {
		lines.push(`- \`${c.command}\` _(${c.check_type})_`);
	}
	return lines.join("\n");
}

/**
 * Markdown summary shown directly to the user after CI runs. Mirrors the
 * structured data returned to the LLM but formatted for chat readability.
 */
function formatChatSummary(result: CIVerificationResult): string {
	if (!result.ci_detected) {
		return "**🧪 Axolotl Local CI** — ⏭️ Skipped\n\nNo `lint`/`typecheck`/`test` script found in `package.json`. Proceeding to test plan generation.";
	}

	const statusLine: Record<CIVerificationResult["overall_status"], string> = {
		pass: "✅ **All checks passed**",
		fail: "❌ **Failures detected**",
		timeout: "⏱️ **Timed out**",
		skipped: "⏭️ Skipped",
	};

	const lines: string[] = [];
	lines.push(`**🧪 Axolotl Local CI** — ${statusLine[result.overall_status]}`);
	lines.push("");

	for (const r of result.results) {
		const icon = r.timed_out ? "⏱️" : r.exit_code === 0 ? "✅" : "❌";
		lines.push(
			`${icon} \`${r.command}\` — exit ${r.exit_code ?? "n/a"}, ${r.duration_ms}ms`,
		);
		if (r.relevant_errors.length > 0) {
			for (const e of r.relevant_errors.slice(0, 20)) {
				const where = e.line ? `${e.file}:${e.line}` : e.file;
				lines.push(`  - \`${where}\` — ${e.message}`);
			}
			if (r.relevant_errors.length > 20) {
				lines.push(
					`  - _…and ${r.relevant_errors.length - 20} more (full list in tool result)_`,
				);
			}
		} else if (r.exit_code !== 0) {
			const tail = r.stderr.split("\n").slice(-5).join("\n").trim();
			if (tail) {
				lines.push("```");
				lines.push(tail);
				lines.push("```");
			}
		}
	}

	return lines.join("\n");
}

function formatOutput(result: CIVerificationResult): string {
	const lines: string[] = [];
	lines.push("=== AXOLOTL LOCAL CI VERIFICATION ===");
	lines.push("");

	if (!result.ci_detected) {
		lines.push("Status: SKIPPED");
		lines.push(
			"No CI scripts detected (no `lint`/`typecheck`/`test` in package.json).",
		);
		lines.push("Proceed directly to axolotl_generate_plan.");
		lines.push("");
		lines.push("CI_RESULTS_JSON:");
		lines.push(JSON.stringify(result));
		return lines.join("\n");
	}

	const statusLabel: Record<CIVerificationResult["overall_status"], string> = {
		pass: "✅ PASS",
		fail: "❌ FAIL",
		skipped: "⏭️ SKIPPED",
		timeout: "⏱️ TIMEOUT",
	};
	lines.push(`Overall status: ${statusLabel[result.overall_status]}`);
	lines.push("");

	for (const r of result.results) {
		const icon = r.timed_out ? "⏱️" : r.exit_code === 0 ? "✅" : "❌";
		lines.push(
			`${icon} ${r.command}  (exit=${r.exit_code ?? "n/a"}, ${r.duration_ms}ms)`,
		);
		if (r.relevant_errors.length > 0) {
			for (const e of r.relevant_errors) {
				const where = e.line ? `${e.file}:${e.line}` : e.file;
				lines.push(`   - ${where}  ${e.message}`);
			}
		} else if (r.exit_code !== 0) {
			// fall back to last few stderr lines if no structured errors
			const lastStderr = r.stderr.split("\n").slice(-5).join("\n").trim();
			if (lastStderr) {
				lines.push(`   stderr (tail): ${lastStderr}`);
			}
		}
		lines.push("");
	}

	lines.push(
		"Pass these results to axolotl_generate_plan as the ci_results parameter.",
	);
	lines.push("");
	lines.push("CI_RESULTS_JSON:");
	lines.push(JSON.stringify(result));
	return lines.join("\n");
}
