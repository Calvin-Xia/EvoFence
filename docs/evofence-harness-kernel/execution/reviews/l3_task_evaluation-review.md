# l3_task_evaluation 独立交叉复核（review-1）

日期 / 复核者（pane）：
- 日期：2026-10-02
- 复核者：独立 review pane（**新 tab、新 pane，未参与本节点任何写作**；全程只读，唯一写入是本 dossier）

复核对象（commit + 文件/行数 + 用例数）：
- 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，commit **`3423ecf682383cac3d20cf0cc97c4ab9de34c9f6`**（父 `bc1d095`），相对基线 `8bffca8`。
- `src/kernel/evaluation/**`：6 文件 / **443** 行（`branches 75`、`feedback 36`、`index 5`、`providers 109`、`service 139`、`types 79`）。
- `src/runtime/session/evaluation.ts`：**154** 行（唯一被本 commit 改动的 runtime 文件，L2 薄入口升级 + `createRuntimeTaskEvaluator`）。
- `test/l3-eval-*.test.js`：5 文件；`node --test` 报 **28**（= 27 条命名用例 + `l3-eval-fixtures.test.js` 1 个 fixture 文件实体）。
- lane 作者工作区（仅 sha256 比对，未写）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-eval`，branch `refactor/hk-l3-eval`，HEAD `8bffca8`，产物未提交。
- 管辖 ADR：`adr_0005`、`adr_0008`；冻结依据：`INTERFACES.md` §3 `EvaluatorPort`、`OWNERSHIP.md` A05/A11/A13、`SEMANTICS.md` decide。

## 结论：**可接受**（blocker 0 / major 0 / minor 2 / nit 2）

8 条必须核验的断言全部由我独立取证通过：必须分支逐个绑定证据、失败/取消/缺失不被过滤成成功；空 summary/自称完成拒绝；私有反馈不泄露且 repair 新开 attempt；判定唯一生产 wiring（`static-audit` single-decision 0、全 diff 通读）；L2 runtime 32/32 且全量 909/909 无回归；门禁全 0、L3 28/28 两次；变异负控 0→1→0 复现。两个 minor 都是**不与 DoD 冲突的覆盖面观察**（生产适配器 receipt→runStatus 映射使 `needs-human` 在唯一 wiring 上不可达；`privacyChecked: true` 为适配器自述），两个 nit 是导出面与非空断言。均不影响本节点验收。

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 2 | **m1** 生产适配器 `createRuntimeTaskEvaluator` 的 `runStatus` 只映射 `Receipt.status ∈ {completed,failed,cancelled,unknown,not-executed}`，故 `needs-human` 经这条唯一 wiring **不可达**（内核 + 单测覆盖它；见 §4）；**m2** 适配器把 `privacyChecked: true` 硬编码、`usageComplete` 本地推导，`privacy-not-checked` gap 在生产永不触发（隐私由内核 privateTests 校验 + A13 可见性传播独立兜底，非承重） |
| nit | 2 | **n1** `createRuntimeTaskEvaluator` 未从 `src/runtime/session/index.ts` 桶导出（embedder 需深导入 `evaluation.js`；与 host/policy 端口无 src 内 composition root 的现状一致）；**n2** 适配器 `[...state.events].reverse().find(...)!` 非空断言，若无匹配 `receipt.applied` 会抛异常而非返回 typed 错误（`evaluateSession` 已保证存在，风险低） |

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份比对**：把 12 个产物文件（6 kernel + `evaluation.ts` + 5 测试）逐文件在 lane ⇔ 集成副本比对，**12/12 全等**（收工复测仍 12/12，见 §5）。
2. **门禁实测**（集成副本；ADR-0004：测试只吃本次 build 的 `dist/`）：
   - `npm run build` → exit 0
   - `npm run typecheck` → exit 0
   - `npm run src:policy` → exit 0：`208 TypeScript file(s), largest 350 line(s) (src/lib/pi-tool-strategy.ts), limit 350; 0 JavaScript file(s)`
   - `npm run dep:check` → exit 0：`modules 208 / edges 774 / cycles 0 / acyclic: true`
   - `node --test test/l3-eval-*.test.js` 连跑两次 → 各 `tests 28 / pass 28 / fail 0`
   - `node --test test/l2-runtime-*.test.js` → `tests 32 / pass 32 / fail 0`
   - `node verification/kernel/static-audit.mjs` → exit 0，`status passed`，`violations 0`，`secondDecisionCalls 0`
   - 附加：`node --test`（全量默认发现）→ `tests 909 / pass 909 / fail 0`（含 L2/L3 两个套件，证实无旁路回归）
3. **独立探针 12 组**（自建脚本放系统临时目录，只 import 集成副本 `dist/**` 与作者 fixture 助手，跑完删除；见 §3）。
4. **变异负控 1 组**（仅改 `dist/`，跑红→rebuild 复原→复绿；见 §2）。
5. **源码全量通读**：`src/kernel/evaluation/**` 6 文件 + `src/runtime/session/evaluation.ts` 全 diff（相对 `1dcf506` 前的薄入口版本），逐处核对失败默认值、过滤、隐私与单一入口。
6. 防御性编程判据以 `grep`（`??`/`catch`/`as`/`try`/非空断言）+ 通读逐处核对，不依赖测试。

---

## 1. 必须核验的断言逐条判定

| # | 断言 | 判定 | 实测证据 |
|---|---|---|---|
| 1 | cp1：providers 注册/选择显式；typed 证据与 contract/attempt/epoch/base 绑定；缺证据 → `unknown`（不默认成功） | ✅ | 源码：`service.ts:14-19` 显式校验 issuer.kind/`evaluatorId`/`evaluatorVersion`、`selected` 未注册/重复、`providers` id 重复、`privateTests` 必须 tests 指标；`providers.ts` 证据选择按 `schema+producer` 双 canonical 精确匹配，未命中返回 `unknown`。探针 **P1/P1b**（拨掉 tests / outcome 证据 → `unknown` + `tests-evidence-missing`/`outcome-evidence-missing`）、**P6**（未注册 selection/版本不符 → `EFK_DECISION_AUTHORITY_DENIED`）。作者用例 `cp1 provider registration, version and selection are explicit`、`cp1 measurement bytes and full attempt binding must match the consumer`（epoch/attempt/base/hostSessionId 四种 stale 均 `EFK_ARTIFACT_BINDING_MISMATCH`）、`cp1 pinned contract digest rejects substituted task goals` |
| 2 | cp2：多指标合取；五类 `DecisionRecord`；**必须分支**逐个绑定证据，failed/cancelled/missing 不被过滤成成功 | ✅（m1 保留） | 源码：`branches.ts` 每个 `requiredBranches` 生成一条（缺失→`branch-missing`，重复→`branch-duplicate`，绑定缺失/陈旧→`branch-binding-missing`/`-stale`，`state!=='succeeded'`→`branch-state-<state>`，无工件/判定/字节/run 收据→显式 gap）；`failed`/`cancelled` gap `status:'failed'`；`service.ts` 失败默认 `failed`（`repairAllowed` 才 `repair`），`unknown` 支配 `repair`（不猜测未测项通过）。探针 **P2**（failed 状态 + 合法 *completed* 分支判定 → 仍非 completed）、**P2b**（两条必需分支缺一条 → `unknown` 且两条都保留）、**P2c**（cancelled 保留）。作者用例 `cp2 failed and cancelled branches are retained and use explicit repair policy`、`cp2 missing required branch stays explicit and never grants completion`、`cp2 duplicate, unexpected and stale branches cannot wash fan-in gaps into success`、`cp2 succeeded state cannot substitute for a registered branch decision`、`cp2 production statuses distinguish human wait, unknown telemetry and confirmed failure`（五类 outcome 的 runStatus 映射）。**变异负控见 §2** 精确打红该分支状态断言 |
| 3 | DoD①负控：空 summary/自称完成、缺必需分支 → 拒绝/`unknown`（不是 completed） | ✅ | 内核完全忽略 `AgentSummary`（无 provider 消费它），并重算 `normalized.privateTestsPassed/requiredOutcomesMet`。探针 **P3**（空串与「一切通过、我完成了」都 → `unknown`，且两字段回 `null`）、**P3b**（自称完成不能冲销实测 failed）。作者用例 `cp1 empty summary and self-declared completion cannot satisfy real measurements`、`cp3 runtime self-claimed completion remains unknown with explicit missing measurements` |
| 4 | cp3：失败反馈可执行且**不泄露私有 evaluator 内容**；repair 生成**新 attempt**而非覆盖 | ✅ | `feedback.ts` 是独立受众视图：gap 的 refs 经 `partitionFeedback`，任一不可读即整条折叠为 `restricted-acceptance-unmet` + `refs: []` + 公开修复指引，不携带 id/locator/digest/schema 名/provider 身份；`service.ts` 对 privateTests provider 强制 `withheldReason(ref,'author')!=='none'`，否则 `EFK_PRIVACY_VIOLATION`，并把整份 report/decision/event 可见性抬到 `private`。探针 **P4**（author 视图不含 `tests id/digest/location/TestsObservation/eval-1/tests-failed`，evaluator 视图仍见具体 gap）、**P4b**（task evidence 对 author 读 → `EFK_PRIVACY_VIOLATION`，evaluator 可读）、**P4c**（把私有 tests 错标 internal/dev → `EFK_PRIVACY_VIOLATION`）。repair：`evaluateSession` 的 `new-attempt` 分支追加 `bindingFor(...attempt+1)` 的新 `node.transition`，原 attempt 保留；作者用例 `cp3 runtime repair appends a new attempt and retains original failed decision/evidence`（nA attempt1=`failed` 保留、nB attempt2=`pending`、`decision.recorded` 仅 1 条）、`cp3 runtime private report, decision and events never grant author read access`（event/decision/evidence 三方 `private`，author 读失败、evaluator 读成功） |
| 5 | **唯一生产 wiring**：runtime 真实评估路径经 `src/kernel/evaluation/**` 与 `graph.decide` 单一入口；无第二判定/影子分支 | ✅ | 全 diff 通读：`evaluateSession` 仍为唯一入口——`ports.evaluator.evaluateTask(seed,state,receipt)` → 外部边界校验（kind/issuer/contractRef/receipt inputs）→ `verifyForConsumer` 取回 TaskEvidenceReport 并复核 binding/contractRef → **单次** `decide(seed.graph,{kind:'outcome',...})` → 单批 `commit`（CAS + 同事务 decision+transition）。`createRuntimeTaskEvaluator` 适配器把 journal 派生证据组装为 typed report 后调用内核 `createTaskEvaluator(...).evaluateReport`；`src/kernel/evaluation/**` 只 import `protocol/artifacts/store`，**零 graph 依赖**、零 fs/host/时钟。`static-audit`：exit 0、`violations 0`、`secondDecisionCalls 0`、`evaluation.ts→decide` 仅 1 个入口（line 115）。作者用例 `cp3 static audit retains the sole graph decision wiring and zero violations` 亦断言同上 |
| 6 | **L2 不回归**：`evaluation.ts` 重接线后 L2 runtime 不变量保持（issuer/contract/receipt 绑定校验、CAS 同事务提交、repair 路径、可见性传播） | ✅ | `node --test test/l2-runtime-*.test.js` = **32/32**。对照 L2 复验 dossier 关键断言逐条复跑通过：伪造 issuer → `EFK_DECISION_AUTHORITY_DENIED`（`cp1 forged evaluator issuer cannot grant task success`）、repair 保留失败 attempt 并新开 attempt（`cp1 repair preserves failed attempt and creates a distinct attempt`）、CAS 同批（`cp2 CAS competition commits one journal/outbox batch`）、生命周期 `verifying` 才可评估（`cp1 host completion stops at verifying until registered evaluator decides`）。diff 核对：`putObject` 被替换为等价的显式对象构造（同 producer/location/schema digest/partition），**新增** `visibility` 计算与事件 `visibility` 透传；其余外层校验逐字未动。附加全量 `node --test` **909/909**，无旁路回归 |
| 7 | 门禁 | ✅ | build / typecheck / src:policy / dep:check 全 exit 0（数字见 §0.2）；`node --test test/l3-eval-*.test.js` **两次各 28/28**；`static-audit` exit 0、0 violations、single-decision 0 |
| 8 | 证据诚实 | ✅ | commit 自报四项数字（28 cases、L2 32/32、四门禁 0、audit 0 violations + single-decision 0）**逐项实测吻合**；12 个产物 sha256 与 lane 作者工作区全等；测试 fixture 的 `evidenceKind` 如实标 `native-fixture`（runtime 用例 diagnostic 可见），未宣称真实 Pi/DSH 宿主闭环、未宣称能力收益/baseline 优势；变异负控抽样复现见 §2。未证明项如实列于 §4 |

---

## 2. 变异负控（0 → 1 → 0，仅改 `dist/`，rebuild 复原）

| 组 | 变异点（编译产物） | 变红用例（实测） | 复原 |
|---|---|---|---|
| **NC1** DoD① / 断言 2「failed/cancelled 不得过滤成成功」 | `dist/kernel/evaluation/branches.js`：`else if (branch.state !== 'succeeded') {` → `else if (false) {`（禁用分支状态门） | **1 fail / 27 pass**，精确命中：`cp2 failed and cancelled branches are retained and use explicit repair policy` | `npm run build` 复原，`grep 'else if (false)'` = 0；重跑 `node --test test/l3-eval-*.test.js` → **28/28**（连跑两次均绿） |

作者自报 3 组负控，按简报「至少抽查 1 个」我复现了其中最关键的一组（失败/取消分支不得被过滤），0→1→0 成立。

---

## 3. 我方独立探针（12 组，自建脚本，跑完已删）

| 探针 | 结果 |
|---|---|
| P1 tests 证据缺失（provider 仍在选） | PASS：`unknown` + `tests-evidence-missing` |
| P1b outcome 证据缺失 | PASS：`unknown` + `outcome-evidence-missing` |
| P2 failed 分支状态 + 合法 completed 分支判定 | PASS：非 completed，`branch-state-failed` |
| P2b 两条必需分支缺一条 | PASS：`unknown`，两条均保留，缺者为 `branch-missing` |
| P2c cancelled 分支 | PASS：`failed`，`branch-state-cancelled` |
| P3 空 summary / 自称完成 | PASS：均 `unknown`，两自述字段回 `null` |
| P3b 自称完成不能冲销实测 failed | PASS：`failed` |
| P4 author 反馈隐私 | PASS：无 id/digest/location/schema/provider 身份/`tests-failed` 泄露；evaluator 视图仍见细节 |
| P4b 私有 task evidence 可读性 | PASS：author `EFK_PRIVACY_VIOLATION`，evaluator 可读 |
| P4c 私有 tests 错标为 author 可见 | PASS：`EFK_PRIVACY_VIOLATION` |
| P5 确定性与源 report 非变异 | PASS：两次 canonical 决策逐字节相同，源 report 未被改写 |
| P6 注册/选择/权限 | PASS：未注册 selection、版本不符 → `EFK_DECISION_AUTHORITY_DENIED`；空 selection → `unknown` |

另跑 `node --test` 全量（**909/909**）覆盖 L1–L3 既有套件，无旁路回归。

---

## 4. 未证明项与保留意见（如实）

1. **`needs-human` 在唯一生产 wiring 上不可达（minor m1）**：内核 `DecisionRecord.outcome` 五值齐备且 `cp2 production statuses distinguish human wait...` 用 `report.runStatus==='needs-human'` 验证它；但生产适配器把 `runStatus` 仅从 `Receipt.status ∈ {completed,failed,cancelled,unknown,not-executed}` 映射（`needs-human`/`timeout`/`usage_incomplete` 无来源），故经 `evaluateSession→createRuntimeTaskEvaluator` 这条唯一路径实际只能产出 `completed/repair/failed/unknown`。五值可通过内核 API 或自定义 provider 触达，但**不由本节点的生产接线产生**。未违反 DoD①/②，故列 minor 而非 blocker；建议后续在 runtime 侧引入人工等待信号源，或明确将该值限定为 kernel 层语义。
2. **`privacyChecked: true` 为适配器自述（minor m2）**：生产适配器直接置真，`privacy-not-checked` gap 在其路径上永不触发。实际隐私保护由内核 `privateTests` 强制校验 + A13 整份记录可见性抬升 + author 读路径 `EFK_PRIVACY_VIOLATION` 三重兜底，故该自述非承重；但「自述替代证据」与 `INTERFACES.md` §3 的禁止项精神相悖，值得后续显式化。
3. **无真实宿主/真实 Pi·DSH 闭环**：本节点证据为单元 + `native-fixture` runtime 用例；真实宿主评测归 L3 scenario（与节点 brief 一致，未被夸大）。
4. **多指标权重/能力收益未涉及**：普通任务按合同合取判定，不涉及 baseline 优劣或能力收益，符合 plan「普通任务无需胜过 baseline」。
5. **未跨引擎/跨进程验证确定性**：同进程同引擎下逐字节相同（探针 P5），未跨引擎复证。
6. **报告为声明式输入**：内核是纯判定，`TaskEvidenceReport` 由 runtime 适配器组装；分支 `state` 在生产来自 journal `nodeStateOf`，但内核层对 report 的信任边界依赖适配器正确组装（A11 由内核对 `requiredBranches` 的逐条 gap 兜底）。

---

## 5. 收工一致性

- **lane ↔ 集成 sha256**：12/12 文件全等（6 kernel + `evaluation.ts` + 5 测试），逐笔值：
  - `src/kernel/evaluation/branches.ts` `744d4ef0…9a4f54`
  - `src/kernel/evaluation/feedback.ts` `46c6f1ae…3be2371`
  - `src/kernel/evaluation/index.ts` `2fbaa9f1…dd7579a1`
  - `src/kernel/evaluation/providers.ts` `3ae0cac9…d37638f6`
  - `src/kernel/evaluation/service.ts` `36285692…08c26161`
  - `src/kernel/evaluation/types.ts` `e54f754e…9f04c035`
  - `src/runtime/session/evaluation.ts` `1dcd0dd2…fcccffd0`
  - `test/l3-eval-decisions.test.js` `580b24f6…47d87ad8`
  - `test/l3-eval-feedback.test.js` `8a294c07…f934e5f3`
  - `test/l3-eval-fixtures.test.js` `78208df1…c78b4e2e`
  - `test/l3-eval-providers.test.js` `e4144e5c…d9a98765`
  - `test/l3-eval-runtime.test.js` `4ffb8ffc…9bb5f155`
- **git 状态**：`git status --porcelain` 除本 dossier 与本 pane 到达前已存在的 untracked `L3-task-evaluation-verify.md` 外为空；`git diff --stat -- src/ test/` 为空；变异只在 `dist/` 且已 `npm run build` 复原（`grep 'else if (false)'`=0，分支状态门已回位）。未写 `.graph`、未 commit、未改 lane。
- **测试与审计数字**：build 0 / typecheck 0 / src:policy 0 / dep:check 0；L3 两次 28/28；L2 runtime 32/32；全量 `node --test` 909/909；`static-audit` exit 0、0 violations、secondDecisionCalls 0、`evaluation.ts→decide` 单入口。
- **落点纪律**：新文件只增不覆，6 源文件均 ≤140 行（最大 `service.ts` 139）≤350；测试平铺 `test/` 根、从 `dist/**` 导入（ADR-0004），5 文件合计 415 行，均实测。
