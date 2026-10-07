# Pages and actions

- Device: connect account, import advanced credentials, scan, connect/reconnect, read battery/firmware, disconnect, forget credentials, switch theme.
- Recordings: refresh a complete device listing, select Bluetooth or Wi-Fi download, cancel, play/share local files. Separate copies per transport support comparison.
- Diagnostics: bounded connection/transfer history and redacted text export.
- OAuth callback: `openpocket://oauth/callback`, consumed by AuthSession and returning to Device.

Transfers run one at a time in the foreground. Leaving the app during transfer cancels it. Wi-Fi uses the recorder's hidden hotspot and leaves it after each attempt. Library files survive disconnection and forgetting credentials.
