# L4 experience proposals

Entry: `dist/learning/proposals/index.js`, built from this lane's TypeScript.
`CandidateSpec` is local immutable proposal metadata, not a new frozen wire object,
qualification decision, registry transition or activation receipt.

`extractExperience(selections, limits, at, ports)` accepts an explicit selection of
training `ArtifactRef`s, producer/schema/binding expectations, visibility reasons,
evidence grades and project/host/model/task scope. Both privacy axes are admitted
for the entire selection before a store read. Source bytes must match their pins.
JSONL size, total event count, pattern count and text lengths have explicit bounds.
The artifact store and source classification belong to the trusted caller; this
module does not discover locators, read arbitrary sessions or infer a private split
from opaque, incorrectly labeled text.

Only these observations enter patterns: visible `check` exit codes, `fatal`,
`same-session-recovery`, completeness of `native-usage`, and the receipt status of
`native-abort-ack`. Raw messages, result bodies, exception text, final scores and
terminal evaluator outcomes are excluded. Event links pin source ID, complete
trace digest, one-based JSONL line and exact line-byte digest. Patterns never join
different project/host/model/task scopes. A driver recovery event is an observed
continuity event, not proof that the task passed or that recovery is generally safe.

`proposeDeterministically(experience, ports)` supplies a zero-provider baseline.
It selects only patterns with both a success and an observed failure, creates
bounded conditional hypotheses and records `requests=0`, `estimatedUsdMicros=0` for
model generation. This does not assert zero local CPU, wall-time or storage cost.
Unpaired patterns are retained in the experience but do not become candidates.
Every proposal remains an unproved hypothesis scoped to its source observations.

For model generation:

1. Create an exact `CandidateGenerationInput` ref for `generationPrompt(experience)`.
   Call `prepareGeneration` with the host's pinned tokenizer and its measured
   retained input overhead. It stores only the projected prompt and returns a
   `host.agent` operation with `fresh` context isolation.
2. The caller supplies its existing, authorized `SessionService`, shared budget
   policy and a pinned, single learner node with `maxAttempts=1`. Its policy input
   and output token limits must fit the proposal limits; its worst-case reservation
   must cover all billable host work and fit `maxGenerationMicros`. Commit the
   operation/reservation through the existing journal/outbox path. This lane opens
   no new budget pool, changes no core contract and mints no grant.
3. Call `dispatchGeneration(experience, plan, seed, effectId, at, ports)`. It checks
   the committed seed, exact operation, finite budget/reservation and fresh source
   pins before invoking `SessionService.step`. Only the runtime calls HostPort.
   An already-started effect is refused; unknown execution requires reconciliation.
4. `collectGeneration` can also read a previously completed effect without dispatch.
   The output must be one digest/binding-verified `CandidateDrafts` artifact from an
   applied completed receipt. The shared journal-derived settlement must match
   exact complete usage. Missing metering retains the reservation and yields no
   candidate; later complete telemetry can settle it without another model call.
   Actual cost/token overflow remains recorded and prevents candidate delivery.

Candidate drafts specify category (`graph-template`, `strategy`, `experience`,
`skill`, `tool`), an intervention/improvement/measurement hypothesis, conditions,
success links, observed failure counterexamples and bounded content. The binder
resolves all links in the same source pattern, constructs source refs and scope
itself, and rejects invented support/counterexamples. Content is data, not an
executable instruction or a proven capability. Repeated generation costs on several
candidates refer to one effect/request: downstream accounting must deduplicate by
those identities instead of summing candidate copies of the same receipt.

`verifyCandidates` re-reads source evidence and checks exact content, scope, limits
and accounting before staging. Model proposals additionally require their current
SessionService collector; draft-supplied cost is never trusted. `stageCandidate`
uses the existing assets writer to create one immutable digest-named JSON file in
the caller's explicit project staging area. The caller owns authorization and
serial writer/lease checks. No registry promotion/activation or global Skill/control
plane writer is available here. The writer's same-user filesystem boundary is not
an OS sandbox or a crash-durable transaction with asset registration.

Evidence grades are separate: existing Pi/DSH source traces are provider-live
source evidence; generated provider receipts were not obtained in this lane.
The SessionService/HostPort tests use synthetic native fixtures. A non-synthetic
usage row alone leaves generation evidence `unknown` until independent native and
provider provenance is available. Hidden-set capability uplift and qualification
belong to later evaluation, never to this proposal pipeline.

Run the four lane gates, `node --test test/l4-experience*.test.js` twice, and
`node verification/kernel/static-audit.mjs`. Local ignored `evidence/` and
`EVIDENCE.md` hold exact source pins, staged proposals, gate/test logs and mutation
results. Mutation tests execute real modified module byte copies through an
isolated loader, restore the loaded copy byte-for-byte and rerun the same named
test; the original source and dist remain unchanged.
