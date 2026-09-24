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
<p><a href="#install">Install</a> · <a href="#configure-the-contract">Configure</a> · <a href="#run-an-evolution-loop">Run</a> · <a href="#security-boundaries">Security</a> · <a href="#development">Development</a></p>

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

Codex runs with its `workspace-write` sandbox, which restricts writes but not reads from the host file system ([Codex sandbox policy](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)). OpenCode does not provide operating-system isolation; its permission rules are only a UX control ([OpenCode security model](https://github.com/anomalyco/opencode/blob/dev/SECURITY.md)). The OpenCode adapter is disabled unless you explicitly pass `--allow-unisolated-agent`:

```sh
evofence run --adapter opencode --allow-unisolated-agent --goal goal.md
```

For meaningful protection, launch the agent in a Docker container or VM that mounts only the candidate worktree and has no network, secrets, or host credentials. The flags above do not create such a boundary.

EvoFence filters common credential-shaped environment names, including `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, API/access/private-key variables, and authentication-helper variables, from child processes. This is defense in depth only: an agent with host file access may still reach credential files or authentication brokers.

## Inspect, export, and roll back

```sh
evofence proposal inspect <run-id>-i1
evofence gate <run-id>-i1
evofence ledger show <run-id>
evofence ledger verify
evofence experiment export evidence.json
evofence rollback <generation-id>
```

Rollback changes EvoFence's active-generation pointer and Git ref. It does not rewrite the primary working tree; the next candidate starts from the selected generation. Every accepted generation is a Git commit reachable through `refs/evofence/generations/*`.

`evofence evidence run <candidate-directory>` reruns the configured checks for a directory and exports their summary. It does not accept or commit that candidate.

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

- `max_iterations`, `max_wall_clock_ms`, failed-candidate count, and consecutive no-improvement count are enforced. Token and USD ceilings are not yet enforced; setting either non-null makes `run` stop before launching an agent.
- Hidden evaluation currently runs owner-provided private commands. The built-in adapters do not satisfy the PRD's strong “agent cannot read holdout source” requirement on a shared host; use a separately isolated worker for that guarantee. Generated metamorphic tests, an API daemon, Herdr/Pi adapters, authority learning, and longitudinal drift analysis are future work.
- Agent CLI versions and user configuration can change behavior. Keep Codex/OpenCode up to date and inspect exported evidence before relying on a result.
- Worktree isolation protects the primary checkout from candidate edits. It is not a substitute for an OS sandbox, especially for an agent that can run arbitrary shell commands.

## Development

```sh
npm ci
npm test
npm pack --dry-run
```

The research source document `docs/deep-research-report.md` is not included in the npm package.

## Publishing

Before the first release, add a GitHub Actions trusted publisher in the npm package `evofence` under **Settings → Trusted Publishers**. Set the owner to `Calvin-Xia`, repository to `EvoFence`, workflow file to `publish.yml`, and leave the environment unset. No `NPM_TOKEN` is needed; the workflow authenticates through GitHub OIDC.

For each release, update the version in `package.json` and `CHANGELOG.md`, merge the change to `main`, then create a GitHub Release with the matching `v<version>` tag. Stable versions such as `v0.2.0` publish to npm's `latest` tag. SemVer prereleases such as `v0.2.0-beta.1` must be marked as prereleases in GitHub and publish to npm's `beta` tag. The workflow checks that the tag, package version, and prerelease flag agree, then runs the test suite before publishing.
