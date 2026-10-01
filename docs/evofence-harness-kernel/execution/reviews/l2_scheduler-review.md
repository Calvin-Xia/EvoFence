# l2_scheduler 独立交叉复核（review-1）

日期：2026-10-01 · 复核者：独立 review pane（**新 tab、新 pane，未参与本节点任何写作**）
lane（作者工作区）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\scheduler`（该目录是一个完整 EvoFence worktree，产物在其 `src/kernel/scheduler/`）
复核对象（集成副本，commit `0df8be3`，本 pane 的 cwd）：`src/kernel/scheduler/**`（10 文件 / **1234** 行）+ `test/l2-scheduler-{lease,progress,resources}.test.js` + `test/l2-scheduler-fixtures.mjs`（fixtures 258 行，**22** 命名用例）
基准（本节点契约真相源）：`spec/graph/SEMANTICS.md` §2.3/§2.4/§3.2/§5.1/§5.2/§5.3、`CONTRACTS.md` §5 十条不变量、`spec/contracts/{SCHEMAS.md,INTERFACES.md,OWNERSHIP.md,ERRORS.md}`、`adr_0002`（`graph get-node` 实测列出 governing ADR 即 `adr_0002`）

## 结论：**需修订**（1 blocker / 1 major / 5 minor / 4 nit）

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 1 | **B1** 无资源节点的死 claim 没有任何活性信号：claim 不持有 lease ⇒ `progress` 永远报 `dispatchable`/0 stall，DoD②「不会等待已终止 worker 形成死锁」被构造性证伪（探针 P3） |
| major | 1 | **M1** 过期 claim 无法被本 lane 回收：`applyLeaseReceipt` 依 §5.2 正确拒绝过期回包，但没有任何导出函数能从 `SchedulerState.claims` 删除一条 claim ⇒ 节点永久停留在 `disposition:'claimed'`，且 `dispatchRound` 仍把尸体计入并发上限（探针 P2/P4） |
| minor | 5 | m1 `grantLease` 借用 graph 编译期错误码 `EFK_GRAPH_RESOURCE_CONFLICT`（retry=`never`）表达运行期瞬时容量竞争；m2 `claimNode` 唯一键实为 `nodeId`，与自身注释/CONTRACTS §5.1 的 `(nodeId, attemptOrdinal, epoch)` 不符；m3 `dispatchRound` 的 in-flight 与 `progress` 的 in-flight 是两套口径；m4 同一 nodeId 重复 claim 时 stall 分类依赖数组顺序；m5 join 的 `unknown` 分支被归类为 `waiting-on-live-upstream` |
| nit | 4 | n1 `declarationsOf` 对未知节点 fail-open 成「无资源」；n2 `attempt.error?.message ?? …` 的 `??` 为死代码；n3 `fanin` 的 `facts.branches ?? new Map()` 与 readiness 同型但会把缺少分支实情静默成 waiting；n4 `advanceFairness` 对已结算节点永久累积计数 |

**逐条核对通过**：plan 六项（frontier / claim+fence / 深度-并发上限 / 资源锁 / 完整 fan-in / 唯一 writer 串行）各自有单一实现入口且大部分有可失败用例；DoD① 的两半（同一资源无两个有效 writer、过期回包 state 恒等）**由我独立负控变红**且恒等是 `Object.is` 级（探针 P1）；cp1/cp2/cp3 与三个测试文件一一对应；无 ambient 读取、无自造第二套 lease/claim/错误码真相源；lane 与集成副本 **10/10 文件 sha256 全等**；收工时 `git status` 对 `src/`、`test/l2-scheduler-*` 为空。

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份比对**：`src/kernel/scheduler/{types,lease,dispatch,progress,claim,frontier,index,resources,fairness,fanin}.ts` 逐文件 lane ⇔ 集成副本，**10/10 全等**（收工时复核仍 10/10）。集成副本源码我全程未改，负控只在 `dist/`（gitignored）上做并 rebuild 复原。
2. **门禁实测**：`npm run build` → 0；`node --test test/l2-scheduler-*.test.js`；另跑 `npm run src:policy`（0，最大文件 350 行内；scheduler 最大 246 行）与 `npm run dep:check`（625 edges / 0 cycle / acyclic）。按复核指令**未跑全量 `npm test`**。
3. **自建 negative control（3 组，见 §2.2）**：变异 → 记录变红用例名 → 复原 → 复绿。
4. **我方探针（P1–P7）**：`node` 脚本直接 import 集成副本 `dist/`，独立于作者套件，覆盖作者用例没有直接命中的边界（皆为一次性文件，运行后已删）。每条探针都失败即失败，不做 `try/catch` 吞错。
5. ambient/确定性、防御性编程判据以 `grep` + 通读源码核对，不依赖测试。

### 0.1 用例计数的一处口径差异（非缺陷，记录以免误读）

复核指令写的 `node --test test/l2-scheduler-*.test.js` **实测为 22 项**（fixture 是 `.mjs`，不匹配 `*.test.js`）；用 fixture 一并命中的 `node --test test/l2-scheduler-*` 才是 **23 项**（22 命名 + 1 fixture 文件）。作者自报的「22 例」正确；「23 项」只有用后者口径才成立。两种口径均 0 fail。

---

## 1. 契约逐条核对

### 1.1 plan（6 项行为 → 单一实现入口 → 可证伪用例）

| plan 项 | 实现（唯一入口） | 用例（实测命中） | 判定 |
|---|---|---|---|
| ready frontier | `computeFrontier`（readiness 完全外委 `evaluateReadiness`，本 lane 只加 claim/状态投影） | `cp1 frontier — the concurrency and depth caps…`、`cp3 completion…` | ✅ |
| claims / fence-epoch | `claimNode`（revision → 唯一键）+ `applyLeaseReceipt`（live + attempt/epoch 精确匹配）+ 单调 `nextFencingToken` | `cp1 claim — the CAS gate…`、`cp1 lease — expired receipt…`、`superseded fencing token…` | ✅（唯一键口径见 m2） |
| 子图深度 / 并发限制 | `preGates`（`concurrency-limit` / `depth-limit`，`depth >= maxDepth`） | `cp1 frontier — concurrency and depth caps` | ✅ |
| 资源锁（唯一 writer） | `grantLease` 的 live-holder 容量 + `resourceConflicts` 的 mode 冲突（两件事分开判） | `cp1 lease — at most one live writer`、`cp2 — shared quota`、`cp2 — old policy mode blocks new writer` | ✅ |
| 完整 fan-in | `joinGate`（`evaluateJoin` 单一入口，`missing` 不过滤；failed+cancelled 都保留） | `cp3 fan-in — … no branch is filtered`、`cp3 cancel — cancelled branch keeps its slot` | ✅ |
| 唯一 writer 串行提交 / 可解释 decision | `dispatchRound`：固定次序 并发→深度→读写冲突→容量→预算→claim；`DispatchDecision.reasons` 逐条带 detail | `cp2 budget — two concurrent dispatches hold two reservations…`、`capped pool defers…` | ✅ |

### 1.2 DoD① 「同一资源不存在两个有效 writer；过期 lease 回包不改状态」

- 唯一 writer：`grantLease` 以 `liveGrants(table, now).filter(resourceId).length >= maxHolders` 拒绝；**NC1（`>=`→`>`）让「at most one live writer」等 4 例变红**，直接证明该断言不是同义反复。
- 过期回包不改状态：`applyLeaseReceipt` 的 stale 分支返回**传入的同一 state 值**。作者用 `assert.equal`（`node:assert/strict` ⇒ `===`）断言；我方探针 P1 进一步验证 `Object.is(late.state,state) && Object.is(state.leases) && Object.is(state.claims) && Object.is(state.leases.grants)` **全为 true**，且 `revision`/`claims.length`/`liveGrants` 不变、输入对象无任何字段被写。**NC2（把 `liveGrants(...).find` 换成 `state.leases.grants.find`，即删掉 liveness 过滤）精确只让该用例变红**（1 fail / 6 pass）。
- 判定：✅。

### 1.3 DoD② 「失败/取消分支不被遗漏；不会等待已终止 worker 形成死锁」

- 分支不遗漏：`joinGate.missing` 保留 `failed`+`cancelled`，`branchReport` 不过滤（`cp3 fan-in` 用 `assert.deepEqual` 逐分支核对）。**NC3（把 `classify` 的 `hard` 恒置 `[]`）精确让 `cp3 deadlock — uncovered upstream` 变红**。
- 死锁：leased 场景成立——`progress` 对「claim 无 live lease」报 `lease-expired` 且不计 in-flight（`cp3 deadlock — expired lease…`）；但 **claim 不持任何 lease 时（节点无资源声明）无任何信号**（B1），**过期 claim 无法回收**（M1）。DoD② 第二半**部分未达成**。
- 判定：⚠️（见 B1 / M1）。

### 1.4 cp1 / cp2 / cp3

cp1（`l2-scheduler-lease.test.js`，7 例）、cp2（`l2-scheduler-resources.test.js`，6 例）、cp3（`l2-scheduler-progress.test.js`，9 例）与三个 checkpoint 一一对应；每例的 plan 项/DoD 项在 §1.1–1.3 有落点。

---

## 2. 实测证据

### 2.1 门禁与用例

```
npm run build            → exit 0
node --test test/l2-scheduler-*  → tests 23 / pass 23 / fail 0   （两次运行一致）
node --test test/l2-scheduler-*.test.js → tests 22 / pass 22 / fail 0
npm run src:policy       → 0（scheduler 最大文件 246 行）
npm run dep:check        → edges 625 / cycles 0 / acyclic true
```

### 2.2 独立 negative control（3 组，均在 `dist/` 变异 → 变红 → 复原）

| # | 变异 | 精确变红用例 | 复原核验 |
|---|---|---|---|
| NC1 | `lease.js`：`holders.length >= maxHolders` → `>` | `cp1 lease — an exclusive resource has at most one live writer`（另 +3 例，共 4 fail / 3 pass） | `grep '>='` 命中已复原；rebuild 后 23/23 复绿 |
| NC2 | `lease.js`：`applyLeaseReceipt` 的 `liveGrants(state.leases,now).find` → `state.leases.grants.find`（删 liveness 过滤） | **恰好 1 例**：`cp1 lease — an expired receipt changes nothing` | `const live = liveGrants(state.leases, now).find` 已复原 |
| NC3 | `progress.js`：`classify` 的 `hard` → `[]`（删「无 cover 则 hard」） | **恰好 1 例**：`cp3 deadlock — a wait on a terminated, uncovered upstream is reported, not hidden` | `const hard = gone.filter(...)` 已复原 |

三组均为「精确变红」而非连带塌方，说明对应断言确实在测该实现细节。

### 2.3 我方探针（P1–P7，全 pass = 均实现了所断言的既有行为；P3/P4/P7 同时暴露缺口）

- **P1** 过期回包的恒等是 `Object.is` 级（state / leases / claims / grants 四层），且无输入侧写入。✅
- **P2** 同 nodeId、`attemptOrdinal=2` 的新 attempt：`dispatchRound` 不派发（节点的 claim 尚在 ⇒ `disposition:'claimed'`）、`progress` 报 `lease-expired`/`stalled`、`claimNode` 报 `EFK_CLAIM_CONFLICT`；对已过期 claim 再发同回包仍 `stale`。**本 lane 无任何导出函数能清掉该 claim**。✅（暴露 M1）
- **P3** 无资源节点（`declarationsOf` 为空 ⇒ `granted: []`）claim 后 worker 消失：`progress` 在 `now=10_000_000` 仍 `status='dispatchable'`、`stalls.length===0`。✅（暴露 B1）
- **P4** 有 lease 的过期 claim：`dispatchRound` 仍把它们计入 `inFlight=state.claims.length`，新节点 `nC` 被 `concurrency-limit` 挡下；同 round 的 `progress` 却因两 claim 均过期把它们排除出 in-flight（`stalls` 里 2 条 `lease-expired`）。两函数口径相左。✅（暴露 M1/m3）
- **P5** 同输入两次 `dispatchRound` 的 `JSON.stringify(decisions/fairness/claims)` 逐字节相同；`orderFrontier` 对同输入稳定且不改动入参数组。✅
- **P6** 多资源全有或全无：`resA` 可授、`resB` 被占 ⇒ `defer writer-held`，`Object.is(round.state.leases, input.leases)` 为 true、无部分 lease 残留、无 claim。✅
- **P7** 同 nodeId 双 claim（经公开 `recordClaim` 注入）：`[a1(过期), a2]` → `lease-expired`/`stalled`；`[a2, a1]` → `stalls=0`/`dispatchable`。**同实情、异顺序、异结论**。✅（暴露 m4）

### 2.4 ambient / 确定性 / 错误码冻结（复核指令第 4 项）

- `grep -nE "Date|Math\.random|require\(|process\.|console\.|setTimeout|globalThis|import\(" src/kernel/scheduler/*.ts` → **无命中**；无顶层语句（无顶层调用/副作用）；`now`、`leaseTtlMs`、`bindingFor`、`budget`、`facts`、`state` 全部参数注入。过期是 `expiresAt > now` 的过滤，不产生 mutation。✅
- 无 `try/catch`（`grep` 仅命中注释/标识符）。✅
- 本 lane 使用的 5 个码 `EFK_REVISION_CONFLICT / EFK_CLAIM_CONFLICT / EFK_RECEIPT_STALE / EFK_GRAPH_RESOURCE_CONFLICT / EFK_CANCEL_UNCONFIRMED` 经 `dist/protocol/errors.js` 的 `ERROR_CODES` 运行时比对，**全部 ∈ 冻结 58 码**。✅（码的**语义**问题见 m1）

### 2.5 防御性编程禁令边界（复核指令第 5 项）

- 属豁免/正当：`computeFrontier` 对 `facts.states.get(...) ?? null`（缺席=从未上报，是**语义**不是吞错）；`fairness` 的 `?? 0`（record 默认）；`applyLeaseReceipt` 的 stale 归档（**契约要求的显式门禁**）；schema/图校验拒绝（不属本 lane）。
- 需指出的其余守卫：
  - **n1** `declarationsOf`：`if (node === undefined) return []` 把「未知节点」静默降级成「无资源需求」——fail-open；且 `graph.resourcePolicy.get(resourceId)!` 用非空断言压过编译器校验，一旦编译前置被绕过会 TypeError 而非结构化拒绝。当前 `dispatchRound` 只遍历 `graph.spec.nodes`，不可达，但函数已公开导出。
  - **n2** `dispatch.ts:115 attempt.error?.message ?? declaration.resourceId`：`grant===null` 时 `error` 构造上必非 null，`??` 为死分支（无害，但属双保险痕迹）。
  - **n3** `fanin.ts facts.branches ?? new Map()` 与 `readiness.ts:51` 同型，一致性可取；但调用方漏传 branch facts 会被静默解释成「全部分支缺失⇒waiting」，而非暴露调用错误。
  - **n4** `advanceFairness` 只增不删（含已结算节点），长 session 计数无界增长（内存 nit）。

---

## 3. 发现（分级 + 最小复现）

### blocker

**B1 — 无资源节点上的死 claim 完全不可见，`progress` 永久报 `dispatchable`（直接违反 DoD②）**
- 事实：`dispatchRound` 对 `declarations` 为空的节点照常建 claim 与预算预留（`grantAll` 返回 `granted: []`，无 lease）。`progress.hasExpiredLease` 在 `owned.length === 0` 时 `return false`；`stateStall` 对 `claimed` 无分支 ⇒ 该节点既非 stall 也非 expired，`inFlight` 恒真。
- 复现（P3，`plainSpec`，cap 3）：round1 派发 3 个无资源节点；worker 全部消失（无 journal 状态、无 lease）；`now=10_000_000` 再跑 `progress` ⇒ `status='dispatchable'`、`stalls=0`。**图会永远认为「有活在跑」。**
- 影响：`SEMANTICS §5.2`/DoD② 明确禁止「等待已终止 worker」。lease 是本 lane 唯一的尸体探测器，而一个合法 attempt 可以持有零 lease。
- 修复方向（择一）：(a) 每个 attempt 至少持有一条 session 级 lease（或合成 lease），使「无 lease 的 claim」成为不可能；(b) 给 `claimed` 且**从未持 lease** 的 claim 加 `claimedAt + ttl` 的独立过期判据，`progress` 归入 `lease-expired`/`reconcile-required`。

### major

**M1 — 过期 claim 无法回收：节点永久不可重派，且尸体继续占用并发上限**
- 事实：`SchedulerState.claims` 的**唯一删除点**是 `applyLeaseReceipt` 的 applied 分支；它要求 lease **仍 live** 且 attempt/epoch 精确匹配。过期 lease 的回包按 §5.2 **必须** stale（这是正确行为），于是 `applyLeaseReceipt` 永远无法清掉过期 claim。`releaseClaimLeases`/`releaseUnderLease` 只改 `LeaseTable`，不碰 `claims`；`recordClaim` 只追加。全仓 grep 无 `reclaim` 类导出。
- 复现（P2/P4）：`soloWriterSpec` round1（now=1000, ttl=100）后，在 now=2000/10^7：`dispatchRound` 对该节点 0 decision（`disposition:'claimed'`，永不 dispatchable）；`claimNode` 对 `attemptOrdinal=2` 报 `EFK_CLAIM_CONFLICT`；`progress` 只是**报告** `lease-expired`。P4 另证：3 个 scope 各有过期 claim 时，新节点 `nC` 被 `concurrency-limit` 挡下，而同 round `progress` 认为 in-flight 为 0。
- 影响：DoD② 只做到「surface 不静默等待」，未做到「不再死锁」——调用方拿到 `stalled` 后**没有可用出口**让该节点回到 `ready`。若回收被有意委托给 `l2_state_store`/`l2_runtime`，则该边界既未在接口文档声明，也无任何测试固定。
- 修复方向：导出显式回收转移（如 `reclaimExpired(state, now)`：删除 `leases` 全过期且 attempt 非当前的 claim），或明确把「清 claim」写进 store CAS 的合同并补一条跨 lane 用例。**建议在合入下游前解决。**

### minor

- **m1** `grantLease` 容量拒绝用 `EFK_GRAPH_RESOURCE_CONFLICT`。`ERRORS.md` 定义它是「新图试图制造并存排他 owner」的**编译期**错误，retry=`never`；运行期瞬时竞争按 §3.2 本就不算错误（「留在 ready 并重排」）。`dispatchRound` 把它折进 `defer` 故未外泄为失败，但 `grantLease` 已公开导出，其 `retry` 语义会误导调用方永久放弃。建议改为非错误的容量结果，或改用即时可重试的码。
- **m2** `claimNode` 唯一键实为 `nodeId`（`findClaim(claims, binding.nodeId)`），而模块头注释与 `CONTRACTS §5.1` 的键是 `(sessionId, nodeId, attemptOrdinal, epoch)`。后果：一个合法的**新 attempt**（bumped ordinal）在旧 claim 存活期内被拒 `EFK_CLAIM_CONFLICT`（P2）。与 M1 叠加后该节点没有任何通向新 attempt 的路径。若「同节点同时只允许一个 attempt」是刻意收紧，应改注释并在合同里写明。
- **m3** in-flight 双口径：`dispatchRound.inFlight = state.claims.length`（含过期 claim、含已 settled/出图节点），`progress` 用 lease-aware 的 `claimed/active && !expired`。两者在同 round 可给出相反结论（P4）。建议抽一个共享谓词（如 `liveAttemptClaims(state, now)`）供两端使用。
- **m4** 同一 nodeId 的重复 claim 使 `findClaim` 取首条，`progress` 只看首条 ⇒ 分类依赖数组顺序（P7：`[a1,a2]`=stalled vs `[a2,a1]`=dispatchable）。该状态可经公开且**无唯一键校验**的 `recordClaim` 注入。建议 `recordClaim` 断言 key 唯一，或让 `progress` 汇总同 nodeId 全部 claim。
- **m5** `classify` 只把 `failed/cancelled` 当 terminated，故 join 的一个 `unknown` 分支被报成 `waiting-on-live-upstream`（blockedBy=[]），而该分支自身在 `stateStall` 报 `reconcile-required`。同一 graph 两个节点对同一事实给出不一致的等待性质。建议 `unknown` 在 join 侧也归入 reconcile 语义。

### nit

- **n1** `declarationsOf` 未知节点 fail-open 成 `[]`；`resourcePolicy.get(...)!` 非空断言。
- **n2** `dispatch.ts` 的 `attempt.error?.message ?? declaration.resourceId` 为死分支。
- **n3** `fanin.ts` 的 `facts.branches ?? new Map()` 会把「漏传 branch facts」静默成 waiting。
- **n4** `advanceFairness` 对已结算节点永久累积 `deferStreak`/`dispatches`。

---

## 4. 未证明 / 边界声明

1. 本 lane **无任何下游消费者**（`grep "kernel/scheduler" src/ --include=*.ts` 无命中），故「恢复/回收由谁负责」目前无实现可查。B1/M1 的严重度按「当前已合入代码能否独立满足 DoD②」评估；若下游补上回收，仍须把该边界写入合同并加跨 lane 用例。
2. 未跑全量 `npm test`（复核指令指定），也未跑 `test:e2e`；本结论只覆盖 `src/kernel/scheduler/**` 与三个测试文件。
3. 时间/宿主侧的真实崩溃路径（进程被 kill、journal 无记录）未在本 lane 内制造，P2–P4 用「注入过期 lease / 缺失 lease 的 state」建模，属于该 lane 可表达的等价状态。
