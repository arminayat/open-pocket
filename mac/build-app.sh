#!/bin/bash
# Build OpenPocket.app (this Mac's architecture), with the Pocket Mic driver
# inside, ad-hoc signed. Needs only the Xcode Command Line Tools.
set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${1:-release}"
APP="build/OpenPocket.app"
DRIVER="../driver/build/Pocket Mic.driver"

swift build -c "$CONFIG"
[[ -d "$DRIVER" ]] || ../driver/build.sh

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp ".build/$CONFIG/OpenPocket" "$APP/Contents/MacOS/OpenPocket"
cp Info.plist "$APP/Contents/Info.plist"
cp -R "$DRIVER" "$APP/Contents/Resources/"
cp Resources/Fonts/InstrumentSerif-Regular.ttf Resources/Fonts/OFL.txt Resources/location-samples-default.json "$APP/Contents/Resources/"

codesign --force --sign - "$APP/Contents/Resources/Pocket Mic.driver"
codesign --force --sign - "$APP"
echo "Built $APP"
