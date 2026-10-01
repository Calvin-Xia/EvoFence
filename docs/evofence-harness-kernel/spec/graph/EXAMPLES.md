# 图语义工作例（Worked Examples）

节点：`l1_graph_contract`。配套 [SEMANTICS.md](SEMANTICS.md)。
用途：把语义钉成**可判定**的 accept/fail 判据，供 `l2_graph_model` 实现、`l2_kernel_verification` 核验。

每个例子给出：GraphSpec 摘要 → 事件序列/期望 → **反例**（实现若这样做就是错的）。
所有例子共同服从 SEMANTICS §3.0 的**判定函数** `decide(event) -> { nodeState, graphActions }`：每个期望终态都注明命中的规则号（事件 A 用 **A1–A6**，事件 B 用 **B1–B3**，兜底断言为 **INV**）。两层语义严格分开——节点可以自身 `failed` 而图仍向前推进（A3/A4）。

> **rev7 修订**：修掉第六轮复核的 1 BLOCKER——**旧版**例 2 的 `nV` 唯一出边是 `repair`，其 `completed` outcome 会落 A5；现补 `route(nV → nDone)` + `nDone: terminal: true`。
>
> **rev6 修订**：与 SEMANTICS rev6 同步——编号改为 **A1–A6 / B1–B3 / INV**；补上 R4 要求的 `terminal: true`（例 3 的 `nY`、例 4 的 `nC`、例 9 的 `nX`/`nY`、例 10 的 `nD`），否则它们会被 §5.1 第 10 项拒绝。
>
> **rev5 修订**：新增 `repair` 规则；例 10 路径 C 改为声明 **`repair(nZ → nB)`**（旧版用 `fallback(nB → nD2)`，其 `to` 是 `nD2` 而非 `nB`，与 `hasDeclaredCover` 定义相反）。
>
> **rev4 修订**：所有期望终态改注**规则号**而不是旧版的"规则 3/4a/4b/4c"；例 6 出口 3 去掉"或"改为单一判定。
>
> **rev4 修订**：所有期望终态改注**规则号**而不是旧版的"规则 3/4a/4b/4c"；例 2 反例 B 与例 8 的 stale 引用清理；例 6 出口 3 去掉"或"改为单一判定。
>
> **rev3 修订**：修掉第二轮复核的 2 个 BLOCKER——例 1 的 `n1` 补 `terminal: true`（零 route 节点的 R4 前提）；例 8 补"声明了 ≥1 条 route"前提与"图修订不是出路判据"的说明。新增例 10 覆盖 `abandoned` → `failed`。例 6 与 §2.2 现一致（`unknown` 的 reconcile 结论不完整就留在 `unknown`）。
>
> **rev2 修订**：修掉第一轮复核的 3 个 BLOCKER——例 3 的 fallback 终态自相矛盾；例 2 的 `resource` 边造成 ready 环且依赖"隐含产物依赖"；例 2 的 repair 边源/目标角色与 §3.1 不符。新增例 4（`data` 边），补全六种边覆盖。

---

## 例 1：单 agent 退化（DoD：小任务不强制并行）

**场景**：用户要求"修复 `parseDate` 在闰年边界上的错误并补测试"。

```yaml
graphId: g-single
nodes:
  - nodeId: n1
    kind: agent
    terminal: true          # R4：零条 route 的节点必须是 terminal，否则校验拒绝
    loop: { maxIterations: 3, maxWallClock: 20m, stop: [body-success, bound-exhausted] }
    resources: { exclusive: [workspaceWrite], shared: [workspaceRead] }
    requiredOutcomes: [patch-applied, tests-green]
edges: []                      # 无 dependency / data / route / repair / fallback / provenance
requiredJoins: []
graphLimits: { maxNodes: 8, maxConcurrentAgents: 1, maxDepth: 2 }
```

事件序列：

```
Command(createSession, expectedRevision=0)
  → Event(graph.accepted, revision=1)
  → Event(node.ready, n1)                    # 依赖为空 → ready 五条同时成立
Command(claim, n1, attempt=1)
  → Event(resource.leased, workspaceWrite, fencing=1)
  → Event(node.leased, n1, attempt=1, fencing=1)
  → Event(node.running, n1, attempt=1)       # 宿主 ack
HostReceipt(n1, attempt=1, artifacts=[patch, test-run])
  → Event(node.verifying, n1, attempt=1)     # 验证是必经段，不是额外节点
DecisionRecord(n1, attempt=1, outcome=completed)
  → Event(node.succeeded, n1, attempt=1, contractRevision=1)
```

