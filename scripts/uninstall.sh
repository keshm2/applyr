#!/bin/bash
# uninstall.sh — dedicated uninstaller for bash/cURL installs.
#
#   bash scripts/uninstall.sh          # interactive (asks before deleting)
#   bash scripts/uninstall.sh --yes    # no prompts (still prints what it did)
#   bash scripts/uninstall.sh --keep-data
#                                      # remove schedule + command, keep the
#                                      # install directory (config/data/resumes)
#
# What it removes, in order:
#   1. The launchd schedule (scripts/scheduler.sh uninstall).
#   2. The `applyr` wrapper on PATH — only if it is applyr's own wrapper
#      pointing at THIS install.
#   3. The install directory itself — this holds your live config, data,
#      logs, and resumes (PII), so it is only deleted after an explicit
#      confirmation (or --yes).
#
# npm installs: `npm uninstall -g @keshm/applyr` removes the globally
# installed TUI command (this script prints a reminder when it detects
# one). The npm package never owns the core directory — this script does.
set -euo pipefail

# main() wrapper: the script deletes its own file near the end; bash must
# have parsed everything before that happens.
main() {
  local YES=0 KEEP_DATA=0
  for arg in "$@"; do
    case "$arg" in
      --yes|-y) YES=1 ;;
      --keep-data) KEEP_DATA=1 ;;
      *) echo "uninstall: unknown option: $arg" >&2; exit 1 ;;
    esac
  done

  local SCRIPT_DIR ROOT
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  cd "$ROOT"

  say() { echo "uninstall: $*"; }

  # 1. Schedule.
  if [ -f "scripts/scheduler.sh" ]; then
    bash scripts/scheduler.sh uninstall >/dev/null 2>&1 \
      && say "removed the launchd schedule." \
      || say "no schedule installed (or not macOS) — skipped."
  fi

  # 2. PATH wrapper — only applyr's own, and only if it points here.
  local BIN_DIR WRAPPER
  BIN_DIR="${APPLYR_BIN:-$HOME/.local/bin}"
  WRAPPER="$BIN_DIR/applyr"
  if [ -f "$WRAPPER" ] && grep -q "applyr wrapper" "$WRAPPER" 2>/dev/null; then
    if grep -q "$ROOT" "$WRAPPER" 2>/dev/null; then
      rm -f "$WRAPPER"
      say "removed the applyr command ($WRAPPER)."
    else
      say "$WRAPPER points at a different install — left alone."
    fi
  fi

  # npm-installed TUI reminder (the package never owns the core dir).
  if command -v npm >/dev/null 2>&1 \
     && npm ls -g @keshm/applyr >/dev/null 2>&1; then
    say "npm package detected — also run: npm uninstall -g @keshm/applyr"
  fi

  # 3. The install directory (config, data, logs, resumes — PII).
  if [ "$KEEP_DATA" -eq 1 ]; then
    say "kept the install directory ($ROOT) — delete it later with: rm -rf '$ROOT'"
    say "done."
    exit 0
  fi
  if [ "$YES" -ne 1 ]; then
    if [ -t 0 ]; then
      echo
      echo "About to permanently delete the install directory and EVERYTHING in it:"
      echo "  $ROOT"
      echo "This includes your live config, application history (data/), logs, and resumes/."
      printf "Delete it? [y/N] "
      local REPLY
      read -r REPLY || REPLY=""
      if [ "$REPLY" != "y" ] && [ "$REPLY" != "Y" ]; then
        say "kept the install directory ($ROOT). Re-run with --yes (or rm -rf it) when ready."
        say "done."
        exit 0
      fi
    else
      say "non-interactive and no --yes: keeping the install directory ($ROOT)."
      say "done."
      exit 0
    fi
  fi
  cd /
  rm -rf "$ROOT"
  echo "uninstall: removed $ROOT. applyr is uninstalled."
}

main "$@"
