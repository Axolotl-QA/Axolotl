import { ModelFamily } from "@/shared/prompts";
import { ClineDefaultTool } from "@/shared/tools";
import type { ClineToolSpec } from "../spec";

const id = ClineDefaultTool.AXOLOTL_RUN_LOCAL_CI;

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "axolotl_run_local_ci",
	contextRequirements: (context) =>
		context.axolotlQaEnabled !== false && context.runLocalCiEnabled !== false,
	description: `Run the project's local CI commands (lint, typecheck, test) on the changed files for Axolotl QA testing. This tool executes scripts detected from package.json (and optionally .github/workflows) and returns structured pass/fail results.

Use this tool AFTER axolotl_analyze_code (and optional axolotl_web_search) and BEFORE axolotl_generate_plan. The CI results are fed into the test plan so that test cases can target real failures rather than hypothetical ones.

The tool:
1. **Detects CI commands**: Reads package.json scripts (lint, typecheck/type-check, test); falls back to .github/workflows or noop if none exist
2. **Executes commands**: Runs each command in the project's cwd with a per-command timeout
3. **Filters errors**: Returns only errors that touch the file_paths from Phase 2 (changed files)
4. **Returns structured result**: Suitable for feeding into axolotl_generate_plan as ci_results

If no CI commands are detected, the tool returns a "skipped" status without failing the workflow.`,
	parameters: [
		{
			name: "file_paths",
			required: true,
			instruction: `A JSON array of file paths from axolotl_analyze_code. CI errors are filtered to only those touching these files.
Example: ["src/auth/login.ts", "src/components/LoginForm.tsx"]`,
			usage: '["src/auth/login.ts", "src/components/LoginForm.tsx"]',
		},
		{
			name: "check_type",
			required: false,
			instruction: `The type of checks to run. Must be one of:
- "lint": Run only the lint script
- "typecheck": Run only the typecheck script
- "test": Run only the test script
- "all": Run all detected scripts (default)`,
			usage: "all",
		},
		{
			name: "custom_commands",
			required: false,
			instruction: `Optional JSON array of explicit shell commands to run instead of auto-detection. Use this when the project has unusual CI setup that the detector misses. Each command must be self-contained (no chaining).
Example: ["npx eslint src/", "npx tsc --noEmit"]`,
			usage: '["npm run lint", "npm test"]',
		},
	],
};

export const axolotl_run_local_ci_variants = [GENERIC];
