# l4_evolution_eval 独立复核简报（review-1）

> 图：`evofence-harness-kernel` · 节点 `l4_evolution_eval` · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。

## 0. 复核对象

- 集成提交：`8c6a37d`（相对基线 `d2e311d`）：`src/evaluation/evolution/**`（含 `evidence/**`）+ `test/l4-evo-eval-*.test.js`（5 文件 / 38 用例）。
- lane 作者工作区（仅 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-evo-eval`。
- 节点合同：plan = `evaluateCandidate/evaluateCapability` 绑定 candidate/base/host/protocol/data split、必要不变项、多指标与独立验证器；先离线/dev、后未见评测；防 evaluator 泄漏、样本重复与低价多次试验选偏；输出 signed-by-authority 或来源可核验的 `EvaluationReceipt`（**不夸大无密钥 hash 的防篡改性**）。DoD① 失败/预算缺失/样本不足/不确定**阻止收益声明或长期晋升**；DoD② 与 task verdict **分开**、唯一生产决策服务被 promotion **真正消费**。cp1 绑定与协议、cp2 重复/种子/多指标、cp3 泄漏/选择偏差/usage。
- 简报：`docs/evofence-harness-kernel/execution/tasks/L4-evolution-eval-brief.md`；管辖 ADR：`adr_0005`、`adr_0008`；预注册：`spec/evaluation/PREREGISTRATION.md`。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | 绑定完整：candidate revision（asset id+digest）、base、host/model/protocol 版本、data split（dev/held-out 预注册划分） | 读源码 + 探针（错绑定拒绝） |
| 2 | **预注册不可变**：评价后不得改口径；停止规则与指标随输入固定 | 探针（评价后改指标/停止规则应 typed 拒绝） |
| 3 | 独立验证器 + 权威核验：issuer/authority 可核，不得自评自签；伪造权威拒绝 | 自建伪造 issuer 负控 |
| 4 | 统计与重复：同种子可重放；去重；bootstrap（10k 配对）确定性；多指标合取护栏 | 探针两次一致 + 重复样本 |
| 5 | DoD①：样本不足/预算缺失/不确定/失败 → **阻止**收益声明或晋升（逐项负控） | 自建四类负控 |
| 6 | DoD②：与 task verdict 分离（不得拿任务完成当演化收益）；receipt 被既有注册器/消费路径实际使用 | 读 wiring + 检索消费点（`src/learning/assets` 或 promotion 口径） |
| 7 | 泄漏/选择偏差/usage：held-out 对候选作者不可见；择优上报/多次试验防护；缺失 usage 不归零 | 自建负控（泄漏、择优、缺失 usage） |
| 8 | 门禁与边界 | build/typecheck/src:policy/dep:check=0；`node --test test/l4-evo-eval-*.test.js` 两次 38/38；`static-audit` exit 0、0 violations；只增不改（`git show --name-status 8c6a37d`） |
| 9 | 证据与负控 | `evidence/results.json`/`mutations.json` 与实况一致；抽查 1-2 个生产模块变异 0→1→0；未证明项（真实未见收益归 `l4_capability_trial`；生产 signer/journal 与 promotion 接线）如实 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l4_evolution_eval-review.md`，格式同前几份复验 dossier。
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异只在 `dist/` 或临时副本，复原用 `git cat-file blob`。
- 只跑本次 build 的 `dist/`；结论以实测为准；证据不得升级（离线/模拟 ≠ 真实未见评测）。
