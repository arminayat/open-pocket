# Releasing Open Pocket for Mac

For maintainers. The Mac app ships two ways, from the same code:

| | TestFlight | Notarized download |
| --- | --- | --- |
| Script | [`mac/testflight.sh`](../mac/testflight.sh) | [`mac/release.sh`](../mac/release.sh) |
| Bundle ID | `com.nestorcodecrafters.openpocket` (shared with the iPhone app) | `com.nestorcodecrafters.openpocket.mac` |
| App Sandbox | On (TestFlight requires it) | Off |
| Pocket Mic | Shown in Finder; the person drags it into `/Library/Audio/Plug-Ins/HAL` and restarts | Installed by the app with an administrator prompt |
| Shell-command gestures | Not offered | Yes |
| Run a Shortcut | `shortcuts://run-shortcut` (opens Shortcuts) | `/usr/bin/shortcuts run` |
| OpenWhispr history | Read through a read-only sandbox exception | Read directly |
| Pocket key | The app's own Keychain item (enter it once) | Shared with the `pocket` CLI |
| Recordings | Read only from the iPhone app's iCloud container | Not available (no container); the screen says so |

Both build for Apple silicon and Intel and need macOS 14. Both use only the account Xcode is signed
in to: no app-specific password, API key or notarytool profile. SwiftPM makes no Xcode archive, so
[`mac/xcode-export.sh`](../mac/xcode-export.sh) wraps the signed app in a minimal `.xcarchive` and
lets `xcodebuild -exportArchive` sign and upload it. The variant is the `APP_STORE` compilation
condition (`Distribution.appStore` in code), set by `APP_STORE=1 mac/build-app.sh`; the sandbox
and iCloud entitlements are in [`mac/OpenPocket-AppStore.entitlements`](../mac/OpenPocket-AppStore.entitlements).
Both build `Open Pocket.app` (the executable inside is still `OpenPocket`).

The TestFlight variant claims the iPhone App ID's iCloud container for Recordings:
`icloud-container-identifiers` and `ubiquity-container-identifiers` =
`iCloud.com.nestorcodecrafters.openpocket`, `icloud-services` = `CloudDocuments`, and
`icloud-container-environment` = `Production`. The App ID had the container already, so the Mac Team
Store profile Xcode made on 2026-11-20 (it allows `icloud-services` `*` and both environments)
authorizes them without a new profile, and Xcode's export would set `Production` by itself. These are
restricted entitlements: a locally built TestFlight variant (Apple Development, no embedded profile)
is killed at launch (exit 137; the same binary without the iCloud keys runs), so only a TestFlight
install runs it. Try the screen locally with the ad-hoc build and `--recordings-folder` instead
([mac/README.md](../mac/README.md)).

What the Mac reads, all inside the container's `Documents/` and only after Recordings first opens:
folder names (for titles), each `recording.json` (date, recorder timestamp, duration, size, audio
checksum), `transcript-`, `summary-` and `note-<sha256>.json` (text, AI title, update time,
provider and model, note revision), and `audio.mp3` when the person presses play (downloaded by
iCloud, checked against the checksum on the Mac, played in place). It ignores the `.txt`/`.md`
copies and anything else. It writes nothing there and copies nothing out; it makes no network
requests of its own, and iCloud Drive does the transfers.

The iPhone app has its own TestFlight script and notes ([testflight.md](testflight.md)).

## One-time setup

1. Xcode signed in to an Apple Account on team G6WL4CPNV3 (Nestor Code Crafters) that may make
   distribution certificates (Admin or Account Holder): Xcode › Settings › Accounts. The TestFlight
   export makes its cloud-managed Apple Distribution and Mac Installer certificates and the Mac App
   Store profile itself; it needs an Apple Development certificate in the keychain to sign the
   archive first.
2. For the notarized download, a **Developer ID Application** certificate for the team with its
   private key in your login keychain (only the Account Holder can make one).
