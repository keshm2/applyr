<#
install.ps1 - native Windows first-run installer (PowerShell).

One command from a fresh machine to a validated, harness-configured setup
that runs natively on PowerShell and cmd.exe - no WSL, no bash, no jq.

  # one-liner (from anywhere):
  irm https://raw.githubusercontent.com/keshm2/ares/main/scripts/install.ps1 | iex
  # or from a clone/unpacked release:
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1

Steps mirror scripts/install.sh:
  0. Bootstrap when piped/outside the repo: download+unpack the source, re-run.
  1. Prereqs: python (py/python); node+npm optional for the TUI.
  2. Copy config/*.example.json to live configs where missing.
  2b. Optional Discord status updates (opt-in).
  3. Detect installed coding agents; write config/harness.json.
  4. Ask for the profile (safe_fields, kept LOCAL ONLY); create resumes/.
  5. Offer .claude/settings.json (headless permissions) when Claude Code present.
  6. Regenerate per-harness agent definitions.
  7. Run the config validator.
  8. Build the TUI (app/) when node is available.
  9. Put the `applyr` command on PATH (applyr.cmd + applyr.ps1 shims).
#>

$ErrorActionPreference = "Stop"

function Say  { param($m) Write-Host "install: $m" }
function Warn { param($m) Write-Host "install: WARNING: $m" -ForegroundColor Yellow }
function Fail { param($m) Write-Host "install: ERROR: $m" -ForegroundColor Red; exit 1 }

function Find-Python {
  foreach ($c in @(@("py","-3"), @("python"), @("python3"))) {
    $exe = $c[0]
    if (Get-Command $exe -ErrorAction SilentlyContinue) {
      try { & $exe @($c[1..($c.Length-1)] + "--version") *> $null; if ($LASTEXITCODE -eq 0) { return ,$c } } catch {}
    }
  }
  return $null
}

# --- 0. Bootstrap ------------------------------------------------------------
$scriptPath = $PSCommandPath
$projectRoot = $null
if ($scriptPath) {
  $maybeRoot = Split-Path -Parent (Split-Path -Parent $scriptPath)
  if (Test-Path (Join-Path $maybeRoot "AGENTS.md")) { $projectRoot = $maybeRoot }
}
if (-not $projectRoot) {
  $target = if ($env:APPLYR_HOME) { $env:APPLYR_HOME } else { Join-Path $HOME "applyr" }
  if (Test-Path (Join-Path $target "AGENTS.md")) {
    Say "existing install found at $target - re-running its installer."
  } else {
    Say "downloading applyr into $target ..."
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $tgz = Join-Path $env:TEMP ("applyr-" + [System.Guid]::NewGuid().ToString() + ".tar.gz")
    Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/keshm2/ares/tar.gz/refs/heads/main" -OutFile $tgz
    # tar.exe ships with Windows 10+; --strip-components drops the top dir.
    & tar.exe -xzf $tgz --strip-components=1 -C $target
    if ($LASTEXITCODE -ne 0) { Fail "failed to unpack the source tarball (needs Windows 10+ tar.exe)" }
    Remove-Item $tgz -ErrorAction SilentlyContinue
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target "scripts\install.ps1")
  exit $LASTEXITCODE
}
Set-Location $projectRoot

# --- 1. Prerequisites --------------------------------------------------------
$py = Find-Python
if (-not $py) { Fail "Python 3 is required. Install from https://www.python.org/ (check 'Add to PATH')." }
function Py { param([string[]]$a) & $py[0] @($py[1..($py.Length-1)] + $a) }

# --- 2. Live configs from examples -------------------------------------------
if (Test-Path "config\targets.json") {
  Say "config/targets.json exists - keeping it."
} else {
  Copy-Item "config\targets.example.json" "config\targets.json"
  Say "created config/targets.json from the example - fill placeholders (or run 'applyr setup')."
}

# --- 2b. Discord (optional, opt-in) ------------------------------------------
$discordLive = "config\discord_config.json"
function Write-DisabledDiscord {
  '{
  "enabled": false,
  "webhooks": {}
}' | Set-Content -Encoding UTF8 $discordLive
}
if (Test-Path $discordLive) {
  Say "$discordLive exists - keeping it."
} else {
  $optIn = Read-Host "Use Discord for status updates (applied / needs-review / failed / summary)? [y/N]"
  if ($optIn -eq "y" -or $optIn -eq "Y") {
    Write-Host ""
    Write-Host "How should the updates be routed?"
    Write-Host "  1) One channel for ALL status updates (one webhook link)"
    Write-Host "  2) Separate channels per status (success / needs-review / failed / summary)"
    Write-Host "!  Separate channels: Discord binds each webhook to ONE channel, so" -ForegroundColor Yellow
    Write-Host "   EACH channel needs its own webhook link (4 links for option 2)." -ForegroundColor Yellow
    $mode = Read-Host "Choose [1/2, default 1]"
    if ($mode -eq "2") {
      $s = Read-Host "  success webhook URL"
      $r = Read-Host "  needs-review webhook URL"
      $f = Read-Host "  failed webhook URL"
      $m = Read-Host "  summary webhook URL (optional, enter to fall back to success)"
    } else {
      $all = Read-Host "  the one shared webhook URL"
      $s = $all; $r = $all; $f = $all; $m = $all
    }
    if ([string]::IsNullOrWhiteSpace($s)) {
      Warn "no webhook URL entered - writing Discord as disabled; enable later with 'applyr setup'."
      Write-DisabledDiscord
    } else {
      $webhooks = [ordered]@{ success = $s; needs_review = $r; failed = $f }
      if (-not [string]::IsNullOrWhiteSpace($m)) { $webhooks["summary"] = $m }
      [ordered]@{ enabled = $true; webhooks = $webhooks } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $discordLive
      Say "wrote $discordLive (Discord enabled)."
    }
  } else {
    Write-DisabledDiscord
    Say "Discord skipped - outcomes stay local (state files + TUI). Enable any time with 'applyr setup'."
  }
}

# --- 3. Harness detection ----------------------------------------------------
$labels = @{
  opencode = "opencode"
  claude   = "Claude Code"
  codex    = "Codex CLI          (API boards only unless browser tooling is configured)"
  copilot  = "GitHub Copilot CLI (API boards only unless browser tooling is configured)"
}
$detected = @()
foreach ($a in @("opencode","claude","codex","copilot")) {
  if (Get-Command $a -ErrorAction SilentlyContinue) { $detected += $a }
}
if ($detected.Count -eq 0) {
  Warn "no supported coding agent found (opencode, claude, codex, or copilot)."
  Warn "install one, then re-run: https://opencode.ai / https://claude.com/claude-code /"
  Warn "  https://developers.openai.com/codex/cli / https://docs.github.com/copilot"
}
if (Test-Path "config\harness.json") {
  Say "config/harness.json exists - keeping it."
} else {
  $harness = ""
  if ($detected.Count -gt 1) {
    Write-Host ""
    Write-Host "Which coding agent should applyr use for runs?"
    for ($i = 0; $i -lt $detected.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i+1), $labels[$detected[$i]]) }
    $choice = Read-Host ("Choose [1-{0}, default 1]" -f $detected.Count)
    $n = 0
    if (-not [int]::TryParse($choice, [ref]$n) -or $n -lt 1 -or $n -gt $detected.Count) { $n = 1 }
    $harness = $detected[$n-1]
  } elseif ($detected.Count -eq 1) {
    $harness = $detected[0]
  }
  if ($harness) {
    [ordered]@{ harness = $harness } | ConvertTo-Json | Set-Content -Encoding UTF8 "config\harness.json"
    Say "wrote config/harness.json (harness: $harness)."
  } else {
    Say "skipped config/harness.json - no supported coding agent detected yet."
  }
}

# --- 4. Profile (safe_fields, LOCAL ONLY) + resumes --------------------------
$targets = Get-Content "config\targets.json" -Raw | ConvertFrom-Json
$firstName = $null
if ($targets.safe_fields) { $firstName = $targets.safe_fields.first_name }
if ((-not $firstName) -or ($firstName -eq "REPLACE_ME")) {
  Write-Host ""
  Write-Host "[lock] Privacy: everything you enter below is kept LOCALLY ONLY." -ForegroundColor Cyan
  Write-Host "       It is written to gitignored files on this machine (config/, resumes/)" -ForegroundColor Cyan
  Write-Host "       and is never committed, uploaded, or shared." -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Your profile - used only to fill application forms (press enter to skip a field):"
  $fields = @(
    @("first_name","First name"), @("last_name","Last name"), @("email","Email"),
    @("phone","Phone"), @("linkedin_url","LinkedIn URL"), @("github_url","GitHub URL"),
    @("graduation_date","Graduation date (Month Year)")
  )
  if (-not $targets.safe_fields) { $targets | Add-Member -NotePropertyName safe_fields -NotePropertyValue ([ordered]@{}) -Force }
  $changed = $false
  foreach ($f in $fields) {
    $val = Read-Host ("  " + $f[1])
    if (-not [string]::IsNullOrWhiteSpace($val)) {
      $targets.safe_fields | Add-Member -NotePropertyName $f[0] -NotePropertyValue $val -Force
      $changed = $true
    }
  }
  if ($changed) {
    $targets | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 "config\targets.json"
    Say "profile written to config/targets.json (gitignored - run 'applyr setup' to edit the rest)."
  } else {
    Say "profile skipped - run 'applyr setup' any time to fill it in."
  }
}
New-Item -ItemType Directory -Force -Path "resumes" | Out-Null
Write-Host ""
Write-Host "[docs] Resumes: drop ALL your resumes as PDFs into" -ForegroundColor Cyan
Write-Host ("       " + (Join-Path $projectRoot "resumes")) -ForegroundColor Cyan
Write-Host "       applyr scans them and converts each to markdown to tailor per job." -ForegroundColor Cyan
Write-Host "       This folder is gitignored - local only." -ForegroundColor Cyan
Write-Host ""

# --- 5. Claude Code headless permissions (opt-in) ----------------------------
if ((Get-Command claude -ErrorAction SilentlyContinue) -and -not (Test-Path ".claude\settings.json")) {
  Write-Host ""
  Write-Host "Claude Code headless runs need pre-approved permissions in .claude/settings.json:"
  Write-Host '  Bash(*), Edit(*), Write(*), Read(*), mcp__playwright__* (repo-local)'
  $mk = Read-Host "Create it now? [y/N]"
  if ($mk -eq "y" -or $mk -eq "Y") {
    New-Item -ItemType Directory -Force -Path ".claude" | Out-Null
    @'
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Edit(*)",
      "Write(*)",
      "Read(*)",
      "mcp__playwright__*"
    ]
  },
  "enableAllProjectMcpServers": true
}
'@ | Set-Content -Encoding UTF8 ".claude\settings.json"
    Say "wrote .claude/settings.json."
  } else {
    Say "skipped .claude/settings.json - headless Claude runs will prompt for permissions."
  }
}

# --- 6. Agent definitions ----------------------------------------------------
Py @("scripts\generate_agent_definitions.py")

# --- 7. Validate -------------------------------------------------------------
Py @("scripts\validate_local_config.py")
if ($LASTEXITCODE -eq 0) {
  Say "config valid."
} else {
  Warn "config not valid yet - edit the files named above (or run 'applyr setup'), then re-run the validator."
}

# --- 8. TUI / extension (optional) -------------------------------------------
function Build-NodeSurface {
  param([string]$Dir, [string]$Label)
  if (-not (Test-Path (Join-Path $Dir "package.json"))) { return }
  if ((Test-Path (Join-Path $Dir "node_modules")) -and (Test-Path (Join-Path $Dir "dist"))) {
    Say "$Label already installed."
    return
  }
  Say "building $Label ($Dir/) ..."
  Push-Location $Dir
  & npm install --silent
  if ($LASTEXITCODE -eq 0) { & npm run build --silent }
  $ok = ($LASTEXITCODE -eq 0)
  Pop-Location
  if ($ok) { Say "$Label ready." } else { Warn "$Label build failed - see docs/SETUP.md." }
}

if (Get-Command npm -ErrorAction SilentlyContinue) {
  Build-NodeSurface "app" "the TUI"
  Build-NodeSurface "extension" "the browser extension"
} else {
  Say "node/npm not found - skipping the optional TUI and browser extension (docs/SETUP.md)."
}

# --- 9. `applyr` command on PATH ---------------------------------------------
$cliJs = Join-Path $projectRoot "app\dist\cli.js"
if ((Test-Path $cliJs) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  $binDir = if ($env:APPLYR_BIN) { $env:APPLYR_BIN } else { Join-Path $env:LOCALAPPDATA "applyr\bin" }
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $cmdShim = Join-Path $binDir "applyr.cmd"
  $ps1Shim = Join-Path $binDir "applyr.ps1"

  $foreign = (Test-Path $cmdShim) -and -not ((Get-Content $cmdShim -Raw -ErrorAction SilentlyContinue) -match "applyr wrapper")
  if ($foreign) {
    Warn "$cmdShim exists and is not applyr's wrapper - leaving it alone."
  } else {
    @"
@echo off
REM applyr wrapper - generated by scripts/install.ps1; safe to delete.
if not defined APPLYR_ROOT set "APPLYR_ROOT=$projectRoot"
node "$projectRoot\app\dist\cli.js" %*
"@ | Set-Content -Encoding ASCII $cmdShim
    @"
# applyr wrapper - generated by scripts/install.ps1; safe to delete.
if (-not `$env:APPLYR_ROOT) { `$env:APPLYR_ROOT = "$projectRoot" }
node "$projectRoot\app\dist\cli.js" @args
"@ | Set-Content -Encoding UTF8 $ps1Shim
    Say "installed the applyr command: $cmdShim"

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (($userPath -split ";") -notcontains $binDir) {
      [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $binDir), "User")
      Warn "added $binDir to your user PATH - open a NEW terminal for `applyr` to resolve."
    }
  }
}

Say "done. Open a new terminal and try: applyr   (updates auto-install; APPLYR_AUTO_UPDATE=0 disables)."
