---
name: inspect-ledger
description: Verify the EvoFence audit ledger and view sanitized recent run summaries for the current repository.
---

Use the EvoFence CLI from the current repository root.

1. Run `evofence ledger verify` and report whether the hash chain is valid.
2. Run `evofence ledger recent 10` and summarize status, adapter, accepted/rejected candidates, and duration.
3. Do not run `evofence ledger show` for this task. It includes full event payloads, which may contain prompts, commands, or evaluator output.
4. If the CLI or ledger is unavailable, report that without initializing EvoFence or changing repository files.
