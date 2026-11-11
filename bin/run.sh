#!/usr/bin/env bash
# Wrapper per cron e uso manuale.
# Il file .env viene letto da src/main.mjs, quindi non serve --env-file.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "${NODE_BIN:-}" ]; then
  NODE="$NODE_BIN"
else
  NODE="$(command -v node || echo /usr/bin/node)"
fi
exec "$NODE" src/main.mjs "$@"
