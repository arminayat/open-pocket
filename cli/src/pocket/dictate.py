"""Press, talk, press: the Pocket becomes OpenWhispr's microphone.

OpenWhispr (set to the system default microphone) records whatever macOS's
default input is. On each side-button press this module:

  1. switches the default input to a virtual device (BlackHole),
  2. sends OpenWhispr's hotkey so it starts recording,
  3. decodes the Pocket's live MP3 stream with ffmpeg and plays it into BlackHole,

and on the next press it lets the audio drain, sends the hotkey again so
OpenWhispr transcribes, cleans up and pastes as usual, then restores the input.
OpenWhispr writes its normal dictation row, so usage stats keep working.

Needs: brew install blackhole-2ch ffmpeg switchaudio-osx
"""

from __future__ import annotations

import asyncio
import datetime as dt
import re
import shutil
import signal
import subprocess
from pathlib import Path
from typing import Optional

from pocket import device, keystore
from pocket.device import PocketError

VIRTUAL_MICS = ("Pocket Mic", "BlackHole 2ch")   # ours first (driver/), BlackHole as fallback
STATE_FILE = Path.home() / "Library" / "Application Support" / "heypocket" / "restore-input"
TAIL_S = 0.4         # audio that still arrives after STO
SETTLE_S = 0.15      # let CoreAudio apply the input switch before OpenWhispr opens the mic
MIC_OPEN_S = 0.35    # OpenWhispr needs a moment after the hotkey to open the mic
DRAIN_TIMEOUT_S = 5.0

KEY_CODES = {".": 47, ",": 43, "/": 44, ";": 41, "space": 49, "return": 36}
MODIFIERS = {"cmd": "command down", "command": "command down", "shift": "shift down",
             "alt": "option down", "option": "option down", "ctrl": "control down",
             "control": "control down"}


class SetupError(Exception):
    pass


def say(msg: str) -> None:
    import sys
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} {msg}", file=sys.stderr, flush=True)


# -- macOS audio input ------------------------------------------------------------

