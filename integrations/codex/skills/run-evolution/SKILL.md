---
name: run-evolution
description: Invoke an explicitly requested EvoFence evolution run using its configured contract and evidence gates.
---

The user must explicitly invoke this skill to start a run. Use a goal file they provide; do not create or overwrite a goal file.

1. Read `.evofence/contract.yaml` and confirm the requested goal file exists.
2. Run `evofence ledger verify`. Stop if the ledger is invalid or unavailable.
3. Invoke `evofence run --adapter <adapter> --goal <goal-file> --json`, using `codex` when the user did not select an adapter.
4. Do not add `--allow-unisolated-agent` or `--allow-readable-holdout` unless the user explicitly authorizes that specific boundary during this task. If EvoFence rejects a run, report the code and required action instead of bypassing the rejection.
5. Report the run result and then use `evofence ledger recent 10` for a sanitized summary. Never dump the raw ledger.
