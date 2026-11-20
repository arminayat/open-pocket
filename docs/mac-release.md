# Releasing OpenPocket for Mac

For maintainers. The Mac app ships as a **Developer ID–signed, notarized app in a zip**, not
through TestFlight. [`mac/release.sh`](../mac/release.sh) builds it for Apple silicon and Intel,
signs the app and the bundled Pocket Mic driver with the hardened runtime, has Apple notarize the
app through the account Xcode is signed in to, staples the ticket, checks it with Gatekeeper, and
zips it; people unzip it and drag OpenPocket to Applications. The iPhone app still goes through
TestFlight ([testflight.md](testflight.md)).

## Why not TestFlight

TestFlight and the Mac App Store require the App Sandbox, and the Mac app needs things the sandbox
forbids: installing Pocket Mic into `/Library/Audio/Plug-Ins/HAL` with an administrator prompt
(without it, dictation can't work), running shell commands and `/usr/bin/shortcuts` as gesture
actions, reading OpenWhispr's history in `~/Library/Application Support/open-whispr`, and the
`heypocket` Keychain item shared with the CLI. Usual Bot made the same trade the other way: it
moved its Mac app from a notarized disk image to TestFlight only because it needed push notifications.
Decided 2026-11-20.

## One-time setup

1. A **Developer ID Application** certificate for team G6WL4CPNV3 (Nestor Code Crafters), with its
   private key in your login keychain. Only the Account Holder can make one (Xcode › Settings ›
   Accounts › Manage Certificates › + › Developer ID Application). `security find-identity -v -p
   codesigning` lists it.
2. Xcode signed in to an Apple Account on that team (Xcode › Settings › Accounts). That's all
   notarization needs: like the iPhone TestFlight upload, it goes through Xcode's account, so there's
   no app-specific password, API key or notarytool profile to set up. SwiftPM makes no Xcode archive,
   so the script wraps the signed app in a minimal `.xcarchive` and lets `xcodebuild -exportArchive`
   (`method` `developer-id`, `destination` `upload`) send it, then polls
   `xcodebuild -exportNotarizedApp` for the stapled app.

## Making a release

1. Set `CFBundleShortVersionString` in [`mac/Info.plist`](../mac/Info.plist). Bump Pocket Mic's
   own version in [`driver/Info.plist`](../driver/Info.plist) when the driver changed. Setup and
   Settings show the installed version, but the app doesn't yet offer an update when the bundled
   one is newer, so people with an older driver have to press Reinstall under Settings › Pocket Mic.
2. Commit. The script refuses a dirty working tree, so every release matches a commit.
3. Run `mac/release.sh`. It takes the current UTC time as the build number, rebuilds the driver,
   and writes `mac/build/release/OpenPocket-<version>.zip` and its `.sha256`. Notarization usually
   takes a minute or two; the script waits up to 30. It's a zip, not a disk image, because
   `xcodebuild` notarizes apps only and Gatekeeper rejects a disk image that isn't notarized itself
   (`spctl` said "Unnotarized Developer ID" for one on 2026-11-20); the zipped app carries its
   stapled ticket. A disk image would need `notarytool` with an API key or app-specific password.
4. Tag the commit (`mac-v<version>`) and hand out the zip. Where it is published (a GitHub
   release, the public Gist, a website) isn't decided yet; the repository is private, so a GitHub
   release there isn't a public download.

`mac/release.sh --check` does everything except notarization, with uncommitted changes allowed.
Its app is blocked by Gatekeeper on other Macs.

## Not yet verified

- Downloading, unzipping and opening the zip on another Mac.
- Installing Pocket Mic from a notarized build (AppleScript `do shell script … with administrator
  privileges` under the hardened runtime), Accessibility hotkeys, and Bluetooth on another Mac.
- iCloud Recordings stays a placeholder: Developer ID signing alone doesn't grant the iCloud
  container; that needs iCloud entitlements and a Developer ID provisioning profile embedded in
  the app.

## When it fails

- **No Developer ID Application certificate**: setup step 1, or set `TEAM_ID` if it's another team.
- **The upload failed**: Xcode isn't signed in to the team; `mac/build/release/upload.log` and the
  `.xcdistributionlogs` folder it names (in `$TMPDIR`) have the details, including `Notarization.log`.
- **Notarization failed**: the script prints `xcodebuild -exportNotarizedApp`'s answer.
- **x86_64 deprecation warning**: expected with Xcode 27; the binary still targets macOS 14.
