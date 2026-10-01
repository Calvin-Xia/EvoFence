# L4 波次 2 简报：l4_evolution_eval（候选与长期能力独立评价）— codex lane `l4-evo-eval`

> 图：`evofence-harness-kernel` · 阶段 L4 · 上游 `l4_asset_registry` 通过后开工。你只写本 lane 产物；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 派单时建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-evo-eval` |
| 分支 | `refactor/hk-l4-evo-eval`（基线 = 派单时集成 HEAD） |
| node_modules | 指向集成 worktree 的 junction —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l4_evolution_eval）

- **plan**：实现 `evaluateCandidate/evaluateCapability`：绑定 candidate/base/host/protocol/data split、必要不变项、多指标与**独立验证器**。先离线/dev、后未见评测；防止 evaluator 泄漏、样本重复和低价多次试验选偏。输出 signed-by-authority 或来源可核验的 `EvaluationReceipt`；**不夸大无密钥 hash 的防篡改性**。
- **DoD①**：失败、预算缺失、样本不足与不确定结果**阻止收益声明或长期晋升**。
- **DoD②**：与 task verdict **分开**；唯一生产决策服务被 promotion **真正消费**。
- **checkpoints**：cp1 绑定 evaluator 与数据协议；cp2 重复/种子/多指标评估；cp3 泄漏/选择偏差/usage 核验。
- 管辖 ADR：`adr_0005`、`adr_0008`；预注册协议：`spec/evaluation/PREREGISTRATION.md`。

## 2. 必读输入（真相源）

- `spec/evaluation/{PROTOCOL.md,PREREGISTRATION.md,METRICS.md,SCENARIOS.md}`、`spec/contracts/{INTERFACES.md（EvaluatorPort/evaluateCapability）,SCHEMAS.md（EvaluationReceipt）,OWNERSHIP.md（A05/A11、I01–I08）,ERRORS.md}`、`adr_0005`、`adr_0008`
- 上游（只读，复用不重造）：`src/kernel/evaluation/**`（task verdict——**不要把它与 evolution 评价混成一个服务**）、`src/learning/assets/**`（候选/资格）、`src/kernel/artifacts/**`（证据 binding/受众）、`src/kernel/policy/**`（预算）
- `L2-PROTOCOL-NOTES.md`、`SESSION-PROTOCOL.md`

## 3. 落点与所有权

- **独占**：`src/evaluation/evolution/**`（新建；evaluation 层在 core 闭包之外）；`test/l4-evo-eval-*.test.js`（平铺、`dist/**` 导入、≤350 行）。
- **禁止改**：core 与已 passed 模块；若必须改契约，停下报告 drift。
- 不 commit、不 install、不操作 `.graph`。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 绑定与协议**：`evaluateCandidate`/`evaluateCapability` 显式绑定 candidate revision（asset id+digest）、base、host/model/protocol 版本、data split（dev/held-out**预注册**划分）；必要不变项清单；预注册的指标与停止规则进入评价输入（评价后不得改口径）；输出 `EvaluationReceipt`（issuer/authority、绑定、判决、usage）。
2. **cp2 重复/种子/多指标**：样本重复与种子控制（同种子可重放，不同种子集合记录）；多指标（任务质量、成本、稳定性）合取规则；**不确定 → 不能声称收益**（insufficient samples/budget missing/uncertain 直接阻止）。
3. **cp3 泄漏/选择偏差/usage**：`held-out`/`final` 数据对候选作者不可见（复用 artifacts 受众判定）；低价多次试验选偏防护（试验次数与选择规则预注册、全记录不择优）；usage 缺失不归零；负控：最优择优上报、held-out 泄漏、缺预算/样本仍通过、伪造 issuer。
4. 与 task verdict 分离：本节点的服务只产出 evolution 评价；**promotion 消费它**（接口留给 l4_promotion；不要自行实现晋升）。
5. 证据分级：先离线/dev（fixture 与真实离线数据），「未见评测」如实标注；不夸大防篡改性（无密钥 hash 是完整性提示，非签名）。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build/typecheck/src:policy/dep:check` 全 0；`node --test test/l4-evo-eval-*.test.js` 两次一致全绿。
- `node verification/kernel/static-audit.mjs` exit 0、0 violations。
- DoD①（缺预算/样本/不确定阻止声明）与 DoD②（与 task verdict 分离 + promotion 消费接口）各至少一个真实 negative control（变异→变红→复原→复绿）。

## 6. 完成回报格式

```
lane: l4-evo-eval
cp1: <passed|failed> — 证据（绑定/预注册用例名）
cp2: <passed|failed> — 证据（种子/重复/多指标）
cp3: <passed|failed> — 证据（泄漏/偏差/usage 负控）
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实（真实未见评测/收益归 l4_capability_trial）>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者；证据不得升级（fixture/离线 ≠ 真实未见评测）；不新增只镜像实现的测试；防御性编程禁令见 `SESSION-PROTOCOL.md`。
