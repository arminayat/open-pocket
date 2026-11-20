# Folder structure

- `src/app`: Expo Router screens and native tabs; each tab is a folder (`(tabs)/<tab>/_layout.tsx` stack + `index.tsx` screen; pushed pages such as `recordings/[id].tsx` live beside it).
- `src/components`: common screens, error alert, playback, setup stepper, optional ChatGPT connection card, transcription/iCloud settings, transcript preview and sheet, read-only summary placeholder, editable recording notes, shared `Sheet` and `ActionButton`, tab stack.
- `src/contexts`: theme, Pocket device/session state, independent ChatGPT/transcription/notes state, and iCloud composition of their durable data.
- `src/lib/account`: OAuth/MCP lookup and pure response helpers.
- `src/lib/chatgpt`: ChatGPT OAuth, account/session ownership, HTTP and pure validation helpers. `src/lib/oauth-session.ts` serializes the shared native sign-in session across providers.
- `src/lib/pocket`: BLE connection, inbox, protocol, transfer orchestration, types.
- `src/lib/transcription`: fixed provider metadata, pure API adapters, request validation, serialized controller, durable-state parsing, and native transport wrapper.
- `src/lib/ai`: AI provider registry, trusted-URL requests, summary/title generation and model discovery, saved settings/summary validation, automatic-candidate selection, OpenRouter PKCE sign-in, and the controller.
- `src/lib/notes`: pure note validation, revision ordering, and serialized edits/imports.
- `src/lib/icloud`: account-bound consent controller, archive schema/path validation, deterministic text ordering, and injectable reconciliation engine.
- `src/storage`: separate Pocket/ChatGPT/transcription/iCloud-preference Keychain records, app settings, recording library, transcripts, notes, and shared snapshot publication.
- `modules/pocket-wifi`: Swift hotspot/socket/decoder, OAuth relay, ChatGPT ID-token verifier, and wrapper.
- `modules/pocket-transcription`: independent native disk-streamed HTTPS uploader; no recorder transport responsibilities.
- `modules/pocket-icloud`: native iCloud availability/session handling, document discovery, coordinated streaming/publication, path/hash policy, and synthetic Swift checks.
- `mac/`: OpenPocket for Mac (Swift package). `Sources/OpenPocket/Pocket` (BLE, Keychain), `Dictation` (audio devices, hotkey, MP3 → Pocket Mic, OpenWhispr history), `Gestures` (detector, location model, rules/actions, calibration, offline tools), `Views` (Theme tokens and components, one file per screen, snapshots); `Resources` (app icon, font + OFL, default location samples); `build-app.sh` (local or signed build), `release.sh` (Developer ID, notarized zip into ignored `mac/build/release`), `make-icon.swift` (regenerates `AppIcon.icns` from the iPhone icon).
- `driver/`: Pocket Mic virtual audio device (`PocketMic.cpp`, `Info.plist`, `build.sh`, `install.sh`, `tests/`, vendored `third_party/libASPL`).
- `cli/`: the earlier `pocket` Python CLI (`pyproject.toml`, `src/pocket`).
- `docs/mac-release.md`: Mac release setup, steps and why the Mac app isn't on TestFlight.
- `docs/testflight.md`: external beta submission status and operating notes. `docs/public-beta.md` and `docs/privacy.md` are the source copies of public GitHub Gist documents used by App Store Connect; publishing those files is separate from pushing this private repository.
- `docs/research`: dated source-backed provider comparisons; implementation truth stays in code and these agent notes.
- `plugins`: durable Expo native configuration, iCloud container entitlements/Files visibility, and pod source patches.
- `scripts`: release tooling (`testflight.sh`: TestFlight archive and upload with external-testing eligibility, saved per build under ignored `build/testflight/build-<number>`; `app-icon.swift`: renders `assets/images/icon.png` via `npm run icon`).
- `tests`: synthetic protocol, cancellation, account, diagnostic, notes, and iCloud reconciliation/consent/import checks.

Keep files below roughly 500 lines. Generated native directories, dependencies, exports, and caches are ignored.
