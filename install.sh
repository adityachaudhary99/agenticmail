#!/usr/bin/env bash
#
# AgenticMail one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/agenticmail/agenticmail/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/agenticmail/agenticmail/main/install.sh | bash -s -- --dry-run
#
# Flags (pass as positional args after `-s --` when piping from curl):
#   --dry-run      Print what would happen, don't run it
#   --no-bootstrap Stop after `npm install -g`; don't run `agenticmail bootstrap`
#   --help         Show this help
#
# What this script does (in order):
#   1. Detect your OS + package manager
#   2. Verify Node.js >= 22 (fail with actionable instructions if missing)
#   3. Ensure npm is on PATH
#   4. npm install -g @agenticmail/cli@latest
#   5. agenticmail bootstrap   (skipped with --no-bootstrap)
#
# Security note: this script is hosted on the agenticmail/agenticmail
# GitHub repo. Read it before running. If you'd rather not pipe a remote
# script into bash, the manual install is two commands:
#
#   npm install -g @agenticmail/cli@latest
#   agenticmail bootstrap
#
# That's all the installer does. Everything below is just guard rails.

set -euo pipefail

# ─── ANSI colors (only if stdout is a terminal) ──────────────────────
if [ -t 1 ]; then
  C_PINK='\033[38;5;205m'; C_GREEN='\033[32m'; C_RED='\033[31m'
  C_YELLOW='\033[33m';     C_CYAN='\033[36m';  C_DIM='\033[90m'
  C_BOLD='\033[1m';        C_RESET='\033[0m'
else
  C_PINK=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_CYAN=''; C_DIM=''; C_BOLD=''; C_RESET=''
fi

say()  { printf "  %b%s%b\n"   "$1" "$2" "$C_RESET"; }
ok()   { printf "  ${C_GREEN}✓${C_RESET} %s\n" "$1"; }
warn() { printf "  ${C_YELLOW}!${C_RESET} %s\n" "$1"; }
fail() { printf "  ${C_RED}✗${C_RESET} %s\n" "$1" >&2; }
die()  { fail "$1"; exit 1; }

# ─── Flag parsing ────────────────────────────────────────────────────
DRY_RUN=0
DO_BOOTSTRAP=1

for arg in "$@"; do
  case "$arg" in
    --dry-run)      DRY_RUN=1 ;;
    --no-bootstrap) DO_BOOTSTRAP=0 ;;
    --help|-h)
      sed -n '3,30p' "$0" 2>/dev/null || head -30 "$0"
      exit 0
      ;;
    *) die "Unknown flag: $arg (try --help)" ;;
  esac
done

run() {
  printf "  ${C_DIM}\$${C_RESET} %s\n" "$*"
  if [ "$DRY_RUN" = "0" ]; then
    "$@"
  fi
}

# ─── Header ──────────────────────────────────────────────────────────
echo
printf "  ${C_PINK}🎀 AgenticMail installer${C_RESET}\n"
echo
if [ "$DRY_RUN" = "1" ]; then
  warn "DRY RUN — printing commands, not executing them"
  echo
fi

# ─── OS detection ────────────────────────────────────────────────────
case "$(uname -s)" in
  Darwin*) PLATFORM="macos"; PKG_MGR="brew" ;;
  Linux*)
    PLATFORM="linux"
    if   command -v apt-get >/dev/null 2>&1; then PKG_MGR="apt"
    elif command -v dnf     >/dev/null 2>&1; then PKG_MGR="dnf"
    elif command -v yum     >/dev/null 2>&1; then PKG_MGR="yum"
    elif command -v pacman  >/dev/null 2>&1; then PKG_MGR="pacman"
    else PKG_MGR="unknown"
    fi
    ;;
  *) die "Unsupported OS: $(uname -s). AgenticMail supports macOS and Linux." ;;
esac
ok "Platform: ${C_BOLD}${PLATFORM}${C_RESET} (package manager: ${PKG_MGR})"

# ─── Node.js version check ───────────────────────────────────────────
# AgenticMail 0.7+ uses Node's built-in `node:sqlite` module, so Node 22+
# is required. Older Node will fail at runtime with "Cannot find package
# 'sqlite'" — better to refuse here with a clear message than let the user
# discover this after npm install.
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed."
  echo
  case "$PLATFORM" in
    macos)
      printf "  Install Node 22 LTS, then re-run this installer:\n\n"
      printf "    ${C_GREEN}brew install node@22${C_RESET}\n"
      printf "    ${C_GREEN}brew link --overwrite --force node@22${C_RESET}\n\n"
      printf "  Or via nvm:\n\n"
      printf "    ${C_GREEN}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash${C_RESET}\n"
      printf "    ${C_GREEN}nvm install 22 && nvm use 22${C_RESET}\n\n"
      ;;
    linux)
      printf "  Install Node 22 LTS, then re-run this installer:\n\n"
      case "$PKG_MGR" in
        apt) printf "    ${C_GREEN}curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -${C_RESET}\n    ${C_GREEN}sudo apt-get install -y nodejs${C_RESET}\n\n" ;;
        dnf|yum) printf "    ${C_GREEN}curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -${C_RESET}\n    ${C_GREEN}sudo ${PKG_MGR} install -y nodejs${C_RESET}\n\n" ;;
        pacman) printf "    ${C_GREEN}sudo pacman -S nodejs npm${C_RESET}\n\n" ;;
        *) printf "  Refer to https://nodejs.org/en/download for your distribution.\n\n" ;;
      esac
      ;;
  esac
  exit 1
