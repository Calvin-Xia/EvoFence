# 独立交叉复核：l1_graph_contract（多轮，含收口）

> 复核者：独立 pi pane `review-1`（同一 worktree、只读、非作者）。
> 复核对象：`spec/graph/README.md`、`SEMANTICS.md`、`EXAMPLES.md`。
> 过程：作者按每轮结论改版 rev2→rev7；第 7 轮为窄范围收口复核，结论 **可接受**（余 2 项 MINOR/NIT，已修）。
> 本文件是**评审记录**，不是被审产物。

---

## 复核回合 1

I'll start by reading the contract materials and the artifacts under review.

---

## 复核回合 2

我已通读三个被复核产物与全部基准文件（节点合同、CONTRACTS.md、ARCHITECTURE.md、adr_0002、REVIEW.md），未做任何修改。以下为独立交叉复核结果。

```
结论: 需修订（blocker 小 3）

[BLOCKER] SPEC/graph SEMANTICS §3.1 `fallback` 取消单元格 vs EXAMPLES 例 3 — 
  §3.1 写"取用 fallback 时被取用分支进入 cancelled（非 failed）"（§3.1 fallback 取消语义），
  而例 3 期望写"nX 终态保持 failed"，例 3 反例又写"把 nX 标成 cancelled 或 skipped → 违约"。
  同一条反例的括号里还同时塞进"fallback 取用后原线是 cancelled"与"原线必须保持 failed"两种相反结论。—
  这是冻结语义表与"L2 accept/fail 判据"示例之间的直接矛盾：实现者无法决定 nX 的终态是 failed 还是
  cancelled，`l2_kernel_verification` 也无法把它写成一条可断言检查。且唯一试图调和的说法"任务失败
  条件未满足时才保持 failed"本身未被定义（"任务失败条件"不是本产物中的术语）。—
  建议：在 §3.1 把 fallback 的取消语义唯一定义为"原失败分支保持 failed，证据只读；仅当任务合同显式
  将该分支标 optional 时才允许 cancelled"，并同步修正例 3 括号内的错误表述；删掉"被取用分支"这一
  歧义措辞。

[BLOCKER] SEMANTICS §3.1 `join` 失败单元格 vs §3.1 `dependency` 失败单元格 / §5.3 / EXAMPLES 例 2 —
  §3.1 join 行：必需分支失败 → "join 失败并附完整分支清单"；dependency 行：前置失败 → "不使本节点
  失败，而是阻塞"。例 2 的 nJ 同时是 join 节点、其必需分支又正是用 dependency 边（nA/nB/nM→nJ）接
  入，于是同一张表的两行对同一拓扑给出相反终态。§5.3 与例 2 又统一取"waiting"（§5.3：failed 与
  cancelled 同列，"默认 join 不满足"；例 2：nB failed → nJ→waiting）。§3.2 还把 join 映射为 SP 的
  fan_in、dependency 映射为 depends_on 并称"语义一致"，进一步说明 join 行才是离群值。—
  DoD 第一条要求每条边的失败语义明确，这里失败语义在表内自相矛盾，例 2 的 accept 判据不可实现。—
  建议：把 join 失败的默认终态改为 waiting（缺口未被过滤、原因列出），仅当 join 的缺口不可由任何
  fallback/新 attempt 满足时才转 failed；并在 §5.3 明确 failed/cancelled 分支的同一处理。

[BLOCKER] EXAMPLES 例 2 `resource` 边 — 
  边表只有 `{ type: resource, from: nJ, to: nM, resource: integrationWriter, exclusive: true }`，
  而 §3.1 把 resource 定为 blocking（参与 ready 判定、租约获取失败 = waiting），却全文未定义 resource
  边的方向（谁持有、谁被门禁）。按与 dependency 一致的"to 依赖 from"读法，nM 的 ready 被门禁在 nJ 上，
  而 dependency 又是 nM→nJ（nJ 依赖 nM）→ 形成 ready 环，nM 永不可调度、nJ 永不可完成；按相反读法
  （from 被门禁），与 §3.1 其它 blocking 边的写法又相反。此外例 2 失败路径用"对 nA/nB 有隐含产物依赖"
  解释 nM 不调度，但 GraphSpec 里没有任何 data 边，这与 §3.1 data（显式 ArtifactRef/digest）和 §5.2
  "输入不可悄悄变"直接冲突。—
  例 2 是明示给 `l2_kernel_verification` 的判据，但它自身不可被调度、其正常路径（nA/nB→nM）无法从
  声明的边推出，因此不可判定。—
  建议：①在 §3.1 冻结 resource 边方向（明确 to=租约取得者 / from=资源所有者或作用域），②修例 2 的
  resource 边方向或改为节点级 `resources` 声明，③把 nA/nB→nM 的产物依赖写成显式 data 边。

[MAJOR] SEMANTICS §3.1 `repair` 行 vs EXAMPLES 例 2 — §3.1 说"源节点判 repair 且次数/深度/预算未耗尽"，
  但例 2 里判定 repair 的是 nV（经 route nV→nR），而 repair 边的 source 是 nR（修复子图）→ target nM。
  源/目标角色与表不符；同时例 2 用 `sharesBudgetWith: nJ` 记入 join 的池，而 §3.1 join 预算明确写
  "join 自身无预算"。建议在 §3.1 明确定义 repair 边 = "触发者对目标节点产生新 attempt"，并用一致
  拓扑改写例 2，预算池指向有池的对象。

[MAJOR] SEMANTICS §2.2 状态机 — §2.2 自称"此处冻结语义"，但 ASCII 图只画了 verifying→waiting，
  没有 §3.1 反复使用的 pending/ready→waiting（dependency 前置失败、resource 租约不可得、join 缺口），
  且 unknown/cancelling/cancelled 的分支起点被排版到 pending 层，缺 running→unknown 与 cancelling→
  unknown（CONTRACTS §4 明确有）。这使 resource 租约失败、依赖阻塞等已冻结语义在状态机上无处落地。建议
  直接引用/补全 CONTRACTS §4 的状态机，并补齐 waiting 的入边。

[MAJOR] SEMANTICS §3.1 `route` 行"恢复语义" — 该单元格写的是"新增路由需 GraphPatch；历史路由决策不
  重写"，属于修订规则，不是恢复（崩溃/resume/epoch）语义。DoD 第一条把"恢复"列为每条边的五维之一，
  route 因此实际缺一维。建议改为"路由决策持久化后按 revision 重放；session resume 时源节点处于
  verifying/running 的路由不重算，决策不重写"。

[MAJOR] SEMANTICS §6 与 README 一页结论 #8 — §6 表格把候选判定写成"采用 / 致命不匹配"，README 把
  "内核选型：小型确定性 reducer"直接列入结论。但 adr_0002 仍是 proposed、节点仍是 running、本文档自称
  待 l1_replan 人审、cp3 只要求"记录选型权衡"。反面证据是约束性论证而非证据（Temporal 与"本机单用户
  信任域 + adr_0009 无强制依赖"确实是可验证的硬约束；但"LangGraph 的 checkpointer 会破坏 §5 不变量"
  只是断言，没有说明二者为何不能共存）。建议把 §6/README 改为"建议采用（待审）"，对每条"致命不匹配"
  补一句可证伪判据或指定由 `l2_kernel_verification` 用 spike 裁决；§6 已诚实的代价说明与 §8 风险条目
  可保留为对照。

[MAJOR] EXAMPLES 全篇 — `data` 边没有任何工作例（7 例只用到 dependency/join/route/repair/fallback/
  resource），`provenance`、`loop-back` 的五维语义也无判据示例；例 2 反而依赖未声明的"隐含产物依赖"。
  DoD"每种边有……语义"因此缺少示例层覆盖，L2 无法据此判定 data 边行为。建议补一个 data 边 example
  （digest 不符→阻塞；产物重生成→显式 rebind）。

[MINOR] SEMANTICS §3.1 `dependency` vs `route`（指定攻击点 1）— 二者**不构成直接矛盾**：dependency
  描述外部前置终态对下游节点的影响，route 描述本节点自身 outcome 无声明后继。但全文缺少统一判据说明
  "何时阻塞(waiting)、何时失败(failed)"，真正的矛盾在 dependency/join 之间（见 BLOCKER 2），不在
  dependency/route。建议补一条总则。

[MINOR] SEMANTICS §3.1 / §3.2 — `join` 既在 §2.1 是节点 kind，又在 §3.1 是边类型；例 2 只用具名
  join 节点、从不出现 join 边，字段名也在 requiredJoins（CONTRACTS GraphSpec）/ requiredBranches
  （节点、§5.3）之间漂移。建议统一为"fan-in 由 join 节点承载"，或明确 join 边的独立含义。

[MINOR] SPEC/graph 三文件措辞 — 文档用"冻结语义"，但节点 running、ADR proposed、正文自称待 l1_replan
  人审，属"提案写成已成立"。建议统一改"拟冻结/待审"。同样，例 5 "迟到回执丢弃或归档"给了两个选项，
  不是单一判定；例 6 "若实现要求'至少两类'"把 §4 的强制规则写成实现可变。

[NIT] EXAMPLES 例 1 — 事件序列里 `Decision(...)` 说成"内核内建，非单独节点"，与 §2.1 把 `evaluate`
  列为节点 kind 存在措辞张力；例 1 `maxWallClock`、例 6 `maxTokens` 与 §4 的 `maxTokensOrCost`
  字段名不一致。

已核对但确认无误的点:
1. §5.1 的九项原子校验与 CONTRACTS §4 末段"图变更的原子验证"逐项对应，无遗漏或增删（schema/引用/
   无环/数据可消费/required fan-in/授权/资源冲突/attempt-loop-depth-budget/可终止性）。
2. §5.2 六条修订边界与 ARCHITECTURE §6"图修订约束"五条 + DoD 第二条三句（失败分支不删、运行中输入
   不可变、小任务不强制并行）方向一致；例 4 的"拒绝 patch → 取消 → 新 attempt → 显式 rebind"是
   可判定的正确示范。
3. 例 5 的 `unknown` + reconcile 四分支 + 迟到回执不得改状态/重复记账，与 CONTRACTS §5.6、
   ARCHITECTURE §7 的"执行后回执前崩溃 = unknown、不自动重放"完全一致。
4. §3.2 的 SP 映射表与 §7 三图区分（SP 实施图无环、产品运行图允许有界环；relates/decides 为非门禁）
   与 ARCHITECTURE §3、§6 的表述自洽，未把 SP 设计工具当运行时。
5. 例 1（单 agent 退化、零并行）、例 6（loop ≥2 类 bound、恢复不重放已结算迭代、上限累计）与 §4
   不变量、"小任务不强制并行"的 DoD 第二条一致；README 的 cp1/cp2/cp3 → 文件映射与节点三个
   checkpoint（均已 passed）吻合。
```

