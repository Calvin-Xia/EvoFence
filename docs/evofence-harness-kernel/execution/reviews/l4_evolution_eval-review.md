# l4_evolution_eval 独立交叉复核（review-1）

日期 / 复核者（pane）：
- 日期：2026-10-02
- 复核者：独立 review pane（**新 tab、新 pane，未参与本节点任何写作**；全程只读，唯一写入是本 dossier）

复核对象（commit + 文件/行数 + 用例数）：
- 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，HEAD **`8c6a37db92011322135d7a2786771f186af17a1b`**（父 `f3f6587`），任务基线 **`d2e311d`**。
- `src/evaluation/evolution/**`：8 个 TS 模块 / **751** 行（`types 121`、`preregistration 159`、`service 139`、`observations 129`、`statistics 104`、`judgement 52`、`artifacts 44`、`index 3`）+ 文档（`README 111`、`EVIDENCE 78`）+ `evidence/**` 41 个原始文件（`results.json`、`mutations.json`、`offline.json`、两轮 test-run TAP、7 组 mutation 的 green/red/restored、build/typecheck/src-policy/dep-check/static-audit 输出，全部 `.stderr.txt` 0 字节）。
- `test/l4-evo-eval-*.test.js`：5 文件 / **536** 行 / `node --test` 报 **38**（= 10 + 1 + 17 + 8 + 2，含 fixtures 模块装载项与 7 个 mutation 子用例；见 §0.2）。
- lane 作者工作区（**仅 sha256/只读比对，未写**）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-evo-eval`，HEAD 仍 `d2e311d`，产物全部 untracked。
- `git show --name-status 8c6a37d` = **53 A / 0 M / 0 D**（`src/evaluation/evolution` 10 + `.../evidence` 38 + `test/l4-evo-eval-*.test.js` 5）。
- 管辖 ADR：`adr_0005`、`adr_0008`。冻结依据：`spec/evaluation/METRICS.md` §5.2/§7.6、`PREREGISTRATION.md` §2、`contracts/INTERFACES.md` §6（`EvaluatorPort.evaluateCapability` 与「T0 未签署不生成确认性评价资格」）。

## 结论：**可接受**（blocker 0 / major 0 / minor 2 / nit 3）

复核简报 §1 的 9 条断言**逐条独立取证通过**：candidate revision（asset id+digest）/base/host/model-payload/protocol/四路 split 绑定完整且逐字段进 receipt；预注册在结果出现后不可重注册、不可改口径，存储字节冻结；盲验输出必须由声明的验证者签发、伪造 issuer/伪造 authority 一律 typed 拒绝；同种子跨进程可重放（两次独立 Node 进程 canonical sha256 相同）、重复 run 拒绝、10,000 次分层 repo bootstrap 确定性、质量/成本/墙钟/截断/统计多指标**合取**；缺预算/样本不足/测量不确定/负结果四类**逐项阻止**收益声明与晋升；DoD② 与 task verdict 分离且被**既有** `src/learning/assets` 的 `recordDecision` 真实消费（staged→validated→独立 promotion→promoted，失败评价无法进入 validated）；held-out/final 对 author/report/asset-staging 不可见、全试验保留不择优、缺 usage 保持 null 且保留 9,547 µUSD/request 预留；四门禁 0、`node --test test/l4-evo-eval-*.test.js` **两次 38/38**、`static-audit` exit 0 / `violations: []`、53 个产物**只增不改**；`evidence/*` 与实况一致，我方另做 2 组真实生产模块变异 0→1→0 复现。2 个 minor 分别是**独立验证器身份边界**（m1，trusted-port 可达、单行可修）与**证据口径**（m2，lane 本地门禁数字 vs 集成实况），均不影响本节点验收；3 个 nit 为证据/设计附注。

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 2 | **m1（独立验证器身份边界）**：`prepare` 只强制「evaluator/verifier 各自 kind=evaluator」且**候选作者**不得与二者同 id，未禁止 `registration.issuer ≡ ports.verifier.issuer`。二者都是 owning application 注入的 trusted port（非候选可达），但节点合同点名「独立验证器」，且代码已强制另两条两两独立关系（作者↔evaluator、作者↔verifier），第三条缺一个 `same(...)` 比较。我的探针 C4a/C4b：注入同一 actor 后 `preregister` 返回 ok，评价给出 `verdict=positive`、`benefitClaimAllowed=true`，且 verification 证据与 receipt 同签名者。修法：`prepare` 的拒绝条件追加 `same(registration.issuer, ports.verifier.issuer)`。**m2（证据口径）**：`EVIDENCE.md`/`results.json` 记的是 lane 本地数字（`src:policy` 239 TS、`dep:check` 239 modules/934 edges），而集成 HEAD 实测 **253 TS / 253 modules / 986 edges**（均 exit 0）；差异完全由基线解释——`d2e311d` 有 231 个 TS，lane 加 8 个 = 239，集成另有 14 个来自已并入的 `l5_legacy_boundary`。`static-audit` 的 88 modules/358 edges 与证据**逐字相同**（core 闭包不含 evaluation 层）。证据未声称是集成口径，复核者在集成环境重跑得同一结论。 |
| nit | 3 | **n1（套件非幂等）**：`node --test test/l4-evo-eval-*.test.js` 会**重写** 21 个 tracked 证据文件（每个 mutation 的 green/red/restored TAP 日志含 `duration_ms`），所以每次跑门禁后 `git status` 不干净，且 lane⇔集成这 21 个文件 + `offline.json` 字节不同（后者只差 Node stack trace 里的 cwd）。语义完全一致（0/1/0、`pass 1/fail 1`、6 pass/6 fail），但建议日志写临时目录或写前比对。**n2**：`plan.authors` 是声明式名单，未与候选 `contentRefs`/`sourceTraces` 的 producer 交叉核对（运行产物的 producer 会被交叉核对）。**n3**：评价后禁止补注册由 `journal.hasStarted(plan.id)` 与 `run.registrationRef === registered.ref` 双重实现；换 id 的克隆 plan 不会静默复用旧 runs（`validateRun` 以 `EFK_EVALUATION_PROTOCOL_MISMATCH` 拒绝），属安全失败的设计说明。 |

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份比对**：`git show --name-only 8c6a37d` 的 53 个产物在 lane ⇔ 集成逐文件比对，**31 全等**（8 个 TS + 2 个 md + 5 个 test + 16 个构建/测试输出）；**22 不等**且全部集中在**每次运行都会重写**的文件：7 组 mutation × 3 阶段 = 21 个 TAP 日志 + `offline.json`。逐项核对差异内容：TAP 日志只差 `duration_ms`/时间戳，`offline.json` 只差 Node 断言堆栈里的 worktree cwd（`…\worktrees\72a4\EvoFence\` vs `…\EvoFence-wt\harness-kernel\l4-evo-eval\`），**语义与数字一致**。lane `git status` 仍全部 untracked、HEAD 未动。
2. **门禁实测**（集成副本；ADR-0004：测试只吃本次 build 的 `dist/`，Node v24.12.0）：
   - `npm run build` → exit 0；`npm run typecheck` → exit 0
   - `npm run src:policy` → exit 0：`253 TypeScript file(s), largest 350 line(s) (src/lib/pi-tool-strategy.ts), limit 350; 0 JavaScript file(s)`
   - `npm run dep:check` → exit 0：`modules 253 / edges 986 / cycles 0 / acyclic: true`
   - `node --test test/l4-evo-eval-*.test.js` 连跑两次 → 各 **`pass 38 / fail 0`**（duration 10.25s / 10.17s），两次用例名集合一致
   - `node verification/kernel/static-audit.mjs` → exit 0，`status: "passed"`，`moduleCount 88`，`edgeCount 358`，`"violations": []`
   - 证据目录在跑门禁前整体备份、跑完按字节复原，收工 `git status --porcelain` 为空
3. **独立探针 4 组 / 共 50 项断言**（自建脚本于系统临时目录，只 import 集成副本 `dist/**` 与作者的 fixture 脚手架；断言与变异点均为自选，见 §3）。
4. **变异负控 2 组**（自选点位，只改本次 build 的 `dist/evaluation/evolution/*.js`，跑红→按备份复原→复绿并核对 sha256，见 §2）。
5. **全量源码通读**：`src/evaluation/evolution/**` 8 个模块 + `README/EVIDENCE` + 5 个 test 文件全文；`preregistration.ts` 的 validate/loadSplits/prepare、`service.ts` 的判据与 promotion 端口、`judgement.ts` 的有序函数、`statistics.ts` 的 bootstrap/BCa/CP 逐行对照 `METRICS.md` §4–§7 与 `INTERFACES.md` §6。
6. **交叉核对**：`evidence/*` 与 `results.json`/`EVIDENCE.md` 逐项对齐（38/38 两轮、`static-audit 0/88/358`、7 组 mutation 的 `0/1/0` + `diskUnchanged:true`、全部 stderr 0 字节、行数表与实况一致、`offline.json` 12 个真实 subprocess 6 pass / 6 fail / paidRequests 0）；`grep` 核对依赖方向、`node:crypto` 归属、无 ambient 随机/时钟。

---

## 1. 必须核验的断言逐条判定

| # | 断言 | 判定 | 实测证据 |
|---|---|---|---|
| 1 | 绑定完整：candidate revision（asset id+digest）、base、host/model/protocol 版本、data split（dev/held-out 预注册划分） | ✅ | 源码：`preregister` 的 `validate` 用 `exact(plan, keys)` 钉死 27 个字段，并逐字段校验 `candidate.asset` / `baseDigest` / `protocolRef` / `analysisScriptRef` / `dataSplitRefs` / `hosts[].{hostId,version,manifestRef,model,toolsetDigest,authorityDigest,cellStatus}`；`compatibility.protocolRef` 必须等于 `plan.protocolRef`、`compatibility.hosts/models` 必须与 `hosts` 同集合、`repositories[].baseDigest` 必须等于 `plan.baseDigest`（`sameSet`）。`loadSplits` 要求 `ref.partition === split.partition`、私有测试 `partition` 同分区、`withheldReason(...,'author') !== 'none'`，且 held-out/final 每 repo 1 实例、leakRisk ∈ {low, reviewed}，T0 下 held-out 逐层配额按最大余数法核对（160→64/56/40）。`observations.validateRun` 把每个 run 逐字段钉回预注册：host/version/model/protocol/sampling/toolset/authority/envelope/candidate 臂别/baseDigest/seed/trial/`registrationRef`。探针 **A2–A5**：receipt 的 candidate/baseDigest/protocolRef/dataSplitRefs/hostManifestRefs/modelBindings 与原 plan 逐字段相等。作者用例 `cp1: candidate/base/dependency/version/model/payload/seed/resource drift is rejected`（9 种错绑定全拒）、`cp1: host manifest bytes must match the declared host version/model/payload`、`cp1: disjoint repo/family/instance splits and private test audience are mandatory` |
| 2 | 预注册不可变：评价后不得改口径；停止规则与指标随输入固定 | ✅ | 源码：`preregister` 先 `validate` 再 `frozen(JSON.parse(canonical(input)))` 落地一份深冻结拷贝，`publish` 后返回的 `RegisteredPlan.ref` 是唯一凭据；`loadRegistration` 每次评价都从工件字节重新 decode + `authority.verify` + `validate`，调用方对象此后被改也无效。`validate` 钉死 `primaryMetric='task_success'`、`selectionRule='all-required'`、`plannedN ∈ {160,165}`、`stopping.confirmatoryN===plannedN`、`futilityN===floor(N/2)`、`bootstrapReplicates===10000`、`comparisons ∈ {[B-A],[B-A,C-B]}`、`envelopes===EVALUATION_ENVELOPES`。探针 **A8–A11**：注册后改写 `f.plan` 的 primaryMetric/plannedN/stopping，存储工件字节不变、二次 `preregister` 得 `EFK_EVALUATION_PROTOCOL_MISMATCH`、评价仍按冻结口径运行。探针 **C5**：`bootstrapReplicates≠10000`、改主指标、改停止规则、`plannedN=150`、`selectionRule='best-of'`、重复 seed、未来时间戳 7 项全部 typed 拒绝。作者用例 `cp1: preregistration binds … and cannot be rewritten after results`、`cp3: trusted provenance prevents offline records from being relabeled as unseen` |
| 3 | 独立验证器 + 权威核验：issuer/authority 可核，不得自评自签；伪造权威拒绝 | ✅（边界见 m1） | 源码：`prepare` 要求 `registration.issuer.kind==='evaluator'`、`ports.verifier.issuer.kind==='evaluator'`、两者版本非空，且 `plan.authors` 不得含 evaluator/verifier 的 actorId；`observations` 要求每个 run 产物 producer ≠ verifier/evaluator，且每条 verification 证据 producer 必须 === `ports.verifier.issuer`；`loadRegistration` 要求 `ref.schema.name==='EvolutionPreregistration'` 且 `ref.producer===registration.issuer` + `authority.verify`；`evaluationForPromotion` 要求 receipt/decision 的 producer 与 decision.issuer 均为注册权威、两个 ref 都过 `authority.verify`、字节与内存对象一致、`decision.evaluationReceiptRef===receiptRef`。探针 **A13–A18**：作者当 evaluator/verifier 被拒；伪造 issuer 的预注册被拒；verifier 证据由 evaluator 自己签发被拒；`authority.verify` 失败阻断评价；未密封/错绑 run 被拒。探针 **C4c**。作者用例 `cp1: forged preregistration/authority cannot become a registered evaluator`、`DoD2 authority negative control: forged issuer/signature or substituted receipt never qualifies`、`cp3 independent verifier omissions/fake producer are rejected` |
| 4 | 统计与重复：同种子可重放；去重；bootstrap（10k 配对）确定性；多指标合取护栏 | ✅ | 源码：`statistics` 用 LCG（`state=(imul(state,1664525)+1013904223)>>>0`）无 ambient 随机/时钟（`grep Math.random\|Date.now\|new Date` 于 8 个模块 **NONE**）；分层内按 repo 整体重采样 10,000 次、BCa 加速度由 repo jackknife、ties 0.5 修正、`bootstrapDigest = digest(canonical(bootstrap))`；`conditionalPower = 1−Φ(1.960−(Δ̂−MVE)/√(π̂_c/N))` 与 `METRICS.md` §7.6 逐字一致；`scoreNullSe=√((π̂_c−MVE²)/n)`、`zMve=(Δ̂−MVE)/SE`、`exactMcNemarP=min(1,2·tail)` 与 §5.2 一致。`observe` 以 `cellKey=[trialId,seed,host,instance,arm]` + runId 双重去重，重复即 `EFK_EVALUATION_PROTOCOL_MISMATCH`；`service` 的 `benefitClaimAllowed` 是 `every(verdict==='positive' && cellStatus==='complete' && look==='CONFIRMATORY_LOOK' && 三个护栏==='passed') && usageComplete` 的合取。探针 **A1**（同输入 canonical 逐字节相同）、**A12**（换 bootstrapSeed 只变 draws）、**D**（两次独立 Node 进程 canonical sha256 完全相同 `261a4f03…f71c7`）、**C2d/C2e**（重复 run / 未声明 trial 拒绝）、**B2b**（一个 host blocked 即锁死声明）、**B2d**（质量不可靠单独不锁，次指标）、**B2e**（截断护栏失败即锁死）。作者用例 `cp2 same seeds replay identically; … never chosen by their best result`、`statistics use stratified paired SE/MVE, 10000 draws, BCa and the frozen formula`、`cp2 discordance floor and ci-spans-mve` |
| 5 | DoD①：样本不足/预算缺失/不确定/失败 → **阻止**收益声明或晋升（逐项负控） | ✅ | 源码：`judge` 顺序为 L0 cellStatus→blocked；L1 污染或 usage 不完整比例 >5%→`inconclusive/degraded-data`；`!budgetAuthorized`→`inconclusive/budget-missing`；`!t0Approved 或 evidenceKind!=='unseen' 或 partition!=='held-out'`→`exploratory_only/not-confirmatory-evidence`；`missing`→`exploratory_only/incomplete-inventory`；uncertain→`inconclusive/measurement-uncertain`；futility→`inconclusive/futility` 或 continue；确认看 `n<plannedN`→`exploratory_only/insufficient-samples`；`n01+n10<25`→`discordance-floor`；`zMve` 阈值外 `ci-spans-mve`。`service` 的 `benefitClaimAllowed` 与 `evaluationForPromotion`（`EFK_EVALUATION_INSUFFICIENT`）双重拦截。探针 **B1a–B1e** 四类逐项 + 无观测：缺预算→`inconclusive/budget-missing`、100 样本→`exploratory_only`、`privateTestsPassed=null`→`inconclusive/measurement-uncertain`、B 臂变差→`negative`/`outcome=rejected`，四类全部 `benefitClaimAllowed=false` 且 `evaluationForPromotion` 非 ok；**B2a**（`maxRequests=1`→`guardrailCost=failed` + reason `budget-exceeded`，此时统计仍是 `positive` 但声明被锁，正是 DoD① 要的形状）。作者用例 `DoD1 budget-missing blocks benefit and promotion despite apparently excellent results`、`DoD1 insufficient-samples …`、`DoD1 uncertain measurements …` |
| 6 | DoD②：与 task verdict 分离；receipt 被既有注册器/消费路径实际使用 | ✅ | 源码：`service.ts` 单文件只有一个判据路径，`evaluateCandidate` 直接 `return evaluateCapability(ref, at)`；不 import `kernel/evaluation`（`grep kernel/evaluation src/evaluation/evolution/*.ts` → NONE，仅 evidence 日志文本命中）；produces `DecisionRecord{kind:'candidate', contractRef:null, taskEvidenceRef:null, activationReceiptRef:null}`，无 promotion/activation API（探针 **D2** 断言 service 面无 `evaluateTask/promote/activate/recordDecision`）。消费侧：`src/learning/assets/decisions.ts` 的 `recordDecision` 读 `EvaluationReceipt`/`evaluationReceiptRef` 并做绑定/权威校验——探针 **B3b** 用真实 `stageRevision`+`recordDecision` 把本服务的 `decisionRef` 推进到 `validated`，**B3c** 独立 promotion 决策推进到 `promoted`，**B3d** 缺预算评价被 `EFK_ASSET_QUALIFICATION_INVALID` 拒绝，**B3e** 带 attest 的 task verdict 被 `EFK_DECISION_AUTHORITY_DENIED` 拒绝，**B3f** 调用方伪造的 `benefitClaimAllowed=false` 被 promotion 端口忽略。作者用例 `DoD2 production consumer uses the real receipt: registry validates then separately promotes; failed eval cannot transition`、`DoD2 task-verdict negative control` |
| 7 | 泄漏/选择偏差/usage：held-out 对候选作者不可见；择优上报/多次试验防护；缺失 usage 不归零 | ✅ | 源码：`loadSplits` 要求 `privateTestsRef` 对 author `withheldReason !== 'none'`；`observe` 对每个 run 的 `authorVisibleRefs` 逐项 `withheldReason(...,'author')`，命中即 `EFK_PRIVACY_VIOLATION`；`publish` 的 receipt/decision 一律 `visibility:'private'` + 预注册分区。选择偏差：`plan.comparisons/trialIds/seeds` 冻结、`all-required`、`observe` 读的是 `journal.runs` 全量清单（含 failed/cheap/cancelled），`analyses[].observedRuns` 保留全部观测；`predecessorPositive` 实现固定序列 B−A→C−B。usage：`completeness` 校验 `total===inputUncached+cacheRead+output`、request 身份不重叠、reasoning 为 output 子集、缺 telemetry 记 `knownMicros=null` 并按 `RESERVE_PER_REQUEST_MICROS×缺失请求数` 保留。探针 **C1/C1b/C1c**（held-out/final 即使 `visibility:'public'` 也被拒；receipt/decision 对 author/report/asset-staging 全部 `EFK_PRIVACY_VIOLATION`；盲验输入无 arm/host/author/reasoning 键）、**C2a–C2c**（两个 cheap trial 全保留、坏的 trial 产生 `negative`、observedRuns=320 全量 ITT）、**C3a–C3f**（costMicros=null、`totalMicros=null`、预留 `320×9547=3,055,040`、`costBasis='unknown'`、隐式请求令 usageComplete=false、offline 记录不可改标 unseen）。作者用例 `cp3 leakage negative control`、`cp3 selection-bias negative control`、`cp3 usage negative control`、`cp3 telemetry checks implicit requests, duplicate request identity, contradictory completeness and reasoning subset` |
| 8 | 门禁与边界 | ✅ | 集成环境实测：build/typecheck/src:policy/dep:check 全 exit 0（253 TS / 253 modules / 986 edges / cycles 0）；`node --test test/l4-evo-eval-*.test.js` **两次各 `pass 38 / fail 0`**；`static-audit` exit 0、`violations: []`、88 modules / 358 edges；`git show --name-status 8c6a37d` = **53 A**（零 M/D，全部落在 `src/evaluation/evolution/**` 与 `test/l4-evo-eval-*.test.js`，core/冻结协议/资产注册器零改动）；新增 TS 最长 159 行、test 最长 184 行（≤350 上限）。数字口径差异见 **m2** |
| 9 | 证据与负控：`evidence/results.json`/`mutations.json` 与实况一致；抽查 1-2 个生产模块变异 0→1→0；未证明项如实 | ✅ | `results.json` 的 tests 38/38 两轮、static-audit 0/88/358、行数表与文件实况逐个相等；`mutations.json` 7 条 `green/red/restored = 0/1/0`、`diskUnchanged:true`、`productionModuleSha256` 与我复原后的 dist 字节相等（`judgement.js 17a9b50ad786…`、`observations.js e458632780ff…`、`service.js ea69f32faa42…`）；7 组 TAP 日志每项 `green pass 1`、`red fail 1 + AssertionError`、`restored pass 1`、无 `mutation missed`。**我方另做 2 组自选点位**（见 §2）均 0→1→0。`offline.json`：12 个真实 Node subprocess（6 pass/6 fail）、真实 `git diff --no-index` hunk、`paidRequests:0`、`verdict:inconclusive`、`benefitClaimAllowed:false`、四条 limitation 如实。未证明项（真实未见收益归 `l4_capability_trial`、真实 T0/试验预算未发生、生产 signer/root/journal 与 `l4_promotion` 应用接线待集成、SHA-256 ≠ 签名、same-user ≠ OS sandbox）在 `README.md`/`EVIDENCE.md` 逐条列出且与代码事实一致 |

---

## 2. 变异负控（0 → 1 → 0，仅改 `dist/`，按备份复原）

作者 7 组之外，我自选 2 个不同点位（均非作者已用行）：

| 组 | 变异点（编译产物） | 变红用例（实测） | 复原 |
|---|---|---|---|
| **NC-1** 断言 4「样本/种子/run 去重不可择优」 | `dist/evaluation/evolution/observations.js`：`if (keys.has(key) || ids.has(checked.value.run.runId)) {` → `if (false) {`（**关闭重复 run 判定**） | `--test-name-pattern="cp3 duplicate samples"` → **green 0 / red 1（AssertionError）/ restored 0** | 回写后 `bytesRestored=true`，`sha256=e458632780ff…` 与 `mutations.json` 记录的 observations.js 值相等；复绿 `pass 1` |
| **NC-2** 断言 5/7「T0 + unseen + held-out 才能形成确认性资格」 | `dist/evaluation/evolution/judgement.js`：`if (!registered.t0Approved \|\| p.evidenceKind !== 'unseen' \|\| p.partition !== 'held-out')` → `if (false)`（**放行 offline/dev/draft 为确认性**） | `--test-name-pattern="offline/dev/draft remains exploratory"` → **green 0 / red 1（AssertionError）/ restored 0** | 同上复原，`sha256=17a9b50ad786…` 与记录值相等 |

作者 7 组（`budget-bypass`、`sample-bypass`、`selection-bias`、`leakage-bypass`、`usage-as-zero`、`forged-authority`、`task-as-evolution`）我逐份核对 TAP：`green pass 1` / `red fail 1 + AssertionError` / `restored pass 1`，且两次全量跑（含这 7 组子用例）均 38/38。

---

## 3. 我方独立探针（4 组 / 50 项断言，自建脚本于系统临时目录）

| 探针组 | 覆盖 | 结果 |
|---|---|---|
| **A（18 项）** | 绑定完整性、跨进程/同进程重放、receipt 逐字段绑定、预注册字节冻结 + 评价后不可重注册、作者/验证者/权威三类伪造负控、密封 registration 绑定 | **17 PASS / 1 FAIL**——FAIL 是刻意构造的 **A15/C4**（evaluator≡verifier 未被拒），其余全过 |
| **B（13 项）+ B2（3 项）** | DoD① 四类 + 无观测 + `maxRequests` 超限；护栏合取（质量次指标/截断/墙钟/成本）；DoD② candidate 决策与 task verdict 分离、真实 `recordDecision` 消费、失败评价不能 validated、task verdict 不能充当演化资格、caller 布尔被忽略 | **16 PASS** |
| **C（27 项）** | held-out/final 泄漏（含 public）、作者/报告/staging 受众、盲验输入去标识；全试验保留/ITT/`all-required`/重复与未声明 trial；queue usage null + 预留 + 晋升阻断 + 隐式请求 + 证据等级改标；evaluator≡verifier 复现（C4a/C4b/C4b2）；预注册 7 项设计冻结 | **27 PASS**（C4a 记录 m1 事实） |
| **D（3 项）+ 跨进程** | `evaluateCandidate === evaluateCapability` 同路径、service 面不含 task/promotion/activation、两次独立进程评价 canonical sha256 相同、源码无 ambient 随机/时钟 | **全 PASS**（`261a4f03…f71c7` 两次一致） |

（探针脚本置于 `%TEMP%\l4rev\`；cwd 保持集成 worktree；未改 lane、未 commit、未写 `.graph`；跑门禁前后对 `evidence/` 做字节备份与复原。）

---

## 4. 发现（m1/m2 与 n1–n3 的复现与修法）

1. **m1 独立验证器身份边界**（复现：探针 C4a/C4b）。`ports.verifier` 与 `registration` 都是 owning application 注入的可信端口，候选无法替换，因此不是候选可达的作弊路径；但 `prepare` 已经强制「作者↔evaluator」「作者↔verifier」两条两两独立，唯独漏了第三条，而 `METRICS`/`INTERFACES` 与节点合同都要求「独立验证器」。修法一行：`prepare` 的 `registration.issuer.kind !== 'evaluator' || ports.verifier.issuer.kind !== 'evaluator' || plan.authors.some(...)` 条件里追加 `|| same(registration.issuer, ports.verifier.issuer)`（并加一条 `cp1` 用例）。不阻塞本次验收，但建议在 `l4_promotion` 接线前补上。
2. **m2 证据口径**（非缺陷）：lane 的 `239 TS / 239 modules / 934 edges` 是 lane 基线口径；集成 HEAD `253 / 253 / 986`。`d2e311d` 实测 231 个 TS，lane = 231+8 = 239，集成另有 14 个来自已并入的 `l5_legacy_boundary`。`static-audit` 88/358 双方逐字相同（只审 protocol/kernel/runtime）。
3. **n1 套件非幂等**：mutation 测试无条件写 `evidence/<id>.{green,red,restored}.txt`，TAP 含 `duration_ms`，所以门禁跑完 tracked 文件必变、lane⇔集成这 21 个文件字节必不同。语义一致（我从集成跑的 TAP 与提交版同为 `green pass 1 / red fail 1 / restored pass 1`）。建议：日志写 `os.tmpdir()`，或写前比对内容再落盘。
4. **n2 `authors` 是声明式**：`plan.authors` 不与 `candidate.contentRefs/sourceTraces` 的 producer 交叉核对（run 产物的 producer 会与 verifier/evaluator 交叉核对）。在 evaluator 自身可信的前提下不构成漏洞。
5. **n3 补注册防护是双层的**：除 `journal.hasStarted(plan.id)` 外，`validateRun` 的 `!same(run.registrationRef, registered.ref)` 使换 id 的克隆 plan 无法复用旧 runs（安全失败）。属设计说明。

---

## 5. 未证明项与保留意见（如实）

1. **真实未见收益未证明**：作者如实归 `l4_capability_trial`；confirmatory 分支是模拟 T0/provider/journal 的 contract fixture，`benefitClaimAllowed:true` 不代表真实收益。复核同意。
2. **真实 T0/试验预算未发生**：`PREREGISTRATION.md` 仍是 `draft-frozen`（§7 人审 `T0` 待签），`evidenceKind:'unseen'` 在测试中是 fixture 声明；实现正确地要求 `t0Approved`，但该批准本身未发生。
3. **生产 signer/root/journal 未接线**：`authority.attest/verify` 在测试里是独立 HMAC sidecar；生产签名器/权限根/journal 由集成方注入。本节点未发现凭据、未附默认信任实现；无密钥 SHA-256 只是完整性提示（`README` 明确）。
4. **`l4_promotion` 应用接线未完成**：`evaluationForPromotion` 端口存在且被探针验证，但仓库内无生产代码调用 `createEvolutionEvaluator`（`grep` 证明 `src/` 无 import）；DoD② 目前证明到「既有 `recordDecision` 真实消费」这一层。
5. **artifact 后端是内存实现**：真实 SHA-256 身份、`verifyForConsumer`/`withheldReason` 受众矩阵被复用，但磁盘持久性/跨进程并发未证明。
6. **运行环境**：本次证据与我的复跑均在 **Node v24.12.0**；项目最低声明 Node 22.13 未在本轮实际执行（作者未列此项，我如实补记）。
7. **futility 看与 165 分支**：`futilityN=null` 与 `plannedN=165` 路径被 `validate` 允许，但只有 160/80 分支有实测用例；165 的逐层配额（66/58/41）与整体功效重算未在测试中固定。
8. **`look='other'` 的离线/开发分支**：`offline.json` 中统计 reason 是 `budget-missing` 而非 `not-confirmatory-evidence`（`judge` 的预算检查先于证据等级检查）；两者结论同为 `inconclusive`、同样禁止声明，仅日志措辞。

---

## 6. 收工一致性

- **lane ↔ 集成 sha256**：53 个产物中 **31 全等**（全部 `.ts`、`.md`、test、构建/测试输出）；**22 不等**且全部是每次运行都会重写的文件——21 个 mutation TAP 日志（只差 `duration_ms`）与 `offline.json`（只差 Node 堆栈里的 worktree cwd）。无语义差异。lane HEAD 仍 `d2e311d`、产物 untracked；集成 `git status --porcelain` 收工时为空（门禁前备份、跑完按字节复原 `evidence/`）。
- **产物 sha256（前 16…后 8）**，lane 与集成逐字节一致：
  - `src/evaluation/evolution/types.ts` `d5c454f911075bc8…82a0c639`
  - `src/evaluation/evolution/preregistration.ts` `b25836aa04176b50…55cc80c9`
  - `src/evaluation/evolution/service.ts` `9914b062abc9eef3…911aa452`
  - `src/evaluation/evolution/observations.ts` `18a3161b0be83a6e…6ceb49e8`
  - `src/evaluation/evolution/statistics.ts` `01b86d25d0cbaf7d…417f54b6`
  - `src/evaluation/evolution/judgement.ts` `790e63b8cb5c582e…4420ad26`
  - `src/evaluation/evolution/artifacts.ts` `3aba7677d0932294…aa482ecf`
  - `src/evaluation/evolution/index.ts` `14a9888470329869…f94d1b67`
  - `test/l4-evo-eval-binding.test.js` `6bbe70facfbe10d6…f39a84e1`、`-fixtures` `02e5e6d3133bf03a…bc0d48b3`、`-guards` `fea9e3ac7de0ae92…d262326f`、`-mutations` `0a4055ef9c9b5f58…ead3df05`、`-offline` `3f8a9cbeb65acbf4…844601a8`
  - `evidence/results.json` `24792799f610eff1…ccaaefeb`、`evidence/mutations.json` `1b0e652d6403f2a2…fecfe13e`、`evidence/offline.json` `e8c8cd13ed72373a…a1eca769`
- **证据↔实况一致**：`results.json` 的 38/38×2、static-audit `0/88/358`、7 组 mutation `0/1/0` + `diskUnchanged` 与我在集成环境重跑结果相符；全部 `*.stderr.txt` 0 字节；行数表与 `wc -l` 逐个相等；`offline.json` 的 12 次真实 subprocess 与 `verdict/benefitClaimAllowed` 自洽。
- **本次复核的写入**：仅本 dossier `docs/evofence-harness-kernel/execution/reviews/l4_evolution_eval-review.md`；未写 `.graph`、未 commit、未改 lane、未改 `src/`/`test/`/`dist` 源码（变异只落在 `dist/evaluation/evolution/*.js` 且已按备份复原、sha256 逐字节相同），`evidence/` 已按门禁前快照复原、收工 `git status` 为空。
