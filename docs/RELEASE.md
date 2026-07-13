# Release notes — applyr 0.5.5a

> **Build:** `0.5.5a` — alpha.
> **Branch:** `main`.
> **TUI in-app marker:** `app/src/theme.ts` → `BUILD_MARKER = "0.5.5a"`
> (visible in the TUI side-panel footer).
> **npm package version:** `0.5.5a` (alpha tag) for `applyr` and
> `applyr-extension`.
> **Chrome extension manifest version:** `0.5.5` — Chrome Web Store
> rejects pre-release suffixes, so the `a` is dropped on the manifest
> only; everything else still says `0.5.5a`.

## What this build is

`0.5.5a` is the first build of **applyr** (formerly Ares) tagged as a
release. The project was renamed, the TUI was re-scoped to a persistent
full-screen app with manual and automatic modes, and the agent
harnesses were made portable between OpenCode and Claude Code. None of
that existed as a single buildable artifact before this tag.

The TUI is still **alpha** — see "Known gaps" below. The agent core
(Phases 0–8, 10) is the same code that has been running in production
behind the rename.

## What's new in 0.5.5a

### Project rename: Ares → applyr

- The npm package and TUI command are now `applyr` (bin renamed;
  global `ares` link removed).
- The launchd label is `com.applyr.job-agent`. The scheduler
  installer / uninstaller also remove the pre-rename
  `com.ares.job-agent` label, so a renamed deployment never runs two
  schedules.
- Documented env-var prefix is `APPLYR_*` — the legacy `ARES_*` names
  are still honored as fallbacks in `run_job_agent.sh`,
  `scheduler.sh`, and the TUI so pre-rename schedules keep working.
- Banner, docs, and command names all use the new name.

### TUI — phase 13, re-scoped to a persistent full-screen app

The TUI in `app/` is now a persistent shell with a banner, tab row,
content region, hint bar, and (on wide terminals) a right-side status
panel that shows the build marker. It works from the local repo and
is the recommended way to drive a run.

- **Welcome page on launch** — `applyr` opens on a real menu, not a
  splash screen, so the first interaction can route the user
  somewhere useful. Press `w` to reopen it any time.
- **Manual mode (default)** — `Jobs` screen runs live configured
  Ashby / Lever / Workday searches, browser open, the deterministic
  fit gate, and helper-backed save to review.
- **Automatic mode** — set this cycle's per-run cap (1–25) and an
  optional extra instruction (passed as `APPLYR_EXTRA_PROMPT`); the
  runner receives the cap and streams the session log into the
  content region. The cap is **tier-colored by cost**
  (1–5 light, 6–14 standard, 15–24 heavy, 25 = animated MAX warning).
- **Responsive layout** — banner centers and collapses by terminal
  size; lists grow/shrinks with available rows; Jobs tab opens
  browsing, not typing.
- **In-app help** — press `?` for the full keyboard reference; `q`
  quits (with confirmation while a run is active); `Esc` only cancels
  typing, never quits.
- **Review triage** — `applied` / `dismiss` write through the helpers
  (`append_state_entry.sh`, `job_state.py record-event`); resolved
  items are derived, never deleted (queue is append-only).
- **Side panel** — applied count, queue depth, mode badge, and build
  marker. Hides below 64×18 and reappears when the terminal grows.
- **One-frame / piped renders** — `COLUMNS` / `LINES` are honored on
  non-TTY stdout so CI smoke runs lay out the same as a real
  terminal.
- **Subcommands** — `applyr status` (scripting/CI), `applyr run`
  (trigger one run, stream the log), `applyr setup [--check]`
  (wizard), `applyr review` / `applyr history` (jump straight to a
  tab).

### TUI polish since the last TUI commit

- Opencode `--print` CLI fix — the runner probes for the removed
  `--print` flag so OpenCode ≥ 1.17 launches and legacy CLIs still
  work.
