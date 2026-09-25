# Pi tool strategy

The `evofence run --adapter pi` adapter loads one explicit EvoFence extension. Pi's automatic extension discovery remains disabled. The extension changes the active tool set and its ordering only within the tools Pi already made active for that invocation.

## Phase policy

| Phase | Active tools exposed to Pi | Initial order |
| --- | --- | --- |
| Proposal | Only currently active `read`, `grep`, `find`, and `ls` tools | `read`, `grep`, `find`, `ls` |
| Implementation | The complete tool set Pi already activated | `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `powershell`; other active tools keep their relative order after these |

If a proposal invocation has active tools but none are on the read-only allowlist, the controller records a degraded status and restores Pi's original tool set and order. This keeps a broken or incompatible strategy from silently leaving the agent without tools.

## Feedback within a phase

- A tool error moves that tool behind other active tools and adds concise recovery guidance to the result.
- One retry with the exact same tool name and arguments is blocked. The agent can change its inputs or choose another currently active tool. The retry fingerprint is hashed and held only in memory; arguments are not written to telemetry.
- A successful tool call clears stale error state and restores the phase's normal priority order.
- Strategy state is discarded when that Pi phase invocation ends. Later phases and later EvoFence runs start from their own phase defaults.

The priority order is a tool-selection hint; it is not a claim that Pi will always choose the first tool or that task quality has improved.

## Boundaries and fallback

The extension does not register tools, add permissions, or load user/project extensions. Proposal-phase selection is a subset of the tool names already active in Pi. The strategy does not provide an OS sandbox; the adapter still requires `--allow-unisolated-agent`, and EvoFence's proposal, contract, budget, and evidence gates remain authoritative.

If a strategy callback, Pi tool-selection API, or telemetry write fails, the controller disables itself and attempts to restore the original active tool set and order. Pi then continues with its normal tools. If the sidecar log cannot be created, EvoFence launches Pi without the strategy extension.

## Recorded summary

The per-invocation sidecar contains only the phase, tool names, ordering, call/result/error counts, repeated-call blocks, and controller status. It excludes tool arguments and result content. The adapter summarizes this bounded telemetry into the `adapter.finished` ledger event and discards the sidecar with the candidate worktree.
