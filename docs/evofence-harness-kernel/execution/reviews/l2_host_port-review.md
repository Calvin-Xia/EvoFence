# 交叉复核：`l2_host_port`（lane `hostport`）

- 复核者：`review-1`（独立 pane，非作者）。lane 源码只读；仅在**编译产物 `dist/`** 上做过 4 次可恢复的负控变异，每次均字节复原（证据见下）。
- 复核对象：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\hostport`，分支 `refactor/hk-hostport`，基线 `d47f0ca`，untracked。
  交付：`src/runtime/host-port/**`（8 文件，最大 240 行）+ `test/l2-hostport-contract.test.js`（20 例）。
- **lane 与集成副本一致性**：`src/runtime/host-port/**` 8 文件 + 1 测试，与 `…\72a4\EvoFence\` 下同路径 **逐个 sha256 相同**；集成分支含 `6e79b5e L2 l2_host_port: host-port ports, receipts/delegation + fake host + 20 tests`（其后已推进到 `12ed81b`，与本 lane 无关）。
- 契约真相源：`spec/contracts/INTERFACES.md`（§3 `HostPort` 行、§5 `stale receipt` 行）、`SCHEMAS.md`（`Effect`/`Receipt`/`Usage`/`Scope`/`BudgetPolicy`/`Grant`）、`ERRORS.md`、`HOST-MAPPING.md`（能力矩阵）、`execution/L1-REPLAN-DECISION.md`（R6/R7）、`tasks/L2-wave2-brief.md` §6。
- 未碰：`.graph/`、集成 worktree 的 `src/`、`scripts/**`、其他 lane。未跑全量 `npm test`。

## 结论

**需修订（blocker 1）** —— DoD① 的四关联、DoD② 的 typed unsupported / 不伪造完成、inv5/6/10、grant 只收缩、R7 信任域、ambient 注入等**均实测通过**；但有一处**契约违反**：`cancelRequirements` 把 `parentChildCancellation` 做成 ≥2 目标的**硬门**，使两宿主的**多目标取消恒返回 `EFK_CAPABILITY_UNSUPPORTED`**，与 R6「父子取消不作 task hard；取消未确认记 `EFK_CANCEL_UNCONFIRMED` 且保持 `unknown`」相反，且正是 R6 理由里被否掉的"双宿主 unsupported"后果。

## 实测命令与结果

```
# lane 内
npm run build                       # tsc → exit 0
node --test test/l2-hostport-contract.test.js
#   ℹ tests 20 / ℹ pass 20 / ℹ fail 0

# lane vs 集成副本
sha256sum src/runtime/host-port/*.ts test/l2-hostport-contract.test.js   # 9/9 与集成副本相同
```

负控（4 次，均改 **编译产物** → 测试变红 → 字节复原；`dist` 三个文件 sha256 复原为 `873b47bb…`/`ea8723ad…`/`2c35c82a…`，脚本末行 `ALL DIST BYTES RESTORED: True`）：

| 变异 | 期望变红的用例 | 实测 |
|---|---|---|
| `capabilityGate` 恒 `ok(true)` | DoD② 全部 | `tests=20 pass=15 fail=5`（`DoD ②: an unprovable capability is typed unsupported and records nothing`、`DoD ② negative control: the gate reads the matrix…`、`DoD ②: a partial guarantee…`、`DoD ②: a cancel that needs a cascade…`、`context injection … refuses a demand it cannot meet`） |
| `cancel` 把 unconfirmed 当 cancelled | R6 | `pass=19 fail=1`（`R6: an unconfirmed cancel stays unknown…`） |
| `verifyEffect` 跳过 budget 关联 | DoD① 关联 | `pass=19 fail=1`（`DoD ① negative controls: each association can actually fail`） |
| 去掉 `execute` 的 receipt 缓存短路 | inv5 只应用一次 | `pass=19 fail=1`（`invariant 5: a re-delivered request applies once…`） |

复核结束时 lane `git status` 与开工一致（`?? src/runtime/`、`?? test/l2-hostport-contract.test.js`），9 个文件 sha256 与开工记录逐字节相同，`node --test` 回到 20/20。

---

## BLOCKER

### B1. 多目标取消被硬门挡成 `EFK_CAPABILITY_UNSUPPORTED`，违反人审 R6

- 位置：`src/runtime/host-port/capabilities.ts:125-135`（`cancelRequirements`），经 `:172`（`requiredCapabilities` 对 `host.cancel`）供 `host-fake.ts` 的 `cancel` 与 `execute` 共用：
  ```ts
  if (targetCount > 1) requirements.push({ capability: 'parentChildCancellation', accepts: VERIFIED, because: 'stopping more than one target needs a cascade the host has to confirm' });
  ```
- 契约：`L1-REPLAN-DECISION.md` **R6**（H13, accept-proposal）——「`parentChildCancellation` 与 `toolCancellation` **不作为 task hard**。取消未确认记 `EFK_CANCEL_UNCONFIRMED` 并**保持 `unknown`**；lease 释放与 unknown 核实不以前提级联成立。**理由：(b) 会要求两宿主补真实长流/子成员取消取证…将导致相关任务双宿主 unsupported**」；`L2-wave2-brief.md` §6 复述同一裁定。
- 实测（目标均已 execute 过，属真实可达输入）：
  ```
  dsh.cancel(['e-a','e-b'])   -> EFK_CAPABILITY_UNSUPPORTED :: dsh cannot satisfy parentChildCancellation —
                                 parentChildCancellation observed unknown (needed verified)
  pi.cancel(['e-a','e-b'])    -> EFK_CAPABILITY_UNSUPPORTED :: … observed unknown …
  dsh.execute(host.cancel, targetIds:['e-a','e-b']) -> EFK_CAPABILITY_UNSUPPORTED
  对照 dsh.cancel(['e-a'])    -> OK {"status":"unknown", error: EFK_CANCEL_UNCONFIRMED}   # R6 路径本身正确
  ```
  DSH 矩阵该键 `unknown`、Pi 无该键（→ `unknown`），因此**两宿主的任何 ≥2 目标取消都无法进行**，per-target 的 `unconfirmed → unknown` 语义在真实多节点子图场景下**不可达**。作者自己的用例 `DoD ②: a cancel that needs a cascade the host never proved is unsupported` 把这个行为钉死了。
- 为什么算契约违反：R6 的裁定与理由都指向"不要让父子取消把双宿主挡成 unsupported"；实现把这个能力提升为**取消操作的前置硬门**，等价于把 R6 否掉的 (b) 结论落到取消路径上。另注：R6 的另一半 `toolCancellation` 实现**没有**被硬门使用（`grep -rn toolCancellation src/runtime/` 只命中矩阵那一行），所以两侧处理不对称。
- 建议：从 `cancelRequirements` 去掉内置的 `parentChildCancellation` 要求（若某些调用方确实需要级联确认，改由调用方通过 `AuthorizedEffect.demands` / 显式参数声明，而不是对"目标数>1"一律硬卡），让 `sdkAbort` 之后的 per-target 判定自行给出 `native-ack` / `not-executed` / `unconfirmed`，未确认即 `EFK_CANCEL_UNCONFIRMED` + `status:'unknown'`。相应把那条用例改成断言"多目标取消返回 unknown 且逐目标给出 confirmation"。

## MAJOR

### M1. `verifyReceipt` 的 stale 判定漏了 `binding.baseDigest`，与 `INTERFACES §5` 的 `epoch/attempt/base/fencing` 不符

- 位置：`src/runtime/host-port/verify.ts:101-108`
  ```ts
  const sameBinding = receipt.binding.epoch === effect.binding.epoch
    && receipt.binding.attemptId === effect.binding.attemptId
    && receipt.binding.attemptOrdinal === effect.binding.attemptOrdinal;
  ```
- 契约：`INTERFACES.md:160`「stale receipt | **epoch/attempt/base/fencing 不匹配**仅 `receipt.archived`；保留证据，不写当前产物/资格、不再次结算」；`ERRORS.md` `EFK_RECEIPT_STALE | 旧 epoch/attempt/fencing 回执；归档不应用`。
- 实测：
  ```
  effect.binding.baseDigest = null，receipt.binding.baseDigest = sha256:bbbb…（epoch/attempt 相同）
      -> disposition = 'current'        # 应 'archived'
  对照：receipt.binding.epoch = 4（epoch 前进）
      -> disposition = 'archived'       # 已实现的那一路正确
  ```
  即同 attempt 但**换过 workspace base** 的回执会被判为可应用。用例 `stale receipts are archived…` 只变了 `epoch`，`base` 无覆盖。
- 建议：`sameBinding` 加入 `baseDigest`（以及可选的 `hostSessionId`），任一不符即 `archived`；并在该用例里补一条只差 `baseDigest` 的负例。

## MINOR

### N1. `replayView` 的 `unknowns` 可能重复，把同一 effect 计两次

- 位置：`src/runtime/host-port/replay.ts:30`（`unknowns.push(record.effectId)`，只在最后 `sort()`，不去重）。
- 实测：`replayView([{effectId:'e-dup',receipt:{status:'unknown'}}, {effectId:'e-dup',receipt:{status:'unknown'}}]).unknowns` → `["e-dup","e-dup"]`。
- 影响：该列表是"待 reconcile 清单"，重复会让调用方对同一 effect 发起两次核实。当前 `fake.journal()` 每 effect 只有一条，所以走不到，但 `replayView` 是导出 API，输入是任意 `CommittedRecord[]`。
- 建议：改为 `Set`/按 `byEffect` 收口后再筛 `unknown`。

## NIT

- `src/runtime/host-port/capabilities.ts:110` 在**模块作用域调用函数**（`'host.reconcile': reconcileRequirements()`），而 `index.ts` 与 `types.ts` 的注释宣称 "nothing here is constructed or executed on import"。该调用是纯本地构造（不读端口、不 IO），不构成 I05 违规，只是说法不精确——建议改成惰性/内联，或把注释改成"无端口/IO 的静态初始化"。
- `src/runtime/host-port/usage.ts:57` 的 `usageIsComplete` 只实现了 `S15` 的 `reasoning ≤ output` 一项；`total` 与各分项的一致性、cache 分账未校验。`L2-wave2-brief` 把 `UsageCompleteness` 划给 policy lane，此处可能是**有意的最小实现**——建议在该文件注释里点明"完整 S15 算术在 policy lane"，避免下游误以为已全量校验。
- 观察项：`verifyEffect` 对 `binding.epoch` 只做**下界**关联（`epoch < grant.issuedEpoch` → `EFK_AUTHORITY_DENIED`），无上界；实测 `epoch=9999` 对 `issuedEpoch=1` 的 grant 被接受。会话当前 epoch 的权威属 `l2_state_store`/调度层，故按设计成立，仅记录。

---

## 已核对、确认无误的部分

1. **契约字段名**：`types.ts` 全部经 `Decoded<K>` 从冻结表取，未改名；`Effect`/`Receipt`/`Usage`/`Scope`/`BudgetPolicy`/`Grant`/`Binding` 的字段与 `SCHEMAS.md $defs` 一致；`DelegationGrant`/`AuthorizedEffect` 是**派生的只读视图**而非第二套线格式（与 `INTERFACES §3` 的 "AuthorizedEffect…不是另一种线格式" 一致）。
2. **错误码**：`src/runtime/host-port/*.ts` 共用 **13 个 `EFK_*`，全部存在于冻结 `ErrorCode` 枚举**（无自造码），且每个都能在 `ERRORS.md` 找到（已逐个列出 retry 类别）；所有业务失败走 `src/protocol/errors.ts` 的 `fail`，**没有第二套错误封套**（`types.ts` 的 `HostResult` 错误臂就是 `ErrorEnvelope`）。
3. **DoD②「typed unsupported，不伪造完成」**：`capabilityGate` 在任何原生调用**之前**执行；实测不支持的效果返回 `EFK_CAPABILITY_UNSUPPORTED` 且 `stats().invocations === 0`、`receiptFor(...) === null`。负控（把 gate 短路成恒真）令 5 条用例变红，证明门是有效判据而非同义反复。
4. **能力矩阵不是"更乐观的转述"**：用例逐键对比 `probes/{dsh,pi}/HOST-MANIFEST.json` 的 `capabilities`，并核对 DSH `unknown` 计数 = 13；`capabilityStatus` 对未知键返回 `unknown`（绝不 `verified`）。我另行确认 `TEAM`/`harness` 侧没有把 `parentChildCancellation`/`toolCancellation`/`osSandbox`/`diskCrashRecovery` 写成 verified。
5. **DoD① 四关联**：`verifyEffect` 先 `decode('Effect', input)`（`input` 为 `unknown`），再绑 epoch（对 grant `issuedEpoch` 下界）、authority（`authorityRef` → 存在且 live 的 grant，revoked/expired 分别 `EFK_GRANT_REVOKED`/`EFK_GRANT_EXPIRED`）、budget（billable 三类必须 `reservationRef != null`，否则 `EFK_BUDGET_NOT_AUTHORIZED`）、以及 `host.activate` 必须有 lease。负控（跳过 budget 检查）令该用例变红。
6. **不变量 5/6**：同 `idempotencyKey` 重复投递只应用一次（`invocations` 不增、`receiptId` 相同）；不同 effect 复用 key → `EFK_IDEMPOTENCY_COLLISION`；同 key 不同 payload → `EFK_IDEMPOTENCY_COLLISION`；已 `unknown` 的**非幂等**效果不盲重试 → `EFK_EFFECT_NON_IDEMPOTENT_RETRY`；`reconcile` 只读回证据、**不增加 invocation**，"无证据 → `EFK_EFFECT_UNKNOWN` + verdict `unknown`"。负控（去掉 receipt 缓存）令 inv5 用例变红。
7. **不变量 10 / 确定性**：`replayView` 签名里根本没有 `HostPort`，结构上不可能派发；用例用 `stats().invocations` 前后相等作证据，并另跑一次新效果证明计数器是活的。
8. **R7 与 grant 只收缩**：`scopeWithin` 要求子范围 ⊆ 父范围且 `trustDomain` **必须相等**（隔离不得"看起来变强"）；`workspaceWithin` 不允许凭空造 locator；`budgetWithin` 要求同 pool/同 category 且各上限递减（`null` 父 = 无上限，不能给有上限的父配无上限的子）；depth 严格递减、并发 1..parent、expiry 不得超出父；`delegate` 不铸造权限根（注释与代码一致，符合 A06）。全部 growth 路径都有用例且实测被拒。
9. **ambient 副作用 / 顶层纯净**：`grep -rnE "Date\.now|new Date|Math\.random|node:crypto|from 'node:|require\(|process\.env|readFile|writeFile|fetch\(|console\.|performance\." src/runtime/` → **零命中**；Clock 为注入接口；全部 import 是相对说明符（`../../protocol/index.js` 与同目录），模块级无 `let/var`、无单例、无默认 backend；`createFakeHost` 是唯一构造入口。
10. **R6 的正向部分**：单目标 unconfirmed 取消确实返回 `status:'unknown'` + `EFK_CANCEL_UNCONFIRMED` + `observability: []`，已派发目标的 `not-executed` 目标返回 `cancelled`；负控（把 unconfirmed 伪报成 cancelled）令该用例变红。

## 遗留清单（按优先级）

1. **[BLOCKER]** B1：去掉 `cancelRequirements` 对 `parentChildCancellation` 的硬门（或改为调用方显式声明），并按 R6 重写那条用例。
2. **[MAJOR]** M1：`verifyReceipt` 的 `sameBinding` 补 `baseDigest`。
3. **[MINOR]** N1：`replayView` 的 `unknowns` 去重。
4. **[NIT]** 模块级函数调用与"import 无副作用"措辞；`usageIsComplete` 的范围说明。
