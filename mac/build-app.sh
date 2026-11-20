#!/bin/bash
# Build OpenPocket.app with the Pocket Mic driver inside. Needs only the Xcode
# Command Line Tools for a local build; release.sh uses it for releases.
#
# Usage: mac/build-app.sh [release|debug]
#   SIGN_IDENTITY  codesign identity; "-" (ad-hoc, this Mac only) by default.
#                  Any other identity also turns on the hardened runtime and a
#                  secure timestamp, as notarization requires.
#   UNIVERSAL=1    build for Apple silicon and Intel (needs Xcode, not just the
#                  Command Line Tools); this Mac's architecture otherwise.
#   BUILD_NUMBER   CFBundleVersion; Info.plist's value otherwise.
#   APP_STORE=1    the sandboxed TestFlight variant (testflight.sh): compiled with APP_STORE, the
#                  iPhone app's bundle ID so it joins the same App Store Connect app, and the
#                  entitlements in OpenPocket-AppStore.entitlements.
set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${1:-release}"
APP="build/OpenPocket.app"
DRIVER="../driver/build/Pocket Mic.driver"
IDENTITY="${SIGN_IDENTITY:--}"

BUILD=(-c "$CONFIG")
[[ "${UNIVERSAL:-}" != 1 ]] || BUILD+=(--arch arm64 --arch x86_64)
# Its own scratch folder, so switching variants doesn't rebuild everything.
[[ "${APP_STORE:-}" != 1 ]] || BUILD+=(--scratch-path .build/app-store -Xswiftc -DAPP_STORE)
swift build "${BUILD[@]}"
BINARY="$(swift build "${BUILD[@]}" --show-bin-path)/OpenPocket"
[[ -d "$DRIVER" ]] || ../driver/build.sh

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINARY" "$APP/Contents/MacOS/OpenPocket"
cp Info.plist "$APP/Contents/Info.plist"
[[ "${APP_STORE:-}" != 1 ]] ||
  plutil -replace CFBundleIdentifier -string com.nestorcodecrafters.openpocket "$APP/Contents/Info.plist"
[[ -z "${BUILD_NUMBER:-}" ]] || plutil -replace CFBundleVersion -string "$BUILD_NUMBER" "$APP/Contents/Info.plist"
cp -R "$DRIVER" "$APP/Contents/Resources/"
cp Resources/AppIcon.icns Resources/Fonts/InstrumentSerif-Regular.ttf Resources/Fonts/OFL.txt \
  Resources/location-samples-default.json "$APP/Contents/Resources/"

if [[ "$IDENTITY" == - ]]; then
  SIGN=(--force --sign -)
else
  SIGN=(--force --sign "$IDENTITY" --options runtime --timestamp)
fi
APP_SIGN=("${SIGN[@]}")
[[ "${APP_STORE:-}" != 1 ]] || APP_SIGN+=(--entitlements OpenPocket-AppStore.entitlements)
# Inside out: the driver first, then the app that seals it.
codesign "${SIGN[@]}" "$APP/Contents/Resources/Pocket Mic.driver"
codesign "${APP_SIGN[@]}" "$APP"
echo "Built $APP ($(lipo -archs "$APP/Contents/MacOS/OpenPocket"))"
