import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.AXOLOTL_DETECT_CHANGES

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "axolotl_detect_changes",
	description: `Detect and analyze code changes for Axolotl QA testing. This tool identifies files that have been modified based on the specified source (uncommitted changes, PR, or specific files) and prepares them for testing.

Use this tool as the FIRST step in a Axolotl QA workflow to:
1. Detect which files have changed
2. Get the diff content for analysis
3. Allow the user to confirm the test scope before proceeding

The tool will return a structured summary of changes that can be used to generate a test plan.`,
	parameters: [
		{
			name: "source",
			required: true,
			instruction: `The source of changes to detect. Must be one of:
- "uncommitted": Detect uncommitted changes in the workspace using git diff
- "pr": Detect changes from a Pull Request (requires pr_identifier)
- "files": Use specific files provided by the user`,
			usage: "uncommitted",
		},
		{
			name: "pr_identifier",
			required: false,
			instruction: `Required when source is "pr". The PR number or URL to analyze.
Examples: "123", "#123", "https://github.com/owner/repo/pull/123"`,
			usage: "123",
		},
		{
			name: "file_paths",
			required: false,
			instruction: `Required when source is "files". A JSON array of file paths to test.
Example: ["src/auth/login.ts", "src/components/LoginForm.tsx"]`,
			usage: '["src/auth/login.ts"]',
		},
		{
			name: "prd_description",
			required: false,
			instruction: `Optional PRD or feature description provided by the user. This context helps understand what the changes are supposed to do.`,
			usage: "User login with email and password validation",
		},
	],
}

export const axolotl_detect_changes_variants = [GENERIC]
