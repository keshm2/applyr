# applyr

> An automated, single-user job-application agent for internship and
> new-grad roles. Scrapes public boards, deduplicates against local
> history, tailors a resume and cover letter, applies on your behalf,
> routes per-outcome updates to Discord, and appends one row per
> success to a Google Sheet tracker.
>
> **Build 0.5.5a** — first tagged release. See
> [Release notes](docs/RELEASE.md) and [Changelog](docs/CHANGELOG.md).
> The build marker is also shown in the TUI side-panel footer.

applyr (formerly Ares) is built on an LLM harness — **OpenCode** or
**Claude Code** — chosen at install time. The harness **orchestrates**;
deterministic Python and bash helpers **own the state**. That split
keeps every state-mutating step auditable and means the harness itself
never hand-writes runtime state. Each run is capped at **25
applications** to stay polite to upstream boards and rate limits.

> **Status** — Phases 0–8, 10, and 15 (core) are implemented; the
> Phase 13 TUI is shipped as a local-repo alpha. Phase 9 is planned;
> Phase 16 (Codex, GitHub Copilot) is planned. No hosted accounts, no
> `npm` publication, no provider-setup — install from a GitHub
> download and run locally. Workday is review-only by design.

## What applyr does today

For each run, applyr:

1. **Scrapes** postings from supported boards.
2. **Canonicalizes** every raw posting into one internal record.
3. **Deduplicates** against the local registry and the application log.
4. **Fit-gates** each canonical job with a deterministic helper
   (role / level keywords, years of experience, location).
5. **Tailors** a resume and cover letter for jobs that pass the gate.
6. **Submits** applications through a Playwright-controlled browser.
   The public Ashby and Lever JSON APIs are used for job discovery,
   not application submission.
7. **Records** the outcome locally, fires the right Discord webhook,
   and (for successful applications only) appends one row to the
   Google Sheet tracker.

A typical first session looks like this:

```bash
bash scripts/install.sh                # one-command first-run installer
applyr                                  # open the TUI
# inside the TUI: choose from the welcome menu, ? help, w reopen menu
```

The TUI is a thin shell over the same Python and bash helpers the
cron entry point uses. **It never writes state JSON directly** — every
mutation goes through `scripts/job_state.py`,
`scripts/append_state_entry.sh`, and the other helpers. That keeps
the rules auditable and the state recoverable.

## At a glance

| | |
| --- | --- |
| **Build** | `0.5.5a` (alpha) |
| **Mode** | Single user, local-first, cron-friendly |
| **Boards (today)** | Ashby, Lever (public JSON APIs); SimplifyJobs (public GitHub JSON feeds); Workday (public CXS JSON, review-only); LinkedIn, Indeed, Handshake, Greenhouse, Wellfound (Playwright) |
| **Harnesses** | OpenCode, Claude Code (phase 15). Codex and GitHub Copilot planned (phase 16). |
| **Runtime** | Harness orchestrator + stdlib-only Python helpers + bash driver |
| **Notifications** | Discord webhooks routed by outcome (`success` / `needs_review` / `failed` / `summary`) |
| **Tracker** | Google Sheet — one append-only row per successful application |
| **TUI** | `applyr` — Ink + React, persistent full-screen app, local install |
| **State** | Local JSON + JSONL under `data/` (gitignored) |
| **Caps** | 25 applications per session (TUI may lower per run via `APPLYR_SESSION_CAP`) |

## Install / first run (from GitHub, no `git clone`)

This build is published as a **GitHub release** with the standard
source-code zip and tar.gz assets. Download the archive for
`applyr 0.5.5a` from the Releases page, unpack it, and run the
installer.

**macOS / Linux — one command:**

```bash
# The project is named applyr; the GitHub repository is still keshm2/ares.
curl -L -o applyr-0.5.5a.zip https://github.com/keshm2/ares/archive/refs/tags/0.5.5a.zip
unzip applyr-0.5.5a.zip
cd ares-0.5.5a
bash scripts/install.sh
```

The same flow with a tarball:

```bash
curl -L -o applyr-0.5.5a.tar.gz https://github.com/keshm2/ares/archive/refs/tags/0.5.5a.tar.gz
tar -xzf applyr-0.5.5a.tar.gz
cd ares-0.5.5a
bash scripts/install.sh
```

`scripts/install.sh` is non-destructive:

