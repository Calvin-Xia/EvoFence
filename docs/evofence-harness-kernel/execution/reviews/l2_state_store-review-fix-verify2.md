# 交叉复核（第三轮）：`l2_state_store` 残留修复 — 独立第二双眼

- 复核者：新 pane / 新 tab，独立于作者与上一轮复核者；未参与本节点写作。只读源码，唯一写入是本报告。
- 复核对象（集成分支）：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，分支 `refactor/harness-kernel`，`HEAD = 2dafafc`（L2 l2_state_store: pre-simulate the outbox projection at append + accurate boundary comment (46 tests)）。
- 上一轮报告与两处残留：`docs/evofence-harness-kernel/execution/reviews/l2_state_store-review-fix-verify.md`（残留 1：预演只跑 journal reducer，不跑 `projectOutbox`；残留 2：`contracts.ts` 边界注释不准确）。
- lane 副本：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\store`，本条任务声称已同步。
- 方法：不采信自报；独立重跑两条残留的反例形状、独立负控（源代码级回退）、边界探针与过拒绝探针。复现脚本写在仓库外（`C:\tmp\store-reverify2\*.mjs`），未入库。

## 结论

**可接受。** 上一轮两处残留均已按声称修复：`commitBatch` 现对候选状态跑一次 `projectOutbox` 预演，两条反例都被 `EFK_INVARIANT_VIOLATION` 拒绝且拒绝后状态零变化；`contracts.ts` 边界注释已重写且与实现逐条吻合，并如实写明 `Event.type` 封闭枚举未在 store 侧强制。

| 上一轮残留 | 本轮状态 |
|---|---|
| 残留 1：`append` 可提交让读端口永久 `EFK_INVARIANT_VIOLATION` 的事务 | **已修复（可接受）** |
| 残留 2：`contracts.ts` 边界注释不准确 + `Event.type` 未强制未如实写明 | **已修复（可接受）** |

无新增 blocker；B1/B2/M1/M2/N2/NIT 无回归。剩余的 `Event.type` 不强制属**已文档化的设计选择**（caller obligation），非缺陷。

## 环境与一致性（开工/收工）

```
git -C <integration> rev-parse HEAD          # 2dafafca46ea88ae663ff95341fca2d09969cd1a
sha256sum src/storage/*.ts test/l2-store-*.test.js    (integration)  ==  (lane)   # 12/12 逐字节一致
git diff --stat -- src/storage/              # 空（收工复核时仍为空）
```

| 文件 | sha256（前 12 位，integration == lane） |
|---|---|
| src/storage/contracts.ts | 7fd91fead352 |
| src/storage/identity.ts | 5608b42054a7 |
| src/storage/index.ts | b08498eed4f8 |
| src/storage/memory-artifact-store.ts | 13dbb8ab131e |
| src/storage/memory-event-store.ts | 5889eb20bc61 |
| src/storage/memory-snapshot-store.ts | 2b4d28343544 |
| src/storage/outbox.ts | 70817546bc15 |
| src/storage/projection.ts | 32415e99838b |
| src/storage/store-session.ts | 6d19869c3552 |
| test/l2-store-artifacts.test.js | 14ca09d9e3c7 |
| test/l2-store-journal.test.js | 63e88af1dda0 |
| test/l2-store-recovery.test.js | 4b2fd3cc8abd |

## 1) 构建与测试（任务点 1）

```
npm run build                                        # tsc, exit 0
node --test test/l2-store-*.test.js
#   ℹ tests 46 / pass 46 / fail 0 / cancelled 0 / skipped 0 / todo 0
```

与自报一致（`test/l2-store-*.test.js` 命中 3 个文件）。

## 2) 两条残留反例独立重跑（任务点 2）

独立脚本 `C:\tmp\store-reverify2\repro.mjs`（在 `dist/storage/index.js` 上跑，非测试文件复用）。每条形状：先快照 `exportSession` / `replay` / `outbox` / `nextEffects` 的 JSON，再 `append`，断言错误码，再对快照做 `deepEqual`，最后断言 store 未被卡死。

```
shape1  append([effect.dispatched fx1] 无 intention)
        -> EFK_INVARIANT_VIOLATION - "effect fx1 was dispatched without a committed intention"
        -> exportSession/replay/outbox/nextEffects 与拒绝前逐字段一致（deepEqual PASS）
        -> 随后 requestId=c1b / rev0 的合法 append 仍成功（未被卡死）
shape2  append([receipt.applied r1] + receipt 内容，无 effect)
        -> EFK_INVARIANT_VIOLATION - "receipt for unknown effect fx1 in ra1"
        -> 状态逐字段不变（deepEqual PASS）；随后合法 append 仍成功
control intend->dispatch->receipt 正常流程仍提交，outbox.entries[0].state=dispatched（未过度收紧）
extra   effect.intended 重复提交已被拒（"fx1 ... already committed" 族），与预演一致
```

`ALL REPRO CHECKS PASS`。即：一个公开 `append` 不再能把 session 提交进「所有读端口永久失败」的状态；被拒批次零副作用，符合不变量 4/5/6。

**过拒绝探针**（`overreject.mjs`，确认新的 `projectOutbox` 预演不会误杀合法同批事务）：
```
same-batch [intended, dispatched] + effect 内容                -> committed, outbox=dispatched
same-batch [intended, dispatched, receipt.applied] + 内容      -> committed, outbox=resolved
same-batch [intended, dispatched] + archived receipt           -> committed
NO OVER-REJECTION
```

## 3) 负控：新测试确实负载（任务点 3）

```
git checkout 2dafafc^ -- src/storage/store-session.ts     # sha 8b19ed287786（= 预演前的实现）
npm run build                                              # OK
node --test test/l2-store-journal.test.js
#   ℹ tests 20 / pass 18 / fail 2
#   ✖ cp2 a dispatched effect with no committed intention is refused by the pre-simulation
#   ✖ cp2 a receipt with no committed effect is refused by the pre-simulation
node messages.mjs (在该旧产物上)
#   shape1: OK (committed!)        # 与上一轮报告一致：旧代码确实提交
#   shape2: OK (committed!)
git checkout 2dafafc -- src/storage/store-session.ts       # sha 6d19869c3552（= 修复实现）
npm run build                                              # OK
node --test test/l2-store-*.test.js                        # 46/46
git diff --stat -- src/storage/                            # 空
```

负控成立：两条新测试恰好是唯一因回退而变红的用例，且回退后正是「提交成功」而非其它错误。

## 4) `contracts.ts` 新注释 vs 实现（任务点 4）

新增边界段逐句核对（全仓 `grep decode` 与探针）：

| 注释宣称 | 实现事实 | 判定 |
|---|---|---|
| 除两处外不重新 decode | 全 `src/storage` 只有两个 decode 呼叫点：`memory-event-store.ts:169` `decodeProtocolVersion(input.protocol)`、`memory-artifact-store.ts:30,53` `decode('ArtifactRef', rawRef)` | 准确 |
| 例外 1 `CreateSessionInput.protocol` 是真实边界输入 | 类型为 `unknown`，`createSession` decode + `gateRuntimeVersion` | 准确 |
| 例外 2 传给 artifact store 的 `ArtifactRef` | `put`/`get` 各自 `decode('ArtifactRef', ...)` | 准确 |
| 持久化边界校验：identity / protocol version / ArtifactRef schema+digest / journal continuity，**不是** event/effect/receipt 的 schema shape | `commitBatch` 校验 eventId/effectId/receiptId 唯一、request digest、`canonical(protocol)`、revision/epoch/sequence；artifact store 校验 digest 绑定与不可覆盖；确无 event/effect/receipt 形状 decode | 准确 |
| effect/receipt 内容额外做 protocol 版本门 | `commitBatch` 两个 `canonical(...) !== canonical(session.protocol)` 循环 | 准确 |
| **封闭 `Event.type` 枚举是 caller obligation，不是 store 侧 decode** | `SCHEMAS.md:67` `Event.type` 是 17 值封闭枚举（"封闭事件目录"）；探针：`append type="not.a.real.event"` → **COMMITTED rev=1**，`exportSession().events[0].type` 原样保存，`replay` 绿。即**确实未强制** | **准确且如实写明** |

结论：残留 2 修复到位 —— 上一轮的失实表述（"every port signature takes `Decoded<K>` / does not re-decode"）已被纠正为显式例外清单，且最要害的「`Event.type` 未强制」被主动写进注释，文档不再是比实现更强的承诺。

非阻断的细微措辞：`ArtifactStore.put(ref, bytes: string)` 与 `SnapshotInput.projection: ReplayState` 并非 `Decoded<K>`（raw bytes / 已投影对象），注释首句「port signatures take `Decoded<K>`」是面向 wire 对象的概括；两处 decode 例外（protocol / ArtifactRef）这个实质已覆盖，不影响准确性判定。

## 5) 上一轮已接受修复无回归（任务点 5）

同一套件内命名的回归测试全部为绿：

```
test/l2-store-journal.test.js:346  BLOCKER fix B2: a non-advancing epoch change is refused at commit, keeping the journal replayable
test/l2-store-recovery.test.js:405 BLOCKER fix B1: a receipt bound to a different attempt is archived, never applied
test/l2-store-recovery.test.js:417 BLOCKER fix B1: a receipt bound to a different base or host session is archived too
test/l2-store-recovery.test.js:437 MAJOR fix M1: an old-epoch intention is stale, never advertised as sendable
test/l2-store-recovery.test.js:456 MAJOR fix M2: applyReceipt shares reconcileEffect evidence floor
test/l2-store-recovery.test.js:470 MINOR fix N2: an already-committed receipt can be referenced without re-supplying it
test/l2-store-recovery.test.js:483 MINOR fix N1: receipt content is version-gated against the pinned session protocol
# 连同两条新 pre-simulation 用例，46/46 pass
```

NIT1/2/3：`identity.ts`（NIT2）与 `index.ts`（NIT1）的 sha256 与上一轮已验轮次逐字节相同（`5608b42054a7` / `b08498eed4f8`），无触碰；`contracts.ts` 本轮改动经 `git show 2dafafc` 确认仅限边界注释段，NIT3 的 `SnapshotStore.save` 注释（`contracts.ts:213` 附近）完好。无回归。

## 范围与纪律

- 未跑全量 `npm test` / `test:e2e`；未改 `.graph`；未 commit；未动 lane 或其它 lane；收工 `git diff --stat -- src/storage/` 为空。
- 负控期间的源码回退已按 `2dafafc` 还原并重新 build，最终工作区与 `2dafafc` 对 `src/storage` 无差异。
