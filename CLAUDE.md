# Axolotl Project - Claude Instructions

## Project Structure

- `static_site/` - Login & signup HTML pages (deployed as DigitalOcean Static Site)
- `server/` - Fastify auth backend (deployed as DigitalOcean Service)
- `src/` - VS Code extension source

## Deployment Architecture

- **Static site**: DigitalOcean App Platform static site component
  - Source: `static_site/` directory
  - Build: `npm run build` -> `bash build.sh` -> outputs to `dist/`
  - `build.sh` uses `sed` to replace placeholder values with environment variables
- **Server**: DigitalOcean App Platform service component
  - Reads env vars: `INSFORGE_BASE_URL`, `INSFORGE_API_KEY`, `INSFORGE_ANON_KEY`, `APP_BASE_URL`
- **Autodeploy**: Enabled on `axolotl-dev` branch of `Steven-wyf/Axolotl`
- **Git remotes**: `origin` = icecreamlun (Axolotl-QA), `steven` = Steven-wyf

## InsForge Configuration

- **Backend URL**: `https://4zxsfry3.us-west.insforge.app`
- **Auth provider**: InsForge (replaced Supabase)
- **Email verification**: 6-digit code (configured via InsForge dashboard, `verifyEmailMethod: "code"`)
- **Password reset**: 6-digit code (`resetPasswordMethod: "code"`)
- **OAuth providers**: Google, GitHub
- **Password requirements**: min 6 chars (no uppercase/number/special requirements)
- **Signup flow**: `POST /api/auth/users` → email verification code → `POST /api/auth/email/verify`
- **Sign-in flow**: `POST /api/auth/sessions?client_type=desktop` → returns `accessToken` + `refreshToken`
- **Static site uses direct REST API calls** (no SDK CDN — vanilla HTML with `fetch()`)
- **Server uses direct REST API calls** (no `@insforge/sdk` — uses `fetch()` with API key)

### Server Environment Variables

| Variable | Description |
|----------|-------------|
| `INSFORGE_BASE_URL` | InsForge backend URL (e.g., `https://4zxsfry3.us-west.insforge.app`) |
| `INSFORGE_API_KEY` | Admin API key for DB operations and token validation |
| `INSFORGE_ANON_KEY` | Public anon key (served to frontend via `/v1/config`) |
| `APP_BASE_URL` | Frontend static site URL |
| `CORS_ORIGIN` | Comma-separated allowed origins |
| `PORT` | Server port (default: 8080) |

---

## Lessons Learned (Anti-Patterns to Avoid)

### 1. `build.sh` sed global replacement destroys placeholder values

**Problem**: `build.sh` uses `sed -g` to replace ALL occurrences of a placeholder URL across the entire file. If you store that same placeholder string in a JavaScript constant for comparison, `sed` will replace it too, breaking the detection logic.

**Rule**: Never embed the placeholder string in any variable meant to detect whether replacement happened.

### 2. OTP digit count must match backend settings

**Problem**: The InsForge backend is configured for 6-digit OTP codes. The frontend OTP input fields, validation, paste handlers, and auto-focus logic must all use 6.

**Checklist for changing OTP length (N digits)**:
- [ ] HTML: Number of `<input>` elements in `#otp-inputs` = N
- [ ] Hint text: "We sent an N-digit code..."
- [ ] Auto-focus: `index < (N-1)` in input handler
- [ ] Paste handler: `.slice(0, N)`
- [ ] Paste focus: `Math.min(pastedData.length, N-1)`
- [ ] Validation: `otp.length === N`
- [ ] CSS: Input box width may need adjustment to fit N boxes in card width

### 3. Signup flow: InsForge password-first registration

**Flow**: User fills name + email + password → `POST /api/auth/users` creates account and sends 6-digit code → user enters code → `POST /api/auth/email/verify` → redirect to login.

- InsForge `signUp()` requires password upfront (unlike old Supabase OTP-first flow)
- Verification email is sent automatically on signup
- Use `resendVerificationEmail()` / `POST /api/auth/email/send-verification` to resend

### 4. Always verify deployed code matches your changes

**Problem**: DigitalOcean static site builds can take 1-3 minutes. Testing before deployment completes leads to false conclusions about bugs.

**Rule**: After pushing, verify the deployed code actually reflects your changes before debugging.

### 5. InsForge OAuth PKCE flow on static site

The Google OAuth flow on the static site uses InsForge's PKCE flow:
1. Generate `code_verifier` + `code_challenge`, store verifier in `sessionStorage`
2. `GET /api/auth/oauth/google?redirect_uri=...&code_challenge=...` → returns `{ authUrl }`
3. Redirect to Google, user authenticates
4. Google redirects back with `?insforge_code=...`
5. Exchange: `POST /api/auth/oauth/exchange?client_type=desktop` with `{ code, code_verifier }`
6. Get `{ accessToken, refreshToken }` → exchange with backend

### 6. InsForge REST API client_type parameter

When calling InsForge auth endpoints from the static site (which serves a desktop app flow):
- Always use `?client_type=desktop` to get `refreshToken` in the response body
- Without this parameter, InsForge defaults to `web` mode which uses httpOnly cookies instead