1. Checks for `jq` and `python3` (Node is optional — needed only for
   the TUI).
2. Copies `config/*.example.json` to live configs where missing
   (your existing live configs are never overwritten).
3. Detects installed coding agents (opencode, Claude Code) and
   writes `config/harness.json`. When both are present, the
   installer asks which to use.
4. If you choose Claude Code, offers to create
   `.claude/settings.json` (asks first — it grants Claude broad
   repo-local tool access for headless runs).
5. Regenerates per-harness agent definitions from `agents/`.
6. Runs `scripts/validate_local_config.sh` (which also auto-seeds
   placeholder Ashby / Lever slug arrays from the project's vetted
   lists).
7. If `npm` is available, builds the TUI.

If you cannot download directly with `curl` (corporate proxy,
offline machine, etc.), download the zip from the GitHub release
page, transfer it by hand, and run `bash scripts/install.sh` from
inside the unpacked directory.

**Prerequisites:**

- `python3` (stdlib only — no `pip install` for the agent core)
- `jq` (the config validator and the runner use it)
- A coding agent: [OpenCode](https://opencode.ai) or
  [Claude Code](https://claude.com/claude-code). The installer
  refuses to start a run if neither is found.
- `pip3 install -r requirements.txt` only if you enable the
  optional Google Sheets sync.
- `node` ≥ 18 and `npm` only if you want the TUI.

> **No `git` is required to install or run applyr.** The installer
> never clones anything, and the runner does not need git history.

After install:

```bash
# Edit placeholders in the two live configs (or run `applyr setup`):
$EDITOR config/targets.json
$EDITOR config/discord_config.json

# Validate, then either run a cycle or open the TUI.
bash scripts/validate_local_config.sh   # prints "validate_local_config: OK"
applyr                                  # open the TUI
# or:
bash scripts/run_job_agent.sh           # one cycle, cron-style
```

The Google Sheets sync is **optional** — `docs/SETUP.md` §4 walks
through the service-account setup. Skip it and `applied` outcomes
still land in `data/applied_jobs.json`; the local log remains the
source of truth.

## Build 0.5.5a — what's in it

The full release document is **[docs/RELEASE.md](docs/RELEASE.md)**.
The short version:

- **Project rename Ares → applyr** — TUI command, npm package,
  launchd label (`com.applyr.job-agent`), and env-var prefix
  (`APPLYR_*`; legacy `ARES_*` honored).
- **TUI as a persistent full-screen app** (Phase 13, local-repo
  alpha) — welcome page, manual and automatic modes, review
  triage, in-app help, responsive layout, side panel with build
  marker. Subcommands: `applyr status`, `applyr run`, `applyr
  setup [--check]`, `applyr review`, `applyr history`,
  `applyr help`.
- **Harness portability** (Phase 15, partial) — OpenCode and
  Claude Code both supported; `scripts/install.sh` detects and
  prompts when both are present.
- **Universal installer** — `bash scripts/install.sh` takes a
  fresh GitHub download to a validated, harness-configured
  setup in one command.
- **Fetch-efficiency rules** (AGENTS.md) — fetches redirect to
  `logs/tmp/`, deterministic prefilter before canonicalizing,
  shortlist bound 5× session cap (min 10), ≤ 30 shortlist lines
  in the transcript. Closes the runaway-cap failure mode.
- **CI** — `.github/workflows/tui.yml` and
  `.github/workflows/extension.yml` typecheck, build, and
  smoke-test the TUI and the extension.
- **Version references** — `BUILD_MARKER = "0.5.5a"` in
  `app/src/theme.ts` (visible in the TUI side-panel footer);
  `app/package.json` and `extension/package.json` version
  `0.5.5a`; `extension/src/manifest.json` version `0.5.5`
  (Chrome Web Store rejects pre-release suffixes — the `a` is
  dropped on the manifest only).

The full changelog is at **[docs/CHANGELOG.md](docs/CHANGELOG.md)**.
The pre-tag history is summarized at the bottom of that file.

## What ships today

Phases 0–8, 10, and 15 (core) of the project roadmap are
implemented. Phase 13 is partial — the TUI overlay works from the
local repo, while `npm` publication, provider-setup, and hosted
storage remain deferred (see the section below).

- **State and config hardening (phase 0).** `.gitignore` excludes
  all live configs, runtime state, PII, browser artifacts, logs,
  and Python bytecode. `*.example.json` files are the safe
  templates. `scripts/run_job_agent.sh` is a cron-friendly entry
  point with portable lock handling and startup config
  validation.
- **Canonical job registry and event model (phase 1).** Every
  scraped job is canonicalized and merged into
  `data/job_registry.json` via `scripts/job_state.py`. An
  append-only `data/job_events.jsonl` audit log records every
  outcome. A pre-apply `can-apply` recheck prevents re-applying
  to the same job.
- **Discord outcome routing (phase 2).** Notifications route by
  outcome — `success`, `needs_review`, `failed`, and an
  end-of-batch `summary` (with `success` as the fallback). The
  reporter is best-effort: a missing or placeholder webhook is
  logged and skipped, never blocks the run.
- **Google Sheets sync for successful applications (phase 3).**
  Exactly one row is appended to a user-facing Google Sheet per
  successful application. `needs_review`, `failed`, and
  `skipped_unfit` outcomes are never written to the sheet.
- **Deterministic JD fit gate (phase 4).** A stdlib-only Python
  helper (`scripts/evaluate_job_fit.py`) classifies each
  canonical job as `candidate`, `needs_review`, or
  `skipped_unfit` before tailoring, and again immediately before
  applying.
- **SimplifyJobs ingestion (phase 5).** A stdlib-only fetch
  helper (`scripts/fetch_simplify_listings.py`) pulls the
  community-maintained SimplifyJobs internship and new-grad
  listing feeds from GitHub (read-only, no auth), filters to
  active + visible postings, and emits canonicalize-ready
  records. The feeds carry no JD text, so the orchestrator
  fetches each surviving candidate's JD from its listing URL
  before the fit gate runs. A missing or placeholder
  `simplify_feeds` config skips the board with a warning.
- **Workday review-only ingestion (phase 7).** A stdlib-only
  helper (`scripts/fetch_workday_listings.py`) pulls postings
  from configured Workday tenants via their public CXS JSON
  endpoints (list + per-job JD fetch). Promising jobs are routed
  to the review queue and the needs-review Discord webhook for
  manual application — **no auto-apply path exists for
  Workday**, and review items don't count against the session
  cap.
- **Always-on scheduler (phase 8).** `scripts/scheduler.sh`
  installs a launchd user agent running the pipeline every 30
  minutes, 24/7. A tick that lands mid-run logs `skipped_overlap`
  and exits cleanly (no second agent); dead locks are reclaimed
  immediately and hung runs past 60 minutes are terminated and
  reclaimed. Every run emits a machine-parseable health marker
  and updates `logs/heartbeat.json` (outcome counts, run counter,
  consecutive-failure streak — also surfaced on the TUI status
  screen). Session logs are pruned to the newest 30.
- **Vetted Ashby / Lever slug auto-seeding (phase 6).** When
  `ashby_company_slugs` / `lever_company_slugs` are unset,
  empty, or placeholder-only, `scripts/seed_vetted_slugs.py`
  (run by the config validator) seeds them from the
  project-owned, hand-verified vetted lists in
  `config/ashby_vetted_slugs.json` and
  `config/lever_vetted_slugs.json`, so a fresh download has real
  board coverage on the first run. A non-placeholder value is
  never overwritten, and every seeded array prints a visible
  warning.
- **Terminal UI overlay (phase 13, partial).** A TypeScript TUI
  in `app/` (Ink + React) provides a full-screen shell for
  browsing state, triaging the review queue, manual job search,
  and triggering runs. The Python and bash helpers remain the
  sole authoritative state writers — the TUI never edits state
  JSON directly. `npm` publication, provider-setup, and hosted
  storage are deferred — install from the local release
  archive. Full details: [TUI section](#terminal-ui-overlay-phase-13-partial).
- **Browser extension — hybrid mode (phase 10).** A Chrome
  Manifest V3 extension in `extension/` for user-driven
  applications: it autofills application forms **only** from
  `safe_fields`, shows the phase 4 fit verdict as an on-page
  badge, and records outcomes through a localhost-only,
  token-authenticated bridge (`scripts/extension_bridge.py`) that
  wraps the same state helpers as the agent — so hybrid and
  automatic applications dedupe against each other. **The
  extension never submits a form**; the user reviews and clicks
  submit themselves. Setup: `docs/SETUP.md` §3.6.
- **Harness portability (phase 15, partial).** Runs under
  OpenCode or Claude Code. The orchestrator prompt
  (`agents/bodies/job-scraper.md`) is harness-neutral; the
  per-harness agent definitions are generated from
  `agents/frontmatter/{opencode,claude}/` by
  `scripts/generate_agent_definitions.py`.

## Pipeline

A typical run moves a job through the following stages, in order:

```
   scrape              canonicalize           dedupe
[ board ]  --->  [ job_state.py ]  --->  [ registry + applied log ]
                                              |
                                              v
                              [ evaluate_job_fit.py ]  (phase 4 gate)
                                           |
             +---------------+-------------+-------------+
             | skipped_unfit | needs_review            | candidate
             | (local-only)  | (user-visible)          |
             v               v                        v
        record-event   record-event +         [ @resume-tailor ]
        (no Discord,    applied_jobs.json +          |
         no applied     review_queue.json +          v
         log)           needs_review Discord   [ re-run fit gate ]
                                              (pre-apply confirm)
                                                      |
                                                      v
                                              [ can-apply recheck ]
                                                      |
                                                      v
                                              [ submit application ]
                                                      |
                                                      v
                                       record-event + applied_jobs.json
                                       + @discord-reporter (success)
                                       + sync_internship_tracker.py
```

### Outcome routing at a glance

> Each outcome has exactly one path. The agent never sends the same
> fact to two user-facing surfaces, and never leaks a `skipped_unfit`
> to the user.

- **`applied`** — recorded, written to `data/applied_jobs.json`,
  Discord `success` route, one row appended to the Google Sheet.
- **`needs_review`** — recorded, written to
  `data/applied_jobs.json` and `data/review_queue.json`, Discord
  `needs_review` route. Never tailored; never written to the
  sheet.
- **`failed`** — recorded, written to `data/applied_jobs.json`,
  Discord `failed` route. Never written to the sheet.
- **`skipped_unfit`** — recorded only as a local event. Never
  routed to Discord, never written to `data/applied_jobs.json`,
  never synced to the sheet.

## Repo layout

Key files and entry points:

**Behavior and planning**

- `AGENTS.md` — canonical behavioral rules for the agent (fetch
  methods, role/level filtering, fit gate, registry, file write
  discipline, Sheets sync). Any agent that mutates state follows
  this file.
- `docs/PLAN.md` — durable, in-repo planning and handoff document.
  Gitignored. **Read this first** if you are picking the project
  up.
- `docs/SETUP.md` — copy → edit → validate walkthrough for the
  local configs, plus the optional Google Sheets sync section.
- `docs/RELEASE.md` — release notes for build `0.5.5a`.
- `docs/CHANGELOG.md` — minimal changelog with `0.5.5a` as the
  first entry.
- `opencode.jsonc` — OpenCode configuration. The default agent is
  `job-scraper`; loads `AGENTS.md`, `config/targets.json`, and
  `data/applied_jobs.json` as instructions; enables the Playwright
  MCP server.

**OpenCode agents** (`.opencode/agents/`) — generated, do not
hand-edit

- `job-scraper.md` — the orchestrator. Scrapes, canonicalizes,
  runs the fit gate, calls `@resume-tailor`, runs the apply loop,
  fires per-outcome Discord notifications, and fires the batch
  summary.
- `resume-tailor.md` — subagent. Selects one of five base resumes
  by job category (swe, ai_ml, balanced, cyber,
  networking_cyber), rewrites bullets, writes a cover letter,
  returns an `ats_score`.
- `discord-reporter.md` — subagent. Reads the per-outcome webhook
  routes, JSON-escapes every payload, POSTs with
  `allowed_mentions: parse=[]`. Skips `skipped_unfit`.

**Helper scripts** (`scripts/`)

- `install.sh` — universal first-run installer (this build).
- `run_job_agent.sh` — cron-friendly driver. Validates config,
  bootstraps state files, then runs the harness.
- `validate_local_config.sh` — startup validator. Fails on
  missing or invalid required config; warns (does not fail) on
  placeholder Ashby / Lever slugs, placeholder SimplifyJobs
  feeds, and on an unconfigured or disabled Sheets sync.
- `append_state_entry.sh` — atomic JSON-array appender with a
  `job_id` dedup guard. Used for `data/applied_jobs.json` and
  `data/review_queue.json`.
- `job_state.py` — phase 1 canonical helper. Subcommands:
  `ensure-files`, `canonicalize`, `upsert-job`, `can-apply`,
  `record-event`. Stdlib-only.
- `evaluate_job_fit.py` — phase 4 deterministic fit gate.
  Stdlib-only. Returns `candidate` / `needs_review` /
  `skipped_unfit` with `fit_score`, `fit_reasons`, and
  `decision_version`.
- `fetch_simplify_listings.py` — phase 5 SimplifyJobs fetcher.
  Stdlib-only.
- `fetch_workday_listings.py` — phase 7 Workday fetcher
  (review-only). Stdlib-only.
- `seed_vetted_slugs.py` — phase 6 Ashby / Lever slug
  auto-seeder. Stdlib-only.
- `generate_agent_definitions.py` — phase 15 agent-definition
  generator (reads `agents/bodies/` + `agents/frontmatter/`).
  `python3 scripts/generate_agent_definitions.py --check` runs
  as a drift check at the start of every run.
- `scheduler.sh` — phase 8 launchd user-agent installer
  (`install` / `uninstall` / `status` / `plist`).
- `write_heartbeat.py` — phase 8 heartbeat writer.
- `sync_internship_tracker.py` — phase 3 Sheets helper. Maps a
  payload to the visible columns and appends one row. Skips
  cleanly when sync is disabled or unconfigured; never turns a
  successful application into a failure.
- `extension_bridge.py` — phase 10 localhost bridge for the
  extension.

**TUI overlay** (`app/`, phase 13 partial)

- `cli.js` (built from `src/cli.tsx`) — entry point.
  Subcommands: `setup [--check]`, `status`, `review`,
  `history`, `run`. Set `APPLYR_ROOT` to run outside the repo.
- `src/ui/App.tsx` — persistent shell: tab row, content region,
  hint bar, side panel. Tabs are Status, Jobs, Review, History.
  The Jobs tab switches between manual and automatic mode
  (`m` toggles).
- `src/ui/SearchScreen.tsx` — manual Jobs mode. Live configured
  Ashby / Lever / Workday search, typed query, browser open,
  deterministic fit check, helper-backed save to review.
- `src/ui/RunScreen.tsx` — automatic Jobs mode. Per-cycle
  application cap (1–25) → `APPLYR_SESSION_CAP` → spawns
  `scripts/run_job_agent.sh` and tails the session log.
- `src/ui/SidePanel.tsx` — right-side panel (applied / queue /
  mode / build marker `0.5.5a`).
- `src/ui/WelcomeScreen.tsx` / `HelpOverlay.tsx` — onboarding
  and in-app help.

State-write discipline is the same as the rest of the project —
the TUI never edits state JSON directly. See
[Terminal UI overlay](#terminal-ui-overlay-phase-13-partial)
for the user-facing walkthrough.

**Browser extension** (`extension/`, phase 10)

- `src/manifest.json` — MV3 manifest: content script on the four
  ATS families (Greenhouse, Lever, Ashby, Workday), localhost
  host permission for the bridge, options page.
- `src/ats.ts` — the one reviewable module holding all per-ATS
  selectors: posting extraction and form-field → `safe_fields`
  mapping.
- `src/content.ts` — on-page panel: fit check, autofill (fill
  green / attention amber), save-for-review,
  record-applied. Never submits.
- `src/background.ts` — service worker; the only component
  holding the bridge token.
- `scripts/extension_bridge.py` — localhost-only bridge (stdlib
  Python); wraps the state helpers behind a per-install bearer
  token.

**Config templates** (`config/`)

- `targets.example.json` — role / level / season keywords,
  preferred locations, fallback scope, Ashby / Lever slug
  arrays, and the `safe_fields` map the agent uses to fill form
  fields.
- `discord_config.example.json` —
  `webhooks.{success, needs_review, failed, summary}` template.
- `google_sheets_config.example.json` — Sheets sync template
  with `enabled`, `spreadsheet_id`, `worksheet_title`, and
  `service_account_key_path`.
- `harness.example.json` — phase 15 harness choice
  (`{"harness": "opencode"}` or `{"harness": "claude"}`).
- `ashby_vetted_slugs.json` / `lever_vetted_slugs.json` — phase
  6 project-owned vetted slug lists, hand-verified
  (`verified_at` recorded in each file).

> The live versions of these configs (`config/targets.json`,
> `config/discord_config.json`, `config/google_sheets_config.json`,
> `config/service-account-key.json`, `config/harness.json`,
> `config/extension_bridge.json`) are gitignored. Start from the
> shipped examples — see `docs/SETUP.md`.

**Runtime state** (`data/`, all gitignored)

- `applied_jobs.json` — one entry per `applied` / `failed` /
  `needs_review` outcome. Required fields are documented in
  `AGENTS.md`. `skipped_unfit` is never written here.
- `review_queue.json` — items that need a human to look at (form
  fields we couldn't fill, ambiguous-fit jobs, etc.). Append-only.
- `job_registry.json` — array of canonical records, one per
  ever-seen job. Merged by `job_key` via `job_state.py
  upsert-job`. Multiple `sources[]` per record are preserved.
- `job_events.jsonl` — append-only JSONL event log. One line
  per `record-event` call. The registry is the structured
  view; the JSONL is the audit trail.
- `resumes/` — five base resumes (`base_resume_swe`,
  `base_resume_ai_ml`, `base_resume_balanced`,
  `base_resume_cyber`, `base_resume_networking_cyber`) plus
  `base_cover_letter`, each as `.md` + `.pdf`. The
  `@resume-tailor` subagent selects among them by job category;
  `balanced` is the default.

## Quick start (after install)

The first-run installer handles sections 0–3 of `docs/SETUP.md`.
After that:

```bash
# Edit the live configs (or run `applyr setup`).
$EDITOR config/targets.json
$EDITOR config/discord_config.json

# Validate.
bash scripts/validate_local_config.sh   # prints "validate_local_config: OK"

# One run, cron-style.
bash scripts/run_job_agent.sh
# or, the same via the TUI:
applyr
```

The Google Sheets sync is **optional** — `docs/SETUP.md` §4 walks
through the service-account setup.

## Terminal UI overlay (Phase 13, partial)

The TypeScript TUI in `app/` runs over the same configs and
Python and bash helpers that drive the cron entry point. The
Python helpers and `scripts/append_state_entry.sh` remain the sole
authoritative state writers — the TUI shells out to them for
every mutation and never edits state JSON directly. The
review-queue file stays append-only: the TUI's triage records
outcomes (`applied_jobs` append + `record-event`) and derives
"resolved" from them.

> This is **working but still an alpha** with kinks being
> refined. `npm` publication, provider-setup, and hosted storage
> are deferred — install from the local release archive (see
> [Install / first run](#install--first-run-from-github-no-git-clone)).
> Workday is review-only and requires configured tenants in
> `config/targets.json` to surface postings; without tenants,
> the board reports as off.

**Prerequisite:** Node.js 18+ (matches `app/package.json` engines).

**Install and run from the unpacked release archive:**

```bash
cd applyr-0.5.5a/app
npm install
npm run build
npm link        # exposes the `applyr` command on your PATH
applyr          # or: node dist/cli.js (no `npm link` required)
```

**Screens** (number keys or `tab` / `shift+tab` to switch):

1. **Status** — outcome counts, pending review queue, last run.
2. **Jobs** — manual or automatic mode (see below).
3. **Review** — triage the review queue.
4. **History** — browse recorded outcomes.

**First launch.** Opening `applyr` shows a **welcome page**
explaining the screens, a typical first session, and the
essential keys — `enter` opens the highlighted option; `↑`/`↓` or
`j`/`k` move; `q` quits. `applyr review` / `applyr history` skip
the welcome page and jump straight to a tab. The banner and
every list resize with the terminal: the full ASCII art appears
on large windows and collapses to a one-line wordmark on narrow
or short ones.

**Modes.** The app always launches in **manual mode**. Press `m`
to toggle between manual and automatic; the active mode is
visible in the shell. The Jobs screen always opens **browsing,
never typing** — press `/` to type a search query, or `e` (in
automatic mode) to type the run cap, and `Esc` to stop typing.

- **Manual mode** (Jobs screen) — live configured Ashby / Lever
  / Workday search with a typed title query, browser open, the
  deterministic JD fit gate, and helper-backed save to review.
- **Automatic mode** (Jobs screen) — before a run can start you
  must enter how many applications this cycle may submit
  (1–25). The runner receives the count as `APPLYR_SESSION_CAP`
  and the run prompt carries the per-cycle cap. The cap can
  lower, never raise, the 25-per-session maximum. The cap is
  **tier-colored by cost** (1–5 light/green, 6–14
  standard/violet, 15–24 heavy/yellow) and choosing **25 shows
  an animated MAX warning** — a full-cap run eats through your
  token budget. An optional **extra prompt** (`p`) is passed to
  the agent with the run (`APPLYR_EXTRA_PROMPT`); leave it
  empty to run the standard workflow. It can focus a run
  ("only remote SWE roles") but never overrides `AGENTS.md` or
  the session cap.

**Essential controls** (press `?` inside the app for the full
key reference; each screen also displays contextual hints in
the hint bar):

- `?` — open / close the in-app keyboard reference
- `w` — reopen the welcome / quick-start page
- `q` — quit (asks for confirmation while a run is active);
  `Esc` only cancels typing — it never quits the app
- `R` — reload state from disk
- `m` — toggle manual / automatic mode
- `1`–`4`, `←`/`→`, or `tab` / `shift+tab` — switch screens
- Lists (Search / Review / History): `↑`/`↓` select · `enter`
  or `o` open the posting in your browser
- Manual Jobs: `/` edit query · `f` run fit gate · `s` save to
  review
- Automatic Jobs: `e` set cap (1–25) · `p` optional extra
  prompt · `s` start run

**Side panel** (visible on terminals ≥ 64 columns and ≥ 18 rows):
applied count, queue depth, mode badge, and **build marker**
(`build 0.5.5a`). The side panel hides on narrower / shorter
terminals and reappears when the terminal grows.

Detailed walkthrough, including the `applyr setup` /
`applyr review` / `applyr history` / `applyr run` subcommands,
lives in [`docs/SETUP.md`](./docs/SETUP.md) §3.2.

## Roadmap

applyr is a phased build-out. **Phases 0–8, 10, and 15 (core)
are implemented** and described under
[What ships today](#what-ships-today). **Phase 13 is partial**
— see [Terminal UI overlay](#terminal-ui-overlay-phase-13-partial).
**Phase 9 is planned, not yet implemented**.

| Phase | Status | Scope |
| --- | --- | --- |
| 0 — State and config hardening | Shipped (0.5.5a) | `.gitignore`, examples, cron entry point, config validator |
| 1 — Canonical registry + event model | Shipped (0.5.5a) | `job_state.py`, `data/job_registry.json`, `data/job_events.jsonl`, `can-apply` |
| 2 — Discord outcome routing | Shipped (0.5.5a) | per-outcome webhooks + best-effort summary |
| 3 — Google Sheets sync | Shipped (0.5.5a) | one append-only row per successful application |
| 4 — Deterministic JD fit gate | Shipped (0.5.5a) | `evaluate_job_fit.py`, pre-tailoring and pre-apply |
| 5 — SimplifyJobs ingestion | Shipped (0.5.5a) | `fetch_simplify_listings.py` + JD enrichment before the fit gate; docs cleanup |
| 6 — Vetted Ashby / Lever slug auto-seeding | Shipped (0.5.5a) | `seed_vetted_slugs.py` + `config/{ashby,lever}_vetted_slugs.json`, wired into the validator |
| 7 — Workday review-only support | Shipped (0.5.5a) | `fetch_workday_listings.py` (public CXS JSON) + fit gate; promising jobs routed to `needs_review`, no auto-apply |
| 8 — Scheduler upgrade | Shipped (0.5.5a) | `scheduler.sh` (launchd, 30-min 24/7), skip-on-overlap, heartbeat + health marker |
| 9 — Migration-friendliness review | Planned | document per-user vs. project-owned seams; stays single-user |
| 10 — Browser extension (hybrid mode) | Shipped (0.5.5a) | `extension/` (MV3 TypeScript) + `scripts/extension_bridge.py` — autofill from `safe_fields`, fit badge, helper-backed outcome recording; never auto-submits |
| 13 — TUI overlay (partial) | Partial (0.5.5a) | `app/` (Ink + React) — manual/automatic modes, review triage, status/history. `npm` publication, provider-setup, and hosted storage deferred. |
| 15 — Harness portability (partial) | Partial (0.5.5a) | OpenCode + Claude Code; `config/harness.json` and `$APPLYR_HARNESS` env var. Codex / GitHub Copilot support planned (phase 16). |
| 16 — Codex / GitHub Copilot | Planned | noted in `scripts/install.sh`; not yet implemented |
| Productization (hosted accounts, multi-agent) | Future | hosted accounts and further coding-agent support tracked in the planning document. **No implementation work authorized.** |

> Phase-by-phase acceptance criteria, current state, and what to
> avoid are tracked in [`docs/PLAN.md`](./docs/PLAN.md) (gitignored).
> **Read `docs/PLAN.md` first** if you are picking the project
> up. The public roadmap signal is the table above; the
> deep-dive release doc is [`docs/RELEASE.md`](./docs/RELEASE.md).

### Board support today

| Board | Method | Notes |
| --- | --- | --- |
| Ashby | Public JSON API | Direct `curl`, no auth. Skipped (with a warning) if the slug array is empty or still `REPLACE_ME`. |
| Lever | Public JSON API | Direct `curl`, no auth. Same skip-on-placeholder behavior. |
| SimplifyJobs | Public GitHub JSON feeds | `scripts/fetch_simplify_listings.py`, no auth. Skipped (with a warning) if `simplify_feeds` is empty or still `REPLACE_ME`. JD text is fetched from each listing's URL before the fit gate. |
| LinkedIn | Playwright MCP | Browser-based scraping. |
| Indeed | Playwright MCP | Browser-based scraping. |
| Handshake | Playwright MCP | Requires a student login. If Playwright can't authenticate, the board is skipped and a single `handshake_auth_needed` entry is appended to `data/review_queue.json`. |
| Greenhouse | Playwright MCP | Browser-based scraping. |
| Wellfound | Playwright MCP | Browser-based scraping. |

## Safety & operational notes

These are not suggestions — they are how the agent is wired.
They exist so a misconfigured run does not silently produce
noise, and a borderline job does not get auto-submitted.

- **`skipped_unfit` is local-only.** Recorded via
  `scripts/job_state.py record-event` so the registry and event
  log reflect the hard reject, but it is **never** routed to
  Discord, never written to `data/applied_jobs.json`, and never
  synced to the Google Sheet. There is no way to opt in to
  seeing `skipped_unfit` in user-facing surfaces.
- **`needs_review` is user-visible.** Appended to
  `data/applied_jobs.json` and `data/review_queue.json`,
  recorded as a `needs_review` event, and routed to the
  `needs_review` Discord webhook. This is how the agent
  surfaces ambiguous-fit jobs, ATS scores below threshold,
  missing form fields, and similar conditions that need a
  human decision before the next run.
- **Only `applied` syncs to the Google Sheet.** The Sheets
  helper is invoked exactly once per successful application,
  and only after the `applied_jobs.json` entry and the
  internal `applied` event have been recorded. If Sheets sync
  is disabled, unconfigured, or exits non-zero, the helper logs
  a single warning and the application run continues. **A
  successful application is never converted into a failure by a
  sync problem.**
- **Live configs are gitignored.** `config/targets.json`,
  `config/discord_config.json`,
  `config/google_sheets_config.json`,
  `config/service-account-key.json`, `config/harness.json`,
  and `config/extension_bridge.json` are intentionally not
  tracked. The `*.example.json` files in `config/` are the
  templates. Runtime state under `data/`, browser artifacts
  under `.playwright-mcp/`, and logs under `logs/` are also
  gitignored. `docs/PLAN.md` is gitignored by design.
- **PII discipline.** The agent fills form fields only from
  `config/targets.json "safe_fields"`. It never stores
  passwords, SSNs, or payment info. If a form requests a field
  that is not in `safe_fields`, the job is skipped, logged to
  `data/review_queue.json`, and recorded as `needs_review`.
- **Integrations are best-effort.** A missing or placeholder
  Ashby / Lever slug array, an unconfigured Discord webhook, or
  a disabled Google Sheets sync is a **warning, not a hard
  error**. The driver script validates required config
  (targets, Discord webhooks) at startup and refuses to run if
  any required piece is missing or malformed; everything else
  is logged and the affected board or integration is skipped.
- **The extension never submits a form.** Autofill stops at a
  filled form; the user reviews and clicks submit themselves.
  This is the defining safety property of hybrid mode and
  applies to every supported ATS family (Greenhouse, Lever,
  Ashby, Workday).
- **Workday is review-only by design.** No auto-apply path
  exists, and one is not planned.
