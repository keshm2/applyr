# Ares

> An automated, single-user job-application agent for internship and
> new-grad roles. Scrapes public boards, deduplicates against local
> history, tailors a resume and cover letter, applies on your behalf,
> routes per-outcome updates to Discord, and appends one row per
> success to a Google Sheet tracker.

Ares is built on [OpenCode](https://opencode.ai/). The agent
**orchestrates**; deterministic helper scripts **own the state**. That
split keeps every state-mutating step auditable and means the agent
itself never hand-writes runtime state. Each run is capped at **25
applications** to stay polite to upstream boards and rate limits.

> **Status** — Phases 0–8 are implemented and described under
> [What ships today](#what-ships-today). The Phase 13 TUI overlay is
> **partial**: the manual/automatic-mode app works from the local
> repo (see [Terminal UI overlay](#terminal-ui-overlay-phase-13-partial)),
> while `npm` publication, provider-setup, and hosted storage are
> deferred. Phase 9 is planned; the browser extension and hosted
> accounts are still future work tracked in the planning document.

## At a glance

| | |
| --- | --- |
| **Mode** | Single user, local-first, cron-friendly |
| **Boards (today)** | Ashby, Lever (public JSON APIs); SimplifyJobs (public GitHub JSON feeds); Workday (public CXS JSON, review-only); LinkedIn, Indeed, Handshake, Greenhouse, Wellfound (Playwright) |
| **Runtime** | OpenCode orchestrator + stdlib-only Python helpers |
| **Notifications** | Discord webhooks routed by outcome (`success` / `needs_review` / `failed` / `summary`) |
| **Tracker** | Google Sheet — one append-only row per successful application |
| **State** | Local JSON + JSONL under `data/` (gitignored) |
| **Caps** | 25 applications per session |

## How a run works

For each run, Ares:

1. **Scrapes** postings from supported boards.
2. **Canonicalizes** every raw posting into one internal record.
3. **Deduplicates** against the local registry and the application log.
4. **Fit-gates** each canonical job with a deterministic helper
   (role/level keywords, years of experience, location).
5. **Tailors** a resume and cover letter for jobs that pass the gate.
6. **Submits** applications through a Playwright-controlled browser.
   The public Ashby and Lever JSON APIs are used for job discovery,
   not application submission.
7. **Records** the outcome locally, fires the right Discord webhook,
   and (for successful applications only) appends one row to the
   Google Sheet tracker.

> **Design principle** — the agent orchestrates, scripts do the work.
> Every state-mutating step — canonicalization, dedup, fit gate,
> applied log, registry, event log, Sheets sync — goes through a
> dedicated helper. That keeps the rules auditable, the agent's job
> small, and the state recoverable.

## What ships today

Phases 0–8 of the project roadmap are implemented. Phase 13 is
partial — the TUI overlay works from the local repo while `npm`
publication, provider-setup, and hosted storage remain deferred
(detailed below).

- **State and config hardening (phase 0).** `.gitignore` excludes all
  live configs, runtime state, PII, browser artifacts, logs, and Python
  bytecode. `*.example.json` files are the safe templates.
  `scripts/run_job_agent.sh` is a cron-friendly entry point with
  portable lock handling and startup config validation.
- **Canonical job registry and event model (phase 1).** Every scraped
  job is canonicalized and merged into `data/job_registry.json` via
  `scripts/job_state.py`. An append-only `data/job_events.jsonl` audit
  log records every outcome. A pre-apply `can-apply` recheck prevents
  re-applying to the same job.
- **Discord outcome routing (phase 2).** Notifications route by
  outcome — `success`, `needs_review`, `failed`, and an end-of-batch
  `summary` (with `success` as the fallback). The reporter is
  best-effort: a missing or placeholder webhook is logged and skipped,
  never blocks the run.
- **Google Sheets sync for successful applications (phase 3).**
  Exactly one row is appended to a user-facing Google Sheet per
  successful application. `needs_review`, `failed`, and
  `skipped_unfit` outcomes are never written to the sheet.
- **Deterministic JD fit gate (phase 4).** A stdlib-only Python
  helper (`scripts/evaluate_job_fit.py`) classifies each canonical
  job as `candidate`, `needs_review`, or `skipped_unfit` before
  tailoring, and again immediately before applying.
- **SimplifyJobs ingestion (phase 5).** A stdlib-only fetch helper
  (`scripts/fetch_simplify_listings.py`) pulls the community-maintained
  SimplifyJobs internship and new-grad listing feeds from GitHub
  (read-only, no auth), filters to active + visible postings, and
  emits canonicalize-ready records. The feeds carry no JD text, so the
  orchestrator fetches each surviving candidate's JD from its listing
  URL before the fit gate runs. A missing or placeholder
  `simplify_feeds` config skips the board with a warning.
- **Workday review-only ingestion (phase 7).** A stdlib-only helper
  (`scripts/fetch_workday_listings.py`) pulls postings from configured
  Workday tenants via their public CXS JSON endpoints (list + per-job
  JD fetch). Promising jobs are routed to the review queue and the
  needs-review Discord webhook for manual application — **no
  auto-apply path exists for Workday**, and review items don't count
  against the session cap.
- **Always-on scheduler (phase 8).** `scripts/scheduler.sh` installs a
  launchd user agent running the pipeline every 30 minutes, 24/7. A
  tick that lands mid-run logs `skipped_overlap` and exits cleanly (no
  second agent); dead locks are reclaimed immediately and hung runs
  past 60 minutes are terminated and reclaimed. Every run emits a
  machine-parseable health marker and updates `logs/heartbeat.json`
  (outcome counts, run counter, consecutive-failure streak — also
  surfaced on the TUI status screen). Session logs are pruned to the
  newest 30.
- **Vetted Ashby/Lever slug auto-seeding (phase 6).** When
  `ashby_company_slugs` / `lever_company_slugs` are unset, empty, or
  placeholder-only, `scripts/seed_vetted_slugs.py` (run by the config
  validator) seeds them from the project-owned, hand-verified vetted
  lists in `config/ashby_vetted_slugs.json` and
  `config/lever_vetted_slugs.json`, so a fresh clone has real board
  coverage on the first run. A non-placeholder value is never
  overwritten, and every seeded array prints a visible warning.
- **Terminal UI overlay (phase 13, partial).** A TypeScript TUI in
  `app/` (Ink + React) provides a full-screen shell for browsing
  state, triaging the review queue, manual job search, and
  triggering runs. The Python/bash helpers remain the sole
  authoritative state writers — the TUI never edits state JSON
  directly. `npm` publication, provider-setup, and hosted storage
  are deferred — install from the local repo. Full details:
  [Terminal UI overlay](#terminal-ui-overlay-phase-13-partial).

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
- **`needs_review`** — recorded, written to `data/applied_jobs.json`
  and `data/review_queue.json`, Discord `needs_review` route. Never
  tailored; never written to the sheet.
- **`failed`** — recorded, written to `data/applied_jobs.json`,
  Discord `failed` route. Never written to the sheet.
- **`skipped_unfit`** — recorded only as a local event. Never routed
  to Discord, never written to `data/applied_jobs.json`, never synced
  to the sheet.

## Repo layout

Key files and entry points:

**Behavior and planning**

- `AGENTS.md` — canonical behavioral rules for the agent (fetch
  methods, role/level filtering, fit gate, registry, file write
  discipline, Sheets sync). Any agent that mutates state follows this
  file.
- `docs/PLAN.md` — durable, in-repo planning and handoff document.
  Gitignored. **Read this first** if you are picking the project up.
- `docs/SETUP.md` — copy → edit → validate walkthrough for the local
  configs, plus the optional Google Sheets sync section.
- `opencode.jsonc` — OpenCode configuration. The default agent is
  `job-scraper`; loads `AGENTS.md`, `config/targets.json`, and
  `data/applied_jobs.json` as instructions; enables the Playwright MCP
  server.

**OpenCode agents** (`.opencode/agents/`)

- `job-scraper.md` — the orchestrator. Scrapes, canonicalizes, runs
  the fit gate, calls `@resume-tailor`, runs the apply loop, fires
  per-outcome Discord notifications, and fires the batch summary.
- `resume-tailor.md` — subagent. Selects one of five base resumes by
  job category (swe, ai_ml, balanced, cyber, networking_cyber),
  rewrites bullets, writes a cover letter, returns an `ats_score`.
- `discord-reporter.md` — subagent. Reads the per-outcome webhook
  routes, JSON-escapes every payload, POSTs with
  `allowed_mentions: parse=[]`. Skips `skipped_unfit`.

**Helper scripts** (`scripts/`)

- `run_job_agent.sh` — cron-friendly driver. Validates config,
  bootstraps state files, then runs the orchestrator.
- `validate_local_config.sh` — startup validator. Fails on missing or
  invalid required config; warns (does not fail) on placeholder
  Ashby/Lever slugs, placeholder SimplifyJobs feeds, and on an
  unconfigured or disabled Sheets sync.
- `append_state_entry.sh` — atomic JSON-array appender with a `job_id`
  dedup guard. Used for `data/applied_jobs.json` and
  `data/review_queue.json`.
- `job_state.py` — phase 1 canonical helper. Subcommands:
  `ensure-files`, `canonicalize`, `upsert-job`, `can-apply`,
  `record-event`. Stdlib-only.
- `evaluate_job_fit.py` — phase 4 deterministic fit gate. Stdlib-only.
  Returns `candidate` / `needs_review` / `skipped_unfit` with
  `fit_score`, `fit_reasons`, and `decision_version`.
- `fetch_simplify_listings.py` — phase 5 SimplifyJobs fetcher.
  Stdlib-only. Reads `simplify_feeds` from `config/targets.json`,
  fetches the public GitHub listing feeds, and emits one
  canonicalize-ready raw-job JSON object per line. Skips cleanly
  (exit 0, warning only) when the feeds are unconfigured.
- `sync_internship_tracker.py` — phase 3 Sheets helper. Maps a payload
  to the visible columns and appends one row. Skips cleanly when sync
  is disabled or unconfigured; never turns a successful application
  into a failure.

**TUI overlay** (`app/`, phase 13 partial)

- `cli.js` (built from `src/cli.tsx`) — entry point. Subcommands:
  `setup [--check]`, `status`, `review`, `history`, `run`. Set
  `ARES_ROOT` to run outside the repo.
- `src/ui/App.tsx` — persistent shell: tab row, content region,
  hint bar. Tabs are Status, Jobs, Review, History. The Jobs tab
  switches between manual and automatic mode (`m` toggles).
- `src/ui/SearchScreen.tsx` — manual Jobs mode. Live configured
  Ashby / Lever / Workday search, typed query, browser open,
  deterministic fit check, helper-backed save to review.
- `src/ui/RunScreen.tsx` — automatic Jobs mode. Per-cycle
  application cap (1–25) → `ARES_SESSION_CAP` → spawns
  `scripts/run_job_agent.sh` and tails the session log.

State-write discipline is the same as the rest of the project — the
TUI never edits state JSON directly. See
[Terminal UI overlay](#terminal-ui-overlay-phase-13-partial) for the
user-facing walkthrough.

**Config templates** (`config/`)

- `targets.example.json` — role/level/season keywords, preferred
  locations, fallback scope, Ashby/Lever slug arrays, and the
  `safe_fields` map the agent uses to fill form fields.
- `discord_config.example.json` —
  `webhooks.{success, needs_review, failed, summary}` template.
- `google_sheets_config.example.json` — Sheets sync template with
  `enabled`, `spreadsheet_id`, `worksheet_title`, and
  `service_account_key_path`.

> The live versions of these configs (`config/targets.json`,
> `config/discord_config.json`, `config/google_sheets_config.json`,
> `config/service-account-key.json`) are gitignored. Start from the
> shipped examples — see `docs/SETUP.md`.

**Runtime state** (`data/`, all gitignored)

- `applied_jobs.json` — one entry per `applied` / `failed` /
  `needs_review` outcome. Required fields are documented in
  `AGENTS.md`. `skipped_unfit` is never written here.
- `review_queue.json` — items that need a human to look at (form
  fields we couldn't fill, ambiguous-fit jobs, etc.).
- `job_registry.json` — array of canonical records, one per ever-seen
  job. Merged by `job_key` via `job_state.py upsert-job`. Multiple
  `sources[]` per record are preserved.
- `job_events.jsonl` — append-only JSONL event log. One line per
  `record-event` call. The registry is the structured view; the JSONL
  is the audit trail.
- `resumes/` — five base resumes (`base_resume_swe`,
  `base_resume_ai_ml`, `base_resume_balanced`, `base_resume_cyber`,
  `base_resume_networking_cyber`) plus `base_cover_letter`, each as
  `.md` + `.pdf`. The `@resume-tailor` subagent selects among them by
  job category; `balanced` is the default.

## Quick start

See [`docs/SETUP.md`](./docs/SETUP.md) for the full copy → edit → validate
walkthrough. The short version:

```bash
cp config/targets.example.json          config/targets.json
cp config/discord_config.example.json   config/discord_config.json
# Edit placeholders in both. Ashby/Lever slug arrays may be left as
# ["REPLACE_ME"] — those boards are skipped for the run with a warning.
bash scripts/validate_local_config.sh   # prints "validate_local_config: OK"
bash scripts/run_job_agent.sh           # cron entry point
```

The Google Sheets sync is **optional**. To enable it: copy
`config/google_sheets_config.example.json`, fill in the sheet id,
install the dependencies (`pip3 install -r requirements.txt`), drop a
service-account JSON key at `config/service-account-key.json`, share
the sheet with the service-account email, and validate again. Full
steps are in `docs/SETUP.md` §4.

## Terminal UI overlay (Phase 13, partial)

The TypeScript TUI in `app/` runs over the same configs and
Python/bash helpers that drive the cron entry point. The Python
helpers and `scripts/append_state_entry.sh` remain the sole
authoritative state writers — the TUI shells out to them for every
mutation and never edits state JSON directly. The review-queue file
stays append-only: the TUI's triage records outcomes (`applied_jobs`
append + `record-event`) and derives "resolved" from them.

> This is **working but still an alpha** with kinks being refined.
> `npm` publication, provider-setup, and hosted storage are
> deferred — install from the local repo (see below). Workday is
> review-only and requires configured tenants in
> `config/targets.json` to surface postings; without tenants, the
> board reports as off.

**Prerequisite:** Node.js 18+ (matches `app/package.json` engines).

**Install and run from the repo:**

```bash
cd app
npm install
npm run build
npm link        # exposes the `ares` command on your PATH
ares            # or: node dist/cli.js (no `npm link` required)
```

**Screens** (number keys or `tab` / `shift+tab` to switch):

1. **Status** — outcome counts, pending review queue, last run.
2. **Jobs** — manual or automatic mode (see below).
3. **Review** — triage the review queue.
4. **History** — browse recorded outcomes.

**Modes.** The app always launches in **manual mode**. Press `m` to
toggle between manual and automatic; the active mode is visible in
the shell.

- **Manual mode** (Jobs screen) — live configured Ashby / Lever /
  Workday search with a typed title query, browser open, the
  deterministic JD fit gate, and helper-backed save to review.
- **Automatic mode** (Jobs screen) — before a run can start you must
  enter how many applications this cycle may submit (1–25). The
  runner receives the count as `ARES_SESSION_CAP` and the run prompt
  carries the per-cycle cap. The cap can lower, never raise, the
  25-per-session maximum.

**Essential controls** (each screen also displays contextual hints
in the hint bar):

- `q` — quit; `Esc` releases an active query/count field, then quits
  when the shell owns keyboard focus
- `R` — refresh state from disk
- `m` — toggle manual / automatic mode
- `1`–`4` or `tab` / `shift+tab` — switch screens
- Manual Jobs: `/` edit query · `o` open posting · `f` run fit
  gate · `s` save to review
- Automatic Jobs: `enter` set cap · `esc` release · `e` edit cap ·
  `s` start run

Detailed walkthrough, including the `ares setup` / `ares review` /
`ares history` / `ares run` subcommands, lives in
[`docs/SETUP.md`](./docs/SETUP.md) §3.2.

## Roadmap

Ares is a phased build-out. **Phases 0–8 are implemented** and
described under [What ships today](#what-ships-today). **Phase 13 is
partial** — see [Terminal UI overlay](#terminal-ui-overlay-phase-13-partial).
**Phase 9 is planned, not yet implemented**.

| Phase | Status | Scope |
| --- | --- | --- |
| 0 — State and config hardening | Shipped | `.gitignore`, examples, cron entry point, config validator |
| 1 — Canonical registry + event model | Shipped | `job_state.py`, `data/job_registry.json`, `data/job_events.jsonl`, `can-apply` |
| 2 — Discord outcome routing | Shipped | per-outcome webhooks + best-effort summary |
| 3 — Google Sheets sync | Shipped | one append-only row per successful application |
| 4 — Deterministic JD fit gate | Shipped | `evaluate_job_fit.py`, pre-tailoring and pre-apply |
| 5 — SimplifyJobs ingestion | Shipped | `fetch_simplify_listings.py` + JD enrichment before the fit gate; docs cleanup |
| 6 — Vetted Ashby/Lever slug auto-seeding | Shipped | `seed_vetted_slugs.py` + `config/{ashby,lever}_vetted_slugs.json`, wired into the validator |
| 7 — Workday review-only support | Shipped | `fetch_workday_listings.py` (public CXS JSON) + fit gate; promising jobs routed to `needs_review`, no auto-apply |
| 8 — Scheduler upgrade | Shipped | `scheduler.sh` (launchd, 30-min 24/7), skip-on-overlap, heartbeat + health marker |
| 9 — Migration-friendliness review | Planned | document per-user vs. project-owned seams; stays single-user |
| 13 — TUI overlay (partial) | Partial | `app/` (Ink + React) — manual/automatic modes, review triage, status/history. `npm` publication, provider-setup, and hosted storage deferred. |
| Productization (extension, hosted accounts) | Future | browser extension and hosted accounts tracked in the planning document. **No implementation work authorized.** |

> Phase-by-phase acceptance criteria, current state, and what to avoid
> are tracked in [`docs/PLAN.md`](./docs/PLAN.md). **Read
> `docs/PLAN.md` first** if you are picking the project up.

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

These are not suggestions — they are how the agent is wired. They
exist so a misconfigured run does not silently produce noise, and a
borderline job does not get auto-submitted.

- **`skipped_unfit` is local-only.** Recorded via
  `scripts/job_state.py record-event` so the registry and event log
  reflect the hard reject, but it is **never** routed to Discord,
  never written to `data/applied_jobs.json`, and never synced to the
  Google Sheet. There is no way to opt in to seeing `skipped_unfit`
  in user-facing surfaces.
- **`needs_review` is user-visible.** Appended to
  `data/applied_jobs.json` and `data/review_queue.json`, recorded as
  a `needs_review` event, and routed to the `needs_review` Discord
  webhook. This is how the agent surfaces ambiguous-fit jobs, ATS
  scores below threshold, missing form fields, and similar
  conditions that need a human decision before the next run.
- **Only `applied` syncs to the Google Sheet.** The Sheets helper is
  invoked exactly once per successful application, and only after the
  `applied_jobs.json` entry and the internal `applied` event have
  been recorded. If Sheets sync is disabled, unconfigured, or exits
  non-zero, the helper logs a single warning and the application run
  continues. **A successful application is never converted into a
  failure by a sync problem.**
- **Live configs are gitignored.** `config/targets.json`,
  `config/discord_config.json`, `config/google_sheets_config.json`,
  and `config/service-account-key.json` are intentionally not
  tracked. The `*.example.json` files in `config/` are the templates.
  Runtime state under `data/`, browser artifacts under
  `.playwright-mcp/`, and logs under `logs/` are also gitignored.
  `docs/PLAN.md` is gitignored by design.
- **PII discipline.** The agent fills form fields only from
  `config/targets.json "safe_fields"`. It never stores passwords,
  SSNs, or payment info. If a form requests a field that is not in
  `safe_fields`, the job is skipped, logged to
  `data/review_queue.json`, and recorded as `needs_review`.
- **Integrations are best-effort.** A missing or placeholder
  Ashby/Lever slug array, an unconfigured Discord webhook, or a
  disabled Google Sheets sync is a **warning, not a hard error**. The
  driver script validates required config (targets, Discord
  webhooks) at startup and refuses to run if any required piece is
  missing or malformed; everything else is logged and the affected
  board or integration is skipped.
