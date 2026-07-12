#!/bin/bash
# Job application agent — cron-driven entry point.
# Schedule: crontab -e, then add: 0 2 * * * /full/path/to/ares/scripts/run_job_agent.sh
# Adjust the cd path below to your actual project root.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

mkdir -p data logs

RUN_LOG="logs/run_job_agent.log"

# --- Overlap protection (portable, macOS-safe, no flock) --------------------
# mkdir is atomic on macOS/Linux, so a lock directory is a portable lock.
# A pid file inside it lets us detect and reclaim a stale lock left by a
# crashed previous run (kill -0 is portable). Phase 8 adds an age
# threshold: a lock whose holder is still alive but older than
# LOCK_MAX_AGE_MIN is treated as a hung run — the holder is terminated
# and the lock reclaimed, so a wedged run never permanently blocks the
# 30-minute schedule (and no second agent ever runs concurrently).
LOCK_DIR="logs/.run_job_agent.lock"
LOCK_PID="$LOCK_DIR/pid"
LOCK_MAX_AGE_MIN="${ARES_LOCK_MAX_AGE_MIN:-60}"

lock_age_min() {
  local now lock_mtime
  now=$(date +%s)
  lock_mtime=$(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || echo "$now")
  echo $(( (now - lock_mtime) / 60 ))
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_PID"
    return 0
  fi
  local old_pid age
  old_pid="$(cat "$LOCK_PID" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && ! kill -0 "$old_pid" 2>/dev/null; then
    # Stale lock — holder is no longer alive. Reclaim it.
    echo "[$(date)] stale_lock_reclaimed: holder pid $old_pid is dead" >> "$RUN_LOG"
    rm -rf "$LOCK_DIR"
  elif [ -n "$old_pid" ]; then
    age="$(lock_age_min)"
    if [ "$age" -ge "$LOCK_MAX_AGE_MIN" ]; then
      # Hung run — older than the threshold. Terminate it, then reclaim.
      echo "[$(date)] stale_lock_reclaimed: holder pid $old_pid alive but lock is ${age}min old (threshold ${LOCK_MAX_AGE_MIN}min) — terminating" >> "$RUN_LOG"
      kill "$old_pid" 2>/dev/null || true
      sleep 5
      kill -9 "$old_pid" 2>/dev/null || true
      rm -rf "$LOCK_DIR"
    else
      return 1
    fi
  else
    return 1
  fi
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_PID"
    return 0
  fi
  return 1
}

if ! acquire_lock; then
  echo "[$(date)] skipped_overlap: another run is already in progress (lock: $LOCK_DIR, age $(lock_age_min)min)" >> "$RUN_LOG"
  exit 0
fi
trap 'rm -rf "$LOCK_DIR" 2>/dev/null' EXIT

# --- Config validation -----------------------------------------------------
# Fails fast on missing/invalid live config or missing required fields.
# Placeholder Ashby/Lever slugs produce warnings but do not block the run.
if ! bash scripts/validate_local_config.sh "$PROJECT_ROOT"; then
  echo "[$(date)] ABORTED: local config validation failed. Run manually to fix." >> "$RUN_LOG"
  exit 1
fi

# --- Ensure persistent state files exist as valid JSON arrays ---------------
bash scripts/append_state_entry.sh ensure data/applied_jobs.json \
  || { echo "[$(date)] ABORTED: failed to ensure data/applied_jobs.json. Run manually to fix." >> "$RUN_LOG"; exit 1; }
bash scripts/append_state_entry.sh ensure data/review_queue.json \
  || { echo "[$(date)] ABORTED: failed to ensure data/review_queue.json. Run manually to fix." >> "$RUN_LOG"; exit 1; }

# --- Ensure canonical registry + internal event log (Phase 1) --------------
python3 scripts/job_state.py ensure-files \
  || { echo "[$(date)] ABORTED: failed to ensure canonical registry/event files. Run manually to fix." >> "$RUN_LOG"; exit 1; }

# --- Agent-definition drift check (Phase 15) --------------------------------
# The per-harness definitions are generated from agents/. A stale generated
# file means the harnesses have diverged — warn loudly but do not block.
python3 scripts/generate_agent_definitions.py --check \
  || echo "[$(date)] WARNING: generated agent definitions are stale — run scripts/generate_agent_definitions.py" >> "$RUN_LOG"

# --- Harness selection (Phase 15) -------------------------------------------
# Priority: $ARES_HARNESS > config/harness.json > auto-detect (opencode,
# then claude). The harness only supplies LLM orchestration; every board
# fetch, helper, and state write is identical downstream.
HARNESS="${ARES_HARNESS:-}"
if [ -z "$HARNESS" ] && [ -f "config/harness.json" ]; then
  HARNESS="$(jq -r '.harness // empty' config/harness.json 2>/dev/null || true)"
fi
if [ -z "$HARNESS" ]; then
  if command -v opencode >/dev/null 2>&1; then
    HARNESS="opencode"
  elif command -v claude >/dev/null 2>&1; then
    HARNESS="claude"
  fi
