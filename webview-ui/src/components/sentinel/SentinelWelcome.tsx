import { StringRequest } from "@shared/proto/cline/common"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { ChevronDown, ChevronRight, FileCode, FileText, GitBranch, GitPullRequest, History, Play } from "lucide-react"
import { memo, useCallback, useState } from "react"
import SentinelLogo from "@/assets/SentinelLogo"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

type TestSource = "uncommitted" | "pr" | "files"

interface SentinelWelcomeProps {
	showHistoryView: () => void
}

const SentinelWelcome = ({ showHistoryView }: SentinelWelcomeProps) => {
	const { taskHistory, environment } = useExtensionState()
	const [testSource, setTestSource] = useState<TestSource>("files")
	const [targetFiles, setTargetFiles] = useState("")
	const [prInput, setPrInput] = useState("")
	const [prdDescription, setPrdDescription] = useState("")
	const [isHistoryExpanded, setIsHistoryExpanded] = useState(false)

	const handleStartTest = useCallback(async () => {
		let message = "/sentinel-qa"

		// Build message based on test source
		switch (testSource) {
			case "uncommitted": {
				message += " --source=uncommitted"
				break
			}
			case "pr": {
				if (!prInput.trim()) return
				message += ` --source=pr --pr=${prInput.trim()}`
				break
			}
			case "files": {
				if (!targetFiles.trim() && !prdDescription.trim()) return
				if (targetFiles.trim()) {
					message += ` @${targetFiles.trim()}`
				}
				break
			}
		}

		// Add PRD description if provided
		if (prdDescription.trim()) {
			message += ` PRD: ${prdDescription.trim()}`
		}

		// Create a new task with the sentinel-qa command
		await TaskServiceClient.newTask(
			NewTaskRequest.create({
				text: message,
				images: [],
				files: [],
			}),
		)
	}, [testSource, targetFiles, prInput, prdDescription])

	const isStartDisabled = useCallback(() => {
		switch (testSource) {
			case "uncommitted":
				return false // Always enabled for uncommitted changes
			case "pr":
				return !prInput.trim()
			case "files":
				return !targetFiles.trim() && !prdDescription.trim()
		}
	}, [testSource, targetFiles, prInput, prdDescription])

	const handleHistorySelect = useCallback((id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}, [])

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date?.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
		})
	}

	const recentTests = taskHistory.filter((item) => item.ts && item.task).slice(0, 5)

	return (
		<div className="flex flex-col h-full w-full overflow-y-auto">
			<style>
				{`
					@keyframes sentinel-logo-pop-in {
						0% { opacity: 0; transform: scale(0.95); }
						60% { opacity: 1; transform: scale(1.02); }
						100% { opacity: 1; transform: scale(1); }
					}
					.sentinel-logo-animate { 
						animation: sentinel-logo-pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); 
					}
					.sentinel-card {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 50%, transparent);
						border: 1px solid var(--vscode-panel-border);
						border-radius: 8px;
					}
					.sentinel-input {
						width: 100%;
						background-color: var(--vscode-input-background);
						border: 1px solid var(--vscode-input-border);
						border-radius: 6px;
						padding: 8px 12px;
						font-size: var(--vscode-font-size);
						color: var(--vscode-input-foreground);
						resize: none;
					}
					.sentinel-input:focus {
						outline: none;
						border-color: var(--vscode-focusBorder);
					}
					.sentinel-input::placeholder {
						color: var(--vscode-input-placeholderForeground);
					}
					.sentinel-btn-start {
						width: 100%;
						padding: 10px 16px;
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						border-radius: 6px;
						font-size: var(--vscode-font-size);
						font-weight: 500;
						cursor: pointer;
						display: flex;
						align-items: center;
						justify-content: center;
						gap: 8px;
						transition: background-color 0.15s;
					}
					.sentinel-btn-start:hover:not(:disabled) {
						background-color: var(--vscode-button-hoverBackground);
					}
					.sentinel-btn-start:disabled {
						opacity: 0.5;
						cursor: not-allowed;
					}
					.sentinel-history-toggle {
						width: 100%;
						display: flex;
						align-items: center;
						justify-content: space-between;
						padding: 10px 12px;
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 50%, transparent);
						border: 1px solid var(--vscode-panel-border);
						border-radius: 8px;
						cursor: pointer;
						transition: background-color 0.15s;
					}
					.sentinel-history-toggle:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.sentinel-history-item {
						padding: 10px 12px;
						border-bottom: 1px solid var(--vscode-panel-border);
						cursor: pointer;
						transition: background-color 0.15s;
					}
					.sentinel-history-item:last-child {
						border-bottom: none;
					}
					.sentinel-history-item:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.sentinel-badge {
						background-color: var(--vscode-badge-background);
						color: var(--vscode-badge-foreground);
						padding: 2px 8px;
						border-radius: 12px;
						font-size: 0.75em;
						font-weight: 500;
					}
					.sentinel-tips {
						background-color: color-mix(in srgb, var(--vscode-editorInfo-foreground) 10%, transparent);
						border: 1px solid color-mix(in srgb, var(--vscode-editorInfo-foreground) 30%, transparent);
						border-radius: 8px;
						padding: 12px;
					}
					.sentinel-source-tabs {
						display: flex;
						gap: 4px;
						padding: 4px;
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 30%, transparent);
						border-radius: 8px;
						margin-bottom: 16px;
					}
					.sentinel-source-tab {
						flex: 1;
						padding: 8px 12px;
						border: none;
						border-radius: 6px;
						background: transparent;
						color: var(--vscode-descriptionForeground);
						font-size: 0.75rem;
						font-weight: 500;
						cursor: pointer;
						display: flex;
						align-items: center;
						justify-content: center;
						gap: 6px;
						transition: all 0.15s;
					}
					.sentinel-source-tab:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.sentinel-source-tab.active {
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
					}
					.sentinel-source-description {
						font-size: 0.75rem;
						color: var(--vscode-descriptionForeground);
						padding: 12px;
						background-color: color-mix(in srgb, var(--vscode-editorInfo-foreground) 8%, transparent);
						border-radius: 6px;
						margin-bottom: 16px;
						display: flex;
						align-items: flex-start;
						gap: 8px;
					}
				`}
			</style>

			{/* Header */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					paddingTop: "24px",
					paddingBottom: "16px",
				}}>
				<div className="sentinel-logo-animate" style={{ marginTop: "16px", marginBottom: "16px" }}>
					<SentinelLogo className="size-16" environment={environment} />
				</div>
				<h1 style={{ fontSize: "1.25rem", fontWeight: "bold", color: "var(--vscode-foreground)", margin: 0 }}>
					Sentinel QA
				</h1>
				<p
					style={{
						fontSize: "0.875rem",
						color: "var(--vscode-descriptionForeground)",
						marginTop: "4px",
						textAlign: "center",
						padding: "0 16px",
					}}>
					AI-powered QA Agent for PR validation
				</p>
			</div>

			{/* Start New Test Section */}
			<div style={{ padding: "0 16px 16px 16px" }}>
				<div className="sentinel-card" style={{ padding: "16px" }}>
					<h2
						style={{
							fontSize: "0.875rem",
							fontWeight: 600,
							color: "var(--vscode-foreground)",
							marginBottom: "16px",
							display: "flex",
							alignItems: "center",
							gap: "8px",
						}}>
						<Play size={16} />
						Start New Test
					</h2>

					{/* Test Source Selector */}
					<div className="sentinel-source-tabs">
						<button
							className={`sentinel-source-tab ${testSource === "uncommitted" ? "active" : ""}`}
							onClick={() => setTestSource("uncommitted")}
							type="button">
							<GitBranch size={14} />
							Uncommitted
						</button>
						<button
							className={`sentinel-source-tab ${testSource === "pr" ? "active" : ""}`}
							onClick={() => setTestSource("pr")}
							type="button">
							<GitPullRequest size={14} />
							PR
						</button>
						<button
							className={`sentinel-source-tab ${testSource === "files" ? "active" : ""}`}
							onClick={() => setTestSource("files")}
							type="button">
							<FileCode size={14} />
							Files
						</button>
					</div>

					{/* Source Description */}
					{testSource === "uncommitted" && (
						<div className="sentinel-source-description">
							<GitBranch size={14} style={{ flexShrink: 0, marginTop: "2px" }} />
							<span>
								Test all uncommitted changes in your workspace. Sentinel will automatically detect modified
								files using <code style={{ fontSize: "0.7rem" }}>git diff</code>.
							</span>
						</div>
					)}
					{testSource === "pr" && (
						<div className="sentinel-source-description">
							<GitPullRequest size={14} style={{ flexShrink: 0, marginTop: "2px" }} />
							<span>
								Test changes from a Pull Request. Sentinel will checkout the PR branch, analyze the changes,
								and run tests. You'll be asked to confirm before switching branches.
							</span>
						</div>
					)}
					{testSource === "files" && (
						<div className="sentinel-source-description">
							<FileCode size={14} style={{ flexShrink: 0, marginTop: "2px" }} />
							<span>Manually select specific files to test. Use @ to mention files or paste paths directly.</span>
						</div>
					)}

					{/* PR Input (shown only for PR mode) */}
					{testSource === "pr" && (
						<div style={{ marginBottom: "16px" }}>
							<label
								style={{
									display: "flex",
									alignItems: "center",
									gap: "8px",
									fontSize: "0.75rem",
									color: "var(--vscode-descriptionForeground)",
									marginBottom: "8px",
								}}>
								<GitPullRequest size={12} />
								PR URL or Number
							</label>
							<input
								className="sentinel-input"
								onChange={(e) => setPrInput(e.target.value)}
								placeholder="e.g., https://github.com/owner/repo/pull/123 or #123"
								type="text"
								value={prInput}
							/>
						</div>
					)}

					{/* Target Files Input (shown only for files mode) */}
					{testSource === "files" && (
						<div style={{ marginBottom: "16px" }}>
							<label
								style={{
									display: "flex",
									alignItems: "center",
									gap: "8px",
									fontSize: "0.75rem",
									color: "var(--vscode-descriptionForeground)",
									marginBottom: "8px",
								}}>
								<FileCode size={12} />
								Target Files (code to test)
							</label>
							<textarea
								className="sentinel-input"
								onChange={(e) => setTargetFiles(e.target.value)}
								placeholder="e.g., @/src/auth/login.ts or paste file paths..."
								rows={2}
								value={targetFiles}
							/>
							<p style={{ fontSize: "0.75rem", color: "var(--vscode-descriptionForeground)", marginTop: "4px" }}>
								Use @ to mention files or paste paths directly
							</p>
						</div>
					)}

					{/* PRD Description Input (shown for all modes) */}
					<div style={{ marginBottom: "16px" }}>
						<label
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								fontSize: "0.75rem",
								color: "var(--vscode-descriptionForeground)",
								marginBottom: "8px",
							}}>
							<FileText size={12} />
							PRD / Feature Description {testSource !== "files" && "(optional)"}
						</label>
						<textarea
							className="sentinel-input"
							onChange={(e) => setPrdDescription(e.target.value)}
							placeholder="Describe what the feature should do, e.g., 'User can login with email and password, show error on failure'"
							rows={3}
							value={prdDescription}
						/>
					</div>

					{/* Start Button */}
					<button
						className="sentinel-btn-start"
						disabled={isStartDisabled()}
						onClick={handleStartTest}
						type="button">
						<Play size={16} />
						Start QA Test
					</button>

					<p
						style={{
							fontSize: "0.75rem",
							color: "var(--vscode-descriptionForeground)",
							textAlign: "center",
							marginTop: "12px",
						}}>
						Or type{" "}
						<code
							style={{
								backgroundColor: "var(--vscode-textCodeBlock-background)",
								padding: "2px 6px",
								borderRadius: "4px",
							}}>
							/sentinel-qa
						</code>{" "}
						in the chat below
					</p>
				</div>
			</div>

			{/* Recent Tests Section - Collapsible */}
			<div style={{ padding: "0 16px 16px 16px" }}>
				<button
					className="sentinel-history-toggle"
					onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
					type="button">
					<span
						style={{
							display: "flex",
							alignItems: "center",
							gap: "8px",
							fontSize: "0.875rem",
							fontWeight: 500,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<History size={16} />
						Recent Tests
						{recentTests.length > 0 && <span className="sentinel-badge">{recentTests.length}</span>}
					</span>
					{isHistoryExpanded ? (
						<ChevronDown size={16} style={{ color: "var(--vscode-descriptionForeground)" }} />
					) : (
						<ChevronRight size={16} style={{ color: "var(--vscode-descriptionForeground)" }} />
					)}
				</button>

				{isHistoryExpanded && (
					<div className="sentinel-card" style={{ marginTop: "8px", overflow: "hidden" }}>
						{recentTests.length > 0 ? (
							<>
								{recentTests.map((item) => (
									<div
										className="sentinel-history-item"
										key={item.id}
										onClick={() => handleHistorySelect(item.id)}>
										<div
											style={{
												display: "flex",
												alignItems: "flex-start",
												justifyContent: "space-between",
												gap: "8px",
											}}>
											<div style={{ flex: 1, minWidth: 0 }}>
												<p
													style={{
														fontSize: "0.875rem",
														color: "var(--vscode-foreground)",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
														margin: 0,
													}}>
													{item.task}
												</p>
											</div>
											<div
												style={{
													display: "flex",
													flexDirection: "column",
													alignItems: "flex-end",
													gap: "4px",
													flexShrink: 0,
												}}>
												<span
													style={{ fontSize: "0.75rem", color: "var(--vscode-descriptionForeground)" }}>
													{formatDate(item.ts)}
												</span>
												{item.totalCost != null && (
													<span className="sentinel-badge">${item.totalCost.toFixed(2)}</span>
												)}
											</div>
										</div>
									</div>
								))}
								<button
									onClick={showHistoryView}
									style={{
										width: "100%",
										padding: "10px",
										fontSize: "0.875rem",
										color: "var(--vscode-textLink-foreground)",
										background: "none",
										border: "none",
										cursor: "pointer",
									}}
									type="button">
									View All History
								</button>
							</>
						) : (
							<div
								style={{
									padding: "16px",
									textAlign: "center",
									fontSize: "0.875rem",
									color: "var(--vscode-descriptionForeground)",
								}}>
								No recent tests
							</div>
						)}
					</div>
				)}
			</div>

			{/* Tips Section */}
			<div style={{ padding: "0 16px 24px 16px" }}>
				<div className="sentinel-tips">
					<h3
						style={{
							fontSize: "0.75rem",
							fontWeight: 600,
							color: "var(--vscode-editorInfo-foreground)",
							marginBottom: "8px",
						}}>
						💡 Tips
					</h3>
					<ul
						style={{
							fontSize: "0.75rem",
							color: "var(--vscode-descriptionForeground)",
							margin: 0,
							paddingLeft: 0,
							listStyle: "none",
						}}>
						<li style={{ marginBottom: "4px" }}>• <strong>Uncommitted</strong>: Test all your local changes before committing</li>
						<li style={{ marginBottom: "4px" }}>• <strong>PR</strong>: Test changes from a Pull Request (will checkout branch)</li>
						<li style={{ marginBottom: "4px" }}>• <strong>Files</strong>: Manually select specific files to test</li>
						<li>• After testing, you'll get a merge recommendation</li>
					</ul>
				</div>
			</div>
		</div>
	)
}

export default memo(SentinelWelcome)
