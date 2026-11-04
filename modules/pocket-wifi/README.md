# Pocket Wi-Fi native module

This local Expo iOS module joins Pocket's hidden WPA2 hotspot and receives its recording stream over TCP at `192.168.200.1:8475`. It sends nothing to the socket. Socket operations run on a serial queue; each receive is capped at 64 KiB and only a ten-byte trailer remains buffered between receives.

The wire format comes from [Pocket Libre's MIT-licensed protocol research](https://github.com/shahcolate/pocket-libre/blob/42fad3b838b9507f25c6544875e2f4c8b07db763/PROTOCOL.md). The fixed trailer is a completion marker, not a checksum. The caller must also await Pocket's BLE `MCU&OFF` before treating the recording as complete.

## Interface

- `join(ssid, password)`: request iPhone consent for a hidden, join-once hotspot. Rejects declined joins and joins that take over 90 seconds.
- `openTransfer(destinationUri)`: truncate/create a `.part` file in app documents, cache, or temporary storage; open a Wi-Fi-only socket and resolve once it is ready. The parent directory must exist. Fails after 20 seconds if it cannot connect.
- `completeTransfer(expectedBytes)`: supply the exact file length from BLE before sending `APP&U&WIFI`. Await this promise while starting the BLE switch. Resolve only after the exact MP3 byte count and ten-byte trailer arrive. The returned URI still points to `.part`; the caller promotes it after checking BLE completion.
- `cancel()`: close the active socket, remove its partial file, and reject pending transfer promises. This does not leave the hotspot.
- `leave(ssid)`: cancel a pending join to this SSID and remove its join-once configuration. iOS disassociates a join-once configuration when removed.
- `PocketOAuthLoopback.start()` / `stop()`: opens a one-shot 127.0.0.1 listener returning its port; `GET /callback?<query>` is 302-forwarded to `openpocket://oauth/callback?<query>`. Other paths get 404.
- `addListener('transferProgress', callback)`: payload is only `{ bytesWritten }`; recording bytes and credentials never cross the event bridge.

Only one socket transfer is active. A stalled socket fails after 30 seconds without incoming bytes. Module destruction cancels the transfer and leaves its owned hotspot. Native errors use fixed descriptions that do not include SSIDs, passwords, file paths, or account identifiers.

The config plugin `plugins/with-pocket-wifi.js` persists the Hotspot Configuration entitlement and Local Network usage text through prebuild. Real hotspot joining and TCP transfer require a physical iPhone with development signing and an activated Pocket; Expo Go and Simulator cannot validate those interactions.

## Native checks

The stream decoder can be verified on macOS without an iPhone or Expo runtime:

```sh
xcrun swiftc -module-cache-path /private/tmp/openpocket-swift-module-cache \
  modules/pocket-wifi/ios/PocketStreamDecoder.swift \
  modules/pocket-wifi/tests/StreamDecoderChecks.swift \
  -o /private/tmp/openpocket-wifi-decoder-checks
/private/tmp/openpocket-wifi-decoder-checks
```

## ChatGPT identity verification

`ChatGPTIdentity.verify` validates OpenAI ID tokens with Apple Security RS256 and trusted public JWKS, including issuer, audience, nonce, and time checks. The existing loopback callback is shared by Pocket and ChatGPT with a JavaScript sign-in lock. Run `npm run test:chatgpt-native` for synthetic signature/claim checks. New Swift sources require `npm run ios:pods` and a native app rebuild; compilation does not prove live ChatGPT sign-in.
