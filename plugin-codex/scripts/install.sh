#!/usr/bin/env bash
# Drop-in installer for users who don't want `npm install -g @agenticmail/codex`.
#
# What it does:
#   1. Verify Codex CLI is installed (otherwise abort with a clear message).
#   2. Verify AgenticMail is reachable (otherwise abort with a clear message).
#   3. Hand off to `npx -y @agenticmail/codex install` — the npm package is
#      the source of truth for the writer logic; this script is just an
#      ergonomic shortcut for users who pulled the plugin folder by hand
#      from a marketplace or git clone.
#
# Why not bash all the way? Writing TOML / JSON with shell + jq / sed is
# error-prone (idempotency, atomic rename, multi-line strings in
# developer_instructions). The npm package does it correctly. This script
# is a 30-line wrapper that avoids duplicating that logic.
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  cat >&2 <<EOF
✗ Codex CLI not found on \$PATH.
  Install it first:  npm install -g @openai/codex
EOF
  exit 127
fi

if ! command -v npx >/dev/null 2>&1; then
  cat >&2 <<EOF
✗ npx not found on \$PATH.
  Install Node.js 22+ from https://nodejs.org/ and try again.
EOF
  exit 127
fi

API_URL="${AGENTICMAIL_API_URL:-http://127.0.0.1:3829}"
if ! curl -s --max-time 5 "$API_URL/api/agenticmail/health" >/dev/null; then
  cat >&2 <<EOF
✗ AgenticMail master API not reachable at $API_URL.
  Make sure it's running:  agenticmail start
  Or override the URL:     AGENTICMAIL_API_URL=http://… $0
EOF
  exit 69
fi

exec npx -y @agenticmail/codex install "$@"
