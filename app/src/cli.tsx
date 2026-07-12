#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { findProjectRoot } from "./project.js";
import { loadState, isResolved, lastRunLine, latestSessionLog } from "./state.js";
import { StatusScreen } from "./ui/StatusScreen.js";
import { ReviewScreen } from "./ui/ReviewScreen.js";
import { HistoryScreen } from "./ui/HistoryScreen.js";
import { runWizard } from "./wizard.js";
import { runAgent } from "./run.js";

const HELP = `ares — TUI overlay for the Ares job-application agent

Usage: ares <command>

  status            pipeline overview: outcome counts, queue, last run
  review            triage the review queue (open, mark applied, dismiss)
  history           browse recorded application outcomes
  run               trigger a run (scripts/run_job_agent.sh) and stream it
  setup [--check]   interactive config wizard; --check only validates
  help              show this help

State writes go through the repo's Python/bash helpers — the TUI never
edits state JSON directly. Set ARES_ROOT to run outside the repo.`;

async function main(): Promise<number> {
  const [command = "help", ...rest] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }

  const root = findProjectRoot();

  switch (command) {
    case "status": {
      const state = loadState(root);
      const unresolved = state.queue.filter((e) => !isResolved(state, e)).length;
      const app = render(
        <StatusScreen
          state={state}
          lastRun={lastRunLine(root)}
          sessionLog={latestSessionLog(root)}
          unresolvedQueue={unresolved}
        />,
      );
      app.unmount();
      return 0;
    }
    case "review": {
      await render(<ReviewScreen root={root} />).waitUntilExit();
      return 0;
    }
    case "history": {
      await render(<HistoryScreen state={loadState(root)} />).waitUntilExit();
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
