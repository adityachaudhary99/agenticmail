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

# Run the package installer.
npx -y @agenticmail/codex install "$@"

# ─── Dispatcher tuning prompt (interactive, optional) ───────────────
# Same UX as the main install.sh — surface the wake-budget question
# right after install so users don't discover the cap by hitting it.
# Skip when stdin/stdout aren't a terminal (CI runs).
if [ -t 0 ] && [ -t 1 ]; then
  echo
  echo "  Dispatcher tuning (optional — press Enter to keep defaults)"
  echo "  The defaults are conservative. Active multi-agent threads can hit them."
  echo
  echo "  How many times should each agent wake on the same email thread per 24h?"
  echo "    10 (default) · 50 (active coordination) · 100+ (power user)"
  printf "  Wakes per thread [10]: "
  read -r WAKES_PER_THREAD || WAKES_PER_THREAD=""

  printf "  Max simultaneous workers across all agents [50]: "
  read -r MAX_CONCURRENT || MAX_CONCURRENT=""

  TUNE_FLAGS=""
  if [ -n "$WAKES_PER_THREAD" ] && [ "$WAKES_PER_THREAD" != "10" ]; then
    TUNE_FLAGS="$TUNE_FLAGS --max-wakes-per-thread $WAKES_PER_THREAD"
  fi
  if [ -n "$MAX_CONCURRENT" ] && [ "$MAX_CONCURRENT" != "50" ]; then
    TUNE_FLAGS="$TUNE_FLAGS --max-concurrent $MAX_CONCURRENT"
  fi

  if [ -n "$TUNE_FLAGS" ]; then
    echo
    # shellcheck disable=SC2086
    npx -y @agenticmail/codex tune $TUNE_FLAGS
    if command -v pm2 >/dev/null 2>&1; then
      pm2 restart agenticmail-codex-dispatcher >/dev/null 2>&1 || true
    fi
  else
    echo "  ✓ Keeping default dispatcher settings"
  fi
  echo
fi

echo "  Tip: run 'agenticmail-codex tune' any time to view or change rate limits."
echo "  ~/.agenticmail/dispatcher.json is plain JSON — agents can edit it directly."