补充一句给作者的风险提示：三处 BLOCKER 都落在"冻结语义表 §3.1 ↔ 工作例"的接缝上，说明 §3.1 是从各边分别写成、缺少一次跨行的终态对齐检查（尤其"waiting vs failed"这一条轴）。建议在提交 l1_replan 前加一遍"同一拓扑走三张边"的一致性自检，而不是只补单行措辞。

---

## 复核回合 3

Let me verify a couple of exact claims with grep before finalizing.

---

## 复核回合 4

已完整重读 rev2 的三个文件（全文，非 diff 描述），并对照 SEMANTICS §3.0/§3.1/§2.2/§5.3、EXAMPLES 例 1–9、README、CONTRACTS.md §1/§4/§5、ARCHITECTURE.md §6 逐条核验。未修改任何文件。

```
结论: 需修订（blocker 小 2）

[BLOCKER] SEMANTICS §3.0（正文 vs 它自己的表格）· §3.1 `route` 行 · EXAMPLES 例 1 / 例 8 —
  正文写"只要缺口仍可能由新 attempt、`fallback` 或**合法图修订**补上，就停在 `waiting`"，但 §3.0 表格第 4 行
  把"`route` 无任何匹配后继"直接判 `failed`——而"无匹配"恰恰只需一次合法图修订（新增一条 route）即可补；
  反过来表格第 1 行规定 `dependency` 前置进入 failed/cancelled **永远** `waiting`，即使该前置已被 §5.2 标为
  abandoned、不可能再产生新 attempt（按正文这就是"无出路"，应判 `failed`）。此外 §3.1 `route` 行
  "全部 route 都不匹配 → `failed`"对**零条 route** 的节点同样成立，而例 1 的 n1（零 route、`outcome=completed`）
  恰恰 `succeeded`，例 1 与例 8 因此互相冲突。— 这正是评审焦点 (a) 的答案：**总则无法推出三行终态**，
  三行各自是硬编码例外，L2 无法用"单一函数"实现；两处可达情形（永久取消的 dependency、零 route 的完成节点）
  终态不可判定。— 建议：把 §3.0 写成真正的判定函数（输入含"是否存在可覆盖该缺口的 repair/fallback 边或
  合同条款""节点是否声明 ≥1 条 route"），对 dependency/join/route 给出可观测触发条件，并给例 1/例 8 补上前提。

[BLOCKER] SEMANTICS §2.2（mermaid `unknown --> waiting: reconcile 结论不完整` + 入边表第 4 行）vs EXAMPLES 例 6 出口 4 —
  §2.2 mermaid 第 74 行与入边表第 4 行都规定 unknown 在"reconcile 结论不完整"时转 `waiting`；例 6 出口 4
  （EXAMPLES:198）却写"结论不完整 → 保持 `unknown`，并暴露给用户（**不进 `waiting`**——waiting 表示知道在
  等什么）"，反例 B（EXAMPLES:204）还进一步禁止把 unknown 当 waiting。同一事件被规定成两种相反状态转移。—
  这是评审焦点 (d) 类型的新矛盾：例 6 是"核心安全属性"的 accept 判据，与 §2.2 直接互斥。— 建议：二选一
  并三处同步；若采纳例 6 的语义（理由更充分，unknown≠知道在等什么），删除 mermaid 第 74 行与该入边表行；
  若采纳转移，改写例 6 出口 4 与反例 B。

[MAJOR] SEMANTICS §2.2 mermaid vs 入边表（自称"补齐 waiting 四条入边"未落地）—
  mermaid 到 waiting 的入边只有三条：`leased --> waiting`(63)、`verifying --> waiting`(70)、`unknown --> waiting`(74)；
  入边表却列四条，且来源对不上：表第 1 行写"`pending/ready` 资源租约不可得"，mermaid 写的是 `leased → waiting`；
  表第 2 行写"`running` 前置的失败传播"，mermaid 中**没有**对应边。BLOCKER-2 的核心场景（dependency 前置失败
  使 pending/ready 的节点转 waiting）仍未出现在状态机里。— 结论：§2.2 未真正对齐 §3.1 `dependency` 行，
  评审焦点 (d) 的"例 2 与 §2.2"因此未闭合。— 建议：补 `pending/ready --> waiting`（依赖失败、资源不可得），
  并把 `leased → waiting` 删除或改述。

[MAJOR] SEMANTICS §3.2 资源 readiness 三处互斥（评审焦点 c/d）—
  §3.2 写"进入 ready 前必须能**预留**其全部 exclusive 资源…；**预留失败不阻塞 ready 判定本身**，但不得进入
  `leased`"；§2.2 要点 1 又把"资源可租"列为 ready 五条件之一；§2.2 入边表/mermaid 则让节点在 pending/ready
  与 leased 两处因资源不可得去 `waiting`。同一情形到底是"不 ready（留 pending）""ready 后转 waiting"还是
  "leased 后转 waiting"，三种说法互斥。— 建议：明确 ready 只断言"存在可预留容量"，实际取租在 ready→leased
  之间、失败则 `ready → waiting`，据此统一 §2.2 要点 1、mermaid、入边表与 §3.2。

[MAJOR] ARCHITECTURE.md §6 与 rev2 §3.2 冲突（评审轴 C）—
  ARCHITECTURE §6 的"边/约束"表第 145 行仍把 `resource` 列成一条可执行边（"对 workspace、integration writer…
  授予排他/共享租约"），rev2 已明确 `resource` **不再是边类型**。基准文档未同步，实现者按 ARCHITECTURE 会
  重新引入 rev1 的 ready 环。— 建议：同步更新 ARCHITECTURE §6，或在 §3.2 注明该表把 resource 视作"约束"
  而非 typed edge；三处口径需一致。

[MAJOR] SEMANTICS §3.1 全边方向约定过宽 —
  表头约定"`from` 是**上游/生产者**，`to` 是**下游/消费者**…此约定**对全部边类型成立**"，但 `repair`（例 2
  `repair(nV→nM)`，nV 拓扑上位于 nM 下游）与 `fallback`（例 3 `fallback(nX→nY)`，nX 与 nY 是 nT 的兄弟分支）
  中 `from` 是触发者、并非上游/生产者。且 rev2 声称"§3.1 定义为 from=触发者"，但 §3.1 `repair` 行实际只写
  "触发者判定 `repair`"，from/to 定义只出现在 EXAMPLES 例 2。— 建议：改为"blocking 边 from=上游生产者；
  routing 边 from=判定/触发者，to=被选中/被重试的分支"，并把该定义写回 §3.1（规范应自洽）。

[MAJOR] SEMANTICS §5.3 / EXAMPLES 例 2 join 失败判据含模态 —
  §5.3 第 2 行"缺口**可能**由 repair/新 attempt 补（默认）→ `waiting`"中"可能"不是可观测量；L2 无从判定。
  例 2 反例 B 断言"判 failed 即违约"，但该断言成立取决于任务合同未把 nB 标为不可替代——例 2 未给出合同内容；
  且例 2 声明的 repair 边是 `nV→nM`，并不覆盖失败的 nB（例文却说"缺口可由 repair 补"）。— 建议：改成
  "存在指向该分支的 repair|fallback 边，或合同未把该分支标为不可替代 → waiting；否则 failed"，并在例 2
  写明合同的 replaceable/optional 字段。

[MINOR] EXAMPLES 例 6 出口 3（EXAMPLES:197）仍写"新 attempt **或** `waiting`（等授权）"，与同段自述"四条出口
  （单一判定，不留'或'）"不符；rev2 claim 9 只收敛了出口 4。建议拆成两条或写明选择规则。

[MINOR] EXAMPLES 例 2 branchReport 把 nM 记作 `pending`（EXAMPLES:88），但 §3.1 `data` 行规定输入不可消费时
  转 `waiting`；同一节点状态两处不一致，取一。

[MINOR] EXAMPLES 例 3 例外条款要求"合同标 optional **且 `authorityRef` 覆盖该标注**"，§3.1 `fallback` 取消
  单元格只写"任务合同显式把该分支标为 optional"，缺 authorityRef 条件（BLOCKER-1 修复只落地了 90%）。

[MINOR] SEMANTICS §2.2 自称"与 CONTRACTS.md §4 **同一张图**"，但已新增 `leased→unknown/waiting`、
  `running→cancelling`、`unknown→waiting`、`pending/ready→cancelled` 等，CONTRACTS §4 未同步；建议改称
  "§4 的超集/修订版"并登记 drift（尤其 unknown→waiting 与例 6 冲突，见 BLOCKER-2）。

[MINOR] SEMANTICS §5.2 仍未说明 `waiting` 节点能否就地改（只列 pending/ready 可自由改），而 §2.2 又用"合法
  图修订"作为 `waiting → pending` 出口；建议明确 waiting 的可改性。

[MINOR] "join 自身无预算"的规范陈述现仅存在于 EXAMPLES 例 2 反例 E；§3.1/§5.3 正文未写。建议移回规范正文
  （join 节点的 cancel/recovery/budget 三维在 §5.3 只有终态判定）。

[NIT] SEMANTICS §2.2 入边表"running 前置的失败传播"措辞费解（dependent 处于 pending/ready，不是 running）；
  建议改"前置失败传播（前置曾 running）"。EXAMPLES 例 2 的"分支失败路径"与"repair 路径"是互斥场景
  （nB 失败时 nV 不会运行），未标起点，建议注明。

已核对但确认无误的点:
1. BLOCKER-1 已真正落地：§3.1 `fallback` 取消单元格 + 例 3 期望/反例 A + 唯一例外条款口径一致（仅 authorityRef
   细节待补），旧版"被取用分支进入 cancelled"已删除，与 ARCHITECTURE §6"保留原失败证据"一致。
2. 评审焦点 (b) 通过：例 2 移除 resource 边后，blocking 投影为 {nA,nB}→nM(data)→nJ(dependency)→nV，无环；
   `nM` 的 ready 由显式 `data(nA→nM)/data(nB→nM)` 推出，nB 失败时 `data(nB→nM)` 未满足 → 不 ready，旧
   ready 环已消除；例 2 反例 C 还禁止依赖"隐含产物依赖"，与 §5.2 一致。
3. 评审焦点 (c) 在"边"层面成立：6 种边（dependency/data/route/repair/fallback/provenance）在 §3.1 表中
   readiness/取消/失败/恢复/预算五列齐全，provenance 以"无关"定义亦属定义；§5.1 第 3 项已同步为
   "dependency ∪ data 的 blocking 子集"、第 7 项资源冲突改由资源名推导，与 §3.2 自洽（资源自身矛盾见 MAJOR）。
4. rev2 claim 7 落地：§6 降为"建议采用，待人审"，每条否决补可证伪判据并指定 `l2_kernel_verification` spike，
   §8 新增该未证明项；README 一页结论 #3/#4/#9 同步，未再把提案写成已定案。
5. 例 1/4/5/7/9 可判定：例 4（digest 不符→waiting、running 不撤回、rebind 需 GraphPatch）与 §3.1 `data`
   三列一致；例 7 字段名已统一 `maxTokensOrCost` 且"只声明一类→拒绝"与 §4 不变量 2 一致；README 的 9 例清单、
   EXAMPLES 实际 9 例、"供 L2 使用的判据索引"表逐条对应；§3.3 新增 fan-in/资源两行并标明"不是边"。
```

