# Changelog

## Unreleased

- Add native Codex CLI/desktop and Claude Code plugins, plus read-only OpenCode and Pi ledger integrations. Keep Codex skills namespaced and provide sanitized recent-run summaries through `evofence ledger recent`.
- Count Pi's documented `agent_end` event as the JSON CLI completion point, while keeping retry and incomplete-usage paths fail closed.
- Add a local DeepSeek Harness Cordis bundle with read-only ledger integrity and recent-run summary tools.
- Add a Claude Code CLI adapter with whole-tree token and reported USD usage telemetry. Require explicit opt-in for its unsandboxed CLI execution, and reject Claude runs when `max_tokens` is configured because its complete totals arrive only with the final result.
- Enforce a Claude-only run-wide USD estimate cap by passing the remaining budget to each CLI invocation and stopping before candidate evaluation when the cap is reached or complete cost usage is unavailable.
- Add a Pi CLI adapter with JSONL token/cost telemetry and completed-message token-budget enforcement. Disable project extensions and instructions for EvoFence runs, and require explicit opt-in for unsandboxed execution.

## 0.1.2-beta.1

- Expand CI coverage to Windows; record complete adapter usage; add a fail-closed, turn-boundary token-budget cutoff; and make release metadata checks directly testable.

## 0.1.1

- Strip common token, API/access/private-key, secret, password, credential, and authentication-helper environment variables from child processes.
- Recheck candidate paths and content after evidence commands; include new files in accepted-generation hashes.
- Correct output truncation reporting and allow claims for capabilities approved by the contract.

## 0.1.0

- Initial research MVP: repository initialization, isolated Git candidates, Codex/OpenCode
  adapters, deterministic evidence gate, SQLite audit ledger, generation rollback, and
  JSON experiment export.
