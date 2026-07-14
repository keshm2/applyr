import { execFileSync, spawnSync } from "node:child_process";
import { py } from "./platform.js";
import type { AppliedJob } from "./state.js";

/**
 * Every state write goes through the repo's deterministic helpers — the
 * TUI never hand-writes JSON state files. This module is the only place
 * that invokes them.
 */

function run(root: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function appendAppliedJob(root: string, entry: AppliedJob): void {
  const { cmd, args } = py([
    "scripts/state/append_state_entry.py",
    "data/applied_jobs.json",
    JSON.stringify(entry),
  ]);
  run(root, cmd, args);
}

export function recordEvent(
  root: string,
  event: {
    job_key: string;
    status: string;
    reasoning?: string;
    company?: string;
    title?: string;
    url?: string;
  },
): void {
  const { cmd, args } = py(["scripts/state/job_state.py", "record-event", JSON.stringify(event)]);
  run(root, cmd, args);
}

export interface TrackerSyncResult {
  synced: boolean;
  skipped: boolean;
  message: string;
}

/**
 * Best-effort Google Sheets internship-tracker sync — mirrors the agent
 * path's post-application step. Sends only the user-facing tracker fields
 * (company, title, date_applied, optional internship_term/notes); internal
 * fields never reach the sheet. Never throws: a disabled/unconfigured or
 * failed sync is returned as a non-synced result so the caller can surface
 * a warning without unwinding an already-recorded application.
 */
export function syncInternshipTracker(
  root: string,
  row: {
    company: string;
    title: string;
    date_applied?: string;
    internship_term?: string;
    notes?: string;
  },
): TrackerSyncResult {
  const sync = py(["scripts/jobs/sync_internship_tracker.py", JSON.stringify(row)]);
  const res = spawnSync(sync.cmd, sync.args, {
    cwd: root,
    encoding: "utf8",
  });
  const stdout = (res.stdout ?? "").trim();
  let parsed: { synced?: boolean; skipped?: boolean; reason?: string; error?: string } = {};
  try {
    parsed = stdout ? JSON.parse(stdout) : {};
  } catch {
    // non-JSON stdout — fall through to the generic failure path
  }
  if (res.status === 0) {
    if (parsed.synced) return { synced: true, skipped: false, message: "synced to internship tracker" };
    return { synced: false, skipped: true, message: parsed.reason ?? "tracker sync skipped" };
  }
  return {
    synced: false,
    skipped: false,
    message: `tracker sync failed: ${parsed.error ?? parsed.reason ?? stdout ?? `exit ${res.status}`}`,
  };
}

export interface ValidatorResult {
  ok: boolean;
  output: string;
}

export function runValidator(root: string): ValidatorResult {
  const val = py(["scripts/validate/validate_local_config.py"]);
  const res = spawnSync(val.cmd, val.args, {
    cwd: root,
    encoding: "utf8",
  });
  return {
    ok: res.status === 0,
    output: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim(),
  };
}

export function openUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`refusing to open unsupported URL protocol: ${parsed.protocol}`);
  }
  if (process.platform === "win32") {
    // `start` is a cmd.exe builtin, not an executable; the empty "" is the
    // window title so a quoted URL isn't mistaken for one.
    execFileSync("cmd", ["/c", "start", "", parsed.toString()], { stdio: "ignore" });
    return;
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  execFileSync(opener, [parsed.toString()], { stdio: "ignore" });
}

/** Message from a failed helper invocation, trimmed for display. */
export function helperError(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = String((err as { stderr: unknown }).stderr ?? "").trim();
    if (stderr) return stderr.split("\n").slice(-2).join(" ");
  }
  return err instanceof Error ? err.message : String(err);
}
