# l2_policy 独立交叉复核（review-2）

日期：2026-10-01 · 复核者：review pane（独立，非作者）· lane：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\policy`（分支 `refactor/hk-policy`，基线 `d47f0ca`，产物 untracked）

## 结论：可接受

无 blocker / 无 major。3 条 minor、4 条 nit，均为可加可不加健壮性/一致性问题，不改变任何已声明的合同语义。cp1（权限与协商）、cp2（预留与累计记账）、cp3（缺失信号/超限/取消核验）与 DoD①② 在本轮实测证据下成立。

复核对象：`src/kernel/policy/{authority,negotiate,usage,budget,risk,types,wire,index}.ts`（1102 行）与 `test/l2-policy-*.test.js`（6 个测试文件，runner 计 60 例）。基准：`INTERFACES.md §7`、`CONTRACTS.md §5.3`、`spec/evaluation/METRICS.md §7`、`SCHEMAS.md`、`ERRORS.md`、`OWNERSHIP.md`。

---

## 1. 契约逐条核对

### 1.1 INTERFACES §7 `satisfies(r,m)` 五步（`negotiate.ts:53-83`）

| 契约步骤 | 实现 | 判定 |
|---|---|---|
| 1 缺键按 unknown，不用对端补齐 | `Object.hasOwn` 缺键 → `reason:'missing'`（`SCHEMAS.GuaranteeGap.reason` 枚举含 `missing`，合法） | ✅ |
| 2 只认 `status=verified`；partial 不直接满足原 hard | `observation.status !== 'verified'` → `partial/absent/unknown` 分支；partial 不参与 `alternativeMeets` 之外的直接满足 | ✅ |
| 3 `scope.hostVersion` 与准入版本一致 | `negotiate.ts:66` `observation.scope.hostVersion !== manifest.identity.version` → `reason:'version'` | ✅（provider-live 子句见 minor-2） |
| 4 `r.coverage` 全被 `scope.coverage` 同语义标签覆盖 | `negotiate.ts:67-70` `requirement.coverage.every(tag => coverage.has(tag))` → `reason:'coverage'` | ✅ |
| 5 `r.evidenceKinds` 每一种都有匹配证据 | `negotiate.ts:71-75` 每种 kind 需有 `evidenceRefs.some(ref => ref.kind===kind && ref.claim.length>0)` | ✅（hash/pointer 由 `SCHEMAS.EvidenceRef` 必填+decode 保证，见 nit-4） |
| 6 isolation/cancel/recovery 不做品牌特殊放行 | 无 `identity.host/vendor` 读取（`grep`：只出现 `manifest.identity.version`） | ✅ |

算法骨架与 §7 一致：按 capability 排序、重复 capability 拒绝（`EFK_SCHEMA_INVALID`）、hard 缺口 → `unsupported`、degradable 候选按 `alternativeId` 排序、`replacesCapability`/全 hard/自身满足/无递归/非空 tradeoff、有批准才选中并保留原 gap、技术可行无批准 → `needs-degradation`、`status` 三值派生正确（`negotiate.ts:190-201`）。

### 1.2 CONTRACTS §5.3 预算（`budget.ts`）

- **单一总账 / 先预留后派发**：`openBudgetLedger` 造唯一 pool（`:136`），`reserve` 是唯一扣减入口（`:179`），`settle` 要求 requestId 已预留否则 `EFK_INVARIANT_VIOLATION`（`:226`）。`RequestRole` 覆盖 planner/worker/reviewer/learning/evaluator/repair/compaction/continuation。✅
- **同 requestId 只结算一次**：`settle` 同 digest 幂等、异 digest `EFK_USAGE_CONFLICT`；`reserve` 对已结算/已预留 requestId 无操作（不复制预算）。✅
- **取消只释放已证实未花费**：`releaseUnspent` `null` → `EFK_CANCEL_UNCONFIRMED` 且整笔保留（`:295-300`）；否则 `spent = reserved − min(reserved, confirmedUnspent)`。✅
- **settled+outstanding ≤ cap**：`reserve` 判 `settled+outstanding+reservePerRequest > capMicros`（`:196`），`settle` 后复核（`:245`）。✅
- **缺 usage 保留预留**：`settle` 在 `!complete || micros===null` 时不动 ledger 并返回 `EFK_USAGE_INCOMPLETE`。✅
- **整数微美元 + 向上取整**：`worstCaseRequestMicros` 用 `Math.ceil`（`:37`）；`RESERVE_PER_REQUEST_MICROS = 9547`（`:28`）。
- **包络逐字段精确**：`EVALUATION_ENVELOPES` = S1 20/190940、S2 40/381880、S3 80/763760（`:53-57`）；`checkEnvelope` 精确相乘校验，旧近似值 190900/381900/763800 被拒。我独立复算 `20×9547=190940`、`40×9547=381880`、`80×9547=763760`，及 `60000×140000µ + 4096×280000µ = 9546.88 → ceil 9547` 全部吻合 `METRICS §7.1–7.2`。✅
- **类别授权**：controlled-experiment 无 `authorizationRef`、非 development 无上限、有上限无 `priceRef`、`maxRequests×reserve > maxUsdMicros` 均拒（`EFK_BUDGET_NOT_AUTHORIZED` / `EFK_BUDGET_ENVELOPE_INCONSISTENT`）。✅
- **人审 H11 口径**：自 `l1-freeze.2` 起整数校验、拒绝不自洽包络，与 `INTERFACES §5` / `METRICS §7` 一致。✅

### 1.3 DoD＋人审 R7

- **DoD①「授权不因模板/修图而扩大」**：`intersectScopes` = `root∩parent∩task` 逐字段交集（`authority.ts:52-63`），`deriveAuthority` 用 `scopeViolations` 拒绝任何越集请求（返回 `EFK_AUTHORITY_DENIED` 而非静默裁剪）。negative control 测试 `a task template cannot widen the root…` 直接覆盖。✅
- **DoD①「缺失 telemetry 不作为 zero」**：`normalizeUsage` 的 `micros` 在 `!complete` 时为 `null`；`usageCompleteness.knownMicros` 仅在所有 request 齐全且 complete 时才为数值，否则 `null`；`decide` 在 `requireCompleteUsage` 且不完整时 `deny + EFK_USAGE_INCOMPLETE`。✅（一个死代码默认值见 nit-1）
- **DoD②「五类角色计入总账」**：`RequestRole` 五类 + 预算测试 `planner, worker, reviewer, learning, evaluator all draw on the same pool`。✅
- **DoD②「并发 reservation 不复制预算」**：`reserve` 幂等 + `outstandingCount`/`capMicros` 共用，测试 `a repeated reservation for the same requestId does not copy budget` 与 `the concurrency cap …`。✅
- **R7 same-user**：`weakerTrustDomain` 仅双 `os-sandbox` 才得 `os-sandbox`（`authority.ts:42`）；`decide` 在策略要求 `os-sandbox` 而实际 `same-user` 时 `deny`，注释与错误信息明写「hooks and worktrees are not an OS sandbox」（`risk.ts:79-86`）。全 lane **无任何**把 hooks/worktree 等同 OS 沙箱的表述。✅

### 1.4 错误码

只用 `src/protocol/errors.ts` 的 `EFK_*`（`fail(code: ErrorCode)` 为强类型，`tsc` 通过即证明合法）。实测使用 14 个码：`EFK_AUTHORITY_DENIED / EFK_GRANT_EXPIRED / EFK_GRANT_REVOKED / EFK_CAPABILITY_UNSUPPORTED / EFK_DEGRADATION_APPROVAL_REQUIRED / EFK_PROTOCOL_UNSUPPORTED / EFK_SCHEMA_INVALID / EFK_USAGE_INCOMPLETE / EFK_USAGE_CONFLICT / EFK_CANCEL_UNCONFIRMED / EFK_BUDGET_NOT_AUTHORIZED / EFK_BUDGET_EXHAUSTED / EFK_BUDGET_ENVELOPE_INCONSISTENT / EFK_INVARIANT_VIOLATION`。无第二套错误词表，`PolicyResult<T>` 只有 `ok:true|ok:false` 两分支（`types.ts:12-15`）。✅

---

## 2. 实测证据

环境：Windows、Node v24.12.0、lane `d47f0ca`。

```
$ npm run build
> tsc                                                                  exit 0

