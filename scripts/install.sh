#!/bin/bash
# install.sh — universal first-run installer (Phase 15).
#
# One command from a fresh GitHub clone to a validated, harness-configured
# setup. Non-destructive: existing live configs are never overwritten.
#
#   bash scripts/install.sh
#
# Steps:
#   1. Check prerequisites (jq, python3; node optional for the TUI).
#   2. Copy config/*.example.json to live configs where missing.
#   3. Detect installed coding agents (opencode, claude) and write
#      config/harness.json (only if missing).
#   4. Offer to create .claude/settings.json (headless permission
#      pre-approval) when Claude Code is the harness — asks first.
#   5. Regenerate per-harness agent definitions from agents/.
#   6. Run the config validator (which also auto-seeds vetted slugs).
#   7. Optionally build the TUI (app/) when node is available.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

say()  { echo "install: $*"; }
warn() { echo "install: WARNING: $*" >&2; }
fail() { echo "install: ERROR: $*" >&2; exit 1; }

# --- 1. Prerequisites --------------------------------------------------------
command -v jq >/dev/null 2>&1 || fail "jq is required (brew install jq / apt install jq)"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"

# --- 2. Live configs from examples -------------------------------------------
for pair in "targets" "discord_config"; do
  live="config/${pair}.json"
  example="config/${pair}.example.json"
  if [ -f "$live" ]; then
    say "$live exists — keeping it."
  else
    cp "$example" "$live"
    say "created $live from $example — fill in the placeholders (or run 'applyr setup')."
  fi
done

# --- 3. Harness detection -----------------------------------------------------
HAVE_OPENCODE=0; HAVE_CLAUDE=0
command -v opencode >/dev/null 2>&1 && HAVE_OPENCODE=1
command -v claude >/dev/null 2>&1 && HAVE_CLAUDE=1

if [ "$HAVE_OPENCODE" -eq 0 ] && [ "$HAVE_CLAUDE" -eq 0 ]; then
  warn "no supported coding agent found (opencode or claude)."
  warn "install one, then re-run: https://opencode.ai or https://claude.com/claude-code"
fi

if [ -f "config/harness.json" ]; then
  say "config/harness.json exists — keeping it ($(jq -r '.harness // "?"' config/harness.json))."
else
  HARNESS=""
  if [ "$HAVE_OPENCODE" -eq 1 ] && [ "$HAVE_CLAUDE" -eq 1 ] && [ -t 0 ]; then
    # Both agents installed and we can ask — let the user choose.
    echo
    echo "Which coding agent should applyr use for runs?"
    echo "  1) opencode      (detected)"
    echo "  2) Claude Code   (detected)"
    echo "  (Codex and GitHub Copilot support is planned — not available yet.)"
    printf "Choose [1/2, default 1]: "
    read -r CHOICE || CHOICE=""
    case "$CHOICE" in
      2) HARNESS="claude" ;;
      *) HARNESS="opencode" ;;
    esac
  elif [ "$HAVE_OPENCODE" -eq 1 ]; then
    HARNESS="opencode"
  elif [ "$HAVE_CLAUDE" -eq 1 ]; then
    HARNESS="claude"
  fi
  if [ -n "$HARNESS" ]; then
    printf '{\n  "harness": "%s"\n}\n' "$HARNESS" > config/harness.json
    say "wrote config/harness.json (harness: $HARNESS — change any time by editing the file or re-running this installer)."
  else
    say "skipped config/harness.json — no supported coding agent detected yet."
  fi
fi

# --- 4. Claude Code headless permissions (opt-in, asks first) ----------------
# Headless runs need pre-approved tools; this file grants Claude Code broad
# repo-local permissions, so it is only created with explicit consent.
if [ "$HAVE_CLAUDE" -eq 1 ] && [ ! -f ".claude/settings.json" ]; then
  echo
  echo "Claude Code headless runs need pre-approved permissions in .claude/settings.json:"
  echo '  Bash(*), Edit(*), Write(*), Read(*), mcp__playwright__* (repo-local)'
  printf "Create it now? [y/N] "
  read -r REPLY || REPLY=""
  if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
    mkdir -p .claude
    cat > .claude/settings.json <<'JSON'
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Edit(*)",
      "Write(*)",
      "Read(*)",
      "mcp__playwright__*"
    ]
  },
  "enableAllProjectMcpServers": true
}
JSON
    say "wrote .claude/settings.json."
  else
    say "skipped .claude/settings.json — headless Claude runs will prompt for permissions."
  fi
fi

# --- 5. Agent definitions ------------------------------------------------------
python3 scripts/generate_agent_definitions.py

# --- 6. Validate (also auto-seeds vetted Ashby/Lever slugs) --------------------
if bash scripts/validate_local_config.sh; then
  say "config valid."
else
  warn "config not valid yet — edit the files named above (or run 'applyr setup'), then re-run:"
  warn "  bash scripts/validate_local_config.sh"
fi

# --- 7. TUI (optional) ---------------------------------------------------------
if command -v npm >/dev/null 2>&1; then
  if [ ! -d "app/node_modules" ]; then
    say "building the TUI (app/) …"
    (cd app && npm install --silent && npm run build --silent) \
      && say "TUI ready: node app/dist/cli.js help (or: cd app && npm link)" \
      || warn "TUI build failed — the agent works without it; see docs/SETUP.md 3.2."
  else
    say "TUI already installed."
  fi
else
  say "node/npm not found — skipping the optional TUI (docs/SETUP.md 3.2)."
fi

say "done. Next: bash scripts/run_job_agent.sh (or 'applyr run')."
