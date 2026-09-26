<div align="center">

<h1>EvoFence</h1>

<p><strong>Agent proposes · Environment measures · Gate decides</strong></p>
<p>An experimental, evidence-gated evolution loop for coding agents.</p>

<p>
  <a href="https://www.npmjs.com/package/evofence"><img alt="npm version" src="https://img.shields.io/npm/v/evofence"></a>
  <a href="https://www.npmjs.com/package/evofence"><img alt="npm weekly downloads" src="https://img.shields.io/npm/dw/evofence"></a>
  <a href="https://www.npmjs.com/package/evofence"><img alt="Node.js version" src="https://img.shields.io/node/v/evofence"></a>
  <a href="https://github.com/Calvin-Xia/EvoFence/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/npm/l/evofence"></a>
  <a href="https://github.com/Calvin-Xia/EvoFence/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/Calvin-Xia/EvoFence/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p><a href="README.md">简体中文</a> · <strong>English</strong></p>
<p><a href="#install">Install</a> · <a href="#configure-the-contract">Configure</a> · <a href="#run-an-evolution-loop">Run</a> · <a href="#agent-plugins-and-extensions">Agent plugins</a> · <a href="#security-boundaries">Security</a> · <a href="#development">Development</a></p>

</div>

---

EvoFence is an experimental control plane for coding-agent changes. An agent proposes and edits a disposable Git worktree; EvoFence runs the repository's declared checks, compares a numeric objective score, records evidence, and only then records an accepted generation.

> Agent proposes. Environment measures. Gate decides.

