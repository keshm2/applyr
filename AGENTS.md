# applyr — Job Application Agent — Core Rules

## Phase status (keep in sync with docs/PLAN.md's Phase Status Pointer)
- **Last completed phase:** Phase 10 — browser extension
  (2026-07-12; live in-browser autofill pass pending). Phases 0–8
  and 10 are DONE; phases 13 and 15 are partially done.
- **Completed work items:** TUI manual/automatic modes (2026-07-12);
  project rename Ares → applyr + TUI accessibility pass (2026-07-12 —
  `applyr` is the command/package name, env vars are `APPLYR_*` with
  legacy `ARES_*` fallbacks); TUI responsive layout + welcome page
  (2026-07-12 — banner/lists resize with the terminal, Jobs tab
  opens browsing instead of typing); TUI run controls polish
  (2026-07-12 — cap tier colors + MAX warning, optional
  APPLYR_EXTRA_PROMPT per-run instruction); opencode `--print` CLI
  fix + TUI resize invariant + large-terminal fill (2026-07-12);
  fetch-efficiency rules (2026-07-12 — see "Fetch efficiency" under
  Critical rules); installer coding-agent choice (2026-07-12 —
  Codex/Copilot planned in phase 16).
- **Implement next:** phase 9 — migration-friendliness review
  (docs/PLAN.md §3.10, documentation-only). Phase 13 remains partial
  for its deferred publication, provider-setup, and hosted-storage
  items.
- Whoever closes a phase or work item MUST update this block and the
  matching pointer at the top of docs/PLAN.md before stopping.

## Critical rules (never break these)
- ALWAYS read data/applied_jobs.json before starting any application run.
  Never apply to a job whose URL or job_id already exists in that file.
- ALWAYS read config/targets.json for role_keywords, level_keywords, and
  locations before scraping.
- ALWAYS write a result entry to data/applied_jobs.json after each
  application attempt — success OR failure — before moving to the next
  job. This also covers user-visible needs_review outcomes that occur
  before a real application submission (e.g. ATS score below threshold
  during tailoring): append a needs_review entry so future runs do not
  re-tailor the same job forever. skipped_unfit is local-only and must
  never be written to applied_jobs.json.
