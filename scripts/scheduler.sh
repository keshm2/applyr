#!/bin/bash
# scheduler.sh — always-on 30-minute schedule management (Phase 8).
#
# macOS: manages a launchd user agent (label com.applyr.job-agent) that
# runs scripts/run_job_agent.sh every 30 minutes, 24/7, starting at
# load. Overlap protection lives in the run script itself (lock dir +
# skip-on-overlap + stale-lock reclamation) — launchd only supplies the
# cadence. Linux: prints the equivalent systemd user timer to install
# by hand (documented in docs/SETUP.md).
#
# Usage:
#   bash scripts/scheduler.sh install     # write plist + load (starts a run!)
#   bash scripts/scheduler.sh uninstall   # unload + remove plist
#   bash scripts/scheduler.sh status      # schedule state + heartbeat
#   bash scripts/scheduler.sh plist       # print the plist (dry run)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.applyr.job-agent"
# Pre-rename installs used this label; install/uninstall clean it up so a
# renamed deployment never runs two schedules.
OLD_LABEL="com.ares.job-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OLD_PLIST="$HOME/Library/LaunchAgents/$OLD_LABEL.plist"
INTERVAL="${APPLYR_SCHEDULE_INTERVAL_SEC:-${ARES_SCHEDULE_INTERVAL_SEC:-1800}}"

plist_body() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PROJECT_ROOT/scripts/run_job_agent.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT_ROOT</string>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$PROJECT_ROOT/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$PROJECT_ROOT/logs/launchd.err.log</string>
</dict>
</plist>
PLIST
}

case "${1:-}" in
  plist)
    plist_body
    ;;
  install)
    if [ "$(uname)" != "Darwin" ]; then
      echo "scheduler: this installer manages launchd (macOS)." >&2
      echo "On Linux, install a systemd user timer — see docs/SETUP.md section 5." >&2
      exit 1
    fi
    mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT_ROOT/logs"
    plist_body > "$PLIST"
    plutil -lint "$PLIST" >/dev/null
    launchctl bootout "gui/$(id -u)/$OLD_LABEL" 2>/dev/null || true
    rm -f "$OLD_PLIST"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "scheduler: installed $LABEL (every $((INTERVAL / 60)) min, 24/7)."
    echo "scheduler: NOTE — RunAtLoad is true: a run starts now."
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootout "gui/$(id -u)/$OLD_LABEL" 2>/dev/null || true
    rm -f "$PLIST" "$OLD_PLIST"
    echo "scheduler: uninstalled $LABEL."
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "scheduler: $LABEL is loaded (interval $((INTERVAL / 60)) min)."
    else
      echo "scheduler: $LABEL is NOT loaded."
    fi
    if [ -f "$PROJECT_ROOT/logs/heartbeat.json" ]; then
      echo "heartbeat:"
      cat "$PROJECT_ROOT/logs/heartbeat.json"
    else
      echo "heartbeat: none yet (no completed runs)."
    fi
    ;;
  *)
    echo "usage: scheduler.sh install|uninstall|status|plist" >&2
    exit 1
    ;;
esac