This is a research MVP. It does not provide formal verification, enterprise IAM, or a universal security sandbox. Read [Security boundaries](#security-boundaries) before running an unattended agent.

## Install

Requires Node.js 22.13 or newer.

```sh
npm install --global --allow-scripts=better-sqlite3 evofence
evofence init
```

npm 11 and newer block dependency install scripts by default. This command explicitly allows only `better-sqlite3` to download or compile its SQLite binding. With older npm versions that run install scripts by default, use `npm install --global evofence`.

`evofence init` creates `.evofence/` in the current Git repository. Review and commit `contract.yaml` and the prompt/schema files as appropriate. Machine-local state, the SQLite ledger, artifacts, and private holdout file are excluded from Git.

## Configure the contract

EvoFence fails closed until you provide at least one hard invariant and a numeric objective. The objective command must exit successfully and print one finite score on its final output line:

```yaml
objective:
  name: benchmark_score
  command: "npm run benchmark:score"
  direction: maximize
  min_delta: 0.01

hard_invariants:
  - id: unit_tests
    command: "npm test"

evidence:
  public_commands:
    - "npm run lint"
```

Commands in the contract are trusted project-owner configuration and execute with the current user's permissions. Never put credentials in these commands or their output.

Private regression commands belong in `.evofence/private/holdout.yaml`; that file is ignored by Git and is not copied into candidate worktrees. Add a command only if the expected result is success. EvoFence records pass/fail counts and hashes, not private command output or oracle source.

```yaml
regressions:
  - id: historical_case_01
    command: "python private_checks/case_01.py"
```

With no private regressions configured, EvoFence has no hidden-regression evidence and cannot support claims about hidden-test performance. The built-in agent adapters cannot guarantee read isolation from other files on the same host, so `run` refuses to use private checks by default. `--allow-readable-holdout` explicitly accepts that the agent may read the oracle; use a container/VM with restricted mounts for actual secrecy.

## Run an evolution loop

```sh
evofence run --adapter codex --goal goal.md --iterations 20
```

Each iteration creates a detached worktree from the current accepted generation, requests a proposal before allowing implementation, runs public and private checks in the controller, and records the gate decision. The iteration and wall-clock ceilings cannot exceed `.evofence/contract.yaml`. The default contract stops after 20 iterations or one hour.

## Security boundaries

Codex runs with its `workspace-write` sandbox, which restricts writes but not reads from the host file system ([Codex sandbox policy](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)). EvoFence does not place OpenCode, Claude Code, or Pi in an OS sandbox. Claude Code's headless permission flags do not restrict process access to host files, and headless mode can load configuration that runs hooks, MCP servers, or plugins ([Claude Code headless mode](https://code.claude.com/docs/en/headless)). The Pi adapter uses JSONL mode and disables persistent sessions, project trust, automatic extension discovery, skills, prompt templates, themes, and `AGENTS.md`/`CLAUDE.md` discovery; it explicitly loads only EvoFence's bounded tool-strategy extension ([Pi CLI](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/cli.md)). These flags reduce project resource loading but do not restrict shell access to host files ([Pi security](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/security.md)). OpenCode, Claude Code, and Pi require `--allow-unisolated-agent`:

```sh
evofence run --adapter opencode --allow-unisolated-agent --goal goal.md
evofence run --adapter claude --allow-unisolated-agent --goal goal.md
evofence run --adapter pi --allow-unisolated-agent --goal goal.md
```

For meaningful protection, launch the agent in a Docker container or VM that mounts only the candidate worktree and has no network, secrets, or host credentials. The flags above do not create such a boundary.

EvoFence filters common credential-shaped environment names, including `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, API/access/private-key variables, and authentication-helper variables, from child processes. This is defense in depth only: an agent with host file access may still reach credential files or authentication brokers.

## Inspect, export, and roll back

```sh
evofence proposal inspect <run-id>-i1
evofence gate <run-id>-i1
evofence ledger show <run-id>
evofence ledger verify
evofence ledger recent 10
evofence experiment export evidence.json
evofence rollback <generation-id>
evofence diff <generation-id> [--json]
```

Rollback changes EvoFence's active-generation pointer and Git ref. It does not rewrite the primary working tree; the next candidate starts from the selected generation. Every accepted generation is a Git commit reachable through `refs/evofence/generations/*`.

`evofence diff <generation-id>` prints the audit view for a generation: generation id, short sha and objective delta, the changed-path list, one evidence line per check (`id kind result`), then the unified diff for `parent_sha..sha` (capped at 200 KiB; `diff_truncated` is true when the cap cuts it and the text output marks the truncation). The command verifies the ledger hash chain first and cross-checks the `generations` row against its hash-chained `generation.accepted` / `candidate.accepted` records, failing with `LEDGER_CORRUPT` on a broken chain or disagreeing metadata. The displayed evidence and proposal are bound to the acceptance record's `evidence_artifact` and `proposal_sha256` links (a unique preceding ACCEPT gate decision and gate-passed bound and baseline evidence (valid score, improvement meeting the contract `min_delta`) are required; the objective score and improvement are bound to recomputed gate evidence, proposal digest claims are rehashed against their content, and the improvement baseline is derived from validated prior evidence chained to the accepted parent; records appended after the acceptance never count as its gate, proposal, baseline or contract, and duplicate, missing or unverifiable links are rejected as ambiguous, and every linked record must carry the accepted parent as its `base_sha`); a broken or ambiguous link fails with `LEDGER_CORRUPT` as well (acceptance records without those fields keep the run/iteration fallback). `diff_sha256` is recomputed from Git (`git diff --binary parent_sha..sha`) with diff attributes pinned to the generation's tree (`.gitattributes` in the primary checkout cannot skew the diff or the hash; Git 2.42 or newer is required for this pinning and older Git fails clearly instead of silently skipping it) and compared with the ledger's recorded `diff_sha256_recorded`; `diff_sha256_matches` records the verdict (`null` when the ledger has no recorded hash) and a mismatch is marked in the text output. With `--json` the same report is printed as pretty JSON. `objective` and `evidence` appear only when the ledger links them to the generation (a generation without a `candidate.accepted` event is labeled `not accepted`), and evidence carries check ids, kinds and results only — never command text or captured output.

```sh
evofence diff g-run-20260101120000-abcd1234-i01
evofence diff g-run-20260101120000-abcd1234-i01 --json
```

`evofence evidence run <candidate-directory>` reruns the configured checks for a directory and exports their summary. It does not accept or commit that candidate.

### Agent plugins and extensions

The repository includes native integrations for Codex, Claude Code, OpenCode, Pi, and DeepSeek Harness. Codex and Claude provide explicitly invoked run commands; OpenCode, Pi, and Cordis currently expose read-only ledger inspection. Every entry point that starts an evolution remains subject to the EvoFence CLI contract, budget, and evidence gates.

- **Codex CLI and Codex desktop**: follow [`integrations/codex/README.md`](integrations/codex/README.md) to add the repository marketplace. Skills are `$evofence:inspect-ledger` and `$evofence:run-evolution`.
- **Claude Code**: follow [`integrations/claude-code/README.md`](integrations/claude-code/README.md) to add the marketplace; commands are `/evofence:inspect-ledger` and `/evofence:run-evolution`.
- **OpenCode**: [`integrations/opencode/README.md`](integrations/opencode/README.md) provides project-level read-only tools.
- **Pi**: [`integrations/pi/README.md`](integrations/pi/README.md) provides a read-only ledger extension. The `evofence run --adapter pi` CLI adapter also loads a phase-aware tool strategy: proposal selects only currently active read-only tools, while implementation keeps the active set and reorders it from call feedback. See [`docs/pi-tool-strategy.md`](docs/pi-tool-strategy.md).

`inspect` verifies the ledger and reads sanitized summaries. `run` must be explicitly invoked by the user with an existing goal file; the plugins do not automatically relax boundaries such as `--allow-unisolated-agent` or `--allow-readable-holdout`. OpenCode, Pi, and Cordis read-only plugin entry points are separate from the `evofence run --adapter ...` CLI adapters.

### DeepSeek Harness Cordis plugin

This repository includes a local Cordis bundle for read-only inspection of EvoFence ledger integrity and recent run summaries. It does not start an evolution run, execute contract commands, accept candidates, or change Git state. Launch Harness from the EvoFence repository root:

```sh
dsh plugin --profile web add ./integrations/deepseek-harness
dsh --profile web --dump-config
dsh --profile web
```

The bundle registers `evofence_verify_ledger` and `evofence_recent_runs`. Summaries omit prompts, evaluator commands, source text, and check output. The Cordis API is still pre-stable; see the official [tool tutorial](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool) and [bundle guide](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish).

Experiment manifest example:

```yaml
goal_file: ./goal.md
adapter: codex
iterations: 10
max_wall_clock_ms: 1800000
```

Run it with `evofence experiment run experiment.yaml`.

## What the gate checks

- A valid proposal tied to the exact base commit must exist before project files change.
- Protected paths include EvoFence policy, tests, package manifests/lockfiles, and CI workflows by default.
- Claims must match the actual changed-file list; the proposal cannot be edited after implementation.
- All configured hard invariants and public checks must pass.
- Private regression failures must stay within the configured tolerance.
- The objective score must improve by at least `min_delta` in the configured direction.
- Critical changes are quarantined; high-risk changes require escalation; capability requests are denied unless explicitly allowed in the contract.
- The accepted candidate is committed and pinned before the active generation moves.

The ledger is a local SQLite database with append-only triggers and a SHA-256 hash chain. This detects accidental or partial edits, but a process with the same OS account can still replace the database file. Back it up or store exported evidence in a separately controlled system if the local host is outside your trust boundary.

## Current limits

- `max_iterations`, `max_wall_clock_ms`, failed-candidate count, and consecutive no-improvement count are enforced. When `max_tokens` is set, EvoFence sums completed Codex turns, OpenCode steps, and Pi assistant messages, including Pi-reported nested tool-model and compaction usage. When usage reaches or exceeds the threshold, EvoFence terminates the agent process tree and stops before evaluating or accepting the current candidate. CLIs report usage at completed message/turn/step boundaries, so the crossing response has already completed and actual usage can exceed the threshold; this is not a strict pre-request token cap. Claude Code exposes complete whole-tree token usage only in its final result event, so EvoFence refuses to start Claude runs when `max_tokens` is configured. Pi retries without attached usage fail closed when a token budget is active. Missing, incomplete, or truncated usage stops a budgeted run. On Windows, EvoFence first probes whether the host can terminate an entire process tree; if the permission is unavailable, it refuses to start a budgeted run. Claude Code v2.1.246+ reports per-model whole-tree tokens and CLI cost estimates; Pi records USD cost estimates from its model pricing data. `max_usd` currently supports Claude Code only: EvoFence passes the remaining run-wide budget to each CLI invocation via `--max-budget-usd` and accumulates complete `result.total_cost_usd` estimates. It stops without evaluating the candidate when the cap is reached, usage is missing/truncated, the process times out, or process-tree termination cannot be confirmed. The response crossing the cap may put the estimate over the limit; this is not the provider's final bill. A non-null `max_usd` with Codex, OpenCode, or Pi is rejected before launch. OpenCode's reported cost is preserved without inferring a currency and is not a final bill.
- Hidden evaluation currently runs owner-provided private commands. The built-in adapters do not satisfy the PRD's strong “agent cannot read holdout source” requirement on a shared host; use a separately isolated worker for that guarantee. Generated metamorphic tests, an API daemon, Herdr adapter, authority learning, and longitudinal drift analysis are future work.
- Agent CLI versions and user configuration can change behavior. The Claude Code adapter requires v2.1.259+ for prompt-free headless operation. Keep all CLIs up to date and inspect exported evidence before relying on a result.
- Worktree isolation protects the primary checkout from candidate edits. It is not a substitute for an OS sandbox, especially for an agent that can run arbitrary shell commands.

## Development

```sh
npm ci
npm test
npm pack --dry-run
```

The research source document `docs/deep-research-report.md` is not included in the npm package.

## Publishing

The npm package `evofence` uses GitHub Actions Trusted Publishing (OIDC). Its trusted publisher is configured for owner `Calvin-Xia`, repository `EvoFence`, workflow file `publish.yml`, with no GitHub Environment. No `NPM_TOKEN` is needed.

For each release, update the versions in `package.json` and `package-lock.json` and update `CHANGELOG.md`. After the change is on `main`, create a GitHub Release with the matching `v<version>` tag. Stable versions such as `v0.2.1` publish to npm's `latest` tag. SemVer prereleases such as `v0.2.1-beta.1` must be marked as prereleases in GitHub and publish to npm's `beta` tag. `.github/workflows/publish.yml` verifies that the tag, package version, and prerelease flag agree, then runs the test suite before publishing.
