import type { AxolotlQAReport } from "@shared/ExtensionMessage";
import { CheckCheckIcon, ClipboardCopyIcon, WrenchIcon } from "lucide-react";
import { useCallback, useState } from "react";

const COPIED_TIMEOUT_MS = 1800;

interface QAReportFixActionsProps {
	report: AxolotlQAReport;
	sendMessage: (text: string, images: string[], files: string[]) => void;
}

/**
 * Two action buttons rendered at the bottom of the QA report card when there
 * are failed test cases:
 * - "Fix in Axolotl" — sends a structured fix request back to the LLM,
 *   continuing the same task into Phase 8 (Fix Issues).
 * - "Copy fix prompt" — writes a complete, self-contained Markdown prompt to
 *   the clipboard so the user can paste it into another coding agent
 *   (Claude Code, Cursor, etc.).
 *
 * Hidden when there are no failures (nothing to fix).
 */
export function QAReportFixActions({
	report,
	sendMessage,
}: QAReportFixActionsProps) {
	const [copied, setCopied] = useState(false);

	const failedTests = report.tests.filter((t) => t.status === "failed");

	const handleFixHere = useCallback(() => {
		sendMessage(buildInAxolotlFixPrompt(report), [], []);
	}, [report, sendMessage]);

	const handleCopyPrompt = useCallback(() => {
		const prompt = buildExternalFixPrompt(report);
		navigator.clipboard
			.writeText(prompt)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS);
			})
			.catch((err) => console.error("[QA Fix] clipboard failed:", err));
	}, [report]);

	if (failedTests.length === 0) {
		return null;
	}

	return (
		<div className="mt-3 pt-3 border-t border-editor-group-border flex flex-wrap gap-2">
			<button
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-sm bg-button-background text-button-foreground hover:bg-button-hoverBackground cursor-pointer border-0"
				onClick={handleFixHere}
				type="button"
			>
				<WrenchIcon className="size-3" />
				Fix in Axolotl
			</button>
			<button
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-sm bg-button-secondaryBackground text-button-secondaryForeground hover:bg-button-secondaryHoverBackground cursor-pointer border-0"
				onClick={handleCopyPrompt}
				type="button"
			>
				{copied ? (
					<>
						<CheckCheckIcon className="size-3" />
						Copied
					</>
				) : (
					<>
						<ClipboardCopyIcon className="size-3" />
						Copy fix prompt
					</>
				)}
			</button>
			<span className="text-xs opacity-60 self-center ml-1">
				{failedTests.length} failed test
				{failedTests.length === 1 ? "" : "s"}
			</span>
		</div>
	);
}

/**
 * Short instruction sent back to the LLM as a user message. The LLM already
 * has the QA report in its conversation context, so we don't restate it here —
 * we just give explicit fix instructions matching the existing Phase 8 guidance.
 */
function buildInAxolotlFixPrompt(report: AxolotlQAReport): string {
	const failed = report.tests.filter((t) => t.status === "failed");
	const ids = failed.map((t) => t.id).join(", ");
	return `Please proceed to Phase 8 and fix the following failed test cases from the QA report above: ${ids}.

For each failure:
1. Identify the root cause in the source code (do NOT modify the test cases themselves)
2. Apply the minimum change that makes the behaviour correct
3. After fixing all of them, re-run the project's lint/typecheck/test scripts (or call axolotl_run_local_ci again if available) to verify the fixes hold
4. Summarize what you changed and which tests should now pass

If a failure is environmental (missing dependency, port conflict, etc.) rather than a real code bug, say so explicitly instead of patching code.`;
}

/**
 * Self-contained Markdown prompt for an external coding agent.
 *
 * Includes:
 * - Verdict + summary counts
 * - Every failed test (id, name, category, failure_reason, evidence notes/logs)
 * - Risks and recommendations from the report
 * - Pointers to the on-disk QA artifacts (report JSON + test plan markdown)
 * - Explicit fix instructions
 */
function buildExternalFixPrompt(report: AxolotlQAReport): string {
	const failed = report.tests.filter((t) => t.status === "failed");
	const lines: string[] = [];

	lines.push("# Fix request — Axolotl QA found failures");
	lines.push("");
	lines.push(
		`Axolotl ran an automated QA pass on this codebase. **Verdict: ${report.summary.verdict.replace(/_/g, " ")}**.`,
	);
	lines.push(
		`Results: ✅ ${report.summary.passed} passed · ❌ ${report.summary.failed} failed · ⏭️ ${report.summary.skipped} skipped (total ${report.summary.total_tests}).`,
	);
	lines.push("");

	lines.push("## Failed test cases");
	lines.push("");
	for (const t of failed) {
		lines.push(`### ${t.id} — ${t.name}`);
		lines.push(`- **Category:** ${t.category}`);
		if (t.failure_reason) {
			lines.push(`- **Failure reason:** ${t.failure_reason}`);
		}
		if (t.evidence?.notes) {
			lines.push(`- **Notes:** ${t.evidence.notes}`);
		}
		if (t.evidence?.logs && t.evidence.logs.length > 0) {
			lines.push("- **Captured logs:**");
			lines.push("  ```");
			for (const log of t.evidence.logs.slice(0, 20)) {
				lines.push(`  ${log}`);
			}
			if (t.evidence.logs.length > 20) {
				lines.push(`  …and ${t.evidence.logs.length - 20} more lines`);
			}
			lines.push("  ```");
		}
		if (t.evidence?.screenshots && t.evidence.screenshots.length > 0) {
			lines.push(
				`- **Screenshots:** ${t.evidence.screenshots.length} captured (see Axolotl session)`,
			);
		}
		lines.push("");
	}

	if (report.risks.length > 0) {
		lines.push("## Risks identified by QA");
		lines.push("");
		for (const r of report.risks) {
			lines.push(`- ${r}`);
		}
		lines.push("");
	}

	if (report.recommendations.length > 0) {
		lines.push("## QA recommendations");
		lines.push("");
		for (const r of report.recommendations) {
			lines.push(`- ${r}`);
		}
		lines.push("");
	}

	lines.push("## On-disk artifacts (in the project root)");
	lines.push("");
	lines.push(
		"- `axolotl-qa-report.json` — full machine-readable report (this prompt only includes failures)",
	);
	lines.push(
		"- `axolotl_test_plan_*.md` — the original test plan (look at the most recent timestamped file)",
	);
	lines.push(
		"- `axolotl.md` — Axolotl's persistent project memory (install/run/test commands)",
	);
	lines.push("");

	lines.push("## Your task");
	lines.push("");
	lines.push(
		"For each failed test case above, identify the root cause in the source code and apply the minimum fix that makes the behaviour correct. Do **not** modify the test cases themselves.",
	);
	lines.push("");
	lines.push("Workflow:");
	lines.push(
		"1. Read the relevant source files (use the artifact paths above as starting points).",
	);
	lines.push("2. For each failure, fix the underlying bug — not the symptom.");
	lines.push(
		"3. After all fixes, run the project's lint/typecheck/test scripts to verify.",
	);
	lines.push(
		"4. If a failure is environmental (missing dep, port conflict, flaky network) rather than a real code bug, flag it explicitly instead of patching code.",
	);
	lines.push("");
	lines.push("Report which tests should now pass after your fixes.");

	return lines.join("\n");
}
