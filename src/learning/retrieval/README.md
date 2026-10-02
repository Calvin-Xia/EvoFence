# L4 retrieval

Entry: `src/learning/retrieval/index.ts` (`dist/learning/retrieval/index.js` after build).
Lane `l4-retrieval`, branch `refactor/hk-l4-retrieval`, baseline `d2e311d`.

## Call contract

```ts
const result = retrieveContext({
  registry,          // current trusted, journal-derived assets.RegistrySnapshot
  candidates,        // explicit exact assets.AssetRef revisions; no latest discovery
  context,           // assets.QualificationContext: host/model/repo/task/scope/time pins
  taskContract,
  role: 'executor',
  baseInputs,        // context.ContextInputs: current node/attempt binding and base plan
  materials,         // explicit context.ContextArtifact hydration and producer expectations
  window,           // context.WindowBudget, including retained host resources
  budget: { maxAssets: 5, maxAddedTokens: 2000 },
}, { digest, tokenizer, artifacts });
```

These are local function parameters and a proposed context, not new wire contracts, a durable
registry, a decision or an activation receipt. The caller supplies current trusted registry and
node metadata. Every candidate content ref must already be declared in `baseInputs.nodeInputRefs`;
the base plan excludes retrieval content. Selection proposes a plan using a subset of these
declared inputs. It grants no new read permission and does not mutate or commit a NodeSpec.
The caller commits an approved plan and re-queries qualification at the actual safe activation
point, obtaining an independent ActivationReceipt through the existing assets/host contracts.
Dependencies may be eligible for retrieval without being active; actual activation still requires
the upstream active dependency closure. Cached candidate packets are not revocation-aware host
snapshots and must not be dispatched after registry/binding changes.

The function does not read time, environment, locators or a vector database. ArtifactStore is
injected. No model, host, network, dependency installation or graph operation occurs.

## Qualification and deterministic budgets

`assets.qualification` alone decides scope compatibility, promotion, exact revision, dependency
revocation and expiry. A promoted asset is eligible but is not assumed active. Staged/validated,
unknown and invalid qualifications produce typed per-asset ignore codes before material reads.
Public attribution stores only asset ID/revision/digest and the upstream reference-free
Qualification view; it never exposes private evaluation references or bytes.

Currently available immutable content and train-only provenance are read through
`kernel/artifacts.verifyForConsumer(role=asset)`. Source attribution was established by the
registry's staging path, not another local provenance policy. An unavailable source cannot be
replaced with a reference or summary. Exact registered refs, declared node refs and hydrated bytes
must agree; experiences can have `evidence` or `handoff` purpose, never privileged instruction or
candidate-feedback labels. Held-out/final visibility and partition restrictions use the existing
artifact admission rules. `dev` is not a sourceTrace, following the stricter SCENARIOS rule.

Ranking is ascending sum of the injected tokenizer's counts of complete content strings. Ties
use asset ID in code-point lexical order, revision descending, then digest lexical order.
No locale, caller order, host brand preference, learned score or latest lookup participates.
Duplicate candidate identities and ambiguous duplicate material IDs are typed failures.
Repeated inputs and permutations of candidate/material declarations produce identical results.

For each ranked asset, selection tries the union of its complete content refs and previously
selected refs through `context.buildContextPacket`. Shared identical hydration is counted once
in dispatch. The router owns binding/schema verification, audience projection, serialization,
compaction, audit links and the whole-packet window limit. The count budget is explicitly 0..5.
An oversized asset is ignored and selection continues; it does not truncate an arbitrary top-k
prefix or assume tokenizer monotonicity. Other candidate admission failures also retain their
typed ignore codes. An invalid base context remains a typed error.

```text
inputTokenDelta = candidate.tokenCount - baseline.tokenCount
chargedAddedTokens = max(0, inputTokenDelta)
chargedAddedTokens <= budget.maxAddedTokens
candidate.tokenCount <= router.tokenLimit
```

Both packets use the same task, host resources, output reservation, role and tokenizer. The
router can compact the resulting packet as its existing contract allows; reference-only entries
are explicitly retained with attribution and are not claims of content use. With no eligible or
fitting assets, the result is `mode=base`, `candidate=null`, an explicit fallback reason and the
exact baseline BoundedContextPacket, not an empty proposed injection.

## Attribution and comparison cost

`retrieved=true` means qualification and current material admission reached the ranked pool.
Clipped items have `disposition=ignored` and a count/token/window reason. Selected items start
`pending`, with their context entry IDs. Retrieval never increments `used` automatically.

`recordUsage(result, reports)` requires one explicit `used`/`ignored` report and nonempty reason
for every selected asset, rejecting missing, duplicated or unselected reports. It returns a new
attribution view and preserves the candidate and cost. Feedback is caller-reported adoption;
this module does not verify the actual adopted repair path or infer causal benefit. The trial
and evidence pipeline must supply those observations.

Cost records tokenizer ID, baseline/candidate input tokens, signed delta, nonnegative added
charge, qualification query count, material store get calls, UTF-16 code units read, tokenizer
invocations and their summed token counts. Computational token counts include the baseline,
ranking and discarded/compacted trial packets; they are work telemetry, not billed model input.
Material read counts cover this lane's injected store reads, not the router's verification buffer.
No overhead disappears when every candidate is ignored or the candidate set is empty.

`modelRequests=0` describes this pure retrieval operation. `wallMs` and `usdMicros` remain null:
an integer token estimate cannot establish wall time, provider usage, cache pricing or an invoice.
The caller measures wall time around the entire operation and accounts actual injected dispatch
usage within the existing shared experimental envelope. No additional fixed token-per-character
estimator or cost ledger is introduced. Fixture counts use one UTF-8 byte per fixture token.

## Evidence and limits

See `EVIDENCE.md` (kept locally, untracked; see `.gitignore`) and `evidence/`. Tests obtain promoted/revoked states through real registry
operations, using synthetic evaluator receipts and a deterministic fixture tokenizer. They cover
scope/provenance/unverified/held-out negatives, binding/declaration/hydration refusals, dependency
revocation/expiry, empty fallback, complete-packet boundaries and feedback attribution.

No live Pi/DSH activation, provider tokenizer, actual adopted repair, persistent command wiring,
wall/USD measurement or held-out capability uplift is proved here. Mislabeled private data in
otherwise trusted public/train bytes cannot be inferred from opaque text; split integrity belongs
to the existing registry/evaluation evidence path. True benefit belongs to `l4_capability_trial`.
