# Releasing OpenPocket for Mac

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

Both build for Apple silicon and Intel and need macOS 14. Both use only the account Xcode is signed
in to: no app-specific password, API key or notarytool profile. SwiftPM makes no Xcode archive, so
[`mac/xcode-export.sh`](../mac/xcode-export.sh) wraps the signed app in a minimal `.xcarchive` and
lets `xcodebuild -exportArchive` sign and upload it. The variant is the `APP_STORE` compilation
condition (`Distribution.appStore` in code), set by `APP_STORE=1 mac/build-app.sh`; the sandbox
entitlements are in [`mac/OpenPocket-AppStore.entitlements`](../mac/OpenPocket-AppStore.entitlements).

The iPhone app has its own TestFlight script and notes ([testflight.md](testflight.md)).

## One-time setup

1. Xcode signed in to an Apple Account on team G6WL4CPNV3 (Nestor Code Crafters) that may make
   distribution certificates (Admin or Account Holder): Xcode › Settings › Accounts. The TestFlight
   export makes its cloud-managed Apple Distribution and Mac Installer certificates and the Mac App
   Store profile itself; it needs an Apple Development certificate in the keychain to sign the
   archive first.
2. For the notarized download, a **Developer ID Application** certificate for the team with its
   private key in your login keychain (only the Account Holder can make one).
3. For TestFlight, the App Store Connect app "OpenPocket Private" needs the **macOS** platform
   (open the app and use **Add Platform** if it only has iOS).

## TestFlight

1. Set `CFBundleShortVersionString` in [`mac/Info.plist`](../mac/Info.plist) and commit.
2. Run `mac/testflight.sh`. It takes the current UTC time as the build number, builds the sandboxed
   variant, and uploads the `.pkg`. `--check` exports it into `mac/build/testflight/export` without
   uploading.
3. In App Store Connect, wait for processing, then add the build to a test group. Internal testers
   get it right away; an external group's first build of each version waits for Beta App Review.
   `ITSAppUsesNonExemptEncryption` is false, so no export compliance question.

## Notarized download

1. Set `CFBundleShortVersionString` in [`mac/Info.plist`](../mac/Info.plist). Bump Pocket Mic's
   own version in [`driver/Info.plist`](../driver/Info.plist) when the driver changed. Setup and
   Settings show the installed version, but the app doesn't yet offer an update when the bundled
   one is newer, so people with an older driver have to press Reinstall under Settings › Pocket Mic.
2. Commit. Both scripts refuse a dirty working tree, so every build matches a commit.
3. Run `mac/release.sh`. It writes `mac/build/release/OpenPocket-<version>.zip` and its `.sha256`.
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

### TestFlight copy (0.1.0)

What to Test:

> Mac beta. You need an activated Pocket recorder.
> - In Setup, allow Bluetooth, connect your Pocket, and enter its key.
> - Install Pocket Mic: press Show Pocket Mic in Finder, drag it into the HAL folder that opens (Finder asks for your password), then restart your Mac.
> - Grant Accessibility so OpenPocket can press your dictation app's hotkey and media keys.
> - Dictate: with the side switch in normal mode, press the side button, speak, press again, and check that your dictation app (for example OpenWhispr, Wispr Flow, or Superwhisper) types the text.
> - Gestures: in call mode, turn gestures on and try 2 taps (play/pause) and 3 taps (next track), then your own actions. Optionally run Teach OpenPocket your taps.
> - Report hotkeys or media keys that don't fire, audio that doesn't reach Pocket Mic, and Bluetooth drops through TestFlight feedback. Don't include private recordings or your Pocket key.

Review notes (appended to the iPhone notes; App Store Connect shares one set per app):

> Mac (macOS build): OpenPocket for Mac also needs a physical, activated Pocket recorder, connected over Bluetooth, and the recorder's key, which the user enters once; it is stored in the Mac's Keychain. The Mac app makes no network requests. Without the hardware, the reviewer can open the app and inspect Setup, Dictate, Gestures, and Settings. Dictation also needs the user's own dictation app (for example OpenWhispr, Wispr Flow, or Superwhisper) and the bundled Pocket Mic audio driver: because the app is sandboxed, Setup only shows the driver in Finder, and the user drags it into /Library/Audio/Plug-Ins/HAL (Finder asks for an administrator password) and restarts the Mac. Accessibility permission is requested only to press the hotkeys and media keys the user configures; the app does not read screen content.

## Not yet verified

- In the TestFlight build: posting the dictation hotkey and media keys from the sandbox (CGEvent
  with Accessibility), switching the default input device, Bluetooth, and the drag-in Pocket Mic
  install. The sandboxed build launched locally on 2026-11-20; nothing else was tried. If posting
  keys turns out to be blocked in the sandbox, dictation can't work from TestFlight.
- In the notarized build: installing Pocket Mic (AppleScript `do shell script … with administrator
  privileges` under the hardened runtime), Accessibility hotkeys and Bluetooth on another Mac.
- iCloud Recordings stays a placeholder in both. The TestFlight variant shares the iPhone app's
  App ID, which already has the iCloud container, so it is the easier place to add it.

## When it fails

- **No Developer ID Application / Apple Development certificate**: setup steps 1 and 2.
- **The export or upload failed**: Xcode isn't signed in to the team, or (TestFlight) the app has no
  macOS platform yet. The script's `export.log` and the `.xcdistributionlogs` folder it names (in
  `$TMPDIR`) have the details.
- **Notarization failed**: the script prints `xcodebuild -exportNotarizedApp`'s answer.
- **x86_64 deprecation warning**: expected with Xcode 27; the binary still targets macOS 14.