def _switch(*args: str) -> str:
    r = subprocess.run(["SwitchAudioSource", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise SetupError(f"SwitchAudioSource {' '.join(args)} failed: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout.strip()


def current_input() -> str:
    return _switch("-c", "-t", "input")


def set_input(name: str) -> None:
    _switch("-t", "input", "-s", name)


def inputs() -> list:
    return _switch("-a", "-t", "input").splitlines()


class InputSwitch:
    """Default-input switching that survives crashes: the device to go back to
    is written to disk first, and a leftover file is honoured on the next start."""

    def __init__(self, virtual: str):
        self.virtual = virtual
        self.active = False

    def recover(self) -> None:
        if STATE_FILE.exists():
            previous = STATE_FILE.read_text().strip()
            if previous and current_input() == self.virtual:
                say(f"Restoring default input to {previous} (left over from a previous run).")
                set_input(previous)
            STATE_FILE.unlink()

    def engage(self) -> None:
        previous = current_input()
        if previous != self.virtual:
            STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            STATE_FILE.write_text(previous)
            set_input(self.virtual)
        self.active = True

    def release(self) -> None:
        if not self.active:
            return
        self.active = False
        if STATE_FILE.exists():
            previous = STATE_FILE.read_text().strip()
            if previous:
                set_input(previous)
            STATE_FILE.unlink()


# -- hotkey -------------------------------------------------------------------

def hotkey_script(spec: str) -> str:
    """'cmd+shift+.' -> AppleScript keystroke."""
    parts = [p.strip().lower() for p in spec.split("+") if p.strip()]
    key, mods = parts[-1], parts[:-1]
    try:
        using = ", ".join(MODIFIERS[m] for m in mods)
    except KeyError as e:
        raise SetupError(f"Unknown modifier {e} in hotkey {spec!r}") from None
    if key in KEY_CODES:
        press = f"key code {KEY_CODES[key]}"
    elif len(key) == 1:
        press = f'keystroke "{key}"'
    else:
        raise SetupError(f"Unknown key {key!r} in hotkey {spec!r}")
    return f'tell application "System Events" to {press}' + (f" using {{{using}}}" if using else "")


def can_send_keys() -> bool:
    r = subprocess.run(
        ["osascript", "-e", 'tell application "System Events" to return UI elements enabled'],
        capture_output=True, text=True)
    return r.stdout.strip() == "true"


async def press_hotkey(script: str) -> None:
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise SetupError(
            f"Could not send the hotkey ({err.decode().strip()}). Allow the app you run pocket in "
            "under System Settings > Privacy & Security > Accessibility, or use Terminal.app.")


# -- audio player -------------------------------------------------------------

def output_index(name: str) -> int:
    """ffmpeg's audiotoolbox index for an output device."""
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-f", "lavfi", "-i", "anullsrc", "-t", "0",
         "-f", "audiotoolbox", "-list_devices", "true", "-"],
        capture_output=True, text=True)
    for line in r.stderr.splitlines():
        m = re.search(r"\[(\d+)\]\s+(.+?),\s", line)
        if m and m.group(2).strip() == name:
            return int(m.group(1))
    raise SetupError(f"ffmpeg cannot see an output device named {name!r}. Is BlackHole installed?")


class Player:
    """MP3 chunks in, audio out to the virtual device, with minimal buffering."""

    def __init__(self, index: int):
        self.index = index
        self.proc: Optional[asyncio.subprocess.Process] = None

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "32", "-analyzeduration", "0",
            "-f", "mp3", "-i", "pipe:0",
            "-ac", "2", "-ar", "48000",
            "-f", "audiotoolbox", "-audio_device_index", str(self.index), "-",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL)

    def feed(self, data: bytes) -> None:
        if self.proc and self.proc.stdin and not self.proc.stdin.is_closing():
            self.proc.stdin.write(data)

    async def finish(self) -> None:
        """Close input and wait until everything has been played."""
        if not self.proc:
            return
        proc, self.proc = self.proc, None
        try:
            if proc.stdin and not proc.stdin.is_closing():
                await proc.stdin.drain()
                proc.stdin.close()
            await asyncio.wait_for(proc.wait(), DRAIN_TIMEOUT_S)
        except (asyncio.TimeoutError, ConnectionError, BrokenPipeError):
            proc.kill()


# -- the loop -------------------------------------------------------------------

def pick_virtual(requested: Optional[str]) -> str:
    available = inputs()
    if requested:
        if requested not in available:
            raise SetupError(f"No input device named {requested!r}.")
        return requested
    for name in VIRTUAL_MICS:
        if name in available:
            return name
    raise SetupError("No virtual microphone found. Install Pocket Mic (driver/install.sh) "
                     "or BlackHole (brew install blackhole-2ch).")


def check_setup(requested: Optional[str]) -> "tuple[str, int]":
    missing = [t for t in ("ffmpeg", "SwitchAudioSource") if shutil.which(t) is None]
    if missing:
        raise SetupError(f"Missing {', '.join(missing)}. Run: brew install ffmpeg switchaudio-osx")
    virtual = pick_virtual(requested)
    return virtual, output_index(virtual)


