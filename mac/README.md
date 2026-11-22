# Open Pocket for Mac

A native macOS app (SwiftUI, Swift Package Manager, no Xcode project). It has a
window plus a menu-bar icon: click the icon to open the window, right-click it
for a short menu. Same look as Open Pocket on iPhone: Instrument Serif titles,
grouped lists, and the recorder drawing.

## What it does

- **Dictate (side switch in normal mode).** Press the Pocket's side button,
  talk, and press again. Your dictation app transcribes and pastes the text.
  It works with any app that dictates on a hotkey: OpenWhispr, Wispr Flow,
  Superwhisper, and others. On each press Open Pocket:
  1. switches the Mac's default input to **Pocket Mic** (the virtual
     microphone in [`../driver`](../driver)),
  2. presses the dictation app's hotkey (press to start and stop, or hold),
  3. decodes the Pocket's live MP3 stream and plays it into Pocket Mic,
  4. presses the hotkey again and switches your usual input back.

  It works with the dictation app as installed. Recent dictations show text
  from OpenWhispr's history (read only).
- **Gestures (side switch in call mode).** The contact mic picks up taps on the
  Pocket's back: 1, 2 or 3 taps, and swipes, plus where a tap landed (top,
  bottom, left or right). The playground shows each gesture live with its
  confidence. Actions map a gesture, an optional location and a minimum
  confidence to a keyboard shortcut, an app, a Shortcut, a media key or a
  shell command. Defaults: 2 taps → play/pause, 3 taps → next track. While
  gestures are on, the Mac starts a recording on the Pocket so its audio
  streams, and the Pocket keeps that recording.
- **Teach Open Pocket your taps.** A 2-minute guided calibration: hold still,
  prompted taps, swipes, grip and rub (which must not count), then 6 taps per
  side. It trains the tap-location model on your grip, suggests a confidence
  threshold, and can keep the session (audio plus prompt timings) under
  `~/Library/Application Support/heypocket/calibration-sessions/` for
  improving the detector.
- **Recordings** (the iPhone library through iCloud) is a placeholder. It needs
  the app signed by the OpenPocket team (G6WL4CPNV3), which shares the iCloud
  container `iCloud.com.nestorcodecrafters.openpocket`.

## Build and run

Needs only the Xcode Command Line Tools (Swift 6).

```sh
mac/build-app.sh                 # → "mac/build/Open Pocket.app", ad-hoc signed, Pocket Mic inside
open "mac/build/Open Pocket.app"
```

`SIGN_IDENTITY`, `UNIVERSAL=1` and `BUILD_NUMBER` change how it signs and
builds, and `APP_STORE=1` makes the sandboxed TestFlight variant. `mac/release.sh`
makes a Developer ID–signed, notarized zip and `mac/testflight.sh` uploads to
TestFlight ([../docs/mac-release.md](../docs/mac-release.md)). The app icon is
`Resources/AppIcon.icns`, made from the iPhone icon by
`xcrun swift mac/make-icon.swift assets/images/icon.png mac/Resources/AppIcon.icns`.

First launch asks for Bluetooth, the Pocket key (Keychain item `heypocket`,
shared with the `pocket` CLI) and Accessibility (to press hotkeys). Setup
installs Pocket Mic, which asks for your password. Ad-hoc builds change
signature on every build, so macOS may ask for the Keychain key and
Accessibility again after a rebuild. If Accessibility looks on but hotkeys
fail, remove the app from the list and add it again.

## Checks without a Pocket

```sh
"mac/build/Open Pocket.app/Contents/MacOS/OpenPocket" --loopback-test file.mp3       # audio path into Pocket Mic
"mac/build/Open Pocket.app/Contents/MacOS/OpenPocket" --gesture-test <session dir>   # detector on a recorded session
"mac/build/Open Pocket.app/Contents/MacOS/OpenPocket" --train-locations <session dir> out.json
"mac/build/Open Pocket.app/Contents/MacOS/OpenPocket" --snapshot <dir>               # render every screen to PNG
```

The gesture detector is a port of the original Python prototype. On the two
recorded test sessions it gets 25/30 (gesture set) and 46/49 (location set),
against 24/30 and 47/49 for the Python. The built-in location model
(`Resources/location-samples-default.json`, 48 taps) scores 39/48 when each
tap is held out of training. Gesture confidence is a heuristic from tap
loudness, sharpness and rhythm, and is new in this port.

## Notes

- Bluetooth uses only the documented command (`001120a3…`) and audio
  (`001120a1…`) characteristics. Never subscribe to the vendor's other
  services: that turned the LED magenta and dropped the link.
- The Command Line Tools SDK lacks the SwiftUI macro plugin, so `@State` isn't
  available. Views hold a `Box` in `@StateObject` instead.
- Instrument Serif is bundled under the SIL Open Font License
  (`Resources/Fonts/OFL.txt`).
