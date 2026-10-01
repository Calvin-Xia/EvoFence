# L5 波次 1 简报：l5_legacy_boundary（旧格式只读边界与 breaking 指南）— codex lane `l5-legacy`

> 图：`evofence-harness-kernel` · 阶段 L5 · 上游 `l4_asset_registry` 通过后开工（与本 L4 链并行）；你只写本 lane 产物；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 派单时建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l5-legacy` |
| 分支 | `refactor/hk-l5-legacy`（基线 = 派单时集成 HEAD） |
| node_modules | 指向集成 worktree 的 junction —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l5_legacy_boundary）

- **plan**：为旧 CLI/config/ledger 设计明确升级说明与**只读** exporter/importer；新版 runtime/asset state 使用**新 namespace/schema**，**不原地 migrate、不重算旧 chain**。旧日志只作历史来源，**不直接晋升 asset**。用户选择旧版继续或显式导入。输出：格式边界、可恢复导入与 breaking 文档。
- **DoD①**：原文件摘要保持不变；未知旧版格式明确拒绝。
- **DoD②**：breaking 变化有对照清单；旧历史**不被写成新版执行证据**。
- **checkpoints**：cp1 冻结旧格式与只读导出；cp2 新 namespace 导入与来源标记；cp3 原件保持和指南核验。
- 管辖 ADR：`adr_0004`、`adr_0010`。

## 2. 必读输入（真相源）

- `docs/refactor-inventory.md` 等历史记录（0.3.0/0.4.0 基线，只读参考；**不作为当前行为真相**）、`CHANGELOG.md`、`src/lib/ledger/schema.ts`（**旧 ledger schema v2 的现状**）、`docs/config.md`（旧 config）
- `spec/contracts/{INTERFACES.md,SCHEMAS.md,OWNERSHIP.md}`、`adr_0004`、`adr_0010`、`src/kernel/store/**`（新 namespace/schema 口径）
- **隔离裁定**（CONTEXT/ADR-0010 与用户目标）：旧 ledger/config/历史图保持原样；新数据独立版本/命名空间；不得对旧 chain 重算或原地迁移。

## 3. 落点与所有权

- **独占**：`src/storage/legacy/**`（新建；storage 层在 core 闭包之外）；`test/l5-legacy-*.test.js`（平铺、`dist/**` 导入、≤350 行）；breaking 文档写入该目录 README 或 `docs/evofence-harness-kernel/execution/`（由 orchestrator 决定归档位置时按简报回报）。
- **禁止改**：core、旧 `src/lib/**` 的既有语义、主 checkout 的 `.evofence`/ledger 实际状态（测试只用临时副本）。
- 不 commit、不 install、不操作 `.graph`；**不得对真实旧 ledger 文件做任何写操作**（只读复制到临时目录再处理）。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 冻结旧格式与只读导出**：定义 0.x CLI/config/ledger 的**只读**格式边界（版本探测、未知版本明确拒绝 `EFK_*` typed 错误）；只读 exporter 输出稳定中性格式（不改原文件、不重算 hash 链）；对损坏/未知格式不猜测。
2. **cp2 新 namespace 导入与来源标记**：显式导入到**新命名空间**（新 schema/版本），每条导入记录来源（原文件 digest、时间、导入器版本）并标记为**历史来源**；导入是新增，不覆盖/不合并旧 chain；同一输入重复导入幂等（或 typed 冲突）。
3. **cp3 原件保持与指南**：原件 digest 前后不变（负控：任何写操作都会破坏）；旧历史**不得**被写成新版执行证据（不进入 asset registry 的晋升路径、不冒充新 journal 事件）；breaking 对照清单（旧字段/命令 → 新对应/移除/拒绝）+ 升级指南（继续用旧版 vs 显式导入的取舍）。
4. 负控：未知版本被接受、导入写回原件、旧 ledger 被当新版证据、breaking 清单缺项。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build/typecheck/src:policy/dep:check` 全 0；`node --test test/l5-legacy-*.test.js` 两次一致全绿。
- `node verification/kernel/static-audit.mjs` exit 0、0 violations（core 未被污染）。
- DoD①（原件摘要不变 + 未知格式拒绝）与 DoD②（breaking 对照 + 旧历史不作新版证据）各至少一个真实 negative control（变异→变红→复原→复绿）。

## 6. 完成回报格式

```
lane: l5-legacy
cp1: <passed|failed> — 证据（格式探测/拒绝用例名）
cp2: <passed|failed> — 证据（导入幂等/来源标记）
cp3: <passed|failed> — 证据（原件 digest 前后一致 + breaking 清单路径）
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实（如：旧 GUI/外部导入器的完整覆盖面）>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者；**绝不触碰真实旧 ledger/config 状态**（只读临时副本）；防御性编程禁令与证据分级见 `SESSION-PROTOCOL.md`；不新增只镜像实现的测试。
