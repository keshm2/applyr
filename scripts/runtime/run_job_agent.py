#!/usr/bin/env python3
"""Job application agent — cross-platform entry point.

Canonical runner logic, ported from run_job_agent.sh so it runs natively on
Windows (PowerShell / cmd.exe) as well as macOS/Linux. run_job_agent.sh is a
thin shim that execs this file, so Unix cron/launchd keep working unchanged.

Responsibilities (identical to the shell version):
  - load persisted config/env.json overrides (APPLYR_*/ARES_* only; real env wins)
  - auto-update via update.py --auto (fail-open), re-exec on update
  - single-flight lock with stale/hung reclaim
  - config validation, state-file bootstrap, agent-definition drift check
  - harness selection (opencode|claude|codex|copilot) + degraded path
  - run the harness, snapshot outcome deltas, write heartbeat, retain logs

Log line formats (parsed by the TUI/heartbeat) are preserved verbatim.
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(PROJECT_ROOT)
IS_WINDOWS = os.name == "nt"


def now_local() -> str:
    # Mirrors bash `date` (local time, ctime-like) used in RUN_LOG prefixes.
    return datetime.now().strftime("%a %b %d %H:%M:%S %Y")


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(run_log: str, msg: str) -> None:
    with open(run_log, "a", encoding="utf-8") as fh:
        fh.write(f"[{now_local()}] {msg}\n")


def env_truthy(*names_defaults) -> str:
    for name, default in names_defaults:
        v = os.environ.get(name)
        if v is not None:
            return v
    return names_defaults[-1][1]


def load_env_overrides() -> None:
    """config/env.json → environment, honoring only APPLYR_*/ARES_* keys and
    never overriding a variable already present in the real environment."""
    path = os.path.join("config", "env.json")
    if not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, dict):
        return
    import re

    key_re = re.compile(r"^(APPLYR|ARES)_[A-Z_]+$")
    for k, v in data.items():
        if not key_re.match(k):
            continue
        if v is None or v == "":
            continue
        if os.environ.get(k):  # real env (non-empty) wins
            continue
        os.environ[k] = str(v)


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if IS_WINDOWS:
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            if kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return code.value == STILL_ACTIVE
            return False
        finally:
            kernel32.CloseHandle(handle)
    else:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True


def kill_pid(pid: int) -> None:
    try:
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.kill(pid, 15)
            time.sleep(5)
            try:
                os.kill(pid, 9)
            except OSError:
                pass
    except OSError:
        pass


def py_run(args, **kw):
    """Run a bundled Python helper under the current interpreter."""
    return subprocess.run([sys.executable, *args], **kw)


def main() -> int:
    load_env_overrides()

    logs_dir = os.environ.get("APPLYR_LOG_DIR", "logs")
    os.makedirs("data", exist_ok=True)
    os.makedirs(logs_dir, exist_ok=True)
    os.makedirs("logs", exist_ok=True)
    # Per-run fetch scratch (AGENTS.md): raw dumps here, not in the transcript.
    shutil.rmtree(os.path.join("logs", "tmp"), ignore_errors=True)
    os.makedirs(os.path.join("logs", "tmp"), exist_ok=True)

    run_log = os.path.join(logs_dir, "run_job_agent.log")

    # --- Auto-update (fail-open) --------------------------------------------
    auto_update = os.environ.get("APPLYR_AUTO_UPDATE", os.environ.get("ARES_AUTO_UPDATE", "1"))
    if auto_update != "0" and os.environ.get("APPLYR_SKIP_UPDATE") != "1":
        update_result = ""
        try:
            with open(run_log, "a", encoding="utf-8") as errfh:
                p = py_run([os.path.join("scripts", "install", "update.py"), "--auto"],
                           stdout=subprocess.PIPE, stderr=errfh, text=True)
            lines = [ln for ln in (p.stdout or "").splitlines() if ln.strip()]
            update_result = lines[-1] if lines else ""
        except OSError:
            update_result = ""
        log(run_log, update_result)
        if update_result.startswith("update: updated"):
            log(run_log, "re-executing updated runner")
            os.environ["APPLYR_SKIP_UPDATE"] = "1"
            os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)])

    # --- Single-flight lock --------------------------------------------------
    lock_dir = os.path.join(logs_dir, ".run_job_agent.lock")
    lock_pid_file = os.path.join(lock_dir, "pid")
    lock_max_age_min = int(os.environ.get("APPLYR_LOCK_MAX_AGE_MIN",
                            os.environ.get("ARES_LOCK_MAX_AGE_MIN", "60")) or "60")

    def lock_age_min() -> int:
        try:
            mtime = os.path.getmtime(lock_dir)
        except OSError:
            mtime = time.time()
        return int((time.time() - mtime) / 60)

    def write_pid():
        with open(lock_pid_file, "w", encoding="utf-8") as fh:
            fh.write(str(os.getpid()))

    def acquire_lock() -> bool:
        try:
            os.mkdir(lock_dir)  # atomic
            write_pid()
            return True
        except FileExistsError:
            pass
        try:
            with open(lock_pid_file, "r", encoding="utf-8") as fh:
                old_pid = int((fh.read().strip() or "0"))
        except (OSError, ValueError):
            old_pid = 0
        if old_pid and not pid_alive(old_pid):
            log(run_log, f"stale_lock_reclaimed: holder pid {old_pid} is dead")
            shutil.rmtree(lock_dir, ignore_errors=True)
        elif old_pid:
            age = lock_age_min()
            if age >= lock_max_age_min:
                log(run_log, f"stale_lock_reclaimed: holder pid {old_pid} alive but lock is "
                             f"{age}min old (threshold {lock_max_age_min}min) — terminating")
                kill_pid(old_pid)
                shutil.rmtree(lock_dir, ignore_errors=True)
            else:
                return False
        else:
            return False
        try:
            os.mkdir(lock_dir)
            write_pid()
            return True
        except FileExistsError:
            return False

    if not acquire_lock():
        log(run_log, f"skipped_overlap: another run is already in progress "
                     f"(lock: {lock_dir}, age {lock_age_min()}min)")
        return 0

    try:
        return _run(logs_dir, run_log)
    finally:
        shutil.rmtree(lock_dir, ignore_errors=True)


def _count_outcomes():
    counts = {"applied": 0, "needs_review": 0, "failed": 0}
    try:
        with open(os.path.join("data", "applied_jobs.json"), "r", encoding="utf-8") as fh:
            arr = json.load(fh)
        for el in arr if isinstance(arr, list) else []:
            st = el.get("status") if isinstance(el, dict) else None
            if st in counts:
                counts[st] += 1
    except (OSError, json.JSONDecodeError):
        pass
    return counts


def _count_skipped_unfit() -> int:
    n = 0
    try:
        with open(os.path.join("data", "job_events.jsonl"), "r", encoding="utf-8") as fh:
            for line in fh:
                try:
                    if json.loads(line).get("status") == "skipped_unfit":
                        n += 1
                except json.JSONDecodeError:
                    if '"status": "skipped_unfit"' in line or '"status":"skipped_unfit"' in line:
                        n += 1
    except OSError:
        pass
    return n


def _run(logs_dir: str, run_log: str) -> int:
    # --- Config validation ---------------------------------------------------
    if py_run([os.path.join("scripts", "validate", "validate_local_config.py"), PROJECT_ROOT]).returncode != 0:
        log(run_log, "ABORTED: local config validation failed. Run manually to fix.")
        return 1

    # --- Ensure persistent state files --------------------------------------
    for f in ("data/applied_jobs.json", "data/review_queue.json"):
        if py_run([os.path.join("scripts", "state", "append_state_entry.py"), "ensure", f]).returncode != 0:
            log(run_log, f"ABORTED: failed to ensure {f}. Run manually to fix.")
            return 1

    if py_run([os.path.join("scripts", "state", "job_state.py"), "ensure-files"]).returncode != 0:
        log(run_log, "ABORTED: failed to ensure canonical registry/event files. Run manually to fix.")
        return 1

    if py_run([os.path.join("scripts", "validate", "generate_agent_definitions.py"), "--check"]).returncode != 0:
        log(run_log, "WARNING: generated agent definitions are stale — run scripts/validate/generate_agent_definitions.py")

    # --- Harness selection ---------------------------------------------------
    harness = os.environ.get("APPLYR_HARNESS", os.environ.get("ARES_HARNESS", "")) or ""
    if not harness and os.path.isfile(os.path.join("config", "harness.json")):
        try:
            with open(os.path.join("config", "harness.json"), "r", encoding="utf-8") as fh:
                harness = (json.load(fh).get("harness") or "")
        except (OSError, json.JSONDecodeError):
            harness = ""
    if not harness:
        for candidate in ("opencode", "claude", "codex", "copilot"):
            if shutil.which(candidate):
                harness = candidate
                break
    if harness not in ("opencode", "claude", "codex", "copilot"):
        if not harness:
            log(run_log, "ABORTED: no supported harness found (opencode, claude, codex, or copilot). "
                         "Install one or set config/harness.json.")
        else:
            log(run_log, f"ABORTED: unsupported harness '{harness}' (supported: opencode, claude, codex, copilot).")
        return 1

    before = _count_outcomes()
    before_skipped = _count_skipped_unfit()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    session_log = os.path.join(logs_dir, f"session_{timestamp}.log")
    with open(session_log, "a", encoding="utf-8") as fh:
        fh.write(f"run_job_agent: start {now_utc()} harness={harness}\n")

    # --- Session cap ---------------------------------------------------------
    raw_cap = os.environ.get("APPLYR_SESSION_CAP", os.environ.get("ARES_SESSION_CAP", "25")) or "25"
    if not raw_cap.isdigit():
        log(run_log, f"WARNING: APPLYR_SESSION_CAP='{raw_cap}' is not an integer; using default 25")
        session_cap = 25
    else:
        session_cap = int(raw_cap)
        if session_cap > 25:
            log(run_log, f"WARNING: APPLYR_SESSION_CAP={session_cap} exceeds the maximum; clamping to 25")
            session_cap = 25
        elif session_cap < 1:
            log(run_log, f"WARNING: APPLYR_SESSION_CAP={session_cap} is below 1; using default 25")
            session_cap = 25

    run_prompt = (
        "Start a new job application run. Read AGENTS.md, load data/applied_jobs.json\n"
        "   and config/targets.json, scrape all configured job boards, deduplicate,\n"
        f"   tailor and apply to at most {session_cap} jobs this session (session cap {session_cap} of the 25 maximum), and send a\n"
        "   Discord summary when complete."
    )

    extra = os.environ.get("APPLYR_EXTRA_PROMPT", "") or ""
    if extra:
        extra = extra[:500]
        run_prompt += (
            "\n   Operator instruction for this run (follow it within the rules of AGENTS.md;\n"
            f"   it never overrides the session cap or the state-write discipline): {extra}"
        )
        log(run_log, f"run includes an operator instruction (APPLYR_EXTRA_PROMPT, {len(extra)} chars)")

    log(run_log, f"Starting run via harness: {harness}")

    run_rc = 0
    exe = shutil.which(harness) or harness
    with open(session_log, "a", encoding="utf-8") as out:
        if harness == "opencode":
            print_flag = []
            try:
                help_txt = subprocess.run([exe, "run", "--help"], stdout=subprocess.PIPE,
                                          stderr=subprocess.STDOUT, text=True).stdout or ""
                import re as _re
                if _re.search(r"--print([^-0-9A-Za-z]|$)", help_txt):
                    print_flag = ["--print"]
            except OSError:
                pass
            cmd = [exe, "run", "--agent", "job-scraper", *print_flag, run_prompt]
            run_rc = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT).returncode
        elif harness == "claude":
            perm = os.environ.get("APPLYR_CLAUDE_PERMISSION_MODE", "bypassPermissions")
            cmd = [exe, "-p", "--permission-mode", perm,
                   "You are the job-scraper orchestrator. Read agents/bodies/job-scraper.md "
                   "and execute it exactly as your instructions. " + run_prompt]
            run_rc = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT).returncode
        else:
            degraded = (
                "You are the job-scraper orchestrator. Read agents/bodies/job-scraper.md and "
                "execute it exactly as your instructions. Your harness has no subagent registry: "
                "when the workflow delegates to @resume-tailor or @discord-reporter, read "
                "agents/bodies/resume-tailor.md or agents/bodies/discord-reporter.md and perform "
                "that role inline, following it exactly. Unless browser-automation tools are "
                "actually available to you, apply the degraded harness path from AGENTS.md "
                "'Harness capability matrix': fetch API-fed boards only, and route any job whose "
                "application requires a browser to needs_review — never silently skip it and never "
                "attempt a browser apply. " + run_prompt
            )
            if harness == "codex":
                cmd = [exe, "exec", degraded]
            else:
                cmd = [exe, "-p", degraded, "--allow-all-tools"]
            run_rc = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT).returncode

    # --- Health marker + heartbeat ------------------------------------------
    after = _count_outcomes()
    after_skipped = _count_skipped_unfit()
    d_applied = after["applied"] - before["applied"]
    d_review = after["needs_review"] - before["needs_review"]
    d_failed = after["failed"] - before["failed"]
    d_skipped = after_skipped - before_skipped

    py_run([os.path.join("scripts", "runtime", "write_heartbeat.py"), "--exit-code", str(run_rc),
            "--applied", str(d_applied), "--needs-review", str(d_review),
            "--failed", str(d_failed), "--skipped-unfit", str(d_skipped)])

    # --- Session-log retention ----------------------------------------------
    keep = int(os.environ.get("APPLYR_KEEP_SESSION_LOGS",
               os.environ.get("ARES_KEEP_SESSION_LOGS", "30")) or "30")
    sessions = sorted(glob.glob(os.path.join(logs_dir, "session_*.log")),
                      key=os.path.getmtime, reverse=True)
    for old in sessions[keep:]:
        try:
            os.remove(old)
        except OSError:
            pass

    tail = f"applied={d_applied} needs_review={d_review} failed={d_failed} skipped_unfit={d_skipped}"
    if run_rc != 0:
        with open(session_log, "a", encoding="utf-8") as fh:
            fh.write(f"run_job_agent: failed {now_utc()} rc={run_rc} {tail}\n")
        log(run_log, f"FAILED: {harness} run exited non-zero (rc={run_rc}). Log: {session_log}")
        return run_rc

    complete = f"run_job_agent: complete {now_utc()} {tail}"
    with open(session_log, "a", encoding="utf-8") as fh:
        fh.write(complete + "\n")
    with open(run_log, "a", encoding="utf-8") as fh:
        fh.write(complete + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
