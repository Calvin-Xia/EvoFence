# spec/graph — 图执行语义 lane

节点：`l1_graph_contract`（L1，`ctx_graph`）· 管辖 ADR：`adr_0002`
状态：L1 研究产物，**待 `l1_replan` 人审**。拟冻结**语义**，不冻结接口签名（签名归 `l1_api_freeze`）。

| 文件 | 内容 | 对应检查点 |
|---|---|---|
| [SEMANTICS.md](SEMANTICS.md) | 节点种类与状态机、**阻塞 vs 失败总则**、6 种边 × 5 维语义、资源与租约、有界 loop、修订事务、fan-in、内核选型 | cp1、cp2、cp3 |
| [EXAMPLES.md](EXAMPLES.md) | **10** 个可判定工作例（单 agent 退化、多 agent+data+join+repair、fallback、data digest 绑定、运行中修订、`unknown`+reconcile、loop 恢复、路由无匹配、provenance 非门禁、`abandoned` → `failed`） | cp2 |

**rev7**（第六轮交叉复核 1 BLOCKER）：例 2 的 `nV` 旧版**唯一**出边是 `repair`，其 `completed` outcome 会落 **A5** → 旗舰例 happy path 与判定函数互斥。现补 `route(nV → nDone)` + `nDone: terminal: true`；并记录“**不能**给 `nV` 标 `terminal: true`”（A1 先于 A3，会短路 repair）。

**rev6**（第五轮交叉复核 1 BLOCKER）：修掉**谓词覆盖缺口**——rev5 把 `declaredOutgoing` 限定为 `route ∪ repair ∪ fallback`，使**只带 blocking 出边的普通生产节点**（例 2 的 `nA`/`nB`/`nM`/`nJ`）被 §5.1 第 10 项错误拒绝并落入告警。现拆为 `hasRoutingOutgoing` / `hasBlockingConsumer` / `hasRealConsumer`，新增规则 **A6**（blocking 消费者是 outcome 的合法消费者）；编号改为 **A1–A6 / B1–B3 / INV**；R4 改为 `hasRealConsumer(N)=false → terminal: true`；四例补 `terminal: true`。

**rev5**：`repair` 边补入判定函数（旧版 §3.1 描述了 repair 但函数无求值入口）。

**rev4**（第三轮交叉复核 1 BLOCKER + 3 MAJOR + 5 MINOR）：做一次**单向对齐**——§3.0 规则编号 → §3.1 五维单元格 → §5.1 校验清单 → §5.3 fan-in 判定 全部引用同一套**可观测谓词**；新增 §2.4 定义 `terminal` 与 `abandonedBranches` 的**载体**，并明确 **`abandoned` 是“缺口变永久”的唯一机制**；R4/R5 补入 §5.1（第 10/11 项）；`decide()` 返回值拆为 `{ nodeState, graphActions }`。

**rev3**（第二轮交叉复核 2 BLOCKER + 1 MAJOR）：
① §3.0 由口号改写为**可观测判定函数** `decide(N,event)` + 校验期规则 R4/R5；明确**“合法图修订”不是出路判据**（否则永远 `waiting`）；
② `unknown` 与 `waiting` 彻底分开：reconcile 结论不完整 **留在 `unknown`**，不进 `waiting`（与 CONTRACTS §4 一致）；
③ §2.2 状态机与 `waiting` 入边表逐条对齐（3 条入边，修正旧版“表 4 条 / 图 3 条”）。
例 1 补 `terminal: true`（R4 前提），例 8 补“声明了 ≥1 条 route”前提，新增例 10（`abandoned` → `failed`）。

**rev2**（第一轮交叉复核 3 BLOCKER + 6 MAJOR）：
① `fallback` 取用后原失败分支**保持 `failed`**（旧版表格与例 3 互相矛盾）；
② 新增总则「`failed` = 图/合同层面无出路，否则 `waiting`」，join/依赖/路由据此对齐；
③ `resource` 与 `join` **不再是边类型**（资源改为节点声明 + 图级策略；fan-in 由 `join` 节点承载），消除方向歧义与 ready 环；
④ 状态机补齐 `waiting` 四条入边与 `unknown`/`cancelling` 分支；
⑤ 选型结论降为「建议采用（待人审）」，每条否决补**可证伪判据**；
⑥ 「冻结」措辞降为「拟冻结」。

## 一页结论

1. **节点按执行单元建模**，不按模型调用；`agent` 节点内部含完整有界 loop。
2. **依赖投影无环，控制路由允许有界循环**；循环是显式 `loop` 构造，四类 bound 至少声明两类。
3. **6 种边**（`dependency` / `data` / `route` / `repair` / `fallback` / `provenance`）**在 ready/取消/失败/恢复/预算五件事上都有定义**（SEMANTICS §3.1）。
4. **判定是一个可观测函数，不是口号**：`decide(event) -> { nodeState, graphActions }`（事件 A 规则 **A1–A6**、事件 B 规则 **B1–B3**、兜底断言 **INV**），全部谓词都是纯图/事件查询；**“图修订可能补上”不算出路**（SEMANTICS §3.0）。
5. **失败永不消失**：图变更不删已产生证据的分支；join 必须报告缺失/取消/失败分支，不允许过滤成全绿。
6. **运行中节点不可就地改**；修订必须 cancel → 新 attempt → 显式 rebind 输入。
7. **`unknown` 是一等状态且不等于 `waiting`**：缺回执不自动重放；reconcile 结论不完整就留在 `unknown`；迟到回执只归档、不应用、不重复记账。
8. **小任务退化为单 loop**：不强制并行、不强制插入额外节点；但 `verifying` 是必经段。
9. **内核选型：建议采用小型确定性 reducer（待人审）**；不谈"已定案"。风险点是并发与恢复，归 L2 纵向核验。

## 边界

- 本文是**产品运行图**的语义，与 SP 实施图（`.graph/evofence-harness-kernel/`）语义不同，见 SEMANTICS §7。
- 语义正确 ≠ 实现正确 ≠ 收益成立。未证明项清单见 SEMANTICS §8，分别归 L2 / L1 probe / L4。