fi

# Parse major version. `node -v` prints e.g. "v22.5.0".
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if ! [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
  fail "Node.js $(node -v) detected — AgenticMail needs Node 22 or newer."
  echo
  printf "  Upgrade your Node and re-run this installer. Quickest path:\n\n"
  case "$PLATFORM" in
    macos)  printf "    ${C_GREEN}brew install node@22 && brew link --overwrite --force node@22${C_RESET}\n" ;;
    linux)  printf "    ${C_GREEN}curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs${C_RESET}\n" ;;
  esac
  echo
  exit 1
fi
ok "Node.js $(node -v) ${C_DIM}(>=22 required)${C_RESET}"

# ─── npm sanity check ────────────────────────────────────────────────
if ! command -v npm >/dev/null 2>&1; then
  die "npm not found on PATH. Reinstall Node from https://nodejs.org so npm comes with it."
fi
ok "npm $(npm -v)"

# ─── Detect if @agenticmail/cli is already installed ─────────────────
if command -v agenticmail >/dev/null 2>&1; then
  CURRENT_VERSION="$(agenticmail --version 2>/dev/null || echo 'unknown')"
  warn "${C_BOLD}agenticmail${C_RESET} is already installed (version ${C_CYAN}${CURRENT_VERSION}${C_RESET})"
  printf "  The installer will upgrade to the latest published version.\n"
fi

echo
# ─── 1. npm install -g @agenticmail/cli ──────────────────────────────
say "$C_BOLD" "Installing @agenticmail/cli@latest"
echo
run npm install -g @agenticmail/cli@latest --no-audit --no-fund
echo
ok "@agenticmail/cli installed: ${C_CYAN}$(agenticmail --version 2>/dev/null || echo 'pending')${C_RESET}"
echo

# ─── 2. bootstrap (unless --no-bootstrap) ────────────────────────────
if [ "$DO_BOOTSTRAP" = "1" ]; then
  say "$C_BOLD" "Running bootstrap pipeline"
  printf "  ${C_DIM}This will provision Stalwart (via Colima/Docker), generate a master key,\n  start the API server, and wire the Claude Code integration. ~2 minutes.${C_RESET}\n"
  echo
  run agenticmail bootstrap
  echo
  ok "Bootstrap complete"
else
  warn "Skipping bootstrap (--no-bootstrap)"
  echo
  printf "  Run it later with: ${C_GREEN}agenticmail bootstrap${C_RESET}\n"
fi

echo
printf "  ${C_GREEN}${C_BOLD}✅ All done.${C_RESET}\n"
echo
printf "  ${C_BOLD}Next:${C_RESET} restart your Claude Code session and try:\n\n"
printf "    ${C_DIM}Agent { subagent_type: \"agenticmail-secretary\", prompt: \"hi\" }${C_RESET}\n"
echo

# ─── 3. Dispatcher tuning prompt (interactive, optional) ─────────────
# The dispatcher ships with conservative defaults (10 wakes per (agent,
# thread) per 24h, 50 concurrent workers). Power users coordinating
# active multi-agent threads hit those limits quickly and see
# `wake-budget exhausted` warnings without knowing where the lever is.
# Ask once, post-install; press enter to keep defaults.
#
# Skipped when stdin/stdout aren't a terminal (CI runs, --no-bootstrap).
if [ "$DO_BOOTSTRAP" = "1" ] && [ -t 0 ] && [ -t 1 ]; then
  printf "  ${C_BOLD}Dispatcher tuning${C_RESET} ${C_DIM}(optional — press Enter to keep defaults)${C_RESET}\n"
  printf "  ${C_DIM}The defaults are conservative. Active multi-agent threads can hit them.${C_RESET}\n"
  echo

  printf "  How many times should each agent wake on the same email thread per 24h?\n"
  printf "    ${C_DIM}10 (default) · 50 (active coordination) · 100+ (power user)${C_RESET}\n"
  printf "  ${C_BOLD}Wakes per thread${C_RESET} [10]: "
  read -r WAKES_PER_THREAD || WAKES_PER_THREAD=""

  printf "  ${C_BOLD}Max simultaneous workers across all agents${C_RESET} [50]: "
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
    run agenticmail-claudecode tune $TUNE_FLAGS
    if command -v pm2 >/dev/null 2>&1; then
      run pm2 restart agenticmail-claudecode-dispatcher >/dev/null 2>&1 || true
    fi
  else
    ok "Keeping default dispatcher settings"
  fi
  echo
fi

printf "  ${C_DIM}For external Gmail relay or a custom domain, run:${C_RESET} ${C_GREEN}agenticmail setup${C_RESET}\n"
printf "  ${C_DIM}To adjust rate limits later, run:${C_RESET} ${C_GREEN}agenticmail-claudecode tune${C_RESET} ${C_DIM}(--help for flags)${C_RESET}\n"
printf "  ${C_DIM}For docs:${C_RESET} ${C_CYAN}https://github.com/agenticmail/agenticmail${C_RESET}\n"
echo
