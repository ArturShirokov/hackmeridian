#!/usr/bin/env bash
# PM2 runs this on the VPS. It loads the secrets (mode 600, outside the repo) and starts doc2dpp on the private
# Node 24 in /opt/doc2dpp/node, so the system Node the other apps use stays untouched.
set -euo pipefail
export ENV_FILE=/etc/doc2dpp/env
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
cd "$(dirname "$0")/.."
exec /opt/doc2dpp/node/bin/node node_modules/tsx/dist/cli.mjs src/main.ts
