#!/bin/bash
# Builds the sandboxed TestFlight variant of OpenPocket for Mac (Apple silicon and Intel) and
# uploads it to App Store Connect, to the same app as the iPhone version ("OpenPocket Private",
# bundle ID com.nestorcodecrafters.openpocket). Xcode signs it for the App Store and uploads it with
# the account it's signed in to, making the certificates and profile it needs itself.
# docs/mac-release.md has the rest; the notarized download with every feature is release.sh.
#
# Usage: mac/testflight.sh [--check]
#   --check  sign and export the .pkg into mac/build/testflight without uploading (the working tree
#            may be dirty)
#
#   TEAM_ID  the Apple team; G6WL4CPNV3 (Nestor Code Crafters) by default
set -euo pipefail
cd "$(dirname "$0")"
. ./xcode-export.sh

check=false
[[ "${1:-}" == --check ]] && check=true
team="${TEAM_ID:-G6WL4CPNV3}"
version=$(plutil -extract CFBundleShortVersionString raw -o - Info.plist)
# TestFlight wants a larger build number on every upload; the time gives one.
build=$(date -u +%Y%m%d%H%M)
out="build/testflight"

fail() { echo "$1" >&2; exit 1; }

# The archive is signed for development; the export re-signs it for the App Store.
identity=$(security find-identity -v -p codesigning | sed -nE 's/.*"(Apple Development: [^"]*)".*/\1/p' | head -n 1)
[[ -n "$identity" ]] || fail "No Apple Development certificate is in a keychain. Xcode › Settings › Accounts › Manage Certificates makes one."
if ! $check && [[ -n "$(git status --porcelain)" ]]; then
  fail "Commit or stash your changes first; uploads come from a commit."
fi

echo "OpenPocket for Mac $version ($build), TestFlight"
rm -rf "$out"
mkdir -p "$out"
rm -rf "../driver/build"
APP_STORE=1 UNIVERSAL=1 SIGN_IDENTITY="$identity" BUILD_NUMBER="$build" ./build-app.sh release
codesign -d --entitlements - build/OpenPocket.app 2>/dev/null | grep -q app-sandbox ||
  fail "The app isn't sandboxed; TestFlight would refuse it."

$check && export XCODE_EXPORT_DESTINATION=export
xcode_export build/OpenPocket.app "$out" app-store-connect "$team" "$version" "$build"
if $check; then
  echo "Done: mac/$out/export/OpenPocket.pkg (not uploaded)"
else
  grep -q "Uploaded OpenPocket" "$out/export.log" || fail "Xcode didn't report an upload; see mac/$out/export.log."
  echo "Uploaded OpenPocket $version ($build). Apple processes it in a few minutes; then add it to a"
  echo "TestFlight group in App Store Connect."
fi
