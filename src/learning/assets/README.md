# L4 asset registry

Lane: `l4-assets`; baseline `6728aae860d4434f8acde554d059a1d344a8bf60`.
Public subtree entry: `src/learning/assets/index.ts` (`dist/learning/assets/index.js` after build).

## Identity and state

`AssetRevision` contains the frozen, initially staged `CapabilityAsset`, a local category,
explicit compatibility pins and caller-injected `createdAt`. `revisionDigest` hashes canonical
immutable material with the injected `DigestPort`. Content/source refs, dependency revisions,
scope, compatibility, hypothesis, expiry, category and creation time participate; observed
qualification/evaluation/revocation refs do not. Digest comparison and byte availability use
the existing artifact store; producer attribution, audience restrictions and train-only source
admission reuse `kernel/artifacts`.

The six local categories map to the frozen four wire kinds:

| Local category | CapabilityAsset.kind |
|---|---|
| graph-template | template |
| strategy / experience | memory |
| skill / code-patch | skill |
| tool | tool-policy |

The local category remains in the immutable revision and its digest; it does not extend the
wire enum or change a Skill into an executable code patch. Consumers choose how to apply each
category. No protocol/core file or public package export is changed.

`emptyRegistry`, `stageRevision`, `recordDecision`, and `revokeRevision` operate on trusted
snapshots and return immutable next snapshots. Revisions append consecutively, duplicate staging
returns the same snapshot, collisions are refused, and no API deletes history. All caller inputs
are cloned before deep freeze. Dependencies must identify an already registered exact revision;
forward references and replacement digests fail, so the immutable dependency graph is acyclic.

The observations are `staged -> validated -> promoted -> active`, with revocation from any
non-revoked state. `active` is an observation for a concrete host session and scope, never a
global CapabilityAsset qualification. The immutable seed stays staged; the trusted append-only
history holds later observations. A registered candidate evaluator must supply a real,
digest-verified `DecisionRecord` and complete `EvaluationReceipt`; registered promotion and
activation services are separate. All required positive judgements and passed guardrails are
retained and checked, with no failed-result filtering. Promotion cannot substitute another
evaluation. Activation needs a confirmed `ActivationReceipt`, actual readable new/previous
snapshot refs, matching asset/session/scope/evaluation, and active dependencies in that context.
Failed/unknown attempts return typed failures and leave the input snapshot untouched.

## Qualification

`qualification(snapshot, assetRef, context)` returns a deterministic, reference-free public
view. It does not read the clock/store or modify history. Exact host/version/manifest, model
including reasoning payload, repository/base, task and scope pins must match. Empty compatibility
or missing material/evaluation is never treated as qualification.

`eligible` means promoted and compatible with a qualified dependency closure (retrieval);
`usable` means explicitly active in that exact context with active dependencies (application).
Validated alone has `eligible=false, usable=false`. Revocation and asset/material/evaluation
expiry invalidate every transitive dependent at query time. Original observations remain in
history; propagation does not fabricate revocation decisions for dependents. Snapshot/activation
evidence expiry prevents that scoped activation from being usable. `EXAMPLE.json` (kept locally, untracked; see `.gitignore`) is extracted
from the passing test run and shows validated/promoted/active and mismatching session/host views.

## Authority and actual project writes

`RegistryPorts.authorize` is supplied by the owning command service, which checks current
permission root/grant, lease, safe idle and actual scope. The registry cannot mint authority.
These pure plans do not persist a second journal and must only be published by the caller after
its command/CAS commit. Wiring asset commands into the frozen core, crash durability, and a
production permission-root implementation are not claimed by this lane.

`writeProjectCandidate` is an optional filesystem adapter outside the core closure. The caller
provides existing project/staging roots, explicit read-only user Skill roots, and a relative
candidate filename after its authorization/serial-writer checks. It resolves roots and parents
with `realpath`, uses path-component containment, and refuses traversal, sibling-prefix escapes,
directory junction escapes and read-only Skill targets. Exclusive `wx` creation preserves
existing files, symlinks and hardlinks. It never creates missing parent directories or discovers
user paths. This is a same-user workspace boundary, not an OS sandbox against concurrent
filesystem tampering. A write I/O error is not a successful stage/activation receipt.

Tests use actual temporary directories containing synthetic user Skills; no real user Skill
directory was sampled or modified. Activation/evaluation/authority tests use explicit fixtures,
not real host receipts or capability-benefit evidence.

## Verification

See `EVIDENCE.md` (kept locally, untracked; see `.gitignore`), `evidence/results.json`, both complete test-run logs, and the static audit
output. `test/l4-assets-negative-controls.test.js` runs five genuine implementation mutations in
isolated child module loaders: one target test passes, fails by assertion under the mutant, then
passes without the loader. Each run checks the on-disk dist hash is unchanged and records exact
edit sites and red TAP output. Mutation execution does not edit core or production source.

```powershell
npm run build
npm run typecheck
npm run src:policy
npm run dep:check
node --test test/l4-assets-*.test.js
node --test test/l4-assets-*.test.js
node verification/kernel/static-audit.mjs
```
