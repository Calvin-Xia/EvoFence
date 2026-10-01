# l2_kernel_verification 执行简报（codex lane）

> 图：`evofence-harness-kernel` · 节点 `l2_kernel_verification`（type=gate，内核完整性纵向核验） · 阶段 L2 收口门
> 你只写本节点产物；图状态由 orchestrator 记录（lane 内无 `.graph`）。cwd 由 orchestrator 派单时给出。

## 1. 节点合同（真相源：`graph get-node -i l2_kernel_verification`）

- **plan**：通过 fake host 与真实持久实现走普通任务、动态委派、验证失败修复、超预算、崩溃与恢复；验证实际应用服务调用唯一 policy/evaluation 入口，不留下 NOT WIRED 影子判定。输出：错误矩阵与可复现轨迹。
- **DoD①**：所需状态、边、授权、预算与效果错误路径有契约证据。
- **DoD②**：生产 wiring 与静态模块依赖得到核验；不是只测纯函数副本。
- **checkpoints**：
  - cp1 正常纵向轨迹（普通任务完整走通：命令 → 事件 → 投影/节点状态 → 效果回执 → 关闭）
  - cp2 并发/取消/崩溃故障轨迹（并发 claim、取消未确认、超预算、崩溃恢复 + unknown reconcile）
  - cp3 唯一判定入口与依赖核验（应用服务只调用 scheduler/policy/graph 的唯一入口；无第二套判定；静态依赖无误接）

## 2. 独占产物目录与边界

- 独占：`verification/kernel/**`（新建；可含脚本、轨迹 JSON、错误矩阵、README）。测试若需平铺，放 `test/l2-kernel-verify-*.test.js`（从 `dist/**` 导入；≤350 行/文件）。
- 只读：`src/protocol/**`、`src/storage/**`、`src/kernel/**`、`src/runtime/**`。发现必须修下游源码的问题 → 停下报告 drift（截图/diff/最小复现），交 orchestrator 决定，不自行改冻结区。
- 不 commit、不发布、不装包；结束时 `git status` 只显示你的新增产物。

## 3. 要交付的证据（可复现，不接受只报「我跑过」）

1. **可运行入口**：一个脚本（如 `verification/kernel/run.mjs` 或按 cp 分文件）从干净 checkout 可重复跑出全部轨迹；每条轨迹打印确定性摘要（哈希或规范化 JSON），两次运行一致。
2. **cp1 轨迹**：普通任务端到端（用 fake host + 真实 EventStore/SnapshotStore/Outbox/ArtifactStore/logger，非纯函数副本）；断言每一步：命令被接受、事件+outbox 原子落盘、投影与节点状态推进、效果回执对账、session 关闭。
3. **cp2 轨迹**（至少四条）：并发两 attempt 的 fencing；取消未确认 `EFK_CANCEL_UNCONFIRMED` + unknown 保持；超预算被 policy ledger 拒绝且预留/结算分离；崩溃恢复（在 commit 前后注入崩溃）后未知效果保持 unknown 直到真实 reconcile 证据，旧 epoch 回包不改状态。
4. **错误矩阵**：每条错误路径 → 实际 error code（必须 ∈ 冻结 ERROR_CODES）→ 触发输入 → 复现命令。
5. **cp3 证据**：`npm run dep:check` + `npm run src:policy` 实测输出；对应用服务的调用图/facts 入口做静态核对，列出「唯一判定入口」清单与反例检查（无 NOT WIRED/影子分支）；与 `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`、`adr_0004` 对齐。
6. **门禁**：`npm run build`、`npm run typecheck`、`npm run src:policy`、`npm run dep:check` 全 0；你新增的测试全绿（给 `ℹ tests/pass/fail` 与用例名）；对关键断言做变异测试（变异 → 变红 → 复原 → 复绿，逐条记录）。

## 4. 完成回报格式

```
lane: kernel-verification
cp1: <passed|failed> — 证据路径 + 实测命令/输出摘要
cp2: <passed|failed> — 同上
cp3: <passed|failed> — 同上
错误矩阵: <路径>（<条目数>）
轨迹可复现性: <两次运行摘要一致性证据>
门禁: build/typecheck/src:policy/dep:check/test 实测数字
未证明项: <如实列出（真实宿主闭环仍归 L3 等）>
阻塞: <无 / 具体>
```

## 5. 纪律

- 防御性编程禁令与测试口径见 `SESSION-PROTOCOL.md`（本次 build 的 dist、无镜像测试、不缩小标准）。
- 证据分级：fake host/内存持久实现可作 cp1/cp2 证据，但必须明确标注哪些是模拟边界；不得冒充 L3 的真实双宿主闭环。
