# Pocket Transcription

Local iOS Expo module for explicit transcription uploads. The TypeScript adapter in
`src/lib/transcription/transport.ts` uses this module for audio and `expo/fetch` for JSON requests.
It is unavailable in Expo Go and older development builds; run `npm run ios:pods` and rebuild the app
after adding or changing native sources. No extra npm dependency or native entitlement is required.

The module accepts only the fixed HTTPS upload endpoints for OpenAI, Groq, ElevenLabs, Deepgram,
and AssemblyAI. It rejects redirects before following them and does not implement POST retries.
API headers are never logged. Authentication challenges do not resend credentials or upload bodies.

Audio must be a nonempty, regular `.mp3` directly inside the app's Documents/recordings directory.
Symlinks and paths outside that directory are rejected. OpenAI/Groq files are limited to 25 MB;
the other providers are limited to 500 MB. The module copies 64 KB chunks to a temporary raw or
multipart body on disk, then uses a URLSession file upload. Multipart uses the field `file` and
the generic filename `recording.mp3`. Audio never crosses the JavaScript bridge as file contents.
Temporary staging needs approximately one additional recording's worth of free disk space.

The synchronous `reserve`/`cancel` methods make cancellation valid before asynchronous upload
preparation begins. Preparation checks cancellation between bounded reads/writes. Success, errors,
and cancellation remove temporary bodies; a killed app may leave temporary files for iOS to purge.
The complete operation is limited to 20 minutes, and response bodies are limited to 8 MB.
Stopping locally cannot guarantee the provider has stopped processing or charging for an upload.

Run `npm run test:transcription-native` for synthetic URL, path, size, byte-preservation,
cancellation, cleanup, and redirect checks. These checks use no network, real audio, or credentials.
Native compilation and synthetic tests do not establish successful provider uploads on an iPhone.
