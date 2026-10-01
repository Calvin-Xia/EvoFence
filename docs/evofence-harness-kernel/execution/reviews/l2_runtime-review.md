# l2_runtime 独立交叉复核（review-1）

日期：2026-10-02 · 复核者：独立 review pane（**新 tab、新 pane，未参与本节点任何写作**）
复核对象（集成副本，本 pane cwd）：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence` 的 commit **`90e589fbf3b0522f5e5fc84d1cc650f6def78d7a`**（相对基线 `0df8be3`）
- `src/runtime/session/**`：10 文件 / **933** 行（`types 124`、`service 159`、`project 125`、`dispatch 81`、`plans 98`、`receipts 111`、`controls 104`、`evaluation 76`、`journal 50`、`index 5`）
- `test/l2-runtime-{lifecycle,recovery,controls,support}.test.js`：4 文件 / **547** 行；**31 条命名用例**（`l2-runtime-*.test.js` 的 `node --test` 报 `tests 32` = 31 命名 + 1 个 fixture 文件实体）
lane 作者工作区（仅 sha256 比对，全程未写）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\runtime`
基准（契约真相源）：节点合同（plan/DoD①/DoD②/cp1-cp3）、`spec/contracts/{INTERFACES.md §2/§4/§5、SCHEMAS.md、OWNERSHIP.md、ERRORS.md}`、`CONTRACTS.md §5`（十条不变量）、`spec/graph/SEMANTICS.md`、`L2-PROTOCOL-NOTES.md`、`execution/SESSION-PROTOCOL.md`（防御性编程禁令判据）、`adr_0004`、`adr_0009`

## 结论：**可接受**（blocker 0 / major 0 / minor 2 / nit 2）

plan、DoD①、DoD②、cp1/cp2/cp3 全部由我独立探针与独立负控取证通过：无重复消费、无旧 epoch 放行、崩溃后 unknown 不重派、reducer 逐字节确定。两个 minor 都是**不与 DoD 冲突的设计/资源面观察**（`step` 每轮必写观察事件；重复 pause 可再写一条 `session.paused`），两个 nit 是多余 host 往返与并发观察的 store 级错误码泄漏；均不影响本节点验收。

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 2 | **m1** `step()` 无条件 `observe()` 并提交 `host.observed`，空转/暂停会话被轮询时 journal 与 revision 线性增长（探针 P7：pause 后 5 次 step → events 3→8 / revision 2→7）；**m2** 已暂停会话可用新 `commandId` 再次 pause 并追加第二条 `session.paused`（P13：revision 2→3，事件 2 条），与严格拒绝的 `resume` 不对称 |
| nit | 2 | **n1** `reconcile()` 在 `unknownEffectIds` 为空时仍向 host 发一次 `reconcile`（P14）；**n2** `observe` 的幂等身份只含 `(sessionId, revision)`、不含观察内容，两个并发 `step` 在观察不同时会以 store 级 `EFK_ARTIFACT_DIGEST_MISMATCH` 失败而非会话级冲突码（P15；fail-closed，无重复执行） |

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份比对**：`src/runtime/session/*.ts` + `test/l2-runtime-*.test.js` 逐文件 lane ⇔ 集成副本，**14/14 全等**（收工复测仍 14/14，见 §6）。
2. **门禁实测**（集成副本，ADR-0004：测试只吃本次 build 的 `dist/`）：
   - `npm run build` → exit 0
   - `npm run typecheck` → exit 0
   - `npm run src:policy` → exit 0，`190 TypeScript file(s), largest 350 line(s) ... limit 350; 0 JavaScript file(s)`；本 lane 最大文件 `service.ts` 159 行
   - `npm run dep:check` → `modules 190 / edges 702 / cycles 0 / acyclic: true`
   - `node --test test/l2-runtime-*.test.js` 连跑两次：**各 32 tests / 32 pass / 0 fail**（见 §3）
3. **独立负控 3 组**（变异只在 `dist/`，逐组跑测试→记录变红用例→复原→复绿；见 §4）。按简报**未跑全量 `npm test`**。
4. **我方探针 P1–P15**：node 脚本放系统临时目录，直接 import 集成副本 `dist/**` 与上游 `test/l2-scheduler-fixtures.mjs`，自建 harness（不经作者 `l2-runtime-support.test.js`），运行后删除。凡断言失败即 FAIL，无 `try/catch` 吞错。
5. **静态闭包扫描**：从 `dist/runtime/session/index.js` 做静态 import 闭包 BFS，**78 个模块，全部相对说明符，0 个 `node:`/bare specifier**（I01/I02/I05/I08 的机检面）。
6. 防御性编程判据以 `grep`（`??`/`catch`/`as`/`try`）+ 通读源码逐处核对，不依赖测试。

---

## 1. plan / DoD / checkpoint 核对表

### 1.1 plan（8 项应用服务 + 归一化 + 调度/策略 + 原子 outbox + invocation 去重）

| plan 项 | 实现入口（单一） | 实测证据 | 判定 |
|---|---|---|---|
| create/open/read/step/pause/resume/cancel/observe/reconcile/close | `createSessionService`（`service.ts`）返回的 `SessionService`（`types.ts` 逐项签名） | `cp1 factory is inert...`；P1/P2/P5 全流程跑通 | ✅ |
| host events 归一化 | `observe` 存 `HostObservation`；`receive` 用 `decode('Receipt', input)` 做唯一边界校验（`receipts.ts`） | `cp2 output metadata without actual artifact bytes...`；P3 receipt 归一化后结算 | ✅ |
| 调用 scheduler/policy | `planRound`→`computeFrontier`/`dispatchRound`（`kernel/scheduler` 唯一入口）；`policyDecide`（`kernel/policy.decide` 唯一判定）；`ports.policy.inspect/resume` | `cp1 denied policy commits no intention...`、`cp3 shared request cap...`；P10 admissions 走 `policy.inspect` | ✅ |
| 原子保存 events+outbox | 每批经唯一 `store.append`（`journal.commit`；`commitBatch` 原子性由 `l2_state_store` 负责） | `cp2 failed atomic intention commit never dispatches or reserves`、`cp2 CAS competition commits one journal/outbox batch`；P5 崩溃窗口 | ✅（原子性继承上游 store，见 §5 未证明项） |
| 按 invocation 而非 webhook 次数去重用量 | `reduce` 的 `hostInvocationId`→`invocationEffects`/`appliedInvocations` + `settle` 按 `requestId`+digest 幂等（`project.ts`） | `cp2 physical webhooks for one invocation settle usage exactly once`；**P3**；负控 NC2 | ✅ |
| 唯一 policy/graph/scheduler 判定入口、不自造第二套 | 只 import `kernel/{graph,policy,scheduler}` 的冻结入口；无第二套 decide | 静态 import 清点 + `grep` 无 route/repair 重实现 | ✅ |
| I08 runtime 能力只来自参数端口 | `SessionPorts` 全部显式注入；模块顶层无构造 | `cp1 factory is inert...`（Proxy 抛错的 ports 也不触达）；闭包扫描 0 node/bare | ✅ |
| I05 顶层零副作用 | `index.ts` 仅 re-export；各文件顶层只有 `const`/函数 | 闭包扫描；`grep Date/Math.random/process.` = 0；**P6** | ✅ |

### 1.2 DoD①（相同事件+初始状态 → 同投影与 intentions）

- **P1**（独立探针）：两个独立 service 实例跑同一序列（create→step→webhook→pause），整个投影（`nodeStates/budget/intents/outbox/effects/receipts/scheduler/cancellation/unknownEffectIds/appliedInvocations`）canonical 后**逐字节相同（3230 bytes）**。
- **P2**：`reduce` 折叠 13 条事件 == `project(exported)`，且 `project` 连跑两次逐字节相同；重放 0 次 host 执行。
- 作者用例 `runtime DoD1 identical initial state and events yield identical projection and intentions` 亦覆盖 planner 非变异 + fold/project 恒等。
- 无 `Date`/`Math.random`/环境读取：`grep` 0 命中；**P6** 在 `Date.now`/`Math.random` 被投毒为抛错的进程内完成 step+receive+pause。时间/ID 全部参数注入（`ports.clock.now()`、`ports.digest`）。
- **负控 NC1** 精确破坏该断言。
- 判定：✅。

### 1.3 DoD②（重放 / 崩溃未知 / 旧 epoch 不重复消费或放行）

| 面 | 实测证据 | 判定 |
|---|---|---|
| 重放不改变投影、不产生新 consumption | P2（fold==project，二次重放恒等，execute 仍 1）；`settle` 按 `requestId` 幂等 | ✅ |
| 同 invocation 多 webhook 只记一次 usage | P3（receiptId 各异、`settlements=1 / micros=37 / appliedInvocations=1`；重复送达 `disposition=duplicate` 且 revision 冻结）；作者 `cp2 physical webhooks...` | ✅ |
| 缺失 usage 不归零 | 作者 `cp3 missing usage never becomes zero...`、`cp2 incomplete telemetry can be completed...`；P5 的 not-executed 结算 `micros=0`（来自 `releaseUnspent` 的已证实未花费，而非「补 0」） | ✅ |
| events+outbox 原子；崩溃只可能整批落 | 作者 `cp2 failed atomic intention commit...`、`cp2 CAS competition...`；P5 在 claim 已提交后 execute 抛错 → 效果为 unknown，reservation 仍在 | ✅ |
| 崩溃后未知效果 reconcile 前不派发 | **P5**：崩溃→`unknownEffectIds=[effect]`；导出/恢复到新 store 后 open 投影恒等，再 `step` 不重派（execute 计数恒为 1）；`reconcile` 拿到真实证据（not-executed）才释放 reservation | ✅ |
| 旧 epoch 回包不改状态、不重复消费 | **P4**：未知效果 → pause → resume(epoch 2) → 投递旧 epoch completed+usage → `disposition=archived`，`settlements=0`、reservations 不变、nodeState 仍 `unknown`、`appliedInvocations=0`、budget 载荷 canonical 不变（archived 只写 1 条证据事件 revision 7→8）；重复投递仍 `duplicate` | ✅ |
| 旧 epoch intention 不放行 | **P10**：resume 后陈旧 intention `intents=0 / staleEffectIds=1`，`step.ok=true`、execute 0（`store.nextEffects` 已按 epoch 过滤） | ✅ |
| 已完成/陈旧结果仅归档保留证据 | 作者 `DoD2 old epoch...`、`cp2 expired lease...`；负控 NC3 | ✅ |

### 1.4 checkpoint 对应

| cp | 实现入口 | 用例（实测命中） | 判定 |
|---|---|---|---|
| cp1 会话 lifecycle 与 reducer | `project.ts`（`initialState/reduce/project`）、`service.ts`（create/open/read/observe/close）、`journal.ts`、`plans.ts` | lifecycle 9 条（如 `cp1 host completion stops at verifying...`、`cp1 repair preserves failed attempt...`） | ✅ |
| cp2 outbox ack 与 reconciliation | `receipts.ts`、`dispatch.ts`、`service.reconcile` | recovery 11 条（如 `claim committed before crash restores as unknown...`、`unknown evidence stays unknown until an actual reconcile receipt`） | ✅ |
| cp3 暂停/恢复/取消核验 | `controls.ts`、`evaluation.ts` | controls 11 条（如 `unconfirmed cancel stays unknown...`、`native cancel acknowledgement releases leases...`、`multi-target native cancellation...`） | ✅ |

未确认取消：作者 `cp3 unconfirmed cancel stays unknown...` 断言 `report.error.code=EFK_CANCEL_UNCONFIRMED`、`cancellation='unconfirmed'`、nodeState `unknown`、reservation 保留、再次 cancel/step 不再调 host；P11/P12 补证 pause 态 cancel 与空 reconcile。取消/失败分支：`cp3 cancellation of settled verifying work...`、`cp3 unclaimed effects cancel atomically...`、`cp1 dependency failure retains the failed branch...`。判定 ✅。

---

## 2. 用例计数口径

`node --test test/l2-runtime-*.test.js` 报 `tests 32 / pass 32 / fail 0`，来源是 `l2-runtime-*.test.js` 命中 4 个文件，其中 `l2-runtime-support.test.js` 是 fixture（0 条命名用例）却仍被当 1 个文件实体计入。`grep -c '^test('` 实测：lifecycle 9 + recovery 11 + controls 11 = **31 条命名用例**。与 commit message「+31 cases (32 with the fixture)」一致，作者口径无误。

---

## 3. 门禁输出摘要（集成副本）

```
npm run build        -> exit 0
npm run typecheck    -> exit 0
npm run src:policy   -> src policy: 190 TypeScript file(s), largest 350 line(s) (src/lib/pi-tool-strategy.ts), limit 350; 0 JavaScript file(s); check passed
npm run dep:check    -> modules: 190 / edges: 702 / cycles: 0 / acyclic: true
node --test test/l2-runtime-*.test.js  (run 1) -> ℹ tests 32 / pass 32 / fail 0
node --test test/l2-runtime-*.test.js  (run 2) -> ℹ tests 32 / pass 32 / fail 0
```
逐用例全绿（31 命名 + fixture），包括 DoD①②与 cp1–cp3 各面。

---

## 4. 负控表（变异点 → 变红用例名 → 复原）

| 组 | 变异点（仅 `dist/`，gitignored） | 变红用例（实测） | 复原后 |
|---|---|---|---|
| **NC1** DoD① 确定性 | `dist/runtime/session/project.js`：加模块级 `let __probeDrift=0;`，返回体 `intents,` → `intents: __probeDrift++ % 2 === 0 ? intents : [],` | **3 fail / 29 pass**：`runtime DoD1 identical initial state and events yield identical projection and intentions`、`runtime cp3 pause blocks new dispatch while preserving in-flight work`、`runtime cp2 CAS competition commits one journal/outbox batch` | `cp` 备份还原 → 32/32 |
| **NC2** DoD② invocation 去重 | `dist/runtime/session/project.js`：`const invocation = receipt.hostInvocationId;` → `const invocation = null;` | **6 fail / 26 pass**：`runtime cp2 physical webhooks for one invocation settle usage exactly once`、`runtime cp2 reused invocation identity cannot consume a second effect reservation`、`runtime cp2 incomplete telemetry can be completed and conflicting usage blocks release`、`runtime cp2 unknown evidence stays unknown until an actual reconcile receipt`、`runtime cp3 missing usage never becomes zero after completed host work`、`runtime DoD1 identical initial state...` | 还原 → 32/32 |
| **NC3** DoD② 旧 epoch 放行 | `dist/runtime/session/receipts.js`：`const stale = receipt.binding.epoch !== state.epoch \|\| ...` → `const stale = false \|\| ...` | **1 fail / 31 pass**（精确）：`runtime DoD2 old epoch receipt is archived without node or usage consumption` | 还原 → 32/32 |

三组均在复原后 `grep` 确认变异串为 0 命中，并重跑 `node --test test/l2-runtime-*.test.js` 回到 32/32；收工又 `npm run build`（exit 0）重跑仍 32/32。

---

## 5. 我方独立探针（P1–P15，自建 harness，跑完已删）

| 探针 | 结果 |
|---|---|
| P1 同事件序列两次运行 | PASS：3230 bytes canonical 恒等（step+webhook+pause） |
| P2 replay 投影恒等 | PASS：fold==project（13 事件）、二次 replay 恒等、execute 保持 1 |
| P3 同 invocation 双 webhook usage | PASS：`settlements=1 / micros=37 / appliedInvocations=1`；重复 `duplicate` 且 revision 冻结 |
| P4 旧 epoch 回包恒定 | PASS：archived，settlements=0、reservations 不变、nodeState=unknown、budget 载荷不变、revision 仅 +1（证据事件） |
| P5 崩溃后 unknown 不派发 | PASS：崩溃→unknown；重启 step 不重派（execute 恒 1）；真实 reconcile 证据才释放 reservation |
| P6 ambient 时间/随机 | PASS：`Date.now`/`Math.random` 投毒为抛错时 step+receive+pause 仍完成 |
| P7 轮询 journal 增长 | 观察（m1）：paused + 5×step → events 3→8、revision 2→7、5 条 `host.observed` |
| P9 并发 step | 观察：2 并发 step 均 ok、effects=1、execute=1（幂等收敛，无重复执行） |
| P10 resume 后陈旧 intention | PASS：intents=0 / staleEffectIds=1 / execute=0 / step ok |
| P11 pause 态 cancel | PASS：status=cancelled、execute=0 |
| P12/P14 空目标 reconcile | 观察（n1）：host.reconcile 仍被调用 1 次 |
| P13 二次 pause（新 commandId） | 观察（m2）：ok、revision 2→3、`session.paused` 共 2 条 |
| P15 并发 step 且观察不同 | 观察（n2）：一个 ok、另一个 `EFK_ARTIFACT_DIGEST_MISMATCH`（fail-closed，无重复执行） |

静态闭包扫描：`dist/runtime/session` 静态 import 闭包 78 模块，**0 个 `node:`/bare specifier**；`src/**` 全部相对导入。

---

## 6. 未证明项（如实）

1. **无真实宿主闭环**：只用 `createFakeHost`；真实 DSH/Pi adapter 属 L3。本节点不声明真实挂起/取消/恢复的端到端。
2. **无耐久持久化**：只用 `createMemoryEventStore`；P5 的「崩溃恢复」是 export→新 memory store→restore 的模拟，不是真实进程崩溃 + 落盘 journal。`events+outbox` 的**原子性**继承 `l2_state_store` 的 `commitBatch`，本次未对其独立复证（作者用注入 commit 失败用例覆盖运行时一侧）。
3. **评估/裁决路径**：`evaluate`→注册 evaluator→`kernel/graph.decide` 由作者用例覆盖并通过（我实跑了门禁），但**我的独立探针未单独复刻该路径**（只驱动了 step/receive/pause/resume/cancel/reconcile/close）。
4. **未跑全量 `npm test`**（按简报要求）；既有 wall-clock 用例未纳入本次判定。
5. **确定性只在同引擎、同进程下证到逐字节一致**；reducer 的时间来自注入的 `now` 参数（P6 只证未读 ambient Date/Math），未跨引擎或跨时区验证。
6. **预算硬帽/隔离/能力门禁**（network/dependency/credentials/authority_ceiling）属上游节点语义，不在本次独立复证范围。

---

## 7. 收工一致性

- **lane ↔ 集成 sha256**：14/14 文件全等（`src/runtime/session/*.ts` 10 + `test/l2-runtime-*.test.js` 4），收工复测仍 14/14。
- **git 状态**：本 pane 对 `src/`、`test/` 的变异全部在 `dist/` 进行并已复原/重建；`git status --porcelain src/ test/` 为空、`git diff --stat src/ test/` 为空；全仓库 `git status --porcelain` 除本 dossier 外为空。未写 `.graph`、未 commit、未改 lane。
- **落点纪律**：新文件只增不覆，10 个源文件 ≤350 行，测试平铺 `test/` 根并从 `dist/**` 导入（ADR-0004），均实测。

---

## 8. minor / nit 明细（不影响验收）

- **m1（资源面）** `stepSession` 先 `service.observe()` 并无条件提交 `host.observed`：空转/`paused`/`cancelled` 会话被反复 `step()` 时 journal 与 revision 线性增长（P7）。契约未禁止（`ingestHostEvent` 本就要落观察工件），DoD①/② 不受影响；但 `step` 因此非幂等。是否在 L3 轮询循环里改为「观察内容变化才落事件」由后续决定。
- **m2（对称性）** `pauseSession` 只拒绝 `cancelling/cancelled`，已 `paused` 会话用新 `commandId` 会再写一条 `session.paused`（P13）；`resumeSession` 对非 `paused` 严格拒绝。效果幂等，仅多一条事件。
- **n1** `reconcile()` 在 `unknownEffectIds=[]` 时仍调用 `ports.host.reconcile({targetIds:[]})`（P14），可省一次 host 往返。
- **n2** `observe` 幂等身份只含 `(sessionId, revision)`、不含观察内容；两个并发 `step` 在观察不同时以 store 级 `EFK_ARTIFACT_DIGEST_MISMATCH` 失败而非会话级冲突码（P15）。行为 fail-closed、无重复执行，仅错误码分层不理想。
