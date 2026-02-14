import type { ToolUse } from "@core/assistant-message";
import { formatResponse } from "@core/prompts/responses";
import { ClineDefaultTool } from "@/shared/tools";
import type { ToolResponse } from "../../index";
import type { IToolHandler } from "../ToolExecutorCoordinator";
import type { TaskConfig } from "../types/TaskConfig";

// You.com API configuration
const YOU_API_URL = "https://api.you.com/v1/agents/runs";

interface YouSearchResult {
	source_type?: string;
	citation_uri?: string;
	title?: string;
	snippet?: string;
	url?: string;
}

interface YouOutputItem {
	type: string;
	text?: string;
	content?: YouSearchResult[];
}

interface YouAgentResponse {
	agent: string;
	input: Array<{ role: string; content: string }>;
	output: YouOutputItem[];
}

export class AxolotlWebSearchHandler implements IToolHandler {
	readonly name = ClineDefaultTool.AXOLOTL_WEB_SEARCH;

	getDescription(block: ToolUse): string {
		const query = block.params.search_query || "unknown";
		const shortQuery =
			query.length > 40 ? query.substring(0, 40) + "..." : query;
		return `[${block.name} query="${shortQuery}"]`;
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		console.log(
			"[AxolotlWebSearch] Tool called with params:",
			JSON.stringify(block.params, null, 2),
		);

		const searchQuery: string | undefined = block.params.search_query;

		// Validate required parameters
		if (!searchQuery) {
			config.taskState.consecutiveMistakeCount++;
			return await config.callbacks.sayAndCreateMissingParamError(
				this.name,
				"search_query",
			);
		}

		config.taskState.consecutiveMistakeCount = 0;

		try {
			const youApiKey =
				config.services.stateManager.getSecretKey("youApiKey") ||
				process.env.YOU_API_KEY;
			if (!youApiKey) {
				throw new Error(
					"You.com API key is not configured. Please set it in Settings > API Configuration.",
				);
			}

			console.log(
				`[AxolotlWebSearch] Searching You.com API for: "${searchQuery}"`,
			);

			// Print search query to terminal
			await config.callbacks.executeCommandTool(
				`echo "\\n🔍 [AXOLOTL WEB SEARCH] Querying You.com API...\\nQuery: ${searchQuery.replace(/"/g, '\\"')}"`,
				10,
			);

			// Call You.com Express Agent API
			const response = await fetch(YOU_API_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${youApiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					agent: "express",
					input: searchQuery,
					stream: false,
					tools: [{ type: "web_search" }],
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`You.com API error (${response.status}): ${errorText}`);
			}

			const data = (await response.json()) as YouAgentResponse;
			console.log(
				`[AxolotlWebSearch] API response received, output items: ${data.output?.length || 0}`,
			);

			// Extract search results and answer
			let searchResults: YouSearchResult[] = [];
			let answerText = "";

			for (const item of data.output || []) {
				if (item.type === "web_search.results" && item.content) {
					searchResults = item.content;
				}
				if (item.type === "message.answer" && item.text) {
					answerText = item.text;
				}
			}

			console.log(
				`[AxolotlWebSearch] Results: ${searchResults.length} sources, answer length: ${answerText.length} chars`,
			);

			// Format results for terminal display
			const terminalOutput = this.formatTerminalOutput(
				searchQuery,
				answerText,
				searchResults,
			);

			// Print results to terminal via executeCommandTool
			// Use printf for multi-line output to avoid shell escaping issues
			const escapedOutput = terminalOutput
				.replace(/\\/g, "\\\\")
				.replace(/"/g, '\\"')
				.replace(/\$/g, "\\$")
				.replace(/`/g, "\\`")
				.replace(/\n/g, "\\n");
			await config.callbacks.executeCommandTool(
				`printf "${escapedOutput}"`,
				10,
			);

			// Format results for LLM context (tool response)
			const llmOutput = this.formatLLMOutput(
				searchQuery,
				answerText,
				searchResults,
			);

			return formatResponse.toolResult(llmOutput);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			console.error("Error in axolotl_web_search:", errorMessage);

			// Print error to terminal
			await config.callbacks.executeCommandTool(
				`echo "\\n❌ [AXOLOTL WEB SEARCH] Error: ${errorMessage.replace(/"/g, '\\"')}"`,
				10,
			);

			return formatResponse.toolError(`Failed to search web: ${errorMessage}`);
		}
	}

	private formatTerminalOutput(
		query: string,
		answer: string,
		results: YouSearchResult[],
	): string {
		const lines: string[] = [];
		lines.push("");
		lines.push(
			"╔══════════════════════════════════════════════════════════════╗",
		);
		lines.push(
			"║           🔍 AXOLOTL WEB SEARCH RESULTS                   ║",
		);
		lines.push(
			"╚══════════════════════════════════════════════════════════════╝",
		);
		lines.push("");
		lines.push(`📝 Query: ${query}`);
		lines.push("");

		if (answer) {
			lines.push(
				"━━━ Answer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
			);
			// Truncate answer for terminal display
			const truncatedAnswer =
				answer.length > 1000 ? answer.substring(0, 1000) + "..." : answer;
			lines.push(truncatedAnswer);
			lines.push("");
		}

		if (results.length > 0) {
			lines.push(
				"━━━ Sources ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
			);
			for (const result of results.slice(0, 5)) {
				lines.push(`  📄 ${result.title || "Untitled"}`);
				lines.push(`     ${result.url || result.citation_uri || ""}`);
				if (result.snippet) {
					const shortSnippet =
						result.snippet.length > 150
							? result.snippet.substring(0, 150) + "..."
							: result.snippet;
					lines.push(`     ${shortSnippet}`);
				}
				lines.push("");
			}
		}

		lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		lines.push("");
		return lines.join("\n");
	}

	private formatLLMOutput(
		query: string,
		answer: string,
		results: YouSearchResult[],
	): string {
		const lines: string[] = [];
		lines.push("=== AXOLOTL WEB SEARCH RESULTS ===");
		lines.push(`Query: ${query}`);
		lines.push("");

		if (answer) {
			lines.push("=== ANSWER ===");
			lines.push(answer);
			lines.push("");
		}

		if (results.length > 0) {
			lines.push("=== SOURCES ===");
			for (const result of results.slice(0, 5)) {
				lines.push(`- ${result.title || "Untitled"}`);
				lines.push(`  URL: ${result.url || result.citation_uri || "N/A"}`);
				if (result.snippet) {
					lines.push(`  Snippet: ${result.snippet}`);
				}
				lines.push("");
			}
		}

		lines.push(
			"Use these search results to inform your test plan generation and code analysis.",
		);
		return lines.join("\n");
	}
}
