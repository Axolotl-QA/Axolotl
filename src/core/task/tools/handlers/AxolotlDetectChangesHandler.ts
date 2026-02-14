import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import type { ClineSayAxolotlDetectChanges } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

interface DetectedChange {
	file: string
	status: "modified" | "added" | "deleted" | "renamed"
	additions?: number
	deletions?: number
}

interface DetectionResult {
	source: string
	changes: DetectedChange[]
	totalFiles: number
	summary: string
	diff?: string
	prInfo?: {
		title: string
		number: number
		branch: string
	}
}

/**
 * Helper to create a stringified ClineSayAxolotlDetectChanges message
 */
function createDetectionMessage(
	status: ClineSayAxolotlDetectChanges["status"],
	result?: DetectionResult,
	error?: string,
): string {
	const message: ClineSayAxolotlDetectChanges = { status }
	if (result) {
		message.result = result
	}
	if (error) {
		message.error = error
	}
	return JSON.stringify(message)
}

export class AxolotlDetectChangesHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.AXOLOTL_DETECT_CHANGES

	getDescription(block: ToolUse): string {
		const source = block.params.source || "unknown"
		return `[${block.name} source="${source}"]`
	}

	async handlePartialBlock(_block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Show loading message for partial blocks
		const messageText = createDetectionMessage("detecting")
		await uiHelpers.say("axolotl_detect_changes", messageText, undefined, undefined, true)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const source: string | undefined = block.params.source
		const prIdentifier: string | undefined = block.params.pr_identifier
		const filePathsRaw: string | undefined = block.params.file_paths
		const prdDescription: string | undefined = block.params.prd_description

		// Validate required parameters
		if (!source) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "source")
		}

		if (!["uncommitted", "pr", "files"].includes(source)) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Invalid source "${source}". Must be one of: uncommitted, pr, files`,
			)
		}

		if (source === "pr" && !prIdentifier) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "pr_identifier")
		}

		if (source === "files" && !filePathsRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "file_paths")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show loading message
		await config.callbacks.say(
			"axolotl_detect_changes",
			createDetectionMessage("detecting"),
			undefined,
			undefined,
			true,
		)

		try {
			let result: DetectionResult

			switch (source) {
				case "uncommitted":
					result = await this.detectUncommittedChanges(config)
					break
				case "pr":
					result = await this.detectPRChanges(config, prIdentifier!)
					break
				case "files":
					result = await this.detectFileChanges(config, filePathsRaw!)
					break
				default:
					throw new Error(`Unknown source: ${source}`)
			}

			// Add PRD description to result if provided
			if (prdDescription) {
				result.summary += `\n\nPRD/Feature Description: ${prdDescription}`
			}

			// Check if any changes were found
			if (result.changes.length === 0) {
				await config.callbacks.say(
					"axolotl_detect_changes",
					createDetectionMessage("no_changes", result),
					undefined,
					undefined,
					false,
				)

				return formatResponse.toolResult(
					`No changes detected for source "${source}". Please make some changes or specify different files to test.`,
				)
			}

			// Ask user for confirmation before proceeding
			const confirmMessage = this.buildConfirmationMessage(result, prdDescription)

			const { response, text: userFeedback } = await config.callbacks.ask(
				"axolotl_confirm_changes",
				JSON.stringify({
					message: confirmMessage,
					result: result,
					options: ["Proceed with testing", "Cancel"],
				}),
				false,
			)

			// Handle reject button or cancel message
			if (
				response === "noButtonClicked" ||
				(userFeedback?.toLowerCase().includes("cancel"))
			) {
				await config.callbacks.say(
					"axolotl_detect_changes",
					createDetectionMessage("cancelled", result),
					undefined,
					undefined,
					false,
				)
				return formatResponse.toolResult("User cancelled the Axolotl QA test.")
			}

			// User confirmed, show completion message
			await config.callbacks.say(
				"axolotl_detect_changes",
				createDetectionMessage("confirmed", result),
				undefined,
				undefined,
				false,
			)

			// Return the result for the next tool in the workflow
			return formatResponse.toolResult(
				`Axolotl QA: Changes Detected and Confirmed

Source: ${result.source}
Total Files: ${result.totalFiles}

Changed Files:
${result.changes.map((c) => `- ${c.file} (${c.status})`).join("\n")}

${result.summary}

${prdDescription ? `PRD Description: ${prdDescription}` : ""}

${result.diff ? `\nDiff Summary:\n${result.diff.substring(0, 2000)}${result.diff.length > 2000 ? "\n... (truncated)" : ""}` : ""}

