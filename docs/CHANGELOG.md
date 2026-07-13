# Changelog

All notable changes to applyr (formerly Ares) are documented here.
The format is roughly [Keep a Changelog](https://keepachangelog.com/)-style
but trimmed to fit a small in-repo doc.

> Per-`docs/RELEASE.md` is the canonical, deep-dive release
> document for each tagged build. This file is the index.

## [Unreleased] — on `main`

### Added

- **TUI Settings tab (Config, tab 5).** Three `> [x]` sections that
  always show current values before editing, with a per-field
  explanation: Personal info (safe_fields plus the new
  **preferred name** the sidebar greets you by, falling back to
  first name), Discord webhooks (enabled toggle + per-route URLs),
  and Environment — persisted `APPLYR_*` overrides in the new
  gitignored `config/env.json`, exported by every run (real env vars
  win; only `APPLYR_*`/`ARES_*` keys are honored). New
  `APPLYR_LOG_DIR` moves run/session logs and the heartbeat
  (runner, `write_heartbeat.py`, and the TUI's log readers all honor
  it; agent fetch-scratch stays in `logs/tmp`).
- **README:** Codex CLI and GitHub Copilot CLI artwork added to the
  supported-agents row.

## [0.7.9a] — 2026-07-13

npm package: `@keshm2/applyr` version `0.7.9-alpha.0` (alpha tag).
This is the first build clients receive via **automatic update** —
pushing the `VERSION` bump to `main` rolls it out.

### Added

- **Phase 16 — multi coding-agent support.** Codex CLI and GitHub
  Copilot CLI adapters in `run_job_agent.sh`; 4-agent installer
  detection; harness capability matrix + mandatory degraded paths in
  `AGENTS.md`; conformance suite (`scripts/run_conformance.py`) with
  results in `docs/SETUP.md` §3.8.
- **One-command install.** The cURL one-liner now ends with a working
  `applyr` command: the installer writes a wrapper to
  `~/.local/bin/applyr` (override with `APPLYR_BIN`) pinned to the
  install via `APPLYR_ROOT`. An npm-installed `applyr` with no core
  offers to download the core itself instead of printing
  instructions.
- **Automatic updates.** New root `VERSION` file and
  `scripts/update.sh`: compares local vs GitHub `main`, then
  fast-forward pulls (git checkouts) or overlays the main tarball
  (archive installs); regenerates agent definitions, revalidates
  config, and rebuilds the TUI afterwards. Per-user files are never
  touched. Hooked fail-open into every scheduled run (self-update,
  then re-exec the new runner; `APPLYR_SKIP_UPDATE` guards the loop)
  and every interactive `applyr` launch (2.5 s check budget). New
  `applyr update` command; `APPLYR_AUTO_UPDATE=0` opts out. Updater
  is single-flight with a 30-min stale-lock reclaim.
- **Phase 9 — migration-friendliness review.** Single-user
  assumption, per-user vs project-owned file table, and future
  multi-user seams documented in `AGENTS.md`; two-users-per-machine
  note in `docs/SETUP.md` §3.7.
- **Dedicated uninstall.** `scripts/uninstall.sh` (also `applyr
  uninstall`): removes the launchd schedule and the `applyr` PATH
  wrapper (only applyr's own, only if it points at this install),
  then deletes the install directory after an explicit confirmation —
  it holds config/data/resumes PII. `--keep-data` keeps the
  directory; `--yes` skips the prompt; non-interactive without
  `--yes` never deletes data. npm installs additionally run
  `npm uninstall -g @keshm2/applyr`.

- **Discord is now optional (opt-in at install).** The installer and
  `applyr setup` ask whether to use Discord for status updates; no
  writes `{"enabled": false}` and outcomes stay local (state files +
  TUI). Opting in offers one channel for all updates or separate
  channels per status, with a highlighted ⚠ warning that Discord
  binds each webhook to one channel — each channel needs its own
  webhook link. Validator treats a missing/disabled config as a
  warning, never an error (enabled configs still hard-fail on
  placeholders); the discord-reporter logs one skip line when
  disabled; an absent `enabled` field means enabled, so existing
  configs keep working.

### Changed

- **README cut to a quarter of its length.** Phase planning, roadmap
  tables, phase-status blurbs, and per-build inventories moved out of
  the README (they live in `docs/CHANGELOG.md`, `docs/RELEASE.md`,
  and the gitignored plan); what remains is install, updates,
  uninstall, usage, safety, and pointers.

## [0.7.8a] — 2026-07-12

npm package: **`@keshm2/applyr` version `0.7.8-alpha.0`** (the
unscoped npm name `applyr` belongs to an unrelated package; `0.7.8a`
is the human-facing build marker, `0.7.8-alpha.0` its strict-semver
form).

### Added

- **Setup overhaul.** `scripts/install.sh` bootstraps itself from a
  cURL one-liner (`curl -fsSL …/scripts/install.sh | bash` downloads
  the source into `~/applyr`, override with `APPLYR_HOME`, then
  re-runs from inside it); prompts for the user profile
  (`safe_fields`, written atomically via `jq`) behind a bold-cyan
  notice that everything stays **locally only**; creates the
  gitignored root `resumes/` drop-folder — drop all resumes there
  as PDFs for scan/convert-to-markdown tailoring. `applyr setup`
  shows the same privacy notice and resumes instruction. Three
  documented install paths: bash, cURL, npm.
- **TUI density redesign.** Shared rules+columns split-view
  primitives (`app/src/ui/Pane.tsx`); Jobs MANUAL, Review, and
  History get a full-height detail pane (fit verdicts, urls,
  reasoning, totals); Status gets a full-height recent-activity
  column; AUTO mode is a cockpit — cap gauge, heartbeat outcome
  counters, elapsed run clock, and a log tail that fills the
  content region. Panes appear when the content band is ≥ 76
  columns and degrade to the stacked layouts below.
- **Cap tiers re-cut.** 25 = MAX with a **rainbow gauge**, 22–24 =
  `heavy+` in a new hot red (`#FF3B30`), 17–21 = `heavy` (yellow),
  6–16 standard, 1–5 light.
- **Sidebar.** Randomized per-launch greeting (Hello / Welcome /
  Nice to see you / Hey there) over the user's first name (rainbow,
  from `safe_fields`); Screen / Failed / Seen / Sched rows; local
  **12-hour clock with time-zone abbreviation**.
- **Navigation.** `esc` returns to the welcome menu from any screen
  (never quits, locked during a live run); an npm-installed
  `applyr` with no core checkout prints the one-line core
  installer instead of a stack trace.
- **README.** applyr banner artwork at the head; explicit
  requirement callout — **Claude Code or opencode must be
  installed** — with both agents' artwork.

### Fixed

- **Backspace deleted nothing on macOS.** The Backspace key sends
  DEL (0x7f), which Ink reports as `key.delete`; the editors
  treated that as forward-delete — a no-op at the end of the line.
  Backspace and delete now both erase backward in all three text
  inputs.
- **Resize breakage.** Welcome menu sheds intro / description /
  state / footer bands by available rows so the `> [x]` options
  are never clipped; option rows truncate instead of wrapping;
  `MIN_COLUMNS` 40 → 44 (the tab row with the Review badge wrapped
  at 40 and corrupted the pinned frame); sidebar threshold 64 → 72
  columns; the content band has an explicit width so wide nested
  rows can no longer squeeze the sidebar.

## [0.5.5a] — 2026-07-12 — first tagged build

### Added

- **Project rename Ares → applyr.** TUI command and npm package
  renamed to `applyr`. Documented env-var prefix is `APPLYR_*`
  (the legacy `ARES_*` names are still honored as fallbacks).
  launchd label is now `com.applyr.job-agent`; the scheduler
  installer / uninstaller also cleans up the pre-rename
  `com.ares.job-agent` label.
- **TUI (Phase 13, re-scoped).** Persistent full-screen app
  in `app/`. Welcome page on launch, manual and automatic
  modes, review triage, status / history browse, in-app help
  (`?`), `q` confirms before quit, `Esc` never quits, responsive
  banner (art or wordmark), responsive list sizing, side panel
  (applied / queue / mode / build marker), tier-colored cap
  input with animated MAX warning, optional per-run extra
  prompt (`APPLYR_EXTRA_PROMPT`). Subcommands:
  `applyr status`, `applyr run`, `applyr setup [--check]`,
  `applyr review`, `applyr history`, `applyr help`.
- **Harness portability (Phase 15, partial).**
  `scripts/run_job_agent.sh` selects OpenCode or Claude Code via
  `$APPLYR_HARNESS` → `config/harness.json` → auto-detect. The
  installer detects both and prompts when both are present.
  Per-harness agent definitions are generated from
  `agents/bodies/` + `agents/frontmatter/{opencode,claude}/`
  by `scripts/generate_agent_definitions.py`. Runner runs a
  drift check (`--check`) at the start of every run.
- **Universal installer.** `scripts/install.sh` — one command
  from a fresh GitHub download to a validated, harness-configured
  setup. Non-destructive.
- **Fetch-efficiency rules (AGENTS.md).** Fetches redirect to
  `logs/tmp/`, deterministic role / level prefilter before
  canonicalizing, shortlist bound 5× session cap (min 10), ≤ 30
  shortlist lines in the transcript. Closes the runaway-cap
  failure mode.
- **CI.** `.github/workflows/tui.yml` (typecheck + build +
  smoke) and `.github/workflows/extension.yml` (typecheck +
  build).
- **TUI accessibility / polish.** Opencode `--print` flag
  probe (so OpenCode ≥ 1.17 launches); resize-invariant
  frame (overflow hidden, `MIN_ROWS = 12`); large-terminal
  fill (band centers when columns > 160 with side panel
  overhead, list cap 30 rows); clear-on-resize repaint;
  key-cap-colored hint bar.

### Changed

- **`data/resumes/` is now gitignored** (PII). The five base
  resumes (`swe`, `ai_ml`, `balanced`, `cyber`,
  `networking_cyber`) plus the cover letter are loaded at
  runtime from the working copy.
- **TUI bin / command** is `applyr` (was `ares` in the prior
  TUI commit).
- **`extension/`** is now part of the project as the Phase 10
  hybrid-mode extension (MV3, TypeScript).
- **`scripts/extension_bridge.py`** is the localhost bridge for
  the extension. Token in `config/extension_bridge.json`
  (gitignored, `chmod 600`).

### Fixed

- TUI: duplicated / clipped frames on resize (frame now pinned
  to viewport height with `overflow="hidden"`).
- TUI: navigating into a Jobs tab no longer steals the
  keyboard; typing starts only on `/` (manual) or `e` / `p`
  (automatic).
- Runner: detects both old and new opencode CLIs (some removed
  `--print`; others still expect it).
- Runner: warns (does not block) when generated agent
  definitions are stale.
- Runner: `APPLYR_SESSION_CAP` is clamped to 1–25; values
  outside the range fall back to 25 with a warning.

### Security

- The extension still **never submits a form** — the user
  reviews and clicks submit themselves. Autofill comes only
  from `config/targets.json "safe_fields"`. The bridge serves
  only the keys a page's form mapped, never the whole map.
- Bridge requires a per-install bearer token on every
  request. Bound to `127.0.0.1` only.
- `skipped_unfit` outcomes remain local-only: never routed to
  Discord, never written to `data/applied_jobs.json`, never
  synced to the Google Sheet.

### Known gaps (do not claim these as shipped)

- Phase 9 (migration-friendliness review) is **planned**, not
  implemented.
- Phase 13: `npm` publication, provider-setup, and hosted
  storage are **deferred**. Install from the local repo.
- Phase 15: live parity run between opencode and Claude Code
  is **pending**.
- Phase 16 (Codex, GitHub Copilot) is **planned**.
- Workday is review-only by design — there is no auto-apply
  path.
- The TUI's side panel shows a `Test User` rainbow wordmark —
  a UI placeholder. No backend account store.
- `docs/PLAN.md` is gitignored by design; the public roadmap
  signal is the table in `README.md`.

## Pre-tag history (untagged, summarized)

- **TUI as a one-shot CLI** — the previous TUI commit
  (`28b1d4c`) shipped `applyr` (then `ares-apply`) as a
  one-shot CLI with `status`, `review`, `history`, `run`,
  `setup` subcommands. 0.5.5a re-scopes that to a persistent
  full-screen app; the subcommands are preserved.
- **Phase 10** (`28b1d4c`, `0c843b9`, `afd87e3`) — extension
  + bridge.
- **Phases 0–8** (`cfebcd4`, `dac5376`, `75e1699`, `9b827cc`,
  `992aaca`, `5e0843f`, `d4568a6`) — state hardening,
  Sheets sync, fit gate, SimplifyJobs, vetted slugs, Workday,
  scheduler.
- **Initial release** (`0c843b9`, `dac5376`, `cfebcd4`,
  `75e1699`) — the README + agent scaffolding.

> Git history before `0.5.5a` is under the **Ares** name. The
> rename is reflected in the in-repo files (banner, docs,
> command names, env-var prefix); the git log retains the
> original commit subjects.
