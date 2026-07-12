import { spawn } from "node:child_process";
import fs from "node:fs";
import { latestSessionLog } from "./state.js";

/**
 * Trigger a run via the existing cron entry point and stream the session
 * log while it executes. The script owns locking, validation, and the
 * opencode invocation — the TUI only launches and observes it.
 */
export async function runAgent(root: string): Promise<number> {
  const before = latestSessionLog(root);
  console.log("Starting a run via scripts/run_job_agent.sh …");
  const child = spawn("bash", ["scripts/run_job_agent.sh"], {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
  });

  // The session transcript goes to logs/session_<ts>.log, not stdout —
  // tail the new session file once it appears so the run is visible live.
  let tail: ReturnType<typeof spawn> | undefined;
  const poll = setInterval(() => {
    const current = latestSessionLog(root);
    if (current && current !== before && fs.existsSync(current) && !tail) {
      console.log(`Streaming ${current}\n`);
      tail = spawn("tail", ["-f", current], { stdio: ["ignore", "inherit", "inherit"] });
    }
  }, 500);

  const code: number = await new Promise((resolve) => {
    child.on("close", (c) => resolve(c ?? 1));
  });
  clearInterval(poll);
  tail?.kill();
  console.log(code === 0 ? "\nRun complete." : `\nRun exited with code ${code} — see logs/run_job_agent.log.`);
  return code;
}
