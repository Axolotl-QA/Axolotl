import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.AXOLOTL_ANALYZE_CODE

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "axolotl_analyze_code",
	description: `Analyze code structure and search for patterns in the specified files for Axolotl QA testing. This tool combines AST-based code structure analysis with regex pattern search to help understand the code before generating test cases.

Use this tool AFTER axolotl_detect_changes to deeply analyze the changed files before calling axolotl_generate_plan.

The tool provides:
1. **Code Structure Analysis**: Extracts class, function, method, and interface definitions using AST parsing
2. **Pattern Search**: Finds specific code patterns using regex (e.g., error handling, validation, API calls)
3. **Summary**: Provides a concise overview of the analyzed code

Output is automatically truncated to prevent context overflow (max 100KB).`,
	parameters: [
		{
			name: "file_paths",
			required: true,
			instruction: `A JSON array of file paths to analyze. These should be the files detected by axolotl_detect_changes.
Example: ["src/auth/login.ts", "src/components/LoginForm.tsx"]
Maximum 20 files will be analyzed.`,
			usage: '["src/auth/login.ts", "src/components/LoginForm.tsx"]',
		},
		{
			name: "analysis_type",
			required: true,
			instruction: `The type of analysis to perform. Must be one of:
- "structure": Extract code definitions (classes, functions, methods) using AST parsing
- "search": Search for patterns using regex
- "both": Perform both structure analysis and pattern search`,
			usage: "both",
		},
		{
			name: "search_pattern",
			required: false,
			instruction: `Required when analysis_type is "search" or "both". A regex pattern to search for in the code.
Examples:
- "throw|catch|error" - Find error handling
- "validate|validation" - Find validation logic
- "fetch|axios|api" - Find API calls
- "useState|useEffect" - Find React hooks`,
			usage: "throw|catch|error",
		},
		{
			name: "focus_areas",
			required: false,
			instruction: `Optional hints about what aspects of the code to focus on. This helps the AI understand the testing context.
Examples: "error handling, input validation", "authentication flow", "form submission"`,
			usage: "error handling, validation",
		},
	],
}

export const axolotl_analyze_code_variants = [GENERIC]
