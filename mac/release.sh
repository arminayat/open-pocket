#!/bin/bash
# Builds OpenPocket for Mac for Apple silicon and Intel, signs it with the team's Developer ID,
# has Apple notarize it, and puts it in a signed, notarized disk image that opens without a
# Gatekeeper warning. docs/mac-release.md has the one-time setup and the rest.
#
# Usage: mac/release.sh [--check]
#   --check  build and sign the app and the disk image, but don't notarize (no Apple account
#            needed beyond the certificate, and the working tree may be dirty)
#
#   TEAM_ID         the Apple team; G6WL4CPNV3 (Nestor Code Crafters) by default
#   NOTARY_PROFILE  the notarytool keychain profile; openpocket-notary by default
set -euo pipefail
cd "$(dirname "$0")"

check=false
[[ "${1:-}" == --check ]] && check=true
team="${TEAM_ID:-G6WL4CPNV3}"
profile="${NOTARY_PROFILE:-openpocket-notary}"
version=$(plutil -extract CFBundleShortVersionString raw -o - Info.plist)
# Each build gets a larger number than the last; the time gives one.
build=$(date -u +%Y%m%d%H%M)
out="build/release"
app="build/OpenPocket.app"
dmg="$out/OpenPocket-$version.dmg"

fail() { echo "$1" >&2; exit 1; }

identity=$(security find-identity -v -p codesigning |
  sed -nE "s/.*\"(Developer ID Application: [^\"]*\\($team\\))\".*/\\1/p" | head -n 1)
[[ -n "$identity" ]] || fail "No Developer ID Application certificate for team $team is in a keychain."

if ! $check; then
  [[ -z "$(git status --porcelain)" ]] || fail "Commit or stash your changes first; releases come from a commit."
  xcrun notarytool history --keychain-profile "$profile" > /dev/null 2>&1 ||
    fail "No working notarytool profile \"$profile\". docs/mac-release.md says how to make one."
fi

notarize() { # <file to submit> <file to staple>
  local result id status
  result=$(xcrun notarytool submit "$1" --keychain-profile "$profile" --wait --timeout 30m --output-format json)
  id=$(plutil -extract id raw -o - - <<< "$result")
  status=$(plutil -extract status raw -o - - <<< "$result")
  echo "Notarization $id: $status"
  if [[ "$status" != Accepted ]]; then
    xcrun notarytool log "$id" --keychain-profile "$profile"
    exit 1
  fi
  xcrun stapler staple "$2"
  xcrun stapler validate "$2"
}

echo "OpenPocket for Mac $version ($build), signed by $identity"
rm -rf "$out"
mkdir -p "$out"
# The driver is built fresh so a release never carries a stale one.
rm -rf "../driver/build"
UNIVERSAL=1 SIGN_IDENTITY="$identity" BUILD_NUMBER="$build" ./build-app.sh release

codesign --verify --deep --strict --verbose=2 "$app"
for code in "$app" "$app/Contents/Resources/Pocket Mic.driver"; do
  details=$(codesign -dvv "$code" 2>&1)
  grep -q "Authority=Developer ID Application" <<< "$details" || fail "$code isn't signed with Developer ID."
  grep -qE "flags=.*runtime" <<< "$details" || fail "$code lacks the hardened runtime."
  grep -q "Timestamp=" <<< "$details" || fail "$code has no secure timestamp."
done

if ! $check; then
  ditto -c -k --keepParent "$app" "$out/OpenPocket.zip"
  notarize "$out/OpenPocket.zip" "$app"
  rm "$out/OpenPocket.zip"
fi

stage="$out/dmg"
mkdir -p "$stage"
ditto "$app" "$stage/OpenPocket.app"
ln -s /Applications "$stage/Applications"
hdiutil create -quiet -volname "OpenPocket" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg"
rm -rf "$stage"
codesign --sign "$identity" --timestamp "$dmg"

if ! $check; then
  notarize "$dmg" "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
fi
(cd "$out" && shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256")
echo "Done: mac/$dmg"
$check && echo "Not notarized (--check): Gatekeeper will block it on other Macs."
exit 0
