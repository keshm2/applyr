#!/bin/bash
# Job application agent — cron-driven entry point.
# Schedule: crontab -e, then add: 0 2 * * * /full/path/to/applyr/scripts/run_job_agent.sh
# Adjust the cd path below to your actual project root.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

mkdir -p data logs
# Per-run fetch scratch space (AGENTS.md fetch-efficiency rules): raw
# board dumps land here instead of the LLM transcript. Cleared per run.
rm -rf logs/tmp && mkdir -p logs/tmp

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
# APPLYR_* is the documented env-var prefix; the legacy ARES_* names are
# honored as fallbacks so pre-rename schedules keep working.
LOCK_MAX_AGE_MIN="${APPLYR_LOCK_MAX_AGE_MIN:-${ARES_LOCK_MAX_AGE_MIN:-60}}"

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

# --- Harness selection (Phase 15 + 16) ---------------------------------------
# Priority: $APPLYR_HARNESS > config/harness.json > auto-detect (opencode,
# claude, codex, copilot — full-capability harnesses first). The harness only
# supplies LLM orchestration; every board fetch, helper, and state write is
# identical downstream. Codex and Copilot run the documented degraded path
# (no subagent registry, no browser automation by default) — see the
# "Harness capability matrix" in AGENTS.md.
HARNESS="${APPLYR_HARNESS:-${ARES_HARNESS:-}}"
if [ -z "$HARNESS" ] && [ -f "config/harness.json" ]; then
  HARNESS="$(jq -r '.harness // empty' config/harness.json 2>/dev/null || true)"
fi
if [ -z "$HARNESS" ]; then
  for CANDIDATE in opencode claude codex copilot; do
    if command -v "$CANDIDATE" >/dev/null 2>&1; then
      HARNESS="$CANDIDATE"
      break
    fi
  done
fi
case "$HARNESS" in
  opencode|claude|codex|copilot) ;;
  "")
    echo "[$(date)] ABORTED: no supported harness found (opencode, claude, codex, or copilot). Install one or set config/harness.json." >> "$RUN_LOG"
    exit 1
    ;;
  *)
    echo "[$(date)] ABORTED: unsupported harness '$HARNESS' (supported: opencode, claude, codex, copilot)." >> "$RUN_LOG"
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

# --- Per-session application cap (Phase 13 TUI modes) ------------------------
# APPLYR_SESSION_CAP lets the TUI's automatic mode lower the per-session
# application cap. Default 25 (the hard maximum). Values above 25 clamp
# down to 25; values below 1 or non-integer fall back to 25 with a
# warning so a misconfigured env never blocks the run.
SESSION_CAP="${APPLYR_SESSION_CAP:-${ARES_SESSION_CAP:-25}}"
if ! [[ "$SESSION_CAP" =~ ^[0-9]+$ ]]; then
  echo "[$(date)] WARNING: APPLYR_SESSION_CAP='$SESSION_CAP' is not an integer; using default 25" >> "$RUN_LOG"
  SESSION_CAP=25
elif [ "$SESSION_CAP" -gt 25 ]; then
  echo "[$(date)] WARNING: APPLYR_SESSION_CAP=$SESSION_CAP exceeds the maximum; clamping to 25" >> "$RUN_LOG"
  SESSION_CAP=25
elif [ "$SESSION_CAP" -lt 1 ]; then
  echo "[$(date)] WARNING: APPLYR_SESSION_CAP=$SESSION_CAP is below 1; using default 25" >> "$RUN_LOG"
  SESSION_CAP=25
fi

RUN_PROMPT="Start a new job application run. Read AGENTS.md, load data/applied_jobs.json
   and config/targets.json, scrape all configured job boards, deduplicate,
   tailor and apply to at most ${SESSION_CAP} jobs this session (session cap ${SESSION_CAP} of the 25 maximum), and send a
   Discord summary when complete."

# Optional operator instruction (TUI automatic mode's prompt field).
# Appended to the run prompt, capped at 500 chars; it can narrow or focus
# the run but never overrides AGENTS.md or the helper-write discipline.
EXTRA_PROMPT="${APPLYR_EXTRA_PROMPT:-}"
if [ -n "$EXTRA_PROMPT" ]; then
  EXTRA_PROMPT="${EXTRA_PROMPT:0:500}"
  RUN_PROMPT="$RUN_PROMPT
   Operator instruction for this run (follow it within the rules of AGENTS.md;
   it never overrides the session cap or the state-write discipline): ${EXTRA_PROMPT}"
  echo "[$(date)] run includes an operator instruction (APPLYR_EXTRA_PROMPT, ${#EXTRA_PROMPT} chars)" >> "$RUN_LOG"
fi

echo "[$(date)] Starting run via harness: $HARNESS" >> "$RUN_LOG"

RUN_RC=0
if [ "$HARNESS" = "opencode" ]; then
  # Older opencode CLIs needed --print for non-interactive output; newer
  # ones (>= ~1.17) removed the flag (non-interactive is the default) and
  # exit 1 with a usage dump when they see it. Probe the installed CLI's
  # help so both generations work. The \b-free pattern must not match
  # --print-logs, which exists in both.
  OPENCODE_PRINT_FLAG=""
  if opencode run --help 2>&1 | grep -qE -- '--print([^-[:alnum:]]|$)'; then
    OPENCODE_PRINT_FLAG="--print"
  fi
  # shellcheck disable=SC2086 — flag is intentionally word-split (empty or one flag)
  opencode run \
    --agent job-scraper \
    $OPENCODE_PRINT_FLAG \
    "$RUN_PROMPT" \
    >> "$SESSION_LOG" 2>&1 || RUN_RC=$?
elif [ "$HARNESS" = "claude" ]; then
  # Claude Code headless: CLAUDE.md (canonical rules pointer) and the
  # .claude/agents/ subagents load automatically; the orchestrator body is
  # the shared source read explicitly since -p mode has no --agent flag.
  claude -p \
    "You are the job-scraper orchestrator. Read agents/bodies/job-scraper.md and execute it exactly as your instructions. $RUN_PROMPT" \
    >> "$SESSION_LOG" 2>&1 || RUN_RC=$?
else
  # Codex / Copilot (Phase 16): no subagent registry and no browser
  # automation by default, so the prompt names the inline-subagent fallback
  # and the degraded board path explicitly. Both CLIs read AGENTS.md as
  # project instructions; approval/sandbox settings live in the user's own
  # agent config (documented in docs/SETUP.md per-agent quickstarts) —
  # this adapter stays thin on purpose.
  DEGRADED_PROMPT="You are the job-scraper orchestrator. Read agents/bodies/job-scraper.md and execute it exactly as your instructions. Your harness has no subagent registry: when the workflow delegates to @resume-tailor or @discord-reporter, read agents/bodies/resume-tailor.md or agents/bodies/discord-reporter.md and perform that role inline, following it exactly. Unless browser-automation tools are actually available to you, apply the degraded harness path from AGENTS.md 'Harness capability matrix': fetch API-fed boards only, and route any job whose application requires a browser to needs_review — never silently skip it and never attempt a browser apply. $RUN_PROMPT"
  if [ "$HARNESS" = "codex" ]; then
    codex exec "$DEGRADED_PROMPT" >> "$SESSION_LOG" 2>&1 || RUN_RC=$?
  else
    copilot -p "$DEGRADED_PROMPT" --allow-all-tools >> "$SESSION_LOG" 2>&1 || RUN_RC=$?
  fi
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
KEEP_SESSIONS="${APPLYR_KEEP_SESSION_LOGS:-${ARES_KEEP_SESSION_LOGS:-30}}"
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