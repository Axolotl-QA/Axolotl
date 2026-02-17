import type { McpDisplayMode } from "@shared/McpDisplayMode";
import type { OpenaiReasoningEffort } from "@shared/storage/types";
import {
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { memo } from "react";
import McpDisplayModeDropdown from "@/components/mcp/chat-display/McpDisplayModeDropdown";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { isMacOSOrLinux } from "@/utils/platformUtils";
import Section from "../Section";
import { updateSetting } from "../utils/settingsHandlers";

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null;
}

const FeatureSettingsSection = ({
	renderSectionHeader,
}: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		mcpDisplayMode,
		openaiReasoningEffort,
		yoloModeToggled,
		dictationSettings,
		useAutoCondense,
		focusChainSettings,
		multiRootSetting,
		hooksEnabled,
		skillsEnabled,
		remoteConfigSettings,
		nativeToolCallSetting,
		enableParallelToolCalling,
		backgroundEditEnabled,
	} = useExtensionState();

	const handleReasoningEffortChange = (newValue: OpenaiReasoningEffort) => {
		updateSetting("openaiReasoningEffort", newValue);
	};

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				<div style={{ marginBottom: 20 }}>
					<div>
						<VSCodeCheckbox
							checked={enableCheckpointsSetting}
							onChange={(e: any) => {
								const checked = e.target.checked === true;
								updateSetting("enableCheckpointsSetting", checked);
							}}
						>
							Enable Checkpoints
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							Enables extension to save checkpoints of workspace throughout the
							task. Uses git under the hood which may not work well with large
							workspaces.
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
							htmlFor="mcp-display-mode-dropdown"
						>
							MCP Display Mode
						</label>
						<McpDisplayModeDropdown
							className="w-full"
							id="mcp-display-mode-dropdown"
							onChange={(newMode: McpDisplayMode) =>
								updateSetting("mcpDisplayMode", newMode)
							}
							value={mcpDisplayMode}
						/>
						<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
							Controls how MCP responses are displayed: plain text, rich
							formatting with links/images, or markdown rendering.
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
							htmlFor="openai-reasoning-effort-dropdown"
						>
							OpenAI Reasoning Effort
						</label>
						<VSCodeDropdown
							className="w-full"
							currentValue={openaiReasoningEffort || "medium"}
							id="openai-reasoning-effort-dropdown"
							onChange={(e: any) => {
								const newValue = e.target.currentValue as OpenaiReasoningEffort;
								handleReasoningEffortChange(newValue);
							}}
						>
							<VSCodeOption value="minimal">Minimal</VSCodeOption>
							<VSCodeOption value="low">Low</VSCodeOption>
							<VSCodeOption value="medium">Medium</VSCodeOption>
							<VSCodeOption value="high">High</VSCodeOption>
						</VSCodeDropdown>
						<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
							Reasoning effort for the OpenAI family of models(applies to all
							OpenAI model providers)
						</p>
					</div>
					{
						<div style={{ marginTop: 10 }}>
							<VSCodeCheckbox
								checked={focusChainSettings?.enabled || false}
								onChange={(e: any) => {
									const checked = e.target.checked === true;
									updateSetting("focusChainSettings", {
										...focusChainSettings,
										enabled: checked,
									});
								}}
							>
								Enable Focus Chain
							</VSCodeCheckbox>
							<p className="text-xs text-(--vscode-descriptionForeground)">
								Enables enhanced task progress tracking and automatic focus
								chain list management throughout tasks.
							</p>
						</div>
					}
					{focusChainSettings?.enabled && (
						<div style={{ marginTop: 10, marginLeft: 20 }}>
							<label
								className="block text-sm font-medium text-(--vscode-foreground) mb-1"
								htmlFor="focus-chain-remind-interval"
							>
								Focus Chain Reminder Interval
							</label>
							<VSCodeTextField
								className="w-20"
								id="focus-chain-remind-interval"
								onChange={(e: any) => {
									const value = parseInt(e.target.value, 10);
									if (!Number.isNaN(value) && value >= 1 && value <= 100) {
										updateSetting("focusChainSettings", {
											...focusChainSettings,
											remindClineInterval: value,
										});
									}
								}}
								value={String(focusChainSettings?.remindClineInterval || 6)}
							/>
							<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
								Interval (in messages) to remind Axolotl about its focus chain
								checklist (1-100). Lower values provide more frequent reminders.
							</p>
						</div>
					)}
					{dictationSettings?.featureEnabled && (
						<div className="mt-2.5">
							<VSCodeCheckbox
								checked={dictationSettings?.dictationEnabled}
								onChange={(e: any) => {
									const checked = e.target.checked === true;
									const updatedDictationSettings = {
										...dictationSettings,
										dictationEnabled: checked,
									};
									updateSetting("dictationSettings", updatedDictationSettings);
								}}
							>
								Enable Dictation
							</VSCodeCheckbox>
							<p className="text-xs text-description mt-1">
								Enables speech-to-text transcription. Uses the Aqua Voice's
								Avalon model, at $0.0065 credits per minute of audio processed.
								5 minutes max per message.
							</p>
						</div>
					)}
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={useAutoCondense}
							onChange={(e: any) => {
								const checked = e.target.checked === true;
								updateSetting("useAutoCondense", checked);
							}}
						>
							Enable Auto Compact
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							Enables advanced context management system which uses LLM based
							condensing for next-gen models.
						</p>
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={nativeToolCallSetting}
							onChange={(e) => {
								const enabled = (e?.target as HTMLInputElement).checked;
								updateSetting("nativeToolCallEnabled", enabled);
							}}
						>
							Enable Native Tool Call
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							Uses the model's native tool calling API instead of XML-based tool
							parsing. This will improve performance for supported models.
						</p>
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={enableParallelToolCalling}
							onChange={(e) => {
								const enabled = (e?.target as HTMLInputElement).checked;
								updateSetting("enableParallelToolCalling", enabled);
							}}
						>
							Enable Parallel Tool Calling
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">
								Experimental:{" "}
							</span>{" "}
							<span className="text-description">
								Allows models to call multiple tools in a single response.
								Automatically enabled for GPT-5 models.
							</span>
						</p>
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={backgroundEditEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true;
								updateSetting("backgroundEditEnabled", checked);
							}}
						>
							Enable Background Edit
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-error">Experimental: </span>
							<span className="text-description">
								Allows editing files in background without opening the diff view
								in editor.
							</span>
						</p>
					</div>
					{multiRootSetting.featureFlag && (
						<div className="mt-2.5">
							<VSCodeCheckbox
								checked={multiRootSetting.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true;
									updateSetting("multiRootEnabled", checked);
								}}
							>
								Enable Multi-Root Workspace
							</VSCodeCheckbox>
							<p className="text-xs">
								<span className="text-error">Experimental: </span>{" "}
								<span className="text-description">
									Allows Axolotl to work across multiple workspaces.
								</span>
							</p>
						</div>
					)}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={hooksEnabled}
							disabled={!isMacOSOrLinux()}
							onChange={(e: any) => {
								const checked = e.target.checked === true;
								updateSetting("hooksEnabled", checked);
							}}
						>
							Enable Hooks
						</VSCodeCheckbox>
						{!isMacOSOrLinux() ? (
							<p
								className="text-xs mt-1"
								style={{
									color: "var(--vscode-inputValidation-warningForeground)",
								}}
							>
								Hooks are not yet supported on Windows. This feature is
								currently available on macOS and Linux only.
							</p>
						) : (
							<p className="text-xs">
								<span className="text-(--vscode-errorForeground)">
									Experimental:{" "}
								</span>{" "}
								<span className="text-description">
									Allows execution of hooks from .clinerules/hooks/ directory.
								</span>
							</p>
						)}
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={skillsEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true;
								updateSetting("skillsEnabled", checked);
							}}
						>
							Enable Skills
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">
								Experimental:{" "}
							</span>{" "}
							<span className="text-description">
								Enables Skills for reusable, on-demand agent instructions from
								.cline/skills/ directories.
							</span>
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={yoloModeToggled}
										disabled={
											remoteConfigSettings?.yoloModeToggled !== undefined
										}
										onChange={(e: any) => {
											const checked = e.target.checked === true;
											updateSetting("yoloModeToggled", checked);
										}}
									>
										Enable YOLO Mode
									</VSCodeCheckbox>
									{remoteConfigSettings?.yoloModeToggled !== undefined && (
										<i className="codicon codicon-lock text-description text-sm" />
									)}
								</div>
							</TooltipTrigger>
							<TooltipContent
								className="max-w-xs"
								hidden={remoteConfigSettings?.yoloModeToggled === undefined}
								side="top"
							>
								This setting is managed by your organization's remote
								configuration
							</TooltipContent>
						</Tooltip>

						<p className="text-xs text-(--vscode-errorForeground)">
							EXPERIMENTAL & DANGEROUS: This mode disables safety checks and
							user confirmations. Axolotl will automatically approve all actions
							without asking. Use with extreme caution.
						</p>
					</div>
				</div>
			</Section>
		</div>
	);
};

export default memo(FeatureSettingsSection);
