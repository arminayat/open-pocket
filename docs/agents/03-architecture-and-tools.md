# Architecture and tools

Expo 57 / React Native 0.86 / TypeScript / Expo Router / HeroUI Native 1.0.9 / Uniwind. Use npm and the compatible Expo native dependency set.

`PocketClient` serializes device operations; react-native-ble-plx owns BLE. Pure protocol and inbox modules validate replies, counts, file sizes, and completion. Swift Expo module owns hotspot configuration and Wi-Fi TCP streaming. Config plugin persists entitlement/Local Network usage copy through prebuild.

SecureStore contains only verified device credentials and saved peripheral identity. Local MP3s and a small metadata index live in Documents/recordings. Expo Audio and Sharing provide playback/export. Account HTTP calls retrieve identity only; no recording cloud requests or app backend exist.

Checks: typecheck, lint, Node synthetic tests, Expo package alignment/Doctor, iOS bundle export, portable Swift decoder tests, native iOS build. Physical iPhone + Pocket validation remains distinct from compilation. No environment secrets or migrations required. Apple development signing and Hotspot Configuration capability are needed for installation.
