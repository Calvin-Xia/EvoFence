---
description: Verify EvoFence ledger integrity and read sanitized recent run summaries.
---

From the current EvoFence repository root, run `evofence ledger verify` and `evofence ledger recent 10`. Summarize the integrity result and recent status, adapter, accepted/rejected candidate counts, and duration. Do not run `evofence ledger show`; it contains full event payloads. Do not initialize EvoFence or modify repository files if the CLI or ledger is unavailable.

When another repository or person provides an exported bundle and the local SQLite ledger is unavailable, run `evofence ledger verify --bundle <file> --json`. This reads and verifies the supplied JSON bundle without opening or creating a local ledger; report the returned integrity result and exit status.
