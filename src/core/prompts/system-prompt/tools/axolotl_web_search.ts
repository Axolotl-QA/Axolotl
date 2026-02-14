import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.AXOLOTL_WEB_SEARCH

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "axolotl_web_search",
	description: `Search the web for real-time information to help with Axolotl QA testing. This tool uses the You.com API to search for best practices, testing patterns, documentation, and known issues related to the code being tested.

**STRONGLY SUGGESTED**: Use this tool AFTER axolotl_analyze_code and BEFORE axolotl_generate_plan. The code analysis tells you WHAT the code does; this tool tells you HOW it should be tested.

Use this tool to search for:
1. **Testing best practices**: Recommended testing approaches for specific frameworks or patterns found in the code
2. **Known issues**: Known bugs or vulnerabilities related to libraries or APIs used in the code
3. **Documentation**: Official documentation on APIs or libraries used in the changed code
4. **Error patterns**: Common error patterns and how to test for them

Results are printed to the terminal and returned for your analysis to improve test plan quality.`,
	parameters: [
		{
			name: "search_query",
			required: true,
			instruction: `The search query to send to You.com. Be specific and include relevant context.
Examples:
- "best practices for testing React form validation"
- "common security vulnerabilities in JWT authentication"
- "how to test WebSocket connections in Node.js"
- "known issues with React 18 concurrent mode"`,
			usage: "best practices for testing React form validation",
		},
	],
}

export const axolotl_web_search_variants = [GENERIC]
