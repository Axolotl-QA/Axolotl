import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import fs from "fs/promises"
import path from "path"
import type { ClineSaySentinelQAReport } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * Helper to create a stringified ClineSaySentinelQAReport message
 */
function createReportMessage(
	status: ClineSaySentinelQAReport["status"],
	report?: ClineSaySentinelQAReport["report"],
	error?: string,
): string {
	const message: ClineSaySentinelQAReport = { status }
	if (report) {
		message.report = report
	}
	if (error) {
		message.error = error
	}
	return JSON.stringify(message)
}

export class SentinelQAReportHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.SENTINEL_QA_REPORT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Show loading message for partial blocks
		const messageText = createReportMessage("generating")
		await uiHelpers.say("sentinel_qa_report", messageText, undefined, undefined, true)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const reportJson: string | undefined = block.params.report_json

		// Validate required parameters
		if (!reportJson) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "report_json")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show loading message (auto-approved, no user prompt needed)
		await config.callbacks.say("sentinel_qa_report", createReportMessage("generating"), undefined, undefined, true)

		try {
			// Parse the JSON report
			const report = JSON.parse(reportJson)

			// Validate required fields
			if (!report.summary) {
				throw new Error("Invalid report structure: missing 'summary' field")
			}
			if (!report.tests || !Array.isArray(report.tests)) {
				throw new Error("Invalid report structure: missing or invalid 'tests' array")
			}
			if (!report.summary.verdict) {
				throw new Error("Invalid report structure: missing 'summary.verdict' field")
			}

			// Validate verdict value
			const validVerdicts = ["MERGEABLE", "NOT_MERGEABLE", "MERGEABLE_WITH_RISKS"]
			if (!validVerdicts.includes(report.summary.verdict)) {
				throw new Error(
					`Invalid verdict '${report.summary.verdict}'. Must be one of: ${validVerdicts.join(", ")}`,
				)
			}

			// Save report to disk (in current working directory)
			const reportPath = path.join(config.cwd, "sentinel-qa-report.json")
			await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8")

			// Display the complete report in UI
			await config.callbacks.say(
				"sentinel_qa_report",
				createReportMessage("complete", report),
				undefined,
				undefined,
				false,
			)

			// Build result summary
			const { summary } = report
			const verdictMap: Record<string, string> = {
				MERGEABLE: "PASS - Safe to merge",
				NOT_MERGEABLE: "FAIL - Do not merge",
				MERGEABLE_WITH_RISKS: "WARNING - Merge with caution",
			}
			const verdictDisplay = verdictMap[summary.verdict as string] || summary.verdict

			return formatResponse.toolResult(
				`Sentinel QA Report Generated

Summary:
- Total Tests: ${summary.total_tests || 0}
- Passed: ${summary.passed || 0}
- Failed: ${summary.failed || 0}
- Skipped: ${summary.skipped || 0}

Verdict: ${verdictDisplay}

Report saved to: ${reportPath}`,
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Error in sentinel_qa_report:", errorMessage)

			await config.callbacks.say(
				"sentinel_qa_report",
				createReportMessage("error", undefined, errorMessage),
				undefined,
				undefined,
				false,
			)

			return formatResponse.toolError(`Failed to generate QA report: ${errorMessage}`)
		}
	}
}
