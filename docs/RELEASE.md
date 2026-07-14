# Release notes — applyr 0.7.9a

> **Build:** `0.7.9a` — alpha.
> **Branch:** `main`.
> **TUI in-app marker:** `app/src/theme.ts` → `BUILD_MARKER = "0.7.9a"`
> (visible in the TUI side-panel footer).
> **npm package:** `@keshm/applyr` version `0.7.9-alpha.0`, dist-tag
> `alpha`. The unscoped npm name `applyr` belongs to an unrelated
> package — never `npm install applyr`. npm requires strict semver, so
> `0.7.9a` is the human-facing marker and `0.7.9-alpha.0` its semver
> form.
> **Rollout:** the first auto-updated release — clients that installed
> the updater lineage self-update on their next scheduled run or
> `applyr` launch; older installs update manually once
> (`bash scripts/update.sh`).
> **Browser extension:** unchanged — stays at `0.5.5` / `0.5.5a`.
> **Previous releases:** `0.7.8a` and `0.5.5a` — deep-dive notes live
> at this path under their git tags; the index is
> [`CHANGELOG.md`](./CHANGELOG.md).

## What this build is

`0.7.9a` is the **distribution** release: install with one command,
stay current automatically, leave cleanly.

- **One-command install** — the cURL one-liner ends with a working
  `applyr` on your PATH; an npm-installed `applyr` with no core
  offers to download the core itself.
- **Automatic updates** — every scheduled run and `applyr` launch
  checks the `VERSION` file on GitHub `main` and self-updates
  (fail-open; `APPLYR_AUTO_UPDATE=0` opts out; `applyr update` runs
  one manually). Git checkouts fast-forward pull; archive installs
  overlay the tarball; per-user files are never touched.
- **Dedicated uninstall** — `applyr uninstall` /
  `bash scripts/uninstall.sh`: removes the schedule and the PATH
  wrapper, then deletes the install directory only after explicit
  confirmation (`--keep-data` / `--yes` variants). npm installs also
  run `npm uninstall -g @keshm/applyr`.
- **Phase 16 — multi coding-agent support** — Codex CLI and GitHub
  Copilot CLI adapters, 4-agent installer detection, the harness
  capability matrix with mandatory degraded paths in `AGENTS.md`, and
  the conformance suite (`scripts/run_conformance.py`; results in
  `docs/SETUP.md` §3.8).
- **README rewrite** — cut to ~a quarter of its length; phase
  planning and per-build inventories now live only in the docs.
- **Discord is optional** — the installer and `applyr setup` ask
  whether you want Discord status updates; opting in offers one
  channel for everything or separate channels per status (⚠ each
  channel needs its own webhook link). Opting out keeps every
  outcome local; the validator and reporter treat a disabled config
  as a clean skip, and legacy configs (no `enabled` field) keep
  working unchanged.

It also carries everything from the untagged `0.7.8a` follow-ups:
phase 9 (single-user structure review) and the TUI/setup work
documented in the changelog.

**applyr requires at least one supported coding agent** — Claude Code
or opencode (full capability), or Codex CLI / GitHub Copilot CLI
(API-boards degraded path).

## Install / update / uninstall

```bash
# install (one command; puts `applyr` on your PATH):
curl -fsSL https://raw.githubusercontent.com/keshm2/ares/main/scripts/install.sh | bash

# or via npm:
npm install -g @keshm/applyr

# update now (also happens automatically on runs and launches):
applyr update

# uninstall:
applyr uninstall          # add --keep-data to keep config/data/resumes
```

## Verification

- Updater sandbox: tarball overlay 0.0.1 → test version with per-user
  files untouched; idempotent second run; dead-network `--auto` exits
  0; stale-lock reclaim; safe self-overwrite mid-run. Live end-to-end:
  a stale client pulled real GitHub `main` and self-updated.
- Uninstaller sandbox: `--keep-data` removes schedule + wrapper only;
  foreign-wrapper protection leaves other installs' commands alone;
  non-interactive without `--yes` never deletes data; `--yes` removes
  the install directory completely.
- Conformance: deterministic leg 13/13 PASS; harness legs opencode
  PASS and Claude Code PASS live; Codex/Copilot legs SKIP (CLIs not
  installed on the verification machine) — see `docs/SETUP.md` §3.8.
- `npm run typecheck` / `build` / `smoke` pass; `bash -n` clean on all
  shipped scripts; installer re-run is a no-op.

## Release artifacts

- Git tag `0.7.9a` on `main` — GitHub's automatic source archives are
  the manual-install path.
- npm: `@keshm/applyr@0.7.9-alpha.0` under the `alpha` dist-tag
  (`cd app && npm publish` — publishConfig sets `access: public` and
  the tag). Publish requires `npm login`.
- CI workflows (`.github/workflows/tui.yml`, `extension.yml`) run on
  the tag; no release-asset uploads are configured.

## Known gaps

- npm publish of `@keshm/applyr` awaits `npm login` on the
  maintainer's machine.
- Codex / Copilot live conformance runs pending a machine with those
  CLIs (`python3 scripts/run_conformance.py --harness all`).
- Phase 15 full-run parity check remains an operator action (the
  conformance harness legs are the first live signal).
- Phase 10 live in-browser autofill pass still pending.
- Workday is review-only by design.
- The sidebar greeting falls back to the `Test User` placeholder until
  setup writes a first name; there is still no account store.
