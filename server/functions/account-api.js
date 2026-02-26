import { createClient } from "npm:@insforge/sdk";

export default async function (req) {
	const corsHeaders = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	};

	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders });
	}

	const authHeader = req.headers.get("Authorization");
	const userToken = authHeader?.replace("Bearer ", "") || null;
	if (!userToken) {
		return new Response(JSON.stringify({ error: "Missing authorization" }), {
			status: 401,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}

	// Validate user
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

	const adminClient = createClient({
		baseUrl,
		anonKey: Deno.env.get("INSFORGE_API_KEY"),
	});

	const body = await req.json().catch(() => ({}));
	const action = body.action || "balance";

	if (action === "balance") {
		const { data } = await adminClient.database
			.from("user_credits")
			.select("balance_cents")
			.eq("user_id", userId)
			.limit(1);
		const balanceCents = data?.[0]?.balance_cents ?? 0;
		return new Response(
			JSON.stringify({
				success: true,
				data: { balance: balanceCents, userId },
				usageTransactions: [],
				paymentTransactions: [],
			}),
			{
				status: 200,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			},
		);
	}

	if (action === "usages") {
		const { data } = await adminClient.database
			.from("api_request_logs")
			.select("*")
			.eq("user_id", userId)
			.order("timestamp", { ascending: false })
			.limit(50);
		const items = (data || []).map((row) => ({
			id: row.id,
			generationId: row.id,
			userId: row.user_id,
			aiModelName: row.model,
			aiInferenceProviderName: "Anthropic",
			aiModelTypeName: "chat",
			promptTokens: row.input_tokens || 0,
			completionTokens: row.output_tokens || 0,
			totalTokens: (row.input_tokens || 0) + (row.output_tokens || 0),
			costUsd: parseFloat(row.cost_usd || 0),
			creditsUsed: row.credits_deducted || 0,
			createdAt: row.timestamp,
			organizationId: "",
			metadata: {},
		}));
		return new Response(JSON.stringify({ success: true, data: { items } }), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}

	if (action === "payments") {
		return new Response(
			JSON.stringify({ success: true, data: { paymentTransactions: [] } }),
			{
				status: 200,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			},
		);
	}

	return new Response(JSON.stringify({ error: "Unknown action" }), {
		status: 400,
		headers: { ...corsHeaders, "Content-Type": "application/json" },
	});
}
