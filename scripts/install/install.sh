#!/bin/bash
# install.sh — universal first-run installer (Phase 15).
#
# One command from a fresh GitHub clone to a validated, harness-configured
# setup. Non-destructive: existing live configs are never overwritten.
#
#   bash scripts/install/install.sh                                      # from a clone/unpacked release
#   curl -fsSL https://raw.githubusercontent.com/keshm2/applyr/main/scripts/install/install.sh | bash
#
# Steps:
#   0. Bootstrap: when piped (curl | bash) or run outside the repo,
#      download and unpack the source tarball, then re-run from inside it.
#   1. Check prerequisites (jq, python3; node optional for the TUI).
#   2. Copy config/*.example.json to live configs where missing.
#   3. Detect installed coding agents (opencode, claude) and write
#      config/harness.json (only if missing).
#   4. Ask for the user's profile (safe_fields) — kept locally only.
#   5. Offer to create .claude/settings.json (headless permission
#      pre-approval) when Claude Code is the harness — asks first.
#   6. Regenerate per-harness agent definitions from agents/.
#   7. Run the config validator (which also auto-seeds vetted slugs).
#   8. Optionally build the TUI (app/) when node is available.

set -euo pipefail

say()  { echo "install: $*"; }
warn() { echo "install: WARNING: $*" >&2; }
fail() { echo "install: ERROR: $*" >&2; exit 1; }

# Colors only on a TTY; the privacy notice and warnings must stand out.
if [ -t 1 ]; then
  C_NOTICE=$'\033[1;36m'; C_WARN=$'\033[1;33m'; C_RESET=$'\033[0m'
else
  C_NOTICE=""; C_WARN=""; C_RESET=""
fi

# --- 0. Bootstrap (curl | bash, or run outside the repo) ----------------------
# When the script is piped, BASH_SOURCE is empty and there is no repo around
# it. Download the source tarball, unpack, and re-exec from inside it.
SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -f "$(dirname "$SELF")/../../AGENTS.md" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  command -v curl >/dev/null 2>&1 || fail "curl is required for the one-line install"
  command -v tar  >/dev/null 2>&1 || fail "tar is required for the one-line install"
  TARGET_DIR="${APPLYR_HOME:-$HOME/applyr}"
  if [ -f "$TARGET_DIR/AGENTS.md" ]; then
    say "existing install found at $TARGET_DIR — refreshing it from GitHub before re-running."
  else
    say "downloading applyr into $TARGET_DIR …"
  fi
  mkdir -p "$TARGET_DIR"
  # Always re-fetch and overwrite tracked files, even for an existing install:
  # heals a stale or corrupted local copy (e.g. an old script version with a
  # bug) instead of re-running whatever happens to already be on disk.
  # Gitignored local state (config/*.json, data/, logs/, docs/PLAN.md)
  # isn't in the tarball, so it's left untouched.
  curl -fsSL "https://codeload.github.com/keshm2/applyr/tar.gz/refs/heads/main" \
    | tar -xz --strip-components=1 -C "$TARGET_DIR"
  # Re-attach stdin to the terminal so the interactive prompts below work
  # even though the script itself arrived on stdin.
  if [ -e /dev/tty ]; then
    exec bash "$TARGET_DIR/scripts/install/install.sh" </dev/tty
  else
    exec bash "$TARGET_DIR/scripts/install/install.sh"
  fi
fi
cd "$PROJECT_ROOT"

# --- 1. Prerequisites --------------------------------------------------------
command -v jq >/dev/null 2>&1 || fail "jq is required (brew install jq / apt install jq)"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"

# --- 2. Live configs from examples -------------------------------------------
if [ -f "config/targets.json" ]; then
  say "config/targets.json exists — keeping it."
else
  cp "config/targets.example.json" "config/targets.json"
  say "created config/targets.json from the example — fill in the placeholders (or run 'applyr setup')."