补充一条给作者的判断：四个修复面（fallback、join/dependency、resource、data 例）本体都做对了，新问题集中在 rev2 **新增**的两处——§3.0 总则与它所统辖的三行没有真正收敛（BLOCKER-1），以及 §2.2 状态机新增的 `unknown→waiting` 与例 6 互斥（BLOCKER-2）。建议在提交 `l1_replan` 前对"总则 → 每条边/每个终态"做一次单表对照，并让 §2.2 与 EXAMPLES 的每条状态转移交叉签字（resource/ready/waiting 与 unknown/waiting 是当前唯一未闭合的两簇）。

---

## 复核回合 5

已完整重读 rev3 三个文件（全文），并用 grep 逐条核对了 mermaid 入边、`unknown` 出边、`terminal`/`abandoned`/R4/R5 的落点。未修改任何文件、未触碰 `.graph/`。

```
结论: 需修订（blocker 小 1）

[BLOCKER] SEMANTICS §3.0 规则 4b vs §5.3 第 3 行 —
  §3.0 规则 4b：missingInput 只有"缺口上游**被标 abandoned** 且合同未声明可替代"才 → `failed(upstream-abandoned)`；
  否则（4c）"上游仍可能有新 attempt" → `waiting`。§5.3 第 3 行却写"存在 `failed/cancelled`，且任务合同声明该分支
  **不可替代**、无 `fallback` → `failed`"——这里**不要求 abandoned**。于是"必需分支 failed + 合同声明不可替代 +
  未 abandoned"这一可达情形：§3.0 命中 4c → `waiting`，§5.3 命中第 3 行 → `failed`。— 这正是第二轮 BLOCKER-2
  的同类（同一情形两种相反终态），rev3 只改了 §3.0 与例 2/10/§2.2，§5.3 未同步；根因是把"不可替代（irreplaceable）"
  与"不可恢复（unrecoverable=abandoned）"混为一谈。— 建议：§5.3 第 3 行改为"该分支被标 `abandoned`（或合同声明
  不可替代**且**该分支已不可再产生新 attempt）→ failed"，与 §3.0 4b/4c 逐字对齐。

[MAJOR] SEMANTICS §3.0 `decide()` 规则 4a 的谓词与规则 5 的兜底（评审焦点 a）—
  规则 4a "存在已声明的 repair/fallback 边**可覆盖该缺口**"中"可覆盖"没有可观测定义。按定义的图代入：
  ① 例 8（nV 两条 route、outcome=needs-human、无 fallback）：规则 1 不命中 → 规则 2 unconsumable → **规则 3** →
     `failed(no-matching-route)`，与例 8 期望一致（"§3.0 第四行"的引用是错的，见 MINOR）。
  ② 例 10 路径 B（nB abandoned、合同不可替代、nD 依赖 nB）：规则 1 不命中 → missingInput → 4a 无覆盖边 → 4b →
     `failed(upstream-abandoned)`，与期望一致。
  ③ 例 2 分支失败（nB failed、nJ.requiredBranches∋nB）：规则 1 不命中 → missingInput → **4a 要求"可覆盖 nB"的边，
     而全图唯一的 repair 是 `repair(nV→nM)`（覆盖 nM，不覆盖 nB）** → 4b 否 → 实际命中 **4c** → `waiting`。
     终态与例 2 相同，但例 2 正文与反例 B 都写"缺口可由 repair 补 / 命中 4a"，与函数不符。
  另外规则 5 `else → failed(unclassified)` 会把"节点自身 attempt 失败"（例 3 的 nX `tool-unavailable`、例 2 的 nB）
  吞成 `failed(unclassified)`，丢掉真实 reason；且规则 1 返回 `progress` 而节点自身却是 `failed`（例 3 走 fallback），
  函数签名 `decide(N,event)->progress|waiting|failed` 没有区分"节点终态"与"图可推进"。— 结论：函数对
  dependency/join/route 的终态**能**推出，但 4a 不可判定、规则 5 会误分类、返回语义层级混淆，"单一判定入口"
  尚不能直接实现。— 建议：把 4a 写死为"存在 `repair|fallback` 边其 `to` 是缺口节点或缺口节点的替代者"；补
  "自身 attempt 失败 → failed(来自 receipt 的 reason)"；把 `progress` 明确为"图可推进"并与节点终态分列两个函数。

[MAJOR] R4 / R5 未接入 §5.1（评审焦点 b）—
  §3.0 R4 自称"否则 **§5.1 校验拒绝**创建"、R5 要求 abandoned 必须带 `authorityRef` 与理由，但 §5.1 的九项
  校验（schema/引用/无环/数据可消费/requiredJoins/授权/资源冲突/budget/可终止性）**没有任何一项提到 R4 或 R5**。
  R4 完全未接入；R5 至多隐含在第 6 项"作用域授权"，未点名。— 结果：§3.0 保证的"零 route 非 terminal 节点在
  合法图中不存在"实际上无人执行，例 8 的"校验期错误"无判据。— 建议：§5.1 增加第 10 项"路由完备性（R4：
  0 route 节点必须 `terminal: true` 或只有 `provenance` 出边）"，并在第 6 项点名 R5 的 `authorityRef` 要求。

[MAJOR] `abandoned` 是新引入且未定义载体的概念（评审焦点 c）—
  R5 只写"`abandoned` 是对分支/上游的**显式标注**，必须带 `authorityRef` 与理由"，但全文没有定义它是：节点字段
  （如 `abandoned: true`）？分支/边上的标注？还是一个节点状态？§2.2 状态机没有 `abandoned` 状态；§5.1 的
  `GraphPatch { adds[], changes[], removals[], ... }` 也没有对应字段；例 10 只说"图 patch 把 nB 标 abandoned"。
  同时被标记的 nB 自身终态未定义（是 `failed`、`cancelled` 还是"failed+abandoned"标志？）。— R5 是必要条件但**不充分**，
  例 10 作为 accept/fail 判据无法据此实现。— 建议：在 §2.2 或 §5.2 明确 `abandoned` 的承载物（建议：节点/分支上的
  布尔标注 + 审计事件，节点状态保持 `failed`）、GraphPatch 字段名，并说明其与 §2.2 状态机的关系。

[MAJOR] EXAMPLES 例 10 路径 C 未接线 —
  路径 C 只声明"存在 `fallback(nB → nD2)`"，却期望"nD 依 4a 转 `waiting`，等 `nD2`"。图中没有 `nD2 → nD` 的
  data/dependency 边，nD 与 nD2 之间无声明路径，4a 的"可覆盖 nD 的缺口"不成立；且 `fallback(nB→nD2)` 的 `from`
  是已 abandoned 的 nB（与 §3.1 fallback 行"仅当声明的失败条件成立"一致与否也未明）。— 建议：路径 C 加 `data(nD2→nD)`
  （或把 fallback 直接接到 nD），使之与 4a 的谓词一致。

[MAJOR] SEMANTICS §3.1 方向约定仍过宽（第二轮 M4 未修复）—
  "`from` 是上游/生产者…此约定**对全部边类型成立**"仍与例 2 `repair(nV→nM)`（nV 在拓扑上位于 nM 下游）、例 3
  `fallback(nX→nY)`（nX 与 nY 是 nT 的兄弟分支）冲突；rev3 新函数也未消除该冲突。建议改为"blocking 边 from=上游
  生产者；routing 边 from=判定/触发者"，并把 `repair`/`fallback` 的 from/to 定义写回 §3.1。

[MAJOR] SEMANTICS §3.2 资源 readiness 仍与 §2.2 要点 1 互斥（第二轮 M2 未修复）—
  §3.2 写"进入 ready 前必须能**预留**…；**预留失败不阻塞 ready 判定本身**，但不得进入 `leased`"（句内自相矛盾），
  §2.2 要点 1 又把"资源可租"列为 ready 五条件之一。同一情形到底是"不 ready（留 pending）"还是"ready 后转 waiting"
  仍无定论。建议明确 ready 只断言"存在可预留容量"、取租失败走 `ready → waiting`，并据此统一两处。

[MAJOR] ARCHITECTURE.md §6 仍把 `resource` 列为边（第二轮 M3 未修复）—
  ARCHITECTURE §6 第 145 行仍有 `| resource | 对 workspace、integration writer…授予排他/共享租约 |` 一行，与 rev3
  §3.2"`resource` 不是边"冲突；基准文档未同步，实现者按 ARCHITECTURE 会重新引入 ready 环。建议同步或加注。

[MAJOR] SEMANTICS §5.3 第 2 行仍是模态（第二轮 M5 未修复，且与 rev3 §3.0 冲突）—
  "缺口**可能**由 repair/新 attempt 补（默认）→ `waiting`"中的"可能"不是可观测量；rev3 §3.0 已用 4a/4c 给出
  可判定规则，§5.3 应改为引用 4a/4c，否则两处对同一情形给不同判据来源。

[MAJOR] EXAMPLES.md 开头一行仍宣布被 rev3 否定的规则 —
  文件首段"所有例子共同服从 SEMANTICS §3.0 总则：**failed = 图与任务合同层面已无出路；仍可能被 repair/fallback/
  **图修订**补上的缺口一律 waiting**"——其中"图修订可补则 waiting"正是 rev3 §3.0 明确否定的（"图修订不是出路
  判据"，否则永远 waiting）。这是 focus(d) 要求的"新引入矛盾"：EXAMPLES 前言与 SEMANTICS §3.0 直接互斥。建议把
  该行改为"服从 §3.0 `decide()`：只承认当前 revision 内已声明路径；图修订不是出路判据"。

[MINOR] SEMANTICS §3.1 `route` 失败单元格仍写"（§3.0 **第四行**）"，而 rev3 中 route 无匹配对应**规则 3**（第四行
  是 missingInput）；stale 交叉引用会误导实现。
[MINOR] SEMANTICS §3.1 `dependency`/`data` 失败单元格仍写无条件"→ `waiting`"，未提 §3.0 4b（上游 abandoned 时
  应 `failed`）；与 §3.0 对齐表不一致。
[MINOR] `decide()` 规则 3 只认 `route`，规则 1 却用"已声明路径"；`repair`/`fallback` 是否计入"route"未定义。
  例 2 的 nV 只有 `repair` 出边（无 `route` 出边），按规则 3 字面不触发、按规则 1 又可能 `progress`，两者结论不同；
  且"有 fallback 但 `when` 不匹配"会落到规则 5 `failed(unclassified)`，与 `route` 行"除非有 fallback"的语义不清。
[MINOR] README 文件表仍写 EXAMPLES 为"**9** 个可判定工作例"且清单未含 `abandoned` 例（实际 10 个）；应改为 10 并补例 10。
[MINOR] EXAMPLES 例 6 出口 3 仍写"新 attempt **或** `waiting`（等授权）"，与"四条出口（单一判定，不留'或'）"自述不符。
[MINOR] `terminal: true` 是新字段，未进 §5.1 校验清单，也未与 CONTRACTS §1 NodeSpec 的 `termination` 字段对齐
  （R4 已在上一条 MAJOR 覆盖）。
[NIT] §3.0"据此逐行对齐"表把 `unknown`（§2.2 的事）与校验期 R4、运行时规则混排，易被读成运行时规则；建议拆表。
[NIT] EXAMPLES 例 2 反例 B 仍用旧"§3.0 总则…缺口可被 repair 补"措辞，与函数化后的规则编号不一致（同 4a 问题）。

已核对但确认无误的点:
1. 第二轮 BLOCKER-2 已闭合：`unknown --> waiting` 已从 mermaid 删除，`unknown` 出边只剩 `verifying`/`failed`，
   新增的 waiting/unknown 对照表与例 6 出口 4、反例 B 一致（grep 确认无残留 `unknown→waiting`）。
2. 第二轮 MAJOR（表 4 条 vs 图 3 条）已闭合：waiting 入边表 3 类与 mermaid 的 `pending/ready/leased/verifying`
   逐条对应，旧"running 前置失败传播"行已删除。
3. 例 1 的 n1 补 `terminal: true`、例 8 补"声明了 ≥1 条 route"前提后，"零 route 节点"与"route 无匹配"都变得可判定：
   例 8 代入函数命中规则 3 → `failed(no-matching-route)`，与期望一致。
4. 例 10 路径 B 代入命中毒 4b → `failed(upstream-abandoned)`，与 §3.0 对齐表一致；R5 的"abandoned 不得绕开失败
   分支不删"与 §5.2 一致（载体待补见 MAJOR）；例 10 反例 A 正确封堵了"用图修订当出路"。
5. DoD 第二条、6 种边 × 五维表、例 2 的无环 ready 投影（`nA/nB→nM(data)→nJ→nV`）、§3.3/§7/README 一页结论
   与 rev3 自洽；`resource`/`join` 已彻底移出边表且 §5.1 第 3/7 项同步。
```

