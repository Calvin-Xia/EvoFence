# l3_task_evaluation 独立复核简报（review-1）

> 图：`evofence-harness-kernel` · 节点 `l3_task_evaluation` · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。

## 0. 复核对象

- 集成提交 `3423ecf`（相对基线 `8bffca8`）：`src/kernel/evaluation/**`（6 文件）+ `src/runtime/session/evaluation.ts`（重接线）+ `test/l3-eval-*.test.js`（5 文件 / 28 用例）。
- lane 作者工作区（仅 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-eval`（branch `refactor/hk-l3-eval`，基线与产物未提交）。
- 节点合同：plan = `evaluateTask` 消费 typed tests/outcome/artifact/host observations，按 task contract 与必须分支裁决 `completed/repair/failed/needs-human/unknown`；普通任务无需胜过 baseline；**判定唯一生产 wiring**。DoD① 必须 fan-in 的分支全部绑定证据、空 summary/自称完成不可放行；DoD② 失败反馈可执行且遵守私有 evaluator 可见性、判定唯一生产 wiring。cp1 providers、cp2 多指标/必要分支裁决、cp3 反馈与 runtime wiring。
- 简报：`docs/evofence-harness-kernel/execution/tasks/L3-task-evaluation-brief.md`。管辖 ADR：`adr_0005`、`adr_0008`；冻结依据：`INTERFACES.md` §3 EvaluatorPort、`OWNERSHIP.md` A05/A11/A13、`SEMANTICS.md` decide。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | cp1：providers 注册/选择显式；typed 证据与 contract/attempt/epoch/base 绑定；缺证据 → `unknown`（不默认成功） | 读源码 + 探针构造缺证据输入 |
| 2 | cp2：多指标合取；五类 `DecisionRecord`；**必须分支**逐个绑定证据，failed/cancelled/missing 不被过滤成成功 | 复刻作者用例 + 自建「缺一支」探针 |
| 3 | DoD①负控：空 summary/自称完成、缺必需分支 → 拒绝/`unknown`（不是 completed） | 自建负控（变异/构造） |
| 4 | cp3：失败反馈可执行且**不泄露私有 evaluator 内容**；repair 生成**新 attempt**而非覆盖 | 读 feedback/branches + 探针 |
| 5 | **唯一生产 wiring**：runtime 的真实评估路径经 `src/kernel/evaluation/**` 与 `graph.decide` 单一入口；无第二判定/影子分支 | 读 `src/runtime/session/evaluation.ts` 全 diff（相对 `1dcf506` 之前的版本）；重跑 `static-audit`（single-decision 必须 0 违规） |
| 6 | **L2 不回归**：`evaluation.ts` 重接线后 L2 runtime 不变量保持（issuer/contract/receipt 绑定校验、CAS 同事务提交、repair 路径、可见性传播） | `node --test test/l2-runtime-*.test.js`（应 32/32）；对照 L2 复验 dossier 的关键断言 |
| 7 | 门禁 | build/typecheck/src:policy/dep:check=0；`node --test test/l3-eval-*.test.js` 两次 28/28；`static-audit` exit 0、0 violations |
| 8 | 证据诚实 | 未证明项（native-fixture、真实 Pi/DSH、多分支端到端、能力收益）如实；变异负控 0→1→0 可复现（至少抽查 1 个） |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l3_task_evaluation-review.md`，格式同前几份复验 dossier：
```
# l3_task_evaluation 独立交叉复核（review-1）
日期 / 复核者（pane）：
复核对象（commit + 文件/行数 + 用例数）：
结论：可接受 / 需修订（blocker/major/minor/nit 计数）
逐条：上表 1-8 判定 + 实测证据（命令、输出摘要、用例名、sha256）
未证明项与保留意见：
收工一致性：git 状态（仅 dossier）、测试与审计数字
```
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异/负控只在 `dist/` 或临时副本，复原用 `git cat-file blob`（CRLF 陷阱）。
- 只跑本次 build 的 `dist/`；测试两次；结论以实测为准。