$ node --test test/l2-policy-{authority,budget,negotiate,risk,usage,fixtures}.test.js
ℹ tests 60    ℹ pass 60    ℹ fail 0                                   exit 0
```

**门禁发现性（`node --test` 不带参数）**：

```
$ node --test
ℹ tests 484   ℹ pass 483   ℹ fail 1                                   exit 1
✖ one evolution is evaluated, committed, pinned, and can be rolled back (130498ms)
    at test/runner.test.js:101  actual 'RESOURCE_EXHAUSTED' expected 'ACCEPTED'
```

- 6 个 l2-policy 文件的标题在完整运行中逐一命中（含循环生成的 11 条 `l2-policy fixture decodes as …`），差分 `484 − 423 = 61`，即本 lane 的测试确实在默认发现范围内。
- 唯一失败是 `test/runner.test.js` 的 **wall-clock flake**（`RESOURCE_EXHAUSTED`），与本 lane 无任何依赖关系（lane 未改 `src/lib/**`、未加 runner 代码）；主 worktree 在本 lane 落盘前也是同一条失败。

**其它门禁**：`npm run typecheck` exit 0；`npm run dep:check`（129 modules / 460 edges / cycles 0 / acyclic）exit 0；`npm run src:policy`（最大文件 299 行 < 350）exit 0。

**negative control（自建变异，非作者报告）**：对 3 处实现各注入 1 处变异 → `npm run build` exit 0 → 目标测试 **57/60，恰好 3 条变红**，每条对应一个变异：

| 变异 | 变红用例 |
|---|---|
| `usage.ts` `micros: complete ? estimatedUsdMicros : null` → 缺失回落 `?? 0` | `normalizeUsage never turns an incomplete zero into a settled zero` |
| `authority.ts` 删除 `nodeIds` 成员校验 | `capabilities and node membership are both intersected` |
| `budget.ts` 删除并发预留上限校验 | `the concurrency cap limits outstanding reservations independently of the dollar cap` |

复原后重建 → 60/60 绿。结束校验：`src/kernel/policy/*.ts` 与 `test/l2-policy-*.js` 的 **15 个 sha256 与开始时逐字节一致**，`git status --short` 与开始时一致（仅原 7 条 untracked）。比较器可证伪，非永假/永真。

**ambient / 副作用**（`src/kernel/policy/**`）：

- 全部 import 说明符为相对路径（`../../protocol/index.js` ×11、同目录 `./*.js`）；非相对说明符 0。
- `Date` / `Math.random` / `process` / `fetch` / `console` / `setTimeout` / `setInterval` / `performance` / `globalThis` / `crypto` / `require(` / 动态 `import(` 命中数 **0**（唯一命中是一句注释文字）。
- 模块顶层只有 `import`/`export`/`const`/`function`/`type` 声明；无模块级 `let`/`var`，无惰性缓存，无顶层调用（`EVALUATION_ENVELOPES` 是冻结字面量）。
- 时间（`now`）与撤销代数（`revokedEpoch`）均为显式入参；摘要由调用方传入（`usageIdentity` 用稳定序列化，不引 `node:crypto`）。

**fixtures 与冻结 schema 一致**：`l2-policy-fixtures.test.js` 对 11 个对象（`Grant/Scope/BudgetPolicy/Usage/HostManifest/TaskContract/GuaranteeRequirement/DegradationOption/CapabilityObservation/EvidenceRef/ArtifactRef`）逐一 `decode` 通过——fixture 不是"看起来像"的便利对象。所有被读字段（`scope.hostVersion`、`manifest.identity.version`、`observation.scope.{providerModel,coverage}`、`requirement.{capability,mode,evidenceKinds,coverage,alternativeIds}`、`alternative.{replacesCapability,requirements,tradeoff,approvalRef}`、`grant.{nodeIds,scope,capabilities,maxDelegationDepth,expiresAt,revocationEpoch}`、`usage.*`、`budgetPolicy.*`）在 `SCHEMAS.$defs` 中均为必填且同名字段。

---

## 3. 发现（均为 minor/nit，不阻塞）

### minor-1 · `budget.ts:136` — `openBudgetLedger` 不校验也不推导 `reservePerRequest` 的数值域

`openBudgetLedger(policy, reservePerRequest)` 接受任意数字：`reservePerRequest=0` → **ok**（ledger `reserve=0`，`settled+outstanding ≤ cap` 永不触发，只受 `maxRequests`/`maxConcurrentRequests` 约束）；`reservePerRequest=-1` → **ok**。同理 `settle({micros:-9000})` → **ok 且 `settledMicros=-4000`**（负结算反而抬高可用余额）；`releaseUnspent({confirmedUnspentMicros:-1000})` → **ok 且 `settledMicros=10547 > 预留 9547`**；`usageCompleteness([{estimatedUsdMicros:-5000}],['r1'])` → `{complete:true, knownMicros:-5000}`。`SCHEMAS.UsdMicros` 是 `minimum:0`，但以上都是 lane 自有参数（非 decode 后的 wire 对象），越过了该边界。

这些是 DoD② 的**唯一**可被击穿点：冻结路径（`RESERVE_PER_REQUEST_MICROS=9547`）本身正确，测试也全绿；只有调用方传入自算数值时才会静默失效。

**建议**：`openBudgetLedger(policy, priceTable)` 直接用 `worstCaseRequestMicros(policy.maxInputTokens, policy.maxOutputTokens, price)` 得出预留（policy 自己就带这三个字段），或最少拒绝 `reservePerRequest < 1`；`settle`/`releaseUnspent` 拒绝负 `micros`。属"真实输入边界校验"，不属防御性编程。

### minor-2 · `negotiate.ts:69` — `provider-live` 只校验 `providerModel !== null`，未与任务条件比对

`INTERFACES §7.3` 要求"有 provider-live 要求时 **provider/model/payload 与任务条件一致**"。实现只做存在性检查。查 `SCHEMAS.$defs`：`GuaranteeRequirement` 只有 `capability/mode/evidenceKinds/coverage/alternativeIds`，`TaskContract` 无 `model` 字段，`CapabilityScope.providerModel` 是宿主侧声明——**"任务条件"在冻结 schema 里无处可写**，实现无法比对。属契约措辞与 schema 能力不匹配，而非 lane 漏做。

**建议**：在 `INTERFACES §7.3` 或 `SCHEMAS` 记一条：provider/model/payload 的判定当前只能是"宿主侧非 null + 证据种类匹配"，任务侧精确条件需要新增字段（走 owner 流程）；或在 lane 文档明写该限制。

### minor-3 · `usage.ts:62` — `NormalizedUsage.inputTokens` 合并 cached/uncached

`inputTokens: sum([inputUncached, cacheRead])` 把两类输入并成一个数，且 `NormalizedUsage` 不再携带 `cacheWrite`。`CONTRACTS §5.3` 要求"cached 与 uncached input 分账"。原始 `Usage` 仍保留全部字段，预留额用的是冻结 9547（不依赖 token 数），所以 cap 计算不受影响——只是"归一化视图"无法按缓存价计价。

**建议**：`NormalizedUsage` 分别保留 `inputUncached`/`cacheRead`（如需总量可另加 `inputTotal`）。

### nit-1 · `usage.ts:29,129` — 两处死默认值 `?? 0`

`sum()` 内层 `value ?? 0`（null 已在上一层短路返回 `null`）与 `knownMicros` 的 `byRequest.get(id)?.estimatedUsdMicros ?? 0`（`complete` 已保证每个 expected 存在且非 null）都是不可达分支，但形态上正是 DoD 禁止的"缺失当默认值"。建议改成由已验证的 map 条目直接求和（或用 `!`/显式不变式），使"缺失绝不为 0"在代码形状上也无反例。

### nit-2 · `test/l2-policy-risk.test.js:2` — 注释里的顺序与实现不一致

注释写"authority and protocol first, **then capability gaps, then the trust domain**, then budget"，而 `risk.ts` 先判 trust domain（`:79`）再处理 `negotiation.status`（`:93`）。两种顺序都是 fail-closed，测试没有区分（`requiring an OS sandbox denies…` 用的是 executable 输入）。建议把注释改成实现的真实顺序（authority → protocol → trust-domain → capability → budget → usage）。

### nit-3 · `usage.ts` — 不校验 `source` 与 `complete` 的矛盾

`Usage.source` 含 `unknown`/`estimate`，`normalizeUsage` 只看 `complete`。一份 `{source:'unknown', complete:true, …}` 会被当作真实测量并可按 `estimatedUsdMicros` 结算（含 0）。经由 decode 的正常路径不会出现，但 lane 导出的 `normalizeUsage` 不拦。建议：`complete===true` 时拒绝 `source==='unknown'`（或不把其 `estimatedUsdMicros` 当已结算值）。

### nit-4 · `negotiate.ts:170-176` — 批准绑定未与 `DegradationOption.approvalRef` 比对

选中条件只要求 `candidate.approvalRef !== null` 且 `approvals` 中存在同 `alternativeId` 的绑定；绑定里的 `approvalRef` 与候选自报的 `approvalRef` 不必相等，结果可回报一个该 alternative 未指名的 ref。输入契约（`NegotiationInput` 注释）声明由 PolicyPort 预先绑定校验，故仅记 nit。建议加一条 `approval.alternativeId/approvalRef === candidate.approvalRef` 的一致性检查。

---

## 4. 未覆盖 / 明确不主张

- 本 lane 是**纯函数 + 不可变 ledger 转换**，不做持久化：CAS 事务、跨进程并发、崩溃恢复属 `l2_state_store`。`reserve/settle` 的"并发"仅指同一不可变 ledger 上的顺序转换；真正的并发正确性未在此证明。
- `decide` 返回 `needs-authorization` 时"不得派发"是**消费者义务**（`PolicyDecision.error !== null`），lane 内无强制派发门（无 dispatcher）。派发侧在 L2 runtime。
- `EVALUATION_ENVELOPES` 只冻结 S1/S2/S3 的 USD/请求/墙钟/并发字段；`METRICS §7` 的 `request_cap` 假设上限（S1=20 是否过紧）仍归 Q17 pilot。
- 未运行 `npm run check` 全链（会触发既有 `runner.test.js` wall-clock flake）；等价单项均已单独执行并通过。
