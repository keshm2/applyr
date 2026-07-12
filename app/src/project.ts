import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the Ares project root. The TUI is an overlay over the repo's
 * Python core — every command needs the root to find scripts/, config/,
 * data/, and logs/. Resolution order: $ARES_ROOT, then upward from the
 * working directory, then upward from this module (covers running the
 * repo-local build from anywhere).
 */
export function findProjectRoot(): string {
  const starts: string[] = [];
  if (process.env.ARES_ROOT) starts.push(process.env.ARES_ROOT);
  starts.push(process.cwd());
  starts.push(path.dirname(fileURLToPath(import.meta.url)));

  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      if (
        fs.existsSync(path.join(dir, "scripts", "job_state.py")) &&
        fs.existsSync(path.join(dir, "AGENTS.md"))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    "Could not locate the Ares project root (scripts/job_state.py + AGENTS.md). " +
      "Run from inside the repo or set ARES_ROOT.",
  );
}
