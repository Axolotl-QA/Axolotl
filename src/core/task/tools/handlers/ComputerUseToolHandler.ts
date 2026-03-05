import {
	BROWSER_LAUNCH_ACTIONS,
	isComputerUseAction,
} from "@shared/computer-use";
import type {
	BrowserActionResult,
	ClineSayBrowserAction,
} from "@shared/ExtensionMessage";
import { ClineDefaultTool } from "@/shared/tools";
import type { ToolUse } from "../../../assistant-message";
import { formatResponse } from "../../../prompts/responses";
import type { ToolResponse } from "../..";
import { showNotificationForApproval } from "../../utils";
import type { IFullyManagedTool } from "../ToolExecutorCoordinator";
import type { TaskConfig } from "../types/TaskConfig";
import type { StronglyTypedUIHelpers } from "../types/UIHelpers";
import { ToolResultUtils } from "../utils/ToolResultUtils";

/**
 * Parse and validate the cu_action from a tool block.
 * Returns the action name if valid, or undefined if not yet available / invalid.
 */
function parseValidAction(block: ToolUse): string | undefined {
	const cuAction = block.params.cu_action as string | undefined;
	if (cuAction && isComputerUseAction(cuAction)) {
		return cuAction;
	}
	return undefined;
}

/**
 * Build a ClineSayBrowserAction payload for UI display of non-launch CU actions.
 */
function buildBrowserActionPayload(
	params: Record<string, string>,
): ClineSayBrowserAction {
	return {
		action: "click", // Generic browser action type for UI display
		coordinate: params.x && params.y ? `${params.x},${params.y}` : undefined,
		text: params.text,
	};
}

/**
 * Extract action args from block params, excluding the cu_action key.
 */
function extractActionArgs(
	params: Record<string, string>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(params).filter(([key]) => key !== "cu_action"),
	);
}

/**
 * Derive a display text for the browser launch approval dialog.
 */
function getLaunchDisplayText(
	cuAction: string,
	params: Record<string, string>,
): string {
	switch (cuAction) {
		case "navigate":
			return params.url || "unknown URL";
		case "search":
			return `Google search: ${params.query || "unknown query"}`;
		case "open_web_browser":
			return "about:blank";
		default:
			return cuAction;
	}
}

type LaunchResult =
	| { denied: true }
	| { denied: false; result: BrowserActionResult };

