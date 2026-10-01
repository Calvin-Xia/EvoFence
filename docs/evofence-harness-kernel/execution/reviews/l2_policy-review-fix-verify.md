# l2_policy 返工修复复验（review-fix-verify）

日期：2026-10-01 · 复验者：独立复核 pane（非作者、非原复核者）· lane：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\policy`（分支 `refactor/hk-policy`，基线 `d47f0ca`，产物 untracked）
原复核：`l2_policy-review.md`（结论「可接受」，minor-1 / nit-1 / nit-3 本轮返工）
集成副本：`.codex\worktrees\72a4\EvoFence` commit `4f5037e`（`L2 l2_policy: review fixes — reserve/settle value-domain gates, no dead defaults, unknown-source usage conflict (64 tests)`）

## 0. 结论

**接受（accept）**。3 条返工全部独立复现：修复代码形态与行为一致，36/36 独立探针通过，lane 内 `build` exit 0、`l2-policy-*` 64/64 绿。修复是**真门禁**而非 no-op——对修复前产物做等价变异后，4 个原漏洞全部复现（见 §4）。未发现顺手改坏的其它语义。

---

## 1. SHA256 一致性核对（先核对，再实测）

lane 与集成副本 commit `4f5037e` 逐字节一致（`git show 4f5037e:<path> | sha256sum` == lane 工作区）：

| 文件 | 集成副本 @4f5037e = lane |
|---|---|
| `src/kernel/policy/budget.ts` | `66b2884023bc73ae7941eda22c8dd00ebaec83da36732c1defb460d1e007d18d` |
| `src/kernel/policy/usage.ts` | `b84245bc89d437f7cce505ddd913304df8c40cfedd9ec7c77f9377e0804e616d` |
| `test/l2-policy-budget.test.js` | `532f639c5addd3e29acec1f7f0b40edc74ad646d2c72c5bfb0a6e5dbc879b26e` |
| `test/l2-policy-usage.test.js` | `d8d0a9f9257cb5027ea2156f8d387b0b1037b011bc290ac53d880bc050d30d6f` |

复验结束后 lane 4 文件 sha256 与开始时逐字节一致（复验只读；两个临时探针脚本已删除，`git status` 恢复为原 7 条 untracked）。环境：Windows、Node v24.12.0。

---

## 2. 逐条状态

| # | 问题 | 修复 | 独立判定 |
|---|---|---|---|
| minor-1 | `openBudgetLedger` 不校验 `reservePerRequest` 数值域；`settle`/`releaseUnspent` 接受负 micros | `open`：`!Number.isSafeInteger(x) \|\| x < 1` → `EFK_BUDGET_ENVELOPE_INCONSISTENT`；`settle`/`release`：`!Number.isSafeInteger(x) \|\| x < 0` → `EFK_SCHEMA_INVALID`，拒绝时返回**同一 ledger 实例** | ✅ 已修复 |
| nit-1 | `usage.ts` 两处死默认 `?? 0` | `sum()`：先 `some(null)` 短路 → `filter` 类型收窄 → `reduce(...,0)`（去 `?? 0`）；`knownMicros`：`expected.reduce((t,id)=>t+byRequest.get(id)!.estimatedUsdMicros!, 0)`（去 `?? 0`） | ✅ 已修复（非 no-op，见 §3/§4） |
| nit-3 | `complete===true && source==='unknown'` 被当真实测量 | `normalizeUsage` 新增 `EFK_USAGE_CONFLICT`；`usageCompleteness.incompleteRequestIds` 追加 `source==='unknown'`，`knownMicros` 不计入 | ✅ 已修复 |

范围外未动：minor-2（provider-live 与任务条件比对，schema 无字段）、minor-3（cached/uncached 分账）、nit-2（risk 测试注释顺序）、nit-4（approvalRef 绑定比对）——本轮按要求未改。

---

## 3. 独立探针（未复用作者测试）

`node .probe-fix-verify.mjs`（直连 `dist/kernel/policy/index.js`，36 项断言）：

```
$ node .probe-fix-verify.mjs
PASS  openBudgetLedger refuses reservePerRequest=0            # 及 -1 / -0 / 1.5 / NaN / ±Infinity / 2**53
PASS  openBudgetLedger(policy, 9547) is ok and freezes reservePerRequest
PASS  reserve r1 leaves outstanding 9547
PASS  settle rejects micros=-1 with EFK_SCHEMA_INVALID and unchanged ledger   # 及 -0.5 / 1.5 / NaN / Infinity / 2**53
                                                   #   -> 返回同一 ledger 引用，snapshot settled=0 outstanding=9547
