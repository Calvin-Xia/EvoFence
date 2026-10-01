# L4 波次 1 简报：l4_asset_registry（能力资产版本与资格）— codex lane `l4-assets`

> 图：`evofence-harness-kernel` · 阶段 L4（本节点依赖已满足，可提前于 L3 尾部并行）· 你是本 lane 唯一写入者；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 派单时建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-assets` |
| 分支 | `refactor/hk-l4-assets`（基线 = 派单时集成 HEAD） |
| node_modules | 指向集成 worktree 的 junction/symlink —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l4_asset_registry）

- **plan**：实现 graph-template/strategy/experience/skill/tool/code-patch 的**不可变 asset revision**、适用范围、来源、依赖与 `staged/validated/promoted/active/revoked` 状态。**既有用户 Skills 是只读来源**，新候选在项目授权区域。输出：registry 与资格查询。
- **DoD①**：资产版本、来源、宿主/模型/仓库兼容条件可验证。
- **DoD②**：`validated ≠ activated`；过期/撤销**依赖传播**，**不抹除历史**。
- **checkpoints**：cp1 asset identity 与状态；cp2 scope/dependency compatibility；cp3 失效与权限边界核验。
- 管辖 ADR：`adr_0005`（完成/评价/晋升/激活分离）、`adr_0007`（资产来源与范围）。

## 2. 必读输入（真相源）

- `spec/contracts/{INTERFACES.md（AssetRegistry 行）、SCHEMAS.md（CapabilityAsset/EvaluationReceipt/ArtifactRef 等）、OWNERSHIP.md（A05/A11/A13、I01–I08）、ERRORS.md}`、`spec/evaluation/{SCENARIOS.md,PROTOCOL.md}`、`adr_0005`、`adr_0007`
- L2/L3 上游（只读，**复用不重造**）：`src/kernel/artifacts/**`（内容身份/受众判定）、`src/kernel/store/**`（`StoreResult`、DigestPort 注入形态）、`src/kernel/evaluation/**`（评价与 DecisionRecord 的接线口径）、`src/learning/context/**`（学习层风格参照）
- `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`、`SESSION-PROTOCOL.md`（防御性编程禁令）

## 3. 落点与所有权

- **独占**：`src/learning/assets/**`（新建；learning 层在 core 闭包之外）；`test/l4-assets-*.test.js`（平铺、`dist/**` 导入、≤350 行）。
- **禁止改**：`src/{protocol,kernel,runtime}/**`（core 冻结）与已 passed 的 L2/L3 模块；若必须新增 core 端口/契约，停下报告 drift 或提出最小纯接口方案（不改动既有文件语义）。
- 不 commit、不 install、不操作 `.graph`；结束时 lane `git status` 只显示你的文件。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 identity 与状态**：不可变 revision（assetId + revision + digest + kind + provenance/source + createdAt 注入）；状态机 `staged→validated→promoted→active→revoked`（含合法转换与非法转换 typed 拒绝）；**append-only 历史**（revoked/替换不删除旧 revision）。
2. **cp2 scope/dependency compatibility**：适用范围（host/model/repo/task 条件）与依赖（资产间依赖、撤销依赖）；`qualification(asset, context)` 查询（在给定 host/model/repo 下是否可用）**确定性**（同输入逐字相同）；`validated` 不等于 `activated`（未显式晋升不得 active）。
3. **cp3 失效与权限边界**：过期/撤销沿依赖图**传播**（受影响的 dependents 变为 invalid/unknown，历史保留）；**既有用户 Skills 只读**（候选写入项目授权区域，越界拒绝）；空/缺证据不默认合格；负控：validated 自动激活、撤销不传播、越界写、历史被抹除。
4. 证据分级：单元 + 负控；若引用真实 Skills 目录，只读采样并在报告标注；不夸大（能力收益归 `l4_capability_trial`）。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build`、`typecheck`、`src:policy`、`dep:check` 全 0；`node --test test/l4-assets-*.test.js` 全绿（两次一致）。
- `node verification/kernel/static-audit.mjs`（lane 基线含该目录）exit 0、0 violations（core 未被污染）。
- DoD①（兼容条件可验证）与 DoD②（validated≠activated、撤销传播不抹历史）各至少一个真实 negative control（变异→变红→复原→复绿，记录变异点与用例名）。

## 6. 完成回报格式

```
lane: l4-assets
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据（qualification 查询示例）
cp3: <passed|failed> — 证据（传播/只读边界负控）
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者；不得改集成 worktree 与 core；防御性编程禁令与证据分级见 `SESSION-PROTOCOL.md`。
- 不新增只镜像实现的测试；测试跑本次 build 的 `dist/`。
