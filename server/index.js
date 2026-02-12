import Fastify from "fastify"
import cors from "@fastify/cors"
import crypto from "node:crypto"

const {
  INSFORGE_BASE_URL,
  INSFORGE_API_KEY,
  INSFORGE_ANON_KEY,
  APP_BASE_URL,
  CORS_ORIGIN,
  PORT = "8080",
} = process.env

if (!INSFORGE_BASE_URL || !INSFORGE_API_KEY) {
  throw new Error("Missing INSFORGE_BASE_URL / INSFORGE_API_KEY")
}
if (!APP_BASE_URL) {
  throw new Error("Missing APP_BASE_URL")
}

const fastify = Fastify({ logger: true })

await fastify.register(cors, {
  origin: CORS_ORIGIN ? CORS_ORIGIN.split(",") : true,
  credentials: true,
})

// ── Helpers ──

const base64Url = (buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")

const hashSha256 = (value) =>
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

// ── InsForge API helpers ──

async function insforgeDbQuery(table, filters) {
  const params = new URLSearchParams(filters)
  const res = await fetch(`${INSFORGE_BASE_URL}/api/database/records/${table}?${params}`, {
    headers: { Authorization: `Bearer ${INSFORGE_API_KEY}` },
  })
  if (!res.ok) return { data: null, error: await res.json().catch(() => ({ message: "DB query failed" })) }
  const data = await res.json()
  return { data, error: null }
}

async function insforgeDbInsert(table, records) {
  const res = await fetch(`${INSFORGE_BASE_URL}/api/database/records/${table}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INSFORGE_API_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(Array.isArray(records) ? records : [records]),
  })
  if (!res.ok) return { data: null, error: await res.json().catch(() => ({ message: "DB insert failed" })) }
  const data = await res.json()
  return { data, error: null }
}

async function insforgeDbUpsert(table, records) {
  const res = await fetch(`${INSFORGE_BASE_URL}/api/database/records/${table}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INSFORGE_API_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(Array.isArray(records) ? records : [records]),
  })
  if (!res.ok) return { data: null, error: await res.json().catch(() => ({ message: "DB upsert failed" })) }
  const data = await res.json()
  return { data, error: null }
}

