"""BLE link to a HeyPocket recorder.

Only the documented command channel (001120a3) and audio channel (001120a1)
are used. Do not subscribe to the vendor's other services (ffd3, e49a3003,
e49a28e1): doing so turned the LED magenta and dropped the link, and they look
like firmware-update services.

Protocol: write `APP&<cmd>` to the command channel, replies and events arrive
as `MCU&...` notifications. The audio channel streams raw MP3 while recording.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from contextlib import asynccontextmanager
from typing import AsyncIterator, Callable, List, Optional, Tuple

from bleak import BleakClient, BleakScanner

CMD_CHAR = "001120a3-2233-4455-6677-889912345678"
AUDIO_CHAR = "001120a1-2233-4455-6677-889912345678"
NAME_PREFIX = "PKT"


class PocketError(Exception):
    pass


def _is_pocket(dev, adv) -> bool:
    return (adv.local_name or dev.name or "").upper().startswith(NAME_PREFIX)


async def find(timeout: float = 15.0):
    dev = await BleakScanner.find_device_by_filter(_is_pocket, timeout=timeout)
    if dev is None:
        raise PocketError(
            "Pocket not found. Keep it nearby and awake, and close the phone app "
            "or any other Mac that is connected to it.")
    return dev


class Pocket:
    def __init__(self, client: BleakClient, name: str):
        self.client = client
        self.name = name
        self.on_event: Optional[Callable[[str], None]] = None
        self.on_audio: Optional[Callable[[bytes], None]] = None
        self._waiters: List[Tuple[str, asyncio.Future]] = []

    # -- notifications -----------------------------------------------------

    def _handle_event(self, _char, data: bytearray) -> None:
        text = bytes(data).decode("ascii", errors="replace").strip("\x00\r\n")
        for prefix, fut in list(self._waiters):
            if text.startswith(prefix) and not fut.done():
                fut.set_result(text)
        if self.on_event:
            self.on_event(text)

    def _handle_audio(self, _char, data: bytearray) -> None:
        if self.on_audio:
            self.on_audio(bytes(data))

    # -- commands ----------------------------------------------------------

    async def send(self, cmd: str) -> None:
        await self.client.write_gatt_char(CMD_CHAR, f"APP&{cmd}".encode("ascii"), response=False)

    async def wait_for(self, prefix: str, timeout: float, cmd: Optional[str] = None) -> str:
        """Wait for an event starting with `prefix`, optionally sending `cmd` first."""
        fut = asyncio.get_running_loop().create_future()
        entry = (prefix, fut)
        self._waiters.append(entry)
        try:
            if cmd is not None:
                await self.send(cmd)
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise PocketError(f"No {prefix} reply from the Pocket"
                              + (f" to {cmd}" if cmd else "")) from None
        finally:
            self._waiters.remove(entry)

    async def request(self, cmd: str, expect: str, timeout: float = 5.0) -> str:
        return await self.wait_for(expect, timeout, cmd=cmd)

    async def login(self, key: str) -> None:
        reply = await self.request(f"SK&{key}", "MCU&SK&")
        if not reply.endswith("OK"):
            raise PocketError(
                "The Pocket rejected this key. It is paired with a different one: "
                "import the right key, or reset the device and pair again.")

    async def switch(self) -> str:
        """Side switch: 'normal' (voice) or 'call' (contact mic)."""
        return switch_name(await self.request("REC&SECEN", "MCU&REC&"))

    async def battery(self) -> int:
        return int((await self.request("BAT", "MCU&BAT&")).rsplit("&", 1)[-1])

    async def firmware(self) -> str:
        return (await self.request("FW", "MCU&FW&")).rsplit("&", 1)[-1]

    async def space(self) -> str:
        return (await self.request("SPACE", "MCU&SPA&"))[len("MCU&SPA&"):]

    async def set_clock(self) -> None:
        now = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S")
        await self.request(f"T&{now}", "MCU&T&")

    async def start_recording(self) -> str:
        return await self.request("STA", "MCU&STA")

    async def stop_recording(self) -> None:
        await self.request("STO", "MCU&STO")


def switch_name(event: str) -> str:
    if event.endswith("&CON"):
        return "normal"
    if event.endswith("&CALL"):
        return "call"
    return event


@asynccontextmanager
async def connect(key: str, timeout: float = 15.0,
                  on_disconnect: Optional[Callable[[], None]] = None) -> AsyncIterator[Pocket]:
    """Find the Pocket, log in with `key`, subscribe to events and audio."""
    dev = await find(timeout)
    callback = (lambda _c: on_disconnect()) if on_disconnect else None
    async with BleakClient(dev, disconnected_callback=callback) as client:
        pocket = Pocket(client, dev.name or "Pocket")
        await client.start_notify(CMD_CHAR, pocket._handle_event)
        await pocket.login(key)
        await client.start_notify(AUDIO_CHAR, pocket._handle_audio)
        yield pocket


async def pair(key: str, log: Callable[[str], None], timeout: float = 15.0) -> None:
    """Give a never-paired (or reset) Pocket our key, then log in and set its clock.

    The device answers MCU&SK&OK and drops the link about a second later, so
    the second half runs on a fresh connection.
    """
    dev = await find(timeout)
    log(f"Found {dev.name}. Sending the key ...")
    try:
        async with BleakClient(dev) as client:
            pocket = Pocket(client, dev.name or "Pocket")
            await client.start_notify(CMD_CHAR, pocket._handle_event)
            await pocket.login(key)
            log("Key accepted. Reconnecting ...")
            await asyncio.sleep(1.5)
    except PocketError:
        raise
    except Exception:
        pass  # the device drops the link right after accepting the key

    last: Exception = PocketError("Could not reconnect after pairing.")
    for _ in range(3):
        await asyncio.sleep(2.0)
        try:
            async with connect(key, timeout) as pocket:
                await pocket.set_clock()
                return
        except Exception as e:  # noqa: BLE001 - retry any link error
            last = e
    raise last