- TUI resize invariant — frame is pinned to viewport height with
  overflow hidden; Help / Welcome tier by available rows; banner art
  only at ≥ 24 rows; `MIN_ROWS` raised to 12. Fixes duplicated /
  clipped frames on resize.
- TUI large-terminal fill — content band centers when columns > 160
  (with side panel overhead), list caps 30 rows, Status shows a
  recent-activity panel on tall terminals.
- TUI run controls — cap tier colors with animated MAX warning at
  25, optional per-run operator prompt via `APPLYR_EXTRA_PROMPT`
  (500-char cap, never overrides `AGENTS.md` or the session cap).
- TUI accessibility pass — `?` help, `Esc` never quits, `enter` to
  open, `q` confirms before quit while a run is active.

### Phase 15 — harness portability (partial)

The agent now runs under **OpenCode** or **Claude Code** at the
driver's choice. `scripts/run_job_agent.sh` selects the harness
in this priority order: `$APPLYR_HARNESS` → `config/harness.json` →
auto-detect (opencode, then claude). The default installer
(`scripts/install.sh`) detects installed harnesses, asks which to
use when both are present, and writes the choice to
`config/harness.json`. **Codex** and **GitHub Copilot** support is
planned (phase 16) and noted in the installer's prompt.

The orchestrator prompt (`agents/bodies/job-scraper.md`) is
harness-neutral; the frontmatter is generated per harness by
`scripts/generate_agent_definitions.py` from
`agents/frontmatter/{opencode,claude}/`. The runner runs a drift
check (`generate_agent_definitions.py --check`) at the start of
every run and warns when generated files are stale.

Per-harness notes:

- **opencode** — agents load from `.opencode/agents/`; models come
  from `opencode.jsonc`.
