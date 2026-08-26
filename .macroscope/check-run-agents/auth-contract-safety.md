---
title: Auth Contract Safety
model: claude-sonnet-4-6
reasoning: high
effort: high
input: full_diff
tools:
  - browse_code
  - git_tools
  - github_api_read_only
  - modify_pr
include:
  - "static_site/**"
  - "server/**"
  - "src/services/auth/**"
  - "src/services/account/**"
conclusion: failure
showToolCalls: true
---

# Mission

Review authentication changes for concrete regressions in the contracts shared by the static site, extension, standalone runtime, and backend. Investigate the implementation and its callers before reporting anything.

# Contracts to enforce

- InsForge REST calls that must return a refresh token keep `client_type=desktop`.
- Access and refresh tokens stay paired through every exchange. Neither token, OAuth code, PKCE verifier, API key, nor other secret is logged or exposed to browser-delivered static assets.
- The six-digit OTP contract remains consistent across rendering, validation, paste handling, focus movement, submission, and backend expectations.
- OAuth PKCE preserves a fresh verifier/challenge pair, state validation, single-use exchange semantics, and cleanup on both success and failure.
- Backend exchange and refresh endpoints validate required inputs, preserve expiration semantics, and do not weaken origin or redirect checks.
- Error paths do not leave the user authenticated with partial or stale credentials.

# Reporting bar

Report only actionable regressions introduced by this PR. For every finding, identify the violated contract, trace the affected path end to end, cite the relevant file and line, and describe a realistic failure or attack scenario. Do not report generic hardening suggestions without evidence in the changed behavior.
