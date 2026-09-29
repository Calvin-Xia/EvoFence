---
name: run-evolution
description: Invoke an explicitly requested EvoFence evolution run using its configured contract and evidence gates.
---

The user must explicitly invoke this skill to start a run. Use a goal file they provide; do not create or overwrite a goal file.

1. Run the read-only preflight first: `evofence doctor --adapter <adapter> --json`, using `codex` when the user did not select an adapter. A non-zero exit is normally a refusal; report its code and remediation and stop before dispatching an agent. If the code is `CLAUDE_SANDBOX_REQUIRED`, `PI_SANDBOX_REQUIRED`, or `OPEN_CODE_SANDBOX_REQUIRED`, it is an explicit isolation boundary decision: report the boundary and pause for the user's explicit authorization instead of treating the environment as permanently blocked. Do not claim that doctor passed; after authorization, continue only through the normal `evofence run` isolation gate. Any other non-zero exit remains a hard stop.
2. Read `.evofence/contract.yaml` and confirm the requested goal file exists.
3. Run `evofence ledger verify`. Stop if the ledger is invalid or unavailable.
4. Invoke `evofence run --adapter <adapter> --goal <goal-file> --json`.
5. Do not add `--allow-unisolated-agent` or `--allow-readable-holdout` unless the user explicitly authorizes that specific boundary during this task. If EvoFence rejects the run, report the code and required action instead of bypassing the rejection.
6. Report the run result and then use `evofence ledger recent 10` for a sanitized summary. Never dump the raw ledger.