期望：终态 `succeeded`；节点数 1；并发度 1。

**反例 A**：实现以"图引擎至少需要 2 个节点 / 1 条边"为由拒绝创建，或自动插入多余 verifier 节点 → **违约**。
**反例 B**：跳过 `verifying` 直接 `succeeded` → **违约**。

---

## 例 2：多 agent + data + join + fresh verifier + repair

**场景**：跨模块接口变更；模块 A/B 独立改，唯一 integration writer 汇总，fresh verifier 独立验收，可修复。

```yaml
graphId: g-multi
nodes:
  - { nodeId: nA,    kind: agent, resources: { exclusive: [scopeA] } }
  - { nodeId: nB,    kind: agent, resources: { exclusive: [scopeB] } }
  - { nodeId: nM,    kind: agent, resources: { exclusive: [integrationWriter] } }
  - { nodeId: nV,    kind: agent, contextIsolation: fresh }
  - { nodeId: nJ,    kind: join,  requiredBranches: [nA, nB, nM] }
  - { nodeId: nDone, kind: deterministic, terminal: true }
edges:
  - { type: data,       from: nA,  to: nM }        # nM 消费 nA 的 patch artifact
  - { type: data,       from: nB,  to: nM }        # nM 消费 nB 的 patch artifact
  - { type: dependency, from: nA,  to: nJ }
  - { type: dependency, from: nB,  to: nJ }
  - { type: dependency, from: nM,  to: nJ }
  - { type: dependency, from: nJ,  to: nV }
  - { type: route,      from: nV,  to: nDone, when: "decision.outcome == 'completed'" }
  - { type: repair,     from: nV,  to: nM, maxAttempts: 2, when: "decision.outcome == 'repair'" }
requiredJoins: [nJ]
resourcePolicy:
  integrationWriter: { mode: exclusive, maxHolders: 1 }
  scopeA: { mode: exclusive, maxHolders: 1 }
  scopeB: { mode: exclusive, maxHolders: 1 }
```

依赖图：`nA→nM`、`nB→nM`（data）；`nA/nB/nM→nJ`（dependency）；`nJ→nV`（dependency）。**无环**。
`integrationWriter` 是资源名（§3.2），不是边，因此不与 `nM→nJ` 的依赖方向冲突（旧版正是在这里造出 ready 环）。

> **rev7 修正（第六轮复核的 BLOCKER）**：旧版 `nV` 的**唯一**出边是 `repair`，因此正常路径的 `completed` outcome 代入 `onOutcome` 会落到 **A5**（`hasRoutingOutgoing(nV)=true` 但无匹配）→ `failed(no-matching-route)`——旗舰例的 happy path 与自己的判定函数互斥。现补 `route(nV → nDone, when outcome=='completed')` 与 `nDone: terminal: true`：`completed` 走 A2、`repair` 走 A3，两条路径都成立。**不能**用“给 `nV` 标 `terminal: true`”修——A1 先于 A3，会短路掉 repair。

**正常路径**：`nA ∥ nB` → `nM`（持有 `integrationWriter` 独占）→ `nJ` 三分支全 succeeded → `nV` fresh 验收 → `decision.outcome=='completed'` 走 A2 → `nDone`（A1，terminal）→ 任务完成。

**分支失败路径**：`nB` 失败。

- `nJ.requiredBranches` 含 `nB`；`nB ∈ failed`。代入 §3.0：`hasDeclaredCover(nB)` 为**假**（全图唯一的 `repair` 边是 `nV → nM`，指向 `nM` 而不是 `nB`），`isAbandoned(nB)` 为假 ⇒ 命中 **B3** → `nJ` 转 **`waiting`**。
- `nJ.branchReport = { nA: succeeded, nB: failed, nM: pending }`，**必须**完整。
- `nM` 此时只满足 `data(nA→nM)`，`data(nB→nM)` 未满足 → 不 ready。
- **反例 A**：实现把 `nB` 从分支报告里过滤掉，让 `nJ` 只看到两个成功分支并判成功 → **违约**（失败被抹掉）。
- **反例 B**：实现依 §3.1 旧版 `join` 行把 `nJ` 直接判 `failed`（把 `irreplaceable` 误当 `unrecoverable`）→ **违约**（§3.0 **B3**：未 `abandoned` 的缺口是 `waiting`）。
- **反例 C**：实现让 `nM` 只靠"隐含的产物依赖"就 ready（GraphSpec 未声明 `data(nB→nM)`）→ **违约**（§5.2 输入不可悄悄猜）。

