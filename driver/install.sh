#!/bin/bash
# Install (or with --uninstall, remove) "Pocket Mic.driver". Needs admin rights.
# Restarting coreaudiod makes sound drop out for a second.
set -euo pipefail
cd "$(dirname "$0")"

HAL="/Library/Audio/Plug-Ins/HAL"
NAME="Pocket Mic.driver"

if [[ "${1:-}" == "--uninstall" ]]; then
  sudo rm -rf "$HAL/$NAME"
else
  [[ -d "build/$NAME" ]] || ./build.sh
  sudo rm -rf "$HAL/$NAME"
  sudo cp -R "build/$NAME" "$HAL/"
  sudo chown -R root:wheel "$HAL/$NAME"
fi
sudo killall coreaudiod
echo "Done. Audio inputs now:"
sleep 2
system_profiler SPAudioDataType 2>/dev/null | grep -E "^ {8}[^ ].*:$" | sed 's/:$//'
