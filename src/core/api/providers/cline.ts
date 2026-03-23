import {
	type AnthropicModelId,
	anthropicDefaultModelId,
	anthropicModels,
	CLAUDE_SONNET_1M_SUFFIX,
	type MinimaxModelId,
	type ModelInfo,
	minimaxModels,
} from "@shared/api";
import { AxolotlEnv } from "@/config";
import { AuthService } from "@/services/auth/AuthService";
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/ClineAccount";
import type { ClineStorageMessage } from "@/shared/messages/content";
import { fetch } from "@/shared/net";
import type { ApiHandler, CommonApiHandlerOptions } from "../";
import { withRetry } from "../retry";
import { sanitizeAnthropicMessages } from "../transform/anthropic-format";
import type { ApiStream } from "../transform/stream";

interface ClineHandlerOptions extends CommonApiHandlerOptions {
	ulid?: string;
	taskId?: string;
	reasoningEffort?: string;
	thinkingBudgetTokens?: number;
	openRouterProviderSorting?: string;
	openRouterModelId?: string;
	openRouterModelInfo?: ModelInfo;
	clineAccountId?: string;
	geminiThinkingLevel?: string;
}

// Map OpenRouter model IDs to Anthropic native model IDs
const OPENROUTER_TO_ANTHROPIC: Record<string, string> = {
	"anthropic/claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
	"anthropic/claude-sonnet-4": "claude-sonnet-4-20250514",
	"anthropic/claude-opus-4": "claude-opus-4-20250514",
	"anthropic/claude-opus-4.1": "claude-opus-4-1-20250805",
	"anthropic/claude-haiku-3.5": "claude-3-5-haiku-20241022",
	"anthropic/claude-haiku-4.5": "claude-haiku-4-5-20251001",
	"anthropic/claude-3.7-sonnet": "claude-3-7-sonnet-20250219",
	"anthropic/claude-opus-4.5": "claude-opus-4-5-20251101",
};

export class ClineHandler implements ApiHandler {
	private options: ClineHandlerOptions;
	private _authService: AuthService;
	private readonly _baseUrl = AxolotlEnv.config().apiBaseUrl;

	constructor(options: ClineHandlerOptions) {
		this.options = options;
		this._authService = AuthService.getInstance();
	}