**repair 路径**：`nV` 判 `repair`。

- `repair(nV → nM)` 的语义是"触发者 `nV` 对被重试节点 `nM` 产生**新 attempt**"（§3.1：`from` = 触发者，`to` = 获得新 attempt 的节点）。
- 期望：`nM` 开 `attempt=2`；`nV` 的原失败 `DecisionRecord` **保留只读**；第 2 次 attempt 与第 1 次共享 **`nM` 自己的预算池**（不是 join 的池——join 自身无预算）。
- `maxAttempts: 2` 耗尽后 `nM` → `failed`；原失败证据与新失败证据**并列出现**在 `nJ` 的分支报告里。
- **反例 D**：把 `nV` 从 `failed` 改回 `running` 复用同一 attempt → 违约。
- **反例 E**：把 repair 的预算记到 `nJ`（无池对象）上 → 违约。

---

## 例 3：fallback（原失败保持 failed）

**场景**：`nT` 首选"装工具 X 跑"，工具不可用时走"纯文本分析"。

```yaml
edges:
  - { type: route,    from: nT, to: nX, when: "env.hasTool('X')" }
  - { type: route,    from: nT, to: nY, when: "!env.hasTool('X')" }
  - { type: fallback, from: nX, to: nY, when: "self.failed && self.reason == 'tool-unavailable'", maxAttempts: 1 }
nodes:
  - { nodeId: nT, kind: deterministic }
  - { nodeId: nX, kind: agent }
  - { nodeId: nY, kind: agent, terminal: true }   # nY 无任何出边 ⇒ 履行 R4
```

期望：

- `nX` 失败且 `reason == 'tool-unavailable'` → `nY` 开新 attempt。
- **`nX` 终态保持 `failed`**，证据只读（§3.1 `fallback` 行 rev2 修正）。
- 父级汇总**必须同时**列出 `nX: failed (tool-unavailable)` 与 `nY: <终态>`。
- `nX` 与 `nY` 共享父池预算；换路线不重置剩余额度。

**反例 A**：把 `nX` 标成 `cancelled` 或 `skipped` 以"看起来干净" → **违约**。
**例外（唯一允许 `cancelled` 的情形）**：任务合同显式把该分支标为 `optional`，且 `authorityRef` 覆盖该标注。此时 `nX → cancelled` 合法，但仍须保留失败原因。
**反例 B**：`nX` 失败但 `reason` 不匹配 `when` → 实现仍走 `nY` → **违约**（fallback 只在声明的失败条件下取用）。

---

## 例 4：`data` 边（digest 绑定与显式 rebind）

**场景**：`nG` 生成一个 schema 产物，`nC` 消费它。

```yaml
nodes:
  - { nodeId: nG, kind: deterministic, outputSchemas: { report: "report/v1" } }
  - { nodeId: nC, kind: agent, terminal: true }   # nC 无出边 ⇒ 履行 R4
edges:
  - { type: data, from: nG, to: nC, artifact: report, expect: { schema: "report/v1" } }
```

路径 A（正常）：`nG.succeeded` 产出 `ArtifactRef(digest=d1, schema=report/v1)` → `nC` ready → 消费 `d1`。

路径 B（digest 不符）：`nG` 重新执行产出 `d2 ≠ d1`，而 `nC` 的 `data` 绑定仍是 `d1`。

- 期望：`nC` 转 **`waiting`**，原因 `input-artifact-stale`；**不**自动跟随 `d2`，**不**静默降级。
- 恢复：必须提交 GraphPatch 显式 rebind 到 `d2`（§5.2"输入不可悄悄变"），此后 `nC` 重新评估 ready。

路径 C（读取中变更）：`nC` 已 `running`，`nG` 产出新 digest。

- 期望：**不撤回** `nC` 已开始的输入；只阻止**未开始**的消费。
- 已完成的 `nC.succeeded` 绑定到它实际消费的 digest，不随后续 `nG` 变化而失效。

**反例 A**：`nC` 发现 digest 不符就自动使用最新产物 → **违约**。
**反例 B**：`nC` 已 `running` 时把输入换掉并让本次 attempt 用新输入 → **违约**。

