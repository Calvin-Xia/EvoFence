# Changelog

## Unreleased

- Add `evofence diff <generation-id> [--json]`, a generation audit view backed by `src/lib/audit.js`: it verifies the ledger hash chain and cross-checks the generation row against its hash-chained `generation.accepted` / `candidate.accepted` records first (failing with `LEDGER_CORRUPT`), reports a generation's changed paths, unified diff (capped at 200 KiB, marked in text output when truncated), objective delta, and the gate evidence that accepted it without embedding evidence output content, recomputes `diff_sha256` from Git with diff attributes pinned to the generation tree (Git 2.42+ required; older Git fails clearly) and flags disagreements with the recorded `diff_sha256_recorded` via `diff_sha256_matches`, binds the displayed evidence and proposal to the acceptance record's `evidence_artifact` / `proposal_sha256` links (legacy records without them keep the run/iteration fallback), and labels generations without acceptance evidence as not accepted.

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