3. For TestFlight, the App Store Connect app "Open Pocket" needs the **macOS** platform
   (open the app and use **Add Platform** if it only has iOS).

## TestFlight

1. Set `CFBundleShortVersionString` in [`mac/Info.plist`](../mac/Info.plist) and commit.
2. Run `mac/testflight.sh`. It takes the current UTC time as the build number, builds the sandboxed
   variant, and uploads the `.pkg`. `--check` exports `Open Pocket.pkg` into
   `mac/build/testflight/export` without uploading.
3. In App Store Connect, wait for processing, then add the build to a test group. Internal testers
   get it right away; an external group's first build of each version waits for Beta App Review.
   `ITSAppUsesNonExemptEncryption` is false, so no export compliance question.

## Notarized download

1. Set `CFBundleShortVersionString` in [`mac/Info.plist`](../mac/Info.plist). Bump Pocket Mic's
   own version in [`driver/Info.plist`](../driver/Info.plist) when the driver changed. Setup and
   Settings show the installed version, but the app doesn't yet offer an update when the bundled
   one is newer, so people with an older driver have to press Reinstall under Settings › Pocket Mic.
2. Commit. Both scripts refuse a dirty working tree, so every build matches a commit.
3. Run `mac/release.sh`. It writes `mac/build/release/OpenPocket-<version>.zip` (holding
   `Open Pocket.app`) and its `.sha256`.
   Notarization usually takes a minute or two; the script waits up to 30. It's a zip, not a disk
   image, because `xcodebuild` notarizes apps only and Gatekeeper rejects a disk image that isn't
   notarized itself (`spctl` said "Unnotarized Developer ID" for one on 2026-11-20); the zipped app
   carries its stapled ticket.
4. Tag the commit (`mac-v<version>`) and hand out the zip. Where it is published isn't decided; the
   repository is private, so a GitHub release there isn't a public download.

`mac/release.sh --check` does everything except notarization. Its app is blocked by Gatekeeper on
other Macs.

## Status

