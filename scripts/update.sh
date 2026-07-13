#!/bin/bash
# update.sh — self-updater.
#
# Compares the local VERSION file against upstream main and, when they
# differ, updates the install in place:
#   - git checkout:        git pull --ff-only origin main
#   - tarball install:     download the main tarball and overlay it
# Per-user files (config/*.json live configs, data/, logs/, resumes/,
# .playwright-mcp/) are never touched — they are gitignored and absent
# from the tarball, so an overlay cannot clobber them.
#
# After updating: regenerate agent definitions, revalidate config
# (warn-only), and rebuild the TUI when node is available.
#
#   bash scripts/update.sh          # manual, verbose
#   bash scripts/update.sh --auto   # hook mode: quiet network failures,
#                                   # ALWAYS exits 0 (fail-open) so a dead
#                                   # network never blocks a scheduled run
#
# Machine-parseable result line (always printed, last):
#   update: up-to-date <version>
#   update: updated <old> -> <new>
#   update: check-failed <reason>        (auto mode: exit 0)
#   update: failed <reason>              (auto mode: exit 0)
#
# Env overrides (testing / forks):
#   APPLYR_UPDATE_URL    VERSION url   (default: raw main VERSION)
#   APPLYR_TARBALL_URL   tarball url   (default: codeload main tar.gz)
#   APPLYR_AUTO_UPDATE=0 disables the runner/TUI hooks (they check it,
#                        not this script)
set -euo pipefail

# The whole script runs from main() so bash parses it completely before
# executing — required because the tarball overlay rewrites this very
# file mid-run.
main() {
  local AUTO=0
  [ "${1:-}" = "--auto" ] && AUTO=1

  local SCRIPT_DIR ROOT
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  cd "$ROOT"

  say()  { [ "$AUTO" -eq 1 ] || echo "update: $*"; }
  fail_open() { # <result-line>
    echo "$1"
    [ "$AUTO" -eq 1 ] && exit 0 || exit 1
  }

  command -v curl >/dev/null 2>&1 || fail_open "update: check-failed curl not installed"

  local VERSION_URL TARBALL_URL LOCAL REMOTE
  VERSION_URL="${APPLYR_UPDATE_URL:-https://raw.githubusercontent.com/keshm2/ares/main/VERSION}"
  TARBALL_URL="${APPLYR_TARBALL_URL:-https://codeload.github.com/keshm2/ares/tar.gz/refs/heads/main}"
  LOCAL="$(cat VERSION 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$LOCAL" ] || LOCAL="unknown"
  REMOTE="$(curl -fsSL --max-time 10 "$VERSION_URL" 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$REMOTE" ] || fail_open "update: check-failed could not fetch $VERSION_URL"

  if [ "$REMOTE" = "$LOCAL" ]; then
    echo "update: up-to-date $LOCAL"
    exit 0
  fi

  # One updater at a time; a held lock means someone else is already on it.
  # The trap expands the path NOW (double quotes): main()'s locals are out
  # of scope by the time the EXIT trap fires.
  local UPDATE_LOCK="$ROOT/logs/.update.lock"
  mkdir -p logs
  if ! mkdir "$UPDATE_LOCK" 2>/dev/null; then
    # A lock older than 30 min is a crashed updater — reclaim it so a
    # one-off failure can never silently disable updates forever.
    local now mtime age_min
    now=$(date +%s)
    mtime=$(stat -f %m "$UPDATE_LOCK" 2>/dev/null || stat -c %Y "$UPDATE_LOCK" 2>/dev/null || echo "$now")
    age_min=$(( (now - mtime) / 60 ))
    if [ "$age_min" -ge 30 ]; then
      say "reclaiming stale update lock (${age_min}min old)"
      rmdir "$UPDATE_LOCK" 2>/dev/null || rm -rf "$UPDATE_LOCK"
    fi
    if ! mkdir "$UPDATE_LOCK" 2>/dev/null; then
      fail_open "update: check-failed another update is in progress"
    fi
  fi
  # shellcheck disable=SC2064 — early expansion is intentional
  trap "rmdir '$UPDATE_LOCK' 2>/dev/null || true" EXIT

  say "updating $LOCAL -> $REMOTE …"
  if [ -d .git ] && command -v git >/dev/null 2>&1; then
    # Developer / git checkout: fast-forward only — a dirty or diverged
    # tree is the operator's to resolve, never force-resolved here.
    if ! git pull --ff-only origin main >/dev/null 2>&1; then
      fail_open "update: failed git pull --ff-only (dirty or diverged checkout — resolve manually)"
    fi
  else
    # Tarball install (the cURL one-liner path): overlay project files.
    local TMP_TGZ
    TMP_TGZ="$(mktemp)"
    if ! curl -fsSL --max-time 120 "$TARBALL_URL" -o "$TMP_TGZ"; then
      rm -f "$TMP_TGZ"
      fail_open "update: failed tarball download"
    fi
    if ! tar -xzf "$TMP_TGZ" --strip-components=1 -C "$ROOT"; then
      rm -f "$TMP_TGZ"
      fail_open "update: failed tarball extract"
    fi
    rm -f "$TMP_TGZ"
  fi

  local NEW
  NEW="$(cat VERSION 2>/dev/null | tr -d '[:space:]' || echo "$REMOTE")"

  # Post-update maintenance — each step warn-only so a hiccup here never
  # bricks an already-updated install.
  python3 scripts/generate_agent_definitions.py >/dev/null 2>&1 \
    || say "WARNING: agent-definition regeneration failed — run scripts/generate_agent_definitions.py"
  bash scripts/validate_local_config.sh >/dev/null 2>&1 \
    || say "WARNING: config validation reported issues — run scripts/validate_local_config.sh"
  if command -v npm >/dev/null 2>&1 && [ -f app/package.json ]; then
    (cd app && npm install --silent >/dev/null 2>&1 && npm run build --silent >/dev/null 2>&1) \
      || say "WARNING: TUI rebuild failed — run: cd app && npm install && npm run build"
  else
    say "node/npm not found — skipped the TUI rebuild"
  fi

  echo "update: updated $LOCAL -> $NEW"
}

main "$@"
