import { Anthropic } from "@anthropic-ai/sdk"
import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { MinimaxModelId, ModelInfo, minimaxDefaultModelId, minimaxModels } from "@/shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ClineTool } from "@/shared/tools"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"

interface MinimaxHandlerOptions extends CommonApiHandlerOptions {
	minimaxApiKey?: string
	minimaxApiLine?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

export class MinimaxHandler implements ApiHandler {
	private options: MinimaxHandlerOptions
	private client: Anthropic | undefined

	constructor(options: MinimaxHandlerOptions) {
		this.options = options
	}

	private ensureClient(): Anthropic {
		if (!this.client) {
			if (!this.options.minimaxApiKey) {
				throw new Error("MiniMax API key is required")
			}
			try {
				this.client = new Anthropic({
					apiKey: this.options.minimaxApiKey,
					baseURL:
						this.options.minimaxApiLine === "china"
							? "https://api.minimaxi.com/anthropic"
							: "https://api.minimax.io/anthropic",
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating MiniMax client: ${error.message}`)
			}
		}
		return this.client
	}

	/**
	 * Filter out thinking blocks from messages before sending to MiniMax.
	 * MiniMax doesn't support Anthropic's thinking/signature blocks and will error if they're present.
	 * Uses JSON serialization to ensure completely clean objects with no hidden properties.
	 */
	private filterThinkingBlocks(messages: ClineStorageMessage[]): ClineStorageMessage[] {
		// Use JSON parse/stringify to create completely plain objects
		const plainMessages = JSON.parse(JSON.stringify(messages)) as ClineStorageMessage[]

		return plainMessages.map((message) => {
			if (typeof message.content === "string") {
				return { role: message.role, content: message.content }
			}

			// Ensure content is an array before filtering
			if (!Array.isArray(message.content)) {
				return { role: message.role, content: message.content }
			}

			// Filter out thinking and redacted_thinking blocks from content array
			const filteredContent = message.content.filter((block: any) => {
				if (!block || typeof block !== "object") {
					return true // Keep primitives
				}

				const blockType = String(block.type || "").toLowerCase().trim()

				// Remove blocks with thinking-related types
				if (blockType === "thinking" || blockType === "redacted_thinking") {
					return false
				}

				// Remove blocks that have a 'thinking' property (these are thinking blocks)
				if ("thinking" in block) {
					return false
				}

				return true
			})

			// Create completely clean blocks with only the required fields
			const cleanedContent = filteredContent.map((block: any) => {
				if (!block || typeof block !== "object") {
					return block
				}

				// Only keep essential fields based on block type
				const blockType = String(block.type || "").toLowerCase().trim()

				if (blockType === "text") {
					return { type: "text", text: block.text || "" }
				} else if (blockType === "tool_use") {
					return { type: "tool_use", id: block.id, name: block.name, input: block.input }
				} else if (blockType === "tool_result") {
					const result: any = { type: "tool_result", tool_use_id: block.tool_use_id }
					if (block.content !== undefined) {
						result.content = block.content
					}
					if (block.is_error !== undefined) {
						result.is_error = block.is_error
					}
					return result
				} else if (blockType === "image") {
					return { type: "image", source: block.source }
				} else {
					// For unknown types, strip known problematic fields
					const cleaned: any = { type: block.type }
					for (const key of Object.keys(block)) {
						if (!["signature", "thinking", "summary", "call_id", "data"].includes(key)) {
							cleaned[key] = block[key]
						}
					}
					return cleaned
				}
			})

			return {
				role: message.role,
				content: cleanedContent.length > 0 ? cleanedContent : [{ type: "text", text: "" }],
			}
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ClineTool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		// Debug: Log incoming messages to see what's being passed
		console.log("[minimax] Incoming messages count:", messages.length)
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i]
			if (Array.isArray(msg.content)) {
				console.log(`[minimax] Message ${i} (${msg.role}): ${msg.content.length} blocks`)
				msg.content.forEach((block: any, j: number) => {
					console.log(`[minimax]   Block ${j}: type=${block?.type}, hasThinking=${"thinking" in (block || {})}, hasSignature=${"signature" in (block || {})}`)
				})
			} else {
				console.log(`[minimax] Message ${i} (${msg.role}): string content`)
			}
		}

		// Filter out thinking blocks that MiniMax doesn't support
		const filteredMessages = this.filterThinkingBlocks(messages)

		// Debug: Log filtered messages
		console.log("[minimax] Filtered messages count:", filteredMessages.length)
		for (let i = 0; i < filteredMessages.length; i++) {
			const msg = filteredMessages[i]
			if (Array.isArray(msg.content)) {
				console.log(`[minimax] Filtered Message ${i} (${msg.role}): ${msg.content.length} blocks`)
				msg.content.forEach((block: any, j: number) => {
					console.log(`[minimax]   Block ${j}: type=${block?.type}, hasThinking=${"thinking" in (block || {})}, hasSignature=${"signature" in (block || {})}`)
				})
			} else {
				console.log(`[minimax] Filtered Message ${i} (${msg.role}): string content`)
			}
		}

		// Tools are available only when native tools are enabled
		const nativeToolsOn = tools?.length && tools?.length > 0

		// MiniMax M2 uses Anthropic API format
		// Note: According to MiniMax docs, some Anthropic parameters like 'thinking' are ignored
		// but we'll include the standard Anthropic streaming pattern for consistency
		const stream: AnthropicStream<Anthropic.RawMessageStreamEvent> = await client.messages.create({
			model: model.id,
			max_tokens: model.info.maxTokens || 8192,
			temperature: 1.0, // MiniMax recommends 1.0, range is (0.0, 1.0]
			system: [{ text: systemPrompt, type: "text" }],
			messages: filteredMessages,
			stream: true,
			tools: nativeToolsOn ? (tools as AnthropicTool[]) : undefined,
			tool_choice: nativeToolsOn ? { type: "any" } : undefined,
		})

		const lastStartedToolCall = { id: "", name: "", arguments: "" }

		for await (const chunk of stream) {
			switch (chunk?.type) {
				case "message_start": {
					// tells us cache reads/writes/input/output
					const usage = chunk.message.usage
					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
						cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
						cacheReadTokens: usage.cache_read_input_tokens || undefined,
					}
					break
				}
				case "message_delta":
					// tells us stop_reason, stop_sequence, and output tokens along the way and at the end of the message
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}
					break
				case "message_stop":
					// no usage data, just an indicator that the message is done
					break
				case "content_block_start":
					switch (chunk.content_block.type) {
						case "thinking":
							yield {
								type: "reasoning",
								reasoning: chunk.content_block.thinking || "",
							}
							if (chunk.content_block.thinking && chunk.content_block.signature) {
								yield {
									type: "reasoning",
									reasoning: chunk.content_block.thinking,
									signature: chunk.content_block.signature,
								}
							}
							break
						case "redacted_thinking":
							// Content is encrypted, and we don't want to pass placeholder text back to the API
							yield {
								type: "reasoning",
								reasoning: "[Redacted thinking block]",
								redacted_data: chunk.content_block.data,
							}
							break
						case "tool_use":
							if (chunk.content_block.id && chunk.content_block.name) {
								// Store tool call information for streaming
								lastStartedToolCall.id = chunk.content_block.id
								lastStartedToolCall.name = chunk.content_block.name
								lastStartedToolCall.arguments = ""
							}
							break
						case "text":
							// we may receive multiple text blocks, in which case just insert a line break between them
							if (chunk.index > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							yield {
								type: "text",
								text: chunk.content_block.text,
							}
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "thinking_delta":
							// 'reasoning' type just displays in the UI, but reasoning with signature will be used to send the thinking traces back to the API
							yield {
								type: "reasoning",
								reasoning: chunk.delta.thinking,
							}
							break
						case "signature_delta":
							// It's used when sending the thinking block back to the API
							// API expects this in completed form, not as array of deltas
							if (chunk.delta.signature) {
								yield {
									type: "reasoning",
									reasoning: "",
									signature: chunk.delta.signature,
								}
							}
							break
						case "text_delta":
							yield {
								type: "text",
								text: chunk.delta.text,
							}
							break
						case "input_json_delta":
							if (lastStartedToolCall.id && lastStartedToolCall.name && chunk.delta.partial_json) {
								// Convert Anthropic tool_use to OpenAI-compatible format for internal processing
								yield {
									type: "tool_calls",
									tool_call: {
										...lastStartedToolCall,
										function: {
											...lastStartedToolCall,
											id: lastStartedToolCall.id,
											name: lastStartedToolCall.name,
											arguments: chunk.delta.partial_json,
										},
									},
								}
							}
							break
					}
					break

				case "content_block_stop":
					lastStartedToolCall.id = ""
					lastStartedToolCall.name = ""
					lastStartedToolCall.arguments = ""
					break
			}
		}
	}

	getModel(): { id: MinimaxModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId && modelId in minimaxModels) {
			const id = modelId as MinimaxModelId
			return { id, info: minimaxModels[id] }
		}
		return { id: minimaxDefaultModelId, info: minimaxModels[minimaxDefaultModelId] }
	}
}