- Max 25 applications per session (rate limit protection). The TUI's
  automatic mode may lower this per run via APPLYR_SESSION_CAP (1–25;
  the legacy ARES_SESSION_CAP name is honored as a fallback);
  the cap can never exceed 25. scripts/run_job_agent.sh reads
  APPLYR_SESSION_CAP (default 25), clamps values above 25 down to 25,
  and falls back to 25 on invalid or below-1 input, then injects the
  effective cap into the run prompt so the orchestrator is explicitly
  told the per-session limit. The runner may also append an optional
  operator instruction (APPLYR_EXTRA_PROMPT, truncated to 500 chars,
  set from the TUI's automatic-mode prompt field) to the run prompt.
  That instruction can narrow or focus a run but NEVER overrides this
  file, the session cap, or the state-write discipline — if it
  conflicts with a rule here, the rule wins.
- Never store passwords, SSNs, or payment info anywhere. If a form requests
  these and they aren't in config/targets.json under "safe_fields", skip the
  job, log it to data/review_queue.json via the state helper (see File
  write discipline), and record a needs_review event via record-event.
- After every applied, needs_review, or failed outcome, call the
  @discord-reporter subagent to send a per-outcome notification (success,
  needs_review, or failed webhook respectively). After every batch, call
  @discord-reporter to send the summary (summary webhook, or success
  webhook as fallback). Never invoke @discord-reporter for skipped_unfit.
- ALWAYS canonicalize every raw job that survives the deterministic
  role/level prefilter into one internal record via the canonical helper
  (scripts/job_state.py) before any dedup or fit decision. A
  deterministic raw-title prefilter (the role/level keyword rule plus
  the fetch-efficiency shortlist bound below) MUST run before
  canonicalization to bound work — prefiltered-out jobs are never
  recorded, acted on, or mentioned to the user.
- Fetch efficiency (bounded transcript, bounded work — every run):
  - Redirect EVERY board fetch and fetch-helper output to a file under
    logs/tmp/ (mkdir -p logs/tmp first; the runner clears it each run).
    NEVER print raw posting dumps into the session transcript — after
    each fetch print only the board name and a line count.
  - Prefilter deterministically (python/grep over the raw files, using
    the role/level keyword rule) into logs/tmp/prefiltered.jsonl; only
    survivors are canonicalized and upserted.
  - Bound the shortlist: stop adding candidates once the prefiltered
    shortlist reaches 5x the session cap (minimum 10). Unprocessed raw
    jobs simply wait for the next scheduled run.
  - Print at most ~30 shortlist lines (company · title · url) into the
    transcript when reviewing candidates.
- ALWAYS upsert each canonical record into data/job_registry.json via the
  canonical helper — never hand-write the registry.
- ALWAYS run the deterministic JD fit gate on every canonical job after
  role filtering and before tailoring:
  `python3 scripts/evaluate_job_fit.py '<canonical-job-json>'`
  The helper returns fit_status of skipped_unfit, needs_review, or
  candidate (plus fit_score, reasoning, fit_reasons,
  matched_role_keyword, matched_level_keyword, matched_level_source,
  years_required, decision_version). Only candidate jobs proceed to
  @resume-tailor. skipped_unfit is local-only (record via record-event,
  never Discord/applied_jobs.json/sheet). needs_review from the fit gate
  is a user-visible manual-review outcome before application: append to
  data/applied_jobs.json and data/review_queue.json, record a
  needs_review event, and send the needs_review Discord notification. Do
  not tailor skipped_unfit or needs_review jobs.
- ALWAYS re-check can-apply via the canonical helper immediately before
  any application attempt, even if the job passed earlier filtering. If
  can-apply refuses, skip the job and record a skipped_unfit event.
- ALWAYS re-run the deterministic fit gate immediately before applying
  (pre-apply fit confirmation). If the fit gate no longer yields
  candidate, do not apply — handle skipped_unfit/needs_review the same
  way as the pre-tailoring gate.
- skipped_unfit events are local-only: record them via the canonical
  helper's record-event, but never route them to Discord or
  data/applied_jobs.json.
- ALWAYS record an internal event via record-event for every applied,
  needs_review, or failed outcome.
- ONLY successful applications (status "applied") are synced to the
  Google Sheet internship tracker via scripts/sync_internship_tracker.py
  — exactly one row per successful application, and only after the
  applied_jobs.json entry and internal event are recorded. needs_review,
  failed, and skipped_unfit outcomes must never be written to the sheet.
  The sheet is user-facing: pass only the current visible tracker fields,
  never internal-only fields. See "Internship tracker (Google Sheets)
  sync" below.

## Session start checklist
1. Run `python3 scripts/job_state.py ensure-files` — create/validate the
   canonical registry (data/job_registry.json) and local event log.
2. Read data/applied_jobs.json — build your dedup set.
3. Read data/job_registry.json — build your canonical dedup set.
4. Read config/targets.json — load role_keywords, level_keywords, locations.
5. Confirm Playwright MCP is available before starting browser-based steps.

## Board-specific fetch method
- Ashby and Lever: use bash/curl to call the public JSON API directly.
  No authentication required. Do not use Playwright for these two boards.
    - Ashby: GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
      for each slug in config/targets.json "ashby_company_slugs".
    - Lever: GET https://api.lever.co/v0/postings/{slug}?mode=json
      for each slug in config/targets.json "lever_company_slugs".
  Note: neither API supports server-side filtering — apply the role/level
  filter below client-side after fetching.
- If "ashby_company_slugs" or "lever_company_slugs" in config/targets.json
  is empty, missing, or contains only placeholder values (e.g.
  "REPLACE_ME"), skip that board for this run and log a single warning to
  the session output — do not abort the run. Other boards continue
  normally. Note this state is normally short-lived: the config
  validator auto-seeds placeholder-only slug arrays from the
  project-owned vetted lists (config/ashby_vetted_slugs.json,
  config/lever_vetted_slugs.json) via scripts/seed_vetted_slugs.py —
  it never overwrites an array containing any real slug. Never edit
  the vetted lists at run time; additions are reviewed code changes.
- SimplifyJobs: use the deterministic fetch helper — never scrape GitHub
  with Playwright:
  `python3 scripts/fetch_simplify_listings.py`
  The helper reads config/targets.json "simplify_feeds" (known feeds:
  "summer_internships", "new_grad"), fetches the project-owned
  SimplifyJobs listings JSON from raw.githubusercontent.com, filters to
  active + visible postings, and prints one raw-job JSON object per line
  on stdout (source "simplify"), ready for canonicalize.
  - If "simplify_feeds" is missing, empty, or placeholder-only
    ("REPLACE_ME"), the helper warns on stderr, prints nothing, and
    exits 0 — skip the board for this run and continue with the other
    boards. A non-zero exit means every configured feed failed to
    fetch: log one warning, skip the board, continue the run.
  - SimplifyJobs listings carry NO JD text. After role filtering and
    BEFORE running the fit gate, fetch the JD body from the listing's
    `url`: if the URL is an Ashby/Lever posting use those public JSON
    APIs, otherwise open the URL with Playwright and extract the JD
    text. Re-canonicalize/upsert the record with the fetched jd_text.
    Never run the fit gate on a SimplifyJobs job with empty jd_text —
    an empty JD skips every deterministic hard-reject check.
  - The helper's `sponsorship` field is informational/audit-only. Do
    not filter on it — the phase 4 fit gate is the only classifier.
- Workday (phase 7, REVIEW-ONLY): tenants are configured in
  config/targets.json "workday_tenants" as "<host>/<site>" strings —
  the tenant is the unit of configuration; board URLs follow
  `https://<company>.wd<n>.myworkdayjobs.com/<site>` (each company
  tenant differs in subdomain and site name). Use the deterministic
  fetch helper — it calls the tenant's public, auth-free CXS JSON
  endpoints; only fall back to Playwright on a posting when the helper
  fails for it:
  `python3 scripts/fetch_workday_listings.py --search "intern" --limit 200`
  One raw-job JSON object per line (source "workday"), ready for
  canonicalize.
  - Missing/empty/placeholder "workday_tenants" → helper warns, prints
    nothing, exits 0; skip the board, continue the run. Non-zero exit
    (every tenant failed) → one warning, skip, continue.
  - Listings carry NO JD text. After role filtering and BEFORE the fit
    gate, fetch the JD per surviving candidate with
    `python3 scripts/fetch_workday_listings.py --jd-url '<posting-url>'`
    and re-canonicalize/upsert with the fetched jd_text. Never fit-gate
    a Workday job with empty jd_text.
  - **No auto-apply path exists for Workday.** A Workday job whose fit
    gate returns "candidate" routes to needs_review (applied_jobs +
    review_queue + record-event + needs_review Discord notification)
    with reasoning "Workday review-only path: <title> at <company>;
    user to apply manually". Never tailor, never form-fill, never
    submit a Workday application. needs_review items are not
    applications and do not count against the 25-per-session cap.
- LinkedIn, Indeed, Handshake, Greenhouse, Wellfound: use Playwright MCP for
  browser-based scraping.

## Role filtering (apply to all boards, regardless of fetch method)
- A job title is a candidate if it contains AT LEAST ONE term from
  config/targets.json "role_keywords" AND AT LEAST ONE term from
  "level_keywords" — case-insensitive substring match, not exact match.
- If a title matches role_keywords but NONE of level_keywords, check the JD
  body text for level_keywords terms before rejecting — some postings put
  seniority only in the description, not the title.
- Hard rejects (3+ years required with no new-grad language, out of US
  scope) are enforced deterministically by the fit gate — see
  "Deterministic JD fit gate" below. Role filtering only does the
  keyword screen; it does not manual-heuristic reject.
- SEASON IS NOT A FILTER. Internships and co-ops in ANY season (summer,
  fall, spring, winter, off-cycle, year-round) are in scope. Do not skip
  or deprioritize a posting because it says "Fall 2026 Intern" or
  "Off-Cycle Internship" instead of "Summer". Use config/targets.json
  "season_keywords" only as a reference list of terms that should NOT
  cause rejection — never as a list to filter for or require.
- There is no company exclusion list — every company is in scope as long
  as the role/level keyword match passes.
- For new-grad (non-internship) roles, ignore season language entirely —
  it doesn't apply to full-time postings.

## Deterministic JD fit gate
- After role filtering and before tailoring, run the deterministic fit
  helper on every canonical job:
  `python3 scripts/evaluate_job_fit.py '<canonical-job-json>'`
  Pass the canonical job JSON (the same object upserted into the
  registry). The helper returns a JSON object with at least fit_status,
  fit_score, reasoning, fit_reasons, matched_role_keyword,
  matched_level_keyword, matched_level_source, years_required, and
  decision_version.
- The fit gate makes the status choice deterministically: use
  skipped_unfit for explicit hard rejects or clearly too-low fit,
  needs_review for borderline or ambiguous-but-promising jobs, and
  candidate otherwise.
- If the fit helper exits non-zero, returns invalid JSON, or returns an
  unexpected fit_status, treat the job as needs_review: append to
  data/applied_jobs.json and data/review_queue.json, record a
  needs_review event, and send the needs_review Discord notification.
  Do not proceed to tailoring or application when the helper result is
  unusable.
- Handle the helper output:
  - skipped_unfit — the job is clearly unfit (the helper's deterministic
    hard reject, e.g. 3+ years required, out of US scope). Record a
    local-only skipped_unfit event via record-event using the helper's
    reasoning. Do not send to Discord, do not append to
    data/applied_jobs.json, do not sync to the Google Sheet, and do not
    tailor. This replaces the manual 3+ years / out of US hard-reject
    check — the fit helper is the deterministic gate.
  - needs_review — the job is ambiguous and needs manual review before
    application. This is a user-visible manual-review outcome that
    occurs before any application submission. Do not tailor. Append a
    needs_review entry to data/applied_jobs.json (File write discipline
    schema; reasoning from the helper), append to
    data/review_queue.json, record a needs_review event via
    record-event, and invoke @discord-reporter with the needs_review
    route.
  - candidate — the job passes the fit gate. Proceed to @resume-tailor.
- The fit gate runs BEFORE resume-tailoring. Never send a skipped_unfit
  or needs_review job into tailoring — the fit gate is the deterministic
  cutoff that keeps low-quality candidates out of the review queue and
  out of tailoring.

## Handshake-specific handling
- Handshake requires a student login session. If Playwright cannot
  authenticate, skip Handshake and log one "handshake_auth_needed" entry to
  data/review_queue.json via the state helper (see File write discipline) —
  do not retry in a loop.

## Location handling
- "preferred_locations" in config/targets.json is a PRIORITY list, not a
  filter. Any job matching role_keywords + level_keywords is in scope
  regardless of location, as long as it's within "fallback_scope"
  (United States, including remote-US roles).
- Process and apply to preferred_locations matches first within each
  scraping batch. After preferred matches are exhausted for a board,
  continue processing remaining US-based matches normally — do not skip
  them and do not stop the batch early.
- Reject only if the posting is explicitly located outside the United
  States with no remote-US option (e.g. "London, UK" with no remote
  flexibility for US-based candidates).
- When logging to data/applied_jobs.json, record `location_tier` for each
  entry: "preferred" if the job's location matched a preferred_locations
  entry, or "fallback" if it was applied to under the US-wide fallback
  scope. This field is required by the File write discipline schema.

## Canonical registry and event log
- The canonical helper (scripts/job_state.py) is the single source of truth
  for canonical job records and internal events. Never hand-write
  data/job_registry.json or the local event log — always go through the
  helper.
- Canonicalize every scraped raw job into one internal record before any
  dedup or filtering decision:
  `python3 scripts/job_state.py canonicalize '<raw-job-json>'`
  Pass the raw job (company, title, url, source, jd_text, location, etc.)
  as a single JSON object string. The helper returns a canonical job JSON
  with a stable job_key (the canonical identity) and a job_id. job_id is
  "{source}-{external_job_id}" when an external id is available, otherwise
  the job_key.
- Upsert each canonical record into the registry:
  `python3 scripts/job_state.py upsert-job '<canonical-job-json>'`
  The helper merges by job_key — existing records are updated, new records
  are inserted. Never append duplicates manually.
- Before any application attempt, re-check eligibility:
  `python3 scripts/job_state.py can-apply '<canonical-job-json>'`
  This is the dedupe recheck against the registry and applied history. If
  the helper refuses (returns non-zero or prints "no"), skip the job and
  record a skipped_unfit event. Do not attempt the application.
- Record internal events for every outcome:
  `python3 scripts/job_state.py record-event '<event-json>'`
  Status values and when to use them:
    - skipped_unfit — a hard reject during filtering (3+ years, out of US
      scope, etc.), a skipped_unfit from the deterministic fit gate
      (pre-tailoring or pre-apply), or a can-apply refusal right before
      applying. Local-only: never route to Discord or
      data/applied_jobs.json.
    - applied — application submitted successfully.
    - needs_review — application could not be completed (CAPTCHA, missing
      form fields, ATS score too low, etc.), or a needs_review from the
      deterministic fit gate (ambiguous job, pre-tailoring or pre-apply).
      Every user-visible needs_review outcome — including ones that occur
      before a real application submission, such as an ATS score below
      threshold during tailoring or a needs_review from the fit gate —
      must also be appended to data/applied_jobs.json so future runs do
      not re-tailor the same job forever. skipped_unfit is local-only and
      never written to applied_jobs.json.
    - failed — application submitted but errored or was rejected by the
      form.
  The event JSON must include: job_key and status (applied, needs_review,
  failed, or skipped_unfit). Include company, title, url, and reasoning
  (for needs_review, failed, skipped_unfit) for auditability. The helper
  stamps recorded_at if omitted.
- skipped_unfit is local-only. It exists for auditability of hard rejects
  but must never appear in Discord notifications or data/applied_jobs.json.
  The @discord-reporter subagent must not be invoked for skipped_unfit
  events.

## File write discipline
- applied_jobs.json entries must include: job_id, company, title, url,
  date_applied, status (applied|failed|needs_review), role_type
  (internship|new_grad), source (linkedin|indeed|greenhouse|lever|
  wellfound|handshake|ashbyhq|simplify|workday), resume_used
  (swe|ai_ml|balanced|cyber|networking_cyber),
  ats_score (number), location_tier (preferred|fallback),
  cover_letter_used (bool). When status is "failed" or "needs_review",
  a "reasoning" field is also required — a specific, one-sentence
  explanation of why the application failed or needs review (e.g.
  "ATS score 38/100 — requires CISSP certification not present in
  resume"). Never leave this field empty or generic. The "reasoning"
  field is optional when status is "applied".
- Never overwrite the file — always append new entries.
- Use the deterministic state helper for all JSON state writes — never
  hand-write jq one-liners to mutate state files directly. The helper
  handles atomic write, array append, and dedup guard.
  - Append to applied_jobs.json:
    `bash scripts/append_state_entry.sh data/applied_jobs.json '<entry-json>'`
  - Append to review_queue.json:
    `bash scripts/append_state_entry.sh data/review_queue.json '<entry-json>'`
  - Pass the entry as a single JSON object string. Do not construct tmp
    files or mv commands yourself.
- Canonical registry and event log writes go through the canonical helper
  (scripts/job_state.py), not append_state_entry.sh:
  `python3 scripts/job_state.py upsert-job '<canonical-job-json>'`
  `python3 scripts/job_state.py record-event '<event-json>'`
  See "Canonical registry and event log" above for the full flow.

## Scheduler (phase 8)
- The production cadence is a launchd user agent (macOS) running
  scripts/run_job_agent.sh every 30 minutes, 24/7 — managed by
  scripts/scheduler.sh (install|uninstall|status|plist); Linux
  equivalent documented in docs/SETUP.md 3.5. The runner owns overlap
  protection (skip-on-overlap, dead-lock reclaim, 60-min hung-run
  threshold), writes the machine-parseable
  "run_job_agent: complete ..." health marker, and updates
  logs/heartbeat.json after every run. The 25-per-session cap is
  unchanged by the cadence.

## TUI surface (phase 13)
- The TypeScript TUI in app/ is a rendering/orchestration overlay only.
  The Python/bash helpers remain the sole authoritative state writers:
  the TUI shells out to append_state_entry.sh and job_state.py for every
  state mutation and never edits state JSON directly. A TypeScript port
  of the core is a separate, explicitly-approved future decision.
- The review-queue file stays append-only: TUI triage records outcomes
  (applied_jobs append + record-event) and derives "resolved" from
  them — it never deletes queue entries.

## Browser extension surface (phase 10)
- The Manifest V3 extension in extension/ is the user-driven hybrid
  mode: the USER browses postings and submits forms; the extension only
  autofills, shows the fit verdict, and records outcomes.
- The extension NEVER submits a form. Autofill stops at a filled form;
  the user reviews and clicks submit themselves. This is the defining
  safety property of hybrid mode — never weaken it.
- Autofill values come ONLY from config/targets.json "safe_fields". A
  field the profile cannot answer is highlighted for the user, never
  invented. The bridge serves only the specific keys a page's form
  mapped — never the whole safe_fields map.
- All extension reads/writes flow through scripts/extension_bridge.py
  (localhost-only, per-install bearer token in the gitignored
  config/extension_bridge.json). The bridge itself only shells out to
  the standard helpers (job_state.py, evaluate_job_fit.py,
  append_state_entry.sh, sync_internship_tracker.py) — the same write
  discipline as the agent and the TUI, so hybrid-mode and agent-mode
  applications dedupe against each other in the same job_key space.
- Extension-recorded outcomes are "applied" (after the user confirms
  they submitted) and "needs_review" (save for later). The applied
  path re-checks can-apply before writing and syncs the tracker
  best-effort, mirroring the agent path.
- ATS selector fixups live in extension/src/ats.ts only — one
  reviewable module for all four families (Greenhouse, Lever, Ashby,
  Workday). Web-store distribution is out of scope (load unpacked).

## Internship tracker (Google Sheets) sync
- The Google Sheet internship tracker is a user-facing record of
  successful applications. Sync is one-way (agent → sheet) and
  append-only: each successful application adds exactly one row.
- Sync ONLY outcomes with status "applied". needs_review, failed, and
  skipped_unfit must never be written to the sheet — those are internal
  or review-only outcomes.
- Sync happens exactly once per successful application, and only AFTER
  the applied_jobs.json entry is appended and the internal "applied"
  event is recorded via record-event. Do not sync before those writes
  succeed.
- The sheet is user-facing: the sync payload must contain only the
  current visible tracker fields. Never send internal-only fields
  (job_key, external_job_id, normalized_url, normalized_apply_url,
  ats_system, ats_score, resume_used, location_tier, cover_letter_used,
  reasoning, sources, first_seen_at, last_seen_at, latest_status,
  role_type) to the sheet.
- Invoke the helper with a single JSON payload describing one successful
  application:
  `python3 scripts/sync_internship_tracker.py '<row-json>'`
  The payload carries the visible tracker row fields (JSON keys match
  the helper's accepted payload fields):
    - company (required) — the applied job's company.
    - title (required) — the applied job's title.
    - date_applied (optional) — the actual application date (see
      below). Defaults to today if omitted.
    - internship_term (optional) — derived per the rules below.
    - notes (optional, user-facing only) — a short note for the Notes
      column. Leave blank unless there is something specific worth
      surfacing to the human reader; never put internal reasoning here.
  The helper auto-fills the remaining visible columns (Status, Response
  Received, Date of Response) — do not send those. Source and URL are
  not visible tracker columns and the helper does not read them; do not
  include them in the payload.
- Internship Term population (in priority order):
    1. Use the canonical job record's `internship_term` if it is
       non-empty.
    2. Otherwise, infer a term from the job title and JD text ONLY when
       a clear term is present (e.g. "Summer 2026", "Fall 2026 Intern",
       "Spring Co-op"). Use config/targets.json "season_keywords" as
       the reference set of recognizable terms. Do not guess or
       fabricate a term.
    3. Otherwise, leave Internship Term blank.
- Date Applied is the actual application submission date — the
  `date_applied` value written to the applied_jobs.json entry —
  formatted as YYYY-MM-DD (a format Google Sheets recognizes as a
  date). Never use the sync timestamp in place of the real application
  date.
- If the helper reports that sync is disabled or unconfigured (e.g.
  missing credentials or sheet id), or exits non-zero for any reason,
  log a single warning to the session output and continue. The
  application run is still successful — do not treat a disabled,
  unconfigured, or non-zero-exit sync as a failed outcome, and do not
  retry in a loop.
- Out of scope (do not add): reverse sync (sheet → agent), extra machine
  or internal tabs, backfilling Notes or Status into existing rows, or
  any future-phase behavior beyond appending one row per successful
  application.
