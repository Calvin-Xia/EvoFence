---
description: Run an explicitly requested EvoFence evolution using its contract and evidence gates.
argument-hint: <goal-file> [--adapter codex|opencode|claude|pi]
---

The user's goal file and adapter request are: `$ARGUMENTS`.

Use the provided existing goal file; do not create or overwrite one. Read `.evofence/contract.yaml`, verify the ledger with `evofence ledger verify`, then run `evofence run --goal <goal-file> --json`, adding `--adapter <adapter>` only when the user requested it. Do not add `--allow-unisolated-agent` or `--allow-readable-holdout` unless the user explicitly authorizes that specific boundary during this task. If EvoFence rejects the run, report the error instead of bypassing it. After a run, report its result and use `evofence ledger recent 10`; never dump the raw ledger.