fi

# --- 2b. Discord status updates (OPTIONAL, opt-in) -----------------------------
# Outcomes always land in the local state files and the TUI; Discord
# webhooks are an optional extra channel. Opting out writes a disabled
# config so the validator stays green; enable later via 'applyr setup'.
DISCORD_LIVE="config/discord_config.json"
write_disabled_discord() {
  printf '{\n  "enabled": false,\n  "webhooks": {}\n}\n' > "$DISCORD_LIVE"
}
if [ -f "$DISCORD_LIVE" ]; then
  say "$DISCORD_LIVE exists — keeping it."
elif [ -t 0 ]; then
  echo
  printf "Use Discord for status updates (applied / needs-review / failed / summary)? [y/N] "
  read -r DISCORD_OPT || DISCORD_OPT=""
  if [ "$DISCORD_OPT" = "y" ] || [ "$DISCORD_OPT" = "Y" ]; then
    echo
    echo "How should the updates be routed?"
    echo "  1) One channel for ALL status updates (one webhook link)"
    echo "  2) Separate channels per status (success / needs-review / failed / summary)"
    echo "${C_WARN}⚠  Separate channels: Discord binds each webhook to ONE channel, so${C_RESET}"
    echo "${C_WARN}   EACH channel needs its own webhook link (4 links for option 2).${C_RESET}"
    printf "Choose [1/2, default 1]: "
    read -r DISCORD_MODE || DISCORD_MODE=""
    ask_url() { # <label>
      local url
      printf "  %s webhook URL: " "$1" >&2
      read -r url || url=""
      printf '%s' "$url"
    }
    if [ "$DISCORD_MODE" = "2" ]; then
      U_SUCCESS="$(ask_url "success")"
      U_REVIEW="$(ask_url "needs-review")"
      U_FAILED="$(ask_url "failed")"
      U_SUMMARY="$(ask_url "summary (optional, enter to fall back to success)")"
    else
      U_ALL="$(ask_url "the one shared")"
      U_SUCCESS="$U_ALL"; U_REVIEW="$U_ALL"; U_FAILED="$U_ALL"; U_SUMMARY="$U_ALL"
    fi
    if [ -z "$U_SUCCESS" ]; then
      warn "no webhook URL entered — writing Discord as disabled; enable later with 'applyr setup'."
      write_disabled_discord
    else
      jq -n --arg s "$U_SUCCESS" --arg r "$U_REVIEW" --arg f "$U_FAILED" --arg m "$U_SUMMARY" \
        '{enabled: true, webhooks: ({success: $s, needs_review: $r, failed: $f} + (if $m == "" then {} else {summary: $m} end))}' \
        > "$DISCORD_LIVE"
      say "wrote $DISCORD_LIVE (Discord enabled)."
    fi
  else
    write_disabled_discord
    say "Discord skipped — outcomes stay local (state files + TUI). Enable any time with 'applyr setup'."
  fi
else
  write_disabled_discord
  say "non-interactive install — wrote $DISCORD_LIVE as disabled (enable via 'applyr setup')."
fi

# --- 3. Harness detection (Phase 15 + 16: all four major coding agents) -------
# Detected agents are offered in full-capability-first order; Codex and
# Copilot run the documented degraded path (no browser automation by
# default) — see the "Harness capability matrix" in AGENTS.md.
DETECTED=""
label_for() {
  case "$1" in
    opencode) echo "opencode" ;;
    claude)   echo "Claude Code" ;;
    codex)    echo "Codex CLI          (API boards only unless browser tooling is configured)" ;;
    copilot)  echo "GitHub Copilot CLI (API boards only unless browser tooling is configured)" ;;
  esac
}
for AGENT in opencode claude codex copilot; do
  command -v "$AGENT" >/dev/null 2>&1 && DETECTED="$DETECTED $AGENT"
done
DETECTED="${DETECTED# }"

