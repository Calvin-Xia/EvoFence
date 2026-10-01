# L3 波次 1 简报：l3_context_router（节点上下文与反馈路由）— codex lane `l3-router`

> 图：`evofence-harness-kernel` · 阶段 L3 · 上游 L2 全部 passed。你只写本 lane 产物；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 已建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-router` |
| 分支 | `refactor/hk-l3-router`（基线 = 集成 HEAD） |
| node_modules | 指向集成 worktree 的 symlink —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l3_context_router）

- **plan**：按 TaskContract、节点角色、输入 artifacts、宿主窗口预算构建 context packet；区分**执行者 / fresh verifier / 私有 evaluator** 可见数据；用显式 artifact handoff 替代无限聊天继承；保留允许的人类/宿主 instructions。输出：bounded context packet 与审计来源。
- **DoD①**：单节点 context **可追溯且有 token 上限**；长任务压缩仍保留证据引用（不丢引用）。
- **DoD②**：私有评分器、终审任务与候选验证反馈**不泄露**给学习/执行 agent。
- **checkpoints**：cp1 角色与可见性规则；cp2 packet/摘要/引用构建；cp3 窗口/隐私/过时 context 核验。

## 2. 必读输入（真相源）

- `docs/evofence-harness-kernel/spec/contracts/INTERFACES.md`（协议/服务签名）、`SCHEMAS.md`（`TaskContract`、`ArtifactRef`、visibility/privacy 对象）、`OWNERSHIP.md`（**A13 私有反馈**、I01–I08 core 闭包）、`spec/evaluation/SCENARIOS.md`（长程任务形态）、`spec/graph/SEMANTICS.md`（节点/attempt）
- L2 上游实现（只读参照）：`src/kernel/artifacts/**`（受众/分区判定：`withheldReason`、`partitionFeedback`、`verifyForConsumer`——**复用，不要第二套**）、`src/kernel/store/contracts.ts`（`StoreResult`/`ArtifactRef` 等）、`src/kernel/policy/**`（预算形态）
- `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`（协议唯一入口）、`SESSION-PROTOCOL.md`（防御性编程禁令）

## 3. 落点与所有权

- **独占**：`src/learning/context/**`（新建；learning 层在 core 闭包之外，可 import core，但**不得**把 fs/host/网络逻辑混进 core 的判定路径）；`test/l3-router-*.test.js`（平铺、`dist/**` 导入、≤350 行）。
- **禁止改**：`src/{protocol,kernel,runtime}/**`（若必须改契约，停下报告 drift）。
- 不 commit、不 install、不操作 `.graph`；结束时 lane `git status` 只显示你的文件。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 角色与可见性规则**：显式角色（executor / fresh verifier / private evaluator / learner）与数据分类（public / private-eval / held-out / final）的矩阵；规则**复用** `src/kernel/artifacts/**` 的受众判定或在其上封装（禁止平行第二套真相源）；对越枚举/未声明输入 fail-closed（typed 结果）。
2. **cp2 packet/摘要/引用构建**：`buildContextPacket(taskContract, nodeRole, inputArtifacts, windowBudget)` → 确定性 packet（同输入逐字节相同）+ 审计来源（每个入 packet 的引用/handoff 记录来源与理由）；长任务压缩保留**证据引用**（可追溯到 artifact id + digest + 可见性），而非仅摘要文本；超预算时显式拒绝或裁剪策略（不静默丢证据）。
3. **cp3 窗口/隐私/过时核验**：token 上限实测（超限拒绝/裁剪可证伪）；私有 evaluator/final 数据对 executor/learner 不可见（负控）；过时 context（过期 artifact、旧 revision、held-out 泄露路径）拒绝；与 `l3_workspace_txn`/`l3_task_evaluation` 的接入契约写清（不实现它们的编排）。
4. 纯确定性：时间/随机/环境读取一律注入；packet 构建不触发 host I/O。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build`、`typecheck`、`src:policy`、`dep:check` 全 0；`node --test test/l3-router-*.test.js` 全绿（两次一致）。
- 在 lane 内只读跑 `node verification/kernel/static-audit.mjs`（若 lane 基线含该目录；exit 0、0 violations）证明 core 未被破坏。
- DoD①（token 上限 + 压缩保留引用）与 DoD②（私有泄露）各至少一个真实 negative control（变异/篡改 → 变红 → 复原 → 复绿）。
- 不给私有数据建"影子通道"：不得把 private-eval 内容编码进摘要、hash 名、文件名或日志。

## 6. 完成回报格式

```
lane: l3-router
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据（含 packet 示例与审计来源）
cp3: <passed|failed> — 证据（含负控）
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者：本 lane 独占上述目录；不得改集成 worktree。
- 防御性编程禁令：契约/证据门禁与真实边界校验保留；"不可能状态守卫/吞错/双保险/无依据默认值"删掉。
- 不新增只镜像实现的测试；测试跑本次 build 的 `dist/`。
