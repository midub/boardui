#!/usr/bin/env python3
"""Fetches the IPC-2581 Consortium's test cases into this directory (README.md).

The consortium publishes no licence for them, so the repository only links to them. For each
file in sources.json, this downloads the archive from ipc2581.com, extracts the member, applies
the listed normalization, checks size and SHA-256, and writes the file next to this script. Run
from any directory:

    python3 spec/samples/ipc-testcases/fetch.py

Files that are already there with the right hash are skipped. Any other mismatch is an error:
a downloaded file that doesn't match the manifest, or a file here that differs from it (delete
it, or pass --force to replace it). The archives are downloaded to a temporary file and not
kept. The script only uses the standard library.
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "sources.json"
USER_AGENT = "boardui-fetch (+https://github.com/midub/boardui)"
ATTEMPTS = 3


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def download(url, to):
    """Downloads `url` into the open binary file `to`, retrying network errors."""
    for attempt in range(1, ATTEMPTS + 1):
        to.seek(0)
        to.truncate()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                shutil.copyfileobj(response, to)
            return
        except OSError as e:
            if attempt == ATTEMPTS:
                raise
            print(f"  {e}; retrying", file=sys.stderr)
            time.sleep(5 * attempt)


def normalize(data, how):
    if how == "crlf-to-lf":
        return data.replace(b"\r\n", b"\n")
    if how == "none":
        return data
    raise ValueError(f"unknown normalization {how!r}")


def fetch(entry):
    """Returns the file's content from the consortium archive, checked against the manifest."""
    with tempfile.TemporaryFile() as archive:
        download(entry["url"], archive)
        with zipfile.ZipFile(archive) as z:
            data = normalize(z.read(entry["member"]), entry["normalize"])
    if len(data) != entry["size"] or sha256(data) != entry["sha256"]:
        raise SystemExit(
            f"error: {entry['member']} in {entry['url']} does not match sources.json:\n"
            f"  expected {entry['size']} bytes, SHA-256 {entry['sha256']}\n"
            f"  got      {len(data)} bytes, SHA-256 {sha256(data)}\n"
            "The consortium may have changed the archive; don't update the manifest without "
            "checking that the expected outputs (spec/samples/expected) still hold."
        )
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--force", action="store_true", help="replace files here that don't match the manifest"
    )
    args = parser.parse_args()
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]
    for entry in entries:
        path = HERE / entry["file"]
        if path.exists():
            if sha256(path.read_bytes()) == entry["sha256"]:
                print(f"{entry['file']}: present")
                continue
            if not args.force:
                raise SystemExit(
                    f"error: {path} does not match sources.json (SHA-256 {entry['sha256']}); "
                    "delete it, or rerun with --force"
                )
        print(f"{entry['file']}: fetching {entry['url']}")
        data = fetch(entry)
        part = path.with_name(path.name + ".part")
        part.write_bytes(data)
        os.replace(part, path)
    print(f"{len(entries)} IPC consortium test cases in {HERE}")


if __name__ == "__main__":
    main()
