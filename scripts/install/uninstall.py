#!/usr/bin/env python3
"""uninstall.py — cross-platform uninstaller.

Ported from uninstall.sh so it runs natively on Windows as well as
macOS/Linux. uninstall.sh remains a thin Unix shim.

  uninstall.py            # interactive (asks before deleting the dir)
  uninstall.py --yes      # no prompts (still prints what it did)
  uninstall.py --keep-data  # remove schedule + command, keep the install dir

Removes, in order:
  1. The schedule (scheduler.py uninstall — launchd/schtasks).
  2. The `applyr` command on PATH — only applyr's own wrapper/shim pointing
     at THIS install.
  3. The install directory (live config, data/ incl. resumes, logs/ — PII),
     only after an explicit confirmation (or --yes).

npm installs: `npm uninstall -g @keshm/applyr` removes the TUI command (a
reminder is printed when one is detected). The npm package never owns the
core directory — this script does.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
IS_WINDOWS = os.name == "nt"


def say(msg: str) -> None:
    print(f"uninstall: {msg}")


def _remove_readonly(func, path, _exc):
    # Windows: clear the read-only bit and retry (git objects are read-only).
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except OSError:
        pass


def _remove_unix_wrapper() -> None:
    bin_dir = os.environ.get("APPLYR_BIN", os.path.join(os.path.expanduser("~"), ".local", "bin"))
    wrapper = os.path.join(bin_dir, "applyr")
    if not os.path.isfile(wrapper):
        return
    try:
        with open(wrapper, "r", encoding="utf-8", errors="ignore") as fh:
            body = fh.read()
    except OSError:
        return
    if "applyr wrapper" not in body:
        return
    if ROOT in body:
        try:
            os.remove(wrapper)
            say(f"removed the applyr command ({wrapper}).")
        except OSError:
            pass
    else:
        say(f"{wrapper} points at a different install — left alone.")


def _remove_windows_wrapper() -> None:
    bin_dir = os.environ.get("APPLYR_BIN", os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "applyr", "bin"))
    for name in ("applyr.cmd", "applyr.ps1"):
        shim = os.path.join(bin_dir, name)
        if not os.path.isfile(shim):
            continue
        try:
            with open(shim, "r", encoding="utf-8", errors="ignore") as fh:
                body = fh.read()
        except OSError:
            continue
        if "applyr wrapper" not in body:
            continue
        if ROOT in body:
            try:
                os.remove(shim)
                say(f"removed the applyr command ({shim}).")
            except OSError:
                pass
        else:
            say(f"{shim} points at a different install — left alone.")


def main(argv) -> int:
    yes = keep_data = False
    for arg in argv:
        if arg in ("--yes", "-y"):
            yes = True
        elif arg == "--keep-data":
            keep_data = True
        else:
            sys.stderr.write(f"uninstall: unknown option: {arg}\n")
            return 1

    os.chdir(ROOT)

    # 1. Schedule.
    scheduler = os.path.join("scripts", "runtime", "scheduler.py")
    if os.path.isfile(scheduler):
        rc = subprocess.run([sys.executable, scheduler, "uninstall"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
        say("removed the schedule." if rc == 0 else "no schedule installed — skipped.")

    # 2. PATH wrapper — only applyr's own, pointing here.
    if IS_WINDOWS:
        _remove_windows_wrapper()
    else:
        _remove_unix_wrapper()

    # npm-installed TUI reminder.
    npm = shutil.which("npm")
    if npm:
        detected = subprocess.run([npm, "ls", "-g", "@keshm/applyr"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if detected:
            say("npm package detected — also run: npm uninstall -g @keshm/applyr")

    # 3. The install directory (PII).
    if keep_data:
        say(f"kept the install directory ({ROOT}) — delete it later manually.")
        say("done.")
        return 0

    if not yes:
        if sys.stdin.isatty():
            print()
            print("About to permanently delete the install directory and EVERYTHING in it:")
            print(f"  {ROOT}")
            print("This includes your live config, application history and resumes (data/), and logs.")
            try:
                reply = input("Delete it? [y/N] ").strip()
            except EOFError:
                reply = ""
            if reply not in ("y", "Y"):
                say(f"kept the install directory ({ROOT}). Re-run with --yes when ready.")
                say("done.")
                return 0
        else:
            say(f"non-interactive and no --yes: keeping the install directory ({ROOT}).")
            say("done.")
            return 0

    os.chdir(os.path.abspath(os.sep))
    shutil.rmtree(ROOT, onerror=_remove_readonly)
    print(f"uninstall: removed {ROOT}. applyr is uninstalled.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