PASS  releaseUnspent rejects confirmedUnspentMicros=-1 and unchanged ledger   # 及 -0.5 / 1.5 / NaN / Infinity / 2**53
PASS  settle with a positive amount settles normally (9547)    # remaining = 190940-9547
PASS  settle with 0 is accepted（零是真实测量，非缺失）
PASS  settle incomplete (null micros / complete:false) retains reservation
PASS  releaseUnspent legal path unchanged (2000 -> spent 7547；0 -> 9547；999999 -> 0)
PASS  releaseUnspent(null) still EFK_CANCEL_UNCONFIRMED and retains
PASS  normalizeUsage({complete:true, source:"unknown"}) -> EFK_USAGE_CONFLICT
PASS  usageCompleteness excludes unknown-source from knownMicros（complete=false, knownMicros=null）
PASS  complete usage with numeric counts (micros 9547, inputTokens 100, output 50)
PASS  complete usage with explicit zeros keeps 0（0 不被当 null）
PASS  complete usage with a null required count -> EFK_USAGE_INCOMPLETE（4 个必填字段逐一）
PASS  incomplete usage with estimatedUsdMicros:0 -> micros null（零估计不等于免费）
PASS  usageCompleteness knownMicros 仅在全部 expected 齐全时求和（107；缺一即 null）
PASS  an unreserved usage report is still a conflict, not silently summed

PROBE_TOTAL 36 PROBE_PASS 36 PROBE_FAIL 0   exit 0
```

「ledger 不变」用三条独立证据：`r.ledger === 输入 ledger`（同引用，无 mutation）、`JSON.stringify(budgetSnapshot(...))` 前后逐字节相等、`settledMicros`/`outstandingMicros` 数值不变。

---

## 4. 反事实负对照：修复不是 no-op

对修复前等价产物（复制 `dist/kernel/policy`，把 `budget.js`/`usage.js` 中 4 处判定改写为 `if (false)` 并还原 `usageCompleteness` 的 unknown 过滤）运行同一组输入：

```
PREFIX (guards removed)
open(0).ok = true reserve=0                       # 修复前：零预留被接受
settle(-1) error = null settled = [ -1 ]          # 修复前：负结算写账，反而抬高可用余额
release(-1) error = null settled = [ 9548 ]       # 修复前：spent = 9547 - min(9547,-1) = 9548 > 预留
normalize(complete+unknown).ok = true micros=5    # 修复前：未知来源按 5µUSD 结算
PREFIX_HOLES 4/4                                  # 4 个原漏洞全部复现
```

即：新增的 4 条测试/门禁各自对应一个真实可击穿点，比较器可证伪，非永真。恢复正式 `dist` 后探针全绿。

---

## 5. 构建与测试（lane 内）

```
$ npm run build                                   exit 0（tsc，无输出）
$ node --test test/l2-policy-budget.test.js test/l2-policy-usage.test.js
ℹ tests 26   ℹ pass 26   ℹ fail 0   exit 0
$ node --test test/l2-policy-{authority,budget,fixtures,negotiate,risk,usage}.test.js
ℹ tests 64   ℹ pass 64   ℹ fail 0   exit 0
```

tests / pass / fail = **64 / 64 / 0**（budget+usage 子集 **26 / 26 / 0**），与作者自报一致。

---

## 6. 语义回归核对（未顺手改坏）

- `sum()` 去 `?? 0` 后 null 语义不变：任一入参为 null → 整体 `null`；全 numeric（含 0）→ 数值求和；空数组仍返回 `0`（`reduce` 保留初值 `0`），不抛错。
- `normalizeUsage` 的 `complete` 仍要求 `inputUncached/cacheRead/output/total` 全非 null（→ `EFK_USAGE_INCOMPLETE`），`complete:false` 时 `micros/inputTokens/outputTokens` 均为 `null`（零估计不落账）。
- `knownMicros` 的 `byRequest.get(id)!` 依赖「complete 已证明每个 expected 存在于且非 null」不变式；在可达输入上前者行为等同旧 `?? 0`，仅在已被排除的非法态下由静默 0 变为抛错——正是 nit-1 的意图。
- 合法路径逐项复验：`open(9547)`、`reserve` 幂等、`settle` 正数/零、`releaseUnspent` 0/部分/超预留、`releaseUnspent(null)` 均与修复前一致。
- 改动文件内剩余唯一 `??` 为 `budget.ts:207 request.parentRequestId ?? null`（可选入参归一化），非死默认。

---

## 7. 未主张 / 边界

- 本轮只复验 3 条返工；minor-2 / minor-3 / nit-2 / nit-4 仍按原复核记录为未修，不因本轮通过而被视为已解决。
- 未跑全量 `npm test`（按指示，避免既有 `runner.test.js` wall-clock flake 噪声）；lane 内 `l2-policy-*` 全绿已达本节点验收面。
- 未改动 `.graph/`、未提交、未改集成源码。
