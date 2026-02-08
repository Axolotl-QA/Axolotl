# Sentinel Project - Claude Instructions

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
  - Reads env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `APP_BASE_URL`
- **Autodeploy**: Enabled on `sentinel-dev` branch of `Steven-wyf/Sentinel`
- **Git remotes**: `origin` = icecreamlun (Axolotl-QA), `steven` = Steven-wyf

## Supabase Configuration

- OTP verification codes are **8 digits** (configured in Supabase Dashboard)
- Anon key is a JWT token (~200 chars), NOT a short UUID
- Signup flow uses `signUp()` (not `signInWithOtp`) to create account + send confirmation in one step

---

## Lessons Learned (Anti-Patterns to Avoid)

### 1. `build.sh` sed global replacement destroys sentinel values

**Problem**: `build.sh` uses `sed -g` to replace ALL occurrences of the placeholder UUID `6EB4753E-E919-4691-B6E4-65A6B6E38A04` across the entire file. If you store that same placeholder string in a JavaScript constant (e.g., `const PLACEHOLDER_KEY = "6EB4753E-..."`) for comparison, `sed` will replace it too, breaking the detection logic.

**Rule**: Never embed the placeholder string in any variable meant to detect whether replacement happened. Use a property of the value instead (e.g., `SUPABASE_ANON_KEY.length < 100` to distinguish a 36-char UUID placeholder from a 200+ char JWT).

### 2. Supabase CDN global variable conflict

**Problem**: The Supabase CDN (`@supabase/supabase-js@2`) declares `var supabase = ...` as a global variable. If any `<script>` block in the same page declares `const supabase` or `let supabase`, the browser throws `SyntaxError: Identifier 'supabase' has already been declared` and the **entire script block fails silently**.

**Rule**: Never use `const` or `let` to declare a variable named `supabase` in pages that load the Supabase CDN. Always use `supabaseClient` or similar names. The CDN's `var supabase` occupies the global scope.

### 3. OTP digit count must match Supabase project settings

**Problem**: The Supabase project is configured for 8-digit OTP codes, but the frontend had 6 OTP input fields. When changing OTP digit count, ALL related values must be updated together:

**Checklist for changing OTP length (N digits)**:
- [ ] HTML: Number of `<input>` elements in `#otp-inputs` = N
- [ ] Hint text: "We'll send an N-digit code..."
- [ ] Auto-focus: `index < (N-1)` in input handler
- [ ] Paste handler: `.slice(0, N)`
- [ ] Paste focus: `Math.min(pastedData.length, N-1)`
- [ ] Validation: `otp.length === N`
- [ ] CSS: Input box width may need adjustment to fit N boxes in card width

### 4. Signup flow: use `signUp()` not `signInWithOtp()` for registration

**Problem**: Using `signInWithOtp({ shouldCreateUser: true })` for registration causes two issues:
1. It sends an OTP email, then `updateUser()` may trigger a second email
2. It cannot detect already-registered emails (it succeeds for both new and existing users)

**Rule**: Use `supabaseClient.auth.signUp({ email, password })` for registration:
- Creates the user and sends ONE confirmation email
- Returns `identities: []` for already-confirmed emails (lets you show "already registered")
- Sets the password at signup time (no separate `updateUser` needed)
- Use `verifyOtp({ type: "signup" })` (not `"email"`) to verify the signup code

### 5. Always verify deployed code matches your changes

**Problem**: DigitalOcean static site builds can take 1-3 minutes. Testing before deployment completes leads to false conclusions about bugs.

**Rule**: After pushing, verify the deployed code actually reflects your changes before debugging:
```javascript
// Example: check function content to confirm deployment
sendCode.toString().includes('signUp') // should be true after deploy
```

### 6. `async` initialization and race conditions

**Problem**: When `initSupabase()` is `async` (e.g., fetches `/v1/config`), the Supabase client isn't ready immediately. Functions called synchronously after `initSupabase()` may find `supabaseClient === null`.

**Rule**: All Supabase-dependent operations should check `if (!supabaseClient)` and show an appropriate error. Event handlers (click, etc.) naturally wait for user interaction, so they're safe. But auto-running code (like OAuth callback detection) must be placed inside the `initSupabase()` function after client creation.
