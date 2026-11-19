#!/bin/bash
# Build "Pocket Mic.driver" (universal arm64 + x86_64), ad-hoc signed.
# Needs only the Xcode Command Line Tools.
set -euo pipefail
cd "$(dirname "$0")"

ASPL=third_party/libASPL
OUT="build/Pocket Mic.driver"
OBJ=build/obj
MIN=11.0
ARCHS=(-arch arm64 -arch x86_64)

rm -rf build
mkdir -p "$OUT/Contents/MacOS" "$OBJ"

export ASPL OBJ MIN
ls "$ASPL"/src/*.cpp PocketMic.cpp | xargs -P "$(sysctl -n hw.ncpu)" -n 1 sh -c '
  clang++ -std=c++17 -O2 -Wall -Wno-reorder-init-list -mmacosx-version-min=$MIN -arch arm64 -arch x86_64 \
    -I"$ASPL/include" -I"$ASPL/src" -c "$1" -o "$OBJ/$(basename "$1" .cpp).o"' _

clang++ "${ARCHS[@]}" -mmacosx-version-min=$MIN -bundle "$OBJ"/*.o \
  -framework CoreAudio -framework CoreFoundation \
  -o "$OUT/Contents/MacOS/PocketMic"
cp Info.plist "$OUT/Contents/Info.plist"
codesign --force --sign - "$OUT"

echo "Built $OUT"
lipo -archs "$OUT/Contents/MacOS/PocketMic"
