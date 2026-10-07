# OpenPocket

An iPhone MVP for direct access to an already-activated Pocket recorder. Built from Armin's Expo boilerplate with Expo 57, TypeScript, HeroUI Native, and Uniwind.

## What it does

- Connect through Pocket OAuth, a personal API key, or an existing device key.
- Scan for nearby recorders, authenticate, and display battery and firmware.
- List recordings and download one over Bluetooth or Pocket's own Wi-Fi hotspot.
- Keep separate Bluetooth and Wi-Fi copies for comparing transfer results.
- Play and share downloaded MP3s, including while disconnected.
- Export diagnostics with credentials and identifiers redacted.

Account-derived device authentication is experimental. OAuth callback support, identity equivalence, and firmware behavior must be confirmed with a physical recorder. The official app is still required for first activation.

## Run on your iPhone

Requires Node 22.13+ (see `.nvmrc`), npm, Xcode, CocoaPods, and Apple development signing. Enable Developer Mode on the iPhone.

```sh
cd ~/Projects/OpenPocket
npm install
npm run ios:device
```

Select your connected iPhone. If signing needs configuration, open `ios/OpenPocket.xcworkspace`, select the OpenPocket target, and choose your Apple development team under Signing & Capabilities. The app needs Hotspot Configuration, Bluetooth permission, and Local Network permission; the Expo configuration/plugin regenerates these settings.

For subsequent JavaScript changes:

```sh
npm start
```

Use the installed development build. Expo Go cannot run the BLE or local Wi-Fi module. Rebuild after native dependency, module, or config-plugin changes. No backend, environment secrets, or database migrations are required.

## First hardware test

1. Make sure the recorder works in the official Pocket app; close that app and release connections on other phones.
2. Open OpenPocket → Device → Sign in to Pocket using the activating account.
3. Wake the recorder, scan, and connect. Only an acknowledged device key is saved in Keychain.
4. In Recordings, download a short file with Bluetooth, listen, and share it.
5. Download the same file with Wi-Fi. Accept the iOS hotspot prompt and Local Network permission. Compare the two exported MP3 files with a SHA-256 tool.
6. Disconnect/reconnect and test saved credentials with internet unavailable.
7. Test denied permissions and cancellation; incomplete files must never appear in the saved library.

If Pocket rejects OAuth client registration, use Advanced connection → Personal API key from Pocket Settings → Developer → API Keys. If the derived key fails, use an independently obtained device key to isolate account derivation from transport behavior. A cloud API key is never sent as a device key.

## Checks

```sh
npm run check
npm run doctor
npm run export:ios
npm run test:wifi-native
```

Native modules live under `modules/pocket-wifi`; iOS projects are generated and ignored. Tests use synthetic responses and a portable Swift stream decoder. Simulator/native compilation cannot validate recorder connectivity or real hotspot joining. Browser testing is excluded.

## Current validation (2026-10-07)

TypeScript, lint, 37 synthetic tests, Swift decoder checks, Expo dependency alignment, all 21 Expo Doctor checks, and the iOS export pass. Native Simulator and unsigned arm64 iPhone builds pass. The simulator opens all three screens and the advanced/theme controls.

Physical iPhone installation was attempted with existing development signing but Xcode could not mount its Developer Disk Image. Developer Mode is enabled; unlock the connected phone, then rerun `npm run ios:device`. OAuth, device-key acceptance and both hardware transfers remain unverified.

The inherited Expo/Metro dependency graph has npm audit advisories (3 moderate, 21 high). Compatibility checks pass; unsupported force upgrades were not applied.

## Boundaries

One foreground transfer at a time. Keep OpenPocket open; downloads restart from the beginning after interruption. Each Wi-Fi download starts and ends its own hotspot session. Completed downloads remain in the app until it is uninstalled. Forgetting the connection removes saved credentials and keeps local recordings.

This MVP has no firmware modification, factory activation, device recording deletion, transcription, background synchronization, or Android device support. It does not upload recording content.

## Protocol attribution

Protocol behavior and identifiers are based on [Pocket Libre](https://github.com/shahcolate/pocket-libre), commit `42fad3b838b9507f25c6544875e2f4c8b07db763`. Derived implementation retains Shah Baig's MIT notice in `THIRD_PARTY_NOTICES.md`. Account derivation is supported by public vendor source and hardware reports; it is not an official third-party device API guarantee.
