#!/usr/bin/env python3
"""update.py — cross-platform self-updater.

Ported from update.sh so updates work natively on Windows as well as
macOS/Linux, with no curl/tar binary dependency (stdlib urllib + tarfile).
update.sh remains as a thin Unix shim that execs this file.

Compares the local VERSION against upstream main and, when they differ,
updates in place:
  - git checkout:    git pull --ff-only origin main
  - tarball install: download the main tarball and overlay it
Per-user files (live config/*.json, data/ incl. resumes, logs/,
.playwright-mcp/) are gitignored and absent from the tarball, so an
overlay cannot clobber them.

  update.py           # manual, verbose
  update.py --auto    # hook mode: quiet, ALWAYS exits 0 (fail-open)

Result line (always printed, last):
  update: up-to-date <version>
  update: updated <old> -> <new>
  update: check-failed <reason>   (auto mode: exit 0)
  update: failed <reason>         (auto mode: exit 0)

Env overrides: APPLYR_UPDATE_URL, APPLYR_TARBALL_URL.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

VERSION_URL = os.environ.get(
    "APPLYR_UPDATE_URL",
    "https://raw.githubusercontent.com/keshm2/applyr/main/VERSION",
)
TARBALL_URL = os.environ.get(
    "APPLYR_TARBALL_URL",
    "https://codeload.github.com/keshm2/applyr/tar.gz/refs/heads/main",
)


class FailOpen(Exception):
    def __init__(self, line: str):
        self.line = line


def main(argv) -> int:
    auto = argv[:1] == ["--auto"]
    os.chdir(ROOT)

    def say(msg: str) -> None:
        if not auto:
            print(f"update: {msg}")

    def fail_open(line: str) -> "int":
        print(line)
        raise FailOpen(line) if not auto else SystemExit(0)

    try:
        local = ""
        try:
            with open("VERSION", "r", encoding="utf-8") as fh:
                local = fh.read().strip()
        except OSError:
            local = ""
        local = local or "unknown"

        try:
            with urllib.request.urlopen(VERSION_URL, timeout=10) as resp:
                remote = resp.read().decode("utf-8").strip()
        except Exception:
            remote = ""
        if not remote:
            fail_open(f"update: check-failed could not fetch {VERSION_URL}")

        if remote == local:
            print(f"update: up-to-date {local}")
            return 0

        # One updater at a time; reclaim a lock older than 30 min (crashed run).
        os.makedirs("logs", exist_ok=True)
        lock = os.path.join(ROOT, "logs", ".update.lock")
        acquired = False
        try:
            os.mkdir(lock)
            acquired = True
        except FileExistsError:
            try:
                age_min = int((time.time() - os.path.getmtime(lock)) / 60)
            except OSError:
                age_min = 0
            if age_min >= 30:
                say(f"reclaiming stale update lock ({age_min}min old)")
                shutil.rmtree(lock, ignore_errors=True)
            try:
                os.mkdir(lock)
                acquired = True
            except FileExistsError:
                fail_open("update: check-failed another update is in progress")

        try:
            say(f"updating {local} -> {remote} …")
            if os.path.isdir(".git") and shutil.which("git"):
                r = subprocess.run(["git", "pull", "--ff-only", "origin", "main"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if r.returncode != 0:
                    fail_open("update: failed git pull --ff-only (dirty or diverged checkout — resolve manually)")
            else:
                _overlay_tarball(fail_open)

            new = remote
            try:
                with open("VERSION", "r", encoding="utf-8") as fh:
                    new = fh.read().strip() or remote
            except OSError:
                pass

            _post_update(say)
            print(f"update: updated {local} -> {new}")
            return 0
        finally:
            if acquired:
                shutil.rmtree(lock, ignore_errors=True)
    except FailOpen:
        return 1
    except SystemExit as e:
        return int(e.code or 0)


def _overlay_tarball(fail_open) -> None:
    tmp_fd, tmp_tgz = tempfile.mkstemp(suffix=".tar.gz")
    os.close(tmp_fd)
    try:
        try:
            with urllib.request.urlopen(TARBALL_URL, timeout=120) as resp, open(tmp_tgz, "wb") as out:
                shutil.copyfileobj(resp, out)
        except Exception:
            fail_open("update: failed tarball download")

        try:
            with tarfile.open(tmp_tgz, "r:gz") as tar:
                members = []
                for m in tar.getmembers():
                    # strip-components=1: drop the leading "applyr-main/" segment.
                    parts = m.name.split("/", 1)
                    if len(parts) < 2 or not parts[1]:
                        continue
                    rel = parts[1]
                    # Guard against path traversal in a hostile tarball.
                    dest = os.path.normpath(os.path.join(ROOT, rel))
                    if not dest.startswith(os.path.normpath(ROOT) + os.sep):
                        continue
                    m.name = rel
                    members.append(m)
                _safe_extractall(tar, ROOT, members)
        except tarfile.TarError:
            fail_open("update: failed tarball extract")
    finally:
        try:
            os.remove(tmp_tgz)
        except OSError:
            pass


def _safe_extractall(tar, dest_root, members) -> None:
    for m in members:
        target = os.path.join(dest_root, m.name)
        if m.isdir():
            os.makedirs(target, exist_ok=True)
        else:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            src = tar.extractfile(m)
            if src is None:
                continue
            with src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)


def _post_update(say) -> None:
    # Each step warn-only so a hiccup never bricks an already-updated install.
    if subprocess.run([sys.executable, "scripts/validate/generate_agent_definitions.py"],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
        say("WARNING: agent-definition regeneration failed — run scripts/validate/generate_agent_definitions.py")
    if subprocess.run([sys.executable, "scripts/validate/validate_local_config.py"],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
        say("WARNING: config validation reported issues — run scripts/validate/validate_local_config.py")
    npm = shutil.which("npm")
    if npm:
        for rel, label in (("app", "TUI"), ("extension", "browser extension")):
            pkg = os.path.join(ROOT, rel, "package.json")
            if not os.path.isfile(pkg):
                continue
            ok = (
                subprocess.run([npm, "install", "--silent"], cwd=os.path.join(ROOT, rel),
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
                and subprocess.run([npm, "run", "build", "--silent"], cwd=os.path.join(ROOT, rel),
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            )
            if not ok:
                say(f"WARNING: {label} rebuild failed — run: cd {rel} && npm install && npm run build")
    else:
        say("node/npm not found — skipped the TUI and browser-extension rebuilds")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
