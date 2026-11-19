"""The Pocket session key, kept in the macOS login Keychain.

The recorder accepts exactly one key, chosen at pairing time. Every Mac that
talks to it needs that same key, so it is stored per Mac and moved between
Macs with `pocket key export` / `pocket key import`. It never goes in git.
POCKET_KEY in the environment overrides the Keychain.
"""

from __future__ import annotations

import os
import re
import subprocess

SERVICE = "heypocket"
ACCOUNT = "session-key"
KEY_RE = re.compile(r"^[A-Za-z0-9]{8,64}$")


class KeyStoreError(Exception):
    pass


def validate(key: str) -> str:
    key = key.strip()
    if not KEY_RE.match(key):
        raise KeyStoreError("That does not look like a Pocket key (expected 8-64 letters/digits).")
    return key


def load() -> str:
    env = os.environ.get("POCKET_KEY")
    if env:
        return validate(env)
    key = stored()
    if key is None:
        raise KeyStoreError(
            "No Pocket key on this Mac. Run `pocket pair` for a new/reset device, "
            "or `pocket key import` with the key from your other Mac.")
    return key


def stored() -> str | None:
    r = subprocess.run(
        ["security", "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
        capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return validate(r.stdout)


def save(key: str) -> None:
    key = validate(key)
    r = subprocess.run(
        ["security", "add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT,
         "-l", "HeyPocket session key", "-w", key],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise KeyStoreError(f"Could not save the key to Keychain: {r.stderr.strip()}")


def forget() -> bool:
    r = subprocess.run(
        ["security", "delete-generic-password", "-s", SERVICE, "-a", ACCOUNT],
        capture_output=True, text=True)
    return r.returncode == 0


def masked(key: str) -> str:
    return key[:2] + "*" * (len(key) - 4) + key[-2:]
