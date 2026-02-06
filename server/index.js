import Fastify from "fastify"
import cors from "@fastify/cors"
import { createClient } from "@supabase/supabase-js"
import crypto from "node:crypto"

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  APP_BASE_URL,
  API_BASE_URL,
  CORS_ORIGIN,
  PORT = "8080",
} = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY")
}
if (!APP_BASE_URL) {
  throw new Error("Missing APP_BASE_URL")
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

const fastify = Fastify({ logger: true })

await fastify.register(cors, {
  origin: CORS_ORIGIN ? CORS_ORIGIN.split(",") : true,
  credentials: true,
})

const base64Url = (buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")

const hash = (value) =>
  crypto.createHash("sha256").update(value).digest("hex")

const addQuery = (url, params) => {
  const next = new URL(url)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      next.searchParams.set(key, value)
    }
  })
  return next.toString()
}

const jwtExpToIso = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"))
    if (payload?.exp) {
      return new Date(payload.exp * 1000).toISOString()
    }
  } catch (_e) {
    // ignore
  }
  return new Date(Date.now() + 15 * 60 * 1000).toISOString()
}

fastify.get("/health", async () => ({ ok: true }))

// Step 1: request auth URL
fastify.get("/v1/auth/authorize", async (request, reply) => {
  const { redirect_uri, state, code_challenge } = request.query
  if (!redirect_uri || !state || !code_challenge) {
    return reply.code(400).send({ error: "Missing redirect_uri/state/code_challenge" })
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const { error } = await admin.from("auth_requests").upsert({
    state,
    redirect_uri,
    code_challenge,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  })

  if (error) {
    request.log.error(error, "Failed to store auth request")
    return reply.code(500).send({ error: "Failed to store auth request" })
  }

  const redirectUrl = addQuery(`${APP_BASE_URL}/login.html`, { state })
  return reply.send({ redirect_url: redirectUrl })
})

// Step 2: login page posts supabase token and state
fastify.post("/v1/auth/code", async (request, reply) => {
  const { state, supabaseAccessToken, supabaseRefreshToken } = request.body || {}
  if (!state || !supabaseAccessToken) {
    return reply.code(400).send({ error: "Missing state or supabaseAccessToken" })
  }

  const { data: authRequest, error: authReqError } = await admin
    .from("auth_requests")
    .select("state, redirect_uri, code_challenge, expires_at")
    .eq("state", state)
    .maybeSingle()

  if (authReqError || !authRequest) {
    return reply.code(400).send({ error: "Invalid or expired state" })
  }
  if (new Date(authRequest.expires_at).getTime() < Date.now()) {
    return reply.code(400).send({ error: "State expired" })
  }

  const { data: userData, error: userError } = await admin.auth.getUser(supabaseAccessToken)
  if (userError || !userData?.user) {
    return reply.code(401).send({ error: "Invalid Supabase access token" })
  }

  const code = base64Url(crypto.randomBytes(32))
  const codeHash = hash(code)
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString()

  const { error: codeError } = await admin.from("auth_codes").insert({
    code_hash: codeHash,
    user_id: userData.user.id,
    state,
    access_token: supabaseAccessToken,
    refresh_token: supabaseRefreshToken || null,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  })

  if (codeError) {
    request.log.error(codeError, "Failed to store auth code")
    return reply.code(500).send({ error: "Failed to store auth code" })
  }

  const redirectUrl = addQuery(authRequest.redirect_uri, { code, state })
  return reply.send({ redirect_url: redirectUrl })
})

// Step 3: extension exchanges code for tokens
fastify.post("/v1/auth/token", async (request, reply) => {
  const { code, code_verifier, redirect_uri } = request.body || {}
  if (!code || !code_verifier || !redirect_uri) {
    return reply.code(400).send({ error: "Missing code/code_verifier/redirect_uri" })
  }

  const codeHash = hash(code)
  const { data: codeRow, error: codeError } = await admin
    .from("auth_codes")
    .select("code_hash, user_id, state, access_token, refresh_token, expires_at, used_at")
    .eq("code_hash", codeHash)
    .maybeSingle()

  if (codeError || !codeRow) {
    return reply.code(400).send({ error: "Invalid code" })
  }
  if (codeRow.used_at) {
    return reply.code(400).send({ error: "Code already used" })
  }
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    return reply.code(400).send({ error: "Code expired" })
  }

  const { data: authRequest, error: authReqError } = await admin
    .from("auth_requests")
    .select("state, redirect_uri, code_challenge")
    .eq("state", codeRow.state)
    .maybeSingle()

  if (authReqError || !authRequest) {
    return reply.code(400).send({ error: "Invalid auth request" })
  }
  if (authRequest.redirect_uri !== redirect_uri) {
    return reply.code(400).send({ error: "redirect_uri mismatch" })
  }

  const challenge = base64Url(crypto.createHash("sha256").update(code_verifier).digest())
  if (challenge !== authRequest.code_challenge) {
    return reply.code(400).send({ error: "PKCE verification failed" })
  }

  await admin.from("auth_codes").update({ used_at: new Date().toISOString() }).eq("code_hash", codeHash)

  const accessToken = codeRow.access_token
  const refreshToken = codeRow.refresh_token

  const { data: userData } = await admin.auth.getUser(accessToken)
  const user = userData?.user
  const expiresAt = jwtExpToIso(accessToken)

  return reply.send({
    success: true,
    data: {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresAt,
      userInfo: {
        subject: null,
        email: user?.email || "",
        name: user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || "",
        clineUserId: user?.id || codeRow.user_id,
        accounts: null,
      },
    },
  })
})

fastify.post("/v1/auth/refresh", async (request, reply) => {
  const { refreshToken } = request.body || {}
  if (!refreshToken) {
    return reply.code(400).send({ error: "Missing refreshToken" })
  }

  const { data, error } = await supabasePublic.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data?.session) {
    return reply.code(401).send({ error: error?.message || "Failed to refresh session" })
  }

  const session = data.session
  const expiresAt = jwtExpToIso(session.access_token)

  return reply.send({
    success: true,
    data: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      tokenType: "Bearer",
      expiresAt,
      userInfo: {
        subject: null,
        email: session.user.email || "",
        name:
          session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name ||
          session.user.email ||
          "",
        clineUserId: session.user.id,
        accounts: null,
      },
    },
  })
})

fastify.get("/v1/me", async (request, reply) => {
  const authHeader = request.headers.authorization || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null
  if (!token) {
    return reply.code(401).send({ error: "Missing access token" })
  }

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) {
    return reply.code(401).send({ error: "Invalid token" })
  }

  return reply.send({
    data: {
      id: data.user.id,
      email: data.user.email,
      displayName: data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email || "",
      createdAt: data.user.created_at,
      organizations: [],
    },
  })
})

fastify.listen({ port: Number(PORT), host: "0.0.0.0" })
