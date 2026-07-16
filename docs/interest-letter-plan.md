# Work item #4 — "Why do you want to work here?" interest letters

Plan of record for the essay-question item, plus the 0.9.1a release.
Scratch/working doc; the durable summary lands in `system_architecture.md`.

## Problem

Some applications ask a free-text motivation question ("Why do you want to
work at X?", "Why this role?"). Today `job-scraper.md` Phase 3 fills forms
from `safe_fields` only and has no notion of such a question, so the agent
either invents an answer or the field blocks the submit. The user wants to
either type the answer themselves or have applyr draft one, review/edit it,
then submit.

## The hard constraint

A run is a **headless subprocess**. `run_job_agent.py` spawns the harness
CLI; the TUI only *observes* it via a session-log tail. There is no channel
for the agent to ask a question and block for an answer, and it must not
block anyway: the scheduler fires every 30 min and a wedged run is killed at
60 min (`APPLYR_LOCK_MAX_AGE_MIN`).

So the interaction is **asynchronous**: the run parks the job and moves on;
the user answers later in the TUI; the next run applies.

## Design

### State (new helper — deterministic, owns its file)

`scripts/state/interest_letter.py` → `data/interest_letters.json`.
Keyed by `job_key`. Statuses: `pending` (agent asked, user hasn't answered)
→ `approved` (text ready to paste). Subcommands:

| cmd | purpose |
| --- | --- |
| `ensure-file` | create/validate, like `job_state.py ensure-files` |
| `request '<json>'` | agent parks a job: job_key, company, title, url, question, jd_excerpt |
| `pending` | JSONL of parked requests (TUI list + agent skip-set) |
| `get <job_key>` | one record |
| `save-draft <job_key> '<text>'` | store a draft without approving |
| `approve <job_key> '<text>'` | mark ready; this is what unblocks applying |
| `approved-text <job_key>` | text to paste, empty + rc=2 if not approved |
| `discard <job_key>` | user declines this job |

Atomic temp-file+rename writes, stdlib only — same shape as `job_state.py`.

### Why not `needs_review`

`job_state.py can-apply` **blocks** on `needs_review`, so a job routed there
can never be retried — but retrying is the entire point once the user
supplies text. Parking therefore records **no registry event and no
`applied_jobs.json` row**; the job stays eligible. To avoid re-tailoring a
parked job every run, `job-scraper.md` reads `pending` early (Phase 2) and
skips those job_keys before tailoring. `job_state.py`'s interface stays
frozen (PLAN §5.2) — no new event status, no transition-guard change.

### Agent (generation)

`agents/bodies/interest-letter.md` + frontmatter for claude/opencode.
Input: company, title, JD, the question, the user's resume + safe_fields.
Output: one JSON object `{ "letter": "...", "word_count": n }`.
Grounding rule: only facts from the resume/JD — never invent an employer,
a metric, or a personal anecdote.

### Harness consistency (the 4-agent requirement)

`AGENTS.md`: *"the only harness-specific code is the adapter block in
`scripts/runtime/run_job_agent.sh` (never add harness branches anywhere
else)"*. Generation needs to invoke an agent too, so **extract** the adapter
rather than duplicate it:

- New `scripts/runtime/harness_adapter.py`: `resolve_harness(root)` and
  `agent_command(exe, harness, agent, prompt)` — the single place that knows
  opencode/claude/codex/copilot argv shapes and the no-subagent-registry
  inline fallback.
- `run_job_agent.py` imports it (behavior unchanged, verified by diffing the
  generated argv against the current code).
- New `scripts/runtime/generate_interest_letter.py <job_key>` uses it too.

Capability matrix per `AGENTS.md`:

| harness | interest-letter |
| --- | --- |
| opencode | `--agent interest-letter` (registry) |
| claude | registry via `.claude/agents/` |
| codex | no registry → inline: read `agents/bodies/interest-letter.md` |
| copilot | no registry → inline: same |

Generation is a **plain LLM text task** — no browser, no subagent nesting —
so all four can do it; there is no degraded path to design.

### job-scraper.md changes (Phase 3)

1. Detect a required free-text motivation question.
2. `approved-text <job_key>` → if rc=0, paste it, continue.
3. Else `request` + skip the job (no event, no applied_jobs row). Print
   `[parked] <title> @ <company> — awaiting interest letter`.
4. Never invent an answer. Never submit with the field blank if required.

### TUI

New Letters tab: lists pending requests; `enter` edit raw text, `g`
generate a draft via the harness, `a` approve, `d` discard. Approve →
`approve`; next run applies.

## Acceptance

- [ ] Helper round-trips request → pending → draft → approve → approved-text
- [ ] `discard` removes from pending
- [ ] `approved-text` rc=2 when not approved (so the agent can branch)
- [ ] `agent_command` argv identical to today's for job-scraper × 4 harnesses
- [ ] Generated defs exist for interest-letter (claude + opencode); drift OK
- [ ] `conformance --harness all` still passes (mod the known flaky leg)
- [ ] typecheck/build/smoke/validator pass
- [ ] Release 0.9.1a: VERSION + BUILD_MARKER + package.json bumped together

## Release 0.9.1a

`docs/RELEASE.md` is the procedure. VERSION bump is what triggers client
auto-update. npm publish needs `npm login` — this machine is 401, so that
step is the operator's (same blocker as the pending unpublish).
