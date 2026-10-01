# L3 波次 2 简报：l3_workspace_txn（代码与技能产物事务）— codex lane `l3-workspace`

> 图：`evofence-harness-kernel` · 阶段 L3 · 上游 L2 全部 passed。你只写本 lane 产物；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 在派单时建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-workspace` |
| 分支 | `refactor/hk-l3-workspace`（基线 = 派单时集成 HEAD） |
| node_modules | 指向集成 worktree 的 junction/symlink —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l3_workspace_txn）

- **plan**：实现 workspace provider：共享只读 base、隔离或受锁的 write scopes、patch/artifact stage、**唯一 integration writer** 与 **base 绑定应用**。Git 是一种 workspace adapter；策略/经验图任务无需 Git。代码/技能/工具候选先 staged 新资产；不自动修改既有全局 Skills。输出：可撤销 commit/activation receipt。
- **DoD①**：并发 patch 冲突明确返回 **rebase/replan**，不盲合并。
- **DoD②**：application journal/host receipts 与实际文件状态可 reconcile；worktree **不被宣称 OS sandbox**。
- **checkpoints**：cp1 provider 与 base/scope；cp2 integration writer 与冲突；cp3 原子应用/撤销/恢复核验。

## 2. 必读输入（真相源）

- `spec/contracts/INTERFACES.md`（`WorkspacePort` 行：当前授权范围内实际 read/diff/write 与工作区证据；integration/asset writer 串行）、`OWNERSHIP.md`（A12 实际写盘与激活、A14 角色隔离、**I01–I08 core 闭包**）、`SCHEMAS.md`（ArtifactRef/Workspace 相关对象）、`spec/evaluation/SCENARIOS.md`、`adr_0001`、`adr_0004`
- L2 上游（只读参照）：`src/kernel/store/contracts.ts`（StoreResult/ports）、`src/kernel/artifacts/**`（内容身份/binding）、`src/runtime/session/**`（journal/outbox/unknown 语义——**复用，不造第二套**）
- 旧实现参考（只读）：`src/lib/git.ts`、`src/lib/exec/**`（旧 runner/worktree 处理；不得直接把旧语义当新合同）

## 3. 落点与所有权（重要）

- **core 只能装纯端口/判定**：`WorkspacePort` 接口与纯判定可放 core（如 `src/runtime/workspace/**`），但 **core 目录 `src/{protocol,kernel,runtime}/**` 内不得出现 `node:fs`/`child_process`/git/网络**（I02/I03/I05/I08；`node verification/kernel/static-audit.mjs` 必须保持 0 violations）。
- **适配器在 core 之外**：真实 fs/Git 实现放新顶层 `src/workspace/**`（可 import core 类型；也可放 `src/hosts/**` 或 `src/storage/**`，在报告说明）。建议：`src/runtime/workspace/**`（端口+纯规则：base/scope/patch 冲突判定/单 writer 排序）+ `src/workspace/**`（Git/fs adapter + receipt 落盘）。
- **独占**：上述目录 + `test/l3-workspace-*.test.js`（平铺、`dist/**` 导入、≤350 行）。
- **禁止改**：已 passed 的 L2 模块（`src/kernel/**`、`src/runtime/session/**`、`src/runtime/host-port/**`、`src/kernel/artifacts/**` 等）；若必须改契约，停下报告 drift。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 provider 与 base/scope**：`WorkspacePort` 合同实现：共享只读 base（base revision/digest 绑定）、写 scope（隔离或受锁）、read/diff/write/stage 的最小接口；非 Git 任务（策略/经验图资产）走同一抽象；base 不匹配的 patch 拒绝（typed）。
2. **cp2 integration writer 与冲突**：唯一 integration writer 串行提交；并发 patch 冲突（同一文件/同一 base）显式返回 **rebase/replan**（typed，带冲突文件与两侧 base）；不盲合并；候选资产先 staged（不直接改全局 Skills/既有资产）。
3. **cp3 原子应用/撤销/恢复**：应用 = 生成 commit/activation receipt（可撤销）；崩溃/中断后 journal/receipts 与实际文件状态可 reconcile（unknown 不盲重放）；撤销可恢复到前状态；负控：中途崩溃、双 writer、base 漂移、部分写失败。
4. 真实证据：在临时目录建真实 Git 仓库/工作树做端到端证明（并发两个 patcher、制造冲突、崩溃注入）；fixture 与真实 fs 分级标注。**不得宣称 worktree 等于 OS sandbox**（A14/R7）。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build`、`typecheck`、`src:policy`、`dep:check` 全 0；`node --test test/l3-workspace-*.test.js` 全绿（两次一致）。
- `node verification/kernel/static-audit.mjs`（lane 基线含该目录）必须 exit 0、0 violations —— core 未被污染。
- DoD①（冲突→rebase/replan）与 DoD②（reconcile + 非 sandbox 声明）各至少一个真实 negative control（变异→变红→复原→复绿）。

## 6. 完成回报格式

```
lane: l3-workspace
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据（冲突用例名）
cp3: <passed|failed> — 证据（崩溃/撤销/reconcile 用例）
真实 fs/Git 证据: <目录/命令/截图或输出摘要>
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实（如：跨机器并发、OS 隔离、非 Git adapter 覆盖度）>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者：本 lane 独占上述目录；不得改集成 worktree。
- 防御性编程禁令与证据分级见 `SESSION-PROTOCOL.md`；不新增只镜像实现的测试。
