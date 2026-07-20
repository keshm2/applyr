# Release notes — applyr 0.9.7a

> **Build:** `0.9.7a` — alpha.
> **Branch:** `main`.
> **TUI in-app marker:** `packages/core/src/version.ts` →
> `BUILD_MARKER = "0.9.7a"` (re-exported from `app/src/theme.ts`,
> visible in the TUI side-panel footer, and now also in the desktop
> app's Settings screen — one shared constant, both surfaces agree).
> **npm package:** `@keshm/applyr` version `0.9.7-alpha.0`, published
> to the default `latest` dist-tag — `npm install -g @keshm/applyr`
> gets it. The unscoped npm name `applyr` belongs to an unrelated
> package — never `npm install applyr`. If a re-publish is ever needed
> for this same build, the npm semver bumps to `alpha.1`/`alpha.2`
> while the human-facing build marker/git tag stay `0.9.7a` (same
> divergence as `0.9.0a`'s `0.9.0-alpha.2`).
> **Rollout:** clients on the updater lineage self-update on their next
> scheduled run or `applyr` launch; older installs update manually once
> (`bash scripts/install/update.sh` / `powershell scripts\install\
> update.ps1`).
> **Desktop app:** early preview, 0.1.0 internally (Tauri app version,
> not tied to the TUI's release cadence) — opt-in via the installer or
> `scripts/install/install_desktop.{sh,ps1}`, ships alongside the TUI.
> **Browser extension:** unchanged in this build — `0.8.2` / `0.8.2a`.
> **Previous releases:** `0.9.1a`, `0.9.0a`, `0.8.43a`, `0.8.42a`,
> `0.8.041a`, `0.8.4a`, `0.8.3a`, `0.8.2a`, `0.7.8a`, and `0.5.5a` —
> deep-dive notes live at this path under their git tags; the index is
> [`CHANGELOG.md`](./CHANGELOG.md).

## What's new in 0.9.7a

### Desktop app (early preview) — Tauri + React, all three platforms

A graphical alternative to the TUI, `desktop/`. Local mode never
touches `node:fs`/`child_process` from the frontend — narrow
`#[tauri::command]`s in `desktop/src-tauri/src/lib.rs` spawn
`packages/core/dist/bridge.js` over stdio and reuse the exact
`LocalAdapter`/helper functions the TUI already uses. Hosted mode's
frontend talks to Supabase directly (`SupabaseAdapter`, pure
`@supabase/supabase-js`, no Node APIs — safe to run in a webview).

- **Screens:** a landing chooser (Run locally / Sign in), a local
  onboarding wizard sharing the TUI's 8-page profile schema
  (`packages/core/src/onboarding/fields.ts`), a hosted wizard
  (email/password + Google sign-in, import-from-local-or-start-fresh,
  the same 8 field pages via `SupabaseAdapter`, resume upload), and an
  app shell (Home + Settings real; Jobs/Review/History/Resumes are
  explicit "coming in the next update" placeholders).
- **Hosted accounts (optional).** `supabase/migrations/0001_init.sql` +
  `0002_onboarding_completed.sql` — `profiles`/`jobs`/`job_events`/
  `applied_jobs`/`review_queue` tables plus a private per-user resumes
  storage bucket, every table RLS-scoped to `auth.uid()`, a
  status-transition guard on `jobs` mirroring the local engine's
  never-downgrade rule. `applyr://auth-callback` deep link handles the
  email-confirmation and Google OAuth redirects (a desktop app can't
  sit at a `localhost` URL to receive them); PKCE flow throughout.
- **Brand + theme.** Real logo (a block lowercase "a", traced from the
  operator's brand image) replacing the placeholder mark, full Tauri
  icon set regenerated from it. Palette reworked to match the TUI's
  violet/pink identity — light theme is a warm beige, dark matches the
  icon's near-black plum, both via `data-theme` (Settings toggle:
  system/light/dark) plus `prefers-color-scheme`. Font picker
  (system stack, or bundled Geist/Geist Mono — no CDN fetch).
- **Tag-style preference search.** Company and location fields in both
  wizards are now fuzzy search-and-tag: matches from a suggestion pool,
  selections render as removable chips wrapping into rows. The fuzzy
  matcher itself (`packages/core/src/autocomplete.ts`) moved from
  `app/src/ui/autocomplete.ts` so the TUI and desktop app share one
  implementation instead of two.

### All three installers can offer the desktop app

`install.sh`/`install.ps1` now ask, near the end of the normal TUI
install, whether to also build and install the desktop app — opt-in,
defaults to no. New standalone `scripts/install/install_desktop.sh`
(macOS/Linux) and `install_desktop.ps1` (Windows): detects Rust and
OS-native GUI build dependencies (Xcode CLT / webkit2gtk-family via
apt·dnf·pacman / Visual C++ Build Tools), asks before installing
anything missing, builds in release mode, and installs the
platform-native way:

- macOS → `/Applications/applyr.app` (falls back to `~/Applications`
  rather than requiring sudo).
- Linux → `apt install`/`dnf install` the built `.deb`/`.rpm` if
  available, else an AppImage plus a generated
  `~/.local/share/applications/applyr.desktop` entry.
- Windows → prefers the NSIS installer (per-user, no admin/UAC prompt)
  over the MSI.

A failure at any point here only warns — the TUI install it's attached
to already succeeded and is unaffected either way. Standalone and
independently re-runnable, so fixing one missing dependency doesn't
mean redoing the whole install. `scripts/install/uninstall.py` now
also removes the desktop app if present, on all three platforms.

### Fixed

- **The hosted and local onboarding wizards replayed on every sign-in
  or launch**, even for an already-set-up returning user. Local mode
  already wrote a completion flag (`config/onboarding.json`) but
  nothing ever read it; hosted mode had no tracking at all (new
  `profiles.onboarding_completed` column). Both now skip straight to
  the dashboard for a returning user; a persisted hosted session
  (Supabase already keeps you signed in across relaunches) now resumes
  straight into the app instead of re-showing the landing chooser.
- **Coding-agent detection was flaky (~50% miss rate)** from the
  installed desktop app specifically — a Finder/Dock-launched process
  inherits launchd's minimal `PATH` (no Homebrew/nvm/volta), so
  `opencode`/`claude` binaries installed via those were invisible even
  though a terminal launch found them fine. Detection now also probes
  the common install locations directly.
- **`packages/core` had no build hook** — the TUI's own installer build
  step silently depended on `packages/core/dist` already existing from
  a prior build, which is never true on a genuinely fresh clone. Both
  installers now run `npm run build:core` explicitly before building
  either the TUI or the desktop app.
- Supabase's built-in mailer is rate-limited/unreliable by design (not
  meant for production use per their own docs); retrying a signup for
  an already-registered, unconfirmed email silently did nothing and no
  new email was sent. Now surfaced clearly, with a working "Resend
  confirmation email" action.
- Sign-in could hang forever on "Checking sign-in availability…" if the
  local bridge failed to spawn (e.g. `node` not on the installed app's
  minimal PATH) — the rejection was silently dropped. Now surfaces a
  real error state with a retry action.

## Install / update / uninstall

```bash
# install (one command; puts `applyr` on your PATH):
curl -fsSL https://raw.githubusercontent.com/keshm2/applyr/main/scripts/install/install.sh | bash

# or via npm:
npm install -g @keshm/applyr

# optionally also install the desktop app (early preview):
bash scripts/install/install_desktop.sh        # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\install\install_desktop.ps1   # Windows

# update now (also happens automatically on runs and launches):
applyr update

# uninstall (removes the desktop app too, if installed):
applyr uninstall          # add --keep-data to keep config/data/resumes
```

Windows: `powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1`
(or `irm .../install.ps1 | iex`), native PowerShell, no WSL.

## Verification

- `npm run build:core` / `npm run typecheck:app` / desktop `tsc` +
  `vite build` all clean.
- `bash -n` clean on every shipped/modified shell script; Python
  changes syntax-checked (`py_compile`).
- Desktop app build + install exercised live end-to-end on macOS: a
  clean release build (Rust dependency tree compiled from scratch),
  bundled, installed to `/Applications/applyr.app`, launched and
  confirmed running; a warm re-run rebuilds incrementally; the new
  uninstall path correctly finds and removes it.
- The new installer opt-in prompt verified both ways: non-interactive
  runs skip cleanly with a clear message and don't disturb the rest of
  the install; the rest of `install.sh` (config, harness detection,
  TUI build, `applyr` on PATH) runs unaffected either way.
- Onboarding-completion skip logic exercised live in a mocked-bridge
  browser session for local mode (both the completed and
  not-yet-completed branches land on the correct screen); the hosted
  equivalent typechecks against the real `SupabaseAdapter` and is
  structurally identical, but wasn't exercised against a live signed-in
  session this pass (see Known gaps).
- **Post-release follow-up:** desktop app bundles are now built by CI
  (`.github/workflows/desktop-release.yml`, `tauri-apps/tauri-action`)
  for macOS (arm64 + x86_64), Linux, and Windows, and attached to this
  release — `install_desktop.sh`/`.ps1` download and install a
  prebuilt bundle instead of compiling one locally whenever a match
  exists, needing nothing beyond curl (no Rust, no Xcode CLT, no
  Visual C++ Build Tools). Ran the real CI build end-to-end (GitHub
  Actions run 29721762423, all 4 matrix jobs green) and verified the
  produced macOS bundle installs and launches correctly on real
  hardware in ~3 seconds, down from a ~78-second cold from-source
  build. Caught and fixed two real bugs this surfaced: Tauri's own
  asset naming isn't symmetric (Intel Macs are "x64", not "x86_64",
  which `uname -m` reports — would have silently missed the match and
  fallen back to a from-source build), and `echo "$var" | jq`
  corrupted the JSON in at least one shell environment (backslash
  escapes in the release body got interpreted instead of passed
  through) — replaced with `printf '%s'` throughout. Linux and Windows
  CI jobs completed successfully (real bundles produced, matching
  asset-selection logic verified directly against the live release
  data) but the actual install execution isn't verified on real
  Linux/Windows hardware (see Known gaps) — only macOS was.

## Release artifacts

- Git tag `v0.9.7a` on `main`.
- npm: `@keshm/applyr@0.9.7-alpha.0` under the `latest` dist-tag
  (`cd app && npm publish` — `publishConfig` sets `access: public` and
  the tag). Publish requires `npm login`.
- CI workflow `.github/workflows/tui.yml` runs on every push touching
  the TUI/core. `.github/workflows/desktop-release.yml` builds and
  attaches desktop app bundles to a tagged release (triggered on `v*`
  tag pushes, or manually via `workflow_dispatch` for an existing tag).

## Known gaps

- Desktop app: the CI-built Linux and Windows bundles install
  correctly per the asset-matching logic (verified against the live
  release data) but haven't been run on real Linux/Windows hardware
  (macOS verified live on real hardware — see Verification above).
- Desktop app: Jobs / Review queue / History / Resumes screens are
  still placeholders (Phase 14B).
- Desktop app: hosted↔local pipeline-state sync doesn't exist yet —
  `SupabaseAdapter.loadState()` returns `undefined`.
- Hosted sign-up email delivery depends on the operator configuring
  custom SMTP (Supabase's built-in mailer is rate-limited/unreliable) —
  not yet done on the live project.
- Google OAuth sign-in needs a Google Cloud OAuth client configured in
  the Supabase dashboard — not yet done on the live project.
- Codex / Copilot live conformance runs still pending a machine with
  those CLIs.
- Workday remains review-only by design.