User has confirmed. Proceed to generate a test plan using axolotl_generate_plan tool.`,
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Error in axolotl_detect_changes:", errorMessage)

			await config.callbacks.say(
				"axolotl_detect_changes",
				createDetectionMessage("error", undefined, errorMessage),
				undefined,
				undefined,
				false,
			)

			return formatResponse.toolError(`Failed to detect changes: ${errorMessage}`)
		}
	}

	private async detectUncommittedChanges(config: TaskConfig): Promise<DetectionResult> {
		// Execute git commands to get uncommitted changes
		// Note: executeCommandTool returns [userRejected, result] - first value is true if user rejected
		const [statusRejected, statusResult] = await config.callbacks.executeCommandTool(
			"git status --porcelain",
			30,
		)

		if (statusRejected) {
			throw new Error("Failed to get git status. Is this a git repository?")
		}

		// Try to get diff - this may fail in repos with no commits yet (no HEAD)
		// We'll handle this gracefully since git status is the primary source of changes
		const [diffRejected, diffResult] = await config.callbacks.executeCommandTool(
			"git --no-pager diff",
			60,
		)

		const changes: DetectedChange[] = []
		const statusOutput = typeof statusResult === "string" ? statusResult : ""

		// Parse git status output
		const lines = statusOutput.split("\n").filter((line) => line.trim())
		for (const line of lines) {
			const status = line.substring(0, 2).trim()
			const file = line.substring(3).trim()

			if (!file) {
				continue
			}

			let changeStatus: DetectedChange["status"] = "modified"
			if (status.includes("A") || status === "??") {
				changeStatus = "added"
			} else if (status.includes("D")) {
				changeStatus = "deleted"
			} else if (status.includes("R")) {
				changeStatus = "renamed"
			}

			changes.push({ file, status: changeStatus })
		}

		return {
			source: "uncommitted",
			changes,
			totalFiles: changes.length,
			summary: `Found ${changes.length} uncommitted change(s) in the workspace.`,
			diff: !diffRejected && typeof diffResult === "string" ? diffResult : undefined,
		}
	}

	private async detectPRChanges(config: TaskConfig, prIdentifier: string): Promise<DetectionResult> {
		// Extract PR number from identifier
		const prNumber = this.extractPRNumber(prIdentifier)
		if (!prNumber) {
			throw new Error(`Invalid PR identifier: ${prIdentifier}`)
		}

		// Get PR info using gh CLI
		// Note: executeCommandTool returns [userRejected, result] - first value is true if user rejected
		const [prInfoRejected, prInfoResult] = await config.callbacks.executeCommandTool(
			`gh pr view ${prNumber} --json title,headRefName,baseRefName,changedFiles,additions,deletions`,
			60,
		)

		if (prInfoRejected) {
			throw new Error(
				`Failed to get PR info for #${prNumber}. Make sure gh CLI is installed and authenticated.`,
			)
		}

		let prInfo: any
		try {
			prInfo = JSON.parse(typeof prInfoResult === "string" ? prInfoResult : "{}")
		} catch {
			throw new Error("Failed to parse PR info response")
		}

		// Get PR diff
		const [diffRejected, diffResult] = await config.callbacks.executeCommandTool(
			`gh pr diff ${prNumber} | cat`,
			120,
		)

		const changes: DetectedChange[] = (prInfo.changedFiles || []).map((file: string) => ({
			file,
			status: "modified" as const,
		}))

		return {
			source: `PR #${prNumber}`,
			changes,
			totalFiles: changes.length,
			summary: `PR #${prNumber}: "${prInfo.title || "Unknown"}" - ${changes.length} file(s) changed`,
			diff: !diffRejected && typeof diffResult === "string" ? diffResult : undefined,
			prInfo: {
				title: prInfo.title || "",
				number: prNumber,
				branch: prInfo.headRefName || "",
			},
		}
	}

	private async detectFileChanges(_config: TaskConfig, filePathsRaw: string): Promise<DetectionResult> {
		let filePaths: string[]
		try {
			filePaths = JSON.parse(filePathsRaw)
			if (!Array.isArray(filePaths)) {
				throw new Error("file_paths must be a JSON array")
			}
		} catch {
			// Try splitting by comma or newline if not valid JSON
			filePaths = filePathsRaw
				.split(/[,\n]/)
				.map((f) => f.trim())
				.filter((f) => f)
		}

		const changes: DetectedChange[] = filePaths.map((file) => ({
			file: file.replace(/^@/, ""), // Remove @ prefix if present
			status: "modified" as const,
		}))

		return {
			source: "files",
			changes,
			totalFiles: changes.length,
			summary: `Manually selected ${changes.length} file(s) for testing.`,
		}
	}

	private extractPRNumber(identifier: string): number | null {
		// Handle various PR identifier formats
		const cleaned = identifier.trim()

		// Direct number
		if (/^\d+$/.test(cleaned)) {
			return parseInt(cleaned, 10)
		}

		// #123 format
		if (/^#\d+$/.test(cleaned)) {
			return parseInt(cleaned.substring(1), 10)
		}

		// URL format: https://github.com/owner/repo/pull/123
		const urlMatch = /\/pull\/(\d+)/.exec(cleaned)
		if (urlMatch) {
			return parseInt(urlMatch[1], 10)
		}

		return null
	}

	private buildConfirmationMessage(result: DetectionResult, prdDescription?: string): string {
		const fileList = result.changes
			.slice(0, 10)
			.map((c) => `  • ${c.file} (${c.status})`)
			.join("\n")

		const moreFiles =
			result.changes.length > 10 ? `\n  ... and ${result.changes.length - 10} more files` : ""

		return `🔍 **Axolotl QA: Changes Detected**

**Source:** ${result.source}
**Total Files:** ${result.totalFiles}

**Changed Files:**
${fileList}${moreFiles}

${prdDescription ? `**PRD Description:**\n${prdDescription}\n` : ""}
${result.prInfo ? `**PR:** #${result.prInfo.number} - ${result.prInfo.title}\n**Branch:** ${result.prInfo.branch}` : ""}

Do you want to proceed with generating a test plan for these changes?`
	}
}
