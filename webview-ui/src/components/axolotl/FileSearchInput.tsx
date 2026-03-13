import { FileSearchRequest, FileSearchType } from "@shared/proto/cline/file";
import { useCallback, useEffect, useRef, useState } from "react";
import { cleanPathPrefix } from "@/components/common/CodeAccordian";
import { FileServiceClient } from "@/services/grpc-client";
import type { SearchResult } from "@/utils/context-mentions";
import { insertMention } from "@/utils/context-mentions";

interface FileSearchInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	rows?: number;
	className?: string;
}

/**
 * A textarea with @ file search autocomplete.
 * Type @ followed by a query to search for files in the workspace.
 */
const FileSearchInput = ({
	value,
	onChange,
	placeholder,
	rows = 2,
	className,
}: FileSearchInputProps) => {
	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [showMenu, setShowMenu] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isLoading, setIsLoading] = useState(false);

	// Detect @ and trigger search
	const handleInput = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value;
			const cursorPos = e.target.selectionStart || 0;
			onChange(newValue);

			// Check if we should show the menu
			const beforeCursor = newValue.slice(0, cursorPos);
			const lastAtIndex = beforeCursor.lastIndexOf("@");

			if (lastAtIndex !== -1) {
				const textBetween = beforeCursor.slice(lastAtIndex + 1);
				// Show menu if no spaces in the query (simple file path search)
				if (!textBetween.includes(" ") && !textBetween.includes("\n")) {
					setShowMenu(true);
					setSearchQuery(textBetween);
					setSelectedIndex(0);

					if (textBetween.length > 0) {
						// Debounced file search
						if (searchTimeoutRef.current) {
							clearTimeout(searchTimeoutRef.current);
						}
						setIsLoading(true);
						searchTimeoutRef.current = setTimeout(() => {
							FileServiceClient.searchFiles(
								FileSearchRequest.create({
									query: textBetween,
									mentionsRequestId: textBetween,
									selectedType: FileSearchType.FILE,
								}),
							)
								.then((results) => {
									setSearchResults((results.results || []) as SearchResult[]);
									setIsLoading(false);
								})
								.catch(() => {
									setSearchResults([]);
									setIsLoading(false);
								});
						}, 200);
					} else {
						// Just typed @, show initial results
						setIsLoading(true);
						FileServiceClient.searchFiles(
							FileSearchRequest.create({
								query: "",
								mentionsRequestId: "",
								selectedType: FileSearchType.FILE,
							}),
						)
							.then((results) => {
								setSearchResults((results.results || []) as SearchResult[]);
								setIsLoading(false);
							})
							.catch(() => {
								setSearchResults([]);
								setIsLoading(false);
							});
					}
					return;
				}
			}

			setShowMenu(false);
			setSearchResults([]);
		},
		[onChange],
	);

	const selectResult = useCallback(
		(result: SearchResult) => {
			if (!textAreaRef.current) return;

			const cursorPos = textAreaRef.current.selectionStart || 0;
			const { newValue } = insertMention(
				value,
				cursorPos,
				result.path,
				searchQuery.length,
			);

			onChange(newValue);
			setShowMenu(false);
			setSearchResults([]);
			setSearchQuery("");

			// Focus back on textarea
			setTimeout(() => {
				if (textAreaRef.current) {
					textAreaRef.current.focus();
					const newCursorPos =
						newValue.indexOf(result.path) + result.path.length + 2; // +2 for @ and space
					textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos);
				}
			}, 0);
		},
		[value, searchQuery, onChange],
	);

	// Close menu when clicking outside
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(e.target as Node) &&
				textAreaRef.current &&
				!textAreaRef.current.contains(e.target as Node)
			) {
				setShowMenu(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Scroll selected item into view
	useEffect(() => {
		if (menuRef.current && selectedIndex >= 0) {
			const item = menuRef.current.children[selectedIndex] as HTMLElement;
			item?.scrollIntoView({ block: "nearest" });
		}
	}, [selectedIndex]);

	// Handle keyboard navigation
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (!showMenu || searchResults.length === 0) return;

			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setSelectedIndex((prev) =>
						prev < searchResults.length - 1 ? prev + 1 : 0,
					);
					break;
				case "ArrowUp":
					e.preventDefault();
					setSelectedIndex((prev) =>
						prev > 0 ? prev - 1 : searchResults.length - 1,
					);
					break;
				case "Enter":
				case "Tab":
					e.preventDefault();
					selectResult(searchResults[selectedIndex]);
					break;
				case "Escape":
					e.preventDefault();
					setShowMenu(false);
					break;
			}
		},
		[showMenu, searchResults, selectedIndex, selectResult],
	);

	return (
		<div style={{ position: "relative" }}>
			<textarea
				className={className}
				onChange={handleInput}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				ref={textAreaRef}
				rows={rows}
				value={value}
			/>
			{showMenu && (searchResults.length > 0 || isLoading) && (
				<div
					ref={menuRef}
					style={{
						position: "absolute",
						bottom: "calc(100% + 2px)",
						left: 0,
						right: 0,
						backgroundColor: "var(--vscode-dropdown-background)",
						border: "1px solid var(--vscode-editorGroup-border)",
						borderRadius: "3px",
						boxShadow: "0 4px 10px rgba(0, 0, 0, 0.25)",
						zIndex: 1000,
						maxHeight: "200px",
						overflowY: "auto",
					}}
				>
					{isLoading && searchResults.length === 0 && (
						<div
							style={{
								padding: "8px 12px",
								display: "flex",
								alignItems: "center",
								gap: "8px",
								opacity: 0.7,
							}}
						>
							<i
								className="codicon codicon-loading codicon-modifier-spin"
								style={{ fontSize: "14px" }}
							/>
							<span>Searching...</span>
						</div>
					)}
					{searchResults.map((result, index) => {
						const displayPath = result.path;
						return (
							<div
								key={`${result.type}-${result.path}`}
								role="option"
								tabIndex={-1}
								onClick={() => selectResult(result)}
								onMouseEnter={() => setSelectedIndex(index)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										selectResult(result);
									}
								}}
								style={{
									padding: "8px 12px",
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									gap: "8px",
									backgroundColor:
										index === selectedIndex
											? "var(--vscode-quickInputList-focusBackground)"
											: "",
									color:
										index === selectedIndex
											? "var(--vscode-quickInputList-focusForeground)"
											: "",
									borderBottom: "1px solid var(--vscode-editorGroup-border)",
								}}
							>
								<i
									className={`codicon codicon-${result.type === "folder" ? "folder" : "file"}`}
									style={{ fontSize: "14px", flexShrink: 0 }}
								/>
								<span
									style={{
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
										direction: "rtl",
										textAlign: "left",
									}}
								>
									{`${cleanPathPrefix(displayPath)}\u200E`}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

export default FileSearchInput;
