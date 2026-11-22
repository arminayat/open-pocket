# Open Pocket Privacy Notice

Effective 21 November 2026. Applies to the Open Pocket beta for iPhone and Mac, version 0.1.0.

Open Pocket is published by Nestor Code Crafters UG (haftungsbeschränkt). For privacy questions or requests, contact **hi@arminayat.com**.

## iPhone: recordings and information on your device

Open Pocket downloads recordings directly from your Pocket recorder over Bluetooth or local Wi-Fi. Audio, recording metadata, transcripts, AI summaries, and notes are saved in the app's local storage. The app has no server operated by Open Pocket for storing your recording library and no separate Open Pocket user account.

Device connection credentials, selected provider API keys, ChatGPT account registrations and tokens, and iCloud account-binding settings are stored in iOS Keychain with device-only accessibility. Pocket cloud authentication tokens are not retained; a derived device credential and account label may be retained for connecting to your recorder. Saving a key is not an audio upload. Some provider setup and model-list operations contact the selected provider using your credentials.

## iPhone: services you choose to use

- **Pocket account access:** signing in or looking up your recorder key contacts Pocket's authentication and account services. Direct recorder access uses the device credential.
- **Transcription:** a manual transcription request, or explicitly enabling automatic transcription for a provider, sends recording audio to the provider you select: OpenAI, Deepgram, AssemblyAI, ElevenLabs, or Groq. Provider processing, retention, and charges depend on that service and your account. Open Pocket does not automatically delete content held by those services.
- **AI titles and summaries:** a manual generation request, or enabling automatic summaries, sends completed transcript text to the AI provider you select: OpenAI/ChatGPT, Anthropic, or OpenRouter and its selected model provider. ChatGPT sign-in is separate from Pocket access and does not provide audio transcription. Provider account and privacy terms apply.
- **iCloud Drive:** sync is off by default. If enabled, it copies audio, recording metadata, completed transcripts, summaries, and saved notes into your Apple account's Open Pocket iCloud Drive folder. Other devices using that account may import those files. Sync does not include credentials, API keys, unfinished transcription jobs, or diagnostics. Earlier text revisions may remain in the cloud folder.
- **Sharing:** iOS sharing sends the files or text you select to the recipient or app you choose.

These services receive the content needed for the selected feature and ordinary network information such as your IP address. They operate under their own privacy terms and may process information in other countries. Provider privacy and pricing links are available in the app's settings. Do not enable an optional service unless you are comfortable with its handling of your content.

## Mac

Open Pocket for Mac connects to your Pocket recorder over Bluetooth. It makes no network requests of its own and has no transcription, AI, or iCloud features in this beta.

- **Pocket key:** the recorder key you enter is stored in the Mac's Keychain.
- **Dictation:** when you press the recorder's side button, Open Pocket switches your Mac's default input to Pocket Mic, a virtual microphone you install, streams the recorder's microphone into it, and presses your dictation app's shortcut. Your dictation app (for example OpenWhispr, Wispr Flow, or Superwhisper) receives that audio and handles it under its own privacy terms, which may include sending it to its own transcription service. Open Pocket then switches your usual input back.
- **Recent dictations:** if OpenWhispr is installed, Open Pocket reads its history on your Mac, read only, to show the text of recent dictations. That text stays on your Mac.
- **Gestures:** while gestures are on, Open Pocket starts a recording on the recorder so its audio streams to the Mac. The recorder keeps that recording like any other.
- **Tap training:** the calibration analyzes audio on your Mac. You can choose to keep a session (its audio and prompt timings) in the app's storage on your Mac.
- **Accessibility:** Open Pocket uses this macOS permission only to press the keyboard shortcuts and media keys you configure. It does not read what is on your screen.
- Settings, gesture actions, dictation timings, and the tap model are stored on your Mac.

## Diagnostics, beta feedback, and support

The iPhone app keeps diagnostic information for troubleshooting and can export a report when you request it. It attempts to redact credentials and identifiers; review a report before sharing it. No advertising SDK or cross-app advertising tracking is implemented in this beta.

Apple operates TestFlight and may collect beta usage, crash information, and feedback under its terms and privacy policy, and make relevant reports available to the developer. If you send feedback or email support, the developer receives the contact details and content you include and uses them to respond and investigate the issue. Avoid including private recordings or credentials in those messages.

## Controls and retention

Local recordings and saved text remain in app storage until removed with the app's data. Forgetting a recorder connection or removing a provider key does not delete saved recordings. ChatGPT sign-out removes session tokens but retains saved account registration information for reconnection; iOS Keychain items may survive app deletion, so use the app's credential controls before deleting it when possible.

On the Mac, removing the app removes its settings and saved calibration sessions. Remove the Pocket key in Keychain Access if it remains, and Pocket Mic by deleting it from `/Library/Audio/Plug-Ins/HAL`.

Disabling iCloud sync retains existing local and cloud copies. Delete cloud files separately in Files/Finder if desired; while sync is enabled, remaining local copies can be published again. The app does not propagate cloud deletions to local copies. Uninstalling the app does not remove copies in iCloud, recipient apps, or provider systems.

Cancelling a request or removing a key cannot guarantee remote cancellation, avoid charges already incurred, revoke the provider's credential, or delete provider-held content. Manage those controls directly with the relevant provider.

You can ask about, access, correct, or request deletion of personal information you have sent to the developer by emailing **hi@arminayat.com**. Requests about provider-held or iCloud information should also be directed to the corresponding service. Applicable legal retention obligations may limit deletion of support records.

## This page

This notice and the beta information page are hosted on GitHub Gist. GitHub handles visits to those pages under its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). App data handling changes will be reflected in an updated notice.
