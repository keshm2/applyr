#!/usr/bin/env python3
"""Draft an interest letter for one parked job, via the @interest-letter agent.

Usage:  python3 scripts/runtime/generate_interest_letter.py <job_key> [--resume <stem>]

Reads the parked request from the interest-letter store, builds the agent's
input, runs it under whichever coding agent is configured (through the shared
harness_adapter — the only place allowed to branch per harness), parses the
one-JSON-object contract back, and saves the result as a DRAFT.

Deliberately saves a draft, never an approval: the whole justification for
letting a model draft a job-application answer is that a human reads it
before it is submitted. Approval is a separate, explicit user action in the
TUI. This script must never call `approve`.

Exit codes:  0 draft saved · 2 unusable (no request / no harness / bad output)
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness_adapter  # noqa: E402

HARNESS_TIMEOUT_S = 240

# Never sent to the model. The agent body forbids using demographics in a
# letter; not putting them in the prompt at all is the version that holds
# even if the body is edited or the model ignores it.
_EXCLUDED_PROFILE_KEYS = {
    "gender", "ethnicity", "hispanic_or_latino", "date_of_birth",
    "address_line1", "address_line2", "zip_code",
}


def _read_json(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return default


def _pick_resume(root: str, stem: str | None) -> str:
    """Resume markdown to ground the letter in. Prefers an explicit stem,
    then the balanced resume, then whatever exists — an empty string is
    tolerable (the agent returns an empty letter rather than inventing)."""
    resumes = os.path.join(root, "data", "resumes")
    candidates = []
    if stem:
        candidates.append(os.path.join(resumes, f"{stem}.md"))
    candidates.append(os.path.join(resumes, "base_resume_balanced.md"))
    candidates.extend(sorted(glob.glob(os.path.join(resumes, "*.md"))))
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    return fh.read()
            except OSError:
                continue
    return ""


def _extract_json_object(text: str) -> dict | None:
    """Pull the agent's JSON object out of a transcript.

    A headless CLI wraps model output in banners/ANSI, and models add stray
    prose despite instructions — so scan for the last balanced {...} that
    parses and carries a "letter" key, rather than trusting the whole stdout
    to be JSON.
    """
    best = None
    for start in (i for i, c in enumerate(text) if c == "{"):
        depth = 0
        for end in range(start, len(text)):
            if text[end] == "{":
                depth += 1
            elif text[end] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start:end + 1])
                    except json.JSONDecodeError:
                        break
                    if isinstance(obj, dict) and "letter" in obj:
                        best = obj
                    break
    return best


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("job_key")
    ap.add_argument("--resume", default=None, help="resume stem, e.g. base_resume_swe")
    ap.add_argument("--root", default=os.environ.get("APPLYR_ROOT", "."))
    args = ap.parse_args(argv)
    root = os.path.abspath(args.root)

    store = os.path.join(root, "data", "interest_letters.json")
    record = next((r for r in _read_json(store, []) if r.get("job_key") == args.job_key), None)
    if record is None:
        print(json.dumps({"ok": False, "error": f"no parked request for {args.job_key}"}))
        return 2

    harness = harness_adapter.resolve_harness(root)
    if not harness:
        print(json.dumps({"ok": False, "error": "no supported coding agent found "
                                                "(opencode, claude, codex, copilot)"}))
        return 2

    targets = _read_json(os.path.join(root, "config", "targets.json"), {})
    profile = {k: v for k, v in (targets.get("safe_fields") or {}).items()
               if k not in _EXCLUDED_PROFILE_KEYS and isinstance(v, str) and v
               and v != "REPLACE_ME"}

    payload = {
        "company": record.get("company", ""),
        "title": record.get("title", ""),
        "question": record.get("question", ""),
        "jd_excerpt": record.get("jd_excerpt", ""),
        "resume_markdown": _pick_resume(root, args.resume),
        "profile": profile,
        "word_limit": record.get("word_limit") or 150,
    }
    prompt = (
        "Draft the interest letter for this application. Input JSON follows. "
        "Reply with ONE JSON object {\"letter\", \"word_count\"} and nothing else.\n"
        + json.dumps(payload)
    )

    import shutil
    exe = shutil.which(harness) or harness
    cmd = harness_adapter.agent_command(exe, harness, "interest-letter", prompt)
    try:
        p = subprocess.run(cmd, cwd=root, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, text=True, timeout=HARNESS_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": f"{harness} timed out after {HARNESS_TIMEOUT_S}s"}))
        return 2
    except OSError as exc:
        print(json.dumps({"ok": False, "error": f"could not launch {harness}: {exc}"}))
        return 2

    obj = _extract_json_object(p.stdout or "")
    if obj is None:
        print(json.dumps({"ok": False, "harness": harness, "rc": p.returncode,
                          "error": "agent did not return the {\"letter\"} JSON contract"}))
        return 2
    letter = str(obj.get("letter") or "").strip()
    if not letter:
        # The agent is explicitly allowed to decline when the resume/JD give
        # it too little to answer honestly. Surface that as its own outcome —
        # it is not a failure, and the user can still write their own.
        print(json.dumps({"ok": True, "harness": harness, "declined": True,
                          "note": "agent returned an empty letter (insufficient grounding); "
                                  "write your own or add a resume"}))
        return 0

    saved = subprocess.run(
        [sys.executable, os.path.join(root, "scripts", "state", "interest_letter.py"),
         "--store", store, "save-draft", args.job_key, "-"],
        input=letter, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if saved.returncode != 0:
        print(json.dumps({"ok": False, "error": f"could not save draft: {saved.stdout.strip()}"}))
        return 2
    print(json.dumps({"ok": True, "harness": harness, "job_key": args.job_key,
                      "chars": len(letter), "words": len(letter.split()), "status": "draft"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