一句话给作者：rev3 的两个 BLOCKER 本体（§3.0 函数化、`unknown≠waiting`）方向正确且大部分落地；但函数化只改了一半——**§5.3 第 3 行、§3.1 的三处交叉引用、R4/R5 的校验落点、`abandoned` 的载体**这四处还停在 rev2 的口径上，另有三条第二轮 MAJOR（resource 方向/资源 ready 矛盾/ARCHITECTURE 漂移）未处理。建议下一版做一次"§3.0 规则编号 → §3.1 五维单元格 → §5.1 校验项 → §5.3 判定"的单向对齐，并对 `abandoned` 定一个明确载体。

---

## 复核回合 6

已完整重读 rev4 三个文件，并逐条代入函数核对。未修改任何文件、未触碰 `.graph/`。

```
结论: 需修订（blocker 小 1）

[BLOCKER] SEMANTICS §3.0.1 `declaredOutgoing` / `hasMatchingRoute` + §5.1 第 10 项 vs §3.1 `repair` 行 / EXAMPLES 例 2 —
  `declaredOutgoing(N) = route ∪ fallback 出边集合`（**不含 `repair`**），`hasMatchingRoute` 只查 `route` 边，
  `onOutcome` 也没有 repair 分支。于是"只声明 `repair` 出边"的节点——例 2 的 `nV`（唯一出边是 `repair(nV→nM)`）：
  ① §5.1 第 10 项 `declaredOutgoing(nV)=∅` 且 nV 未标 `terminal:true` → **校验期整体拒绝**，例 2 这个小图根本无法创建；
  ② 若绕过校验，`onOutcome(nV, 'repair')` → 无 route、无 fallback、declaredOutgoing=∅ → **F8 INVARIANT_VIOLATION**。
  — 这与 §3.1 `repair` 行"`from`（触发者）判定 repair → 对 `to` 产生新 attempt"、例 2 的 repair 路径、README
  "repair 真执行"直接冲突：`repair` 边在判定函数里**没有任何求值入口**，而它正是 `adr_0002` 的核心价值之一。—
  建议：`declaredOutgoing(N) := route ∪ repair ∪ fallback 出边`；`onOutcome` 增加 `hasMatchingRepair(N, outcome)`
  分支（命中 → `{ failed(原 reason), [enable(repair.target)，并对 to 开新 attempt] }`）并给它一个 F 编号；§5.1 第 10
  项随谓词修正。

[MAJOR] EXAMPLES 例 10 路径 C vs SEMANTICS §3.0.1 `hasDeclaredCover` —
  `hasDeclaredCover(U) : ∃ 边(repair|fallback, to=U)`。路径 C 只声明 `fallback(nB → nD2)`（`to=nD2`），所以
  `hasDeclaredCover(nB)` 应为**假**，按函数命中 F6 → `failed`；但路径 C 期望"`hasDeclaredCover(nB)` 仍为真 → F5 →
  waiting 等 nD2"。例 10 是"F5 优先于 F6"的**唯一**判据，却与谓词定义相反；且 nD 与 nD2 之间仍无
  `data`/`dependency` 边（round-3 同一问题未修），"等 nD2"无从落地。— 建议：路径 C 改为声明 `repair(X→nB)`
  （真正让 nB 重获 attempt），或补 `nD2→nD` 并把 `hasDeclaredCover` 重定义为"存在替代 nB 输出的已声明路径"；
  否则把路径 C 的期望改为 F6。

[MAJOR] SEMANTICS §2.2 mermaid `waiting --> failed: 缺口上游被 abandoned` 缺 F5 守卫 —
  F5 规定"上游 abandoned 但 `hasDeclaredCover(U)` 为真时仍 `waiting`"（这也是例 10 路径 C 想表达的"F5 优先"），
  但状态机该边只写"被 abandoned"就转 `failed`。建议改为"缺口上游被 abandoned **且 `hasDeclaredCover(U)` 为假**"。

[MINOR] SEMANTICS §3.0.2 规则编号不完整（评审焦点 a 的编号口径）—
  代码只标了 F3/F4/F5/F6/F7/F8；`isTerminal` 与 `hasMatchingRoute` 两行没有 F1/F2 标签，§3.0.3 用"—（A 首行）"
  指代。README 与修订记录却声称"统一为 F1–F8"，实际 F1/F2 从未出现。建议补标签或改称"F3–F8"。

[MINOR] SEMANTICS §2.2 `ready --> waiting` vs "竞态失败留在 ready"（评审焦点 c）—
  正文把资源不可得拆成"竞态失败→留 ready"与"明确不满足→waiting"，设计自洽；但 waiting 入边表把该入边触发写成
  "原子预留条件暂时不满足（**配额被他人持有**）"——"暂时/被他人持有"正是正文判给"留 ready"的竞态情形。这是最后
  一处资源矛盾（mermaid 一行含两触发，表里举例反了）。建议把表内触发改为与竞态互斥的可观测条件（如"policy 声明
  该资源但配额恒为 0 / 无任何释放路径"），并说明"无排队可能"如何判定（现规格没有排队模型）。

[MINOR] SEMANTICS §3.0.2 F8 的定位（评审焦点 d）—
  对通过 §5.1 的图，`declaredOutgoing(N)=∅ 且非 terminal` 已被第 10 项拒绝，F8 在正常运行中**不可达**；文档也已
  写"只在合法图被绕过 §5.1 提交时命中"。这是合理的防御性断言，不必删除；但应在其旁明写"assertion，正常不可达"，
  且其不可达性依赖先修 `declaredOutgoing`（见 BLOCKER），否则当前口径下 F8 反而**可达**（例 2 的 nV）。

[MINOR] SEMANTICS §3.0.2 `onOutcome` 在 reason 不匹配时仍套 F3 —
  只声明 `fallback`、但 `when` 与失败 reason 不匹配的节点（例 3 反例 B 的情形）会走 `declaredOutgoing(N) ≠ ∅ → F3
  failed(no-matching-route)`，把节点自身的 `tool-unavailable` 覆盖成路由失败原因。建议保留原失败 reason，或为该
  情形单独编号。

[MINOR] SEMANTICS §3.1 方向约定仍未按边类型收窄 —
  表头"`from` = 上游/生产者…（对全部边类型成立）"与 `repair` 行（from=触发者，例 2 `repair(nV→nM)` 中 nV 位于
  nM 下游）、`fallback` 行（例 3 `fallback(nX→nY)`，nX/nY 为兄弟）冲突。round-2/3 已提，rev4 未改。建议改为
  "blocking 边 from=上游生产者；routing 边 from=判定/触发者"。

[MINOR] SEMANTICS §2.2 资源不可得从 `pending` 无 `waiting` 出边 —
  表里资源 waiting 只从 `ready` 进入；永久不可满足的资源会让 `pending` 节点静默停留、不暴露 gap。建议明确这是
  有意（pending 不暴露缺口）还是补 `pending → waiting`。

[NIT] SEMANTICS §3.0.2 `isTerminal` 与 `hasMatchingRoute` 的优先级：terminal 节点若同时声明 route，会先被
  `isTerminal` 短路；R4 只约束"零 route 节点必须 terminal"，未禁止"terminal 节点带 route"。建议补一句。
[NIT] EXAMPLES 文件头只举了 F4，未提 repair/F8；待 BLOCKER 修好后可补"repair 命中哪个 F 编号"。

已核对但确认无误的点:
1. 评审焦点 (a)——§3.0.3 表 / §3.1 六行失败单元格 / §5.3 四行在 dependency·data·join 的失败终态上**三处一致**。
   代入：T1 例 2 `nB` failed（cover 假、未 abandoned）→ **F7 waiting**；T2 例 10 路径 A2 `repair(nZ→nB)`（cover 真）
   → **F5 waiting**；T3 例 10 路径 B（nB abandoned、无 cover）→ **F6 failed**；T4 例 8（nV 有 2 条 route 但 outcome
   needs-human、无 fallback）→ **F3 failed(no-matching-route)**。"`irreplaceable` 不是终态触发条件"这条已真正成立。
2. 评审焦点 (b)——只有 `fallback` 出边、无 `route` 出边的节点：`when` 匹配失败 reason 时命中 **F4**（例 3 的 nX：
   nodeState=`failed(tool-unavailable)`、graphActions=`[enable(nY)]`，与 §3.1 `fallback` 行"原失败分支保持 failed"
   一致）；`when` 不匹配时命中 F3（见上 MINOR）。(b) 中唯一不成立的是"只有 `repair` 出边"的例 2 `nV`，落在 BLOCKER。
3. §5.1 第 10/11 项确实接入了 R4/R5（分别关联 §3.0 F8 与 §2.4/§5.2），round-3 的"校验无落点"MAJOR 已闭合（R4
   的谓词口径问题见 BLOCKER）。
4. §2.4 已给 `terminal`（节点字段，映射 CONTRACTS NodeSpec 的 `termination`）与 `abandonedBranches`（图级列表，
   `authorityRef`/`reason` 必填、仅经 GraphPatch 写入）明确载体，round-3 的 MAJOR(c) 已闭合；§2.2 waiting 入边表
   3 行与 mermaid 逐条对应，`unknown` 出边仍只有 `verifying`/`failed`。
5. 例 1 的 `terminal: true`、例 8 的"≥1 条 route"前提与"图修订不是出路判据"、例 6 出口 3 去"或"、例 10 重写为
   四路径、README 改为"10 个例子"——与 rev4 声称一致，均已落地。
```