export class ComputerUseToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.COMPUTER_USE;

	getDescription(block: ToolUse): string {
		return `[Computer Use: ${block.params.cu_action}]`;
	}

	async handlePartialBlock(
		block: ToolUse,
		uiHelpers: StronglyTypedUIHelpers,
	): Promise<void> {
		const cuAction = parseValidAction(block);
		if (!cuAction) {
			return; // Wait for more content
		}

		if (BROWSER_LAUNCH_ACTIONS.has(cuAction)) {
			await this.streamLaunchUI(block, cuAction, uiHelpers);
		} else {
			await uiHelpers.say(
				"browser_action",
				JSON.stringify(buildBrowserActionPayload(block.params)),
				undefined,
				undefined,
				block.partial,
			);
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const cuAction = parseValidAction(block);
		if (!cuAction) {
			config.taskState.consecutiveMistakeCount++;
			const errorResult = await config.callbacks.sayAndCreateMissingParamError(
				this.name,
				"cu_action",
			);
			await config.services.browserSession.closeBrowser();
			return errorResult;
		}

		const cuExecutor = config.services.computerUseExecutor;
		if (!cuExecutor) {
			return formatResponse.toolError(
				"Computer Use is not available. The ComputerUseExecutor has not been initialized.",
			);
		}

		const args = extractActionArgs(block.params);

		try {
			let browserActionResult: BrowserActionResult;

			if (BROWSER_LAUNCH_ACTIONS.has(cuAction)) {
				const outcome = await this.executeLaunchAction(
					config,
					block,
					cuAction,
					args,
					cuExecutor,
				);
				if (outcome.denied) {
					return formatResponse.toolDenied();
				}
				browserActionResult = outcome.result;
			} else {
				config.taskState.consecutiveMistakeCount = 0;
				await config.callbacks.say(
					"browser_action",
					JSON.stringify(buildBrowserActionPayload(block.params)),
					undefined,
					undefined,
					false,
				);
				browserActionResult = await cuExecutor.executeAction(cuAction, args);
			}

			await config.callbacks.say(
				"browser_action_result",
				JSON.stringify(browserActionResult),
			);

			return formatResponse.toolResult(
				`The Computer Use action "${cuAction}" has been executed. The console logs and screenshot have been captured for your analysis.\n\nConsole logs:\n${
					browserActionResult.logs || "(No new logs)"
				}\n\n(The browser will close automatically when you use a non-browser tool. When you are done browsing, simply proceed to use other tools.)`,
				browserActionResult.screenshot ? [browserActionResult.screenshot] : [],
			);
		} catch (error) {
			// Only close browser for execution errors (e.g., Puppeteer crash),
			// not for validation errors which shouldn't kill the session.
			const isValidationError =
				error instanceof Error &&
				(error.message.includes("requires a non-empty") ||
					error.message.includes("Invalid coordinates") ||
					error.message.includes("invalid direction") ||
					error.message.includes("Unknown Computer Use action"));
			if (!isValidationError) {
				await config.services.browserSession.closeBrowser();
			}
			throw error;
		}
	}

	/**
	 * Stream the launch approval UI during partial block processing.
	 */
	private async streamLaunchUI(
		block: ToolUse,
		cuAction: string,
		uiHelpers: StronglyTypedUIHelpers,
	): Promise<void> {
		const displayText = getLaunchDisplayText(cuAction, block.params);

		if (uiHelpers.shouldAutoApproveTool(block.name)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType(
				"ask",
				"browser_action_launch",
			);
			await uiHelpers.say(
				"browser_action_launch",
				uiHelpers.removeClosingTag(block, "url", displayText),
				undefined,
				undefined,
				block.partial,
			);
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType(
				"say",
				"browser_action_launch",
			);
			await uiHelpers
				.ask(
					"browser_action_launch",
					uiHelpers.removeClosingTag(block, "url", displayText),
					block.partial,
				)
				.catch(() => {});
		}
	}

	/**
	 * Execute a browser-launching CU action (navigate, open_web_browser, search) with full approval flow.
	 * Returns a discriminated union: either { denied: true } or { denied: false, result }.
	 */
	private async executeLaunchAction(
		config: TaskConfig,
		block: ToolUse,
		cuAction: string,
		args: Record<string, unknown>,
		cuExecutor: NonNullable<TaskConfig["services"]["computerUseExecutor"]>,
	): Promise<LaunchResult> {
		config.taskState.consecutiveMistakeCount = 0;
		const displayText = getLaunchDisplayText(cuAction, block.params);

		const autoApprover = config.autoApprover || {
			shouldAutoApproveTool: () => false,
		};
		if (autoApprover.shouldAutoApproveTool(block.name)) {
			await config.callbacks.removeLastPartialMessageIfExistsWithType(
				"ask",
				"browser_action_launch",
			);
			await config.callbacks.say(
				"browser_action_launch",
				displayText,
				undefined,
				undefined,
				false,
			);
		} else {
			showNotificationForApproval(
				`Axolotl wants to use Computer Use: ${cuAction} ${displayText}`,
				config.autoApprovalSettings.enableNotifications,
			);
			await config.callbacks.removeLastPartialMessageIfExistsWithType(
				"say",
				"browser_action_launch",
			);
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
				"browser_action_launch",
				displayText,
				config,
			);
			if (!didApprove) {
				return { denied: true };
			}
		}

		// Run PreToolUse hook after approval but before execution
		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils");
			await ToolHookUtils.runPreToolUseIfEnabled(config, block);
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import(
				"@core/hooks/PreToolUseHookCancellationError"
			);
			if (error instanceof PreToolUseHookCancellationError) {
				return { denied: true };
			}
			throw error;
		}

		// Start loading spinner
		await config.callbacks.say("browser_action_result", "");

		// Re-make browserSession to apply latest settings
		config.services.browserSession =
			await config.callbacks.applyLatestBrowserSettings();
		await config.services.browserSession.launchBrowser();

		// Update the CU executor with the new browser session
		cuExecutor.updateBrowserSession(config.services.browserSession);

		return {
			denied: false,
			result: await cuExecutor.executeAction(cuAction, args),
		};
	}
}