async def run(args) -> int:
    virtual, index = check_setup(args.device)
    say(f"Using {virtual} as the virtual microphone.")
    script = hotkey_script(args.hotkey)
    switch = InputSwitch(virtual)
    switch.recover()
    if not can_send_keys():
        raise SetupError(
            "This app isn't allowed to send keystrokes, which pocket needs to press OpenWhispr's "
            "hotkey. Run pocket in Terminal.app, or allow this app under System Settings > "
            "Privacy & Security > Accessibility (remove and re-add it if it's already on).")

    loop = asyncio.get_running_loop()
    quit_ = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, quit_.set)

    key = keystore.load()
    queue: asyncio.Queue = asyncio.Queue()   # "start" / "stop", processed in order
    # talking: between the start and stop press. live: the player is running and
    # gets chunks directly; before that they are buffered so the first words
    # survive the time OpenWhispr takes to open its microphone.
    state = {"mode": "?", "talking": False, "live": False, "buf": [], "pocket": None}
    player = Player(index)

    async def start() -> None:
        switch.engage()
        await asyncio.sleep(SETTLE_S)
        await press_hotkey(script)
        await asyncio.sleep(MIC_OPEN_S)
        await player.start()
        for chunk in state["buf"]:
            player.feed(chunk)
        state["buf"], state["live"] = [], True
        say("Listening ... press the side button again when you're done.")

    async def stop(reason: str) -> None:
        if not state["talking"]:
            return
        await asyncio.sleep(TAIL_S)
        state["talking"] = state["live"] = False
        state["buf"] = []
        await player.finish()
        await press_hotkey(script)
        await asyncio.sleep(0.3)
        switch.release()
        say(f"Sent to OpenWhispr ({reason}).")

    async def worker() -> None:
        while True:
            item = await queue.get()
            try:
                if item == "start":
                    await start()
                else:
                    await stop(item)
            except Exception as e:  # noqa: BLE001 - never leave the input switched
                say(f"error: {e}")
                state["talking"] = state["live"] = False
                state["buf"] = []
                await player.finish()
                switch.release()
                if item == "start" and state["pocket"] is not None:
                    say("Stopping the Pocket's recording.")
                    try:
                        await state["pocket"].stop_recording()
                    except Exception:  # noqa: BLE001
                        pass

    def on_event(text: str) -> None:
        if text.startswith("MCU&REC&"):
            state["mode"] = device.switch_name(text)
        elif text.startswith("MCU&STA"):
            if state["mode"] != "normal":
                say(f"Recording in {state['mode']} mode (contact mic): not dictating. "
                    "Slide the switch to normal for voice.")
                return
            state["talking"], state["live"], state["buf"] = True, False, []
            queue.put_nowait("start")
        elif text.startswith("MCU&STO"):
            queue.put_nowait("button")

    def on_audio(data: bytes) -> None:
        if state["live"]:
            player.feed(data)
        elif state["talking"]:
            state["buf"].append(data)

    work = loop.create_task(worker())
    try:
        while not quit_.is_set():
            gone = asyncio.Event()
            try:
                async with device.connect(key, args.timeout, on_disconnect=gone.set) as p:
                    state["mode"] = await p.switch()
                    state["pocket"] = p
                    p.on_event, p.on_audio = on_event, on_audio
                    say(f"Connected to {p.name} ({state['mode']} mode, battery {await p.battery()}%). "
                        "Press the side button and talk. Ctrl+C quits.")
                    waits = [asyncio.ensure_future(e.wait()) for e in (quit_, gone)]
                    await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
                    for w in waits:
                        w.cancel()
                    if state["talking"] and not gone.is_set():
                        try:
                            await p.stop_recording()   # don't leave the Pocket recording
                        except PocketError:
                            pass
            except PocketError as e:
                say(str(e))
            except Exception as e:  # noqa: BLE001 - BLE stacks raise many types; keep going
                if "turned off" in str(e):
                    say("Waiting for Bluetooth (it is off, or macOS hasn't let this app use it yet) ...")
                else:
                    say(f"link error: {type(e).__name__}: {e}")
            state["pocket"] = None
            if state["talking"]:
                queue.put_nowait("disconnected" if not quit_.is_set() else "quit")
                await asyncio.sleep(0)
            while not queue.empty() or state["talking"]:
                await asyncio.sleep(0.1)
            if not quit_.is_set():
                say("Disconnected; reconnecting ...")
                try:
                    await asyncio.wait_for(quit_.wait(), 3)
                except asyncio.TimeoutError:
                    pass
    finally:
        work.cancel()
        await player.finish()
        switch.release()
    return 0
