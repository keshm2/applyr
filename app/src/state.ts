import fs from "node:fs";
import path from "node:path";
import { logDir } from "./settings.js";
import { pidAlive } from "./platform.js";

export interface AppliedJob {
  job_id: string;
  company: string;
  title: string;
  url: string;
  apply_url?: string;
  date_applied: string;
  status: "applied" | "failed" | "needs_review";
  role_type?: string;
  source?: string;
  resume_used?: string;
  ats_score?: number;
  location_tier?: string;
  cover_letter_used?: boolean;
  reasoning?: string;
}

export interface QueueEntry extends Omit<AppliedJob, "status"> {
  status?: string;
}

export interface RegistryRecord {
  job_key: string;
  job_id: string;
  company?: string;
  title?: string;
  latest_status?: string;
  url?: string;
  internship_term?: string;
}

export interface ApplyrState {
  applied: AppliedJob[];
  queue: QueueEntry[];
  registry: RegistryRecord[];
}

function readJsonArray<T>(file: string): T[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function loadState(root: string): ApplyrState {
  return {
    applied: readJsonArray<AppliedJob>(path.join(root, "data", "applied_jobs.json")),
    queue: readJsonArray<QueueEntry>(path.join(root, "data", "review_queue.json")),
    registry: readJsonArray<RegistryRecord>(path.join(root, "data", "job_registry.json")),
  };
}

/** The user's first name from config/targets.json safe_fields — undefined
 *  until setup has filled it in (placeholders don't count). Read-only:
 *  config writes stay with the wizard/installer. */
export function userFirstName(root: string): string | undefined {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, "config", "targets.json"), "utf8"),
    ) as { safe_fields?: { first_name?: string } };
    const name = (parsed.safe_fields?.first_name ?? "").trim();
    return name && name.toUpperCase() !== "REPLACE_ME" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Registry record for a queue/applied entry, matched by job_id. */
export function registryByJobId(
  registry: RegistryRecord[],
  jobId: string,
): RegistryRecord | undefined {
  return registry.find((r) => r.job_id === jobId);
}

/**
 * A queue entry is resolved when a later outcome exists for it: an
 * applied/failed entry in applied_jobs, or a registry latest_status that
 * moved past needs_review. The queue file itself is append-only (helper
 * discipline), so "resolved" is derived, never deleted.
 */
export function isResolved(state: ApplyrState, entry: QueueEntry): boolean {
  const outcome = state.applied.find(
    (a) => a.job_id === entry.job_id && a.status !== "needs_review",
  );
  if (outcome) return true;
  const rec = registryByJobId(state.registry, entry.job_id);
  return (
    rec?.latest_status === "applied" ||
    rec?.latest_status === "failed" ||
    rec?.latest_status === "skipped_unfit"
  );
}

/**
 * A queue entry has a terminal applied/failed outcome when an
 * applied_jobs entry records that status, or the registry's
 * latest_status is applied or failed. Used to guard dismiss() from
 * overwriting a real outcome with skipped_unfit.
 */
export function hasAppliedOrFailed(state: ApplyrState, entry: QueueEntry): boolean {
  const outcome = state.applied.find(
    (a) => a.job_id === entry.job_id && (a.status === "applied" || a.status === "failed"),
  );
  if (outcome) return true;
  const rec = registryByJobId(state.registry, entry.job_id);
  return rec?.latest_status === "applied" || rec?.latest_status === "failed";
}

/**
 * A queue entry is already dismissed when its registry latest_status is
 * skipped_unfit. Used by dismiss() to avoid re-dismissing (and recording a
 * duplicate skipped_unfit event for) an entry already resolved as dismissed.
 */
export function isDismissed(state: ApplyrState, entry: QueueEntry): boolean {
  const rec = registryByJobId(state.registry, entry.job_id);
  return rec?.latest_status === "skipped_unfit";
}

export interface Heartbeat {
  last_run_completed_at: string;
  last_run_exit_code: number;
  last_run_counts: Record<string, number>;
  run_counter: number;
  consecutive_nonzero_exits: number;
}

export function readHeartbeat(root: string): Heartbeat | undefined {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(logDir(root), "heartbeat.json"), "utf8"),
    ) as Heartbeat;
  } catch {
    return undefined;
  }
}

export function lastRunLine(root: string): string {
  try {
    const log = fs.readFileSync(path.join(logDir(root), "run_job_agent.log"), "utf8");
    const lines = log.trim().split("\n");
    return lines[lines.length - 1] ?? "";
  } catch {
    return "(no runs recorded yet)";
  }
}

export function latestSessionLog(root: string): string | undefined {
  try {
    const dir = logDir(root);
    const sessions = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("session_") && f.endsWith(".log"))
      .sort();
    const last = sessions[sessions.length - 1];
    return last ? path.join(dir, last) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * PID of the run currently holding the runner's single-flight lock, or
 * undefined when nothing is in flight. `scripts/runtime/run_job_agent.py`
 * writes this file when it acquires the lock; reading it is the only way
 * the TUI can see — and stop — a run it did not spawn itself: a scheduler
 * tick, or a run left alive after the user quit the TUI with `q`.
 *
 * A pid file whose process is gone means a crashed run left the lock
 * behind (the runner self-heals this on its next attempt), so it is
 * reported as "no run in flight" rather than a stoppable PID.
 */
export function activeRunPid(root: string): number | undefined {
  try {
    const raw = fs.readFileSync(
      path.join(logDir(root), ".run_job_agent.lock", "pid"),
      "utf8",
    );
    const pid = Number.parseInt(raw.trim(), 10);
    return pidAlive(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
