# OpenPocket

An iPhone MVP for direct access to an already-activated Pocket recorder. Built from Armin's Expo boilerplate with Expo 57, TypeScript, HeroUI Native, and Uniwind.

> **Unofficial project.** OpenPocket is independent and non-commercial. It is not affiliated with, endorsed by, or supported by Open Vision Engineering, Inc., the maker of Pocket. See [Disclaimer](#disclaimer).

## What it does

- Connect through Pocket OAuth, a personal API key, or an existing device key.
- Optionally connect ChatGPT during setup or in Settings for future AI features; manage saved accounts and sign out independently of Pocket.
- Scan for nearby recorders, authenticate, and display battery and firmware.
- List recordings and automatically download new ones over Bluetooth; Wi-Fi transport is implemented but has no manual UI.
- Keep separate Bluetooth and Wi-Fi copies for comparing transfer results.
- Play and share downloaded MP3s, including while disconnected.
- Transcribe downloaded recordings with your own OpenAI, Deepgram, AssemblyAI, ElevenLabs, or Groq API key, then view/share locally saved text.
- Write and edit your own notes for each saved recording and get an AI title and summary from ChatGPT (your plan), OpenAI, Claude, or OpenRouter.
- Optionally sync audio, completed transcripts, AI summaries, and notes through visible per-recording folders in iCloud Drive.
- Export diagnostics with credentials and identifiers redacted.

Account-derived device authentication is experimental. OAuth callback support, identity equivalence, and firmware behavior must be confirmed with a physical recorder. The official app is still required for first activation.

## OpenPocket for Mac

[`mac/`](mac) is a native macOS app with a window and a menu-bar icon. It has
two features:

- **Dictate:** press the Pocket's button, talk, press again, and your hotkey
  dictation app (OpenWhispr, Wispr Flow, …) types it. OpenPocket routes the
  Pocket's live audio through **Pocket Mic**, a virtual microphone in
  [`driver/`](driver) built on MIT-licensed libASPL.
- **Gestures:** taps and swipes on the Pocket's back, picked up by its contact
  mic, trigger actions you choose. A guided calibration teaches it your taps.

[`cli/`](cli) is the `pocket` Python command it grew from. Build with
`mac/build-app.sh`; details in [mac/README.md](mac/README.md). Releases are
Developer ID–signed, notarized zips made by `mac/release.sh`
([docs/mac-release.md](docs/mac-release.md)). iCloud Recordings isn't connected
on the Mac yet.

## Run on your iPhone

Requires Node 22.13+ (see `.nvmrc`), npm, Xcode, CocoaPods, and Apple development signing. Enable Developer Mode on the iPhone.

```sh
cd ~/Projects/OpenPocket
npm install
npm run ios:device
```

Select your connected iPhone. If signing needs configuration, open `ios/OpenPocket.xcworkspace`, select the OpenPocket target, and choose your Apple development team under Signing & Capabilities. The app needs Hotspot Configuration, iCloud Documents capability, Bluetooth permission, and Local Network permission; the Expo configuration/plugin regenerates these settings.

For subsequent JavaScript changes:

```sh
npm start
```

### TestFlight build

The [public beta link](https://testflight.apple.com/join/qkq1GB2v) is enabled; build 0.1.0 (5) was submitted for Beta App Review on 5 November 2026 and is awaiting Apple approval before testers can join. See [release status](docs/testflight.md) and the [privacy notice](https://gist.github.com/arminayat/e19411ea87e00624cc029ecedbf51635#file-privacy-md).

`npm run ios:testflight` prebuilds, archives a Release build, and uploads it to App Store Connect with external TestFlight eligibility. Signing and upload use the Apple account signed in to Xcode (team from `app.json`). The App Store Connect app record for `com.nestorcodecrafters.openpocket` must exist, and `expo.ios.buildNumber` in `app.json` must be raised before every upload. Archives and export options are saved under `build/testflight/build-<number>`. After Apple finishes processing, add the build to an external testing group, complete Test Information and Beta App Review details, and submit it for Beta App Review. Enable the group's public link to let testers join; availability depends on Apple approval. Uploading does not publish the app to the App Store. The earlier build 4 was uploaded as internal-only and cannot be used for external testing.

Use the installed development build. Expo Go cannot run the BLE or local Wi-Fi module. Rebuild after native dependency, module, or config-plugin changes. No backend, environment secrets, or database migrations are required.

ChatGPT sign-in adds a native ID-token verifier. For an existing checkout, run `npm run ios:pods` and rebuild with `npm run ios:device` before using it. It uses OpenAI's [open-source/local-app sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), with dynamic registration, PKCE, and the existing loopback callback. No OpenAI API key or client secret is needed for that sign-in. Credentials are stored in device-only Keychain; account registrations survive sign-out for later reconnection. This is an account connection only: ChatGPT generation is not implemented, and this ChatGPT flow does not support audio transcription. Real iPhone sign-in still needs acceptance testing.

## Transcription with your own API key

The [provider research](docs/research/transcription-providers.md) compares current models, pricing, limits, privacy, and adoption evidence. The initial integration offers five prominent providers; it does not claim a measured market-share or accuracy ranking.

1. Rebuild the development app after installing Pods (`npm run ios:pods`, then `npm run ios:device`). Transcription adds the independent native `pocket-transcription` upload module; a JavaScript reload alone is insufficient.
2. Open Settings → Transcription, choose a provider, and save your API key. Keys use device-only Keychain. Saved means stored, not verified against the provider; saving a key makes no paid request.
3. On a downloaded recording, choose Transcribe and confirm the named provider, audio upload, and charges to your API account. ChatGPT subscriptions do not cover these requests. Keep OpenPocket open; uploads use your internet connection.
4. View/select/share the saved transcript. AssemblyAI jobs can be resumed after interruption; other ambiguous requests are never automatically retried, and a new attempt may incur another charge.

OpenAI/Groq direct uploads are limited to 25 MB. The app caps Deepgram/AssemblyAI/ElevenLabs at 500 MB; AssemblyAI and ElevenLabs also have a 10-hour limit. Files are never silently truncated or split. Deepgram requests opt out of model improvement. Other provider retention/training rules depend on the account; use the privacy links in Settings. Cancelling/backgrounding stops local work but cannot guarantee remote cancellation or prevent billing. Removing a key does not revoke it or delete provider content. No remote deletion is implemented. Transcripts are saved under Documents/transcripts and can also sync when iCloud is enabled; failed local saves preserve the result in memory for viewing/sharing and a save-only retry.

No new environment variables, server, npm dependency, or database migration is required. Use a separately authorized real-device request to validate each provider account, its billing/retention settings, and quality on Pocket audio; synthetic checks do not prove those outcomes.

## iCloud sync and editable notes

Settings → iCloud sync is off by default. Turning it on confirms copying this device’s saved library to the current Apple account. OpenPocket reconciles while open, when library/text changes, after foregrounding, and periodically. The same account must have iCloud Drive enabled on each device. On another OpenPocket installation, enable sync to import the audio and text without reconnecting the recorder or adding transcription keys. Mac and other Apple devices can access the files through Finder or Files; this change does not add a native Mac app.

Find the visible **iCloud Drive → OpenPocket** folder. Each day has a folder, and each recording a folder inside it named by its time plus its AI title once summarized (for example `2026-10-20/14.00 – Budget review`; older checksum-named folders are renamed automatically, and folders you rename yourself are kept), containing `audio.mp3`, `recording.json`, and any completed `transcript-<revision>.txt` / `.json` and saved `note-<revision>.md` / `.json` and AI `summary-<revision>.md` / `.json` files. JSON is the app import format; plain text and Markdown are readable exports. Edit notes inside OpenPocket. Earlier text versions are kept, including concurrent edits; the app chooses a deterministic latest version. It does not import edits made to the readable export files or propagate deletion.

A recording's Notes card (Add note / Edit) saves your text locally, even with iCloud off. The Summary card is read-only: titles and summaries are written by the AI provider chosen in Settings → AI. Unsaved drafts and failed saves stay in the editor; incoming changes require reviewing the saved version before overwriting it. Only durably saved text is published to iCloud. Credentials, API keys, provider job IDs, and diagnostics never enter the archive. Audio imports verify SHA-256 and exact size before appearing in the library.

Turning sync off immediately revokes app writes and retains both local and cloud files; Apple may finish transfers already queued. A different iCloud account pauses sync until the user opts in again. Settings distinguishes pending transfers, conflicts, errors, and the last folder check. A successful local check does not prove that another device has received the files. Keep earlier revisions/conflicting files until reviewed.

### Native setup and acceptance

1. In Apple Developer / Xcode Signing & Capabilities, enable **iCloud Documents** for App ID `com.nestorcodecrafters.openpocket`, create/assign container `iCloud.com.nestorcodecrafters.openpocket`, and refresh the provisioning profile. The repository does not configure the Apple portal. Keep Hotspot Configuration enabled too.
2. Run `npx expo prebuild --platform ios --no-install`, `npm run ios:pods`, then `npm run ios:device`. The new native module and entitlements require a rebuilt app; JavaScript reload is insufficient. The durable Expo config now matches the existing native bundle ID/team and uses build number 2. The custom iCloud plugin supplies CloudDocuments entitlements and public Documents-folder metadata directly; no document-picker dependency is required.
3. On two signed devices using the same Apple account, enable iCloud Drive and app sync. Download a short recording, transcribe it if desired, save a note, and verify the files in Files/Finder and playback/text in the second app. Test an offline note edit on both devices, reconnect, and confirm both versions remain in the folder.
4. Turn sync off, edit locally, and verify no new app publications. Check unavailable iCloud/storage errors and account-change re-consent. These are device acceptance steps, not outcomes established by synthetic tests.

No backend, new environment variable, paid service, or database migration is required. Local library/transcript snapshots remain compatible; cloud imports and note snapshots are additive.

## First hardware test

1. Make sure the recorder works in the official Pocket app; close that app and release connections on other phones.
2. Open OpenPocket → Settings and follow the setup steps at the top: sign in to Pocket using the activating account.
3. Wake the recorder, scan, select it, and connect. The signed-in candidate key is kept in Keychain until the recorder accepts it, then saved as the verified connection.
4. In Recordings, wait for a short file to download automatically over Bluetooth, listen, and share it. Enable automatic download in Settings if needed.
5. Wi-Fi comparison requires a development entry point; the current UI has no manual transport selection. When testing that transport, accept the hotspot/Local Network prompts and compare exported MP3 files with SHA-256.
6. Disconnect/reconnect and test saved credentials with internet unavailable.
7. Test denied permissions and cancellation; incomplete files must never appear in the saved library.

Pocket rejects custom-scheme redirects, so sign-in registers a temporary `http://127.0.0.1:<port>/callback` relay served by the native module. If Pocket rejects OAuth client registration, use Advanced connection → Personal API key from Pocket Settings → Developer → API Keys. If the derived key fails, use an independently obtained device key to isolate account derivation from transport behavior. A cloud API key is never sent as a device key.

## Checks

```sh
npm run check
npm run doctor
npm run export:ios
npm run test:wifi-native
npm run test:chatgpt-native
npm run test:transcription-native
npm run test:icloud-native
```

Native modules live under `modules/pocket-wifi`, `modules/pocket-transcription`, and `modules/pocket-icloud`; iOS projects are generated and ignored. Tests use synthetic responses and native helpers. Simulator/native compilation cannot validate recorder connectivity, real hotspot joining, or provider acceptance. Browser testing is excluded.

## Current validation (2026-10-23)

TypeScript, lint, all 144 Node tests, the iOS bundle export, and 60 synthetic native iCloud checks pass. The final iCloud native core and full arm64 iOS Expo bridge typecheck against the installed frameworks. Expo config introspection and generated Info.plist/entitlements agree on the public OpenPocket Documents container; CocoaPods successfully registers `PocketICloud`. These checks used synthetic files and identities only, with no browser tests, real iCloud access, paid provider calls, or recording uploads.

The Apple developer container/capability/profile setup and a rebuilt signed app still need acceptance on two same-account devices. Files/Finder visibility, transfer timing, offline convergence, and actual account switching remain unverified. Full native builds attempted during earlier ChatGPT/transcription work stalled during Xcode compiler discovery; the new iCloud bridge was typechecked directly without repeating that full build. A JavaScript bundle export is not a signed native app build.

On a physical iPhone (2026-10-22, firmware 1.8), Pocket OAuth sign-in, account-derived key acceptance, device info, and recording listing worked. Bluetooth/Wi-Fi downloads, live ChatGPT connection, and real transcription-provider acceptance remain separate device/provider checks. Earlier portable decoder, OAuth relay, ID-token, and upload tests are described in their module READMEs and test scripts.

Expo's compatibility check still reports existing package-version mismatches. The inherited Expo/Metro dependency graph also had npm audit advisories (3 moderate, 21 high) in the earlier check; that audit was not rerun for iCloud. Dependencies were not upgraded as part of this feature.

## Boundaries

By default OpenPocket downloads each new recording automatically over Bluetooth (Settings → Download new recordings automatically). One transfer at a time. Bluetooth downloads continue in the background while the recorder is in range; keep OpenPocket open for Wi-Fi downloads. Interrupted downloads restart from the beginning. Each Wi-Fi download starts and ends its own hotspot session. Completed downloads remain in the app until it is uninstalled. Forgetting the connection removes saved credentials and keeps local recordings.

This MVP has no firmware modification, factory activation, device recording deletion, app-closed background transcription, or Android device support. Recording content is uploaded after explicit transcription confirmation (per recording, or once when turning on Transcribe automatically), user-initiated sharing, or enabling iCloud sync. Pocket sign-in, ChatGPT sign-in, and saving a transcription key do not upload recordings.

## Protocol attribution

Protocol behavior and identifiers are based on [Pocket Libre](https://github.com/shahcolate/pocket-libre), commit `42fad3b838b9507f25c6544875e2f4c8b07db763`. Derived implementation retains Shah Baig's MIT notice in `THIRD_PARTY_NOTICES.md`. Account derivation is supported by public vendor source and hardware reports; it is not an official third-party device API guarantee.

## Disclaimer

OpenPocket is an independent, unofficial, non-commercial project. It is not affiliated with, endorsed by, sponsored by, or supported by Open Vision Engineering, Inc. "Pocket" and related names are trademarks of their owner and appear here only to identify the recorder this app works with. OpenPocket uses no Pocket logos or branding.

OpenPocket exists for interoperability: it lets owners reach the recordings on their own already-activated recorders. It does not include Pocket's app code, firmware, or assets. It does not modify firmware or replace the official app's activation. Pocket account features use only Pocket's published sign-in, personal API key, and MCP interfaces.

The software is experimental and provided "as is", without warranty (see [LICENSE](LICENSE)). Using it may conflict with Pocket's Terms of Use and could affect your Pocket account or vendor support; that choice is yours. You are also responsible for following the recording-consent laws where you record. Nothing in this project is legal advice.
