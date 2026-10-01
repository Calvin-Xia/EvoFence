# L2 wave-4 简报：l2_runtime（lane: runtime）

> 图：`evofence-harness-kernel` · 阶段 L2 · 上游 `l2_scheduler` / `l2_host_port` / `l2_artifact_port` 的产物已并入集成分支（基线由 orchestrator 在派单时告知）。
> 你只写自己的产物；图状态由 orchestrator 记录（lane 里没有 `.graph`，不要也无法改图）。

## 0. 工作区

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\runtime` |
| 分支 | `refactor/hk-runtime` |
| 基线 HEAD | 派单时告知（应含 src/protocol + src/storage + src/kernel/{graph,policy,scheduler} + src/runtime/host-port） |
| `node_modules` | 指向主 worktree 的 junction —— **不要 `npm install`、不要装包** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（orchestrator 合并；你不要往那里写） |

## 1. 节点合同

- **id**：`l2_runtime`（会话归约与效果恢复），context `ctx_runtime`。
- **plan**：实现 `create/step/pause/resume/cancel/observe/reconcile/close` 应用服务；将 host events 归一化，调用 scheduler/policy，**原子保存 events+outbox**。按 **invocation 而非物理 webhook 次数**去重用量。输出：确定性 reducer 与薄应用服务。
- **DoD**（逐条必须可证伪）：
  1. **相同事件与初始状态产生同样投影和 effect intentions**（确定性）。
  2. 日志重放、崩溃后未知效果和旧 epoch 回包**不会重复消费或放行**。
- **checkpoints**：cp1 会话 lifecycle 与 reducer；cp2 outbox ack 与 reconciliation；cp3 暂停/恢复/取消核验。

## 2. 物理落点与所有权

- 独占目录：**`src/runtime/session/**`**（新子树）。
- **不要修改**已冻结的 `src/runtime/host-port/**`、`src/kernel/**`、`src/storage/**`、`src/protocol/**`。跨域改动 → 停下报告（drift 交 orchestrator 收口）。
- 测试平铺 `test/l2-runtime-*.test.js`，从 `dist/**` 导入（ADR-0004）；每文件 ≤350 行（`npm run src:policy` 硬门禁）。
- 不 commit、不发布、不装包；`git status` 只显示你的新增文件。

## 3. 必读输入

- `docs/evofence-harness-kernel/spec/contracts/INTERFACES.md`（会话/内核服务行、HostPort 消费方式）、`SCHEMAS.md`（`Command`/`Event`/`Effect`/`Receipt`/`SessionView`/`NodeStateEntry`/`Binding`/`Usage`）、`README.md`（CONTRACTS §5 十条不变量）、`OWNERSHIP.md`
- `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`（协议层唯一入口；`decode` 边界）
- `docs/evofence-harness-kernel/spec/graph/SEMANTICS.md`（事件语义：A1–A6 / B1–B3 / INV；节点状态与 attempt 分离）
- 上游只读实现：`src/storage/**`（EventStore/SnapshotStore/Outbox/ArtifactStore；`commitBatch` 原子写、CAS、epoch、recovery）、`src/kernel/scheduler/**`（frontier/claim/fencing）、`src/kernel/policy/**`（BudgetLedger 预留/结算、usage completeness）、`src/kernel/graph/**`（decide 单一入口）、`src/runtime/host-port/**`（observe/execute/cancel/reconcile/context/usage、receipt 幂等、unknown 语义）
- `docs/evofence-harness-kernel/execution/tasks/L2-wave2-brief.md` §1（共享硬约束：防御性编程禁令、确定性、测试平铺）
- 管辖 ADR：`adr_0004`（事件真相源/outbox/恢复核实）、`adr_0009`（轻量协议内核与可选基础设施）——accepted 不等于运行承诺已证明。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

- **cp1 lifecycle 与 reducer**：`create/step/pause/resume/cancel/observe/close` 薄服务；纯 reducer：`(state, event) → state` + effect intentions，同输入逐字相同；节点状态与 attempt 分离；pause/resume 语义显式。
- **cp2 outbox ack 与 reconciliation**：每次 step 把 events+outbox 经 store 原子提交；pending 效果派发前先查 outbox/lease；旧 epoch 回包不改状态；崩溃后 unknown effect 保持 unknown 直到有真实证据 reconcile；旧 epoch 回包不重复消费。
- **cp3 暂停/恢复/取消核验**：取消未确认保持 `EFK_CANCEL_UNCONFIRMED` + unknown；取消/失败分支不遗漏；usage 按 invocation 去重（同一逻辑调用多个 webhook 只记一次；缺失 usage 不归零）；预算预留/结算经 policy ledger。
- 应用服务必须调用**唯一** policy/evaluation 入口（不发明第二套判定）；runtime 能力只来自参数端口（I08）；顶层 import 零副作用（I05）。

**防御性编程禁令**适用：契约/证据门禁、显式 unknown/reconcile、schema 显式拒绝、真实外部输入边界校验是保留项；"为不可能状态加守卫/吞错/双保险/惩罚式回退"删掉。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build`、`npm run typecheck`、`npm run src:policy`、`npm run dep:check` 全 0；`npm test` 能发现你的测试（给 `ℹ tests/pass/fail` 与新增用例名）。仓库既有 `test/runner.test.js` 等 wall-clock 用例在负载下偶发 flake，与本 lane 无关时如实标注。
- **每条 DoD 至少一个真实 negative control**（变异→变红→改回，报告变异点与变红用例名）。
- 报告未证明项（如：无真实宿主闭环、仅 fake host、耐久持久化不在本节点等）。

## 6. 完成回报格式

```
lane: runtime
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据
cp3: <passed|failed> — 证据
交付文件: <路径 + 行数，含测试>
实测命令: <命令 + 退出码>（build/typecheck/src:policy/dep:check/npm test）
测试门禁证据: <tests/pass/fail 数字 + 你新增的用例名>
未证明项: <如实列出>
阻塞: <无 / 具体>
```
