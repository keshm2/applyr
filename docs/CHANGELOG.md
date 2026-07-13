# Changelog

All notable changes to applyr (formerly Ares) are documented here.
The format is roughly [Keep a Changelog](https://keepachangelog.com/)-style
but trimmed to fit a small in-repo doc.

> Per-`docs/RELEASE.md` is the canonical, deep-dive release
> document for each tagged build. This file is the index.

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
