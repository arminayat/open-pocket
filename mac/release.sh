#!/bin/bash
# Builds Open Pocket for Mac for Apple silicon and Intel, signs it with the team's Developer ID,
# has Apple notarize it through the account Xcode is signed in to (no password or API key to
# set up), staples the ticket, and zips it. docs/mac-release.md has the rest.
#
# Usage: mac/release.sh [--check]
#   --check  build, sign and zip the app, but don't notarize (the working tree may be dirty)
#
#   TEAM_ID  the Apple team; G6WL4CPNV3 (Nestor Code Crafters) by default
set -euo pipefail
cd "$(dirname "$0")"
. ./xcode-export.sh

check=false
[[ "${1:-}" == --check ]] && check=true
team="${TEAM_ID:-G6WL4CPNV3}"
version=$(plutil -extract CFBundleShortVersionString raw -o - Info.plist)
# Each build gets a larger number than the last; the time gives one.
build=$(date -u +%Y%m%d%H%M)
out="build/release"
zip="$out/OpenPocket-$version.zip"

fail() { echo "$1" >&2; exit 1; }

identity=$(security find-identity -v -p codesigning |
  sed -nE "s/.*\"(Developer ID Application: [^\"]*\\($team\\))\".*/\\1/p" | head -n 1)
[[ -n "$identity" ]] || fail "No Developer ID Application certificate for team $team is in a keychain."
if ! $check && [[ -n "$(git status --porcelain)" ]]; then
  fail "Commit or stash your changes first; releases come from a commit."
fi

echo "Open Pocket for Mac $version ($build), signed by $identity"
rm -rf "$out"
mkdir -p "$out"
# The driver is built fresh so a release never carries a stale one.
rm -rf "../driver/build"
UNIVERSAL=1 SIGN_IDENTITY="$identity" BUILD_NUMBER="$build" ./build-app.sh release
app="build/Open Pocket.app"

codesign --verify --deep --strict --verbose=2 "$app"
for code in "$app" "$app/Contents/Resources/Pocket Mic.driver"; do
  details=$(codesign -dvv "$code" 2>&1)
  grep -q "Authority=Developer ID Application" <<< "$details" || fail "$code isn't signed with Developer ID."
  grep -qE "flags=.*runtime" <<< "$details" || fail "$code lacks the hardened runtime."
  grep -q "Timestamp=" <<< "$details" || fail "$code has no secure timestamp."
done

if ! $check; then
  echo "Uploading to Apple's notary service…"
  xcode_export "$app" "$out" developer-id "$team" "$version" "$build"
  # Apple usually answers within a few minutes; give it 30.
  for _ in $(seq 60); do
    if xcodebuild -exportNotarizedApp -archivePath "$out/OpenPocket.xcarchive" -exportPath "$out/notarized" \
      > "$out/notarized.log" 2>&1; then
      break
    fi
    grep -q "is processing" "$out/notarized.log" || { cat "$out/notarized.log"; fail "Notarization failed."; }
    sleep 30
  done
  [[ -d "$out/notarized/Open Pocket.app" ]] || fail "Apple hadn't finished notarizing after 30 minutes. Run it again later."
  app="$out/notarized/Open Pocket.app"
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=2 "$app"
fi

# A zip, not a disk image: xcodebuild notarizes apps only, and Gatekeeper rejects a downloaded
# disk image that isn't notarized itself. The stapled ticket travels inside the zipped app.
ditto -c -k --keepParent "$app" "$zip"
(cd "$out" && shasum -a 256 "$(basename "$zip")" > "$(basename "$zip").sha256")
echo "Done: mac/$zip"
$check && echo "Not notarized (--check): Gatekeeper will block it on other Macs."
exit 0