async function insforgeDbUpdate(table, filters, updates) {
  const params = new URLSearchParams(filters)
  const res = await fetch(`${INSFORGE_BASE_URL}/api/database/records/${table}?${params}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${INSFORGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  })
  if (!res.ok) return { error: await res.json().catch(() => ({ message: "DB update failed" })) }
  return { error: null }
}

async function insforgeGetUser(accessToken) {
  const res = await fetch(`${INSFORGE_BASE_URL}/api/auth/sessions/current`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return { user: null, error: await res.json().catch(() => ({ message: "Invalid token" })) }
  const data = await res.json()
  return { user: data.user, error: null }
}

async function insforgeGetProfile(userId) {
  const res = await fetch(`${INSFORGE_BASE_URL}/api/auth/profiles/${userId}`, {
    headers: { Authorization: `Bearer ${INSFORGE_API_KEY}` },
  })
  if (!res.ok) return { profile: null }
  const data = await res.json()
  return { profile: data }
}

// ── Routes ──

fastify.get("/health", async () => ({ ok: true }))

// Public config endpoint
fastify.get("/v1/config", async () => ({
  insforgeBaseUrl: INSFORGE_BASE_URL,
  insforgeAnonKey: INSFORGE_ANON_KEY || "",
}))

// Step 1: request auth URL
fastify.get("/v1/auth/authorize", async (request, reply) => {
  const { redirect_uri, state, code_challenge } = request.query
  if (!redirect_uri || !state || !code_challenge) {
    return reply.code(400).send({ error: "Missing redirect_uri/state/code_challenge" })
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const { error } = await insforgeDbUpsert("auth_requests", {
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

// Step 2: login page posts InsForge token and state
fastify.post("/v1/auth/code", async (request, reply) => {
  const { state, accessToken, refreshToken } = request.body || {}
  if (!state || !accessToken) {
    return reply.code(400).send({ error: "Missing state or accessToken" })
  }

  // Look up the auth request
  const { data: authRequests, error: authReqError } = await insforgeDbQuery("auth_requests", {
    state: `eq.${state}`,
    select: "state,redirect_uri,code_challenge,expires_at",
    limit: "1",
  })

  const authRequest = authRequests?.[0]
  if (authReqError || !authRequest) {
    return reply.code(400).send({ error: "Invalid or expired state" })
  }
  if (new Date(authRequest.expires_at).getTime() < Date.now()) {
    return reply.code(400).send({ error: "State expired" })
  }

  // Validate the InsForge access token
  const { user, error: userError } = await insforgeGetUser(accessToken)
  if (userError || !user) {
    return reply.code(401).send({ error: "Invalid access token" })
  }

  // Create one-time authorization code
  const code = base64Url(crypto.randomBytes(32))
  const codeHash = hashSha256(code)
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString()

  const { error: codeError } = await insforgeDbInsert("auth_codes", {
    code_hash: codeHash,
    user_id: user.id,
    state,
    access_token: accessToken,
    refresh_token: refreshToken || null,
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

  const codeHash = hashSha256(code)
  const { data: codeRows, error: codeError } = await insforgeDbQuery("auth_codes", {
    code_hash: `eq.${codeHash}`,
    select: "code_hash,user_id,state,access_token,refresh_token,expires_at,used_at",
    limit: "1",
  })

  const codeRow = codeRows?.[0]
  if (codeError || !codeRow) {
    return reply.code(400).send({ error: "Invalid code" })
  }
  if (codeRow.used_at) {
    return reply.code(400).send({ error: "Code already used" })
  }
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    return reply.code(400).send({ error: "Code expired" })
  }

  // Look up original auth request for PKCE verification
  const { data: authRequests, error: authReqError } = await insforgeDbQuery("auth_requests", {
    state: `eq.${codeRow.state}`,
    select: "state,redirect_uri,code_challenge",
    limit: "1",
  })

  const authRequest = authRequests?.[0]
  if (authReqError || !authRequest) {
    return reply.code(400).send({ error: "Invalid auth request" })
  }
  if (authRequest.redirect_uri !== redirect_uri) {
    return reply.code(400).send({ error: "redirect_uri mismatch" })
  }

  // PKCE verification
  const challenge = base64Url(crypto.createHash("sha256").update(code_verifier).digest())
  if (challenge !== authRequest.code_challenge) {
    return reply.code(400).send({ error: "PKCE verification failed" })
  }

  // Mark code as used
  await insforgeDbUpdate("auth_codes", { code_hash: `eq.${codeHash}` }, { used_at: new Date().toISOString() })

  const accessToken = codeRow.access_token
  const refreshToken = codeRow.refresh_token

  // Get user info from InsForge
  const { user } = await insforgeGetUser(accessToken)
  const expiresAt = jwtExpToIso(accessToken)

  // Get user profile for display name
  let displayName = user?.email || ""
  if (user?.id) {
    const { profile } = await insforgeGetProfile(user.id)
    if (profile?.name) displayName = profile.name
  }

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
        name: displayName,
        clineUserId: user?.id || codeRow.user_id,
        accounts: null,
      },
    },
  })
})

// Refresh tokens
fastify.post("/v1/auth/refresh", async (request, reply) => {
  const { refreshToken } = request.body || {}
  if (!refreshToken) {
    return reply.code(400).send({ error: "Missing refreshToken" })
  }

  const res = await fetch(`${INSFORGE_BASE_URL}/api/auth/refresh?client_type=desktop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Failed to refresh session" }))
    return reply.code(401).send({ error: err.message || "Failed to refresh session" })
  }

  const data = await res.json()
  const expiresAt = jwtExpToIso(data.accessToken)

  // Get user profile for display name
  let displayName = data.user?.email || ""
  if (data.user?.id) {
    const { profile } = await insforgeGetProfile(data.user.id)
    if (profile?.name) displayName = profile.name
  }

  return reply.send({
    success: true,
    data: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenType: "Bearer",
      expiresAt,
      userInfo: {
        subject: null,
        email: data.user?.email || "",
        name: displayName,
        clineUserId: data.user?.id || "",
        accounts: null,
      },
    },
  })
})

// Get current user info
fastify.get("/v1/me", async (request, reply) => {
  const authHeader = request.headers.authorization || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null
  if (!token) {
    return reply.code(401).send({ error: "Missing access token" })
  }

  const { user, error } = await insforgeGetUser(token)
  if (error || !user) {
    return reply.code(401).send({ error: "Invalid token" })
  }

  // Get profile for display name
  let displayName = user.email || ""
  if (user.id) {
    const { profile } = await insforgeGetProfile(user.id)
    if (profile?.name) displayName = profile.name
  }

  return reply.send({
    data: {
      id: user.id,
      email: user.email,
      displayName,
      createdAt: user.createdAt || "",
      organizations: [],
    },
  })
})

fastify.listen({ port: Number(PORT), host: "0.0.0.0" })
