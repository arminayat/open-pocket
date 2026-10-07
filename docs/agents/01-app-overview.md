# App overview

OpenPocket is an iPhone-first experiment for connecting to an already-activated Pocket recorder. Expo/HeroUI UI controls direct Bluetooth and Wi-Fi downloads, local playback, sharing, and redacted diagnostics.

Implemented account paths: OAuth with PKCE and dynamic registration, personal API key lookup via MCP, and an existing device key. Account-derived keys are candidates until the recorder acknowledges them. Verified connection details are saved in Keychain; cloud tokens are temporary.

There is no app backend, analytics, subscription, transcription, firmware modification, factory activation, or recording deletion. Physical authentication and transport compatibility require device acceptance tests.