fi
case "$HARNESS" in
  opencode|claude) ;;
  "")
    echo "[$(date)] ABORTED: no supported harness found (opencode or claude). Install one or set config/harness.json." >> "$RUN_LOG"
    exit 1
    ;;
  *)
    echo "[$(date)] ABORTED: unsupported harness '$HARNESS' (supported: opencode, claude)." >> "$RUN_LOG"
    exit 1
    ;;
esac

# --- Outcome-count snapshot (Phase 8 health marker) --------------------------
# Counts are per-run deltas: snapshot before, subtract after. skipped_unfit
# lives only in the event log; the others in applied_jobs.json.
count_outcomes() {
  jq -r 'map(.status) | "applied=\(map(select(. == "applied")) | length) needs_review=\(map(select(. == "needs_review")) | length) failed=\(map(select(. == "failed")) | length)"' \
    data/applied_jobs.json 2>/dev/null || echo "applied=0 needs_review=0 failed=0"
}
count_skipped_unfit() {
  awk '/"status": *"skipped_unfit"/ {n++} END {print n+0}' data/job_events.jsonl 2>/dev/null || echo 0
}
BEFORE_COUNTS="$(count_outcomes)"
BEFORE_SKIPPED="$(count_skipped_unfit)"

# --- Run the agent ---------------------------------------------------------
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SESSION_LOG="logs/session_${TIMESTAMP}.log"
echo "run_job_agent: start $(date -u +%Y-%m-%dT%H:%M:%SZ) harness=$HARNESS" >> "$SESSION_LOG"

RUN_PROMPT="Start a new job application run. Read AGENTS.md, load data/applied_jobs.json
   and config/targets.json, scrape all configured job boards, deduplicate,
   tailor and apply to matching roles within the session cap, and send a
   Discord summary when complete."

echo "[$(date)] Starting run via harness: $HARNESS" >> "$RUN_LOG"

RUN_RC=0
if [ "$HARNESS" = "opencode" ]; then
  opencode run \
    --agent job-scraper \
    --print \
    "$RUN_PROMPT" \
    >> "$SESSION_LOG" 2>&1 || RUN_RC=$?
else
  # Claude Code headless: CLAUDE.md (canonical rules pointer) and the
  # .claude/agents/ subagents load automatically; the orchestrator body is
  # the shared source read explicitly since -p mode has no --agent flag.
  claude -p \
    "You are the job-scraper orchestrator. Read agents/bodies/job-scraper.md and execute it exactly as your instructions. $RUN_PROMPT" \
    >> "$SESSION_LOG" 2>&1 || RUN_RC=$?
fi

# --- Health marker + heartbeat (Phase 8) -------------------------------------
# Per-run outcome deltas; the "complete" line is the canonical alive signal.
AFTER_COUNTS="$(count_outcomes)"
AFTER_SKIPPED="$(count_skipped_unfit)"
delta() { # delta <key> <before-line> <after-line>
  local key="$1" b a
  b="$(printf '%s' "$2" | tr ' ' '\n' | sed -n "s/^${key}=//p")"
  a="$(printf '%s' "$3" | tr ' ' '\n' | sed -n "s/^${key}=//p")"
  echo $(( ${a:-0} - ${b:-0} ))
}
D_APPLIED="$(delta applied "$BEFORE_COUNTS" "$AFTER_COUNTS")"
D_REVIEW="$(delta needs_review "$BEFORE_COUNTS" "$AFTER_COUNTS")"
D_FAILED="$(delta failed "$BEFORE_COUNTS" "$AFTER_COUNTS")"
D_SKIPPED=$(( AFTER_SKIPPED - BEFORE_SKIPPED ))

python3 scripts/write_heartbeat.py --exit-code "$RUN_RC" \
  --applied "$D_APPLIED" --needs-review "$D_REVIEW" \
  --failed "$D_FAILED" --skipped-unfit "$D_SKIPPED" || true

# --- Session-log retention (keep the newest N; no external shipper) ----------
KEEP_SESSIONS="${ARES_KEEP_SESSION_LOGS:-30}"
ls -1t logs/session_*.log 2>/dev/null | tail -n +"$((KEEP_SESSIONS + 1))" | while read -r old; do
  rm -f "$old"
done

if [ "$RUN_RC" -ne 0 ]; then
  echo "run_job_agent: failed $(date -u +%Y-%m-%dT%H:%M:%SZ) rc=$RUN_RC applied=$D_APPLIED needs_review=$D_REVIEW failed=$D_FAILED skipped_unfit=$D_SKIPPED" >> "$SESSION_LOG"
  echo "[$(date)] FAILED: $HARNESS run exited non-zero (rc=$RUN_RC). Log: $SESSION_LOG" >> "$RUN_LOG"
  exit "$RUN_RC"
fi

COMPLETE_LINE="run_job_agent: complete $(date -u +%Y-%m-%dT%H:%M:%SZ) applied=$D_APPLIED needs_review=$D_REVIEW failed=$D_FAILED skipped_unfit=$D_SKIPPED"
echo "$COMPLETE_LINE" >> "$SESSION_LOG"
echo "$COMPLETE_LINE" >> "$RUN_LOG"