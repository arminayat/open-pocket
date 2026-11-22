# External TestFlight

App Store Connect app: **OpenPocket Private**, to be renamed **Open Pocket** (see 2026-11-22 below). Bundle ID: `com.nestorcodecrafters.openpocket`.

Build 0.1.0 (4) was uploaded as internal-only. It cannot be added to an external testing group. Build 0.1.0 (5) removes that upload restriction; Apple processing, Beta App Review, and public-link availability must be verified separately from a successful upload.

## Submission copy

### Beta app description

Shared by the iPhone and Mac builds (App Store Connect has one description per app).

Open Pocket is an independent, unofficial app for owners of an already-activated Pocket recorder, on iPhone and Mac.

iPhone: connect your recorder, download and play your recordings, share audio, and write notes. Optional features include transcription using your own provider API key, AI titles and summaries, and iCloud Drive sync. API providers may charge for usage.

Mac: use your Pocket as the microphone for the dictation app you already use, such as OpenWhispr, Wispr Flow, or Superwhisper, and tap the recorder to trigger shortcuts, apps, and media keys. Requires macOS 14 or later and the included Pocket Mic audio driver.

A compatible physical Pocket recorder is required. Open Pocket is not affiliated with or supported by the maker of Pocket.

### What to test

- Connect an already-activated Pocket recorder through Settings and confirm it appears with battery and firmware information.
- Download a short recording over Bluetooth, then play and share it while disconnected.
- Add and edit a note on a saved recording.
- Optionally configure your own transcription provider API key and transcribe a short recording. Confirm the provider and potential charges before uploading.
- Optionally generate an AI title and summary from a completed transcript using your chosen AI provider.
- With iCloud sync enabled, check that audio and saved text appear in the Open Pocket folder in iCloud Drive. If you have a second installation on the same Apple account, check that it imports them.
- Report connection failures, interrupted downloads, playback problems, and sync conflicts through TestFlight feedback. Do not include API keys, device keys, private recordings, or unredacted account details.

### Beta App Review notes

This app works with a physical Pocket recorder that has already been activated using the manufacturer's app. It does not activate recorders, modify firmware, or delete recordings from the recorder. Recorder access uses the owner's Pocket sign-in, personal API key, or device key. There is no separate OpenPocket account or shared demo credential.

Without recorder hardware, the reviewer can open the app and inspect Settings, connection setup, and provider settings; the recording workflow requires hardware and an owner-authorized account/device key. Do not represent those workflows as reviewable without the hardware. If Apple needs a demonstration video or access arrangement, provide it before claiming review readiness.

Transcription and AI features are optional. API-key providers use the tester's own account and may incur provider charges. ChatGPT sign-in is separate from Pocket access and does not supply audio transcription. Audio uploads and transcript requests require the user's action or opt-in automatic processing. iCloud sync is off by default and requires explicit opt-in. Credentials stay in device-only Keychain.

## App Store Connect steps

1. Wait for build 0.1.0 (5) to finish processing and confirm it is eligible for external testing.
2. Complete Test Information with the beta description and the maintainer's verified feedback contact and any required URLs. Public marketing URL: https://gist.github.com/arminayat/e19411ea87e00624cc029ecedbf51635#file-public-beta-md . Privacy URL: https://gist.github.com/arminayat/e19411ea87e00624cc029ecedbf51635#file-privacy-md . Source copies are `docs/public-beta.md` and `docs/privacy.md`; update the public Gist when these change. The app repository remains private.
3. Complete Beta App Review Information with the maintainer's actual contact details and accurate hardware/sign-in requirements. Do not invent a demo account.
4. Use the existing external group **Beta users**, add the newest build, and use the testing notes above.
5. Submit the build for Beta App Review. This is separate from App Store review and does not publish an App Store listing.
6. Enable the group's public link. Record the actual URL and Apple review status here once verified. Testers can install only when Apple permits external testing.

## Status

2026-11-04: build 0.1.0 (5) archived successfully, passed `codesign --verify --deep --strict`, and uploaded to Apple (`Uploaded OpenPocket`, `EXPORT SUCCEEDED`, exit 0). Export options explicitly set `testFlightInternalTestingOnly` to false. Archive and export metadata are retained under ignored `build/testflight/build-5`; future builds use this location outside generated `ios/`. Missing dSYM warnings for prebuilt frameworks did not prevent upload. No configured App Store Connect API credentials or cached Fastlane session were found in the standard locations checked.

2026-11-05 live App Store Connect result: build **0.1.0 (5)** was submitted to Beta App Review and is **Waiting for Review** in the existing external group **Beta users** (1 build, 0 testers at submission). The public link **https://testflight.apple.com/join/qkq1GB2v** is enabled, with no custom tester limit. Apple explicitly reports that testers cannot join until the group has an approved build. Automatic tester notification was selected during submission; approval/public installation is not yet established.

The beta description, review contact supplied by the maintainer, hardware review notes, and build-specific What to Test instructions were saved. Sign-in is not required to open the app; the review notes explain that recorder workflows require physical hardware and owner-authorized Pocket access. The prior private-repository marketing/privacy placeholders were replaced by the public Gist URLs above. Both public document sections returned HTTP 200 without authentication, and App Store Connect confirmed the metadata as Saved before submission. No app code, environment variable, migration, signed binary, or physical-device behavior changed in this submission step.

2026-11-21 App Store Connect check (read-only): iOS build **0.1.0 (5)** is **Approved** for external testing, in **Beta users** and the internal group. The public link https://testflight.apple.com/join/qkq1GB2v is live: the unauthenticated join page offers "Join the OpenPocket Private beta". The group has 0 external testers. Its setting "Test iPhone and iPad Apps on Apple Silicon Macs" is on, so until a macOS build is approved, Mac testers get the iPhone build. The Beta App Description is shared by both platforms and still describes an iPhone-only app. The beta's public name is the App Store Connect app name, "OpenPocket Private".

2026-11-21 changes: the Beta App Description in App Store Connect now covers iPhone and Mac (the copy above; confirmed saved after a reload). `docs/privacy.md` (new Mac section, effective 21 November 2026) and `docs/public-beta.md` (iPhone and Mac) were republished to the Gist with `gh gist edit` and match the repository. Beta users' "Test iPhone and iPad Apps on Apple Silicon Macs" is now Not Available (Apple Vision Pro left Available). Renaming the app to "OpenPocket" failed: App Store Connect reports the name is already used, so the app (and the public join page) is still "OpenPocket Private"; another name is the maintainer's choice.

The Beta App Review notes in App Store Connect are shared by both platforms; on 2026-11-21 a Mac paragraph was appended (text in [mac-release.md](mac-release.md)), and the macOS build was added to Beta users and submitted for review.
