# Pocket iCloud Documents

An iOS Expo module for opt-in, account-bound iCloud Drive recording folders. The container identifier comes from `OpenPocketICloudContainerIdentifier` in Info.plist. Provisioning and iCloud entitlements are configured by the app, not by this module.

The wrapper synchronously reserves an account-bound session before resolving the container off the main thread. `close()` immediately revokes that session; every coordinated publication checks it again. Account-change notifications revoke it and emit `change`. Long audio copying and hashing use 64 KiB chunks, while final publication uses an exclusive atomic rename. API keys and account credentials never enter cloud files.

Documents contain one folder per recording, ending in its audio SHA-256. Supported files are `audio.mp3`, `recording.json`, immutable `transcript-<sha>.json` / `.txt` and `summary-<sha>.json` / `.md`. Text is limited to 8 MB and audio to 2 GB. Existing differing bytes and unresolved iCloud versions are preserved and reported as conflicts. No remote deletion or automatic conflict resolution exists.

`NSMetadataQuery` discovers cloud-only documents. Scans distinguish downloaded bytes, pending uploads, uploaded files, and conflicts; saving to the local ubiquitous container does not mean Apple has uploaded it. Reads request missing downloads and return `null` while pending. Imports verify exact size and SHA-256 before publishing `Documents/recordings/icloud_<sha>.mp3`. Disabling app sync cannot recall files already handed to Apple's sync system.

Synthetic checks exercise path isolation, symlink rejection, bounded streaming, exact hashes, immutable publication, cancellation and account-session revocation using temporary files and injected identities. They do not query a real account. A signed build and two same-account devices are still needed to verify iCloud propagation and Files/Finder visibility.

## Native checks

Run `npm run test:icloud-native` from the repository root for the synthetic checks. After installing the app's pods, the following checks every Swift source against the installed iOS arm64 Expo frameworks without launching the app or accessing iCloud:

```sh
python3 - <<'PY'
import glob, subprocess
sdk = subprocess.check_output(['xcrun', '--sdk', 'iphoneos', '--show-sdk-path'], text=True).strip()
command = ['xcrun', 'swiftc', '-typecheck', '-module-cache-path',
           '/private/tmp/openpocket-icloud-ios-swift-cache',
           '-target', 'arm64-apple-ios16.4', '-sdk', sdk]
frameworks = glob.glob('ios/Pods/**/*.xcframework/ios-arm64', recursive=True)
frameworks += glob.glob('node_modules/expo-modules-jsi/apple/Products/*.xcframework/ios-arm64')
for path in sorted(frameworks):
    command += ['-F', path]
command += ['-I', 'ios/Pods/Headers/Public', '-Xcc',
            '-Wno-non-modular-include-in-framework-module']
command += sorted(glob.glob('modules/pocket-icloud/ios/*.swift'))
subprocess.run(command, check=True, timeout=60)
PY
```

This checks source/bridge types; it does not replace a full signed app build or verify Apple's provisioning and sync service.