- **Claude Code** — agents load from `.claude/agents/` (`model:
  inherit`, so runs use your session's model); Playwright MCP comes
  from `.mcp.json`. Headless runs need pre-approved permissions in
  `.claude/settings.json`; the installer offers to create it (asks
  first, because it grants Claude broad repo-local tool access).

### Fetch-efficiency rules (AGENTS.md)

Hard caps on what one run may fetch / print, added after a runaway
cap-2 run pulled 7,156 raw jobs in one go and never finished:

- Every board fetch and fetch-helper output is redirected to a file
  under `logs/tmp/` (`mkdir -p logs/tmp` first; the runner clears it
  per run). The LLM transcript sees only the board name and a line
  count.
- Raw postings are prefiltered deterministically (role / level
  keyword rule) **before** canonicalizing, writing survivors to
  `logs/tmp/prefiltered.jsonl`. Prefiltered-out jobs are never
  recorded or acted on.
- Shortlist bound — stop adding candidates once the prefiltered
  shortlist reaches **5× the session cap (minimum 10)**.
  Unprocessed raw jobs wait for the next scheduled run.
- The transcript prints at most ~30 shortlist lines
  (company · title · url) when reviewing candidates.

### CI

Two GitHub Actions workflows are wired up for the tag:

- `.github/workflows/tui.yml` — `app/` typecheck, build, and
  non-interactive smoke run (`npm run smoke`).
- `.github/workflows/extension.yml` — `extension/` typecheck and
  `npm run build`.

### Config / installer improvements

- `scripts/install.sh` is the universal first-run installer. It
  copies example configs, detects harnesses, prompts for a choice
  when both opencode and Claude Code are present, optionally
  creates `.claude/settings.json`, regenerates per-harness agent
  definitions, runs the validator, and offers to build the TUI.
  Non-destructive — existing live configs are never overwritten.
- `config/harness.json` (gitignored) holds the user's harness
  choice. `config/harness.example.json` documents the shape.
- Phase 6 vetted-slug auto-seeding is wired into the validator
  and the installer — a placeholder-only `ashby_company_slugs` or
  `lever_company_slugs` array is seeded from
  `config/{ashby,lever}_vetted_slugs.json`. The vetted lists are
  project-owned (hand-verified, `verified_at` recorded in each
  file). Seeding never overwrites a non-placeholder value.

### What hasn't changed

The agent core (Phases 0–8 and 10) is identical to the
pre-rename code: `scripts/job_state.py` (canonical registry,
`can-apply`, `record-event`), `scripts/evaluate_job_fit.py` (the
deterministic fit gate), `scripts/fetch_simplify_listings.py`,
`scripts/fetch_workday_listings.py`,
`scripts/sync_internship_tracker.py`,
`scripts/append_state_entry.sh`, `scripts/validate_local_config.sh`,
`scripts/extension_bridge.py`, and the extension code in
`extension/`. `AGENTS.md` (the rules) is unchanged in spirit; the
"Phase status" block was updated to reflect the rename and the
TUI work items closed in this build.

## What ships today (per the repo, not the plan)

- **Phase 0** — `.gitignore` excludes live configs, runtime state,
  PII, browser artifacts, logs, and Python bytecode. The
  `*.example.json` files in `config/` are the templates.
  `scripts/run_job_agent.sh` is the cron entry point with portable
  lock handling and startup config validation.
- **Phase 1** — canonical job registry (`data/job_registry.json`),
  append-only event log (`data/job_events.jsonl`), and `can-apply`
  pre-apply recheck. Managed by `scripts/job_state.py`.
- **Phase 2** — Discord outcome routing. Per-outcome webhooks
  (`success` / `needs_review` / `failed` / `summary`), best-effort:
  a missing or placeholder webhook is logged and skipped, never
  blocks the run.
- **Phase 3** — Google Sheets sync for successful applications.
  Exactly one row appended per `applied` outcome.
  `needs_review`, `failed`, and `skipped_unfit` are never written.
- **Phase 4** — deterministic JD fit gate
  (`scripts/evaluate_job_fit.py`). Runs before tailoring and
  immediately before applying.
- **Phase 5** — SimplifyJobs ingestion
  (`scripts/fetch_simplify_listings.py`). JD body is fetched from
  each listing's URL before the fit gate.
- **Phase 6** — vetted Ashby / Lever slug auto-seeding
  (`scripts/seed_vetted_slugs.py` +
  `config/{ashby,lever}_vetted_slugs.json`).
- **Phase 7** — Workday review-only ingestion
  (`scripts/fetch_workday_listings.py`). Promising jobs are routed
  to the review queue and the needs-review Discord webhook; **no
  auto-apply path exists for Workday**, and review items don't
  count against the session cap.
- **Phase 8** — 30-minute 24/7 scheduler (`scripts/scheduler.sh`,
  launchd on macOS). Skip-on-overlap, dead-lock reclaim, 60-minute
  hung-run threshold, heartbeat (`logs/heartbeat.json`), and
  machine-parseable health marker.
- **Phase 10** — Chrome Manifest V3 extension (`extension/`) +
  localhost bridge (`scripts/extension_bridge.py`). Autofill from
  `safe_fields`, fit verdict badge, helper-backed outcome
  recording. **The extension never submits a form** — the user
  reviews and clicks submit themselves.
- **Phase 13** — TUI overlay (`app/`, Ink + React). Persistent
  full-screen shell, welcome / help overlays, manual + automatic
  modes, review triage, status / history browse. Local install
  only (`npm link` or `node dist/cli.js`); `npm` publication,
  provider-setup, and hosted storage are deferred.
- **Phase 15** — OpenCode + Claude Code harness portability
  (partial; live parity run pending).

`docs/PLAN.md` (gitignored) holds the phase-by-phase roadmap, the
Phase Status Pointer, and the per-harness setup. `AGENTS.md` is
the canonical ruleset — read it before doing anything in this repo.

## Known gaps (do not claim these as shipped)

- **Phase 9** — migration-friendliness review is **planned, not
  yet implemented**.
- **Phase 13** — `npm` publication, provider-setup, and hosted
  storage are **deferred**. Install from the local repo. The
  workflow for hosted state is not defined.
- **Phase 15** — live parity run is pending. Both harnesses
  work; they have not been exhaustively compared in production.
- **Phase 16** — Codex and GitHub Copilot support is planned.
  The installer notes this when both opencode and Claude Code are
  detected.
- **Workday is review-only by design.** The auto-apply path does
  not exist and is not planned.
- **`docs/PLAN.md` is gitignored** by design. The public roadmap
  signal is the roadmap table in `README.md`; the full plan lives
  in the working copy.
- The TUI's **side panel** shows a `Test User` rainbow wordmark —
  a UI placeholder. There is no backend account store yet.
- The TUI's automatic-mode `MAX` warning animates **only on a real
  TTY** (a piped one-frame render gets a static warning color so CI
  output stays deterministic).

## Verification (what was actually run for this tag)

- `node app/dist/cli.js help` — prints the in-repo TUI help
  correctly.
- `APPLYR_ROOT=/Users/keshmuthu/ares node app/dist/cli.js status` —
  prints Status (Applied / Needs review / Failed / Registry /
  Scheduler health / Last run / session log path) with live
  data from `data/*.json` and `logs/heartbeat.json`.
- `bash scripts/install.sh --help` (in dry-run) and the validator
  pipeline (pre-merge).

The full install + first-run instructions are in `README.md`
("Install / first run") and `docs/SETUP.md` ("Universal install
(recommended)").

## Files changed in 0.5.5a (since the prior TUI commit)

Code:

- `app/src/cli.tsx` — `setup [--check]`, `run`, `status`,
  `review`, `history` subcommands; piped-render
  `COLUMNS` / `LINES` sync; alternate-screen handling.
- `app/src/project.ts` — `APPLYR_ROOT` resolution
  (legacy `ARES_ROOT` honored).
- `app/src/state.ts` — derived `isResolved` / `hasAppliedOrFailed`
  / `isDismissed` from the registry + applied log (the queue file
  is append-only).
- `app/src/theme.ts` — `BUILD_MARKER = "0.5.5a"`, `SIDE_PANEL_WIDTH`,
  cap-tier colors, `hueColor()` for the animated MAX warning.
- `app/src/ui/App.tsx` — persistent shell, tab row, content
  region, hint bar, side panel, welcome / help overlays,
  responsive layout math.
- `app/src/ui/Banner.tsx` — art-vs-wordmark by terminal size.
- `app/src/ui/HistoryScreen.tsx` — newest-first list with
  row-clamping.
- `app/src/ui/ReviewScreen.tsx` — apply / dismiss via the helpers;
  show-resolved toggle; shell-refresh via `refreshNonce`.
- `app/src/ui/RunScreen.tsx` — browse-first automatic mode;
  tier-colored cap input; animated MAX warning; optional extra
  prompt; session-log tail.
- `app/src/ui/SearchScreen.tsx` — manual mode; live Ashby / Lever
  / Workday search; per-source badges; fit check; save to
  review.
- `app/src/ui/StatusScreen.tsx` — embedded-friendly layout;
  recent-activity panel on tall terminals.
- `app/src/wizard.ts` — `applyr setup [--check]`.
- `app/src/ui/HelpOverlay.tsx` — new: full / compact key
  reference.
- `app/src/ui/KeyHints.tsx` — new: hint chunks with key caps
  colored; `RainbowText` for the animated MAX warning.
- `app/src/ui/SidePanel.tsx` — new: right-side status panel
  (applied / queue / mode / build marker).
- `app/src/ui/TextInput.tsx` — new: shared inline input
  primitives (cursor, insert, backspace, delete, arrow keys).
- `app/src/ui/WelcomeScreen.tsx` — new: launch menu.
- `extension/src/*` — first-cut of the MV3 extension + ats
  selectors (Phase 10).
- `scripts/extension_bridge.py` — first-cut of the localhost
  bridge.
- `scripts/fetch_simplify_listings.py` — SimplifyJobs fetcher
  (Phase 5).
- `scripts/fetch_workday_listings.py` — Workday fetcher
  (Phase 7).
- `scripts/install.sh` — universal first-run installer.
- `scripts/run_job_agent.sh` — harness selection
  (`APPLYR_HARNESS`), agent-drift check, per-run outcome-delta
  health marker, `APPLYR_SESSION_CAP` clamp, `APPLYR_EXTRA_PROMPT`
  injection.
- `scripts/scheduler.sh` — `com.applyr.job-agent` label;
  cleans up the pre-rename `com.ares.job-agent` label.
- `.github/workflows/extension.yml` — new.
- `.github/workflows/tui.yml` — new.

Docs / config:

- `app/package.json` — version `0.5.5a`; alpha tag.
- `extension/package.json` — version `0.5.5a`.
- `extension/src/manifest.json` — version `0.5.5` (Chrome
  Web Store rejects pre-release suffixes).
- `.gitignore` — adds `app/dist/`, `extension/dist/`,
  `config/harness.json`, `config/extension_bridge.json`,
  `.claude/settings.json`.
- `agents/README.md`, `agents/bodies/*.md`,
  `agents/frontmatter/{opencode,claude}/*.yaml` — single source
  of truth for agent definitions.
- `README.md` — this build's "what applyr is, what it does
  today, how to install from GitHub without `git clone`" rewrite.
- `docs/RELEASE.md` (this file) — release notes for 0.5.5a.
- `docs/CHANGELOG.md` — minimal changelog with 0.5.5a as the
  first entry.
- `docs/SETUP.md` — minor clarifications; "Universal install
  (recommended)" already documented the one-command flow.
- `AGENTS.md` — phase-status block updated for the rename +
  TUI work items closed in this build.
- `CLAUDE.md` — "Ares" → "applyr" throughout; harness notes
  updated for OpenCode + Claude Code.

> **`docs/PLAN.md` is gitignored** and is **not** in this
> changeset; it lives in the working copy as the durable
> in-repo planning and handoff document.

## Versioning assumptions made for this build

- **`BUILD_MARKER = "0.5.5a"`** in `app/src/theme.ts` is the
  single source of truth for the in-app build marker.
- **`app/package.json` version = `0.5.5a`** with a
  `publishConfig.tag = "alpha"` to keep an `npm publish` honest
  about pre-release status. The package is not actually
  published in this build.
- **`extension/package.json` version = `0.5.5a`** (dev-only, not
  published).
- **`extension/src/manifest.json` version = `0.5.5`** — the
  Chrome Web Store rejects pre-release suffixes, so the `a` is
  dropped on the manifest only.
- **Git tag for the release:** `0.5.5a` (the `a` suffix is legal
  in `git tag`).
- **GitHub release title / tag:** `0.5.5a`.

## Release artifacts (what needs to be in the GitHub release)

- The tag `0.5.5a` on the `main` branch.
- A GitHub release titled `applyr 0.5.5a` with the body of this
  file (or a tightened summary pointing at `docs/RELEASE.md`).
- A source-archive download of the `main` branch at the
  `0.5.5a` tag (the standard "Source code (zip)" /
  "Source code (tar.gz)" assets GitHub produces automatically).
- The two CI workflows (`.github/workflows/tui.yml`,
  `.github/workflows/extension.yml`) run on the tag and report
  status; no release-asset uploads are configured.

## Post-release handoff

- The TUI build marker (`BUILD_MARKER`) is the in-app proof that
  a user is on `0.5.5a`. A green build marker in the side panel
  footer = on-release.
- `applyr status` (one-shot, scripting/CI friendly) prints the
  build marker via the side panel's CSS — the one-shot
  `status` command does not currently echo the build marker;
  that is a known follow-up.
- Phase 9 is next; phase 13 publication and phase 16 (Codex /
  Copilot) are still on the board.
