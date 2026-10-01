# L3 波次 2 简报：l3_task_evaluation（任务完成的唯一裁决入口）— codex lane `l3-eval`

> 图：`evofence-harness-kernel` · 阶段 L3 · 上游 L2 全部 passed。你只写本 lane 产物；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 在派单时建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-eval` |
| 分支 | `refactor/hk-l3-eval`（基线 = 派单时集成 HEAD） |
| node_modules | 指向集成 worktree 的 junction/symlink —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l3_task_evaluation）

- **plan**：实现 `evaluateTask`：消费 typed tests/outcome/artifact/host observations，按 task contract 与**必须分支**裁决 `completed/repair/failed/needs-human/unknown`；普通任务不需要胜过 baseline。把所有真实 runtime 接到此服务；输出 `DecisionRecord` 与允许反馈。
- **DoD①**：必须 fan-in 的分支全部绑定证据；空 summary/自称完成不可放行。
- **DoD②**：失败后的反馈可执行且遵守私有 evaluator 可见性；**判定唯一生产 wiring**。
- **checkpoints**：cp1 task evaluator providers；cp2 多指标/必要分支裁决；cp3 反馈与 runtime wiring 核验。

## 2. 必读输入（真相源）

- `spec/contracts/INTERFACES.md` §3（`EvaluatorPort`：`evaluateTask(TaskContract, TaskEvidenceReport) → DecisionRecord`；「用作者自述替代运行证据，向作者泄露私有/终审」是禁止项）、`SCHEMAS.md`（`TaskEvidenceReport`/`BranchEvidence`/`DecisionRecord`/`EvaluationReceipt`）、`OWNERSHIP.md`（**A05 单裁决**、A11 汇合不丢证据、A13 私有反馈、A08、I01–I08）、`spec/graph/SEMANTICS.md`（decide A1–A6/B1–B3/INV）、`spec/evaluation/{SCENARIOS,PROTOCOL,METRICS}.md`、`adr_0005`、`adr_0008`
- L2 上游（只读参照）：`src/runtime/session/evaluation.ts`（当前薄入口：注册 `EvaluatorPort.evaluateTask` → `graph.decide`，同事务提交）、`src/kernel/graph/decide.ts`（唯一 decision 入口）、`src/kernel/artifacts/**`（证据 binding/受众判定——复用）、`src/runtime/session/**`（journal/outbox/receipt）
- `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`、`SESSION-PROTOCOL.md`

## 3. 落点与所有权

- **建议 core（纯判定）**：`src/kernel/evaluation/**`（新建，kernel→protocol/kernel 内；无 fs/host/网络/时钟读取；时间/digest 注入）。如需与 runtime 的 journal 事务耦合，只经既有 runtime 入口接线，不复制其逻辑。
- **独占**：`src/kernel/evaluation/**` + `test/l3-eval-*.test.js`（平铺、`dist/**` 导入、≤350 行）。
- **禁止改**：`src/runtime/session/evaluation.ts` 之外的已 passed L2 模块（如必须小改接线，单列 diff 说明并保持行为）；任何冻结契约改动 → 停下报告 drift。
- **唯一入口**：`static-audit.mjs` 的 `single-decision` 规则必须保持 0 violations；不得新增平行判定（不得直接调用 `stateFromDecision/matchingOutgoing/evaluatePredicate/checkEnvelope/grantLease/claimNode`）。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 providers**：`evaluateTask` 消费 typed `TaskEvidenceReport`（tests/outcome/artifacts/host observations）与绑定（binding、attempt、epoch、base）；provider 注册/选择显式；缺证据 → `unknown`（不默认成功）。
2. **cp2 裁决**：按 task contract 的**必须分支**集合逐个绑定证据（缺失 → 显式 gapReason，绝不把 failed/cancelled/missing 过滤成成功）；多指标（tests 通过率、outcome、artifact 完整性）组合规则明确；输出 `DecisionRecord`（issuer 必须是注册服务；`completed/repair/failed/needs-human/unknown`）；空 summary/自称完成拒绝（可证伪用例）。
3. **cp3 反馈与 wiring**：失败反馈可执行（指向具体 gap/repair 建议）且遵守私有可见性（私有评分器/终审不泄露给执行者，复用 artifacts 受众规则）；`repair` 生成新 attempt 而非覆盖；runtime 的真实路径绑定到此服务（把 L2 的薄入口升级为完整实现，保持 `graph.decide` 唯一入口与同事务提交）。
4. 证据分级：单元 + 负控；如与真实 runtime 集成需轨迹证据；不夸大（普通任务不需要胜过 baseline，不得虚构 benefit 判定）。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build`、`typecheck`、`src:policy`、`dep:check` 全 0；`node --test test/l3-eval-*.test.js` 全绿（两次一致）。
- `node verification/kernel/static-audit.mjs`（lane 基线含该目录）exit 0、0 violations（含 single-decision）。
- DoD①（分支证据缺失不可放行）与 DoD②（私有泄露/唯一 wiring）各至少一个真实 negative control（变异→变红→复原→复绿）。

## 6. 完成回报格式

```
lane: l3-eval
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据（裁决用例名）
cp3: <passed|failed> — 证据（wiring + 隐私负控）
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实（如：真实宿主 evidence 归 L3 scenario；多指标权重未定等）>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者：本 lane 独占上述目录；不得改集成 worktree。
- 防御性编程禁令：契约/证据门禁保留；不可能状态守卫/吞错/双保险/无依据默认值删掉。
- 不新增只镜像实现的测试；测试跑本次 build 的 `dist/`。
