#!/usr/bin/env python3
"""generate_agent_definitions.py — harness agent generation (Phase 15).

Single source of truth for agent behavior:

  agents/bodies/<name>.md               the prompt body (harness-neutral)
  agents/frontmatter/opencode/<name>.yaml   opencode frontmatter
  agents/frontmatter/claude/<name>.yaml     Claude Code frontmatter

This script composes them into the per-harness definitions:

  .opencode/agents/<name>.md
  .claude/agents/<name>.md

Never hand-edit the generated files — edit the sources and re-run. Each
generated file carries a GENERATED marker naming its sources. `--check`
regenerates in memory and exits 1 if any generated file is missing or
stale (for CI / pre-run drift detection).

Exit codes: 0 ok; 1 drift found (--check) or usage error.
"""

from __future__ import annotations

import argparse
import os
import sys

HARNESSES = ("opencode", "claude")

MARKER = (
    "<!-- GENERATED from agents/bodies/{name}.md + "
    "agents/frontmatter/{harness}/{name}.yaml — edit those sources and run "
    "scripts/validate/generate_agent_definitions.py -->"
)

OUT_DIRS = {"opencode": ".opencode/agents", "claude": ".claude/agents"}


def compose(root: str, harness: str, name: str) -> str:
    body_path = os.path.join(root, "agents", "bodies", f"{name}.md")
    fm_path = os.path.join(root, "agents", "frontmatter", harness, f"{name}.yaml")
    with open(fm_path, "r", encoding="utf-8") as f:
        frontmatter = f.read().rstrip("\n")
    with open(body_path, "r", encoding="utf-8") as f:
        body = f.read().rstrip("\n")
    marker = MARKER.format(name=name, harness=harness)
    return f"---\n{frontmatter}\n---\n{marker}\n\n{body}\n"


def agent_names(root: str) -> list:
    bodies_dir = os.path.join(root, "agents", "bodies")
    return sorted(
        f[:-3] for f in os.listdir(bodies_dir) if f.endswith(".md")
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="generate_agent_definitions.py")
    parser.add_argument("--root", default=".")
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify generated files match the sources; exit 1 on drift",
    )
    args = parser.parse_args(argv)
    root = args.root

    stale = []
    for name in agent_names(root):
        for harness in HARNESSES:
            fm_path = os.path.join(root, "agents", "frontmatter", harness, f"{name}.yaml")
            if not os.path.exists(fm_path):
                print(
                    f"generate_agent_definitions: ERROR: missing {fm_path}",
                    file=sys.stderr,
                )
                return 1
            content = compose(root, harness, name)
            out_path = os.path.join(root, OUT_DIRS[harness], f"{name}.md")
            if args.check:
                try:
                    with open(out_path, "r", encoding="utf-8") as f:
                        current = f.read()
                except OSError:
                    current = ""
                if current != content:
                    stale.append(out_path)
            else:
                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(content)
                print(f"generate_agent_definitions: wrote {out_path}", file=sys.stderr)

    if args.check:
        if stale:
            print(
                "generate_agent_definitions: STALE (re-run "
                f"scripts/validate/generate_agent_definitions.py): {', '.join(stale)}",
                file=sys.stderr,
            )
            return 1
        print("generate_agent_definitions: check OK", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
