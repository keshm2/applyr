#!/usr/bin/env python3
"""The single place that knows how each coding agent is invoked.

AGENTS.md "Harness capability matrix": *"the only harness-specific code is
the adapter block in scripts/runtime/run_job_agent.sh (never add harness
branches anywhere else)"*. That rule was easy to honor while `run_job_agent`
was the only thing that launched an agent. Interest-letter generation
(work item #4) needs to launch one too, so rather than grow a second copy of
the argv shapes, the adapter moved here and both callers import it. This
module IS that adapter block — the rule now reads "the only harness-specific
code lives in harness_adapter.py".

Two capability facts drive everything below (see the matrix in AGENTS.md):

  - opencode and Claude Code have a **subagent registry**, so an agent is
    named directly (`--agent <name>` / a generated `.claude/agents/` def).
  - Codex and Copilot have **no registry**, so the agent's body must be
    inlined into the prompt with an explicit "read this file and act as it"
    instruction — the documented inline fallback.

Keeping both shapes here is what makes a new agent work on all four harnesses
by construction instead of by remembering to update four call sites.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess

SUPPORTED = ("opencode", "claude", "codex", "copilot")

# PATH probe order. app/src/harness.ts mirrors this for the Settings
# "Auto (detected and using X)" label — keep the two in sync or the UI will
# name a different agent than the one that actually runs.
DETECT_ORDER = SUPPORTED

# Harnesses with a subagent registry; everything else takes the inline path.
_HAS_REGISTRY = ("opencode", "claude")


def resolve_harness(root: str = ".") -> str:
    """Env override, then config/harness.json, then a PATH probe. Returns ""
    when nothing usable is found (callers report their own error)."""
    harness = os.environ.get("APPLYR_HARNESS", os.environ.get("ARES_HARNESS", "")) or ""
    if not harness:
        cfg = os.path.join(root, "config", "harness.json")
        if os.path.isfile(cfg):
            try:
                with open(cfg, "r", encoding="utf-8") as fh:
                    harness = json.load(fh).get("harness") or ""
            except (OSError, json.JSONDecodeError):
                harness = ""
    if not harness:
        for candidate in DETECT_ORDER:
            if shutil.which(candidate):
                harness = candidate
                break
    return harness if harness in SUPPORTED else ""


def opencode_print_flag(exe: str) -> list:
    """opencode >= 1.17 removed `--print`; probe rather than assume, so both
    the old and new CLI launch (regression from the 2026-07-12 fix)."""
    try:
        help_txt = subprocess.run(
            [exe, "run", "--help"], stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True,
        ).stdout or ""
        if re.search(r"--print([^-0-9A-Za-z]|$)", help_txt):
            return ["--print"]
    except OSError:
        pass
    return []


def inline_preamble(agent: str, delegates: tuple = (), role: str = "agent") -> str:
    """The no-registry fallback: tell the harness to read the agent body and
    act as it. `delegates` names any subagents that body hands off to, which
    must also be inlined (AGENTS.md "Degraded paths").

    `role` exists only to reproduce run_job_agent.py's original wording
    ("the job-scraper orchestrator") byte-for-byte, so extracting this block
    could not quietly change the prompt a live run sends.
    """
    text = (
        f"You are the {agent} {role}. Read agents/bodies/{agent}.md and execute it "
        "exactly as your instructions."
    )
    if delegates:
        joined = " or ".join(f"@{d}" for d in delegates)
        files = " or ".join(f"agents/bodies/{d}.md" for d in delegates)
        text += (
            f" Your harness has no subagent registry: when the workflow delegates to {joined}, "
            f"read {files} and perform that role inline, following it exactly."
        )
    return text


def agent_command(exe: str, harness: str, agent: str, prompt: str,
                  delegates: tuple = (), extra_preamble: str = "",
                  role: str = "agent") -> list:
    """Build the argv that runs `agent` under `harness` with `prompt`.

    `delegates` / `extra_preamble` only affect harnesses without a registry:
    a registry harness gets the agent by name and its generated definition
    already carries the body.
    """
    if harness == "opencode":
        return [exe, "run", "--agent", agent, *opencode_print_flag(exe), prompt]
    if harness == "claude":
        perm = os.environ.get("APPLYR_CLAUDE_PERMISSION_MODE", "bypassPermissions")
        # Claude Code resolves .claude/agents/ defs, but the headless -p entry
        # point doesn't auto-select one, so the body is named explicitly. No
        # delegate inlining here — the registry handles it.
        return [exe, "-p", "--permission-mode", perm,
                inline_preamble(agent, (), role) + " " + prompt]
    # codex / copilot — no registry, inline the body.
    full = inline_preamble(agent, delegates, role)
    if extra_preamble:
        full += " " + extra_preamble
    full += " " + prompt
    if harness == "codex":
        return [exe, "exec", full]
    return [exe, "-p", full, "--allow-all-tools"]


def has_registry(harness: str) -> bool:
    return harness in _HAS_REGISTRY