---

## 例 5：运行中图修订（输入不可悄悄变）

**场景**：`nA` 正在 `running`，用户要求"模块 A 也必须过安全扫描"。

```yaml
GraphPatch {
  expectedRevision: 3,
  changes: [ { nodeId: nA, addRequirement: security-scan } ],
  reason: "user added requirement mid-flight",
  authorityRef: grant-42
}
```

期望：**拒绝**。

- `expectedRevision=3` 校验通过，但 `nA.state = running` → 违反 §5.2"只改未认领节点"。
- 正确做法：`cancel nA`（等宿主确认；可能落 `unknown` → reconcile）→ 提交 patch 新增 `nS: deterministic(security-scan)` 与 `dependency(nS → nJ)` → `nA` 以**新 attempt** 重跑或从产物续。
- 新 attempt 的 `data` 绑定必须**显式 rebind** 到新 base digest。

**反例**：patch 直接成功，`nA` 在没做安全扫描的情况下于 revision 4 落 `succeeded` → **违约**（结论绑定错误 revision）。

---

## 例 6：`unknown` 与 reconcile（执行后回执前崩溃）

**场景**：宿主已发出 `Effect(apply-patch)`，写回执前进程崩溃。

```
Effect(e42, idempotencyKey="n1-a1-apply", epoch=7) → 宿主执行
[崩溃]
重启 → Event(session.resumed, epoch=8)
     → Event(node.unknown, n1, attempt=1, effect=e42)
```

期望：

- `n1` 进入 `unknown`；**不是** `failed`，**不是**自动重放。
- `reconcileEffect(e42)` 核实真实状态，四条出口（单一判定，不留"或"）：
  1. 已应用 → `verifying` → 正常裁决。
  2. 未应用且副作用**幂等** → 允许重发**同一** `idempotencyKey`。
  3. 未应用且副作用**非幂等** → 不得盲重试；转 `waiting(authorization-required)`（单一判定：等的是"新授权"，属 §2.2 的 `verifying → waiting` 情形）。
  4. **结论不完整** → 保持 `unknown`，并暴露给用户（不进 `waiting`——`waiting` 表示知道在等什么）。

  > rev2 按复核意见把"无法确认"的出口收敛为**单一**判定：留在 `unknown`，不再写"丢弃或归档"式的双选。
- 迟到回执（`epoch=7`）到达时**归档但不应用**：不得改变 `epoch=8` 的状态、不得重复记账。

**反例 A**：缺回执就自动重放命令 → **违约**（可能双重应用）。
**反例 B**：把 `unknown` 当作 `waiting` 直接进入重试排程 → **违约**（两状态语义不同）。

---

## 例 7：loop 边界与恢复

**场景**：`n1.loop = { maxIterations: 4, maxTokensOrCost: 200k, stop: [body-success] }`，第 3 轮后崩溃。

期望：

- 恢复到**最近持久化迭代边界**（第 3 轮）；已结算的前 3 轮不重放、不重复计费。
- `maxTokensOrCost` 是**整个 loop 累计**，不按轮重置。
- 上例声明了 `maxIterations` + `maxTokensOrCost` 两类 → 满足 §4 不变量 2（至少两类）。只声明一类时 GraphPatch **必须拒绝**。

**反例 A**：恢复后从第 1 轮重跑并再次计费 → 违约。
**反例 B**：只声明 `maxIterations` 一类却允许提交 → 违约。

---

## 例 8：路由无匹配 = 失败（而非静默结束）

**场景**：`nV` 的 `DecisionRecord.outcome` 是 `needs-human`。`nV` **声明了** 2 条 `route`（`when: outcome=='completed'`、`when: outcome=='repair'`），但都不匹配，且无 `fallback`。

期望：

- `nV` 的 `verifying` 结束，**无匹配 route** → 节点 `failed`，`reason=no-matching-route`，并把 `needs-human` 原样暴露。
- 依 §3.0 **A5**：这是"节点有 routing 出边但 outcome 无法被消费"，属 `failed` 而非 `waiting`。
- **前提是 `nV` 确实声明了 ≥1 条 route**。若它声明 0 条且未标 `terminal: true`，那是 **§5.1 校验期错误**（图创建时就该被拒），不是运行期状态。
- **`failed` 不因"以后可以加一条 route"而变成 `waiting`**：图修订不是出路判据（§3.0 开头）。要接住 `needs-human`，必须提交 GraphPatch 新增 route，并产生**新 attempt**。