if [ -z "$DETECTED" ]; then
  warn "no supported coding agent found (opencode, claude, codex, or copilot)."
  warn "install one, then re-run: https://opencode.ai · https://claude.com/claude-code"
  warn "  · https://developers.openai.com/codex/cli · https://docs.github.com/copilot"
fi

if [ -f "config/harness.json" ]; then
  say "config/harness.json exists — keeping it ($(jq -r '.harness // "?"' config/harness.json))."
else
  HARNESS=""
  set -- $DETECTED
  if [ "$#" -gt 1 ] && [ -t 0 ]; then
    # More than one agent installed and we can ask — let the user choose.
    echo
    echo "Which coding agent should applyr use for runs?"
    i=1
    for AGENT in $DETECTED; do
      echo "  $i) $(label_for "$AGENT")"
      i=$((i + 1))
    done
    printf "Choose [1-%s, default 1]: " "$#"
    read -r CHOICE || CHOICE=""
    case "$CHOICE" in
      *[!0-9]*|"") CHOICE=1 ;;
    esac
    [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le "$#" ] || CHOICE=1
    i=1
    for AGENT in $DETECTED; do
      [ "$i" -eq "$CHOICE" ] && HARNESS="$AGENT"
      i=$((i + 1))
    done
  elif [ "$#" -ge 1 ]; then
    HARNESS="$1"
  fi
  if [ -n "$HARNESS" ]; then
    printf '{\n  "harness": "%s"\n}\n' "$HARNESS" > config/harness.json
    say "wrote config/harness.json (harness: $HARNESS — change any time by editing the file or re-running this installer)."
  else
    say "skipped config/harness.json — no supported coding agent detected yet."
  fi
fi

# --- 4. User profile (safe_fields) ---------------------------------------
# Asked only when the live config still holds placeholders, and only on a
# real terminal. Every value lands in gitignored local config — nothing
# leaves this machine.
profile_placeholder() {
  local v
  v="$(jq -r ".safe_fields.$1 // \"\"" config/targets.json 2>/dev/null || echo "")"
  [ -z "$v" ] || [ "$v" = "REPLACE_ME" ]
}

if [ -t 0 ] && profile_placeholder "first_name"; then
  echo
  echo "${C_NOTICE}🔒  Privacy: everything you enter below is kept LOCALLY ONLY.${C_RESET}"
  echo "${C_NOTICE}    It is written to gitignored files on this machine (config/, data/resumes/)${C_RESET}"
  echo "${C_NOTICE}    and is never committed, uploaded, or shared.${C_RESET}"
  echo
  echo "Your profile — used only to fill application forms (press enter to skip a field):"
  # bash 3.2 (macOS default) + set -u: expanding an empty array errors, so
  # collect the jq assignments as a filter string + parallel --arg list,
  # tracking the count in a plain counter.
  JQ_FILTER="."
  N=0
  for field in \
    "first_name:First name" \
    "last_name:Last name" \
    "email:Email" \
    "phone:Phone" \
    "linkedin_url:LinkedIn URL" \
    "github_url:GitHub URL" \
    "graduation_date:Graduation date (Month Year)"; do
    key="${field%%:*}"; label="${field#*:}"
    printf "  %s: " "$label"
    read -r VALUE || VALUE=""
    if [ -n "$VALUE" ]; then
      JQ_FILTER="$JQ_FILTER | .safe_fields.$key = \$v$N"
      eval "JQ_V$N=\$VALUE"
      N=$((N + 1))
    fi
  done
  if [ "$N" -gt 0 ]; then
    TMP="$(mktemp)"
    set --
    i=0
    while [ $i -lt "$N" ]; do
      eval "set -- \"\$@\" --arg \"v$i\" \"\$JQ_V$i\""
      i=$((i + 1))
    done
    jq "$@" "$JQ_FILTER" config/targets.json > "$TMP" && mv "$TMP" config/targets.json
    say "profile written to config/targets.json (gitignored — run 'applyr setup' to edit the rest)."
  else
    say "profile skipped — run 'applyr setup' any time to fill it in."
  fi
