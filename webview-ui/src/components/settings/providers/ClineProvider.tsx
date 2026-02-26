import type { Mode } from "@shared/storage/types";
import { useCallback, useMemo, useState } from "react";
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils";
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { ClineAccountInfoCard } from "../ClineAccountInfoCard";

interface ClineProviderProps {
	showModelOptions: boolean;
	isPopup?: boolean;
	currentMode: Mode;
}

// Only these models are available through the Axolotl provider
const AXOLOTL_MODELS = [
	{
		id: "claude-sonnet-4-5-20250929",
		label: "Claude Sonnet 4.5",
		provider: "Anthropic",
		badge: "BEST",
	},
	{
		id: "MiniMax-M2.5",
		label: "MiniMax M2.5",
		provider: "MiniMax",
		badge: "NEW",
	},
	{
		id: "MiniMax-M2.5-highspeed",
		label: "MiniMax M2.5 Highspeed",
		provider: "MiniMax",
		badge: "",
	},
	{ id: "MiniMax-M2.1", label: "MiniMax M2.1", provider: "MiniMax", badge: "" },
	{
		id: "MiniMax-M2.1-lightning",
		label: "MiniMax M2.1 Lightning",
		provider: "MiniMax",
		badge: "",
	},
	{ id: "MiniMax-M2", label: "MiniMax M2", provider: "MiniMax", badge: "" },
] as const;

export const ClineProvider = ({
	showModelOptions,
	isPopup,
	currentMode,
}: ClineProviderProps) => {
	const { handleModeFieldsChange } = useApiConfigurationHandlers();
	const { apiConfiguration, openRouterModels } = useExtensionState();
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode);
	const currentModelId =
		modeFields.openRouterModelId || "claude-sonnet-4-5-20250929";

	const handleModelChange = useCallback(
		(modelId: string) => {
			// Use openRouterModels info if available, otherwise use our known model info
			const modelInfo = openRouterModels?.[modelId] || undefined;

			handleModeFieldsChange(
				{
					openRouterModelId: {
						plan: "planModeOpenRouterModelId",
						act: "actModeOpenRouterModelId",
					},
					openRouterModelInfo: {
						plan: "planModeOpenRouterModelInfo",
						act: "actModeOpenRouterModelInfo",
					},
				},
				{
					openRouterModelId: modelId,
					openRouterModelInfo: modelInfo,
				},
				currentMode,
			);
		},
		[handleModeFieldsChange, openRouterModels, currentMode],
	);

	return (
		<div>
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<ClineAccountInfoCard />
			</div>

			{showModelOptions && (
				<div style={{ marginBottom: 15 }}>
					<label style={{ fontWeight: 500, display: "block", marginBottom: 8 }}>
						<span style={{ color: "var(--vscode-foreground)" }}>Model</span>
					</label>
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						{AXOLOTL_MODELS.map((model) => {
							const isSelected = currentModelId === model.id;
							return (
								<button
									key={model.id}
									onClick={() => handleModelChange(model.id)}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										padding: "8px 12px",
										border: isSelected
											? "1px solid var(--vscode-focusBorder)"
											: "1px solid var(--vscode-editorWidget-border)",
										borderRadius: 4,
										background: isSelected
											? "var(--vscode-list-activeSelectionBackground)"
											: "var(--vscode-input-background)",
										color: isSelected
											? "var(--vscode-list-activeSelectionForeground)"
											: "var(--vscode-foreground)",
										cursor: "pointer",
										textAlign: "left",
										width: "100%",
									}}
								>
									<div>
										<span style={{ fontWeight: 500 }}>{model.label}</span>
										<span
											style={{
												marginLeft: 8,
												fontSize: "0.8em",
												opacity: 0.7,
											}}
										>
											{model.provider}
										</span>
									</div>
									{model.badge && (
										<span
											style={{
												fontSize: "0.7em",
												fontWeight: 600,
												padding: "2px 6px",
												borderRadius: 3,
												background: "var(--vscode-badge-background)",
												color: "var(--vscode-badge-foreground)",
											}}
										>
											{model.badge}
										</span>
									)}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
};
