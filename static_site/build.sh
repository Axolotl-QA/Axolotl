#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
mkdir -p dist
cp -R index.html login.html dist/
