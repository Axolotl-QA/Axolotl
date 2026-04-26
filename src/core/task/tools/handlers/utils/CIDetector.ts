import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * A single CI command detected from the project.
 */
export interface CICommand {
	check_type: "lint" | "typecheck" | "test";
	command: string;
	source: "package.json" | "custom";
}

/**
 * Maps script names in package.json to canonical check types.
 * Order matters: first match wins per check_type.
 */
const SCRIPT_NAME_PATTERNS: Array<{
	check_type: CICommand["check_type"];
	candidates: string[];
}> = [
	{ check_type: "lint", candidates: ["lint", "lint:check"] },
	{
		check_type: "typecheck",
		candidates: ["typecheck", "type-check", "check-types"],
	},
	{ check_type: "test", candidates: ["test", "test:unit"] },
];

/**
 * Detects CI commands from the project's package.json.
 * Returns an empty array if no package.json or no relevant scripts.
 *
 * Only Node.js / npm projects are supported in v1. Python/Rust/Go support
 * is intentionally deferred — those project types should use the
 * `custom_commands` parameter on the tool.
 */
export async function detectCICommands(cwd: string): Promise<CICommand[]> {
	const pkgPath = path.join(cwd, "package.json");
	let pkgRaw: string;
	try {
		pkgRaw = await fs.readFile(pkgPath, "utf8");
	} catch {
		return [];
	}

	let pkg: { scripts?: Record<string, string> };
	try {
		pkg = JSON.parse(pkgRaw);
	} catch {
		return [];
	}

	const scripts = pkg.scripts ?? {};
	const commands: CICommand[] = [];

	for (const { check_type, candidates } of SCRIPT_NAME_PATTERNS) {
		const matched = candidates.find((name) => name in scripts);
		if (matched) {
			commands.push({
				check_type,
				command: `npm run ${matched}`,
				source: "package.json",
			});
		}
	}

	return commands;
}

/**
 * Filters a list of detected commands to those matching the requested check type.
 * `check_type === "all"` means run everything detected.
 */
export function filterByCheckType(
	commands: CICommand[],
	check_type: "lint" | "typecheck" | "test" | "all",
): CICommand[] {
	if (check_type === "all") {
		return commands;
	}
	return commands.filter((c) => c.check_type === check_type);
}
