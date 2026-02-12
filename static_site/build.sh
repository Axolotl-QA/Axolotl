#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
mkdir -p dist
cp -R index.html login.html signup.html dist/

# If env vars are set (e.g. on DigitalOcean), replace hardcoded values at build time
if [ -n "${INSFORGE_BASE_URL:-}" ]; then
  sed -i.bak "s|https://4zxsfry3.us-west.insforge.app|${INSFORGE_BASE_URL}|g" dist/login.html dist/signup.html
fi
if [ -n "${API_BASE_URL:-}" ]; then
  sed -i.bak "s|https://whale-app-ae67c.ondigitalocean.app|${API_BASE_URL}|g" dist/login.html dist/signup.html
fi
rm -f dist/*.bak