一句话给作者：rev4 的"单向对齐"在 dependency/data/join 这三条 blocking 路径上确实做成了，R4/R5 落点与 `abandoned`
载体也都补上了；**唯一的结构性漏洞是 `repair` 没有进入 `decide()` 的谓词闭包**（`declaredOutgoing`/`hasMatchingRoute`
都漏了它），结果是产品最核心的修复路由既过不了 §5.1 第 10 项、又只能落到 F8——这是本轮必须修的一条，其余全是措辞/
编号/示例口径（含例 10 路径 C 与 `hasDeclaredCover` 定义不符、资源示例举例反了）。修掉 repair 谓词后再补一次
`declaredOutgoing` 的三处引用（§3.0.1 / §5.1 第 10 项 / 例 2 校验），本轮即可收敛。

---

## 复核回合 7

已完整重读 rev5 三文件，并按要求代入验算、全文 grep 旧编号/未定义谓词。未修改任何文件、未触碰 `.graph/`。

```
结论: 需修订（blocker 小 1）

[BLOCKER] SEMANTICS §3.0.1 F5 `declaredOutgoing` + §5.1 第 10 项 vs §3.1 `dependency`/`data` 行 / EXAMPLES 例 2·3·4·9·10 —
  `declaredOutgoing(N) = route ∪ repair ∪ fallback 出边集合`，**不含 `dependency`/`data`（也不含 `provenance`）**。于是任何"只带 blocking 出边"的普通生产节点都满足 `declaredOutgoing = ∅`：
  ① §5.1 第 10 项（R4）要求这类节点 `terminal: true`，否则整图被拒；
  ② 若绕过校验，`onOutcome(N, succeeded)` → F1/F2/F3/F4 均不中 → F5 不中（∅）→ **F8 INVARIANT_VIOLATION**。
  代入例 2：`nA`（唯一出边 `dependency nA→nJ`）→ `declaredOutgoing(nA)=∅` → 需 `terminal:true`（未标）→ **例 2 整图被 §5.1 第 10 项拒绝**；其成功 outcome 还会落 F8。同样中招：例 2 的 `nB/nM/nJ`、例 3 的 `nY`、例 4 的 `nG/nC`、例 9 的 `nX`、例 10 的 `nB/nD`。
  — 这与 §3.1 `dependency` readiness "`from` 达到 `succeeded`"直接冲突：blocking 边**就是**上游 success 的消费者，但 F5 的"outcome 不可消费"只认 route/repair/fallback。§2.4 又把 `terminal` 定义为"本图/子图的**终局产出点**"，把中间生产节点标 terminal 是语义错误的。结果是**10 个例子里至少 5 个无法通过 rev5 自己的校验清单**，而它们是 `l2_kernel_verification` 的 accept 判据。
  注：这不是措辞/编号问题，是谓词覆盖缺口；rev3 的 R4 还留了"或只有 `provenance` 出边"的例外，rev5 把它也一并丢了。
  — 建议（二选一，推荐 A）：A. `declaredOutgoing(N) := N 的**任意**出边（route∪repair∪fallback∪dependency∪data∪provenance）`，R4 只拦"完全没有出边且非 terminal"的节点；同时 `onOutcome` 把 blocking 出边视为合法消费者（有 blocking 出边 → 只记录 success、不走 F5/F8）。B. 保留"路由出边"口径，但把 R4 明确限定为"routing 节点"，并给纯生产节点另设"success 由 blocking 边消费"的正式分支。

```

