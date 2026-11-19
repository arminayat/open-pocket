"""`pocket` command line.

Status and progress go to stderr. Paths of finished recordings go to stdout,
one per line, so other tools can consume them:

    pocket record | xargs -n1 some-transcriber
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import secrets
import shlex
import signal
import string
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from pocket import __version__, device, keystore
from pocket.device import PocketError

DEFAULT_DIR = Path.home() / "Library" / "Application Support" / "heypocket" / "recordings"
TAIL_S = 0.4  # audio keeps arriving briefly after STO


def say(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def stamp() -> str:
    return dt.datetime.now().strftime("%H:%M:%S")


def out_dir(args) -> Path:
    d = Path(args.out or os.environ.get("POCKET_DIR") or DEFAULT_DIR).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    return d


class Recording:
    """One MP3 file from the live stream, plus a JSON sidecar."""

    def __init__(self, directory: Path, origin: str, mode: str):
        name = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        for n in range(1, 100):
            self.path = directory / (f"{name}.mp3" if n == 1 else f"{name}-{n}.mp3")
            try:
                self._f = open(self.path, "xb")
                break
            except FileExistsError:
                continue
        else:
            raise PocketError(f"Too many recordings named {name} in {directory}")
        self.meta = {"origin": origin, "mode": mode,
                     "started": dt.datetime.now().astimezone().isoformat(timespec="seconds")}
        self.bytes = 0
        self.chunks = 0
        self._t0 = time.monotonic()
        self._first_audio: Optional[float] = None
        self.events: list = []
        self.closed = False

    def write(self, data: bytes) -> None:
        if self._first_audio is None:
            self._first_audio = time.monotonic() - self._t0
        self._f.write(data)
        self.bytes += len(data)
        self.chunks += 1

    def event(self, text: str) -> None:
        self.events.append({"t": round(time.monotonic() - self._t0, 3), "msg": text})
        if text.startswith("MCU&STA&") and "device_ts" not in self.meta:
            self.meta["device_ts"] = text[len("MCU&STA&"):]

    def close(self, **extra) -> Path:
        self.closed = True
        self._f.close()
        self.meta.update(
            seconds=round(time.monotonic() - self._t0, 2),
            bytes=self.bytes, chunks=self.chunks,
            first_audio_s=None if self._first_audio is None else round(self._first_audio, 3),
            events=self.events, **extra)
        self.path.with_suffix(".json").write_text(json.dumps(self.meta, indent=1))
        return self.path


def on_sigint(loop: asyncio.AbstractEventLoop, event: asyncio.Event) -> None:
    loop.add_signal_handler(signal.SIGINT, event.set)
    loop.add_signal_handler(signal.SIGTERM, event.set)


async def wait_any(*events: asyncio.Event, timeout: Optional[float] = None) -> None:
    tasks = [asyncio.ensure_future(e.wait()) for e in events]
    try:
        await asyncio.wait(tasks, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()


async def ensure_normal(pocket: device.Pocket, allow_call: bool, wait_s: float = 60.0) -> str:
    mode = await pocket.switch()
    if mode == "normal" or allow_call:
        return mode
    say(f"The side switch is in {mode} mode (contact mic, not voice). "
        f"Slide it to normal mode; waiting up to {wait_s:.0f} s ...")
    await pocket.wait_for("MCU&REC&CON", wait_s)
    return "normal"


# -- commands ---------------------------------------------------------------

async def cmd_status(args) -> int:
    async with device.connect(keystore.load(), args.timeout) as p:
        print(f"device    {p.name}")
        print(f"switch    {await p.switch()}")
        print(f"battery   {await p.battery()}%")
        print(f"firmware  {await p.firmware()}")
        print(f"storage   {await p.space()}")
    return 0


async def cmd_record(args) -> int:
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    on_sigint(loop, stop)
    async with device.connect(keystore.load(), args.timeout) as p:
        mode = await ensure_normal(p, args.allow_call)
        rec = Recording(out_dir(args), origin="mac", mode=mode)
        device_stopped = asyncio.Event()

        def on_event(text: str) -> None:
            rec.event(text)
            if text.startswith("MCU&STO"):
                device_stopped.set()

        p.on_event = on_event
        p.on_audio = rec.write
        await p.start_recording()
        limit = f" (max {args.seconds:g} s)" if args.seconds else ""
        say(f"Recording from {p.name}{limit}. Press Enter, the side button, or Ctrl+C to stop.")
        if sys.stdin.isatty():
            threading.Thread(
                target=lambda: (sys.stdin.readline(), loop.call_soon_threadsafe(stop.set)),
                daemon=True).start()
        await wait_any(stop, device_stopped, timeout=args.seconds or None)
        if not device_stopped.is_set():
            try:
                await p.stop_recording()
            except PocketError as e:
                say(f"warning: {e}")
        await asyncio.sleep(TAIL_S)
        p.on_audio = None
    path = rec.close()
    say(f"Saved {rec.meta['seconds']:.1f} s, {rec.bytes} bytes.")
    if rec.bytes == 0:
        say("warning: no audio arrived.")
    print(path, flush=True)
    return 0


async def run_hook(cmd: str, path: Path) -> None:
    argv = shlex.split(cmd) + [str(path)]
    try:
        proc = await asyncio.create_subprocess_exec(*argv)
        code = await proc.wait()
    except OSError as e:
        say(f"{stamp()} --exec failed to start: {e}")
        return
    if code != 0:
        say(f"{stamp()} --exec exited with {code} for {path.name}")


async def cmd_listen(args) -> int:
    """Stay connected. Every side-button recording becomes a file."""
    loop = asyncio.get_running_loop()
    quit_ = asyncio.Event()
    on_sigint(loop, quit_)
    key = keystore.load()
    directory = out_dir(args)
    hooks: set = set()

    while not quit_.is_set():
        gone = asyncio.Event()
        state = {"rec": None, "mode": "?"}

        def finish(rec: Optional[Recording], reason: str) -> None:
            if rec is None or rec.closed:
                return
            if state["rec"] is rec:
                state["rec"] = None
            path = rec.close(ended=reason)
            say(f"{stamp()} saved {path.name} ({rec.meta['seconds']:.1f} s, {rec.meta['mode']} mode)")
            print(path, flush=True)
            if not args.exec:
                return
            if rec.meta["mode"] != "normal":
                say(f"{stamp()} not running --exec: recorded in {rec.meta['mode']} mode, not voice")
                return
            task = loop.create_task(run_hook(args.exec, path))
            hooks.add(task)
            task.add_done_callback(hooks.discard)

        def on_event(text: str) -> None:
            if state["rec"] is not None:
                state["rec"].event(text)
            if text.startswith("MCU&REC&"):
                state["mode"] = device.switch_name(text)
            elif text.startswith("MCU&STA"):
                finish(state["rec"], "restarted")
                state["rec"] = rec = Recording(directory, origin="button", mode=state["mode"])
                rec.event(text)
                say(f"{stamp()} recording ({state['mode']} mode) ...")
                if state["mode"] == "call":
                    say(f"{stamp()} warning: call mode is the contact mic; slide to normal for voice")
            elif text.startswith("MCU&STO"):
                loop.call_later(TAIL_S, finish, state["rec"], "button")

        def on_audio(data: bytes) -> None:
            if state["rec"] is not None:
                state["rec"].write(data)

        try:
            async with device.connect(key, args.timeout, on_disconnect=gone.set) as p:
                state["mode"] = await p.switch()
                p.on_event, p.on_audio = on_event, on_audio
                say(f"{stamp()} connected to {p.name} ({state['mode']} mode, "
                    f"battery {await p.battery()}%). Press the side button to record. Ctrl+C quits.")
                await wait_any(quit_, gone)
                if state["rec"] is not None and quit_.is_set() and not gone.is_set():
                    try:
                        await p.stop_recording()
                    except PocketError:
                        pass
                    await asyncio.sleep(TAIL_S)
        except PocketError as e:
            say(f"{stamp()} {e}")
        except Exception as e:  # noqa: BLE001 - BLE stacks raise many types; keep listening
            say(f"{stamp()} link error: {type(e).__name__}: {e}")
        finish(state["rec"], "disconnected" if not quit_.is_set() else "quit")
        if not quit_.is_set():
            say(f"{stamp()} disconnected; reconnecting ...")
            await wait_any(quit_, timeout=3)

    if hooks:
        await asyncio.wait(hooks, timeout=60)
    return 0


async def cmd_pair(args) -> int:
    if keystore.stored() and not args.force:
        say("This Mac already has a Pocket key. If the device is already paired, you are done "
            "(try `pocket status`). To pair a reset device with a new key, use --force.")
        return 1
    key = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(16))
    # Save first: once the device takes a key it refuses all others until reset.
    keystore.save(key)
    say(f"New key {keystore.masked(key)} saved to Keychain.")
    await device.pair(key, say, args.timeout)
    say("Paired. Clock set. Try `pocket status`.")
    return 0


def cmd_key(args) -> int:
    if args.action == "import":
        src = open(args.file) if args.file and args.file != "-" else sys.stdin
        if src is sys.stdin and sys.stdin.isatty():
            say("Paste the key and press Enter:")
        keystore.save(src.readline())
        say("Key saved to Keychain.")
    elif args.action == "export":
        print(keystore.load())
    elif args.action == "show":
        key = keystore.stored()
        say(f"Keychain: {keystore.masked(key)}" if key else "No key in Keychain.")
    elif args.action == "forget":
        say("Key removed from Keychain." if keystore.forget() else "No key in Keychain.")
    return 0


# -- entry point --------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="pocket", description="Use a HeyPocket recorder from your Mac.")
    ap.add_argument("--version", action="version", version=f"pocket {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def with_ble(p):
        p.add_argument("--timeout", type=float, default=15.0, help="seconds to search for the Pocket")
        return p

    def with_out(p):
        p.add_argument("-o", "--out", help=f"recordings folder (default: $POCKET_DIR or {DEFAULT_DIR})")
        return p

    with_ble(sub.add_parser("status", help="battery, switch position, firmware, storage"))

    p = with_out(with_ble(sub.add_parser("record", help="record from the Mac until Enter / side button")))
    p.add_argument("-s", "--seconds", type=float, help="stop after this many seconds")
    p.add_argument("--allow-call", action="store_true", help="record even in call (contact mic) mode")

    p = with_out(with_ble(sub.add_parser("listen", help="stay connected; each side-button recording is saved")))
    p.add_argument("--exec", metavar="CMD", help="run CMD <file.mp3> after each normal-mode recording")

    p = with_ble(sub.add_parser("dictate", help="press, talk, press: OpenWhispr transcribes and pastes"))
    p.add_argument("--hotkey", default="cmd+shift+.", help="OpenWhispr's dictation hotkey (default: cmd+shift+.)")
    p.add_argument("--device", help="virtual microphone to route through (default: Pocket Mic, else BlackHole 2ch)")

    p = with_ble(sub.add_parser("pair", help="pair a new or reset Pocket with a fresh key"))
    p.add_argument("--force", action="store_true", help="replace the key already on this Mac")

    p = sub.add_parser("key", help="manage the session key in Keychain (move it between Macs)")
    p.add_argument("action", choices=["import", "export", "show", "forget"])
    p.add_argument("file", nargs="?", help="for import: file with the key (default: stdin)")
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "key":
            return cmd_key(args)
        if args.cmd == "dictate":
            from pocket import dictate
            try:
                return asyncio.run(dictate.run(args))
            except dictate.SetupError as e:
                say(f"error: {e}")
                return 3
        handler = {"status": cmd_status, "record": cmd_record,
                   "listen": cmd_listen, "pair": cmd_pair}[args.cmd]
        return asyncio.run(handler(args))
    except (PocketError, keystore.KeyStoreError) as e:
        say(f"error: {e}")
        return 2
    except KeyboardInterrupt:
        return 130
