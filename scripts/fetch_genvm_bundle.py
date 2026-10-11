"""Install the pinned GenVM runner bundle into the toolchain caches.

`genvm-lint` and the direct test runner (`gltest`) both load the same GenVM
archive from a per-user cache. On a cold machine (or a clean CI runner) that
cache is empty and the first run tries to download it itself, sometimes under an
asset name that the release no longer publishes. This script does that one job
explicitly and safely:

  * tries each known asset name for the pinned release,
  * refuses a short or unreadable archive,
  * installs atomically (temp file -> rename), so an interrupted download can
    never poison later test runs.

    python scripts/fetch_genvm_bundle.py
    GENVM_VERSION=v0.3.0-rc7 python scripts/fetch_genvm_bundle.py
"""

from __future__ import annotations

import os
import pathlib
import shutil
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

VERSION = "v0.3.0-rc7"
ASSETS = ("genvm-runners-all.tar.xz", "genvm-universal.tar.xz")
RELEASES = "https://github.com/genlayerlabs/genvm/releases/download"
HOME = pathlib.Path.home() / ".cache"
CACHES = (HOME / "genvm-linter", HOME / "gltest-direct")
MIN_BYTES = 50 * 1024 * 1024


def cache_paths(version: str) -> list[pathlib.Path]:
    return [c / f"genvm-universal-{version}.tar.xz" for c in CACHES]


def readable(path: pathlib.Path) -> bool:
    """A complete, openable xz archive of plausible size."""
    if not path.exists() or path.stat().st_size < MIN_BYTES:
        return False
    try:
        with tarfile.open(path, "r:xz") as archive:
            for _ in range(5):
                if archive.next() is None:
                    break
        return True
    except (tarfile.TarError, OSError, EOFError):
        return False


def download(version: str, target: pathlib.Path) -> None:
    last: Exception | None = None
    for asset in ASSETS:
        url = f"{RELEASES}/{version}/{asset}"
        print(f"fetching {url}")
        request = urllib.request.Request(url, headers={"User-Agent": "falk-contract-tests"})
        try:
            with urllib.request.urlopen(request, timeout=600) as response, target.open("wb") as out:
                expected = int(response.headers.get("Content-Length") or 0)
                copied = 0
                while chunk := response.read(1 << 20):
                    out.write(chunk)
                    copied += len(chunk)
            if expected and copied != expected:
                raise OSError(f"short read: {copied} of {expected} bytes")
            return
        except urllib.error.HTTPError as err:
            if err.code != 404:
                raise
            print(f"  not published under that name ({err.code})")
            last = err
    raise SystemExit(f"no GenVM bundle for {version}; last error: {last}")


def main() -> int:
    version = os.environ.get("GENVM_VERSION") or VERSION
    targets = cache_paths(version)
    if all(readable(p) for p in targets):
        print(f"GenVM {version} is already cached and complete")
        return 0
    for p in targets:
        if p.exists() and not readable(p):
            print(f"removing incomplete cache entry {p}")
            p.unlink()
    with tempfile.TemporaryDirectory() as tmp:
        staged = pathlib.Path(tmp) / "bundle.tar.xz"
        download(version, staged)
        if not readable(staged):
            raise SystemExit("downloaded bundle is not a readable archive")
        for i, p in enumerate(targets):
            p.parent.mkdir(parents=True, exist_ok=True)
            partial = p.with_suffix(".partial")
            shutil.copy2(staged, partial)
            partial.replace(p)
            print(f"installed {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
