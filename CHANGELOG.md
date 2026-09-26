# Changelog

## Unreleased

- Add `evofence status [--json]`, a one-screen operational overview backed by `src/lib/status.js`: active generation with sha, ledger integrity, four cumulative totals, and the five most recent runs.
- Create the ledger database during `evofence init`, and make `evofence status` tolerate degenerate ledgers: missing, zero-byte, or schema-less ledger files render as the documented empty state, malformed payloads keep the FAILED integrity presentation, and the command exits 1 when integrity fails or the ledger cannot be read.

## 0.2.1

- Add a Pi CLI tool strategy that selects active read-only tools for proposal phases, orders tools by phase, and adapts within each phase to tool-call feedback without adding tools or permissions.
- Make the DeepSeek Harness Cordis bundle discoverable as an EvoFence monorepo subpath, declare exact tested compatibility and license metadata, and document its read-only permissions and native dependency install step.

## 0.2.0

- Add Codex CLI/desktop and Claude Code plugins, plus read-only OpenCode, Pi, and DeepSeek Harness Cordis integrations. Pi auto-loads from the project's `.pi/extensions/` directory when run in this checkout.
- Add Claude Code and Pi CLI adapters with token/cost telemetry and run-wide budget enforcement. Require explicit opt-in for unsandboxed adapters and fail closed when complete usage is unavailable.
- Add fail-closed Codex/OpenCode token-budget cutoffs with complete streamed-event accounting, including OpenCode reasoning tokens.
- Add sanitized recent-run summaries that count rejected iterations once and infer iteration counts for failed runs.
- Expand CI coverage to Windows and Node 22/24; add release metadata checks and GitHub Actions Trusted Publishing support.

## 0.1.1

- Strip common token, API/access/private-key, secret, password, credential, and authentication-helper environment variables from child processes.
- Recheck candidate paths and content after evidence commands; include new files in accepted-generation hashes.
- Correct output truncation reporting and allow claims for capabilities approved by the contract.

## 0.1.0

- Initial research MVP: repository initialization, isolated Git candidates, Codex/OpenCode
  adapters, deterministic evidence gate, SQLite audit ledger, generation rollback, and
  JSON experiment export.
