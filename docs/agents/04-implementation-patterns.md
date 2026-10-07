# Implementation patterns

Use small modules and typed boundaries. Keep protocol parsing/test helpers independent of React Native. Subscribe before device writes, retain reply history for early responses, and serialize control writes.

Only promote a temporary file when exact bytes and the transport completion signal are verified. Cancellation removes partial files; completed publication is the terminal boundary. Metadata writes to a fresh snapshot via a temporary file and same-folder rename before pruning prior snapshots, preserving the previous library on write failure. Wi-Fi uses one hotspot session per recording. Failed transfers disconnect before another attempt.

Use diagnostic allowlists and register secrets before they can reach errors. Never print raw auth/recorder responses. Update these notes when behavior changes. UI uses HeroUI primitives and Uniwind theme tokens. Accessibility font scaling remains enabled.

Saved reconnect uses the verified saved key, even after importing a different candidate. Verification labels compare the active key with the saved key. Disconnect and new connection attempts clear remote listings. Playback resolves the latest local copy and explicitly enables silent-mode media playback.
