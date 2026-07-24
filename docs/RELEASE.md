# Release notes — aplyx 0.9.85a

> **Build:** `0.9.85a` — alpha.
> **Branch:** `main`.
> **TUI in-app marker:** `packages/core/src/version.ts` →
> `BUILD_MARKER = "0.9.85a"` (re-exported from `app/src/theme.ts`,
> visible in the TUI side-panel footer, and also in the desktop app's
> Settings screen — one shared constant, both surfaces agree).
> **npm package:** `@keshm/aplyx` version `0.9.85-alpha.0`, published to
> the default `latest` dist-tag — `npm install -g @keshm/aplyx` gets it.
> The unscoped npm name `aplyx` belongs to an unrelated package — never
> `npm install aplyx`. If a re-publish is ever needed for this same
> build, the npm semver bumps to `alpha.1`/`alpha.2` while the
> human-facing build marker/git tag stay `0.9.85a`.
> **Rollout:** clients on the updater lineage self-update on their next
> scheduled run or `aplyx` launch; older installs update manually once
> (`bash scripts/install/update.sh` / `powershell scripts\install\
> update.ps1`).
> **Desktop app:** 0.1.0 internally (Tauri app version, not tied to the
> TUI's release cadence) — this release is desktop-only.
> **Browser extension:** unchanged in this build — `0.8.2` / `0.8.2a`.
> **Previous releases:** `0.9.8a`, `0.9.75a`, `0.9.7a`, `0.9.1a`,
> `0.9.0a`, `0.8.43a`, `0.8.42a`, `0.8.041a`, `0.8.4a`, `0.8.3a`,
> `0.8.2a`, `0.7.8a`, and `0.5.5a` — deep-dive notes live at this path
> under their git tags; the index is [`CHANGELOG.md`](./CHANGELOG.md).

## What's new in 0.9.85a

Desktop-only: a full logo rebrand, a native-feeling window chrome, a
real Google/email sign-in bug fix, and a couple of small polish items.

### Logo rebrand

Replaced the old tile-grid lowercase "a" mark with a new gradient badge
holding a white "AX" monogram, based on an operator-supplied reference
image. The reference's exact pixels are used verbatim — its badge
region was isolated programmatically (bounding-box detection + a flood
fill from the crop edges to clear only the background, not the white
monogram) rather than hand-traced, so it's a pixel-accurate match, not
an approximation. One source image now drives both the in-app mark
(`desktop/src/components/Logo.tsx`) and the actual macOS/Windows/Linux
app icon set (`npx tauri icon`, regenerated for every platform
including iOS/Android assets that ship in the repo for future use);
the icon-generation source additionally composites the badge onto a
transparent canvas at ~84% fill, matching the margin convention real
macOS app icons bake into their own source art — previously the badge
filled its canvas edge to edge, which read as oversized next to other
Dock icons.

### Native window chrome (macOS)

The desktop window previously used the OS's default opaque title bar —
a gray strip uncorrelated with the app's own theme. It's now
`titleBarStyle: "Overlay"` (`tauri.conf.json`): the traffic-light
buttons float over the app's own content, whose background already
recolors with theme/mode, so the "title bar" now just reads as the top
of the app rather than a separate strip. Dragging the window from that
area required both a custom drag region (`data-tauri-drag-region` +
an explicit `getCurrentWindow().startDragging()` call, since Tauri's
auto-injected drag listener wasn't reliably triggering inside this
app's WKWebView) and — the actual root cause of it working only
intermittently — granting `core:window:allow-start-dragging` in
`capabilities/default.json`, which Tauri's permission system was
silently denying. A subtle themed border line marks where the
draggable strip ends; the app shell's sidebar divider no longer runs
through that line (it now starts exactly where the drag bar ends
instead of crossing it, a stray-looking artifact once the badge
started reaching all the way to the top of the window).

### Fixed

- **Google sign-in (and email-confirmation links) silently failed to
  complete** — the deep-link handler passed the entire
  `aplyx://auth-callback?code=...` URL to
  `supabase.auth.exchangeCodeForSession()`, which expects only the bare
  PKCE code. The exchange failed server-side with no visible error, so
  completing a real, successful Google auth just landed back on the
  sign-in screen with nothing to show why. Now extracts the `code`
  query parameter first, and logs any exchange error instead of
  discarding it silently.
- Home dashboard's "Welcome back" / sign-in status line is now centered
  and fades in with the rest of the dashboard, instead of being the one
  static, left-aligned element on the page.

## Install / update / uninstall

```bash
# install (one command; puts `aplyx` on your PATH):
curl -fsSL https://raw.githubusercontent.com/keshm2/aplyx/main/scripts/install/install.sh | bash

# or via npm:
npm install -g @keshm/aplyx

# optionally also install the desktop app:
bash scripts/install/install_desktop.sh        # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\install\install_desktop.ps1   # Windows

# update now (also happens automatically on runs and launches):
aplyx update

# uninstall (removes the desktop app too, if installed):
aplyx uninstall          # add --keep-data to keep config/data/resumes
```

Windows: `powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1`
(or `irm .../install.ps1 | iex`), native PowerShell, no WSL.

## Verification

- `tsc --noEmit` clean across `@aplyx/core` and `desktop`.
- The permission-gate root cause for intermittent dragging was found by
  searching Tauri's own GitHub issues after ruling out CSS/JS causes via
  a live, instrumented build (a pure-CSS `:active` hit-test to confirm
  clicks were reaching the drag region, then devtools console logging
  around the `startDragging()` call) — not guessed.
- The logo crop was verified against the reference image with an actual
  side-by-side rendered comparison (not memory) before being applied,
  through several iterations until the proportions matched; the final
  version uses the reference's own pixels directly rather than a
  re-drawn approximation.
- `npm run tauri build` produced a clean macOS release bundle; installed
  to `/Applications/aplyx.app`, launched, and confirmed running — window
  dragging, theme-matched title bar, and the new icon all verified live
  in the installed app, not just the dev server.
- Not exercised this pass: Linux/Windows desktop builds, and the TUI
  itself, since this release doesn't touch TUI code.

## Release artifacts

- Git tag `v0.9.85a` on `main`.
- npm: `@keshm/aplyx@0.9.85-alpha.0` under the `latest` dist-tag
  (`cd app && npm publish` — `publishConfig` sets `access: public` and
  the tag). Publish requires `npm login`.
- CI workflow `.github/workflows/tui.yml` runs on every push touching
  the TUI/core. `.github/workflows/desktop-release.yml` builds and
  attaches desktop app bundles to a tagged release (triggered on `v*`
  tag pushes, or manually via `workflow_dispatch` for an existing tag).

## Known gaps

- Desktop app: the CI-built Linux and Windows bundles install correctly
  per the asset-matching logic but haven't been re-verified on real
  Linux/Windows hardware — only macOS was verified live this pass.
  `titleBarStyle: "Overlay"` and the custom drag region are macOS-
  specific changes; Windows/Linux window chrome is unaffected (they
  never had this problem — only macOS's native title bar was the
  mismatched-gray-strip issue).
- Desktop app: hosted↔local pipeline-state sync doesn't exist yet —
  `SupabaseAdapter.loadState()` returns `undefined`.
- Hosted sign-up email delivery depends on the operator configuring
  custom SMTP — done on the live project this pass (Resend, verified
  live), but Google OAuth's Cloud Console app is still in "Testing"
  publishing status (only allow-listed test accounts can sign in) —
  publishing it to production is a future step, not done here.
- Codex / Copilot live conformance runs still pending a machine with
  those CLIs.
- Workday remains review-only by design.
- The "preferred locations only" filter is still offline on desktop,
  pending a redesign now that pagination has landed (unchanged from
  0.9.8a).
