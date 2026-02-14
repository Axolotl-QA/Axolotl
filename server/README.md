# Axolotl Backend (Auth)

This service provides the **auth endpoints** for the VS Code extension login flow.

## Environment variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `APP_BASE_URL` (login UI base URL)
- `API_BASE_URL` (optional, not required for runtime)
- `CORS_ORIGIN` (comma‑separated allowlist)
- `PORT` (default 8080)

## Endpoints
- `GET /v1/auth/authorize`
- `POST /v1/auth/code`
- `POST /v1/auth/token`
- `POST /v1/auth/refresh`
- `GET /v1/me`

## DB Setup
Run `server/sql/schema.sql` in your Supabase SQL editor.

## Run locally
```bash
cd server
npm install
npm start
```
