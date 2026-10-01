# l2_graph_model 独立交叉复核（review-1）

日期：2026-10-01 · 复核者：独立 review pane（新 pane，**非作者，未参与本节点任何写作**）· lane（作者工作区，冻结）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\graph`（分支 `refactor/hk-graph`，基线 `d47f0ca`，产物 untracked）
复核对象：`src/kernel/graph/*.ts`（15 文件 / 1770 行）+ `test/l2-graph-{compile,decide,patch,data,loop}.test.js` + `test/l2-graph-fixtures.mjs`（runner 计 **90** 例）
基准（本节点契约真相源）：`spec/graph/SEMANTICS.md`（§2.2/§2.4/§3.0/§3.1/§4/§5）、`spec/graph/EXAMPLES.md`（10 个工作例）、`spec/contracts/{SCHEMAS.md,INTERFACES.md,OWNERSHIP.md}`、`adr_0002`；`spec/contracts/ERRORS.md`（错误码表，本节点未被点名为真相源，仅作旁证引用）

## 结论：需修订

| 级别 | 数量 | 摘要 |
|---|---|---|
| **blocker** | 1 | 中途锁定只挡「改重绑」，不挡「删绑定」：一个 patch 可以把 `to` 为 mutation-locked 节点的 `data` 边删除或改型，静默丢掉执行中节点的输入声明（§5.2「输入不可悄悄变」/ INTERFACES §4「不原地改 binding」/ 节点 DoD②「禁止修改 leased 节点输入」） |
| major | 0 | — |
| minor | 4 | patch 入口不做 check 1 的 schema 半边；`verifying→unknown` 与 §2.2 / INTERFACES §4 的三出口不符；`<2 类 bound` 的错误码与 ERRORS.md 不一致；check 8 未消费 `graphLimits.maxConcurrentAgents` / 未把 loop `maxIterations` 纳入图级 attempt 界 |
| nit | 5 | 见 §3.2 |

除 blocker 外，**逐条核对通过**：11 项原子校验各自落在单一函数且都有可失败的用例；`decide` 的 A1–A6/B1–B3/INV 与 §3.0.2 逐字一致；90/90 绿；我自建的 4 组变异各自只让预期子集变红；无 ambient 读取；lane 与集成副本 21 个文件 sha256 全等；收工时 lane 的 21 个 sha256、`git status --porcelain` 与 `HEAD` 与开工完全一致。

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份一致性**：先对 lane 与集成副本（`...\72a4\EvoFence`）逐文件比对 —— 15 个 `src/kernel/graph/*.ts` + 5 个 `test/l2-graph-*.test.js` + `l2-graph-fixtures.mjs`，**21/21 全等**。集成副本源码全程未读改写。
2. **lane 内构建与测试**（避免与其它 pane 在集成 worktree 并发 build）：`npm run build` → `node --test test/l2-graph-*.test.js`。
3. **自建变异 negative control**（4 组，见 §2.2）：临时改 lane 源码 → 重新 build → 跑测试记录变红集合 → 改回 → 重建 → 复绿；结束时用开工时的 `sha256sum` 清单逐文件校验。
4. **reviewer 自写探针**（`probe1/2/3.mjs`，独立于作者套件，直接 import lane 的 `dist/`）：覆盖作者用例没有直接命中的边界（中途锁定下的边删除/改型、join 的 cover+abandoned、A1 与 A3 的优先级、fallback 是否算 cover、patch 入口的 schema 半边）。
5. ambient/确定性以 `grep` + 通读源码的方式核对（不依赖测试）。

---

## 1. 契约逐条核对

### 1.1 SEMANTICS §5.1 十一项原子校验：单一实现 + 逐项可证伪

校验不是散落的 `if`：`validateGraph`（`validate.ts:44`）一处组合 **2/3/4/5/7/8/9/10/11** 并按 check 号排序返回全部 issue；check 1 在 `compileGraph` 的边界（`decode`+`decodeRuntimeVersion`），check 6 在 `applyGraphPatch` 的边界（`checkAuthority`）。这是文档化的双边界设计，不是遗漏。

| # | 实现（唯一入口） | 可证伪用例（作者套件，实测命中） | 判定 |
|---|---|---|---|
| 1 schema/版本 | `compileGraph` → `decode('GraphSpec')` + `decodeRuntimeVersion` | `check 1 — 不支持的 namespace` / `缺必填字段` / `schema gate — loop <2 类 bound`（3 例） | ✅（patch 路径仅复核版本，见 minor-1） |
| 2 引用完整性 | `checkReferences` + `edgeShapeIssues` + `validatePredicate` | ghost 端点 / 重复 nodeId / dependency 携带他人 slot / 畸形谓词（4 例） | ✅ |
| 3 依赖投影无环 | `checkDependencyAcyclic`（`dependency ∪ data`，Tarjan 迭代版） | 隐藏环（data 反向 + dependency）+ 去边后合法（含负控） | ✅（我方变异 A 复现） |
| 4 数据可消费性 | `checkDataConsumable` → `dataEdgeIssues` | selector 无匹配 / 绑定产物非本生产者 / schema 不满足（3 例） | ✅ |
| 5 必需 fan-in | `checkFanIn` | join 缺 `requiredJoins` / join 无 `requiredBranches` / 合同分支无节点（3 例） | ✅ |
| 6 作用域授权 | `checkAuthority`（patch 边界） | `authorityRef` 越集 / 节点越 scope / 能力越 ceiling（3 例） | ✅ |
| 7 资源冲突 | `checkResources` | 无 policy 的排他声明 / 声明 shared 而 policy 为 exclusive（2 例） | ✅（见 §4：运行期唯一持有者属 store/runtime） |
| 8 attempt/loop/depth/budget | `checkBounds`（+ codec 的 LoopSpec `allOf`） | 无 `maxAttempts` 的 repair / 超 `maxNodes` / `<2 类 bound`（3 例） | ✅（错误码见 minor-3） |
| 9 可终止性 | `checkTermination` | 无界控制环被拒 / 同环放入 loop body 后合法（2 例） | ✅ |
| 10 R4 terminal | `checkTerminalRequired`（`hasRealConsumer`） | 无消费者且非 terminal / 仅 provenance 出边且非 terminal（2 例） | ✅（我方变异 D：把 `hasRealConsumer` 退回 rev5 的「只看 routing」→ **43/90 变红**，证明 blocking 消费者这一半是真载荷） |
| 11 R5 abandonment | `checkAbandonment`（reason/authorityRef/累积/证据） | 空 reason / 重复 abandon / 累积不可丢 / 删证据 / 删已放弃分支 / 合同分支需合同级 authority（6 例） | ✅ |

「可逐项证伪」的更强证据来自 §2.2 的变异表：单点变异只让对应子集变红，而不是全红或全绿。

### 1.2 `decide`（§3.0.2 A1–A6 / B1–B3 / INV）

逐条对照 `decide.ts`：

| 契约 | 实现 | 判定 |
|---|---|---|
| A1 `isTerminal(N)` 优先，`[]` | `decide.ts:88` `if (node !== undefined && node.terminal) return resolved('A1',…)`；我方探针 P7 用「terminal + repair 出边 + `ok:false/repair`」实测得 `A1 failed`，未被 A3 短路（与 EXAMPLES rev7 的注记一致） | ✅ |
| A2 route 匹配 → `[enable(t)]` | `matchingOutgoing(edges,'route',env)`（声明顺序取首条） | ✅ |
| A3 repair → `failed(原 reason)` + `[newAttempt(t), enable(t)]` | `decide.ts:97-108`，顺序与字段名逐字一致；负控测试断言 t 是 `nM` 而非触发者 | ✅ |
| A4 fallback → `failed(原 reason)` + `[enable(t)]` | `decide.ts:110`；负控「reason 不匹配 when 则不 fallback」→ 落 A5 | ✅ |
| A5 有 routing 出边但无匹配 → `failed(no-matching-route)` | `decide.ts:113`；实测 `needs-human` 且仅两条 completed/repair route → A5 | ✅ |
| A6 仅 blocking 出边 → `out.ok ? TaskDecision : failed(out.reason)` | `decide.ts:116` `resolved('A6',…)` | ✅ |
| INV 留原状态 + 告警、不写 failed | `decide.ts:118-126`（`nodeState: event.state` + `EFK_INVARIANT_VIOLATION`）；负控用绕过校验的手建 plan | ✅ |
| B1 先于 B2，B3 兜底 | `decide.ts:124-131`（先 `hasDeclaredCover(edgesTo(U),U)`，再 `isAbandoned(U)`）；我方探针 P3 验证 **fallback 指向 U 也算 cover**（F7 的 `repair|fallback`），P5 验证 join 的同一入口 | ✅ |
| 两层语义分离 | `resolved()` 只写 `nodeState`，`graphActions` 独立；A3/A4 让节点留 `failed` 而图仍推进 | ✅ |
| 谓词只读 outcome/reason/self/decision/env；缺路径不匹配 | `predicate.ts:33` 白名单 ROOTS + `Object.hasOwn`；`host.brand`/`env.tool` 实测不匹配；`neq` 对 missing 也不匹配（不把 missing 判成功） | ✅ |

**join（§5.3）**：`evaluateJoin` 复用同一个 `decide` 判每个非 `succeeded` 分支（B1→waiting / B2→failed / B3→waiting），`branchReport` 按 `requiredBranches` 声明顺序**逐条**产出、缺失分支 `state:null` + `gapReason` 而不是被过滤。

### 1.3 patch transaction（§5.1/§5.2/§2.4）

- **整体提交或整体拒绝**：`applyGraphPatch` 依次做 版本 → graphId → `expectedRevision` CAS → 中途锁定 → 组候选 → `validateGraph([...]) + checkAuthority` 排序取首条；任何一步失败直接 `{ok:false,error}`，不发布新 revision。`toRevision = expectedRevision+1`；`requiredJoins` 由 `joinNodeIds(candidate)` **派生**（GraphPatch 无该字段，避免调用方伪造）。✅
- **CAS/图身份**：`EFK_REVISION_CONFLICT` / `EFK_GRAPH_REFERENCE_INVALID`，实测。✅
- **中途锁定（blocker 所在）**：`patch.ts:151-162` 拒绝 (a) `changes`/`removals` 命中 `MUTATION_LOCKED_STATES = [leased,running,verifying,unknown,cancelling]` 的节点，(b) **同一 edgeId** 的 `data` 边对锁定 `to` 改 digest/schema/`artifact`↔`null`。负控最完整：同一 patch 在 `ready` 时提交、在 5 个锁定态全部拒绝。**但 (c) 删除或改型未覆盖**，见 §3.1 blocker-1。
- **候选重校验**：候选 Spec 走与 `compileGraph` 同一套 `validateGraph`（说明「修订必须重新通过 11 项」不是自我声明）；测试「the candidate revision is re-validated against all eleven checks」用新引入的无界 repair 触发 `EFK_GRAPH_BOUND_INVALID`。✅
- **失败分支不删除 / abandonment 累积**：`checkAbandonment` 用 `priorAbandonedNodeIds`（由 `current.abandoned.keys()` 注入）拒绝丢弃既有 abandon；`evidenceNodeIds`/`removals` 拒绝删有证据或已放弃的节点。实测 6 例全绿。✅
- **合同重验**：放弃 `contractBranches` 中的节点必须带 `contractAuthorityRefs` 覆盖的 `authorityRef`，否则 `EFK_GRAPH_AUTHORITY_ESCALATION`；正例（带合同级 grant）可提交。✅ 结合 `reason`（schema `minLength:1`）+ `authorityRef`（pattern）两字段，DoD②「撤销分支需保留理由并重新验证合同」在本层成立。

### 1.4 typedEdges 语义之争（任务要求 5）——**作者正确，「完整新边集」被契约支持**

- `SCHEMAS.md` 的 `GraphPatch.typedEdges` 描述逐字为「**显式完整新边集**，无隐式猜测」；`GraphPatch` 没有 per-edge 的 add/remove 列表，也没有「增量」语义的载体。
- 实现 `buildCandidate` 用 `patch.typedEdges` **整体替换**当前边集，`diffGraphs` 把被省略的 edgeId 记为 `removedEdges`；用例「typedEdges is the complete new edge set — omitting an edge removes it」直接断言。
- 「增量」读法在 SCHEMAS 与 EXAMPLES 中都没有支持，因此不是 blocker。**副作用**只有两条，均属文档/调用方风险：EXAMPLES 例 5 的 `GraphPatch` 片段本身省略了 `typedEdges`（及 `adds/removals/abandonedBranches/protocol/graphId`），按冻结 schema 该片段不是合法 `GraphPatch`，属示例缩写；以及「完整集」下漏写一条边会静默删边 —— 这一风险与 blocker-1 是同一处（中途锁定下的删边），修 blocker-1 后剩下的漏删会被 re-validate 与调用方 review 兜住。

### 1.5 DoD 对照

- **DoD①「禁止悬空引用、隐藏依赖环、无界 repair、不完整必需 fan-in」**：分别由 check 2 / check 3（`dependency ∪ data` 同一 SCC 计算）/ check 8（每条 `repair`/`fallback` 必须有 `maxAttempts`，并受图级 `maxAttempts` 约束）/ check 5 + `evaluateJoin` 全覆盖。✅
- **DoD②「禁止修改 leased 节点输入；撤销分支需保留理由并重新验证合同」**：后半句成立；**前半句只成立一半**（挡重绑、不挡删绑定）→ blocker-1。

---

## 2. 实测证据

环境：Windows、Node v24.12.0、lane `d47f0ca`（全程未 commit、未改 `.graph/`、未动集成 worktree 源码）。

### 2.1 一致性 / 构建 / 测试

```
$ # 21 个文件（15 src + 6 test/fixtures）lane vs 集成副本
OK abandonment.ts … OK validate.ts / OK l2-graph-{compile,data,decide,loop,patch}.test.js / OK l2-graph-fixtures.mjs
→ 21/21 sha256 全等

$ npm run build
> tsc                                                                    exit 0

$ node --test test/l2-graph-*.test.js
ℹ tests 90   ℹ pass 90   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0        exit 0
（未跑全量 `npm test`：既有 `test/runner.test.js` 墙钟 flake 与本节点无关）

$ npm run src:policy   → 136 TS files, largest 350 (< limit 350), 0 JS    exit 0
$ npm run dep:check    → 136 modules / 484 edges / cycles 0 / acyclic: true  exit 0
```

作者自报「90 条断言」在 runner 口径下是 **90 个 test case**（每例含多条 assert），数值可复现。

### 2.2 自建变异 negative control（4 组，非作者报告）

| # | 变异（lane 源码，改后即恢复） | 变红 | 说明 |
|---|---|---|---|
| A | `cycle.ts` check 3 的投影由 `DEPENDENCY_PROJECTION` 收窄为 `['dependency']` | **1/90**：`check 3 — a hidden dependency ring through a data edge is refused` | 证明「data 也算依赖」是载荷 |
| B | `patch.ts:159` `if (edgeBindingChanged(…))` → `if (false && …)` | **1/90**：`example 4 path C — rebinding a mid-flight consumer is refused` | 证明中途重绑守卫是载荷且被覆盖 |
| C | `decide.ts:124-131` 交换 B1/B2 顺序 | **1/90**：`B1 precedes B2 — cover short-circuits abandonment` | 证明「B1 先于 B2」是载荷 |
| D | `edges.ts:37` `hasRealConsumer` 退回 `hasRoutingOutgoing` 单条件（rev5 语义） | **43/90**（example 2 编译、check 3/8/11、example 4 全组、readiness 组…） | 证明 rev6「blocking 消费者也算 real consumer」整体是载荷 |

每组变异后 `npm run build` 均 exit 0（变异是合法的 TS），复原后 **90/90 绿**。

收工校验：`sha256sum -c before.sha256` → 21/21 匹配；`git status --porcelain` 与开工逐字相同（仍只有 `?? src/kernel/` 与 5 个 `?? test/l2-graph-*.test.js`、`?? l2-graph-fixtures.mjs`）；`HEAD = d47f0ca`。

### 2.3 reviewer 自写探针（dist 上的独立行为证据）

| 探针 | 输入 | 实测 |
|---|---|---|
| P3 | `fallback(nZ→nB)` 指向 U，`nD` 依赖 `nB` 失败 | **B1 waiting**（F7 含 fallback，✅） |
| P4 | A1 + `decision='needs-human'` | A1 → **waiting**（§2.2 `verifying→waiting`，✅） |
| P5 | join 分支既有 cover 又 abandoned | **waiting / B1**（join 复用同一入口，✅） |
| P7 | `nV.terminal=true` 且有 repair 出边，`ok:false/repair` | **A1 failed**，未被 A3 短路（✅ 与 EXAMPLES rev7 注记一致） |
| P6/P9 | `compileGraph` 传 `schemaVersion:'1.0.0'` | **ACCEPTED**（见 §4 信息项）；`decodeRuntimeVersion('runtime/2')` → `EFK_PROTOCOL_UNSUPPORTED` |
| P8 | `dataEdgeIssues` 用两条同 name/version 异 digest 的 outputSchemas | 0 issue（`sameSchema` 含 digest；经 codec 的正常路径下「歧义」不可达，见 nit-4） |
| A1/A2/A4 | 删/改型锁定 `to` 的 `data` 边 | **COMMITTED**（blocker-1） |
| A3 | 同 edgeId 换 digest（对照） | `EFK_GRAPH_ACTIVE_NODE_MUTATION`（守卫本身有效） |
| B1/B2/B4 | 空 `reason` / 未知字段 / `changes` 节点缺 `contextPlan` | 均 **COMMITTED**（minor-1） |

### 2.4 ambient / 确定性 / 顶层副作用（`src/kernel/graph/**`）

- import 说明符全部为相对路径（`../../protocol/index.js`、`./*.js`）；**0** 个 bare specifier、**0** 个 node builtin、**0** 个动态 `import(` / `require(`。
- `Date` / `new Date` / `Math.random` / `process` / `fetch` / `XMLHttpRequest` / `performance` / `setTimeout` / `setInterval` / `crypto` / `console` / `globalThis` 命中 **0**（唯一字面命中是注释与 `node:xxx` 无关词）。
- 模块顶层只有 `import type`/`export`/`const`/`function`/`interface`/`type`；无模块级 `let`、无顶层调用、无惰性缓存（`ROUTING_EDGES`/`MUTATION_LOCKED_STATES`/`ROOTS` 等是冻结字面量或纯 `Set` 构造）。
- 时钟/随机/摘要都不在本模块产生：`Instant`（`AbandonedBranch.at`）、loop 进度（`LoopProgress`）、`ArtifactRef.digest` 全部是**入参**；`resumeLoop` 只回吐已结算边界。`DecisionRecord`→state 的映射是纯函数。
- 防御性分支清点（判据：契约门禁 / 显式 unknown / schema 拒绝**不算**违规）：`decide` 的 INV、`evaluateReadiness` 的 `unknown-node`/`resource-policy-missing`→INV、`evaluateJoin` 的非 join→INV、`dataEdgeIssues` 的 `candidates.length!==1` —— 均为类型强制的 `Map.get` 空值分支或绕过校验的告警，非「多余兜底」；无可达的伪造默认值（无 `?? 0`/`?? false` 式缺省）。判为合规。

---

## 3. 发现

### 3.1 blocker-1 · `patch.ts:151-162` — 中途锁定只挡「改重绑」，不挡「删绑定」

**契约依据（三处一致）**：
- `SEMANTICS §5.2`「输入不可悄悄变：**被执行节点的 `data` 绑定不可变更**；要变就重签 revision + 显式 rebind」。
- `INTERFACES §4`「graph patch … **leased/running/verifying/unknown/cancelling 不原地改 binding**」。
- 节点 DoD②「**禁止修改 leased 节点输入**」；`patch.ts` 自己的文件头也写「inputs of a leased/running/verifying/unknown/cancelling node cannot change in place」。

**实测反例**（reviewer 探针，节点/边为最小构造：`nG(deterministic, outputSchemas=[report])`、`nC(agent, terminal)`、`nD(agent, terminal)`；边 `e-g-c: data nG→nC (expect=report)`、`e-g-d: data nG→nD (expect=report)`）：

```
context.activeNodes = [{ nodeId:'nC', state:'running' }]
patch = { expectedRevision:1, typedEdges:[e-g-d] }   # 完整新边集：漏掉 e-g-c
=> ok:true, toRevision:2, graph.edgesTo('nC') == []        # ← 输入声明被静默删除
对照 A3：同 patch 但把 e-g-c 换成新 digest 的同一 edgeId
=> EFK_GRAPH_ACTIVE_NODE_MUTATION                          # ← 守卫只在这一形态生效
5 个锁定态逐一实测：leased / running / verifying / unknown / cancelling 全部 COMMITTED
变体 A2：删掉绑定的 e-g-c 再新增 edgeId='e-g-c2' 的**未绑定** data 边 → 同样 COMMITTED
```

**为什么是 blocker 而不是 major/minor**：

1. 它直接让「禁止修改 leased 节点输入」这句话为假 —— 对一个 `leased`（尚未开始执行、输入待消费）节点，删掉它的 `data` 边就是修改它的输入；这是 DoD② 的原话，不是我的外推。
2. 它给出了一条绕过既有守卫的通道：守卫拒绝「换 digest」，却允许「删绑定 + 新 edgeId 未绑定边」，后者等价于把消费方改成「跟随最新产物」——正是 `SEMANTICS §3.1 data` 行与 `EXAMPLES 例 4 路径 B` 明令禁止的「不自动跟随、不静默降级」。
3. 责任在图层而非 runtime：图本身同时持有 `current.edges`（旧绑定）与 `activeNodes`（锁定态），守卫已经在同一个循环里做「同 edgeId 比较」，缺的只是「旧边消失/改型」这一支；`patch.ts` 的文档承诺也包含它。

**最小修复**：把「遍历新边集」补成「遍历旧边集 ∪ 新边集」。对每条**当前** `type==='data'` 且 `locked.has(edge.to)` 的边，要求新完整集里存在**同 edgeId 且仍为 data 且 `edgeBindingChanged` 为假**的边；否则 `EFK_GRAPH_ACTIVE_NODE_MUTATION`。约 8 行 + 1 条用例（本次反例可直接作为测试）。

### 3.2 minor / nit

**minor-1 · `patch.ts:141-176` — patch 入口不做 check 1 的 schema 半边（仅版本）**
`applyGraphPatch` 调 `decodeRuntimeVersion(patch.protocol)`，但不 `decode('GraphPatch', patch)`，组装出的候选 Spec 也只走 `validateGraph`（graph 规则）。实测：`reason:''` → **COMMITTED**（`GraphPatch.reason` 冻结 `minLength:1`）；未知字段 `bogus:1` → **COMMITTED**（`additionalProperties:false`）；`changes` 里的 NodeSpec 删掉必填 `contextPlan` → **COMMITTED**（没有任何校验器读该字段）。真实链路里 `CommandPayload.patch` 先经 codec，故非运行期破口；但 (a) 与 `compileGraph` 对 spec 做 `decode` 的对称性不一致，(b) 与 `patch.ts` 文档「the eleven atomic checks … all run before a new revision is published」不符（check 1 只跑了一半），(c) 库的公开导出（`index.ts` 导出 `applyGraphPatch`）可被直接调用。建议：入口处补 `decode('GraphPatch', patch)`（或在文档/类型上明确「调用方必须先 decode」，并把 check 1 的完成度写清）。

**minor-2 · `decide.ts:45-57` — `verifying → unknown` 不在冻结状态机里**
`stateFromDecision('unknown') = 'unknown'`。而 `SEMANTICS §2.2` 的图里 `unknown` 的入边只有 `leased/running/cancelling`，出边只有 `verifying/failed`；`INTERFACES §4` 更明确：「仅绑定的 TaskDecision 可使 **verifying→succeeded/failed/waiting**」（三出口）。另 `resolved()`（`decide.ts:67-72`）在 `ok===false` 时无条件写 `failed(out.reason)`，而 §3.0.2 的 A1/A2 写的是「`verifying→(TaskDecision 定)`」（只有 A6 才用 `out.ok` 分叉）。两处都是「用保守解释代替冻结映射」，倾向显式 unknown（requirement 4 明确豁免），且不会产生「假成功」，故记 minor：请在人审时定案 —— 要么把该映射写进 §2.2/§4，要么改成 `waiting`（`unknown` 的决定语义即「缺新信息」）。

**minor-3 · `<2 类 bound` 的错误码与 ERRORS.md 不一致**
`ERRORS.md` 的 `EFK_GRAPH_BOUND_INVALID` 触发条件逐字含「loop <2 类 bound」；而实现把该约束放在冻结 schema 的 `LoopSpec.allOf`（`SCHEMAS.md §1` 确有该 allOf），于是 `compileGraph` 返回 `EFK_SCHEMA_INVALID`（用例 `schema gate — a loop declaring fewer than two bound kinds is refused` 断言之）。「一处门禁」的论证成立、拒绝行为正确，但成码与错误码表不符 —— 若下游按 `EFK_GRAPH_BOUND_INVALID` 键控「bound 越界」会漏判。建议二选一：在 check 8 补一条 `<2 类 bound → EFK_GRAPH_BOUND_INVALID`（保持 schema 作为形状门），或修订 ERRORS.md 该行并说明「由 schema 拒绝、成码 SCHEMA_INVALID」。

**minor-4 · `bounds.ts:26-44` — check 8 未消费 `graphLimits` 的两个字段**
`maxConcurrentAgents` 全程未被任何校验或函数读取（没有可比的图级声明，至少应在文档里说明「本层无法校验、归 runtime」）；`node.loop.maxIterations` 未与 `graphLimits.maxAttempts`（§4「loop 内每次迭代是同一节点下的新 attempt」）建立联系。二者都不改变已声明的语义，属覆盖度缺口，建议补文档或补校验。

**nit-1 · `predicate.ts:79-97` — `evalPredicate` 无 `default` 分支**：类型是 `boolean`，但若传入绕过 codec 的未知 `op` 会返回 `undefined`（`whenMatches` 里被当 falsy 吞掉，实际不会误判为匹配）。建议补 `default: return false`，让「未知 op 不匹配」在代码形状上显式。

**nit-2 · `readiness.ts:73-77` / `artifacts.ts:44-56` 的两个不可达分支**：`policy === undefined → INV` 与 `candidates.length !== 1` 的「>1」支，在经 `compileGraph` 的图上都不可达（check 7 / `uniqueItems`+`sameSchema` 含 digest 已排除）。它们是契约门禁（合规），但无法通过公开路径证伪；建议在注释里点明「仅手建 plan 可达」，避免下一位读者误以为它们有覆盖。

**nit-3 · `loop.ts:84-95` — `loopStop` 的优先级是自定义**：bound-exhausted 先于 body-success。§4 只列三种 stop 条件、未定序；实现选择「界不被越过」是合理的，但请把它写进 SEMANTICS §4 或本模块注释（现有注释有说明，建议上提到契约文档）。

**nit-4 · `checkDataConsumable` 的「歧义 selector」**：`SchemaRef` 含 digest 且数组 `uniqueItems`，故编译路径上「同名同版本多条匹配」不可达（只有 0 或 1）。用例 `check 4 — an ambiguous producer output selector is refused` 是直接调用 `dataEdgeIssues`（未过 codec），属函数级门禁而非图可达缺陷；如需保留该语义，建议在测试注释里标注「绕过 decode 才有意义」。

**nit-5 · 「90 条断言」的口径**：runner 计 90 个 test case。

---

## 4. 未覆盖 / 明确不主张（与作者自报的一致性核对）

我独立复核了作者列出的「未证明项」，结论**全部同意其归属**，其中两条给出补充：

| 作者自报未证明 | 我的判定 |
|---|---|
| `attemptOrdinal` 分配属 runtime/store | 同意。图模块无 attempt 计数器（`NodeOutcome`/`decide` 不含 ordinal） |
| check 7 只校验资源声明一致性，运行期唯一持有者属 store/runtime | 同意，且**这是正确切分**：check 7 不应拒绝「两个节点声明同一 exclusive 资源」（§3.2 互斥由资源名 + runtime maxHolders 推导，非节点对）；我方核对 `checkResources` 只做「有 policy / mode 一致 / 同节点不既 exclusive 又 shared」 |
| 例 6 unknown→reconcile 属 runtime | 同意。本模块只有 `stateFromDecision('unknown')→unknown` 这一个钩子，无 reconcile/receipt 入口（例 6 的迟到回执归档归属 store/runtime）。**注**：该钩子本身触发 minor-2 |
| `typedEdges` 取「完整新边集」 | 同意，SCHEMAS 描述逐字支持（§1.4） |
| check 1 版本门由 codec 承担 | 同意（`compileGraph` → `decode` + `decodeRuntimeVersion`）。补充信息项：`compileGraph` 接受 `schemaVersion:'1.0.0'`（因冻结 enum 含它、且 GraphSpec 在两版间无字段差异），成码由 protocol lane 决定；`runtime/2` 之类外部 namespace 在 compile 路径落到 `EFK_SCHEMA_INVALID`（`decode` 先于 `decodeRuntimeVersion`），而 `decodeRuntimeVersion` 单独调用给 `EFK_PROTOCOL_UNSUPPORTED` —— 两码都 `never`，但下游若按键控协议不兼容需知此差异（属 protocol lane，非本节点） |

本节点**不主张**：运行期并发/租约/取消确认、崩溃恢复、workspace 实际写盘、`unknown` 的 reconcile 证据、两个宿主的真实执行 —— 均属 `l2_state_store`/`l2_scheduler`/`l2_runtime`/`l2_kernel_verification`。

---

## 5. 修复清单（按优先级）

1. **blocker-1（必修）**：`patch.ts` 的中途锁定补「旧 data 边消失/改型」分支（§3.1 最小修复），并加一条用例（可复用 §3.1 的反例：删边 → 期望 `EFK_GRAPH_ACTIVE_NODE_MUTATION`；leased/running 两态各一）。
2. minor-1：`applyGraphPatch` 入口补 `decode('GraphPatch', patch)`，或在导出文档明确「必须先经 codec decode」。
3. minor-2：请人审在 `SEMANTICS §2.2` / `INTERFACES §4` 与实现之间定案 `TaskDecision='unknown'` 与 `ok===false` 两个映射，并同步文档。
4. minor-3 / minor-4：错误码与覆盖度按 §3.2 处理（改码或改 ERRORS.md 措辞；补 `maxConcurrentAgents`/`maxIterations` 的说明或校验）。
5. nit 1–5 可选。
