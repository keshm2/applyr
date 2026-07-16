import fs from "node:fs";
import path from "node:path";
import { effectiveEnv } from "./settings.js";
import type { HarnessId } from "./theme.js";

const KNOWN: ReadonlySet<string> = new Set(["claude", "opencode", "codex", "copilot"]);

function isKnown(value: string): value is Exclude<HarnessId, "auto"> {
  return KNOWN.has(value);
}

function readHarnessConfigFile(root: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, "config", "harness.json"), "utf8"));
    return typeof parsed?.harness === "string" ? parsed.harness.trim() : "";
  } catch {
    return "";
  }
}

/** Same resolution order run_job_agent.py uses ahead of its own PATH
 *  auto-detect (APPLYR_HARNESS/ARES_HARNESS env override, then
 *  config/harness.json): env override wins, then the config file, else
 *  "auto" — there's no CLI-on-PATH probe here since this only drives a
 *  cosmetic wave color, not the actual subprocess invocation. */
export function resolveHarnessId(root: string): HarnessId {
  const fromEnv = effectiveEnv(root, "APPLYR_HARNESS", "").value.trim();
  if (isKnown(fromEnv)) return fromEnv;
  const fromConfig = readHarnessConfigFile(root);
  if (isKnown(fromConfig)) return fromConfig;
  return "auto";
}

/**
 * PATH probe order — must stay identical to `run_job_agent.py`'s own
 * auto-detect loop ("Harness selection"), or the UI will name a different
 * agent than the one that actually drives the run.
 */
const DETECT_ORDER = ["opencode", "claude", "codex", "copilot"] as const;

function onPath(cmd: string): boolean {
  const dirs = (process.env["PATH"] ?? "").split(path.delimiter).filter(Boolean);
  // Windows resolves a bare name through PATHEXT; POSIX wants the exec bit.
  const exts =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        if (process.platform === "win32") {
          if (fs.statSync(candidate).isFile()) return true;
        } else {
          fs.accessSync(candidate, fs.constants.X_OK);
          return true;
        }
      } catch {
        /* not here — keep looking */
      }
    }
  }
  return false;
}

/** Which agent "Auto" would actually pick right now, or undefined when
 *  none of the four is installed. Cheap enough to call per render (a
 *  handful of stat calls), and never cached — installing an agent while
 *  the TUI is open should be reflected without a restart. */
export function detectHarnessOnPath(): Exclude<HarnessId, "auto"> | undefined {
  for (const candidate of DETECT_ORDER) {
    if (onPath(candidate)) return candidate;
  }
  return undefined;
}

/** The agent a run would use right now: an explicit choice if set,
 *  otherwise whatever auto-detect finds. */
export function effectiveHarness(root: string): Exclude<HarnessId, "auto"> | undefined {
  const resolved = resolveHarnessId(root);
  return resolved === "auto" ? detectHarnessOnPath() : resolved;
}
