# l2_scheduler 修复复验（review-fix-verify）

日期：2026-10-02
复核者：独立复验 pane（新 pane / 新会话，**未参与本节点任何写作**；session `01a0f833-b35c-75f1-b513-12ead74dbb99`，model `deepseek-flash`）
集成基线（修复前）：`0df8be30cc0051d5aef5d09123f7000ea106a28c`
复核对象（集成修复提交）：`8db17188e463478b9382c4232e7a7541aa9b36cd`
lane（作者工作区）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\scheduler` @ `12ed81b34808c129594d90a1bd6e6798752c791d`
复核范围：`src/kernel/scheduler/**`（13 文件，含新 `activity.ts` / `REVIEW-EVIDENCE.md` / `review-evidence.json`）+ `test/l2-scheduler-*`（5 文件）

## 结论：**接受**（0 blocker / 0 major / 0 minor；3 条保留意见 + 1 条 nit 级弱验证）

首轮 1 blocker（B1）、1 major（M1）、5 minor（m1–m5）、4 nit（n1–n4）**全部有对应修复且被我独立复现**；新增/更新的 16 个定向用例逐条命中；4 组独立负控均「精确变红 → 复原复绿」；lane ⇔ 集成 18/18 文件 sha256 全等。无新发现缺陷。

---

## 1. 门禁实测（不采信作者自报）

| 命令 | 结果 |
|---|---|
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run src:policy` | 0：180 TS / 0 JS，最大 350 行（`src/lib/pi-tool-strategy.ts`，恰在限内）；scheduler 最大 248 行（`dispatch.ts`） |
| `npm run dep:check` | 0：180 modules / **636 edges** / 0 cycles / acyclic true |
| `node --test test/l2-scheduler-*` | **39 tests / 39 pass / 0 fail**（38 命名 + 1 fixture 文件） |
| `node --test test/l2-scheduler-*.test.js` | **38 tests / 38 pass / 0 fail** |

首轮口径（23/22）→ 本轮（39/38）：新增 `test/l2-scheduler-review.test.js` 16 例；原有 cp1/cp2/cp3 22 例未删，仅 `l2-scheduler-lease.test.js` 容量断言由 `EFK_GRAPH_RESOURCE_CONFLICT` 改为 `verdict==='capacity' / error===null`（与 m1 修复一致）。未跑全量 `npm test` / `test:e2e`（按简报）。

源码洁净度（`grep`，非测试）：`src/kernel/scheduler/*.ts` 无 `Date`/`Math.random`/`require(`/`process.`/`console.`/`setTimeout`/`globalThis`/动态 `import(`，无 `try/catch`；`EFK_GRAPH_RESOURCE_CONFLICT` 已**不在**任何 `.ts` 源码（仅残留在证据 JSON 文本中）。

---

## 2. 逐条判定 + 实测证据

| # | 判定 | 实测证据 |
|---|---|---|
| **B1** | ✅ 已修复 | 新 `activity.ts::classifyClaim` 以 `ownerClaimId + epoch + expiresAt > now` 判活，把「有 claim 无匹配 live lease」显式分为 `claim-without-lease`（从未持 lease）与 `lease-expired`（曾持已失效）；`progress` 给每条非活 claim 单独 stall，`blockedBy=[nodeId]`，且 `inFlight=liveAttemptClaims(...)` 不再把死 claim 当活性证据。探针 P3（3 个无资源节点、worker 消失、`now=1000` 与 `10_000_000`）：`status='stalled'`、`stalls.length===3`、reason 全 `claim-without-lease`、detail 命中 `/no live lease/`。用例：`B1 — resource-free claims without live leases are explicit stalls`、`B1 — a lease from another epoch is not a claim liveness signal`。 |
| **M1** | ✅ 已修复 | 新导出 `reclaimExpiredClaims(state, now): ReclaimTransition{verdict,state,reclaimed,retained}`；只回收 `classifyClaim !== 'live'` 的 claim，no-op 返回**同一 state 值**，有效回收 `revision+1` 且 `leases` 保持同一对象。探针 P2：死 claim → `stalled/lease-expired`；回收后 `claims` 清空、`Object.is(reclaimed.state.leases, input.leases)===true`、`reclaimExpiredClaims(rec.state, now).state === rec.state`；同节点新 attempt（ordinal 2）经 `dispatchRound` 被派发；旧回包仍 `stale` 且 `state` 恒等。探针 P4：两条过期 claim 下 `nC` 被 `dispatchRound` 放行。用例：`M1 — reclaim preserves any matching live lease and the identical state`、`M1 — reclaim expires dead claims, preserves lease history and enables a new attempt`、`M1 — reclaim also retires claims that never held a lease`、`M1 m3 — dead claims release concurrency before explicit reclamation`。 |
| **m1** | ✅ 已修复 | `LeaseTransition` 改为带判别式的业务结果：`{verdict:'capacity', grant:null, error:null, detail}`，`table` 原值返回；`grantAll` 折成 `writer-held`/`quota-full`。探针：容量拒绝 `error===null`、`Object.is(blocked.table, held.table)`，`now` 越过 TTL 后同一请求 `granted`。用例：`m1 — runtime capacity contention is a typed non-error and expires normally`。 |
| **m2** | ✅ 已修复（改代码） | `claimNode` 唯一键改为 `sameAttempt`（`sessionId ∧ nodeId ∧ attemptOrdinal ∧ epoch`）；不同 tuple（ordinal/epoch/session 任一）可新建，同 tuple 即使 `attemptId` 不同仍 `EFK_CLAIM_CONFLICT` 且 state 恒等。探针独立确认。用例：`m2 — claim uniqueness is the session node ordinal epoch tuple`。注释/CONTRACTS §5.1 口径现已一致。 |
| **m3** | ✅ 已修复 | 两端共用 `liveAttemptClaims(frontier, state, now)`；`dispatchRound` 另加 `pendingUnleased` 仅约束**本轮的**无 lease 派发槽位（跨轮不构成活性）。探针 P4：TTL 内 `nC` 因 `concurrency-limit` 被拦且 `progress='dispatchable'`；TTL 后 `dispatchRound` 放行 `nC`，`progress` 同为 `dispatchable` 并把 `nA/nB` 报 `lease-expired`。用例：`M1 m3 …`、`m3 — settled and removed claims consume no concurrency`、`m3 — an active journal state without a live claim requires reconciliation`。 |
| **m4** | ✅ 已修复 | `findClaim`/`progress` 均经 `compareClaims` 做**固定键排序**（session/node/ordinal/epoch/attemptId/claimId/claimedAt/binding），`progress` 逐节点汇总**全部** claim 而非只看首条。探针 P7：同 nodeId 两 claim，`[a1,a2]` 与 `[a2,a1]` 在 `now=1150`（dispatchable/1 stall）与 `now=1200`（stalled/2 stalls）产出 `deepEqual` 完全一致。用例：`m4 — multiple claims classify identically in either array order`。 |
| **m5** | ✅ 已修复 | `classify` 新增 `uncertain`（`states.get(nodeId)==='unknown'`）分支，优先报 `reconcile-required`，`blockedBy` 保留 branch id；与 `stateStall` 的 reconcile 语义一致。探针：`nB` 为 `unknown` 且 branch facts 为 `unknown` → `reconcile-required` + `blockedBy ['nB']`（即使 nodeState 写成 `succeeded` 也一致）。用例：`m5 — an unknown join branch requires reconciliation using branch evidence`。 |
| **n1** | ✅ 已修复 | `declarationsOf` 未知节点 `throw EFK_GRAPH_REFERENCE_INVALID`，编译图缺 policy `throw EFK_INVARIANT_VIOLATION`，非空断言删除。探针与用例均命中。用例：`n1 — unknown resource nodes and missing policies fail closed`。 |
| **n2** | ✅ 已修复（形状级） | `??` 死分支删除，`grantAll` 直接消费 `attempt.detail`。用例 `n2 — capacity diagnostics have no unreachable fallback` 同时断言源码形状与运行期 detail（`/maxHolders is 1/`）。见 §4 保留意见 3。 |
| **n3** | ✅ 已修复 | `joinGate` 对 `facts.branches === undefined` 抛 `EFK_INVARIANT_VIOLATION`；`computeFrontier` 对未结算 `join` 节点调用该入口做显式校验；显式空 map 仍是诚实 gap（`waiting`，missing 全列）。探针与用例均命中。用例：`n3 — missing branch facts are rejected while an explicit empty map is a gap`。 |
| **n4** | ✅ 已修复 | `advanceFairness(fairness, dispatched, deferred, frontierIds)` 用 `keep = new Set(frontierIds)` 剪掉已出 frontier 的计数，保留等待者；不改输入对象。探针与用例均命中，且 `dispatchRound` 传的是本轮 frontier id 列表。用例：`n4 — fairness prunes settled nodes and retains outstanding waiters`。 |

**加法**：`types.ts` 新增 `StallReason` 的 `'claim-without-lease'`；`frontier.ts` 调整 disposition——claim 存在但 journal 已进入 `active` 时不再压成 `claimed`（保留 `active`，让 `stateStall` 的 reconcile 分支可达）。两处与 B1/m3 修复一致，无额外副作用。

---

## 3. 独立探针与负控

### 3.1 自建探针（`node` 直接 import 本次 build 的 `dist/`，独立于作者套件；无 `try/catch` 吞错；文件在系统临时目录，跑后已删）

| 探针 | 覆盖 | 结果 |
|---|---|---|
| P3 复刻 | 无资源节点 ×3、worker 消失、`now ∈ {1000, 1e7}` | `stalled` / 3× `claim-without-lease` / `blockedBy=[self]` |
| P2 复刻 | 单 writer 过期 claim → 阻塞、`claimNode` 新 ordinal 语义、回收、重派、旧回包 | 全 pass（含 `Object.is` 级 lease 恒等、回收幂等） |
| **活 lease 回收反例** | `now<TTL` 回收入口 | `verdict='unchanged'` + `Object.is(state)`；边界 `now===expiresAt` 判死；混合态只回收死 claim、留活 claim、`leases` 同一对象 |
| P4 复刻 | 3 scope、2 条过期 claim、cap 2 | `dispatchRound` 放行 `nC`；`progress` 同为 `dispatchable` + 2× `lease-expired`（两端口径一致） |
| P7 复刻 | 同 nodeId 双 claim，反序输入 | `now=1150` 与 `1200` 两次 `deepEqual` 完全一致 |
| m1/m2/m5/n1/n3/n4 抽检 | typed capacity、tuple 唯一键、unknown join、fail-closed、branch facts、fairness 剪枝 | 全 pass |

> P2 的一处首轮观察已按修复后的**正确语义**更新：`claimNode` 对 `attemptOrdinal=2` 现返回 `error===null`（m2 修复：bumped ordinal 是新 attempt，不是冲突）；同 tuple 仍 `EFK_CLAIM_CONFLICT`。节点仍不可被 `dispatchRound` 重派（frontier `claimed`），故「唯一 writer」不受影响。

### 3.2 独立负控（变异 `dist/`（gitignored）→ 变红 → 复原 → 复绿）

| NC | 变异点（dist 编译产物） | 变红用例（`--test-reporter=tap`） | 复原核验 |
|---|---|---|---|
| NC-B1 | `progress.js`：跳过 `claim-without-lease` stall + `inFlight` 回退为 `state.claims.length > 0`（即首轮 B1 语义） | not ok 1 `B1 — resource-free claims without live leases are explicit stalls`；not ok 2 `B1 — a lease from another epoch…`；not ok 6 `M1 m3 — dead claims release concurrency…`；not ok 11 `m4 — multiple claims classify identically…`（12/16 pass） | 备份复原 → **16/16 pass** |
| NC-M1a | `activity.js`：`reclaimExpiredClaims` 的回收过滤器改成恒 `false`（回收路径消失，≈首轮 M1） | not ok 3/4/5 三条 `M1 — …`（13/16 pass） | 复原 → **16/16 pass** |
| NC-M1b | `activity.js`：过滤器改成恒 `true`（连活 lease 的 claim 一起回收，违反「绝不回收活 lease」） | **恰好** not ok 3 `M1 — reclaim preserves any matching live lease and the identical state` | 复原 → **16/16 pass** |
| NC-m4 | `claim.js`：`compareClaims` 改 `return 0`（去掉确定性排序，≈首轮数组顺序依赖） | **恰好** not ok 11 `m4 — multiple claims classify identically in either array order` | 复原 → **16/16 pass** |

复原后额外做了 `cp -r dist /tmp/…; npm run build; diff -rq dist /tmp/…` → **无差异**（dist 与全新 build 逐字节一致，确认未把变异带入后续结论）。

---

## 4. sha256 双份比对（lane ⇔ 集成）

| 文件 | sha256 | 一致 |
|---|---|---|
| `src/kernel/scheduler/activity.ts` | `0870caf8c92bc53b4b8c7dac2e4092f24880d2fb2f30411bccf6c6d13c05fd67` | ✅ |
| `src/kernel/scheduler/claim.ts` | `00cc18e0af1a6f51d8b03fdadfd896c172b46a193f11438d997fcae1e9ce158e` | ✅ |
| `src/kernel/scheduler/dispatch.ts` | `ebcb27dc5301d7b4de79096ab2cf89d65185122382738abfb8769cc115f1fa2d` | ✅ |
| `src/kernel/scheduler/fairness.ts` | `6a1efa46e85a74ff9cabe44ad4f0c8a9f9b2d826d4b831809261b07b3ff570c2` | ✅ |
| `src/kernel/scheduler/fanin.ts` | `7a81871c90a5f186d030cdcee0966e79310eca8b7211539fe13a1b7ae38bb181` | ✅ |
| `src/kernel/scheduler/frontier.ts` | `5b3d54baae746babb71c2bff0031140ad70ca3d28787099543667df3038050df` | ✅ |
| `src/kernel/scheduler/index.ts` | `fc8af9c2621a1e392f583afcab49d71795b0feca5d587549461ee15a288eac4b` | ✅ |
| `src/kernel/scheduler/lease.ts` | `77257204804948f26f4bb0d3f25ba465c4c4c53d135c69f24288d9c3614071a1` | ✅ |
| `src/kernel/scheduler/progress.ts` | `2d78ccd75a5019f4cc0dbd74efd83bc9a6661ba576ae490b5e424108a2ba559e` | ✅ |
| `src/kernel/scheduler/resources.ts` | `dd9457811b09b11b6b5876cfc0ff356bb5ecbe95ff6607197ceb31f99740b187` | ✅ |
| `src/kernel/scheduler/types.ts` | `71cc04d0904c664003b700c7bec37c6bf75a17ebc46ed8acb62b8b4d092b6d6a` | ✅ |
| `src/kernel/scheduler/REVIEW-EVIDENCE.md` | `c404c2f50791fc7653b7ad87fc5799be6b2c1f9cfde45c358f2af3e2cd76a6f6` | ✅ |
| `src/kernel/scheduler/review-evidence.json` | `ba093e89e27364f4e7a405005cb1b19b029bed21369d8deddc4f50b373178b03` | ✅ |
| `test/l2-scheduler-fixtures.mjs` | `0155f218348bc4e42290bb98c6f346cdc35036e1fa634d969f4d27b059532248` | ✅ |
| `test/l2-scheduler-lease.test.js` | `310e6e67bcfb63ed40c56de162efd63506731de791b08ff7f5ff9a1c60ea5f9f` | ✅ |
| `test/l2-scheduler-progress.test.js` | `2e9b7918b588a066ded55e311341c13145df4c7d0bce45c9bf785b4e73dfa94a` | ✅ |
| `test/l2-scheduler-resources.test.js` | `d35fa3639216f33e3d194f5007e8334ee7b3600f0e3b36c8e2c9a483b3299e14` | ✅ |
| `test/l2-scheduler-review.test.js` | `2e72dec080a7e395930589214d6726a5e70fd60147790a71f2b2222d74c9d31e` | ✅ |

18/18 全等；lane 目录无集成副本缺失的额外文件（两侧均 13 src + 5 test）。作者自报「src 改动 +154/−59 行」经 `git diff --numstat` 复算**完全一致**（52+20+9+5+5+6+2+11+36+6+2 / 4+7+1+1+1+0+11+31+2+1）。

---

## 5. 未证明项与保留意见

1. **无下游消费者（沿用首轮结论）**：`grep -rn "kernel/scheduler" src/ --include=*.ts` 在 lane 外**无命中**；`reclaimExpiredClaims` 仅被 lane 自身与测试引用。API 已导出且语义清晰，但「谁在何时调用回收」的边界**未写入** `spec/contracts/**` 或 `spec/graph/**`（grep 无 `reclaim`/回收 命中），也无跨 lane 用例。这是首轮 M1「修复方向」里的合同声明项，**不属于本轮 M1 验收标准**（验收标准是导出路径 + 不回收活 lease + typed 结果 + 并发额度释放，均已满足），故不改变「接受」结论，但建议下游接入时补一条跨 lane 用例与合同文字。
2. **同 nodeId 多 claim 的既有语义**：m2 修复后 `claimNode` 允许「旧（死）claim 仍在 + 新 ordinal 新 claim」并存，`reclaimExpiredClaims` 也可在「ownerClaimId 相同但 epoch 不匹配、该 lease 仍 live」时回收该 claim（实测：`classifyClaim='claim-without-lease'` → `reclaimed ['nW1-a1']`，lease 表仍留 1 条 live grant）。这是 `activity.ts` 注释「owner identity alone is insufficient」的**刻意口径**，且 `dispatchRound` 的 frontier `claimed` 门禁保证不会有第二个 writer 被派发；仅是提醒：回收**不释放**该 live grant 也不核对未知 usage（代码已自述），调用方需自行 reconcile。
3. **n2 的负控是形状级**：其用例用源码正则断言「无不可达 `??`」，运行期只旁证 `detail` 文案。作者在 `REVIEW-EVIDENCE.md` 已如实标注「非运行期触发不可达分支」。判定为已修复，但相对其余 3 组纯运行期负控，它的证明强度较弱。
4. **证据文件的门禁数字是 lane 本地快照**：`REVIEW-EVIDENCE.md` 记「172 TS / 605 edges / lane HEAD 12ed81b」，集成 HEAD 实测为「180 TS / 636 edges / 8db1718」——差值是集成同时并入的其它 lane（artifact 等），**非**本 lane 不一致；18/18 sha256 全等已排除内容漂移。另：lane worktree 的 `src/kernel/scheduler/`、`test/l2-scheduler-*` 在 lane 侧呈 `??`（未 commit 的未跟踪文件，与作者「本轮没有 commit」自述一致），内容仍与集成 commit 逐字相同。
5. **未跑全量 `npm test` / `test:e2e`**（简报指定）；本结论只覆盖 `src/kernel/scheduler/**` 与 `test/l2-scheduler-*`。
6. 时间/宿主侧真实崩溃（进程被 kill、journal 无记录）仍以注入状态建模，属本 lane 可表达的等价状态；`reclaimExpiredClaims` 需要调用方 store CAS 才能落盘（代码注释已声明）。

---

## 6. 收工一致性

- lane ⇔ 集成：**18/18 文件 sha256 全等**（§4）。
- 我方变异只发生在 gitignored `dist/`（`git check-ignore` 确认 `.gitignore:10 dist/`），且已全部复原并用 `npm run build` 复核与全新 build 逐字节一致。
- `git status --porcelain -- src test` → **空**；`git diff --stat -- src test` → **空**。
- 未写 `.graph`、未 commit、未改 lane、未跑全量 `npm test`；本 dossier 是本会话在仓库内唯一写入的文件。
- 复核期间两次门禁复跑均为 39/39 与 38/38，独立探针两次全 pass。
