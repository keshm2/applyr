#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { findProjectRoot } from "./project.js";
import { py } from "./platform.js";
import { loadState, isResolved, lastRunLine, latestSessionLog, readHeartbeat } from "./state.js";
import { App, type Tab } from "./ui/App.js";
import { StatusScreen } from "./ui/StatusScreen.js";
import { runWizard } from "./wizard.js";
import { runAgent } from "./run.js";

const HELP = `applyr — persistent TUI for the applyr job-application agent

Usage: applyr [command]

  (no command)      open the app (status · jobs · review · history)
  review | history  open the app on that screen
  status            one-shot pipeline overview (scripting/CI friendly)
  run               trigger a run in the current terminal (no app shell)
  setup [--check]   interactive config wizard; --check only validates
  update            check upstream and self-update now
  uninstall         remove the schedule, command, and (after confirming) the install
  help              show this help

Updates are checked on every app launch (the TUI asks before
installing) and auto-install on scheduled runs
(APPLYR_AUTO_UPDATE=0 disables).

Inside the app, press ? for the full key reference.

State writes go through the repo's Python/bash helpers — the TUI never
edits state JSON directly. Set APPLYR_ROOT to run outside the repo.`;

const VERSION_URL = "https://raw.githubusercontent.com/keshm2/applyr/main/VERSION";
const BOOTSTRAP_URL = "https://raw.githubusercontent.com/keshm2/applyr/main/scripts/install/install.sh";
const BOOTSTRAP_URL_PS1 = "https://raw.githubusercontent.com/keshm2/applyr/main/scripts/install/install.ps1";

/** The one-command core bootstrap for the current OS. */
function bootstrapOneLiner(): string {
  return process.platform === "win32"
    ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${BOOTSTRAP_URL_PS1} | iex"`
    : `curl -fsSL ${BOOTSTRAP_URL} | bash`;
}

/** Launch-time update probe: compare the local VERSION to upstream
 *  main and return the remote version when it differs, so the TUI can
 *  ask before installing (see App's UpdateBox). Strictly fail-open — a
 *  dead network, missing VERSION, or slow GitHub never delays launch
 *  more than the 2.5 s fetch timeout, and APPLYR_AUTO_UPDATE=0 skips it.
 *  Reuses the same VERSION_URL fetch the old silent auto-update used;
 *  no second network check is added. */
async function detectUpdate(root: string): Promise<string | null> {
  if (process.env.APPLYR_AUTO_UPDATE === "0" || process.env.ARES_AUTO_UPDATE === "0") return null;
  if (!process.stdout.isTTY) return null; // never in piped/CI renders
  try {
    const local = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(VERSION_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const remote = (await res.text()).trim();
    if (!remote || remote === local) return null;
    return remote;
  } catch {
    /* fail-open — updating is a convenience, never a launch blocker */
  }
  return null;
}

/** Run the updater now (after the TUI has left the alternate screen).
 *  Mirrors the old silent auto-update install step. */
function installUpdate(root: string): void {
  const upd = py(["scripts/install/update.py", "--auto"]);
  const r = spawnSync(upd.cmd, upd.args, { cwd: root, stdio: "inherit" });
  if (r.status === 0) {
    console.log("Update installed — restart applyr to load it.\n");
  }
}

/** No core checkout found: offer to install it right here (one-command
 *  promise), falling back to printed instructions on a non-TTY. */
async function bootstrapCore(): Promise<string | null> {
  const target = process.env.APPLYR_HOME ?? path.join(os.homedir(), "applyr");
  const oneLiner = bootstrapOneLiner();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      "applyr: no applyr core found. Install it with one command:\n\n" +
        `  ${oneLiner}\n\n` +
        `(installs to ${target}; set APPLYR_HOME to change, or APPLYR_ROOT to point\n` +
        "at an existing checkout), then re-run applyr.",
    );
    return null;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = (await rl.question(`applyr: no core found. Download it to ${target} now? [Y/n] `)).trim();
  } finally {
    rl.close();
  }
  if (answer.toLowerCase() === "n") {
    console.log(`Skipped. Install later with: ${oneLiner}`);
    return null;
  }
  const r =
    process.platform === "win32"
      ? spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
          `irm ${BOOTSTRAP_URL_PS1} | iex`], { stdio: "inherit" })
      : spawnSync("bash", ["-c", oneLiner], { stdio: "inherit" });
  if (r.status !== 0 || !fs.existsSync(path.join(target, "AGENTS.md"))) {
    console.error("applyr: core install did not complete — see the output above.");
    return null;
  }
  return target;
}

/** Ensure non-TTY stdout has flushed so process.exit() doesn't truncate
 *  piped/CI output from one-shot renders. */
