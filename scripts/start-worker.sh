#!/usr/bin/env bash
# Runs the Talons worker on Linux or macOS with pm2 (restarts on crash and on reboot).
# Usage: bash scripts/start-worker.sh
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Node.js 22 is needed"; exit 1; }
[ -d node_modules ] || npm ci --no-audit --no-fund
command -v pm2 >/dev/null || npm install -g pm2
mkdir -p data
PORT=${PORT:-8787} DATA_DIR=${DATA_DIR:-$PWD/data} pm2 start "npm run worker" --name talons-worker --update-env
pm2 save
echo "Worker running on port ${PORT:-8787}. Logs: pm2 logs talons-worker. Health: curl localhost:${PORT:-8787}/health"
echo "Run 'pm2 startup' once and follow its line to start it again after a reboot."
