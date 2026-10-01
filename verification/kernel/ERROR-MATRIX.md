# 实测错误矩阵

17 条错误路径；code 均属于本次 build 的冻结 ERROR_CODES（58 码）。完整触发输入见 error-matrix.json。

| 路径 | 实测 code | 复现命令 |
|---|---|---|
| child-scope-widening | EFK_AUTHORITY_DENIED | `node verification/kernel/run.mjs --scenario delegation` |
| CAS-losing-planner | EFK_REVISION_CONFLICT | `node verification/kernel/run.mjs --scenario concurrency` |
| dispatch-losing-claim | EFK_CLAIM_CONFLICT | `node verification/kernel/run.mjs --scenario concurrency` |
| same-attempt-second-owner | EFK_CLAIM_CONFLICT | `node verification/kernel/run.mjs --scenario concurrency` |
| cancel-without-native-ack | EFK_CANCEL_UNCONFIRMED | `node verification/kernel/run.mjs --scenario cancellation` |
| concurrent-cap-blocks-new-reservation | EFK_BUDGET_EXHAUSTED | `node verification/kernel/run.mjs --scenario budget` |
| actual-spend-exceeds-ledger-cap | EFK_BUDGET_EXHAUSTED | `node verification/kernel/run.mjs --scenario budget` |
| overspent-policy-blocks-next-request | EFK_BUDGET_EXHAUSTED | `node verification/kernel/run.mjs --scenario budget` |
| metering-conflict | EFK_USAGE_CONFLICT | `node verification/kernel/run.mjs --scenario budget` |
| expired-dispatch-lease | EFK_LEASE_STALE | `node verification/kernel/run.mjs --scenario stale-lease` |
| revoked-root-at-scheduling | EFK_GRANT_REVOKED | `node verification/kernel/run.mjs --scenario boundary-errors` |
| unsupported-protocol | EFK_PROTOCOL_UNSUPPORTED | `node verification/kernel/run.mjs --scenario boundary-errors` |
| forged-evaluator | EFK_DECISION_AUTHORITY_DENIED | `node verification/kernel/run.mjs --scenario boundary-errors` |
| receipt-identity-changed | EFK_IDEMPOTENCY_COLLISION | `node verification/kernel/run.mjs --scenario boundary-errors` |
| journal-sequence-gap | EFK_RECOVERY_SEQUENCE_GAP | `node verification/kernel/run.mjs --scenario boundary-errors` |
| native-board-second-owner | EFK_HOST_BOARD_AUTHORITY_CONFLICT | `node verification/kernel/run.mjs --scenario boundary-errors` |
| seed-source-pin-drift | EFK_SOURCE_PIN_DRIFT | `node verification/kernel/run.mjs --scenario boundary-errors` |
