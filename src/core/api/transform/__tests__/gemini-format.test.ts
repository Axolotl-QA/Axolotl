import { describe, it } from "mocha";
import "should";
import { convertAnthropicContentToGemini } from "../gemini-format";

describe("convertAnthropicContentToGemini", () => {
	describe("string content", () => {
		it("converts a plain string to a single text Part", () => {
			const result = convertAnthropicContentToGemini("hello world");
			result.should.deepEqual([{ text: "hello world" }]);
		});

		it("converts an empty string to a single text Part", () => {
			const result = convertAnthropicContentToGemini("");
			result.should.deepEqual([{ text: "" }]);
		});
	});

	describe("text blocks", () => {
		it("converts a text block to a text Part", () => {
			const result = convertAnthropicContentToGemini([
				{ type: "text" as const, text: "some text" },
			]);
			result.should.have.length(1);
			result[0].should.have.property("text", "some text");
		});

		it("preserves thought signature on text blocks", () => {
			const result = convertAnthropicContentToGemini([
				{ type: "text" as const, text: "thought", signature: "sig-abc" } as any,
			]);
			result.should.have.length(1);
			result[0].should.have.property("text", "thought");
			result[0].should.have.property("thoughtSignature", "sig-abc");
		});
	});

	describe("image blocks", () => {
		it("converts a base64 image block to an inlineData Part", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "image" as const,
					source: {
						type: "base64" as const,
						media_type: "image/png" as const,
						data: "iVBORw0KGgo=",
					},
				},
			]);
			result.should.have.length(1);
			result[0].should.have.property("inlineData");
			result[0].inlineData!.should.deepEqual({
				data: "iVBORw0KGgo=",
				mimeType: "image/png",
			});
		});

		it("throws for unsupported image source type", () => {
			(() => {
				convertAnthropicContentToGemini([
					{
						type: "image" as const,
						source: {
							type: "url" as any,
							media_type: "image/png" as const,
							data: "http://example.com/img.png",
						},
					},
				]);
			}).should.throw("Unsupported image source type");
		});
	});

	describe("tool_use blocks", () => {
		it("converts a tool_use block to a functionCall Part", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_use" as const,
					id: "tu-001",
					name: "read_file",
					input: { path: "/tmp/test.txt" },
				},
			]);
			result.should.have.length(1);
			result[0].should.have.property("functionCall");
			result[0].functionCall!.should.have.property("name", "read_file");
			result[0].functionCall!.args!.should.deepEqual({ path: "/tmp/test.txt" });
		});

		it("uses dummy thought signature when none is provided", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_use" as const,
					id: "tu-002",
					name: "write_file",
					input: {},
				},
			]);
			result[0].should.have.property(
				"thoughtSignature",
				"skip_thought_signature_validator",
			);
		});

		it("preserves existing thought signature", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_use" as const,
					id: "tu-003",
					name: "write_file",
					input: {},
					signature: "real-signature-123",
				} as any,
			]);
			result[0].should.have.property("thoughtSignature", "real-signature-123");
		});
	});

	describe("tool_result blocks", () => {
		it("converts tool_result with string content", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-123",
					content: "success",
				},
			]);
			result.should.have.length(1);
			result[0].should.have.property("functionResponse");
			result[0].functionResponse!.should.deepEqual({
				name: "test-123",
				response: { result: "success" },
			});
		});

		it("converts tool_result with text-only array content", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-456",
					content: [
						{ type: "text", text: "line one" },
						{ type: "text", text: "line two" },
					],
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			fr.should.have.property("name", "test-456");
			fr.response!.should.have.property("result", "line one\nline two");
			// No parts field when there are no images
			fr.should.not.have.property("parts");
		});

		it("converts tool_result with image content to FunctionResponse with parts", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-789",
					content: [
						{ type: "text", text: "screenshot taken" },
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "aW1hZ2VkYXRh",
							},
						},
					],
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			fr.should.have.property("name", "test-789");
			fr.response!.should.have.property("result", "screenshot taken");
			fr.should.have.property("parts");
			(fr as any).parts.should.have.length(1);
			(fr as any).parts[0].should.deepEqual({
				inlineData: {
					data: "aW1hZ2VkYXRh",
					mimeType: "image/png",
				},
			});
		});

		it("handles multiple images in tool_result", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-multi",
					content: [
						{ type: "text", text: "two screenshots" },
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "img1data",
							},
						},
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/jpeg",
								data: "img2data",
							},
						},
					],
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			fr.should.have.property("name", "test-multi");
			fr.response!.should.have.property("result", "two screenshots");
			(fr as any).parts.should.have.length(2);
			(fr as any).parts[0].inlineData.should.deepEqual({
				data: "img1data",
				mimeType: "image/png",
			});
			(fr as any).parts[1].inlineData.should.deepEqual({
				data: "img2data",
				mimeType: "image/jpeg",
			});
		});

		it("JSON-stringifies unknown content types in array", () => {
			const unknownItem = { type: "video", url: "http://example.com/vid.mp4" };
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-unknown",
					content: [unknownItem] as any,
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			fr.should.have.property("name", "test-unknown");
			fr.response!.should.have.property("result", JSON.stringify(unknownItem));
			fr.should.not.have.property("parts");
		});

		it("handles mixed text, images, and unknown types in array", () => {
			const unknownItem = { type: "audio", data: "beep" };
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-mixed",
					content: [
						{ type: "text", text: "caption" },
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/gif",
								data: "gifdata",
							},
						},
						unknownItem,
					] as any,
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			fr.response!.should.have.property(
				"result",
				"caption\n" + JSON.stringify(unknownItem),
			);
			(fr as any).parts.should.have.length(1);
			(fr as any).parts[0].inlineData.should.deepEqual({
				data: "gifdata",
				mimeType: "image/gif",
			});
		});

		it("handles undefined content gracefully (fallback path)", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-undef",
					content: undefined as any,
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			fr.should.have.property("name", "test-undef");
			fr.response!.should.have.property("result", undefined);
		});

		it("handles empty array content", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-empty-arr",
					content: [] as any,
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			fr.should.have.property("name", "test-empty-arr");
			fr.response!.should.have.property("result", "");
			fr.should.not.have.property("parts");
		});

		it("handles empty string content", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-empty-str",
					content: "",
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			fr.should.have.property("name", "test-empty-str");
			fr.response!.should.have.property("result", "");
		});

		it("ignores non-base64 image sources in array content", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "tool_result" as const,
					tool_use_id: "test-non-b64",
					content: [
						{ type: "text", text: "has image" },
						{
							type: "image",
							source: {
								type: "url",
								media_type: "image/png",
								data: "http://example.com/img.png",
							},
						},
					] as any,
				},
			]);
			result.should.have.length(1);
			const fr = result[0].functionResponse!;
			// The non-base64 image should fall through to JSON.stringify
			(fr.response as any).result.should.containEql("has image");
			fr.should.not.have.property("parts");
		});
	});

	describe("thinking blocks", () => {
		it("converts a thinking block to a thought Part", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "thinking" as const,
					thinking: "Let me think about this...",
					signature: "sig-think-001",
				},
			]);
			result.should.have.length(1);
			result[0].should.have.property("text", "Let me think about this...");
			result[0].should.have.property("thought", true);
			result[0].should.have.property("thoughtSignature", "sig-think-001");
		});

		it("uses dummy thought signature when none is provided on thinking block", () => {
			const result = convertAnthropicContentToGemini([
				{
					type: "thinking" as const,
					thinking: "hmm...",
					signature: "",
				},
			]);
			result[0].should.have.property(
				"thoughtSignature",
				"skip_thought_signature_validator",
			);
		});
	});

	describe("unsupported and mixed blocks", () => {
		it("filters out unsupported block types", () => {
			const result = convertAnthropicContentToGemini([
				{ type: "unknown_type" as any, data: "something" } as any,
			]);
			result.should.have.length(0);
		});

		it("handles a mix of supported and unsupported blocks", () => {
			const result = convertAnthropicContentToGemini([
				{ type: "text" as const, text: "hello" },
				{ type: "unknown_type" as any } as any,
				{ type: "text" as const, text: "world" },
			]);
			result.should.have.length(2);
			result[0].should.have.property("text", "hello");
			result[1].should.have.property("text", "world");
		});

		it("handles multiple block types in one array", () => {
			const result = convertAnthropicContentToGemini([
				{ type: "text" as const, text: "intro" },
				{
					type: "tool_use" as const,
					id: "tu-100",
					name: "search",
					input: { query: "test" },
				},
				{
					type: "tool_result" as const,
					tool_use_id: "tu-100",
					content: "found 3 results",
				},
				{
					type: "image" as const,
					source: {
						type: "base64" as const,
						media_type: "image/png" as const,
						data: "abc123",
					},
				},
			]);
			result.should.have.length(4);
			result[0].should.have.property("text", "intro");
			result[1].should.have.property("functionCall");
			result[2].should.have.property("functionResponse");
			result[3].should.have.property("inlineData");
		});
	});
});
