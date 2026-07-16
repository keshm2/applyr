# applyr app integration plan

This document captures the planned **real app UI** that will sit in front
of the current workflow before beta, with the TUI staying available as an
optional, faster surface for power users.

## Goal

Ship a visually appealing, easier-to-use app that becomes the default face
of applyr, without replacing the proven local-first helper core or the TUI.

The app should:

- feel calm, premium, and trustworthy
- be easier for new users than the TUI
- support **local-first** use immediately
- expose **hosted / signed-in** mode later without a forked product
- reuse the current helper/state model instead of rewriting the engine

## Placement in the roadmap

This work should land **before beta release**, after phase 12 cost-tiering
work starts to stabilize but before the hosted-service push becomes the
default story.

Recommended placement:

1. Finish phase 12 (multi-agent cost tiering)
2. Insert the app work as a local-first app track
3. Keep the TUI optional and supported
4. Hook hosted auth/storage into the same app later
5. Continue into full hosted beta work after that

Practical internal split:

- **Phase 14A**: app shell + local-first onboarding
- **Phase 14B**: dashboard + shared UI parity
- hosted mode follows phase 11 / 17 backend readiness

## Chosen product direction

### Shell choice

Use **Tauri + React** for the main app.

Why this is the best fit:

- best aesthetic ceiling across macOS and Windows
- strongest path to a premium macOS feel
- still supports a future shared web UI
- lighter and more native-feeling than Electron
- works well with the current local-first helper model

The TUI remains a fast optional add-on, not the primary experience.

### First-screen choice

Use the **landing-page-style** opening screen.

This should not be a marketing-heavy splash page. It should behave like a
native app chooser with the visual confidence of a product landing page.

When the app opens, the user sees two clear choices:

- **Run locally**
- **Sign in**

Local-first remains the default and most visible path.

### Onboarding choice

Use a **step-by-step wizard**, not a settings wall.

This matches the current TUI setup direction and is easier for first-time
users who need confidence at each stage.

## Visual design direction

Target an **Apple calm + Claude calm** blend.

Design principles:

- warm neutral base canvas, not stark white
- one restrained accent color used intentionally
- serif-forward hero or section headlines, clean sans for UI chrome
- generous spacing and quiet surfaces
- subtle borders instead of loud shadows
- motion only when it helps orientation or progress
- premium but not flashy

Desired feel:

- macOS should feel especially polished
- Windows should still feel clean and solid, just less ornamental
- the app should feel trustworthy enough for users to hand it personal job
  data without feeling like a prototype

## Product structure

### Entry screen

The first screen is a landing-style chooser with two primary cards:

- **Run locally**
  - no account required
  - data stays on this machine
- **Sign in**
  - future hosted/synced path
  - Google / email / other auth options

Supporting line near the bottom:

- local-first privacy reassurance
- short note that switching from local to hosted can come later

### Local-first onboarding wizard

For first-time local users, the app should present a guided setup flow
instead of dropping them into raw configs.

Recommended wizard sequence:

1. Welcome
2. Environment checks
3. Coding agent detection / selection
4. Profile / safe fields
5. Resumes
6. Notifications / Discord
7. Browser extension setup
8. Review + finish

This flow should be the visual equivalent of what the TUI setup and install
process currently do.

### Hosted onboarding later

When hosted mode is ready, it gets its own onboarding path:

1. Sign in
2. Import local data or start fresh
3. Profile
4. Resume upload
5. Preferences
6. Finish

### Main app shell after onboarding

Recommended navigation:

- Home
- Jobs
- Review queue
- History
- Resumes
- Settings
- later: Account / Sync

The shell should feel desktop-native, not like a website trapped inside a
window.

## Architectural plan

### Principle: shared-core-first

Do **not** build a second business-logic layer for the app.

The current codebase already points to the correct architecture:

- Python helpers remain authoritative for state writes
- the TUI is already a rendering/orchestration overlay
- the extension already writes through a bridge into the same helpers

The app should follow the same rule.

### Shared core extraction

Extract a shared TypeScript core from the current TUI-side modules:

- `app/src/state.ts`
- `app/src/helpers.ts`
- `app/src/settings.ts`
- `app/src/platform.ts`
- `app/src/project.ts`

This shared core becomes the common data/action layer for:

- the TUI
- the new app UI
- the future hosted UI mode

### Adapter seam

Define one adapter boundary early:

- `LocalAdapter`
- later `SupabaseAdapter`

Local mode uses the current helper model.

Hosted mode later swaps to Supabase-backed reads/writes without creating a
forked product.

### Keep the Python core authoritative

For local mode:

- the app shells out to the same Python helpers and scripts the TUI uses
- no direct JSON mutation in the React/Tauri app
- no rewritten application engine in TypeScript

That keeps the local app, TUI, and extension behavior aligned.

## What should be reused immediately

Reuse as-is or near as-is:

- state types and read helpers from `app/src/state.ts`
- helper wrappers from `app/src/helpers.ts`
- config/settings access from `app/src/settings.ts`
- Python/runtime resolution from `app/src/platform.ts`
- root detection pattern from `app/src/project.ts`
- onboarding field definitions and validation logic from the current setup
  flow
- local bridge model used by the browser extension

## Screen-by-screen implementation plan

### Step 1: app shell

Build the Tauri shell with:

- calm landing screen
- local/sign-in choice
- native-feeling window chrome and layout

### Step 2: local onboarding wizard

Implement the local-first wizard flow using shared field definitions and
existing helper-backed persistence.

### Step 3: dashboard views

Add the main local screens:

- status/home
- jobs
- review queue
- history
- resumes
- settings

### Step 4: shared-core adoption

Move the TUI onto the same extracted core package so both surfaces stay in
sync.

### Step 5: hosted adapter hookup

Once phase 11/17 work is ready, add sign-in and hosted storage against the
same UI shell.

## Risks and sequencing constraints

### Do not build two products

The app must not become a separate implementation of applyr.

One UI system, one shared core, two storage modes later.

### Hosted mode should not block local mode

The local-first app can and should ship before hosted Supabase-backed mode is
ready.

### The coding agent remains a local dependency in local mode

Until the hosted runner exists, local mode is still a desktop app sitting on
top of local helpers and a local coding agent. That is expected.

### Wizard logic should be shared

If the app wizard and TUI setup drift, maintenance cost rises fast. Shared
field definitions should be extracted early.

## Recommendation

The best path is:

1. extract the shared core first
2. build the Tauri app shell second
3. ship local-first onboarding and dashboard third
4. leave the TUI in place as the fast/power-user option
5. plug hosted auth/storage into the same app later

This gives applyr a real polished front door before beta without throwing
away the current helper discipline or the TUI.
