import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.AXOLOTL_GENERATE_PLAN

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "axolotl_generate_plan",
	description: `Generate a comprehensive test plan for Axolotl QA testing. This is a two-step process:

**Step 1 (without test_cases):** Call this tool with changed_files to get instructions for generating test cases. You should:
1. Read the changed files to understand the code
2. Analyze the functionality and identify testable scenarios
3. Generate comprehensive test cases based on your analysis

**Step 2 (with test_cases):** Call this tool again with your AI-generated test cases as JSON. The tool will:
1. Create a test plan markdown file with mermaid diagram
2. Save it for user review
3. Allow the user to modify before execution

Use this tool AFTER axolotl_detect_changes has confirmed the test scope.`,
	parameters: [
		{
			name: "changed_files",
			required: true,
			instruction: `A JSON array of file paths that were detected for testing. This should come from the axolotl_detect_changes result.
Example: ["src/auth/login.ts", "src/components/LoginForm.tsx"]`,
			usage: '["src/auth/login.ts", "src/components/LoginForm.tsx"]',
		},
		{
			name: "test_cases",
			required: false,
			instruction: `A JSON array of test cases YOU generate after analyzing the code. Each test case must have:
- id: Unique identifier (e.g., "TC001")
- name: Short descriptive name
- category: One of "functional", "edge_case", "error_handling", "ui_ux"
- description: What the test verifies
- steps: Array of test steps
- expectedResult: What should happen if test passes
- priority: "high", "medium", or "low"

Generate 5-10 meaningful test cases based on actual code analysis. Do NOT use generic templates.

Example:
[
  {
    "id": "TC001",
    "name": "Login with valid credentials",
    "category": "functional",
    "description": "Verify user can login with correct email and password",
    "steps": ["Navigate to /login", "Enter 'test@example.com'", "Enter 'password123'", "Click Login button"],
    "expectedResult": "User sees welcome message and is redirected to /dashboard",
    "priority": "high"
  }
]`,
			usage: '[{"id":"TC001","name":"Login success","category":"functional","description":"...","steps":["..."],"expectedResult":"...","priority":"high"}]',
		},
		{
			name: "prd_description",
			required: false,
			instruction: `The PRD or feature description that explains what the code should do. This helps generate more accurate and relevant test cases.`,
			usage: "User login with email and password, showing appropriate error messages on failure",
		},
		{
			name: "code_analysis",
			required: false,
			instruction: `Optional code analysis or context gathered from reading the changed files. Include relevant function signatures, component structures, or business logic that should be tested.`,
			usage: "LoginForm component has email/password fields with validation. handleSubmit calls authService.login()",
		},
		{
			name: "diff_content",
			required: false,
			instruction: `Optional diff content showing the actual changes. This helps understand what specifically changed and needs testing.`,
			usage: "The git diff content from axolotl_detect_changes",
		},
	],
}

export const axolotl_generate_plan_variants = [GENERIC]
