# l2_runtime 独立复核简报（首轮 review）

> 图：`evofence-harness-kernel` · 节点 `l2_runtime`（会话归约与效果恢复） · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点任何写作）
> 你的 cwd 是集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。你**只读**源码与测试；唯一允许写的文件是最终 dossier。

## 0. 复核对象

- 集成副本（orchestrator 合并后的提交）：`src/runtime/session/**` + `test/l2-runtime-*.test.js`（提交 SHA 由 orchestrator 在派单消息中给出；若无，取 HEAD）。
- lane 作者工作区（只用于 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\runtime`。
- 生产简报：`docs/evofence-harness-kernel/execution/tasks/L2-wave4-runtime-brief.md`（作者的交付约定）。
- 节点合同（真相源）：plan = create/step/pause/resume/cancel/observe/reconcile/close 应用服务；host events 归一化；调用 scheduler/policy；**原子保存 events+outbox**；按 **invocation 而非物理 webhook 次数**去重用量。DoD①（确定性）与 DoD②（重放/崩溃未知/旧 epoch 不重复消费或放行）。cp1 lifecycle+reducer、cp2 outbox ack+reconciliation、cp3 pause/resume/cancel。
- 必读上游契约：`spec/contracts/{INTERFACES.md,SCHEMAS.md,README.md,OWNERSHIP.md}`、`docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`、`spec/graph/SEMANTICS.md`（A1–A6/B1–B3/INV）、`adr_0001`、`adr_0004`；上游实现 `src/storage/**`、`src/kernel/{scheduler,policy,graph}/**`、`src/runtime/host-port/**` 只读参照。

## 1. 必须核验的断言（不采信作者自报）

| 轴 | 验收点 |
|---|---|
| 确定性（DoD①） | 同一 (初始状态, 事件序列) 两次 reducer/step 输出逐字节相同（投影 + effect intentions）；无 `Date`/`Math.random`/环境读取；时间/ID 一律参数注入 |
| 重放（DoD②） | 日志重放不改变投影、不产生新 consumption；同 invocation 的多个 webhook 只记一次 usage；缺失 usage **不归零**（保持 unknown），预算经 policy ledger 预留/结算 |
| 崩溃恢复（DoD②） | events+outbox 经 store 原子提交（crash 窗口内不可能只落一半）；pending 效果派发前查 outbox/lease；崩溃后未知效果保持 unknown 直到真实 reconcile 证据 |
| 旧 epoch（DoD②） | 旧 epoch 回包不改状态、不重复消费（`Object.is` 级恒等 + 计数不变） |
| cancel | 取消未确认保持 `EFK_CANCEL_UNCONFIRMED` + unknown；取消/失败分支不遗漏 |
| 边界纪律 | I05 顶层零副作用；I08 runtime 能力只来自参数端口；只调用**唯一** policy/graph/scheduler 判定入口，不发明第二套；不 import `node:` builtin（若闭包允许）；防御性编程禁令判据（见 SESSION-PROTOCOL） |
| cp 对应 | cp1/cp2/cp3 各有实现入口与可证伪用例；测试计数与作者自报一致 |

## 2. 方法与硬性门禁

1. **sha256 双份**：lane ⇔ 集成副本逐文件比对；集成副本你全程不改（除 dist/ 变异并复原）。
2. **门禁**：`npm run build`；`node --test test/l2-runtime-*.test.js`（连跑两次）；`npm run typecheck`、`npm run src:policy`（文件 ≤350 行）、`npm run dep:check`。
3. **独立负控**：DoD①（如把 reducer 的时间/顺序改为非确定或改动一处投影）与 DoD②（如把 invocation 去重键改回 webhook 次数、或放行旧 epoch 回包）各至少一组；变异 → **精确变红** → 复原 → 复绿；记录变异点与用例名。
4. **自建探针**（独立于作者套件，node 脚本直接 import `dist/`，跑完删除）：至少包括 —— 同事件序列两次运行逐字节比较；replay 后投影恒等；同 invocation 双 webhook 的 usage 计数；旧 epoch 回包恒等；崩溃窗口（store 提交前后）后 reconcile 前不派发 unknown 效果。
5. 任何对 `src/`、`test/` 的变异必须复原，收工 `git status --porcelain` / `git diff` 对这两处为空。

## 3. 输出（dossier 唯一写入）

写入 `docs/evofence-harness-kernel/execution/reviews/l2_runtime-review.md`：

```
# l2_runtime 独立交叉复核（review-1）
日期 / 复核者（pane）：
复核对象（集成提交 SHA + 文件/行数 + 用例数）：
结论：可接受 / 需修订（blocker/major/minor/nit 计数）
逐条：plan/DoD/checkpoint 核对表 + 实测证据（命令、输出摘要、用例名、sha256 结果）
负控表：变异点 → 变红用例名 → 复原
未证明项（如实：真实宿主闭环/耐久持久化/fixture 边界等）：
收工一致性：lane vs 集成 sha256、git 状态
```

## 4. 纪律

- 不写 `.graph`、不 commit、不改 lane、不跑全量 `npm test`（既有 wall-clock 用例在负载下偶发 flake，若命中以「基线同失败 + 单独跑绿」为据）。
- 只读复核 + 本 dossier 一个文件；测试跑本次 build 的 `dist/`（ADR-0004）。
- 结论以实测为准；未证明项如实列出，不缩小标准、不替作者补证。
