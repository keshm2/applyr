import { execFileSync, spawnSync } from "node:child_process";
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
  run(root, "bash", [
    "scripts/append_state_entry.sh",
    "data/applied_jobs.json",
    JSON.stringify(entry),
  ]);
}

export function recordEvent(
  root: string,
  event: { job_key: string; status: string; reasoning?: string },
): void {
  run(root, "python3", ["scripts/job_state.py", "record-event", JSON.stringify(event)]);
}

export interface ValidatorResult {
  ok: boolean;
  output: string;
}

export function runValidator(root: string): ValidatorResult {
  const res = spawnSync("bash", ["scripts/validate_local_config.sh"], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    ok: res.status === 0,
    output: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim(),
  };
}

export function openUrl(url: string): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFileSync(opener, [url], { stdio: "ignore" });
}

/** Message from a failed helper invocation, trimmed for display. */
export function helperError(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = String((err as { stderr: unknown }).stderr ?? "").trim();
    if (stderr) return stderr.split("\n").slice(-2).join(" ");
  }
  return err instanceof Error ? err.message : String(err);
}
