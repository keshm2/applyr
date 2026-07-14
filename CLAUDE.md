# applyr — Claude Code project guide

applyr (formerly Ares) is a single-user, local-first job-application
agent: it scrapes public job boards, deduplicates against local
history, fit-gates each posting deterministically, tailors a resume +
cover letter, applies through a Playwright-driven browser or public
APIs, and reports outcomes to Discord (plus an optional Google Sheet
row per success). An LLM harness (opencode or Claude Code)
orchestrates; deterministic Python/bash helpers own all state.

**`AGENTS.md` is the canonical behavioral ruleset for this repo.** Read
it before doing anything; everything there binds any agent operating in
this repo, regardless of harness. For project history, phase roadmap,
and the current status pointer, read `docs/PLAN.md` (gitignored,
local-only).

## Operator rules (restated from docs/PLAN.md §2 — these bind you)

- Work **one phase at a time**. Do not start a phase (or the next one)
  without the operator's explicit go-ahead; stop after printing the
  phase summary.
- **All state writes go through the helpers** (`scripts/state/job_state.py`,
  `scripts/state/append_state_entry.sh`). Never hand-write or hand-edit
  `data/*.json` / `data/*.jsonl`.
- **Gitignored files stay uncommitted**: live configs in
  `config/*.json`, everything in `data/`, `logs/`, `docs/PLAN.md`, and
  `data/resumes/` hold PII/secrets and never enter git.
- Do not introduce a new model name, MCP server, or permission surface
  without explicit operator approval.
- Whoever closes a phase or work item MUST update the Phase Status
  Pointer at the top of `docs/PLAN.md` **and** the "Phase status" block
  in `AGENTS.md` before stopping.

## Repo map

| Path | What it is |
| --- | --- |
| `AGENTS.md` | Canonical behavioral rules (fetch methods, fit gate, write discipline) |
| `docs/PLAN.md` | Phase roadmap + handoff (gitignored — read first when resuming) |
| `docs/SETUP.md` | User-facing install/config walkthrough |
| `agents/` | **Source of truth** for agent prompts: `bodies/` + `frontmatter/<harness>/` |
| `.claude/agents/`, `.opencode/agents/` | **Generated** from `agents/` — never hand-edit |
| `scripts/` | Deterministic helpers — the only things allowed to write state |
| `app/` | The `applyr` TUI (TypeScript/Ink overlay; shells out to the helpers) |
| `config/` | `*.example.json` templates (committed) + live configs (gitignored) |
| `data/`, `logs/` | Runtime state and logs (gitignored, PII) |

## Common commands

```bash
bash scripts/install/install.sh                    # universal first-run installer
bash scripts/validate/validate_local_config.sh      # config check (expect "OK")
python3 scripts/state/job_state.py ensure-files  # bootstrap/validate state files
bash scripts/runtime/run_job_agent.sh              # trigger one agent run
bash scripts/runtime/scheduler.sh status           # 30-min launchd schedule state
python3 scripts/validate/generate_agent_definitions.py --check   # agent-def drift check

cd app && npm install && npm run build     # build the TUI
npm link                                   # exposes the `applyr` command
applyr                                     # open the TUI (press ? for keys)
npm run typecheck && npm run smoke         # TUI CI checks
```

## Harness notes

- The agent definitions in `.claude/agents/` and `.opencode/agents/`
  are **generated** from `agents/bodies/` +
  `agents/frontmatter/<harness>/` by
  `scripts/validate/generate_agent_definitions.py`. Edit the sources, then
  regenerate — never the generated files.
- Runtime runs go through `scripts/runtime/run_job_agent.sh`, which selects the
  harness (opencode or Claude Code) via `config/harness.json`,
  `$APPLYR_HARNESS` (legacy `$ARES_HARNESS` still honored), or
  auto-detection. Claude Code is both a supported runtime driver and a
  development harness here.
- Playwright MCP for this project is configured in `.mcp.json`;
  headless permissions in `.claude/settings.json`.
- Env vars use the `APPLYR_*` prefix (`APPLYR_SESSION_CAP`,
  `APPLYR_HARNESS`, `APPLYR_LOCK_MAX_AGE_MIN`,
  `APPLYR_KEEP_SESSION_LOGS`, `APPLYR_ROOT`); the legacy `ARES_*`
  names remain as fallbacks for pre-rename setups.

## Conventions that trip people up

- `skipped_unfit` outcomes are **local-only**: never routed to Discord,
  `data/applied_jobs.json`, or the Google Sheet.
- The review-queue file is append-only; "resolved" is derived from
  later outcomes, never by deleting entries.
- Max 25 applications per session — the TUI can lower this per run via
  `APPLYR_SESSION_CAP`, never raise it.
- Workday is review-only: no auto-apply path exists, by design.
- The TUI renders and orchestrates; Python owns state. Do not port
  helper logic into TypeScript without an explicitly approved decision.
