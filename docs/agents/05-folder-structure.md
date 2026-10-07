# Folder structure

- `src/app`: Expo Router screens and native tabs.
- `src/components`: common screens, notices, playback.
- `src/contexts`: theme and device/session state.
- `src/lib/account`: OAuth/MCP lookup and pure response helpers.
- `src/lib/pocket`: BLE connection, inbox, protocol, transfer orchestration, types.
- `src/storage`: Keychain connection and local recording library.
- `modules/pocket-wifi`: Swift hotspot/socket/decoder module and wrapper.
- `plugins`: durable Expo native configuration.
- `tests`: synthetic protocol, cancellation, account and diagnostic checks.

Keep files below roughly 500 lines. Generated native directories, dependencies, exports, and caches are ignored.