	@withRetry()
	async *createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: any[],
	): ApiStream {
		const authToken = await this._authService.getAuthToken();
		if (!authToken) {
			throw new Error(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE);
		}

		const model = this.getModel();
		const isMiniMax = model.id.startsWith("MiniMax");
		const modelId = model.id.endsWith(CLAUDE_SONNET_1M_SUFFIX)
			? model.id.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length)
			: model.id;

		// MiniMax doesn't support reasoning/thinking
		const budget_tokens = this.options.thinkingBudgetTokens || 0;
		const reasoningOn =
			!isMiniMax &&
			(model.info.supportsReasoning ?? false) &&
			budget_tokens !== 0;
		const nativeToolsOn = tools?.length && tools.length > 0;

		// Build Anthropic-format request body (both Anthropic and MiniMax use this format)
		let anthropicMessages = sanitizeAnthropicMessages(
			messages,
			model.info.supportsPromptCache ?? false,
		);

		// MiniMax doesn't support thinking blocks — filter them out
		if (isMiniMax) {
			anthropicMessages = this.filterThinkingBlocks(anthropicMessages);
		}

		const requestBody: Record<string, any> = {
			model: modelId,
			max_tokens: model.info.maxTokens || 8192,
			temperature: isMiniMax ? 1.0 : reasoningOn ? undefined : 0,
			system: model.info.supportsPromptCache
				? [
						{
							text: systemPrompt,
							type: "text",
							cache_control: { type: "ephemeral" },
						},
					]
				: [{ text: systemPrompt, type: "text" }],
			messages: anthropicMessages,
			stream: true,
		};

		if (nativeToolsOn) {
			requestBody.tools = tools!.map((t: any) => {
				if (t.function) {
					return {
						name: t.function.name,
						description: t.function.description,
						input_schema: t.function.parameters,
					};
				}
				return t;
			});
			if (!reasoningOn) {
				requestBody.tool_choice = { type: "any" };
			}
		}

		if (reasoningOn) {
			requestBody.thinking = { type: "enabled", budget_tokens };
		}

		// Send to InsForge proxy
		const response = await fetch(`${this._baseUrl}/functions/anthropic-proxy`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authToken}`,
				"X-Task-ID": this.options.ulid || "",
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errText = await response.text();
			if (response.status === 402) {
				throw new Error(
					"Insufficient credits. Please add credits to your Axolotl account to continue.",
				);
			}
			throw new Error(`Axolotl API Error ${response.status}: ${errText}`);
		}

		// Parse Anthropic SSE stream
		yield* this.parseAnthropicSSE(response.body!);
	}

	private async *parseAnthropicSSE(
		body: ReadableStream<Uint8Array>,
	): ApiStream {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const lastToolCall = { id: "", name: "", arguments: "" };

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const dataStr = line.slice(6).trim();
					if (dataStr === "[DONE]") continue;

					let event: any;
					try {
						event = JSON.parse(dataStr);
					} catch {
						continue;
					}

					switch (event.type) {
						case "message_start": {
							const usage = event.message?.usage;
							if (usage) {
								yield {
									type: "usage",
									inputTokens: usage.input_tokens || 0,
									outputTokens: usage.output_tokens || 0,
									cacheWriteTokens:
										usage.cache_creation_input_tokens || undefined,
									cacheReadTokens: usage.cache_read_input_tokens || undefined,
								};
							}
							break;
						}

						case "message_delta": {
							if (event.usage) {
								yield {
									type: "usage",
									inputTokens: 0,
									outputTokens: event.usage.output_tokens || 0,
								};
							}
							break;
						}

						case "content_block_start": {
							const block = event.content_block;
							if (!block) break;

							switch (block.type) {
								case "thinking":
									yield {
										type: "reasoning",
										reasoning: block.thinking || "",
										signature: block.signature,
									};
									break;
								case "redacted_thinking":
									yield {
										type: "reasoning",
										reasoning: "[Redacted thinking block]",
										redacted_data: block.data,
									};
									break;
								case "tool_use":
									if (block.id && block.name) {
										lastToolCall.id = block.id;
										lastToolCall.name = block.name;
										lastToolCall.arguments = "";
									}
									break;
								case "text":
									if (event.index > 0) {
										yield { type: "text", text: "\n" };
									}
									if (block.text) {
										yield { type: "text", text: block.text };
									}
									break;
							}
							break;
						}

						case "content_block_delta": {
							const delta = event.delta;
							if (!delta) break;

							switch (delta.type) {
								case "thinking_delta":
									yield { type: "reasoning", reasoning: delta.thinking };
									break;
								case "signature_delta":
									if (delta.signature) {
										yield {
											type: "reasoning",
											reasoning: "",
											signature: delta.signature,
										};
									}
									break;
								case "text_delta":
									yield { type: "text", text: delta.text };
									break;
								case "input_json_delta":
									if (
										lastToolCall.id &&
										lastToolCall.name &&
										delta.partial_json
									) {
										yield {
											type: "tool_calls",
											tool_call: {
												...lastToolCall,
												function: {
													...lastToolCall,
													id: lastToolCall.id,
													name: lastToolCall.name,
													arguments: delta.partial_json,
												},
											},
										};
									}
									break;
							}
							break;
						}

						case "content_block_stop":
							lastToolCall.id = "";
							lastToolCall.name = "";
							lastToolCall.arguments = "";
							break;

						case "error": {
							const errMsg = event.error?.message || "Unknown Anthropic error";
							throw new Error(`Axolotl API Error: ${errMsg}`);
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const openRouterModelId = this.options.openRouterModelId;
		const openRouterModelInfo = this.options.openRouterModelInfo;

		if (openRouterModelId) {
			// Check if it's a MiniMax model
			if (openRouterModelId in minimaxModels) {
				return {
					id: openRouterModelId,
					info: minimaxModels[openRouterModelId as MinimaxModelId],
				};
			}

			// Try to map OpenRouter ID to Anthropic native ID
			const anthropicId = OPENROUTER_TO_ANTHROPIC[openRouterModelId];
			if (anthropicId && anthropicId in anthropicModels) {
				return {
					id: anthropicId,
					info: anthropicModels[anthropicId as AnthropicModelId],
				};
			}

			// If it's already an Anthropic native ID
			if (openRouterModelId in anthropicModels) {
				return {
					id: openRouterModelId,
					info: anthropicModels[openRouterModelId as AnthropicModelId],
				};
			}

			// Fallback with provided info
			if (openRouterModelInfo) {
				const nativeId =
					OPENROUTER_TO_ANTHROPIC[openRouterModelId] || openRouterModelId;
				return { id: nativeId, info: openRouterModelInfo };
			}
		}

		// Default to Anthropic default
		return {
			id: anthropicDefaultModelId,
			info: anthropicModels[anthropicDefaultModelId],
		};
	}

	/**
	 * Filter out thinking blocks from messages for MiniMax compatibility.
	 */
	private filterThinkingBlocks(
		messages: ClineStorageMessage[],
	): ClineStorageMessage[] {
		const plain = JSON.parse(JSON.stringify(messages)) as ClineStorageMessage[];
		return plain.map((message) => {
			if (
				typeof message.content === "string" ||
				!Array.isArray(message.content)
			) {
				return message;
			}
			const filtered = message.content
				.filter((block: any) => {
					const t = String(block?.type || "").toLowerCase();
					return (
						t !== "thinking" &&
						t !== "redacted_thinking" &&
						!("thinking" in (block || {}))
					);
				})
				.map((block: any) => {
					const t = String(block?.type || "").toLowerCase();
					if (t === "text") return { type: "text", text: block.text || "" };
					if (t === "tool_use")
						return {
							type: "tool_use",
							id: block.id,
							name: block.name,
							input: block.input,
						};
					if (t === "tool_result") {
						const r: any = {
							type: "tool_result",
							tool_use_id: block.tool_use_id,
						};
						if (block.content !== undefined) r.content = block.content;
						if (block.is_error !== undefined) r.is_error = block.is_error;
						return r;
					}
					if (t === "image") return { type: "image", source: block.source };
					const cleaned: any = { type: block.type };
					for (const key of Object.keys(block)) {
						if (!["signature", "thinking", "summary", "data"].includes(key))
							cleaned[key] = block[key];
					}
					return cleaned;
				});
			return {
				role: message.role,
				content: filtered.length > 0 ? filtered : [{ type: "text", text: "" }],
			};
		});
	}
}
