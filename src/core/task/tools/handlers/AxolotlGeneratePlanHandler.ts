import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import path from "path"
import type { ClineSayAxolotlGeneratePlan, AxolotlTestCase, AxolotlTestPlan } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * Helper to create a stringified ClineSayAxolotlGeneratePlan message
 */
function createPlanMessage(
	status: ClineSayAxolotlGeneratePlan["status"],
	plan?: AxolotlTestPlan,
	planFilePath?: string,
	error?: string,
): string {
	const message: ClineSayAxolotlGeneratePlan = { status }
	if (plan) {
		message.plan = plan
	}
	if (planFilePath) {
		message.planFilePath = planFilePath
	}
	if (error) {
		message.error = error
	}
	return JSON.stringify(message)
}

export class AxolotlGeneratePlanHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.AXOLOTL_GENERATE_PLAN

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async handlePartialBlock(_block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Show loading message for partial blocks
		const messageText = createPlanMessage("generating")
		await uiHelpers.say("axolotl_generate_plan", messageText, undefined, undefined, true)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const changedFilesRaw: string | undefined = block.params.changed_files
		const prdDescription: string | undefined = block.params.prd_description
		const codeAnalysis: string | undefined = block.params.code_analysis
		const diffContent: string | undefined = block.params.diff_content
		const testCasesJson: string | undefined = block.params.test_cases

		// Validate required parameters
		if (!changedFilesRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "changed_files")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse changed files
		let changedFiles: string[]
		try {
			changedFiles = JSON.parse(changedFilesRaw)
			if (!Array.isArray(changedFiles)) {
				throw new Error("changed_files must be a JSON array")
			}
		} catch {
			// Try splitting by comma or newline if not valid JSON
			changedFiles = changedFilesRaw
				.split(/[,\n]/)
				.map((f) => f.trim())
				.filter((f) => f)
		}

		// If no test_cases provided, return instructions for the AI to generate them
		if (!testCasesJson) {
			return formatResponse.toolResult(
				`🔍 **Axolotl QA: Test Case Generation Required**

Before generating the test plan, you need to analyze the code and create test cases.

**Changed Files:**
${changedFiles.map((f) => `- ${f}`).join("\n")}

${prdDescription ? `**PRD/Requirements:**\n${prdDescription}\n` : ""}
${codeAnalysis ? `**Code Analysis:**\n${codeAnalysis}\n` : ""}
${diffContent ? `**Diff Summary:**\n${diffContent.substring(0, 1000)}${diffContent.length > 1000 ? "..." : ""}\n` : ""}

**Instructions:**
1. Read the changed files to understand the code structure and functionality
2. Analyze what the code does and identify testable scenarios
3. Generate comprehensive test cases covering:
   - **Functional tests**: Core functionality, happy paths
   - **Edge cases**: Boundary conditions, unusual inputs
   - **Error handling**: Invalid inputs, error states, network failures
   - **UI/UX tests**: Visual rendering, user interactions, loading states

4. Call axolotl_generate_plan again with the test_cases parameter containing a JSON array:

\`\`\`json
{
  "test_cases": [
    {
      "id": "TC001",
      "name": "Login with valid credentials",
      "category": "functional",
      "description": "Verify user can login with correct email and password",
      "steps": ["Navigate to /login", "Enter valid email", "Enter valid password", "Click Login"],
      "expectedResult": "User is redirected to dashboard with welcome message",
      "priority": "high"
    },
    {
      "id": "TC002",
      "name": "Login with invalid password",
      "category": "error_handling",
      "description": "Verify error message when password is incorrect",
      "steps": ["Navigate to /login", "Enter valid email", "Enter wrong password", "Click Login"],
      "expectedResult": "Error message 'Invalid credentials' is displayed",
      "priority": "high"
    }
    // ... more test cases
  ]
}
\`\`\`

**Categories:** functional, edge_case, error_handling, ui_ux
**Priorities:** high, medium, low

Generate at least 5-10 meaningful test cases based on actual code analysis.`,
			)
		}

		// Show loading message
		await config.callbacks.say(
			"axolotl_generate_plan",
			createPlanMessage("generating"),
			undefined,
			undefined,
			true,
		)

		try {
			// Parse AI-generated test cases
			let testCases: AxolotlTestCase[]
			try {
				const parsed = JSON.parse(testCasesJson)
				testCases = Array.isArray(parsed) ? parsed : parsed.test_cases || parsed.testCases || []

				// Validate test case structure - tc is any from JSON parse
				testCases = testCases.map((tc: any, index: number) => ({
					id: tc.id || `TC${String(index + 1).padStart(3, "0")}`,
					name: tc.name || "Unnamed Test",
					category: tc.category || "functional",
					description: tc.description || "",
					steps: Array.isArray(tc.steps) ? tc.steps : [tc.steps || "Perform test"],
					expectedResult: tc.expectedResult || tc.expected_result || "Test passes",
					priority: tc.priority || "medium",
				}))
			} catch {
				return formatResponse.toolError(
					`Failed to parse test_cases JSON. Please provide a valid JSON array of test cases.`,
				)
			}

			if (testCases.length === 0) {
				return formatResponse.toolError(
					`No test cases provided. Please generate test cases based on code analysis.`,
				)
			}

			const testPlan: AxolotlTestPlan = {
				targetFiles: changedFiles,
				prdDescription,
				testCases,
				totalTests: testCases.length,
				summary: `Generated ${testCases.length} test cases for ${changedFiles.length} file(s)`,
			}

			// Generate markdown content for the test plan with mermaid diagram
			const markdownContent = this.generateMarkdown(testPlan)

			// Save to disk
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
			const planFileName = `axolotl_test_plan_${timestamp}.md`
			const planFilePath = path.join(config.cwd, planFileName)

			// Use diffViewProvider to show streaming effect (lines turning green)
			const diffViewProvider = config.services.diffViewProvider

			// Open the file in diff view (creates empty file if doesn't exist)
			await diffViewProvider.open(planFilePath, { displayPath: planFileName })

			// Stream content line by line with visual effect
			const lines = markdownContent.split("\n")
			for (let i = 0; i < lines.length; i++) {
				const partialContent = lines.slice(0, i + 1).join("\n")
				await diffViewProvider.update(partialContent, false)
				// Small delay for visual effect (10ms per line for smooth animation)
				await new Promise((resolve) => setTimeout(resolve, 10))
			}

			// Finalize the content
			await diffViewProvider.update(markdownContent, true)

			// Save the file
			await diffViewProvider.saveChanges()
			await diffViewProvider.reset()

			// Ask user for confirmation
			const confirmMessage = this.buildConfirmationMessage(testPlan, planFilePath)

			const { response, text: userFeedback } = await config.callbacks.ask(
				"axolotl_confirm_plan",
				JSON.stringify({
					message: confirmMessage,
					plan: testPlan,
					planFilePath: planFilePath,
					options: ["Proceed with testing", "Let me edit the plan first", "Cancel"],
				}),
				false,
			)

			// Handle user response
			// 1. Reject button → cancel
			if (response === "noButtonClicked") {
				await config.callbacks.say(
					"axolotl_generate_plan",
					createPlanMessage("cancelled", testPlan, planFilePath),
					undefined,
					undefined,
					false,
				)
				return formatResponse.toolResult("User rejected the Axolotl QA test plan.")
			}

			// 2. User provided text feedback (via message, or typed text + clicked Approve)
			const feedbackText = userFeedback?.trim()
			if (feedbackText) {
				const feedbackLower = feedbackText.toLowerCase()

				// Explicit cancel
				if (feedbackLower.includes("cancel")) {
					await config.callbacks.say(
						"axolotl_generate_plan",
						createPlanMessage("cancelled", testPlan, planFilePath),
						undefined,
						undefined,
						false,
					)
					return formatResponse.toolResult("User cancelled the Axolotl QA test plan generation.")
				}

				// Any other text = user wants to modify the plan
				// Show user feedback in UI
				await config.callbacks.say("user_feedback", feedbackText, undefined, undefined, false)

				await config.callbacks.say(
					"axolotl_generate_plan",
					createPlanMessage("confirmed", testPlan, planFilePath),
					undefined,
					undefined,
					false,
				)

				return formatResponse.toolResult(
					`User provided feedback on the test plan. Please modify the test plan based on their feedback and call axolotl_generate_plan again with updated test_cases.

📝 User Feedback:
${feedbackText}

📋 Current Test Plan (${planFilePath}):
- Total Tests: ${testPlan.totalTests}
- Test Cases: ${testCases.map((tc) => `[${tc.id}] ${tc.name}`).join(", ")}

Instructions:
1. Review the user's feedback carefully
2. Modify, add, or remove test cases as requested
3. Call axolotl_generate_plan again with the updated test_cases parameter
4. The user will review the modified plan again`,
				)
			}

			// 3. Approve with no text → proceed
			await config.callbacks.say(
				"axolotl_generate_plan",
				createPlanMessage("confirmed", testPlan, planFilePath),
				undefined,
				undefined,
				false,
			)

			// Build the response with test plan details for the next phase
			return formatResponse.toolResult(
				`Axolotl QA: Test Plan Generated and Confirmed

📋 Test Plan Summary:
- Total Test Cases: ${testPlan.totalTests}
- Target Files: ${testPlan.targetFiles.length}
- Plan File: ${planFilePath}

📝 Test Cases:
${testCases.map((tc) => `- [${tc.id}] ${tc.name} (${tc.category}, ${tc.priority} priority)`).join("\n")}

${prdDescription ? `\n📄 PRD: ${prdDescription}` : ""}

User has confirmed the test plan. You can now proceed with:
1. Inject logging statements into the code for evidence capture
2. Start the development server
3. Execute browser tests using browser_action
4. Generate the final report using axolotl_qa_report

Remember to:
- Use browser_action for ALL UI testing (not curl)
- Take screenshots at each verification step
- Capture console logs as evidence
- Clean up injected logs after testing`,
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Error in axolotl_generate_plan:", errorMessage)

			await config.callbacks.say(
				"axolotl_generate_plan",
				createPlanMessage("error", undefined, undefined, errorMessage),
				undefined,
				undefined,
				false,
			)

			return formatResponse.toolError(`Failed to generate test plan: ${errorMessage}`)
		}
	}

	private generateMarkdown(plan: AxolotlTestPlan): string {
		const now = new Date().toISOString()

		const testsByCategory = {
			functional: plan.testCases.filter((t) => t.category === "functional"),
			edge_case: plan.testCases.filter((t) => t.category === "edge_case"),
			error_handling: plan.testCases.filter((t) => t.category === "error_handling"),
			ui_ux: plan.testCases.filter((t) => t.category === "ui_ux"),
		}

		const formatTestCase = (tc: AxolotlTestCase) => `
### ${tc.id}: ${tc.name}

**Priority:** ${tc.priority === "high" ? "🔴 High" : tc.priority === "medium" ? "🟠 Medium" : "🟢 Low"}

**Description:** ${tc.description}

**Steps:**
${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

**Expected Result:** ${tc.expectedResult}

---`

		// Generate mermaid flowchart for test flow
		const mermaidDiagram = this.generateMermaidDiagram(plan)

		return `# 🎯 Axolotl QA Test Plan

> **Generated:** ${now}
> **Target Files:** ${plan.targetFiles.join(", ")}
${plan.prdDescription ? `> **PRD:** ${plan.prdDescription}` : ""}

---

## 🗺️ Test Flow

\`\`\`mermaid
${mermaidDiagram}
\`\`\`

---

## 📊 Summary

| Metric | Value |
|--------|-------|
| Total Test Cases | ${plan.totalTests} |
| Functional Tests | ${testsByCategory.functional.length} |
| Edge Cases | ${testsByCategory.edge_case.length} |
| Error Handling | ${testsByCategory.error_handling.length} |
| UI/UX Tests | ${testsByCategory.ui_ux.length} |

---

## 🟢 Functional Tests

${testsByCategory.functional.length > 0 ? testsByCategory.functional.map(formatTestCase).join("\n") : "_No functional tests_"}

## 🟡 Edge Cases

${testsByCategory.edge_case.length > 0 ? testsByCategory.edge_case.map(formatTestCase).join("\n") : "_No edge case tests_"}

## 🔴 Error Handling

${testsByCategory.error_handling.length > 0 ? testsByCategory.error_handling.map(formatTestCase).join("\n") : "_No error handling tests_"}

## 🔵 UI/UX Tests

${testsByCategory.ui_ux.length > 0 ? testsByCategory.ui_ux.map(formatTestCase).join("\n") : "_No UI/UX tests_"}

---

## 📌 Legend

| Symbol | Meaning |
|:------:|:--------|
| 🟢 | Low Priority |
| 🟠 | Medium Priority |
| 🔴 | High Priority |
| ⬜ | Pending |
| ✅ | Passed |
| ❌ | Failed |
| ⏭️ | Skipped |

---

*This test plan was generated by Axolotl QA. You can edit this file to add, remove, or modify test cases before running the tests.*
`
	}

	private generateMermaidDiagram(plan: AxolotlTestPlan): string {
		const lines: string[] = ["flowchart TD"]

		// Start node
		lines.push("    Start([🚀 Start QA]) --> Setup")
		lines.push("    Setup[📋 Setup Environment] --> TestPhase")
		lines.push("")

		// Group tests by category
		const categories = [
			{ key: "functional", label: "Functional Tests", icon: "🟢" },
			{ key: "edge_case", label: "Edge Cases", icon: "🟡" },
			{ key: "error_handling", label: "Error Handling", icon: "🔴" },
			{ key: "ui_ux", label: "UI/UX Tests", icon: "🔵" },
		]

		const hasTests: string[] = []

		for (const cat of categories) {
			const tests = plan.testCases.filter((t) => t.category === cat.key)
			if (tests.length > 0) {
				hasTests.push(cat.key)
			}
		}

		// Create subgraphs for each category with tests
		if (hasTests.length > 0) {
			lines.push("    TestPhase{Test Categories}")
			lines.push("")

			for (let i = 0; i < hasTests.length; i++) {
				const cat = categories.find((c) => c.key === hasTests[i])!
				const tests = plan.testCases.filter((t) => t.category === cat.key)
				const catId = cat.key.replace("_", "")

				lines.push(`    TestPhase --> ${catId}Sub`)
				lines.push(`    subgraph ${catId}Sub["${cat.icon} ${cat.label}"]`)

				for (let j = 0; j < tests.length; j++) {
					const tc = tests[j]
					const nodeId = `${catId}${j}`
					const shortName = tc.name.length > 25 ? tc.name.substring(0, 25) + "..." : tc.name
					lines.push(`        ${nodeId}["${tc.id}: ${shortName}"]`)
				}

				lines.push("    end")
				lines.push(`    ${catId}Sub --> Report`)
				lines.push("")
			}
		} else {
			lines.push("    TestPhase --> Report")
		}

		// End nodes
		lines.push("    Report[📊 Generate Report] --> Verdict")
		lines.push("    Verdict{Verdict}")
		lines.push("    Verdict -->|Pass| Success([✅ MERGEABLE])")
		lines.push("    Verdict -->|Fail| Failure([❌ NOT MERGEABLE])")
		lines.push("    Verdict -->|Risks| Warning([⚠️ MERGEABLE WITH RISKS])")

		return lines.join("\n")
	}

	private buildConfirmationMessage(plan: AxolotlTestPlan, planFilePath: string): string {
		const testSummary = plan.testCases
			.slice(0, 5)
			.map((tc) => `  • [${tc.id}] ${tc.name} (${tc.priority})`)
			.join("\n")

		const moreTests = plan.testCases.length > 5 ? `\n  ... and ${plan.testCases.length - 5} more tests` : ""

		return `📋 **Axolotl QA: Test Plan Generated**

**Total Test Cases:** ${plan.totalTests}
**Target Files:** ${plan.targetFiles.length}

**Test Cases:**
${testSummary}${moreTests}

**Plan saved to:** ${planFilePath}

You can:
1. **Proceed** - Start testing with this plan
2. **Edit** - Open ${planFilePath} and modify the test cases
3. **Cancel** - Abort the QA session

What would you like to do?`
	}
}
