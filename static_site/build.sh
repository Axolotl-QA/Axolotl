#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
mkdir -p dist
cp -R index.html login.html signup.html dist/

# If env vars are set (e.g. on DigitalOcean), replace hardcoded values at build time
if [ -n "${SUPABASE_URL:-}" ]; then
  sed -i.bak "s|https://cxoizjoeozrtjpybgicc.supabase.co|${SUPABASE_URL}|g" dist/login.html dist/signup.html
fi
if [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  sed -i.bak "s|6EB4753E-E919-4691-B6E4-65A6B6E38A04|${SUPABASE_ANON_KEY}|g" dist/login.html dist/signup.html
fi
if [ -n "${API_BASE_URL:-}" ]; then
  sed -i.bak "s|https://whale-app-ae67c.ondigitalocean.app|${API_BASE_URL}|g" dist/login.html dist/signup.html
fi
rm -f dist/*.bak
