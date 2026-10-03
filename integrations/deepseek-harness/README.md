# EvoFence native session binding for DeepSeek Harness

This checkout binds the existing DSH agent/session to the EvoFence session service. It reuses the host model, instructions, ToolRuntime and transcript. Kernel policy, reservations, claims and independent evaluation remain in the injected runtime ports.

The user selected version decision A: follow the locally exercised DSH **0.2.0-rc.2**. Both `engines.dsh` and the `@deepseek-ai/dsh-tools` peer are pinned to that exact version. The former **0.1.7-rc.1** pin and read-only ledger tools are historical behavior; their Profile installation evidence does not establish compatibility of this native binding.

## Composition

Build the repository with `npm run build`. The private checkout entry imports `../../dist/hosts/dsh/index.js`; it is not a standalone published package entry. The retained `evofence@0.5.0` dependency does not supply this new implementation. Distribution/export work belongs to the later packaging lane, and this task did not install a DSH Profile.

The Cordis plugin exports `evofence-cordis-runtime` and injects `tools`, `agents`, `sessionProjections` and an explicit `evofenceRuntime` service. The composition owner must provide the `DshComposition` contract in [types.ts](../../src/hosts/dsh/types.ts):

- Exact host `version`, native message/tool/schema helpers and the existing session-service ports, excluding `host`.
- `sessionFor(agent)`: an explicit kernel seed with `sessionId === agent.id === agent.session.id`; return `null` for sessions not delegated to EvoFence. Supply the same seed when reopening the journal.
- `allowTool(effect, execution)`: the kernel request permission input, composed with the host's existing tool policies.
- `usageSource` and `onObservation`: explicit usage provenance and metadata-only observation delivery.

The entry performs no backend or credential discovery and launches no CLI subprocess. `cordis.patch.yml` retains the existing bundle/row identifiers (`@local/evofence-deepseek-harness`, `evofence-tools`). The caller must provision the composition service before mounting the plugin. The native test fixture demonstrates this seam without provider credentials.

## Native operations

| Tool | Behavior |
| --- | --- |
| `evofence_status` | This caller's kernel state, binding health and unknown-effect/usage issue identifiers. |
| `evofence_continue` | Queue one admitted round on the same native agent after its current turn settles. |
| `evofence_pause` | Pause evolution dispatch while ordinary native work remains available. |
| `evofence_resume` | Explicit manifest re-admission and epoch advance; does not replay unknown actions. |
| `evofence_reconcile` | Resolve confirmed in-memory receipts and preserve unknown outcomes. |
| `evofence_evaluate` | Invoke the registered independent task evaluator. Tool completion alone cannot pass a task. |

ToolRuntime supplies the exact live caller. Native session creation/resume, pre-step, tool policy/result and transcript events feed the binding. The `evofenceNative` session projection is a replayable host view, not kernel state. The native board is read-only here: an owner must map to an existing kernel claim; this binding never creates or acquires native board ownership.

## Failure, recovery and usage

Hook loss, callback/runtime errors and plugin teardown refuse further evolution and attempt a journal pause. A pause-store failure remains visible as `pauseError` while local refusal stays armed. The plugin removes its own registrations; it does not cancel or dispose ordinary host work. Native reopen uses the same session id and requires explicit re-admission. Unknown actions remain unknown across reopen and reconciliation.

Invocation identity uses the durable native settlement sequence. Token counters preserve the host's disjoint uncached/cache-read/cache-write/output semantics; missing counters and absent USD/invoice values remain `null`. Duplicate invocation rows are checked, and the runtime retains reservations when cost is unknown. A kernel model effect admits one native pre-step: implicit extra loop steps are rejected. SDK/provider retries within that step are not a proven budget bound; multiple observed invocations degrade the binding without being collapsed into one reservation.

This lane implements `host.agent`, `host.tool` and scoped native-loop cancellation. Delegation, fresh child context and activation effects return explicit unsupported results. Cancellation does not establish long-running tool, parent/child or provider billing guarantees. Restart reconciliation does not infer an external side effect from a transcript.

## Reproducible evidence

From the repository root:

```sh
node integrations/deepseek-harness/evidence/revalidate-native.mjs
node integrations/deepseek-harness/evidence/negative-controls.mjs
node integrations/deepseek-harness/evidence/verify-lane.mjs
```

The first script re-executes the existing native probe and redirects only its output into this integration directory. Its provenance records the original source hashes. The second temporarily mutates two owned source files, requires red tests, restores their exact bytes and requires green tests. The third records every required gate and two consecutive lane test runs.

The evidence uses real Cordis, AgentLoop, ToolRuntime, projections and native resume, with synthetic LLM and memory persistence fixtures. Provider-live, native disk/crash and installed Profile compatibility remain unverified. See [L3-DSH-REPORT.md](L3-DSH-REPORT.md) for checkpoint evidence, the version decision, all 13 retained unknowns and integration diff scope.