评审焦点逐条回答：

**(a) 逐行代入（含 4 个指定拓扑）**
- T1「只有 `repair` 出边的节点」（例 2 `nV`，out=`repair`）：F1 否 → F2 否（无 route）→ **F3** 命中 → `nodeState=failed(原 reason)`、`graphActions=[newAttempt(nM), enable(nM)]`。对照 §3.1 `repair` 行（from=触发者、对 to 产生新 attempt、触发者自身保持 failed）✓；§5.1 第 10 项（`declaredOutgoing(nV)={repair}`≠∅，不再要求 terminal）✓；§5.3 N/A。**三处一致，round-4 BLOCKER 已真正修掉。**
- T2「`terminal:true` 但 outcome 失败」：F1 命中 → 交 TaskDecision 定 `succeeded/failed`。对照 §3.0.3 首行 ✓。一致（但见 MINOR：terminal 节点若另有 route/repair/fallback 会被 F1 短路）。
- T3「上游 abandoned 且有 `repair` 指向它」（例 10 路径 C：`nB` abandoned + `repair(nZ→nB)`，`nD` 依赖 nB）：`onUpstreamTerminal` → F6 `hasDeclaredCover(nB)=真` → `waiting(gap)`。对照 §3.1 `dependency` 失败单元格（有 cover→waiting）、§5.3 行 2（F6 waiting）、§2.2 `waiting→failed` 守卫（cover 为假才转）✓。**三处一致。**
- T4「上游非 succeeded、无 cover、未 abandoned」（例 2 `nB`→`nJ`）：F6 否 → F7 否 → **F8**（event B 默认）→ `waiting(gap)`。对照 §3.1 `dependency`（F6/F8→waiting）、§5.3 行 4（F8 waiting）✓。**三处一致。**
- T5（缺陷）「只带 `dependency` 出边的生产节点」（例 2 `nA`，out=`completed`）：F1–F5 全不中 → **F8 INVARIANT_VIOLATION**；且 §5.1 第 10 项预拒。与 §3.1 dependency、例 2 相矛盾（见 BLOCKER）。
- T6「有 route 出边但 outcome 不匹配、无 fallback/repair」（例 8 `nV`）：F5（`declaredOutgoing≠∅`）→ `failed(no-matching-route)`。对照 §3.1 route 行 F5 ✓。

**(b) 旧编号 / 未定义谓词扫描（grep 结果）**
- 旧编号 `4a/4b/4c`、"规则 3" 只出现在 rev4 修订记录里描述历史，正文无残留 ✓。
- F1–F8 引用一致：例 8=F5、例 2 分支失败=F8、例 10 A=F8/A2=F6/B=F7/C=F6、§5.3=F6/F7/F8、§3.1=`F3`(repair)/`F4`(fallback)/`F5`(route)/`F6·F7·F8`(dependency·data) ✓。
- 未定义谓词：`hasMatchingRepair` 里 "**且 out 可修复**" 的"可修复"没有任何定义（`when(out)` 已覆盖该条件）——见 MINOR。其余谓词（`isTerminal/hasMatchingRoute/hasDeclaredFallback/declaredOutgoing/hasDeclaredCover/isAbandoned`）均有定义。

**(c) 结论**：不能写"可接受"——上面那条是实质覆盖缺口（会让多数工作例不可校验），不是编号/措辞。除此之外的清单如下。

