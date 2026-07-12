import fs from "node:fs";
import path from "node:path";

export interface AppliedJob {
  job_id: string;
  company: string;
  title: string;
  url: string;
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
}

export interface AresState {
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

export function loadState(root: string): AresState {
  return {
    applied: readJsonArray<AppliedJob>(path.join(root, "data", "applied_jobs.json")),
    queue: readJsonArray<QueueEntry>(path.join(root, "data", "review_queue.json")),
    registry: readJsonArray<RegistryRecord>(path.join(root, "data", "job_registry.json")),
  };
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
export function isResolved(state: AresState, entry: QueueEntry): boolean {
  const outcome = state.applied.find(
    (a) => a.job_id === entry.job_id && a.status !== "needs_review",
  );
  if (outcome) return true;
  const rec = registryByJobId(state.registry, entry.job_id);
  return rec?.latest_status === "applied" || rec?.latest_status === "skipped_unfit";
}

export function lastRunLine(root: string): string {
  try {
    const log = fs.readFileSync(path.join(root, "logs", "run_job_agent.log"), "utf8");
    const lines = log.trim().split("\n");
    return lines[lines.length - 1] ?? "";
  } catch {
    return "(no runs recorded yet)";
  }
}

export function latestSessionLog(root: string): string | undefined {
  try {
    const dir = path.join(root, "logs");
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

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