**反例**：默默选第一条 route，或把节点标 `succeeded` → **违约**。

---

## 例 10：上游 `abandoned` → 下游 `failed`（R5）

**场景**：`nB` 的 task 分支被显式放弃，下游 `nD` 依赖它。

```yaml
nodes:
  - { nodeId: nB, kind: agent }
  - { nodeId: nD, kind: agent, terminal: true }   # nD 无出边 ⇒ 履行 R4
edges:
  - { type: dependency, from: nB, to: nD }
```

路径 A：`nB` 失败但仍可重试（未 abandoned，无 cover）→ `nD` 依 §3.0 **B3** 转 `waiting`。

路径 A2：`nB` 失败，且存在 **`repair(nZ → nB)`**（`to = nB`，故 `hasDeclaredCover(nB)` 为真）→ `nD` 依 **B1** 转 `waiting`，等 `nB` 的新 attempt。

路径 B：图 patch 把 `nB` 标 `abandoned`（写入 `GraphSpec.abandonedBranches`，带 `authorityRef` 与理由）；**无任何 `repair`/`fallback` 边指向 `nB`**（`hasDeclaredCover(nB)` 为假）。

- 期望：`nD` 依 §3.0 **B2** 转 **`failed(upstream-abandoned)`**。
- `nB` 的失败证据仍留在图上（§5.2 + R5）。

路径 C：`nB` 被标 `abandoned`，但图里**仍存在** `repair(nZ → nB)`（即 `hasDeclaredCover(nB)` 为真）。

- 期望：`nD` 依 **B1** 转 `waiting`（等 `nB` 的新 attempt）；**不**判 `failed`。
- 明确：**B1 先于 B2**（函数顺序：先查 cover，再查 abandoned）。这正是 SEMANTICS §2.2 里 `waiting → failed` 边必须带 `hasDeclaredCover(U) 为假` 守卫的原因。

**反例 A**：因为"以后也许能给 `nB` 做一次 repair"就让 `nD` 永远 `waiting` → **违约**（图修订不是出路判据）。
**反例 B**：标 `abandoned` 时删掉 `nB` 的失败证据以求"干净" → **违约**（R5）。

---

## 例 9（对照）：`provenance` 不产生任何调度效果

**场景**：`provenance` 边记录"`nY` 的做法来源是 `nX` 的成功轨迹"。

```yaml
nodes:
  - { nodeId: nX, kind: agent, terminal: true }   # 仅 provenance 出边 ⇒ R4 要求 terminal
  - { nodeId: nY, kind: agent, terminal: true }   # 无出边
edges:
  - { type: provenance, from: nX, to: nY, rel: derived-from }
```

期望：`nX` 的终态**完全不影响** `nY` 的 ready 判定。`nX` 失败时 `nY` 照常可调度。

**反例**：实现因 `provenance` 边把 `nY` 阻塞 → **违约**（这正是 §3.3 强调"SP `relates`/`decides` 不是门禁"的原因）。

---

## 供 L2 使用的判据索引

| 例 | 覆盖边类型 | 对应不变量 | 应被 `l2_kernel_verification` 覆盖 |
|---|---|---|---|
| 1 | （无） | 单 agent 退化、验证必经、零强制并行 | 是 |
| 2 | dependency / data / repair / route | fan-in 完整性、repair 语义与预算池、fresh verifier、成功路径必须被路由 | 是 |
| 3 | route / fallback | fallback 保留原失败、`when` 条件必须匹配 | 是 |
| 10 | dependency / repair | `abandoned` 载体与判定（B1 优先于 B2）、“图修订不是出路判据” | 是 |
| 4 | data | digest 绑定、显式 rebind、读取中不撤回 | 是 |
| 5 | —（修订） | 修订不碰 running 节点、data rebind | 是 |
| 6 | —（恢复） | `unknown` + reconcile + 迟到回执不应用 | 是（核心安全属性） |
| 7 | —（loop） | bound 至少两类、恢复不重放已结算迭代 | 是 |
| 8 | route | 路由无匹配即 `failed` | 是 |
| 9 | provenance | 非门禁，不产生调度效果 | 是 |

六种边类型全部有工作例覆盖：`dependency`(2,10)、`data`(2,4)、`route`(2,3,8)、`repair`(2,10)、`fallback`(3)、`provenance`(9)。
