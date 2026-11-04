#!/bin/sh
# Archives a Release build and uploads it to App Store Connect for TestFlight.
# External testing still requires Beta App Review and an external testing group.
# Signing and upload use the Apple account signed in to Xcode.
# Raise expo.ios.buildNumber in app.json before each upload.
set -eu
cd "$(dirname "$0")/.."

build=$(node -p "require('./app.json').expo.ios.buildNumber")
out="build/testflight/build-$build"
team=$(node -p "require('./app.json').expo.ios.appleTeamId")

LANG=en_US.UTF-8 npx expo prebuild --platform ios
rm -rf "$out"
mkdir -p "$out"
cat > "$out/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$team</string>
  <key>signingStyle</key><string>automatic</string>
  <key>testFlightInternalTestingOnly</key><false/>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
EOF

xcodebuild -workspace ios/OpenPocket.xcworkspace -scheme OpenPocket -configuration Release \
  -destination generic/platform=iOS -archivePath "$out/OpenPocket.xcarchive" \
  -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath "$out/OpenPocket.xcarchive" \
  -exportOptionsPlist "$out/ExportOptions.plist" -exportPath "$out" -allowProvisioningUpdates
