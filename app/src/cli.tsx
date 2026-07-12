#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { findProjectRoot } from "./project.js";
import { loadState, isResolved, lastRunLine, latestSessionLog, readHeartbeat } from "./state.js";
import { App, type Tab } from "./ui/App.js";
import { StatusScreen } from "./ui/StatusScreen.js";
import { runWizard } from "./wizard.js";
import { runAgent } from "./run.js";

const HELP = `ares — persistent TUI for the Ares job-application agent

Usage: ares [command]

  (no command)      open the app (status · review · history · run)
  review | history  open the app on that screen
  status            one-shot pipeline overview (scripting/CI friendly)
  run               trigger a run in the current terminal (no app shell)
  setup [--check]   interactive config wizard; --check only validates
  help              show this help

State writes go through the repo's Python/bash helpers — the TUI never
edits state JSON directly. Set ARES_ROOT to run outside the repo.`;

/** Alternate screen: full-screen app without scrollback pollution, and
 * the terminal restored on any exit path (quit, error, Ctrl-C). */
async function openApp(root: string, initialTab: Tab): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    // Piped/CI: render one frame and leave.
    const app = render(<App root={root} initialTab={initialTab} />);
    app.unmount();
    return 0;
  }
  const enter = "\x1b[?1049h\x1b[H";
  const leave = "\x1b[?1049l";
  process.stdout.write(enter);
  const restore = () => process.stdout.write(leave);
  process.on("exit", restore);
  try {
    await render(<App root={root} initialTab={initialTab} />).waitUntilExit();
    return 0;
  } finally {
    process.off("exit", restore);
    restore();
  }
}

async function main(): Promise<number> {
  const [command = "", ...rest] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }

  const root = findProjectRoot();

  switch (command) {
    case "":
      return openApp(root, "status");
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
