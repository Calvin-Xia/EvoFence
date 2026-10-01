# 交叉复核：`l2_state_store`（lane `store`）

- 复核者：`review-1`（独立 pane，非作者）；只读 lane，未改任何 lane 源码（除本节「负控」中一次可恢复的 `dist/` 变异，已重建复原）。
- 复核对象：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\store`，分支 `refactor/hk-store`，基线 `d47f0ca`；`src/storage/**`（9 文件）+ `test/l2-store-{journal,recovery,artifacts}.test.js`（36 例）。文件均 untracked。
- 契约真相源：`spec/contracts/{SCHEMAS.md,INTERFACES.md,ERRORS.md,OWNERSHIP.md}`、`CONTRACTS.md §5`（不变量 4/5/6/9）、`execution/L2-PROTOCOL-NOTES.md`；错误码真相源 `src/protocol/errors.ts` 的 58 个 `EFK_*`。
- 范围外（未审，也未拿其绿灯当证据）：`scripts/check-core-imports.mjs`、`test/protocol-guard/**`。

## 结论

**需修订（blocker 2）** —— cp1/cp2 的原子提交与 outbox 投影基本达标，但 cp3（恢复/回执核实）有两处**契约违反**：① 旧回执的 stale 判定只比 `epoch`，与 `INTERFACES §5`／`ERRORS EFK_RECEIPT_STALE` 的 `epoch/attempt/base/fencing` 不符；② `commitBatch` 允许不递增（或同批重复）的 `session.epoch-changed`，其提交后的 journal 会被自己的 reducer 拒绝，该 session 永久不可重放/恢复。

## 实测命令与结果

```
# lane 内
npm run build                                      # exit 0
node --test test/l2-store-journal.test.js test/l2-store-recovery.test.js test/l2-store-artifacts.test.js
#   ℹ tests 36 / ℹ pass 36 / ℹ fail 0
```

负控（可证伪性，作者所列 4 个负控之外我自己做的一次）：

```
cp dist/storage/store-session.js $TEMP/store-session.js.bak
# 把编译产物里的 CAS 守卫改成恒真： if (expectedRevision !== session.revision) {  ->  if (false) {
node --test test/l2-store-journal.test.js
#   ✖ cp1 out-of-order expectedRevision is refused and the journal is untouched
#   ✖ negative control: the CAS guard is not a no-op (two writers at revision 0)
#   ℹ tests 16 / pass 14 / fail 2
npm run build && sha256sum dist/storage/store-session.js
#   e247096e84f6683c540fe1ffeede8191485538a1c4006e826a8cf668150997c8  == 变异前基线
node --test test/l2-store-*.test.js                # 36/36 复原
```

主 worktree 与 lane 的最终一致性：

```
git status --short          # 与开始完全一致：?? src/storage/ + 3 个 ?? test/l2-store-*.js
sha256sum src/storage/*.ts test/l2-store-*.js      # 12/12 与开工前逐字节一致
```

复现脚本（仓库外，未入库）：`%TEMP%\store-review\repro.mjs`。

---

## BLOCKER

### B1. stale receipt 只判 `epoch`，未判 `attempt/base/fencing` —— 跨 attempt 回执被「应用」而非归档

- 位置：`src/storage/memory-event-store.ts:98`
  `const stale = receipt.binding.epoch !== input.epoch || receipt.binding.epoch !== effect.binding.epoch;`
- 契约：`spec/contracts/INTERFACES.md:160` —— 「stale receipt | **epoch/attempt/base/fencing 不匹配**仅 receipt.archived；保留证据，**不写当前产物/资格、不再次结算**」；`ERRORS.md:50` —— `EFK_RECEIPT_STALE | 旧 epoch/**attempt**/fencing 回执；归档不应用`。
- 实测（同一 session，effect `fx1` 已在 epoch 1 派发）：构造一条 `receipt.binding = { nodeId: 'OTHER-NODE', attemptId: 'OTHER-ATTEMPT', attemptOrdinal: 9, epoch: 1 }`（epoch 相同，attempt/base 不同）的回执：

  ```
  applyReceipt(...)                       -> OK {"disposition":"applied","revision":3,...,"receiptId":"r0"}
  exportSession().receipts[0].binding.nodeId -> "OTHER-NODE"     # 伪造绑定被持久化
  outbox().entries                        -> [{"effectId":"fx1","state":"resolved","resolvedStatus":"completed"}]
  ```

  即跨 attempt 的回执被当成该 effect 的真实结果，effect 被结算（`resolved`），恰好是契约禁止的三件事（写当前产物/资格、再次结算、不归档）。
- 建议：stale 判定改为比较完整 binding（`nodeId`/`attemptId`/`attemptOrdinal`/`baseDigest`/`hostSessionId`），任一不匹配即走 `receipt.archived`。

### B2. `commitBatch` 允许非递增的 `session.epoch-changed`，提交的 journal 被自己的 reducer 拒绝

- 位置：`src/storage/store-session.ts:189`
  `if (epoch !== session.epoch && !(epochChange && epoch === session.epoch + 1))`
  对照 `src/storage/projection.ts:82` —— reducer 要求 `event.epoch` **严格大于**当前 epoch（否则 `EFK_INVARIANT_VIOLATION`）。
  写路径的规则是「等于当前 epoch 或 = 当前+1」，读路径的规则是「必须严格递增」，两者不等价。
- 契约：`INTERFACES.md:155` 「resume/恢复**递增**epoch」；`CONTRACTS.md §5.10` / `INTERFACES §5 replay` 「replay 仅从 journal 重建状态/outbox/待核实列表」；节点 DoD② 「重放只重建状态」。提交成功却无法重放，DoD② 对该 session 不成立，且 cp3 的崩溃恢复路径（`restoreSession` → `reviveSession` → `replay`）一并失效。
- 实测（三种触发，均先 `commit` 成功、后 `replay` 失败；附对照组）：

  ```
  (a) 已有 rev1 的 session，再 append {epoch:1, events:[session.epoch-changed epoch=1]}
        append   -> OK {"disposition":"committed","revision":2,"eventIds":["e1"]}
        replay   -> EFK_INVARIANT_VIOLATION: session.epoch-changed e1 moves epoch 1 -> 1
  (a2) 单事务内两条 {epoch:2} 的 session.epoch-changed
        append   -> OK committed（rev1, eventIds ["e1","e2"]）
        replay   -> EFK_INVARIANT_VIOLATION: session.epoch-changed e2 moves epoch 2 -> 2
  (f) 单事务 [node.transition(epoch2), session.epoch-changed(epoch2)]
        append   -> OK committed
        replay   -> EFK_INVARIANT_VIOLATION: session.epoch-changed e1 moves epoch 2 -> 2
  (a3) 对照组：rev1 后 append {epoch:2, events:[session.epoch-changed epoch=2]}
        append   -> OK committed;  replay -> OK（epoch=2）
  ```

- 建议：`session.epoch-changed` 要求 `epoch === session.epoch + 1`，同一事务至多一条，且不得位于该事务中其它事件之后（或直接在提交前用同一个 reducer 预演整批事件，让写路径不可能接受读路径拒绝的批次）。

---

## MAJOR

### M1. `nextEffects` 声明「safe to send」，却返回 `dispatchEffect` 必然拒绝的 effect

- 位置：`src/storage/memory-event-store.ts:238`（`nextEffects` = `intendedIds(projection)`，不过滤 epoch）对照 `:128-129`（`dispatchTo` 在 `effect.binding.epoch !== session.epoch` 时 `EFK_LEASE_STALE`）；声明见 `src/storage/contracts.ts:110`「Effects committed but not yet claimed for dispatch. **Safe to send.**」
- 契约：`ERRORS.md:34`「`EFK_LEASE_STALE` | epoch/fencing/expiry 无效」，`INTERFACES.md:155` 恢复递增 epoch。
- 实测（正常恢复流程，无异常输入）：

  ```
  effect.intended fx1 (binding.epoch=1)  -> committed
  session.epoch-changed -> epoch 2       -> committed
  nextEffects(s1)                        -> OK [ {effectId:"fx1", ...} ]     # 声明可发
  dispatchEffect(fx1, epoch=2)           -> EFK_LEASE_STALE: effect fx1 was intended at epoch 1, session is at 2
  ```

  `fx1` 从未派发（不是「在途动作」），却被列进待发集合且永久派发失败。
- 建议：二选一并写进契约 —— ① `nextEffects`/`pendingEffectIds` 过滤 `binding.epoch === session.epoch`；或 ② 允许派发「从未 dispatched」的旧 epoch intention（此时 `binding.epoch` 只作证据、不作门）。

### M2. 「无真实证据即保持 unknown」的门只在 `reconcileEffect`，`applyReceipt` 可绕过 —— 同一回执两个端口结论相反

- 位置：`src/storage/memory-event-store.ts:149`（`reconcileTo` 的 `receipt.status === 'unknown' || receipt.observability.length === 0` 门）对照 `:97-121`（`applyReceiptTo` 无任何 observability 检查）。
- 契约：节点 DoD②「未知外部 effect 进入 reconciliation」；`INTERFACES.md:157`「reconcileEffect … 完整证据→verifying/failed，**不足→unknown**」。
- 实测（effect 已 `dispatched`，两个端口传同一形状的回执）：

  ```
  reconcileEffect(status=completed, observability=[]) -> EFK_EFFECT_UNKNOWN（保持 unknown）
  applyReceipt   (status=completed, observability=[]) -> OK {"disposition":"applied"}
  replay().unknownEffectIds                          -> []      # 零证据即结算
  ```

- 建议：把证据下限放在 `applyReceiptTo`（两个入口共用），或明确「新到 host 回执自带证据效力」并据此删掉 `reconcileTo` 里的门——现状是同一输入两条路径两种判定，且作者自己的 `DoD2` 测试只覆盖了其中一条。

---

## MINOR

### N1. 事务内容（event/effect/receipt）不做协议解码，冻结枚举外的对象可原样入库

- 位置：`src/storage/store-session.ts:166-186`（`commitBatch` 直接遍历 drafts）、`planEffects`/`planReceipts`；对照 `memory-event-store.ts:164`（`createSession` 解码并门禁 `protocol`）与 `memory-artifact-store.ts:30`（`put` 解码 `ArtifactRef`）——同一层里三个边界三种做法。
- 实测：

  ```
  append type="not.a.real.event"                     -> OK committed；exportSession().events[0].type 原样保存；replay 静默忽略
  effect.protocol.schemaVersion="1.0.0"（会话 1.1.0） -> OK committed
  receipt.protocol.schemaVersion="1.0.0"             -> applyReceipt OK；exportSession().receipts[0].protocol.schemaVersion = "1.0.0"
  ```

  `Event.type` 在 `SCHEMAS $defs` 是 17 值封闭枚举，DoD① 也要求「版本不兼容…有明确定义」。当前只对**事件**的 protocol 做了比对（`draft.protocol` vs `session.protocol`），effect/receipt 的 `protocol` 完全不查。
- 建议：明确边界。若认为「store 信任 TS 调用方、wire 解码属协议层」，请在 `contracts.ts` 注明；若认为 store 是本层边界，则对该三类对象调一次 `decode(...)` 并用其错误码。

### N2. 已提交的 receipt 不能只被事件引用（要求同一事务再带一份内容）

- 位置：`src/storage/store-session.ts:145-147`
  `for (const receiptId of referenced) if (!receipts.some(r => r.receiptId === receiptId)) return storeFail(EFK_INVARIANT_VIOLATION, ...)`
- 实测：先 `applyReceipt` 提交 `r0`，再 append 一条引用 `r0` 的 `receipt.applied` 事件但不再传 receipt 内容 → `EFK_INVARIANT_VIOLATION: receipt event references r0 but the content is not in this transaction`。内容其实已提交（`session.receipts.has('r0')`），此处只认事务内副本。
- 建议：把 `session.receipts.has(receiptId)` 也算满足引用。

---

## NIT

- `src/storage/index.ts:5` 宣称「nothing here is constructed or executed on import」，但 `memory-artifact-store.ts:22` 有模块级 `const encoder = new TextEncoder();`。它是纯分配（非 I/O/时钟/随机），不构成 `I04` 违规，只是该句不准确。
- `src/storage/identity.ts:22-27` 的 `canonical` 把 `undefined`/`NaN`/`Infinity` 都渲染成 `'null'`（`JSON.stringify(NaN) === 'null'`），因此 `{a: null}`、`{a: undefined}`、`{a: NaN}` 同摘要。协议值均为 JSON 合法值，属潜在而非可达；若要收紧可对非有限数显式报错。
- `memory-snapshot-store.ts:88-99` 的 `save` 不校验 `input.projection.lastSequence === input.sequence`，只在校验 `recover`（`:67-68`）时才拒。做法可辩护（recover 是门），但值得在 `contracts.ts` 写一句「save 不做一致性校验，recover 才校验」。

---

## 已核对、确认无误的部分

1. **字段名与端口语义**：`contracts.ts` 不重命名任何字段，全部经 `Decoded<K>` 从协议表推导；逐字核对 `Event`/`EventPayload`/`Effect`/`EffectPayload`/`Receipt`/`Usage`/`Binding`/`ArtifactRef`/`NodeStateEntry`/`ProtocolVersion` 的字段名、必填性与 `SCHEMAS.md $defs` 一致。`ReceiptInput.objectRef.id === receipt.receiptId` 的绑定检查存在。
2. **错误码来源**：`src/storage/**` 共用 14 个 `EFK_*`，全部存在于 `SCHEMAS.md $defs.ErrorCode.enum`（无自造码）；`createSession` 对 `evofence.runtime/9`／`2.0.0` 返回 `EFK_PROTOCOL_UNSUPPORTED`；`EFK_RECEIPT_STALE` 未被使用（与「归档是 disposition 不是报错」一致，但配合 B1 目前不可达）。
3. **不变量 4/5/6**：`planEffects` 强制每个 effect 与本事务内**恰好一条** `effect.intended` 同批提交（缺内容 / 内容缺 intention 均 `EFK_INVARIANT_VIOLATION` 且不推进 revision）；重复 `requestId` 回报 `duplicate` 而不二次归约；`effect.dispatched` 后进入 `unknownEffectIds` 且 `nextEffects` 不再返回；`replay` 不产生任何写入（重复 replay 后 `nextEffects` 仍为原集合）。
4. **不变量 9 / S25**：`recover` 先用 journal 重算前缀（`verifyProjection` 对 `snapshot.projection` 做 canonical 全量比对），再 `replay(tail, snapshot.projection)` 续算；伪造的缓存投影（`state: 'succeeded'`）被 `EFK_INVARIANT_VIOLATION` 拒绝；`sequence` 越界与 `projection.lastSequence ≠ sequence` 各自报 `EFK_RECOVERY_SEQUENCE_GAP`。
5. **reducer 连续性**：`replay` 拒绝 sequence 缺口（`EFK_RECOVERY_SEQUENCE_GAP`）、revision 跳变与 `node.transition` 的 `before ≠ 上一状态`（`EFK_INVARIANT_VIOLATION`），且不依赖任何缓存。
6. **ArtifactStore**：内容寻址（`digest.digest(bytes) === ref.digest`）、id 不可变（同 id 异 digest 拒绝不覆盖）、`get` 的 digest 再绑定检查、S01 的 1 MiB 上限与 locator 凭据正则、`put`/`get` 先 `decode('ArtifactRef', ...)`。
7. **ambient 副作用（轴 4）**：`src/storage/**` 内 `Date.now`/`new Date`/`Math.random`/`node:crypto`/`fs`/`process.env`/`console.*` **零命中**；29 处 import 说明符全部相对（5 处 `../protocol/index.js`，其余同目录），模块顶层无 `let`/`var`、无 I/O、无单例；`DigestPort` 为显式注入，`identity.ts` 只做 canonical 序列化不选哈希。
8. **负控可证伪**：禁用 CAS 守卫后 2 条测试（含作者命名的 `negative control: the CAS guard is not a no-op`）变红，重建后产物 sha256 逐字节复原 —— 门禁不是同义反复。
9. **lane 状态复原**：复核结束时 `git status` 与 12 个文件的 sha256 与开工记录完全一致，36/36 通过。（`scripts/check-core-imports.mjs` 与 `test/protocol-guard/**` 未审，其绿灯未作为本报告证据。）

## 附：节点状态备注（不属评审结论）

图 `evofence-harness-kernel` 中 `l2_state_store` 仍为 `status: pending`、`ready_gate` 未满足（`depends_on l2_public_contracts` 仍 running），cp1/cp2/cp3 均 pending；产物存在于旁路 worktree。是否认领/流转由编排方决定，本复核只读取产物。
