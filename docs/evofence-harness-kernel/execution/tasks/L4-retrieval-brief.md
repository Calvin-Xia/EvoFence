# L4 波次 2 简报：l4_retrieval（适用经验检索与注入）— codex lane `l4-retrieval`

> 图：`evofence-harness-kernel` · 阶段 L4 · 上游 `l4_asset_registry` 通过后开工。你只写本 lane 产物；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 派单时建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-retrieval` |
| 分支 | `refactor/hk-l4-retrieval`（基线 = 派单时集成 HEAD） |
| node_modules | 指向集成 worktree 的 junction —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l4_retrieval）

- **plan**：依据 task/node/host/model/repo metadata 选择**已具资格且未撤销**资产；先实现**确定性筛选与预算排序**，无收益前不引入强制向量库/GraphRAG。记录 `retrieved/used/ignored` 与 token 成本。输出：activation context candidate 与归因记录。
- **DoD①**：不注入 scope 不符、来源不明、失效或未验证经验。
- **DoD②**：无可用经验时退回基础执行；检索开销纳入对照。
- **checkpoints**：cp1 资格筛选与排名；cp2 有限上下文与使用反馈；cp3 过时/空集/污染路径核验。
- 管辖 ADR：`adr_0005`、`adr_0007`。

## 2. 必读输入（真相源）

- `src/learning/assets/**`（**上游**：`qualification`/状态/依赖传播——复用，不重造资格判定）、`src/learning/context/**`（packet 与 token 预算口径——复用）、`src/kernel/artifacts/**`（受众判定）
- `spec/contracts/{INTERFACES.md,SCHEMAS.md,OWNERSHIP.md}`、`spec/evaluation/{SCENARIOS,PROTOCOL,METRICS}.md`（检索开销与对照口径）、`adr_0005`、`adr_0007`
- `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`、`SESSION-PROTOCOL.md`

## 3. 落点与所有权

- **独占**：`src/learning/retrieval/**`（新建）；`test/l4-retrieval-*.test.js`（平铺、`dist/**` 导入、≤350 行）。
- **禁止改**：core（`src/{protocol,kernel,runtime}/**`）与已 passed 的 learning 模块；若需改上游契约，停下报告 drift。
- 不 commit、不 install、不操作 `.graph`；结束 lane `git status` 只显示你的文件。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 资格筛选与排名**：输入（task/node/host/model/repo metadata + 候选资产集）→ 只保留 `asset_registry.qualification` 通过且未撤销/未过期的资产；确定性排名（稳定排序 + 明确 tie-breaker），同输入逐字相同；预算约束（token/数量）下的裁剪策略显式。
2. **cp2 有限上下文与使用反馈**：输出 activation context candidate（与 `l3_context_router` packet 形态对接，不另造第二套）；记录 `retrieved/used/ignored`（含理由）与 token 成本估算法（注入 tokenizer/计数器，不硬编码）；用于对照的 overhead 可复算。
3. **cp3 过时/空集/污染路径**：过时（撤销传播后）资产不得注入；空集 → 明确的基础执行回退（不是错误、不是空注入）；污染路径（scope 不符、来源不明、未验证、held-out 泄露）typed 拒绝；负控覆盖每条。
4. 证据分级：单元 + 负控；不引入向量库/外部服务（合同明确「无收益前不引入」）；确定性优先。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build/typecheck/src:policy/dep:check` 全 0；`node --test test/l4-retrieval-*.test.js` 两次一致全绿。
- `node verification/kernel/static-audit.mjs` exit 0、0 violations。
- DoD①（不注入不合格经验）与 DoD②（空集回退 + 开销记录）各至少一个真实 negative control（变异→变红→复原→复绿）。

## 6. 完成回报格式

```
lane: l4-retrieval
cp1: <passed|failed> — 证据（确定性/排名用例名）
cp2: <passed|failed> — 证据（candidate 示例 + 归因记录）
cp3: <passed|failed> — 证据（负控清单）
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实（真实收益归 l4_capability_trial 等）>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者；防御性编程禁令与证据分级见 `SESSION-PROTOCOL.md`；不新增只镜像实现的测试。