```
[MINOR] SEMANTICS §3.0.1 F3 的 "out 可修复" 未定义 — `when(out)=true` 已经表达了条件，"可修复"不是可观测谓词。
  建议删除该子句，或在 §2.1/§6 定义 outcome 的可修复字段。
[MINOR] SEMANTICS §3.0.2 F8 双载 — event A 的 else 是 `INVARIANT_VIOLATION`，event B 的 else 是 `waiting(gap)`；
  §3.0.3 表却只把 F8 用作"waiting"。同一编号两种语义。建议把 event A 的防御分支另命名（如 F0/IV）或在谓词表
  注明"F8 仅在 onUpstreamTerminal 中表示 waiting"。
[MINOR] SEMANTICS §5.1 第 10 项丢了 rev3 R4 的"或只有 `provenance` 出边"例外 — `provenance`-only 节点（例 9 `nX`）
  亦被判 `declaredOutgoing=∅`。与 BLOCKER 同源，建议随其一起修。
[MINOR] SEMANTICS §3.2 readiness 单元格 vs §2.2 — §2.2 已把资源 `waiting` 收紧为"**无可释放路径**"并声明"没有排队
  模型"，§3.2 仍写"预留条件明确不满足（配额满、无排队可能）→ waiting"。两处措辞不一致（§2.2 更准确），建议同步。
[MINOR] SEMANTICS §3.1 底部 note 仍写"`dependency`/`data` … 现已显式引用 **F5/F6/F7**"，但单元格实际引用的是 F6/F7/F8
  （F5 属 route）。stale note，建议改为 F6/F7/F8。
[MINOR] README 文件表仍写 SEMANTICS 为"**阻塞 vs 失败总则**"——§3.0 已是判定函数；建议改"阻塞 vs 失败判定函数"。
[MINOR] SEMANTICS §3.0.2 F1 短路 — R4 只单向要求"∅→terminal"，未禁止"terminal 节点另带 route/repair/fallback"；
  此时 F1 先命中、路由被忽略。建议补一句"terminal 节点不得声明路由出边"或声明 F1 的优先级含义。
[MINOR] EXAMPLES 例 3 说 `nY`"开新 attempt" — F4 的 `graphActions` 只有 `[enable(fallback.target)]`，`newAttempt` 是
  F3 独有（§3.0.2 明说）。措辞，建议改"`nY` 被 enable"。
[NIT] SEMANTICS §2.2 表里资源 `waiting` 只从 `ready` 进入，`pending` 节点资源永久不可得时无 waiting 出边；建议
  明确"pending 不暴露该缺口"还是补边。
[NIT] 修订记录/历史段（README rev2 的"四条入边"）与当前三类入边并存，属历史留痕，可不动。

已核对但确认无误的点:
1. round-4 BLOCKER 已真正修掉：`repair` 进入 `declaredOutgoing` 并获 F3，例 2 `nV` 不再被拒、落 F3（见 (a) T1）。
2. round-4 两个 MAJOR 已修：例 10 路径 C 改用 `repair(nZ→nB)`（`to=nB`，与 `hasDeclaredCover` 定义一致）且明确
   F6 先于 F7；§2.2 `waiting→failed` 补上 `hasDeclaredCover(U) 为假` 守卫，两处一致。
3. 评审焦点 (a) 的 4 个指定拓扑（只 repair 出边 / terminal 失败 / 上游 abandoned 且有 repair / 上游非 succeeded 无
   cover 未 abandoned）在 §3.0.3 / §3.1 / §5.3 三处终态**逐条一致**（T1/T2/T3/T4）。
4. 全文无 stale 旧编号（`4a/4b/4c`、`规则 3` 仅存于描述历史的修订记录）。
5. §5.1 第 10/11 项、§2.4 的 `terminal`/`abandonedBranches` 载体、§5.3 四行、例 1 的 `terminal:true`、例 6 出口 3
   去"或"、README 的"10 个例子"——均与 rev5 声称一致，已落地。
```

给作者的一句话：`repair` 那条主 BLOCKER 确实修好了，F1–F8 编号也基本统一；本轮剩下的实质问题只有一个——`declaredOutgoing` 只统计路由出边，把"靠 `dependency`/`data` 喂下游的普通生产节点"挤到 `∅` 分支（R4 强标 terminal + F8 告警），使例 2/3/4/9/10 与自己的校验清单互斥。把 `declaredOutgoing` 扩为"任意出边"并给 blocking 出边一个"消费 success"的正式分支后，其余都是措辞/编号，可直接收敛为"可接受 + MINOR/NIT"。

---

## 复核回合 8

已完整重读 rev6 三文件，逐例代入 `decide()` 并核 §5.1 第 1–11 项，全文 grep 了旧编号与谓词。未修改任何文件、未触碰 `.graph/`。

```
结论: 需修订（blocker 小 1）

[BLOCKER] EXAMPLES 例 2「正常路径」 vs SEMANTICS §3.0.2 A5 —
  例 2 声明 `nV`（fresh verifier）唯一出边是 `repair(nV→nM, when: decision.outcome=='repair')`，正常路径写
  "`nV` fresh 验收 → **completed**"。代入函数：`onOutcome(nV, completed)` → A1 否（nV 非 terminal）→ A2 否
  （无 route 边）→ A3 否（when 只匹配 'repair'）→ A4 否 → **A5 命中**（`hasRoutingOutgoing(nV)=true` 但无匹配
  routing 边）→ `{ failed(no-matching-route), [] }`。也就是说本应的成功路径实际会判 `nV failed`，图无法到达
  `completed`。— 这不是 §5.1/INV 失败（例 2 的五个节点都过了第 10 项：nA/nB/nM/nJ 命中 A6、nV 有 repair 出边），
  但同属"accept 判据不可满足"：例 2 是旗舰多 agent 例，其 happy path 与自己的判定函数互斥。— 且**不能靠给 nV
  补 `terminal: true` 修**：A1 先于 A3，terminal 会短路掉 repair 边，例 2 的 repair 路径又断。— 建议：给 `nV`
  增一条 `route(nV → nDone, when: outcome=='completed')` 并让 `nDone: terminal: true`（此时 nV 非 terminal，
  A2 接 completed、A3 接 repair，两条路径都成立）；或明确"verifier 的成功 outcome 由 TaskDecision 终止"这一
  特例并把 A5 限定为"非成功 outcome 无匹配"。

```

评审焦点逐条回答：

**(a) 逐例代入 + §5.1 第 10 项核验（`hasRealConsumer=false → terminal:true`）**

| 例 | 节点 → hasRealConsumer | 第 10 项 | 关键事件命中 | §5.1 |
|---|---|---|---|---|
| 1 | n1（无出边）→ false | 已标 `terminal:true` ✓ | n1 out → **A1** | 过 |
| 2 | nA/nB（data+dependency）、nM/nJ（dependency）→ true；nV（repair）→ true | 均无需 terminal ✓ | nA/nB 成功→**A6**；nB 失败→**A6**（`failed`）+ 下游 nJ/nM→**B3**；nV=repair→**A3** | 过（但见 BLOCKER：nV=completed 会落 **A5**） |
| 3 | nT（2 route）、nX（fallback）→ true；nY（无出边）→ false | nY 已标 `terminal:true` ✓ | nT→**A2**；nX 失败匹配→**A4**；nY→**A1** | 过 |
| 4 | nG（data）→ true；nC（无出边）→ false | nC 已标 `terminal:true` ✓ | nG 成功→**A6**；nC→**A1** | 过 |
| 5 | nA/nS（新增 `dependency nS→nJ`）→ true | — | 修订被 §5.2 拒 | 过（摘要） |
| 6 | n1（未画出出边） | 摘要未标 terminal | unknown/reconcile，不在事件 A/B | 摘要，见 NIT |
| 7 | n1（loop） | 摘要未标 | loop 恢复，不在事件 A/B | 摘要，见 NIT |
| 8 | nV（2 route）→ true | 无需 terminal ✓ | nV=needs-human 无匹配→**A5** | 过 |
| 9 | nX（仅 provenance）→ false；nY（无出边）→ false | 两者均已标 `terminal:true` ✓ | nX/nY→**A1**，provenance 不参与 | 过 |
| 10 | nB（dependency）→ true；nD（无出边）→ false | nD 已标 `terminal:true` ✓ | nB 失败→**A6**；nD：A→**B3**、A2→**B1**、B→**B2**、C→**B1** | 过 |

除例 2 的正常路径外，**没有任何一例被 §5.1 拒绝或落入 INV**。例 6/7/8 的摘要未给全节点，见 NIT。

