# Setup

The live configs (`config/targets.json`, `config/discord_config.json`) are
gitignored — they hold personal data and secrets. Start from the shipped
examples before running the agent.

> **Build:** this document ships with release `0.5.5a`. The
> full release notes are in [`RELEASE.md`](./RELEASE.md); the
> project changelog is in [`CHANGELOG.md`](./CHANGELOG.md).

## 0. Universal install (recommended)

One command from a fresh GitHub download handles sections 1 and 3,
detects your coding agent, and builds the optional TUI:

```bash
# From the unpacked release archive (no git clone required):
bash scripts/install.sh
```

**Downloading the release archive.** The project is named applyr; the
GitHub repository for this release is still `keshm2/ares`:

```bash
# zip
curl -L -o applyr-0.5.5a.zip https://github.com/keshm2/ares/archive/refs/tags/0.5.5a.zip
unzip applyr-0.5.5a.zip && cd ares-0.5.5a

# or tarball
curl -L -o applyr-0.5.5a.tar.gz https://github.com/keshm2/ares/archive/refs/tags/0.5.5a.tar.gz
tar -xzf applyr-0.5.5a.tar.gz && cd ares-0.5.5a
```

The release page also exposes the standard
"Source code (zip)" / "Source code (tar.gz)" assets directly — pick
whichever works behind your network.

applyr runs under your choice of coding agent. Supported today:
**opencode** and **Claude Code** (phase 15); **Codex** and **GitHub
Copilot** support is planned (phase 16), with other coding agents to
follow. The installer detects what you have installed — and when more
than one supported agent is found, it **asks which one you'd prefer**
— then writes the choice to `config/harness.json` (change it any time
by editing that file, re-running the installer, or per-run with
`APPLYR_HARNESS=opencode|claude`). Then fill in the placeholders
(section 2, or `applyr setup`) and start a run with
`bash scripts/run_job_agent.sh`.

Per-harness notes:

- **opencode** — agents load from `.opencode/agents/`; models come from
  `opencode.jsonc`.