2026-11-20: `mac/testflight.sh` uploaded **OpenPocket 0.1.0 (202611202203)** for macOS to the App
Store Connect app (`Uploaded OpenPocket`, `EXPORT SUCCEEDED`; the only warnings were missing dSYMs,
which don't block processing). On 2026-11-21 App Store Connect showed it processed and
**Ready to Submit**, in the internal group "Me" only (1 invite, no installs). Later that day it was added to
the external group "Beta users" (public link https://testflight.apple.com/join/qkq1GB2v) and
submitted for Beta App Review; status **Waiting for Review**. Nobody had installed or tried it before
submission (see Not yet verified). Its What to Test text and the Mac paragraph of the shared review
notes are below. The app record lists only an iOS App
Store version; TestFlight shows a macOS builds tab, so uploads work without a macOS App Store version. `mac/release.sh` made a
notarized 0.1.0 zip (build 202611202205) that Gatekeeper accepts; it isn't published.

2026-11-22 (not uploaded): the app is named **Open Pocket** (bundle `Open Pocket.app`), and the
TestFlight variant reads Recordings from iCloud. `mac/testflight.sh --check` built it and exported
`Open Pocket.pkg` with automatic signing (`EXPORT SUCCEEDED`; Xcode printed `Exported OpenPocket`,
named after the archive). The app inside is signed Apple Distribution with the existing Mac Team
Store profile and carries the iCloud entitlements above plus `application-identifier` and
`team-identifier`; no new profile was made.

### TestFlight copy

For the next build. 0.1.0 went out with the same text under the old name and without the
Recordings line, and its review paragraph said "The Mac app makes no network requests."

What to Test:

> Mac beta. You need an activated Pocket recorder.
> - In Setup, allow Bluetooth, connect your Pocket, and enter its key.
> - Install Pocket Mic: press Show Pocket Mic in Finder, drag it into the HAL folder that opens (Finder asks for your password), then restart your Mac.
> - Grant Accessibility so Open Pocket can press your dictation app's hotkey and media keys.
> - Dictate: with the side switch in normal mode, press the side button, speak, press again, and check that your dictation app (for example OpenWhispr, Wispr Flow, or Superwhisper) types the text.
> - Gestures: in call mode, turn gestures on and try 2 taps (play/pause) and 3 taps (next track), then your own actions. Optionally run Teach Open Pocket your taps.
> - Recordings: with iCloud sync on in Open Pocket on your iPhone (same Apple Account as this Mac), open Recordings and check that your recordings, summaries, transcripts and notes appear, that a new one shows up after your iPhone uploads it, and that audio plays (it downloads first).
> - Report hotkeys or media keys that don't fire, audio that doesn't reach Pocket Mic, and Bluetooth drops through TestFlight feedback. Don't include private recordings or your Pocket key.

Review notes (appended to the iPhone notes; App Store Connect shares one set per app):

> Mac (macOS build): Open Pocket for Mac also needs a physical, activated Pocket recorder, connected over Bluetooth, and the recorder's key, which the user enters once; it is stored in the Mac's Keychain. The Mac app makes no network requests of its own. Recordings shows, read only, the recordings, transcripts, summaries and notes that Open Pocket on iPhone saved to its iCloud Drive folder when the user turned on iCloud sync there (same Apple Account); iCloud Drive transfers them, and without any it shows a short message. Without the hardware, the reviewer can open the app and inspect Setup, Dictate, Recordings, Gestures, and Settings. Dictation also needs the user's own dictation app (for example OpenWhispr, Wispr Flow, or Superwhisper) and the bundled Pocket Mic audio driver: because the app is sandboxed, Setup only shows the driver in Finder, and the user drags it into /Library/Audio/Plug-Ins/HAL (Finder asks for an administrator password) and restarts the Mac. Accessibility permission is requested only to press the hotkeys and media keys the user configures; the app does not read screen content.

## Not yet verified

- In the TestFlight build: posting the dictation hotkey and media keys from the sandbox (CGEvent
  with Accessibility), switching the default input device, Bluetooth, and the drag-in Pocket Mic
  install. The sandboxed build launched locally on 2026-11-20; nothing else was tried. Since the
  iCloud entitlements it only runs from TestFlight. If posting keys turns out to be blocked in the
  sandbox, dictation can't work from TestFlight.
- In the notarized build: installing Pocket Mic (AppleScript `do shell script … with administrator
  privileges` under the hardened runtime), Accessibility hotkeys and Bluetooth on another Mac.
- Recordings against the real container. Only the parser was checked, on a synthetic folder
  (`--recordings-test`, plus assertions on which documents win). Untried in a TestFlight install:
  the container lookup and Spotlight's iCloud query inside the sandbox, downloading text and audio
  that isn't on the Mac yet, playback, the signed-out and iCloud-Drive-off messages, and how soon a
  new iPhone recording appears.
- Whether installing the Mac app changes how iCloud Drive shows the folder. The Mac declares no
  `NSUbiquitousContainers`, so the iPhone's name and visibility should stay in charge.

## When it fails

- **No Developer ID Application / Apple Development certificate**: setup steps 1 and 2.
- **The export or upload failed**: Xcode isn't signed in to the team, or (TestFlight) the app has no
  macOS platform yet. The script's `export.log` and the `.xcdistributionlogs` folder it names (in
  `$TMPDIR`) have the details.
- **Notarization failed**: the script prints `xcodebuild -exportNotarizedApp`'s answer.
- **Recordings asks to sign in, or says iCloud Drive isn't available** (TestFlight): the Mac isn't signed in to iCloud with
  iCloud Drive on, or the app isn't allowed to use iCloud Drive. A locally built TestFlight variant
  can't be used to check; it doesn't launch.
- **x86_64 deprecation warning**: expected with Xcode 27; the binary still targets macOS 14.
