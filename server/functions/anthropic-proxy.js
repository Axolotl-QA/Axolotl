import { createClient } from "npm:@insforge/sdk";

export default async function (req) {
	const corsHeaders = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers":
			"Content-Type, Authorization, X-Task-ID, anthropic-version",
	};

	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders });
	}

	// 1. Extract & validate user token
	const authHeader = req.headers.get("Authorization");
	const userToken = authHeader?.replace("Bearer ", "") || null;
	if (!userToken) {
		return new Response(JSON.stringify({ error: "Missing authorization" }), {
			status: 401,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}

	// 2. Validate user via InsForge auth
	const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
	const sessionRes = await fetch(`${baseUrl}/api/auth/sessions/current`, {
		headers: { Authorization: `Bearer ${userToken}` },
	});
	if (!sessionRes.ok) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}
	const sessionData = await sessionRes.json();
	const userId = sessionData.user?.id;
	if (!userId) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}

	// 3. Admin client for DB operations
	const adminClient = createClient({
		baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
		anonKey: Deno.env.get("INSFORGE_API_KEY"),
	});

	// 4. Check credits
	const { data: creditRows } = await adminClient.database
		.from("user_credits")
		.select("balance_cents")
		.eq("user_id", userId)
		.limit(1);

	const balanceCents = creditRows?.[0]?.balance_cents ?? 0;
	if (balanceCents <= 0) {
		return new Response(
			JSON.stringify({
				type: "error",
				error: {
					type: "insufficient_credits",
					message: "Insufficient credits. Please add credits to continue.",
				},
			}),
			{
				status: 402,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			},
		);
	}

	// 5. Parse request body
	const body = await req.json();
	const taskId = req.headers.get("X-Task-ID") || "";
	const model = body.model || "claude-sonnet-4-5-20250929";
	const startTime = Date.now();

	// 6. Determine provider based on model name
	const isMiniMax = model.startsWith("MiniMax");

	// 7. Create pending log entry
	const logId = crypto.randomUUID();
	await adminClient.database.from("api_request_logs").insert([
		{
			id: logId,
			user_id: userId,
			task_id: taskId,
			model: model,
			request_body: {
				messages_count: body.messages?.length || 0,
				system_length:
					typeof body.system === "string"
						? body.system.length
						: JSON.stringify(body.system || "").length,
				tools_count: body.tools?.length || 0,
				max_tokens: body.max_tokens,
				stream: body.stream,
				provider: isMiniMax ? "minimax" : "anthropic",
			},
			tools_called: body.tools?.map((t) => t.name) || null,
			status: "pending",
			timestamp: new Date().toISOString(),
		},
	]);

	// 8. Get API key from secrets table
	const secretKey = isMiniMax ? "MINIMAX_API_KEY" : "ANTHROPIC_API_KEY";
	const { data: secretRow } = await adminClient.database
		.from("app_secrets")
		.select("value")
		.eq("key", secretKey)
		.limit(1);
	const apiKey = secretRow?.[0]?.value;
	if (!apiKey) {
		return new Response(
			JSON.stringify({
				type: "error",
				error: {
					type: "configuration_error",
					message: `${secretKey} not configured`,
				},
			}),
			{
				status: 500,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			},
		);
	}

	// 9. Build API request - both Anthropic and MiniMax use Anthropic Messages API format
	const apiUrl = isMiniMax
		? "https://api.minimax.io/anthropic/v1/messages"
		: "https://api.anthropic.com/v1/messages";

	const apiHeaders = {
		"Content-Type": "application/json",
		"x-api-key": apiKey,
		"anthropic-version": "2023-06-01",
	};

	const apiResponse = await fetch(apiUrl, {
		method: "POST",
		headers: apiHeaders,
		body: JSON.stringify(body),
	});

	if (!apiResponse.ok) {
		const errText = await apiResponse.text();
		await adminClient.database
			.from("api_request_logs")
			.update([
				{
					status: "error",
					error_message: errText.substring(0, 2000),
					duration_ms: Date.now() - startTime,
				},
			])
			.eq("id", logId);
		return new Response(errText, {
			status: apiResponse.status,
			headers: {
				...corsHeaders,
				"Content-Type":
					apiResponse.headers.get("Content-Type") || "application/json",
			},
		});
	}

	// 10. If not streaming, handle simple response
	if (!body.stream) {
		const responseData = await apiResponse.json();
		const inputTokens = responseData.usage?.input_tokens || 0;
		const outputTokens = responseData.usage?.output_tokens || 0;
		const cacheRead = responseData.usage?.cache_read_input_tokens || 0;
		const cacheWrite = responseData.usage?.cache_creation_input_tokens || 0;
		const costUsd = calculateCost(
			model,
			inputTokens,
			outputTokens,
			cacheRead,
			cacheWrite,
		);
		const creditsCents = Math.ceil(costUsd * 100);

		await adminClient.database
			.from("api_request_logs")
			.update([
				{
					status: "completed",
					input_tokens: inputTokens,
					output_tokens: outputTokens,
					cache_read_tokens: cacheRead,
					cache_write_tokens: cacheWrite,
					cost_usd: costUsd,
					credits_deducted: creditsCents,
					duration_ms: Date.now() - startTime,
					response_summary: {
						stop_reason: responseData.stop_reason,
						content_blocks: responseData.content?.length,
					},
				},
			])
			.eq("id", logId);

		if (creditsCents > 0) {
			try {
				await adminClient.database.rpc("deduct_credits", {
					p_user_id: userId,
					p_amount: creditsCents,
				});
			} catch {}
		}

		return new Response(JSON.stringify(responseData), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}

	// 11. Stream SSE response back while capturing usage
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();

	(async () => {
		let inputTokens = 0,
			outputTokens = 0,
			cacheRead = 0,
			cacheWrite = 0;
		const reader = apiResponse.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				await writer.write(value);

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						try {
							const data = JSON.parse(line.slice(6));
							if (data.type === "message_start" && data.message?.usage) {
								inputTokens = data.message.usage.input_tokens || 0;
								cacheRead = data.message.usage.cache_read_input_tokens || 0;
								cacheWrite =
									data.message.usage.cache_creation_input_tokens || 0;
							}
							if (data.type === "message_delta" && data.usage) {
								outputTokens = data.usage.output_tokens || outputTokens;
							}
						} catch {}
					}
				}
			}
		} catch (err) {
			await adminClient.database
				.from("api_request_logs")
				.update([
					{
						status: "error",
						error_message: (err.message || "").substring(0, 2000),
						duration_ms: Date.now() - startTime,
					},
				])
				.eq("id", logId);
		} finally {
			await writer.close();
			const costUsd = calculateCost(
				model,
				inputTokens,
				outputTokens,
				cacheRead,
				cacheWrite,
			);
			const creditsCents = Math.ceil(costUsd * 100);

			await adminClient.database
				.from("api_request_logs")
				.update([
					{
						status: "completed",
						input_tokens: inputTokens,
						output_tokens: outputTokens,
						cache_read_tokens: cacheRead,
						cache_write_tokens: cacheWrite,
						cost_usd: costUsd,
						credits_deducted: creditsCents,
						duration_ms: Date.now() - startTime,
					},
				])
				.eq("id", logId);

			if (creditsCents > 0) {
				try {
					await adminClient.database.rpc("deduct_credits", {
						p_user_id: userId,
						p_amount: creditsCents,
					});
				} catch {}
			}
		}
	})();

	return new Response(readable, {
		status: 200,
		headers: {
			...corsHeaders,
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

function calculateCost(
	model,
	inputTokens,
	outputTokens,
	cacheRead,
	cacheWrite,
) {
	const pricing = {
		// Anthropic
		"claude-sonnet-4-5-20250929": {
			input: 3.0,
			output: 15.0,
			cacheRead: 0.3,
			cacheWrite: 3.75,
		},
		"claude-sonnet-4-20250514": {
			input: 3.0,
			output: 15.0,
			cacheRead: 0.3,
			cacheWrite: 3.75,
		},
		"claude-haiku-3-5-20241022": {
			input: 0.8,
			output: 4.0,
			cacheRead: 0.08,
			cacheWrite: 1.0,
		},
		"claude-opus-4-20250514": {
			input: 15.0,
			output: 75.0,
			cacheRead: 1.5,
			cacheWrite: 18.75,
		},
		// MiniMax
		"MiniMax-M2.5": {
			input: 0.3,
			output: 1.1,
			cacheRead: 0.15,
			cacheWrite: 0.0375,
		},
		"MiniMax-M2.5-highspeed": {
			input: 0.3,
			output: 1.1,
			cacheRead: 0.15,
			cacheWrite: 0.0375,
		},
		"MiniMax-M2.1": {
			input: 0.3,
			output: 1.2,
			cacheRead: 0.03,
			cacheWrite: 0.0375,
		},
		"MiniMax-M2.1-lightning": {
			input: 0.3,
			output: 2.4,
			cacheRead: 0.03,
			cacheWrite: 0.0375,
		},
		"MiniMax-M2": { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
	};
	const p = pricing[model] || pricing["claude-sonnet-4-5-20250929"];
	return (
		(inputTokens * p.input) / 1_000_000 +
		(outputTokens * p.output) / 1_000_000 +
		(cacheRead * p.cacheRead) / 1_000_000 +
		(cacheWrite * p.cacheWrite) / 1_000_000
	);
}
