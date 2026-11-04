# External TestFlight

App Store Connect app: **OpenPocket Private**. Bundle ID: `com.nestorcodecrafters.openpocket`.

Build 0.1.0 (4) was uploaded as internal-only. It cannot be added to an external testing group. Build 0.1.0 (5) removes that upload restriction; Apple processing, Beta App Review, and public-link availability must be verified separately from a successful upload.

## Submission copy

### Beta app description

OpenPocket is an independent, unofficial iPhone app for owners of an already-activated Pocket recorder. Connect your recorder, download and play your recordings, share audio, and write notes. Optional features include transcription using your own provider API key, AI titles and summaries, and iCloud Drive sync. API providers may charge for usage. A compatible physical Pocket recorder is required to obtain recordings. OpenPocket is not affiliated with or supported by the maker of Pocket.

### What to test

- Connect an already-activated Pocket recorder through Settings and confirm it appears with battery and firmware information.
- Download a short recording over Bluetooth, then play and share it while disconnected.
- Add and edit a note on a saved recording.
- Optionally configure your own transcription provider API key and transcribe a short recording. Confirm the provider and potential charges before uploading.
- Optionally generate an AI title and summary from a completed transcript using your chosen AI provider.
- With iCloud sync enabled, check that audio and saved text appear in the OpenPocket folder in iCloud Drive. If you have a second installation on the same Apple account, check that it imports them.
- Report connection failures, interrupted downloads, playback problems, and sync conflicts through TestFlight feedback. Do not include API keys, device keys, private recordings, or unredacted account details.

### Beta App Review notes

This app works with a physical Pocket recorder that has already been activated using the manufacturer's app. It does not activate recorders, modify firmware, or delete recordings from the recorder. Recorder access uses the owner's Pocket sign-in, personal API key, or device key. There is no separate OpenPocket account or shared demo credential.

Without recorder hardware, the reviewer can open the app and inspect Settings, connection setup, and provider settings; the recording workflow requires hardware and an owner-authorized account/device key. Do not represent those workflows as reviewable without the hardware. If Apple needs a demonstration video or access arrangement, provide it before claiming review readiness.

Transcription and AI features are optional. API-key providers use the tester's own account and may incur provider charges. ChatGPT sign-in is separate from Pocket access and does not supply audio transcription. Audio uploads and transcript requests require the user's action or opt-in automatic processing. iCloud sync is off by default and requires explicit opt-in. Credentials stay in device-only Keychain.

## App Store Connect steps

1. Wait for build 0.1.0 (5) to finish processing and confirm it is eligible for external testing.
2. Complete Test Information with the beta description and the maintainer's verified feedback contact and any required URLs. Use real, reachable public URLs; the GitHub repository is private.
3. Complete Beta App Review Information with the maintainer's actual contact details and accurate hardware/sign-in requirements. Do not invent a demo account.
4. Create an external group named **Public Beta**, add build 5, and use the testing notes above.
5. Submit the build for Beta App Review. This is separate from App Store review and does not publish an App Store listing.
6. Enable the group's public link. Record the actual URL and Apple review status here once verified. Testers can install only when Apple permits external testing.

## Status

2026-11-04: build 0.1.0 (5) archived successfully, passed `codesign --verify --deep --strict`, and uploaded to Apple (`Uploaded OpenPocket`, `EXPORT SUCCEEDED`, exit 0). Export options explicitly set `testFlightInternalTestingOnly` to false. Archive and export metadata are retained under ignored `build/testflight/build-5`; future builds use this location outside generated `ios/`. Missing dSYM warnings for prebuilt frameworks did not prevent upload. Apple processing completion, external group, metadata, review submission, and public link are not yet verified. Browser access is disabled in this session; no configured App Store Connect API credentials or cached Fastlane session were found in the standard locations checked.