function flushStdout(): Promise<void> {
  return new Promise((resolve) => {
    const out = process.stdout;
    if (out.isTTY || !out.writableNeedDrain) {
      resolve();
      return;
    }
    out.once("drain", () => resolve());
  });
}

/** Alternate screen: full-screen app without scrollback pollution, and
 * the terminal restored on any exit path (quit, error, Ctrl-C). */
async function openApp(root: string, initialTab: Tab, updateVersion?: string): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    // Piped/CI: render one frame, wait for the unmount lifecycle to flush,
    // then leave. No update prompt — there's no keyboard to answer it.
    const app = render(<App root={root} initialTab={initialTab} />);
    app.unmount();
    await app.waitUntilExit();
    await flushStdout();
    return 0;
  }
  const enter = "\x1b[?1049h\x1b[H";
  const leave = "\x1b[?1049l";
  process.stdout.write(enter);
  const restore = () => process.stdout.write(leave);
  process.on("exit", restore);
  // The UpdateBox calls this when the user accepts the update; we run
  // scripts/install/update.py AFTER the alt screen is restored below so its
  // stdio-inherit output lands on the normal screen, not inside the TUI.
  let installAfterExit = false;
  try {
    const instance = render(
      <App
        root={root}
        initialTab={initialTab}
        updateVersion={updateVersion}
        onUpdateInstall={() => {
          installAfterExit = true;
        }}
      />,
    );
    // On resize, Ink diffs against the frame it drew for the OLD terminal
    // size, leaving artifacts (stale rows on shrink, misaligned lines on
    // reflow). Clearing Ink's frame forces a clean full repaint at the new
    // size; the App's own resize listener re-derives the layout.
    const onResize = () => instance.clear();
    process.stdout.on("resize", onResize);
    try {
      await instance.waitUntilExit();
    } finally {
      process.stdout.off("resize", onResize);
    }
  } finally {
    process.off("exit", restore);
    restore();
  }
  // Alt screen is now left; a user-accepted update runs here so the
  // updater's stdio-inherit output is visible on the normal screen.
  if (installAfterExit) installUpdate(root);
  return 0;
}

async function main(): Promise<number> {
  // Piped/CI renders: Ink falls back to 80 columns when stdout is not a
  // TTY, while the app honors $COLUMNS/$LINES — sync Ink to the same
  // values so one-frame test renders lay out exactly like a real
  // terminal of that size.
  if (!process.stdout.isTTY) {
    const cols = Number.parseInt(process.env.COLUMNS ?? "", 10);
    const rows = Number.parseInt(process.env.LINES ?? "", 10);
    if (Number.isFinite(cols) && cols > 0) (process.stdout as { columns?: number }).columns = cols;
    if (Number.isFinite(rows) && rows > 0) (process.stdout as { rows?: number }).rows = rows;
  }
  const [command = "", ...rest] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }

  // npm-installed global `applyr` with no core checkout: offer to install
  // the core right here (interactive), or print the one-liner (piped).
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    const installed = await bootstrapCore();
    if (!installed) return 1;
    root = installed;
  }

  // Auto-update only on a plain app open — one-shot commands
  // (status/run/review) stay instant and scriptable. The probe reuses
  // the existing VERSION fetch; the TUI prompts before installing.
  let pendingUpdate: string | null = null;
  switch (command) {
    case "":
      pendingUpdate = await detectUpdate(root);
      break;
    case "update": {
      const upd = py(["scripts/install/update.py"]);
      const r = spawnSync(upd.cmd, upd.args, { cwd: root, stdio: "inherit" });
      return r.status ?? 1;
    }
    case "uninstall": {
      const un = py(["scripts/install/uninstall.py", ...rest]);
      const r = spawnSync(un.cmd, un.args, { cwd: root, stdio: "inherit" });
      return r.status ?? 1;
    }
  }

  switch (command) {
    case "":
      return openApp(root, "status", pendingUpdate ?? undefined);
    case "review":
      return openApp(root, "review");
    case "history":
      return openApp(root, "history");
    case "status": {
      const state = loadState(root);
      const unresolved = state.queue.filter((e) => !isResolved(state, e)).length;
      const app = render(
        <StatusScreen
          state={state}
          lastRun={lastRunLine(root)}
          sessionLog={latestSessionLog(root)}
          unresolvedQueue={unresolved}
          heartbeat={readHeartbeat(root)}
        />,
      );
      app.unmount();
      await app.waitUntilExit();
      await flushStdout();
      return 0;
    }
    case "run":
      return runAgent(root);
    case "setup":
      return runWizard(root, rest.includes("--check"));
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
