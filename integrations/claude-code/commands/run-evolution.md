---
description: Run an explicitly requested EvoFence evolution using its contract and evidence gates.
argument-hint: <goal-file> [--adapter codex|opencode|claude|pi]
---

The user's goal file and adapter request are: `$ARGUMENTS`.

First, run the read-only preflight: `evofence doctor --json`, or `evofence doctor --adapter <adapter> --json` when an adapter was requested. A non-zero exit normally means EvoFence refused the preflight; report the returned code and remediation and stop before any run command. For `CLAUDE_SANDBOX_REQUIRED`, `PI_SANDBOX_REQUIRED`, or `OPEN_CODE_SANDBOX_REQUIRED`, the result is an explicit isolation boundary decision: report the required boundary and pause for the user's explicit authorization rather than treating the environment as permanently blocked. Do not claim that doctor passed; after authorization, continue only through the normal `evofence run` isolation gate. Any other non-zero exit remains a hard stop. Only after this preflight decision, use the provided existing goal file; do not create or overwrite one. Read `.evofence/contract.yaml`, verify the ledger with `evofence ledger verify`, then run `evofence run --goal <goal-file> --json`, adding `--adapter <adapter>` only when the user requested it. Do not add `--allow-unisolated-agent` or `--allow-readable-holdout` unless the user explicitly authorizes that specific boundary during this task. If EvoFence rejects the run, report the error instead of bypassing it. After a run, report its result and use `evofence ledger recent 10`; never dump the raw ledger.
