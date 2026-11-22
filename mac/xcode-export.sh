# Sourced by release.sh and testflight.sh. SwiftPM makes no Xcode archive, so this wraps a signed
# app in a minimal one and has `xcodebuild -exportArchive` sign and upload it with the
# account Xcode is signed in to, so there are no passwords or API keys to set up.

# xcode_export <signed .app> <work folder> <method> <team> <version> <build>
#   method: developer-id (upload to the notary service) or app-store-connect (upload to TestFlight)
xcode_export() {
  local app="$1" work="$2" method="$3" team="$4" version="$5" build="$6"
  local archive="$work/OpenPocket.xcarchive"
  local identity bundle name
  name=$(basename "$app")
  identity=$(codesign -dvv "$app" 2>&1 | sed -n 's/^Authority=//p' | head -n 1)
  bundle=$(plutil -extract CFBundleIdentifier raw -o - "$app/Contents/Info.plist")
  rm -rf "$archive"
  mkdir -p "$archive/Products/Applications"
  ditto "$app" "$archive/Products/Applications/$name"
  cat > "$archive/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ApplicationProperties</key>
  <dict>
    <key>ApplicationPath</key><string>Applications/$name</string>
    <key>Architectures</key><array><string>arm64</string><string>x86_64</string></array>
    <key>CFBundleIdentifier</key><string>$bundle</string>
    <key>CFBundleShortVersionString</key><string>$version</string>
    <key>CFBundleVersion</key><string>$build</string>
    <key>SigningIdentity</key><string>$identity</string>
    <key>Team</key><string>$team</string>
  </dict>
  <key>ArchiveVersion</key><integer>2</integer>
  <key>CreationDate</key><date>$(date -u +%Y-%m-%dT%H:%M:%SZ)</date>
  <key>Name</key><string>OpenPocket</string>
  <key>SchemeName</key><string>OpenPocket</string>
</dict>
</plist>
EOF
  cat > "$work/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>$method</string>
  <key>destination</key><string>${XCODE_EXPORT_DESTINATION:-upload}</string>
  <key>teamID</key><string>$team</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
EOF
  if ! xcodebuild -exportArchive -archivePath "$archive" -exportPath "$work/export" \
    -exportOptionsPlist "$work/ExportOptions.plist" -allowProvisioningUpdates > "$work/export.log" 2>&1; then
    grep -v Progress "$work/export.log" | tail -20
    echo "The export failed. Is Xcode signed in to team $team (Xcode › Settings › Accounts)? The" >&2
    echo "full log is $work/export.log, and the .xcdistributionlogs folder it names has more." >&2
    return 1
  fi
}
