# L2 wave-3B 简报：l2_scheduler（lane: scheduler）

> 图：`evofence-harness-kernel` · 阶段 L2 · 上游 `l2_graph_model` / `l2_policy` / `l2_state_store` 的产物已并入集成分支。
> 你只写自己的产物；图状态由 orchestrator 记录（lane 里没有 `.graph`，不要也无法改图）。

## 0. 工作区

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\scheduler` |
| 分支 | `refactor/hk-scheduler` |
| 基线 HEAD | 由 orchestrator 在派单时告知（含 `src/protocol/**` + `src/storage/**` + `src/kernel/policy/**` + `src/kernel/graph/**`） |
| `node_modules` | 指向主 worktree 的 junction —— **不要 `npm install`、不要装包** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（orchestrator 合并；你不要往那里写） |

## 1. 节点合同

- **id**：`l2_scheduler`（租约、资源冲突与公平调度），context `ctx_graph`。
- **plan**：在 compiled plan 上实现 ready frontier、claims、fence/epoch、子图深度/并发限制、资源锁与完整 fan-in；**并发只有输入/写资源独立时启用**；共享代码 merge 与能力指针由**唯一 writer 串行提交**。输出：可解释 dispatch decision。
- **DoD**（逐条必须可证伪）：
  1. 同一资源不存在两个有效 writer；**过期 lease 回包不改状态**。
  2. 失败/取消分支不被遗漏；**不会等待已终止 worker 形成死锁**。
- **checkpoints**：cp1 frontier 与 claim/fencing；cp2 共享资源和预算联动；cp3 fan-in/取消/公平性核验。

## 2. 物理落点与所有权

- 独占目录：**`src/kernel/scheduler/**`**（新子树）。
- **不要修改**已冻结的 `src/kernel/graph/**`（graph lane）、`src/kernel/policy/**`（policy lane）、`src/storage/**`（store lane）、`src/protocol/**`。需要跨域改动 → 停下报告（drift 由 orchestrator 收口）。
- 测试平铺 `test/l2-scheduler-*.test.js`，从 `dist/**` 导入（ADR-0004）；每文件 ≤350 行（`npm run src:policy` 硬门禁）。

## 3. 必读输入

- `docs/evofence-harness-kernel/spec/graph/SEMANTICS.md`（readiness/frontier、lease、fan-in、loop 边界）+ `EXAMPLES.md`（10 个可判定工作例）
- `docs/evofence-harness-kernel/spec/contracts/INTERFACES.md`（调度与内核端口行）、`SCHEMAS.md`（`LeaseRef`、`Binding`、`BudgetPolicy`、`Effect`/`EffectPayload`）、`README.md`（CONTRACTS §5 十条不变量中与 lease/预算/fan-in 相关者）、`OWNERSHIP.md`
- `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`（协议层唯一入口）
- 上游实现（只读）：`src/kernel/graph/**`（compiled plan、decide 单一入口）、`src/kernel/policy/**`（BudgetLedger 预留/结算、lease 相关约束）、`src/storage/**`（EventStore CAS/epoch/revision）
- `docs/evofence-harness-kernel/execution/tasks/L2-wave2-brief.md` §1（共享硬约束）
- 管辖 ADR：`adr_0002`（动态 Graph Engineering 与有界 agent loops）、`adr_0004`（事件真相源/outbox/恢复核实）——accepted 不等于运行承诺已证明。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

- **cp1 frontier 与 claim/fencing**：从 compiled plan 计算 ready frontier；claim 原子性（CAS 唯一 writer）；fence/epoch 使过期 lease 回包**不改状态**；子图深度/并发上限。
- **cp2 共享资源和预算联动**：资源锁（reader/writer 冲突判定）；并发只在输入/写资源独立时启用；dispatch decision 与 BudgetLedger 预留联动（缺 usage 不归零、并发 reservation 不复制预算）。
- **cp3 fan-in/取消/公平性核验**：完整 fan-in（不完整必需 fan-in 不判 ready）；失败/取消分支不被遗漏、不等待已终止 worker 的死锁；公平性（防饥饿）可解释。dispatch decision 必须可解释（输入 → 决策），不散落隐式规则。

**确定性/注入**：clock/随机/digest 显式注入；同输入逐字相同（I07）；顶层 import 零副作用（I05）；runtime 能力只来自参数端口（I08）。**防御性编程禁令**适用（契约/证据门禁、显式 unknown/reconcile、schema 显式拒绝、真实外部输入边界校验除外）。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build`、`npm run typecheck`、`npm run src:policy`、`npm run dep:check` 全 0；`npm test` 能发现你的测试（给 `ℹ tests/pass/fail` 与新增用例名）。仓库既有 `test/runner.test.js` 等 wall-clock 用例在负载下偶发 flake，与本 lane 无关时如实标注。
- **每条 DoD 至少一个真实 negative control**（变异→变红→改回，报告变异点与变红用例名）。
- 不 commit、不发布、不装包；`git status` 只显示你的新增文件。

## 6. 完成回报格式

```
lane: scheduler
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据
cp3: <passed|failed> — 证据
交付文件: <路径 + 行数，含测试>
实测命令: <命令 + 退出码>（build/typecheck/src:policy/dep:check/npm test）
测试门禁证据: <tests/pass/fail 数字 + 你新增的用例名>
未证明项: <如实列出>
阻塞: <无 / 具体>
```
