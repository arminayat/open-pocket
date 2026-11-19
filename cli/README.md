# pocket CLI

Use a [HeyPocket](https://heypocket.com) recorder as a Bluetooth microphone for your Mac.

Press the Pocket's side button, talk into it, press again: the recording lands on
your Mac as an MP3. The goal is to hand that file to your own dictation setup
(OpenWhispr), so the Pocket works like a handheld mic for it. This tool records.
It does not transcribe.

It talks to the Pocket over Bluetooth LE using only the documented command and
audio channels. It never touches firmware, and it does not need the vendor app.

## Install

macOS, Python 3.9+.

```bash
cd cli
python3 -m venv .venv && .venv/bin/pip install -e .
```

Run `pocket` from **Terminal** (or iTerm). The first run asks for Bluetooth
access. Allow it under System Settings → Privacy & Security → Bluetooth. Apps
that can't ask for Bluetooth access, such as editors and AI agents, get the
process killed by macOS.

## The session key

The Pocket accepts one key, chosen when it is paired. Every Mac that talks to it
needs that same key. The key lives in the macOS Keychain, never in this repo.

**First Mac, new or reset Pocket:**

```bash
pocket pair
```

**Another Mac (home → work):** copy the key over, don't pair again.

```bash
pocket key export | pbcopy    # on the Mac that has it
pocket key import             # on the new Mac, then paste
```

`pocket key show` confirms a key is there (masked). `POCKET_KEY=...` overrides
the Keychain. Only one Mac can be connected to the Pocket at a time.

To reset the Pocket: triple-click the side button (LED blinks red), then hold it
until the blinking stops. The LED pulses blue and it accepts a new key.

## OpenPocket for Mac

The native app with dictation and gestures lives in [`../mac`](../mac). This CLI came first and still works on its own.

## Dictate with OpenWhispr (CLI)

Press the side button, talk into the Pocket, and press again. OpenWhispr
transcribes, cleans up, and pastes as if you had used its hotkey, and it saves
its normal history entry.

The Pocket isn't a real microphone, so the tool routes it through a virtual one.
On each press it switches the Mac's default input to Pocket Mic, sends
OpenWhispr's hotkey, and plays the Pocket's live audio into Pocket Mic. On the
next press it sends the hotkey again and switches the input back. Your normal
hotkey dictation with the Mac mic is unaffected.

One-time setup per Mac:

```bash
../driver/install.sh                        # builds and installs the "Pocket Mic" virtual mic (asks for your password)
brew install ffmpeg switchaudio-osx
```

Pocket Mic ([`../driver`](../driver)) is a small MIT-licensed CoreAudio loopback device
built on [libASPL](https://github.com/gavv/libASPL). It needs only the Xcode
Command Line Tools to build. `../driver/install.sh --uninstall` removes it.
BlackHole (`brew install blackhole-2ch`) also works as a fallback.

- In OpenWhispr settings, set the microphone to the **system default** (turn
  off "prefer built-in mic"). It then follows whatever the default input is.
- Allow your terminal under Privacy & Security → **Accessibility**, so it can
  send the hotkey.

```bash
pocket dictate                       # hotkey defaults to cmd+shift+.
pocket dictate --hotkey 'ctrl+space'
```

If it ever exits uncleanly while you're talking, the next run puts your default
input back.

## Use

```bash
pocket status                 # battery, switch position, firmware, storage
pocket record                 # start now; stop with Enter, the side button, or Ctrl+C
pocket record -s 10           # stop after 10 s
pocket listen                 # stay connected; every side-button recording is saved
pocket listen --exec 'say -v Samantha got it'   # run a command with each new file
```

Recordings go to `~/Library/Application Support/heypocket/recordings` (or `-o DIR`, or
`$POCKET_DIR`). Each `.mp3` has a `.json` next to it with timings, switch mode,
and the device's own timestamp. Finished file paths print on stdout, one per
line, and everything else goes to stderr.

**Side switch:** normal mode is the voice mic. Call mode is a contact mic: it
picks up vibration, not speech, and cuts off around 4 kHz. `record` waits for
you to switch to normal mode. `listen` warns and skips `--exec` for call-mode
recordings.

Audio is 16 kHz mono MP3 at 32 kbps. Holding the Pocket right against your mouth
sounds boomy, and a few centimetres away is better.

## Status

- [x] Record from the Pocket into a file (`record`, `listen`)
- [x] Live dictation through stock OpenWhispr via a virtual mic (`dictate`)
- [x] Native Mac app: [`../mac`](../mac)
- [ ] Signed DMG
- [ ] Pull recordings made away from the Mac and turn them into notes

## Protocol notes

Command channel `001120a3-2233-4455-6677-889912345678`: write `APP&<cmd>` and get
replies as `MCU&...` notifications. Audio channel `001120a1-...` streams raw MP3
while recording. Commands used: `SK&<key>` (login), `REC&SECEN` (switch
position), `STA` / `STO`, `BAT`, `FW`, `SPACE`, `T&<utc>`.

Don't subscribe to the vendor's other services (`ffd3`, `e49a3003`,
`e49a28e1`). Doing that turned the LED magenta and dropped the link, and they
look like firmware-update services.