- **Claude Code** — agents load from `.claude/agents/` (`model:
  inherit`, so runs use your session's model); Playwright MCP comes
  from `.mcp.json`. Headless runs need pre-approved permissions in
  `.claude/settings.json` — the installer offers to create it and asks
  first, because it grants Claude broad repo-local tool access.
- Agent definitions for both harnesses are generated from `agents/`
  (see `agents/README.md`) — edit sources there, never the generated
  files.

## 1. Copy the example configs

```bash
cp config/targets.example.json config/targets.json
cp config/discord_config.example.json config/discord_config.json
```

## 2. Replace the placeholders

In `config/targets.json`:

- `safe_fields` — replace every placeholder with your real values:
  - `YOUR_FIRST_NAME`, `YOUR_LAST_NAME`
  - `your.email@example.com`, `555-555-5555`
  - `https://linkedin.com/in/your-profile`, `https://github.com/your-username`
  - `graduation_date` (`Month Year`), `gpa` (`0.0`)
  - `authorized_to_work`, `require_sponsorship`, `citizenship_status` — each
    is `REPLACE_ME`; set to the real answer (e.g. `Yes`/`No` for the first
    two, your citizenship status for the third)
  - `currently_enrolled` — set to `Yes` or `No` as appropriate
- `ashby_company_slugs`, `lever_company_slugs` — replace `REPLACE_ME` with
  real company slugs, or leave as `REPLACE_ME` to have the validator
  auto-seed them from the project's vetted lists (see section 3.1). To
  skip a board entirely, you must remove the placeholder and keep the
  board out of your slug list after seeding (delete the seeded slugs).
- `workday_tenants` — replace `REPLACE_ME` with `"<host>/<site>"`
  strings for the Workday tenants you want watched (e.g.
  `"nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"` — find the
  host and site name in any posting URL on the company's careers
  site), or leave the placeholder to skip the board. Workday is
  **review-only**: promising postings land in the review queue and
  Discord for you to apply manually — the agent never submits a
  Workday application.
- `simplify_feeds` — replace `REPLACE_ME` with one or both of the known
  feed names `summer_internships` and `new_grad`, or leave as
  `REPLACE_ME` to skip the SimplifyJobs board. The feeds are the
  community-maintained SimplifyJobs listing files fetched read-only from
  GitHub (`SimplifyJobs/Summer2026-Internships` and
  `SimplifyJobs/New-Grad-Positions`) — no account or API key is needed.
- `preferred_locations`, `fallback_scope`, `graduation_date` — review and
  personalize.

In `config/discord_config.json`:

- `webhooks.success` — required. A real Discord webhook URL for the
  success channel (`https://discord.com/api/webhooks/<numeric_id>/<token>`).
  This route is also the fallback for the optional summary route.
- `webhooks.needs_review` — required. A real Discord webhook URL for the
  needs-review channel.
- `webhooks.failed` — required. A real Discord webhook URL for the failed
  channel.
- `webhooks.summary` — webhook URL for the batch-summary channel.
  Optional: if absent, the summary is routed to `webhooks.success` at
  runtime.
- A Discord webhook is bound to exactly one channel, so routing each
  outcome to its own channel requires a separate webhook URL per route.
  To keep all outcomes in a single channel during initial setup, point
  every route at the same webhook URL.

## 3. Validate

```bash
bash scripts/validate_local_config.sh
```

- Prints `validate_local_config: OK` on success — config is ready.
- Any `ERROR` line names the file and field to fix (exit code 1).
- Placeholder Ashby/Lever slugs are auto-seeded (section 3.1); other
  placeholder state (e.g. `simplify_feeds`) prints a `WARNING` but does
  not block the run.

### 3.1 Vetted slug auto-seeding (Phase 6)

When `ashby_company_slugs` or `lever_company_slugs` is **unset, empty,
or placeholder-only** (`["REPLACE_ME"]`), the validator seeds it from
the project-owned vetted lists so a fresh clone has real Ashby/Lever
coverage on the first run:

- `config/ashby_vetted_slugs.json`
- `config/lever_vetted_slugs.json`

Behavior:

- Seeding never overwrites a non-placeholder value — if even one entry
  in your array is a real slug, the array is treated as a deliberate
  choice and left untouched.
- Seeding is deterministic and idempotent: it writes the vetted list
  verbatim in one atomic JSON write of `config/targets.json`; a second
  run does nothing.
- Every seeded array prints a visible `WARNING` at run start
  (`auto-seeded from vetted list …`) so you are not surprised — review
  the change in `config/targets.json` and edit or revert if unwanted.
- The seeder can also be run directly:
  `python3 scripts/seed_vetted_slugs.py`

**Provenance.** The vetted lists are trust-bearing, project-owned
artifacts committed to the repo. Every slug was hand-verified against
the public board APIs (`api.ashbyhq.com/posting-api/job-board/{slug}`,
`api.lever.co/v0/postings/{slug}?mode=json` — HTTP 200 with a
non-empty postings array) on the `verified_at` date recorded in each
file. Additions are code changes: verify the endpoint by hand, update
`verified_at`, and review in a PR. Nothing is ever pulled from a
remote source at run time.

### 3.2 TUI overlay (Phase 13, optional)

A terminal UI over the same configs and helpers, in `app/`. It never
writes state JSON directly — every mutation goes through the repo's
helpers.

```bash
cd app
npm install
npm run build
node dist/cli.js help      # or: npm link && applyr help
```

Commands:

- `applyr setup` — interactive wizard that writes `config/targets.json`
  and `config/discord_config.json` (the same files sections 1–2
  create by hand), then runs the validator. `applyr setup --check`
  validates only.
- `applyr status` — outcome counts, pending review queue, last run.
- `applyr review` — triage the review queue: open the posting, mark
  applied, or dismiss (recorded via the state helpers).
- `applyr history` — browse recorded outcomes.
- `applyr run` — trigger `scripts/run_job_agent.sh` and stream the
  session log.

The app opens on a **welcome menu** that lets you choose where to go
first; press `w` any time to come back to it. Inside the app, press
`?` at any time for the complete keyboard reference. The Jobs
screen always opens **browsing, never typing**: press `/` to type a
search query (or `e` in automatic mode to type the run cap), and
`Esc` to stop typing — `Esc` never quits the app; quit with `q`
(asks for confirmation while a run is active). The banner and all
lists resize with the terminal.

**Modes.** The app always launches in **manual mode**. Press `m` to
toggle between manual and automatic; the active mode is always visible
in the shell.

- **Manual mode (default on launch)** — human-driven job search: a
  Search screen fetches live postings from the configured boards, lets
  you filter by a typed query, open a posting in the browser, run the
  fit gate on a selected posting, and save it to the review queue.
  The only state writes are the save action (needs_review records
  through the helpers).
- **Automatic mode** — agent-driven cycle: before a run can start you
  must enter how many applications this cycle may submit (1–25). The
  runner receives the count as `APPLYR_SESSION_CAP` and the run prompt
  carries the per-cycle cap. The cap can lower, never raise, the
  25-per-session maximum; `run_job_agent.sh` clamps any value above
  25 down to 25 and falls back to 25 on invalid or below-1 input.
  The cap is tier-colored by cost (light / standard / heavy) and 25
  shows an animated **MAX** warning — a full-cap run eats through
  your token budget. Press `p` to add an optional extra prompt for
  the agent (sent as `APPLYR_EXTRA_PROMPT`, 500-char cap); empty
  means the standard workflow. It can focus a run but never overrides
  `AGENTS.md`, the state-write discipline, or the session cap.

**Small test cycle (recommended first run):** open `applyr`, press
any key, then `2` (Jobs) → `m` (AUTO) → `e` → type `5` → `enter` →
optionally `p` for an instruction → `s`. The run streams its session
log into the screen; outcomes land in Status / Review / History and
Discord as usual.

npm publication (`npx`-based first run) is deferred until the package
name and scope are settled — for now install from the repo as above.

## 3.5 Always-on schedule (Phase 8, optional)

Run the agent every 30 minutes, 24/7, via a launchd user agent
(macOS). Overlap protection lives in `run_job_agent.sh` itself: a tick
that lands while a run is in flight logs `skipped_overlap` and exits 0
(no second agent), a dead holder's lock is reclaimed immediately, and
a hung run older than 60 minutes (`APPLYR_LOCK_MAX_AGE_MIN`) is
terminated and reclaimed so a wedged run never blocks the schedule.

```bash
bash scripts/scheduler.sh install     # write + load the plist (a run starts immediately)
bash scripts/scheduler.sh status      # loaded? + current heartbeat
bash scripts/scheduler.sh uninstall   # stop the schedule
bash scripts/scheduler.sh plist       # print the plist without installing
```

On Linux, create the equivalent systemd user timer by hand
(`OnUnitActiveSec=30min`, `WorkingDirectory=` the repo root, command
`/bin/bash scripts/run_job_agent.sh`).

**What to check first when something looks wrong:**

1. `logs/heartbeat.json` — last run's timestamp, exit code, per-run
   outcome counts, and `consecutive_nonzero_exits` (a growing streak
   means a restart loop; the schedule keeps ticking either way).
2. `logs/run_job_agent.log` — one line per tick: the machine-parseable
   `run_job_agent: complete <ISO> applied=<n> needs_review=<n>
   failed=<n> skipped_unfit=<n>` health marker, plus
   `skipped_overlap` / `stale_lock_reclaimed` / `FAILED` entries.
3. `logs/session_<timestamp>.log` — the full transcript of a specific
   run (start line, harness, transcript, end marker). Only the newest
   30 are kept (`APPLYR_KEEP_SESSION_LOGS`).

The 25-applications-per-session cap is unchanged — the cadence changes
how often runs happen, never how much one run may apply.

## 3.6 Browser extension — hybrid mode (Phase 10, optional)

A Chrome (Manifest V3) extension for user-driven applications: you
browse postings yourself; the extension autofills forms from your
`safe_fields`, shows the deterministic fit verdict as a badge, and
records outcomes into the same local state as the agent — so manual
and automatic applications dedupe against each other.

**Safety model (how it is wired, not a suggestion):**

- The extension **never submits a form**. Autofill stops at a filled
  form; you review and click submit yourself.
- Values come **only** from `config/targets.json "safe_fields"`.
  Fields the profile cannot answer are highlighted amber — never
  invented.
- All reads/writes go through a **localhost-only bridge**
  (`scripts/extension_bridge.py`) authenticated by a per-install token;
  the bridge only shells out to the repo's standard state helpers.

**1. Start the bridge** (from the repo root):

```bash
python3 scripts/extension_bridge.py
```

The first start generates `config/extension_bridge.json` (gitignored,
`chmod 600`) with the per-install token and default port `8377`.
Print the token any time with
`python3 scripts/extension_bridge.py --show-token`. Leave the bridge
running while you use the extension.

**2. Build and load the extension:**

```bash
cd extension
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `extension/dist/`. (Web-store distribution
is deliberately deferred.)

**3. Connect it:** open the extension's **Options** page, paste the
bridge token, and click **Test connection**.

**4. Use it:** on a posting hosted by Greenhouse, Lever, Ashby, or
Workday, a small **applyr** panel appears (bottom-right):

- **Fit check** — extracts the posting and shows the phase 4 verdict
  (`candidate` / `needs_review` / `skipped_unfit` + score), plus a
  warning if you already applied to this job.
- **Autofill from profile** — fills mapped, empty fields (green
  outline) and highlights required fields it can't answer (amber).
  It never overwrites anything you typed.
- **Save for review** — records a `needs_review` entry (applied log +
  review queue + event), same as saving from the TUI search.
- **I submitted this — record it** — after you actually submit,
  records an `applied` outcome (dedup-guarded) and best-effort syncs
  the Google Sheet tracker.

If the panel reports "bridge unreachable", start the bridge (step 1).

## 4. Google Sheets sync (Phase 3, optional)

The agent can append every successful application to a Google Sheet
internship tracker. This is optional: if it is not configured, the agent
skips the sync and local job state (`data/applied_jobs.json`,
`data/job_registry.json`) remains the source of truth.

### 4.1 Copy the example config

```bash
cp config/google_sheets_config.example.json config/google_sheets_config.json
```

`config/google_sheets_config.json` is gitignored — it holds the sheet id
and the path to the service-account key. Edit it:

- `spreadsheet_id` — the long id from your sheet URL
  (`https://docs.google.com/spreadsheets/d/<spreadsheet_id>/edit`).
- `worksheet_title` — the tab name to append to (default
  `Internship Tracker`).
- `service_account_key_path` — local path to the service-account JSON
  key (default `config/service-account-key.json`).
- `enabled` — set to `false` to turn sync off without deleting the file.
- `header_range`, `value_input_option`, `insert_data_option` — optional
  append parameters with sensible defaults (`A1:H`, `USER_ENTERED`,
  `INSERT_ROWS`). Leave them as-is unless the sheet needs different
  settings.

### 4.2 Install the Python dependencies

```bash
pip3 install -r requirements.txt
```

This installs the official Google Python client and auth libraries needed
for service-account Sheets writes.

### 4.3 Create the service account and download the key

1. Open the Google Cloud Console → **APIs & Services → Library** and
   enable the **Google Sheets API** for your project.
2. Go to **APIs & Services → Credentials → Create credentials →
   Service account**. Give it any name (e.g. `applyr-tracker-sync`).
3. Open the new service account → **Keys → Add key → Create new key →
   JSON**. A JSON key file downloads.
4. Move the downloaded key to the repo:

   ```bash
   mv ~/Downloads/<downloaded-key>.json config/service-account-key.json
   chmod 600 config/service-account-key.json
   ```

   `config/service-account-key.json` is gitignored.

### 4.4 Share the Google Sheet with the service account

Open the service-account key JSON and copy the `client_email` value
(e.g. `applyr-tracker-sync@your-project.iam.gserviceaccount.com`). Open
your Google Sheet → **Share** → paste that email → give it **Editor**
access. The helper cannot write until the sheet is shared with this
email.

### 4.5 Validate

```bash
bash scripts/validate_local_config.sh
```

The Sheets config is validated in a Phase 3-appropriate way:

- If `config/google_sheets_config.json` is absent, the validator warns
  and continues — job-board runs are not blocked.
- If present and `enabled: true`, required fields and the
  service-account key path shape are checked. Missing key file or
  placeholder values produce `WARNING` lines but do not break the run.

### 4.6 Test a single append manually

```bash
python3 scripts/sync_internship_tracker.py '{"title":"Test Role","company":"Test Co","date_applied":"2026-07-01","internship_term":"Summer 2026"}'
```

A successful sync prints a JSON result with `"synced": true` and the
appended row. If sync is disabled or unconfigured, the helper prints a
`"skipped": true` result and exits 0 so the application run continues.
