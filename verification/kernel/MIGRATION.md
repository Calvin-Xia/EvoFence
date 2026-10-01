# S05 I01 纯搬迁清单

12 个文件搬迁、1 个 core barrel 新建、19 个既有文件只改 import/export 来源。所有函数体、签名、SessionPorts 与测试断言逐字节保留。

## 移动文件（12）

| 原路径 | 新路径 | 非 import 字节相同 |
|---|---|---|
| src/storage/contracts.ts | src/kernel/store/contracts.ts | true |
| src/storage/identity.ts | src/kernel/store/identity.ts | true |
| src/storage/projection.ts | src/kernel/store/projection.ts | true |
| src/storage/outbox.ts | src/kernel/store/outbox.ts | true |
| src/storage/artifacts/access.ts | src/kernel/artifacts/access.ts | true |
| src/storage/artifacts/admit.ts | src/kernel/artifacts/admit.ts | true |
| src/storage/artifacts/availability.ts | src/kernel/artifacts/availability.ts | true |
| src/storage/artifacts/binding.ts | src/kernel/artifacts/binding.ts | true |
| src/storage/artifacts/consumer.ts | src/kernel/artifacts/consumer.ts | true |
| src/storage/artifacts/identity.ts | src/kernel/artifacts/identity.ts | true |
| src/storage/artifacts/index.ts | src/kernel/artifacts/index.ts | true |
| src/storage/artifacts/types.ts | src/kernel/artifacts/types.ts | true |

## 新增 core 文件（1）

- src/kernel/store/index.ts：只重导出纯契约、身份、投影和 outbox；无 backend import。

## 修改既有文件（19，仅 import/export 来源）

- src/storage/memory-event-store.ts（5 处来源替换）
- src/storage/memory-snapshot-store.ts（4 处来源替换）
- src/storage/memory-artifact-store.ts（3 处来源替换）
- src/storage/store-session.ts（5 处来源替换）
- src/storage/index.ts（5 处来源替换）
- src/runtime/session/controls.ts（1 处来源替换）
- src/runtime/session/dispatch.ts（2 处来源替换）
- src/runtime/session/evaluation.ts（2 处来源替换）
- src/runtime/session/journal.ts（1 处来源替换）
- src/runtime/session/plans.ts（1 处来源替换）
- src/runtime/session/project.ts（2 处来源替换）
- src/runtime/session/receipts.ts（2 处来源替换）
- src/runtime/session/service.ts（2 处来源替换）
- src/runtime/session/types.ts（1 处来源替换）
- test/l2-artifact-access.test.js（1 处来源替换）
- test/l2-artifact-binding.test.js（1 处来源替换）
- test/l2-artifact-consumers.test.js（1 处来源替换）
- test/l2-artifact-identity.test.js（1 处来源替换）
- test/l2-artifact-repairs.test.js（1 处来源替换）

## verification 工具与证据更新

- 新增 relocate.mjs、verify-relocation.mjs：搬迁与源字节核对；relocate.mjs 是单次执行脚本，已有 snapshot 时拒绝重跑。
- mutations.mjs：unknown-resend 变异路径从 dist/storage/outbox.js 改为 dist/kernel/store/outbox.js。
- capture-evidence.mjs：要求 cp1-cp3 exit 0，并与 pre-fix/repeatability.json 进行逐字节比对。
- 重建 evidence/**，保留 pre-fix/ 的原 14 violations、旧摘要及被搬迁/改 import 文件的完整原始文本。
- README.md、REPORT.md、DRIFT.md 更新为 resolved/passed；ERROR-MATRIX.md 无语义变化，仍为 17 条冻结错误路径。

## 受影响节点及证据入口

| 节点 | 影响 | 证据 |
|---|---|---|
| l2_state_store | port/identity/projection/outbox 上移；backend 反向引用 kernel；storage/index 导出不变 | evidence/relocation.json、evidence/relocation-verification.json、evidence/gates/test.stdout.txt |
| l2_artifact_port | 8 个纯模块移入 kernel；5 个测试仅改 import | evidence/relocation-verification.json、evidence/gates/test.stdout.txt |
| l2_runtime | 9 文件 14 条 storage import 全部改到 kernel；SessionPorts 注入不变 | evidence/static-audit.json、evidence/relocation-verification.json、evidence/repeatability.json |
| l2_kernel_verification | cp3 0 violations；全部 12 条轨迹不变；7 个变异重新红绿 | evidence/summary.json、evidence/command-repeatability.json、evidence/mutations/results.json、evidence/gates/results.json |
| l2_public_contracts / graph_model / policy / scheduler / host_port | 未改来源文件或冻结合同，既有测试仍包含在 814/814 门禁内 | evidence/gates/test.stdout.txt、evidence/scope-check.json |

没有 commit/install/.graph 操作；没有更改 OWNERSHIP.md、R1、协议语义或 ledger/schema。

完整源文本和摘要前后关系见 evidence/pre-fix/relocation-sources.json 与 evidence/relocation-verification.json。
