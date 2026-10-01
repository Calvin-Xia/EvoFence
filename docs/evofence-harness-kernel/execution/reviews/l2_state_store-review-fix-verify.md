# 交叉复核（返工复验）：`l2_state_store` 修复 — 独立第二双眼

- 复核者：`review-2`（新 pane，独立于作者与首轮复核者）；只读 lane，唯一写入是本报告。
- 复核对象：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\store`（分支 `refactor/hk-store`，基线 `d47f0ca`），`src/storage/**`（9 文件）+ `test/l2-store-{journal,recovery,artifacts}.test.js`（44 例）。
- 首轮复核全文：`docs/evofence-harness-kernel/execution/reviews/l2_state_store-review.md`（B1/B2/M1/M2/N1/N2/NIT1-3）。
- 集成副本：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence` 的 `src/storage/**`，修复提交 `df5f23e`。
- 方法：不采信自报；按首轮复现步骤在 lane 内重跑反例，外加独立负控、边界探针与 ambient 扫描。复现脚本写在仓库外（`%TEMP%\store-reverify\*.mjs`），未入库。

## 结论

**基本可接受 —— 本次返工未引入任何新回归；0 个由修复引入的 blocker。** 首轮 2 BLOCKER + 2 MAJOR + 2 MINOR + 3 NIT 的**原始反例全部按声称修复**，修复手法正确。逐条状态见下表。

| 首轮发现 | 状态 | 一句话 |
|---|---|---|
| B1 | 已修复（可接受） | 完整 binding 比较；跨 attempt/base/host 回执归档不结算 |
| B2 | 原始反例已修复（可接受）；**保证范围需修订** | 同 reducer 预演；但只预演 journal，不预演 outbox（残留，非回归） |
| M1 | 已修复（可接受） | `staleEffectIds` + `nextEffects` 限定当前 epoch |
| M2 | 原始反例已修复（可接受） | `applyReceipt` 补证据门；两门非字面相同，措辞不精确 |
| N1 | **部分修复 / 需修订** | 加了 effect/receipt protocol 版本门；边界注释不准确，且 schema 形状仍未 decode |
| N2 | 已修复（可接受） | 已提交回执可被引用 |
| NIT1/2/3 | 已修复 | 措辞 / canonical 数值域 / save-recover 注释 |

两处需后续处理的残留，**均非本次返工引入**（首轮基线同样存在，首轮亦未列出）：

1. **B2 的「accepted ⟹ replayable」保证被夸大。** 预演只跑 journal reducer（`projection.ts:replay`），不跑 `projectOutbox`。`append` 仍可提交一个让读端口 `replay`/`outbox`/`nextEffects` 全部 `EFK_INVARIANT_VIOLATION` 的事务（两种形状已实测，见 B2 节）。
2. **N1 的边界注释不准确**，且「事务内容不 decode」的实质未被消除（只补了 protocol 版本门）。文档写明边界 ≠ 边界被强制。

## 环境与一致性（开工/收工）

```
# lane 的 9 个 src/storage 与集成工作区的 9 个逐字节一致
sha256sum src/storage/*.ts   (lane)  ==  (integration worktree)   # 9/9 相同
git -C <integration> diff --stat df5f23e -- src/storage/          # 空（== 修复提交树）
# 开工 / 收工 lane 12 文件的 sha256 逐字节一致
sha256sum src/storage/*.ts test/l2-store-*.test.js               # 开工记录 vs 收工 diff 为空
```

| 文件 | sha256（前 12 位） |
|---|---|
| src/storage/contracts.ts | 65feae5a7da3 |
| src/storage/identity.ts | 5608b42054a7 |
| src/storage/index.ts | b08498eed4f8 |
| src/storage/memory-artifact-store.ts | 13dbb8ab131e |
| src/storage/memory-event-store.ts | 5889eb20bc61 |
| src/storage/memory-snapshot-store.ts | 2b4d28343544 |
| src/storage/outbox.ts | 70817546bc15 |
| src/storage/projection.ts | 32415e99838b |
| src/storage/store-session.ts | 7212b6a09f31 |
| test/l2-store-artifacts.test.js | 14ca09d9e3c7 |
| test/l2-store-journal.test.js | de43cce14c18 |
| test/l2-store-recovery.test.js | 4b2fd3cc8abd |

未跑全量 `npm test`；未改 `.graph`；未 commit；未改集成 worktree 源码（只读 + 本报告写入）。

## 构建与测试（lane 内）

```
npm run build                                                    # tsc, exit 0
node --test test/l2-store-journal.test.js test/l2-store-recovery.test.js test/l2-store-artifacts.test.js
#   ℹ tests 44 / pass 44 / fail 0 / cancelled 0 / skipped 0     # 与自报一致（18+19+7）
```

## 逐条复验

### B1 — 跨 attempt 回执只判 epoch（首轮 BLOCKER）→ 已修复

- 修复点：`src/storage/memory-event-store.ts:100`
  `const stale = receipt.binding.epoch !== input.epoch || canonical(receipt.binding) !== canonical(effect.binding);`
- 首轮反例重跑（同一 session，effect `fx1` 已在 epoch 1 派发；伪造 `binding={nodeId:'OTHER-NODE',attemptId:'OTHER-ATTEMPT',attemptOrdinal:9,epoch:1}`，epoch 相同、attempt/base 不同）：
  ```
  applyReceipt    -> OK {"disposition":"archived","revision":3,"effectId":"fx1","receiptId":"r0"}
  outbox.entries  -> [{"effectId":"fx1","state":"dispatched",...}]     # 未被结算
  archivedReceiptIds -> ["r0"];  events: receipt.archived=true, receipt.applied=false
  replay().unknownEffectIds -> ["fx1"]                                 # 仍是待核实
  ```
- 独立变体：`baseDigest` 不同 → archived；`hostSessionId` 不同 → archived；binding 完全一致（对照）→ applied。
- 负控（见下）：把该行改回只比 epoch，恰好 B1 两条测试变红 → 该比较确实负载。
- 备注（非缺陷）：本协议版本的 `Binding` 不含 `fencing` 字段（fencing 只在 `DispatchClaim`），`ERRORS.md:50` 的「epoch/attempt/base/fencing」中 fencing 无法进入 binding 比较；「完整 binding」已是当前可用的最大集合，且额外覆盖 `graph`/`sessionId`。结论：**可接受**。

### B2 — 非递增 `session.epoch-changed` 提交后不可重放（首轮 BLOCKER）→ 原始反例已修复；保证范围需修订

- 修复点：`store-session.ts:199` 改为 `if (!epochChange && epoch !== session.epoch)`；`:211` 用 `emptyReplayState`/`replay(session.events)` 预演已有 journal；`:247` `replay(nextEvents, produced.value)` 预演新批次（同一个 reducer）。
- 首轮三个反例 + 对照，全部重跑：
  ```
  (a)  rev1 后 append {epoch:1, [session.epoch-changed epoch=1]}
        -> ERR EFK_INVARIANT_VIOLATION: session.epoch-changed e1 moves epoch 1 -> 1
        revision 仍为 1；store.replay -> OK
  (a2) 单事务两条 {epoch:2} epoch-changed -> ERR EFK_INVARIANT_VIOLATION
  (f)  [node.transition(epoch2), session.epoch-changed(epoch2)] -> ERR EFK_INVARIANT_VIOLATION
        (event t1 carries epoch 2 outside session epoch 1)
  (a3) 对照组 append {epoch:2, [epoch-changed epoch=2]} -> committed；replay epoch=2
  ```
- 语义一致性（任务点 3）：写路径的拒绝集合现在等于 **journal reducer**（`projection.ts:replay`）的拒绝集合 —— 同一函数、同一规则。唯一放宽：**epoch 跳跃 > +1（如 1→5）现在被接受**（旧写路径要求恰好 `+1`，reducer 只要求严格递增）。实测 `1→5` committed、replay epoch=5。spec 仅写「resume/恢复递增 epoch」（`INTERFACES.md:157`），未见 `+1` 硬性文本，故属「写读对齐」而非回归；但需知悉首轮建议 (i) 的 `+1` 硬规则未被采纳（采纳的是建议 (ii) 同 reducer 预演）。
- **残留（需修订，非本次回归）**：预演不覆盖 `projectOutbox`，而 `EventStore.replay/outbox/nextEffects` 都调用 `project(session)=projectOutbox(...)`。实测：
  ```
  append([effect.dispatched fx1], no intention)   -> OK committed (rev1)
  store.replay                                     -> ERR EFK_INVARIANT_VIOLATION
  store.outbox  -> EFK_INVARIANT_VIOLATION: effect fx1 was dispatched without a committed intention
  nextEffects                                      -> ERR EFK_INVARIANT_VIOLATION
  ---- 同形状第二例 ----
  append([receipt.applied for fx1] + receipt 内容, 无 effect) -> OK committed
  store.replay                                     -> ERR EFK_INVARIANT_VIOLATION
  ```
  即一个公开 `append` 可以把 session 提交进「所有读端口永久失败」的状态，与不变量 4/5/6（journal 与 outbox 原子、replay 只重建状态）冲突。该洞在首轮基线即存在（首轮 `commitBatch` 完全没有预演），**不是本次返工引入**；但 `store-session.ts:209-210` 的注释「a batch is accepted only if the reducer would accept it, so an accepted journal can never be unreplayable」与作者自报「被接受的批次必可 replay」在 EventStore 端口语义下不成立，应下调措辞或补齐。建议：预演阶段同时跑一次 `projectOutbox(新 events', 合并后的 effects/receipts)`；这能一次性覆盖 `effect.dispatched` 无 intention、`receipt.applied` 无 effect 等事务形状。结论：**原始反例可接受；上述保证需修订**。

### M1 — `nextEffects` 返回必然派发失败的旧 epoch effect（首轮 MAJOR）→ 已修复

- 修复点：`memory-event-store.ts:244` 过滤 `effect.binding.epoch === session.epoch`；`:216-225` `replay` 把旧 epoch intention 分入 `staleEffectIds`；`contracts.ts:114` 措辞改为 "dispatchable at the current epoch"、`:118-123` 新增 `staleEffectIds` 注释。
- 实测（正常恢复流程）：
  ```
  effect.intended fx1 (epoch1) -> committed
  session.epoch-changed -> epoch2 -> committed
  nextEffects(s1)        -> []                      # 不再声明可发
  replay(): pendingEffectIds=[]  staleEffectIds=['fx1']
  dispatchEffect(fx1, epoch=2)  -> ERR EFK_LEASE_STALE: effect fx1 was intended at epoch 1, session is at 2
  ```
- 对照：当前 epoch 的 intention 仍被正常列出（`nextEffects=['fx1']`，`pending=['fx1']}`，`stale=[]`）。结论：**可接受**。

### M2 — 「无证据即保持 unknown」门只在 reconcile（首轮 MAJOR）→ 原始反例已修复；措辞不精确

- 修复点：`memory-event-store.ts:101-103` 在 `applyReceiptTo` 新增
  `if (receipt.status !== 'unknown' && receipt.observability.length === 0) return storeFail('EFK_EFFECT_UNKNOWN', ...)`；`reconcileTo:155` 保留原门。
- 首轮反例重跑（effect 已 dispatched，两端口传同一 `status='completed', observability=[]`）：
  ```
  applyReceipt    -> ERR EFK_EFFECT_UNKNOWN: receipt r0 claims completed for effect fx1 without observability
  reconcileEffect -> ERR EFK_EFFECT_UNKNOWN: effect fx1 still has no actual observability; it stays unknown
  replay().unknownEffectIds -> ['fx1']              # 两端口结论一致，零证据不结算
  ```
  对照：`completed + observability=['a']` 两端口都 applied；`status='unknown'` 回执 applyReceipt 记录（applied）而不结算（outbox 仍 unknown）。
- 精确说明：两处门**并非字面同一表达式** —— `reconcileTo` 是 `status === 'unknown' || obs.length === 0`，`applyReceiptTo` 是 `status !== 'unknown' && obs.length === 0`。唯一分歧形状是 `status='unknown'`：applyReceipt 记录证据、reconcile 报「仍 unknown」。两者都把 effect 留在 `unknown`（不错误结算、不盲重放），属可辩护的端口语义差异（DoD2 测试也按此断言）；但自报「applyReceipt 与 reconcileEffect 共用证据门」的表述不精确，M2 的实质缺陷（`completed`+零证据即结算）确已消除。结论：**可接受（措辞需微调）**。

### N1 — 事务内容不按协议解码（首轮 MINOR）→ 部分修复 / 需修订

- 新增：`store-session.ts:174-185` 对 effect / receipt 增加 `canonical(protocol) !== canonical(session.protocol) → EFK_PROTOCOL_UNSUPPORTED`。实测：
  ```
  effect.protocol 1.0.0（会话 1.1.0） -> ERR EFK_PROTOCOL_UNSUPPORTED: effect fx1 uses 1.0.0, session is pinned to 1.1.0
  receipt.protocol 1.0.0              -> ERR EFK_PROTOCOL_UNSUPPORTED: receipt r0 uses 1.0.0, ...
  ```
- 新增：`contracts.ts:14-19` 边界段。
- **注释准确性（任务点 3，不因写明而抹掉发现）**：该段称「every port signature takes `Decoded<K>`」「The store does not re-decode them」，与实际不符：
  - `CreateSessionInput.protocol` 是 `unknown`（明确是 boundary 输入），`createSession` 调 `decodeProtocolVersion` + `gateRuntimeVersion` 解码并门禁；
  - `memory-artifact-store.put/get` 各自 `decode('ArtifactRef', rawRef)`（`memory-artifact-store.ts:29,50`）。
  准确表述应为「除 `createSession` 的 `protocol` 与 `ArtifactRef` 外，EventStore 的事务内容不再 decode」。另外该段末句「what it does verify at its own persistence boundary is identity, protocol version and journal continuity, not schema shape」也漏了 ArtifactStore 对 ArtifactRef 的 schema 解码与 digest 绑定。
- **残留（未消除）**：`append` 仍接受封闭枚举外的 `Event.type`：
  ```
  append type="not.a.real.event" -> OK committed (rev1); exportSession().events[0].type 原样保存; replay 静默忽略
  ```
  `SCHEMAS.md $defs` 的 `Event.type` 是 17 值封闭枚举；event/effect/receipt 的 schema 形状仍不 decode。即首轮 N1 的实质只是被**文档化**，外加 protocol 版本门，并未在 store 边界强制。结论：**需修订**（补准确注释；或按首轮建议对三类对象调一次 `decode(...)`）。

### N2 — 已提交回执不能被事件单独引用（首轮 MINOR）→ 已修复

- 修复点：`store-session.ts:146` `if (!receipts.some(...) && !session.receipts.has(receiptId))`。
- 实测：先 `applyReceipt r0`（rev3），再 append 引用 `r0` 的 `receipt.applied` 且不再传内容 → `OK {"disposition":"committed","revision":4,...}`。结论：**可接受**。

### NIT1-3 → 已修复

- NIT1：`index.ts:5-7` 改为「importing this module constructs no port backend, runs no external I/O, and installs no default backend or implicit singleton」。模块级 `const encoder = new TextEncoder()` 与常量仍在，属纯分配，新措辞不再与之矛盾。
- NIT2：`identity.ts:22` `String(value)`、`:27` 过滤 `undefined` 键。实测不再同摘要：`{a:undefined}`→`{}`、`{a:null}`→`{"a":null}`、`{a:NaN}`→`{"a":NaN}`、`{a:Infinity}`→`{"a":Infinity}`（`-0`→`0`）。
- NIT3：`contracts.ts:213` 为 `SnapshotStore.save` 补注释「`save` stores a projection verbatim and version-gates it; `recover` is what checks it against the journal」，与 `memory-snapshot-store.ts` 行为一致。

## 负控（可证伪性，任务点 2）

```
sha256sum dist/storage/memory-event-store.js        # 基线 a34627baa47ee5da258910d2ddcebeb580a41d1de1323be989deadcabc8eecca
# 把编译产物第 75 行的完整 binding 比较改回 epoch-only：
#   canonical(receipt.binding) !== canonical(effect.binding)  ->  receipt.binding.epoch !== effect.binding.epoch
node --test test/l2-store-journal.test.js test/l2-store-recovery.test.js
#   ℹ tests 37 / pass 35 / fail 2
#   ✖ BLOCKER fix B1: a receipt bound to a different attempt is archived, never applied
#   ✖ BLOCKER fix B1: a receipt bound to a different base or host session is archived too
npm run build && sha256sum dist/storage/memory-event-store.js
#   a34627baa47ee5da258910d2ddcebeb580a41d1de1323be989deadcabc8eecca   == 变异前基线
node --test test/l2-store-journal.test.js test/l2-store-recovery.test.js   # 37/37 复原
```

B1 的比较确实负载，测试不是同义反复。另有 `gate: accepted => replayable` 探针（9 种畸形批次 + 「接受即 replay」性质检查）：journal reducer 轴上一致；正是它暴露上文的 outbox 残留。

## ambient / 确定性（任务点 4）

- `src/storage/*.ts` 对 `Date.now` / `new Date` / `Math.random` / `node:crypto` / `node:fs` / `require(` / `process.env` / `console.*` / `setTimeout` / `setInterval` **零命中**（唯一命中是 `identity.ts:9` 的文档文字）。
- 无顶层 `let`/`var`；import 说明符全相对（`../protocol/index.js` 与同目录），无 I/O、无单例、无默认后端；`DigestPort` 显式注入；`identity.ts` 只做 canonical 序列化，不选哈希。
- 模块顶层仅 `const encoder = new TextEncoder()`、`MAX_ARTIFACT_BYTES`、`CREDENTIAL_LOCATOR`（纯分配/常量）。

## 复现命令（仓库外）

```
node %TEMP%\store-reverify\repro.mjs            # 18/18：B1/B1变体/B2(a,a2,f,a3)/M1/M2/N2/N1/NIT2/gate
node %TEMP%\store-reverify\m2-detail.mjs        # M2 四形状：completed/[]、completed/[a]、unknown/[]、unknown/[a]
node %TEMP%\store-reverify\residual-class.mjs   # outbox 残留两例 + epoch 1→5 + unknown 分歧
node %TEMP%\store-reverify\hole-check.mjs       # effect.dispatched 无 intention
```

## 范围外

`scripts/check-core-imports.mjs`、`test/protocol-guard/**`、`docs/` 未在本轮审；其绿灯未作为证据。本报告只读 lane，唯一写入是本文件；未动 `.graph`、未 commit、未改集成 worktree 源码。