fi

mkdir -p data/resumes
echo
echo "${C_NOTICE}📄  Resumes: add your base resumes (markdown + matching PDF) to${C_RESET}"
echo "${C_NOTICE}    $PROJECT_ROOT/data/resumes/${C_RESET}"
echo "${C_NOTICE}    See docs/SETUP.md for the expected filenames — applyr picks one per${C_RESET}"
echo "${C_NOTICE}    job by category and tailors it. This folder is gitignored — local only.${C_RESET}"
echo

# --- 5. Claude Code headless permissions (opt-in, asks first) ----------------
# Headless runs need pre-approved tools; this file grants Claude Code broad
# repo-local permissions, so it is only created with explicit consent.
if command -v claude >/dev/null 2>&1 && [ ! -f ".claude/settings.json" ]; then
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

# --- 6. Agent definitions ------------------------------------------------------
python3 scripts/validate/generate_agent_definitions.py

# --- 7. Validate (also auto-seeds vetted Ashby/Lever slugs) --------------------
if bash scripts/validate/validate_local_config.sh; then
  say "config valid."
else
  warn "config not valid yet — edit the files named above (or run 'applyr setup'), then re-run:"
  warn "  bash scripts/validate/validate_local_config.sh"
fi

# --- 8. TUI / extension (optional) ---------------------------------------------
build_node_surface() {
  local dir="$1" label="$2"
  if [ ! -f "$dir/package.json" ]; then
    return 0
  fi
  if [ -d "$dir/node_modules" ] && [ -d "$dir/dist" ]; then
    say "$label already installed."
    return 0
  fi
  say "building $label ($dir/) …"
  (cd "$dir" && npm install --silent && npm run build --silent) \
    && say "$label ready." \
    || warn "$label build failed — see docs/SETUP.md."
}

if command -v npm >/dev/null 2>&1; then
  build_node_surface app "the TUI"
  build_node_surface extension "the browser extension"
else
  say "node/npm not found — skipping the optional TUI and browser extension (docs/SETUP.md)."
fi

# --- 9. `applyr` command on PATH ------------------------------------------------
# One-command install ends with a working `applyr`: a tiny wrapper in
# ~/.local/bin (override with APPLYR_BIN) pins APPLYR_ROOT to this
# checkout. Never overwrites a foreign `applyr` binary.
if [ -f "app/dist/cli.js" ] && command -v node >/dev/null 2>&1; then
  BIN_DIR="${APPLYR_BIN:-$HOME/.local/bin}"
  WRAPPER="$BIN_DIR/applyr"
  if [ -e "$WRAPPER" ] && ! grep -q "applyr wrapper" "$WRAPPER" 2>/dev/null; then
    warn "$WRAPPER exists and is not applyr's wrapper — leaving it alone."
  else
    mkdir -p "$BIN_DIR"
    cat > "$WRAPPER" <<WRAP
#!/bin/sh
# applyr wrapper — generated by scripts/install/install.sh; safe to delete.
APPLYR_ROOT="\${APPLYR_ROOT:-$PROJECT_ROOT}" exec node "$PROJECT_ROOT/app/dist/cli.js" "\$@"
WRAP
    chmod +x "$WRAPPER"
    say "installed the applyr command: $WRAPPER"
    case ":$PATH:" in
      *":$BIN_DIR:"*) ;;
      *) warn "$BIN_DIR is not on your PATH — add it (e.g. export PATH=\"$BIN_DIR:\$PATH\" in your shell profile)." ;;
    esac
  fi
fi

say "done. Try: applyr   (updates auto-install on every run/launch; APPLYR_AUTO_UPDATE=0 disables, 'applyr update' runs one manually)."