**(b) A5 在 A6 之前**（同时有 route 与 blocking 出边的节点 P：`route(P→A, when out=='x')` + `dependency P→Q`）
- `out=='x'`：A2 命中 → `verifying→TaskDecision` + `enable(A)`；Q 经 `dependency` readiness（P succeeded）推进。route 与 blocking 是两条独立消费者，不互斥。
- `out≠'x'`：A5 命中 → `failed(no-matching-route)`（即便 Q 是 blocking 消费者）；Q 依 §3.1 `dependency`"上游失败→等待"转 `B3 waiting`。
两分支分别与 §3.1 `route`（A5）与 `dependency`（B1/B3）自洽，顺序合理（"声明了 routing 出边就必须路由每个 outcome"）。**A5↔A6 顺序无新矛盾。**

**(c) grep 残留**
- **仍有 `F1–F8` 块残留**：§3.0.1 第 134–142 行整块 `# 规则编号（F1–F8 完整覆盖）` 及其 F1–F8 定义，与 rev6 的 `A1–A6/B1–B3/INV` 并存；§3.0.2 第 178 行"**F3** 的 `newAttempt`"、第 180 行"**F8** 的定位"仍用旧号（应为 A3 与 INV）。该 F 块还承担 `hasMatchingRoute/hasMatchingRepair/hasDeclaredFallback/hasDeclaredCover/isAbandoned` 的**定义**，直接删会丢定义——需把定义迁到 A/B 谓词表并删掉 F 编号。
- `hasMatchingRepair` 的"**且 out 可修复**"已删除 ✓（round-5 MINOR 已修）。
- `declaredOutgoing(N) = ∅` 不再作为 R4/F5 判据（R4 改用 `hasRealConsumer`）✓；但 `declaredOutgoing` 现已无任何规则引用（死谓词）。
- 旧 `4a/4b/4c`、"规则 3" 只在历史修订记录里，正文无残留 ✓。

```
[MINOR] SEMANTICS §3.0.1 残留 `F1–F8` 块 + §3.0.2 第 178/180 行的 `F3`/`F8` 引用（见 (c)）。建议：把
  `hasMatchingRoute/hasMatchingRepair/hasDeclaredFallback/hasDeclaredCover/isAbandoned` 的定义并入 A/B 谓词表，
  删除 F 编号块，并把 178/180 行改为 A3 / INV。
[MINOR] SEMANTICS §3.0.1 小标题仍写"（rev5：…）"、README 文件表仍写 SEMANTICS 含"**阻塞 vs 失败总则**"；
  rev6 已是判定函数，建议同步措辞。
[MINOR] SEMANTICS `declaredOutgoing(N)` 现定义为"任意出边"，但 A 规则与 §5.1 第 10 项均改用
  `hasRoutingOutgoing/hasBlockingConsumer/hasRealConsumer`，该谓词已无引用；建议删除或移入注释。
[MINOR] SEMANTICS A5 会把"失败 reason 不匹配 fallback `when`"的节点（例 3 反例 B）的原 reason 覆盖为
  `no-matching-route`。建议 A5 保留 `out.reason`，或输出 `failed(no-matching-route; 原 reason=…)`。
[MINOR] SEMANTICS §3.2 readiness 仍写"预留条件明确不满足（配额满、无排队可能）→ waiting"，而 §2.2 已收紧为
  "无可释放路径"并声明"没有排队模型"；两处措辞不一致，建议 §3.2 同步。
[MINOR] SEMANTICS §3.1 顶部"方向约定（对全部边类型成立）：`from` = 上游/生产者"仍与 `repair`（from=触发者，
  例 2 `repair(nV→nM)` 中 nV 在 nM 下游）与 `fallback`（例 3 `fallback(nX→nY)` 为兄弟）冲突；前几轮已提，未修。
  建议改为"blocking 边 from=上游生产者；routing 边 from=判定/触发者"。
[MINOR] EXAMPLES 例 3 说 `nY`"开新 attempt"，但 A4 的 `graphActions` 只有 `[enable(fallback.target)]`
  （`newAttempt` 为 A3 独有）；措辞。
[NIT] EXAMPLES 头部出现两条重复的"rev4 修订"块（内容几乎相同），建议去重。
[NIT] EXAMPLES 例 6/例 7 的节点未画 `terminal: true`；若其完整图中确无消费者，会被 §5.1 第 10 项拒绝。
  作为摘要可接受，建议补一句或标注"完整图含 terminal 节点"。
[NIT] SEMANTICS §3.0.3 表把 `unknown` reconcile、资源预留等非 A/B 事项与 A/B 行混排，可读性一般。

已核对但确认无误的点:
1. round-5 BLOCKER 已真正修掉：例 2 的 `nA/nB/nM/nJ`（dependency/data 出边）现走 **A6**，§5.1 第 10 项改用
   `hasRealConsumer`，无需 terminal → 例 2 通过 §5.1 全部 11 项；不再有"blocking 生产节点被拒/落 INV"。
2. 逐例代入（(a) 表）确认例 1/3/4/9/10 的叶子均已按 R4 补 `terminal: true`，其余节点有真实消费者；没有
   一例落入 INV。
3. 事件 B 三规则与 §3.1 `dependency`/`data`、§5.3 四行在 cover/abandoned 上一致：例 2 `nB`→**B3**；
   例 10 A→B3、A2/C→**B1**、B→**B2**；§2.2 `waiting→failed` 已带 `hasDeclaredCover 为假` 守卫（B1 先于 B2）。
4. `repair` 路径正确：例 2 `nV` 判 repair 命中 **A3**（`newAttempt(nM)`+`enable(nM)`，触发者自身 `failed` 保留只读），
   与 §3.1 `repair` 行（from=触发者、to 获新 attempt、预算归 to）一致；round-4 的 repair 缺口确已闭合。
5. (b) `A5` 在 `A6` 前自洽（见上）；(c) `out 可修复` 已删、`declaredOutgoing=∅` 已不再是判据、旧 `4a/4b/4c`
   无正文残留。
```

给作者的一句话：rev6 把 round-5 的 blocking 覆盖缺口修对了，A1–A6/B1–B3 的语义现在自洽，(b)(c) 两问均无实质问题；**唯一拦路的实质点是例 2 的 `nV`——它声明了 `repair` 出边却在正常路径产出 `completed`，按 A5 会被判 `failed(no-matching-route)`，而它又不能改标 `terminal`（A1 会短路 repair）**。给 `nV` 加一条 `completed` route（指向一个 terminal 节点）即可闭环；其余全是编号/措辞，可作为已知残余。

---

## 复核回合 9

结论: 可接受

四项核对：
1. 例 2 四类 outcome 代入一致：`nV:completed` → **A2**（`route(nV→nDone)` 匹配 → `enable(nDone)`）；`nV:repair` → **A3**（`{newAttempt(nM), enable(nM)}`，nV 自身 `failed` 保留）；`nV:needs-human` → **A5**（`failed(no-matching-route)`）；`nA/nB:completed` → **A6**（`out.ok` → `verifying→TaskDecision`）；`nDone` → **A1**。`hasRealConsumer(nDone)=false` 且已 `terminal:true` ⇒ R4 满足。
2. 例 2 仍无环：blocking 投影 `dependency∪data` = {nA→nM, nB→nM, nA/nB/nM→nJ, nJ→nV}，DAG；`nV→nDone`(route) 与 `nV→nM`(repair) 是 routing，`nV→nM→nJ→nV` 为受控环且 `maxAttempts:2` 有界（§5.1 #9 满足）。`resourcePolicy`（scopeA/scopeB/integrationWriter）与 `nA∥nB → nM 串行` 仍自洽。
3. 无被 rev7 推翻的**当前**旧表述：`§3.1 repair` 行、README 一页结论、判据索引表均不含 `nV`；`EXAMPLES:98` 与 `README:11` 的相关句已明确标"**旧版**"；`EXAMPLES:104` 的"全图唯一的 repair 边是 nV→nM"仍为真。
4. 第 10 项现覆盖六节点：nA/nB/nM/nJ 有 blocking 消费者、nV 有 route+repair、nDone 无出边且 `terminal:true` —— **六节点全部通过**，rev6 的结论未被破坏。

新发现的问题：
- [MINOR] `EXAMPLES.md` 判据索引表 例 2 行"覆盖边类型"仍写 `dependency / data / repair`，未含本次新增的 `route`（nV→nDone）；文末汇总行也仍写 `route(3,8)`。建议补成 `dependency / data / repair / route` 与 `route(2,3,8)`。
- [NIT] `EXAMPLES.md:9`（rev7 修订行）写"例 2 的 `nV` 唯一出边是 `repair`"，未像同文件 98 行与 README 那样标"旧版"，字面易被读成当下陈述；建议改为"旧版 `nV` 唯一出边是 `repair`"。

本轮发现 2 项（均为 MINOR/NIT，不影响节点判定）。

---

