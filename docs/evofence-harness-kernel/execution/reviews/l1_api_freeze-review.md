# 独立交叉复核：l1_api_freeze（并行分片复核 + 修复轮）

> 复核方式：**三个独立 pi pane 并行分片复核**（本节点产物 7 份 / 3300 行，单窗复核不经济）。
> 各 pane 只审自己的分片、只改自己的分片文件；跨 lane 漂移登记到 `OPEN-ITEMS §4 T02/T03` 后由 orchestrator 做集成收口。
> 本文件是**评审记录**，不是被审产物。

---

# 复核者：`verify-main`（分片：INTERFACES.md + SCHEMAS.md（分片 1））

## verify-main · 回合 16

收到。开始修我自己报的问题，只改 `INTERFACES.md` 与 `SCHEMAS.md`。先确认几处待改字符串的精确形态：

---

## verify-main · 回合 17

现在改 `SCHEMAS.md`（第一批：版本、变更记录、计数、NodeStateEntry、SessionView）：

---

## verify-main · 回合 18

现在更新 `SCHEMAS.md` §2 字段目录（同步新增字段与改名标注）：

---

## verify-main · 回合 19

现在改 `INTERFACES.md`：

---

## verify-main · 回合 20

补完 MAJOR-2 的最后一块（`TaskEvidenceReport` 仍是孤儿定义，只加 ArtifactRef 引用还不够）：

---

## verify-main · 回合 21

补一处：MAJOR-4 的另一半在 `spec/graph/SEMANTICS.md`（不在我的写入范围），我把本 lane 的规范形状与差异写进 SCHEMAS 以便可判定：

---

## verify-main · 回合 22

修订完成。两个文件均 JSON 可解析、无空段无截断、无 tracked 改动。

## ① BLOCKER 修法

**选了方案 A（加字段），未加 `readEvents`。** 理由：读面已经能给出 `nextEffects`（待派发）与 `CommandResult.decisionRef`（裁决），再开一条事件流读方法等于把 journal 暴露成第二个真相源；本轮缺口只是"状态机不可读"，加一个派生投影字段即可闭合——不额外造接口。

- `SessionView` 增**必填** `nodeStates: array<NodeStateEntry>`，`NodeStateEntry = {nodeId, attemptOrdinal, epoch, state: NodeState, sinceSequence}`，`x-source` 指向 `CONTRACTS §4; graph SEMANTICS §2.2`。
- `INTERFACES §4` 状态表新增「读面」行：明确 `nodeStates` 是 journal 的派生投影、不是第二真相源、不授予写权限。

**必须做成必填**：若可选，内核可以不填，消费者仍拿不到状态——BLOCKER 会原样复发（消费者无法 fail-closed）。

**schemaVersion 处理（如实递增，不回避）**：`1.0.0` → **`1.1.0`**，`l1-freeze.1` → **`l1-freeze.2`**，bundle `$id` → `urn:evofence:runtime:1.1.0`。因为含**新增必填字段**，按 `INTERFACES §1` 自己那条「必填字段 → 下一个 major namespace」本应升 `evofence.runtime/2`；我把它**如实写成 minor 处理 + 明写前提**：

> 前提是 `1.0.0` 从未被任何实现、宿主或持久投影消费（本 lane 状态是待 `l1_replan` 的提案）。一旦出现 1.0.0 消费方，本项必须改按 major 升 `/2`。

三处变更记录已落：`SCHEMAS.md` 新增「### 变更记录」表（含依据 + 前提 + 1.0.0 codec 保持可读）；`INTERFACES §1` 同步。`ProtocolVersion.schemaVersion` 由 `const "1.0.0"` 改为 `enum ["1.0.0","1.1.0"]`（供 `compatibleProtocols` 逐版声明，不改写 1.0.0 codec）。**assets namespace 保持 `1.0.0`**（其版本独立，已在两处写明）。

## ② MAJOR 修法

1. **四类裁决字段级独立**：`DecisionRecord` 增 `taskEvidenceRef` / `evaluationReceiptRef` / `activationReceiptRef`（均可空、必填位），并用 `allOf` 按 `kind` 强制非 null：`task`→`contractRef`+`taskEvidenceRef`；`candidate`→`evaluationReceiptRef`+`capabilityJudgement`；`promotion`→`evaluationReceiptRef`；`activation`→`activationReceiptRef`。**`contractRef` 收窄为 `ContractRef|null` 且仅 `task` 非 null**，去掉对 activation 的过度约束。S16 同步改写为字段级；`INTERFACES §6` 四行与表后说明同步。
2. **`TaskEvidenceReport` 孤儿**：加进 root `oneOf`（19→20 项），并新增 **S26** 钉死 `task.evaluate.objectRef` / `DecisionRecord.taskEvidenceRef` 必须解码为 `TaskEvidenceReport`。修后 `$defs` **无孤儿**。
3. **不变式 1 无载体**：选"显式声明 store 内部"这条（不新造 wire 对象），并在 `SCHEMAS §3` 新增 **CONTRACTS §5 十条不变量 → 载体 → 机检规则** 映射表；claim 与 reservation 明确为 `EventStore.append` 同一 CAS 事务内的状态，跨边界只有 id 引用。另加 **S25**（nodeStates 必须是 journal 派生投影）。
4. **`ResourcePolicy` 与 SEMANTICS §3.2 冲突**：`SEMANTICS.md` 在 `spec/graph` lane、不在我的写入范围，故我在 SCHEMAS 侧写明「本 lane 规范形状是数组；§3.2 的 map+`quota` 示例为非规范，`quota` 对应 `maxHolders`；两处形状待 `spec/graph` lane 统一」。**该条我只能做单边；SEMANTICS §3.2 需其 owner 改。**

## ③ MINOR / NIT 逐条

| 条目 | 处置 |
|---|---|
| m1 `cellStatus` 自称 hyphen 却含下划线 | **接受并改**：保留取值（与 METRICS §5.3 上游字面一致，规范化反而制造分歧），删掉假声明，改为"取 METRICS 字面值，本层不规范化"（JSON + §2 表两处） |
| m2 `NodeSpec` read/write→exclusive/shared 未标注 | **接受并改**：`resources` 行标注来源与改名，并指出 `Scope` 仍用 `readResources`/`writeResources` |
| m3 §2 per-op 返回类型被合并未标注 | **接受并改**：`INTERFACES §3` 加「与 CONTRACTS §2 的差异（刻意合并）」块 |
| m4 `LoopSpec` 的 `bound{}` 被拍平 | **接受并改**：四个 bound 行标注"§4 的 `bound{...}` 包装在本版拍平" |
| m5 版本规则不可判定 | **接受并改**：`INTERFACES §1` 加机检反例——逐字段 diff 出「删/改名字段、可选变必填、收窄 enum、语义变更」而 namespace 未升 major 即拒绝；并给出必须失败的样本（删 `SessionView.dispatchMode` 只把 1.1.0→1.2.0） |
| m6 `before/after` 被 epoch/budget 事件复用 | **接受并改**：改为"仅 `node.transition` 使用，其余必须 null；`session.epoch-changed` 的新 epoch 由 `Event.epoch` 承载"（JSON + §2 两处）；不新增字段 |
| m7 无 Reservation 对象 | **接受并改**：与 MAJOR-3 合并处理（映射表 + "有意选择"声明），不加 wire 对象 |
| m8 护栏结果无 typed 字段 | **接受并改**：`CapabilityJudgement` 增 `guardrailCost`/`guardrailWall`/`guardrailTruncation`（`passed/failed/unknown`） |
| m9 adr_0009 在 INTERFACES 内是口号 | **接受并改**：`INTERFACES §3` 注明机检规则在 `OWNERSHIP.md` I01–I08，本轮 guard 未实现（不再称"口号"，但也不虚构已实现） |
| m10 `graphActions` 无字段 | **接受并改**：`SCHEMAS §3` 声明 A2 `enable(t)` 由目标节点 `pending→ready` 承载、A3 `newAttempt(t)` 由新 `attemptId`/`attemptOrdinal` 承载 |
| n1 `ArtifactRef.producer` 事先源语义未定 | **接受并改**：描述补"事先源/批准/协议快照的 producer 为产出该快照的主体（可 `kind=kernel`）" |

无反驳项。所有新增均为契约字段/规则，未加运行时守卫、未吞错、未把缺失当默认值；有意保留的失败闭合（显式 `unknown`、缺 usage 不归零、schema/版本显式拒绝）未动。

## ④ 改动文件与行数

| 文件 | 行数 | 变化 |
|---|---|---|
| `spec/contracts/SCHEMAS.md` | 881 → **931** | +50 |
| `spec/contracts/INTERFACES.md` | 225 → **236** | +11 |

**自证**：`SCHEMAS.md` JSON 可解析；root `oneOf` 20 项；`$defs` 75 = 63 对象 + 12 原语；`$defs` **无孤儿**；§2 目录实算 **63 对象 / 427 成员 / 423 必填**，与文首声明逐字一致；`SessionView.required` 含 `nodeStates`；`DecisionRecord` 的 kind 专属引用已入 `required` + `allOf`；两份文件**无空段、无截断、以换行结尾**；`git status` 仅两条既有 untracked，`git diff --name-only` 为空；CONTRACTS §1 的 13 对象字段对应关系仍成立（仅 `NodeSpec.resources` 一处改名，已标注）。

---

## verify-main · 回合 23

脚本的比对规则已明确（`a[2]` 必须**逐字等于** JSON `description`，`a[3]` 等于 `x-source`）。先读完脚本其余断言，避免反复试错：

---

## verify-main · 回合 24

第二个失败点是 `ErrorCode.enum` 缺一个码（我的文件）。先确认 ERRORS.md 里该码的定义再补：

---

## verify-main · 回合 25

`node "$TEMP/vlf.mjs"` 现在**退出码 0，全绿**。

## ① 改了哪几行（全部在 `SCHEMAS.md`，`INTERFACES.md` 无同类问题）

| 行 | 改动 | 归因 |
|---|---|---|
| **116** | `schemaVersion` 类型单元格 `"1.0.0" / "1.1.0"` → **`1.0.0 / 1.1.0`**（去掉引号；`const` 单元格带引号是对的，未动） | 你诊断的那条 |
| **116** | 同一行**语义**单元格补上"…，枚举供 compatibleProtocols 逐版声明" | 脚本 `a[2]` 须逐字等于 JSON `description`；我上轮只改了 JSON 侧 |
| **676** | `cellStatus` 语义单元格改成与 JSON `description` 逐字一致（"…；上游为 underscore/hyphen 混合，本层不做规范化"） | 同上（上轮两处措辞不一致） |
| **475–476** | `before`/`after` 语义单元格与 JSON description 对齐 | 同上 |
| **560** | `producer` 语义单元格对齐 | 同上 |
| **362** | `NodeSpec.resources` 语义单元格对齐；注解文字改由 **JSON description 与表格同串承载**（脚本要求两边逐字相同，注解不能只挂在表格里） | 同上 |
| **317–320** | `LoopSpec` 四个 bound 语义单元格同样对齐（拍平说明写进 JSON description + 表格） | 同上 |
| **292** | `maxHolders` **来源**单元格去掉我加的 "；对应示例的 `quota`"（脚本要求 `a[3]` 逐字等于 `x-source`）；`quota` 说明保留在表后的散文段 | 同上 |
| **91** | `ErrorCode.enum` 补 **`EFK_HOST_BOARD_AUTHORITY_CONFLICT`**（57→58，与 `ERRORS.md` 58 码对齐） | 第二个断言失败 |
| **866** | S06 拒绝码列补该码（这是 claim/lease 与宿主 board 权威冲突的同一执行点，与 `ERRORS.md` 行 47/77 的 A15 对应） | 一致性（非脚本要求） |

JSON 侧同批同步：`NodeSpec.resources` description、`LoopSpec` 四个 bound description、`ErrorCode.enum`。

## ② 退出码与最后输出

```
EXIT=0
{"status":"passed","objectDefinitions":63,"fields":427,"requiredFields":423,"evidence":44,"errorCodes":58,
 "sourcePins":23,"commandKinds":15,"nativeBothRequired":15,"kernelMissingRequired":315,
 "hostMissingRequired":93,"humanItems":13,"reserveUsdMicros":9547}
SCHEMAS.md lines=931 sha256=674e42ed27ca973e8fa3d5d749f40ede949678893f9083942999248f35952eff
```

## ③ 剩余失败

**无。** 三处失败全部落在我的文件，全部已修：

1. `type row ProtocolVersion.schemaVersion` — 引号口径（你已定位）。
2. `meaning row ProtocolVersion.schemaVersion` — 我上轮只改 JSON 没改表格语义列；同批还预检并对齐了 `cellStatus`/`before`/`after`/`producer`/`resources`/4×bound 的语义列与 `maxHolders` 来源列（脚本此前会逐条失败，只是卡在第一个断言没走到）。
3. `ErrorCode.enum` 与 `ERRORS.md` 差 1 码（`EFK_HOST_BOARD_AUTHORITY_CONFLICT`）—— **这是我的文件**；`ERRORS.md:3` 已明确写"枚举同步归 SCHEMAS owner、README 计数归 README owner"，所以我直接补了。**没有需要转给 review-1 的问题。**

未改 README / HOST-MAPPING / ERRORS / OWNERSHIP / OPEN-ITEMS；未 commit；`git diff --name-only` 为空（两份文件在既有 untracked 目录内）。附注：这次暴露的模式是"JSON description 与 §2 语义列必须同串"——后续若再改 description，必须同批改表格两处。

---

# 复核者：`review-1`（分片：HOST-MAPPING.md + README.md（分片 2））

## review-1 · 回合 15

I'll do this carefully. First, let me gather the exact current text and profiles for the rows I need to change.

---

## review-1 · 回合 16

Now I'll make the edits. Starting with the structural fixes (§1 evidence index, header, §2 preamble, §3 counting).

---

## review-1 · 回合 17

Now the core rewrite (Effect/EffectPayload/Receipt/Command/Event). I'll apply these as exact section replacements and then verify.

---

## review-1 · 回合 18

Now let me run the README's embedded verifier to prove consistency.

---

## review-1 · 回合 19

Now let me verify the mapping counts and evidence index independently.

---

## review-1 · 回合 20

已完成。两文件均已改并自证。只读复核之外未动 `.graph/`、`src/`、`test/`、`integrations/`、`package.json`、其他分片文件；未 git commit。

## ① 第 6 条（最重要）：把宿主行为字段改成具体可实施路线

**覆盖 5 个宿主执行边界对象、46 条字段行**（Effect 11 + EffectPayload 8 + Receipt 10 + Command 7 + Event 10），不再复用同一句 K0。每条都写明 kernel 在 **DSH / Pi 两侧分别怎么落地**（host seam + adapter 动作 + 缺失时的显式处置）。示例：

- `Effect.idempotencyKey`：旧「K0：版本化 reducer+注入 ports」→ 新「K0 由 effectId+epoch+输入摘要派生稳定 key；**adapter 必须把它附在外发调用上并在 receipt 回显**，重复 key 由 kernel 去重、未回显按 unknown reconcile；代价 adapter sidecar + 故障注错」。
- `Effect.kind`：新「K0 按 kind 选 host 原语（model/tool/child/human）；**DSH 走 D2/D3/D8、Pi 走 P2/P3/P8**；host 不自行改路由」。
- `Effect.authorityRef`/`reservationRef`/`leases`：分别写「派发前用 host 权限根核对 grant（D11/P1）」「派发前共享池预留、不得越过 reservation」「EventStore 原子 claim/lease/fencing，host board 仅投影（D25）」。
- `Receipt.hostInvocationId`：新「adapter 记录 host 原生 invocation id（**DSH D4 callId、Pi P4/P5 id**）并写入绑定表；未回填即 unknown，不合成」。
- `Receipt.status`/`observability`/`error`：新「只接受 host actual receipt；缺回执走 unknown→reconcile，不以 worker summary/缺省填成功」「不可观测即显式 unknown，不推断成功」「映射为 typed error envelope；不吞错、不降级为成功」。
- `Receipt.usage`：新「adapter 附上 D5/P5 usage；失败/取消缺失即 null + complete=false 并保留预留；**不把 null 归零、不借用 Pi 账单**」。
- `Event.type`：新「adapter 从 host 事件（DSH D3/D4/D17、Pi P3/P4/P17）翻译为列内 type；未映射即 unknown，不猜」。

同对象内的纯协议元数据行（`protocol`/`effectId`/`receiptId` 等）改为短的「kernel 构造 + adapter 透传/回显」并非保留原句；新增 §2 前言明确**两类字段**边界。另外因 SCHEMAS 侧（他人 pane）已新增对象/字段，我补齐了对偶映射并同样给了具体路线：`NodeStateEntry`（新 5 行）、`SessionView.nodeStates`、`DecisionRecord.taskEvidenceRef/evaluationReceiptRef/activationReceiptRef`、`CapabilityJudgement.guardrailCost/Wall/Truncation` 共 **12 行**。

## ② 其余各条处置

1. **D12 绑定**：改绑 `/checks/teamBoardRestored`（scope 改「host board 恢复，非 kernel journal」）；**并为 `teamTaskCas` 单列 D25**（`/checks/teamStaleRevisionRejected`，scope「host board CAS，非 kernel CAS」），保留 board CAS 证据；`LeaseRef` 5 行由 D12→**D25**。
2. **两个 0 引用 unknown**：新增 **D26 `toolCancellation`、D27 `providerCancelBilling`**（均 not-run）；在 `TerminationPolicy` 5 行点名 D26、`Usage.invoiceUsdMicros` 点名 D27。**D 前缀 unknown 由 11 → 13**，与 DSH manifest 的 13 个 unknown 对齐。
3. **directBothScoped 混义**：§3 JSON 增 `directBothScopedHost: 8` / `directBothScopedEvidenceMeta: 7`，并加一段说明（后者只证 kernel 可从固定 probe 文件填入，不等于宿主有原生对等）。
4. **头部 415/411**：改为「**423 个必填字段 + 4 个 `LoopSpec` 条件可选字段**」。
5. **303/93 不可复算**：§3 增 `hostGapProfiles` 直方图（27 个非共同 profile，合计 108）+ 复算步骤（108 − 15 = 93）。
6. 见 ①。
7. **NIT**：`§2` 前言加两类字段；`NodeStateEntry` 等新对象补齐。

**跨 pane 同步（必要）**：SCHEMAS 已由他人 pane 改为 63 对象/427 成员（`NodeStateEntry`、`SessionView.nodeStates`、`DecisionRecord`/`CapabilityJudgement` 各 +3），我据当前正文把 HOST-MAPPING 与 README 同步到 **63 对象 / 427 成员 / 423 必填**，并把 README 的 ERRORS 计数同步到 **58**。

## ③ 改动后 §1 / §3 计数

- **§1 证据索引**：表 44 行、JSON 44 条（D1–D27 + DV + PV + 15 条 P）；状态 `verified 25 / unknown 14 / absent 3 / partial 2`；**D 前缀 unknown = 13**；全部 44 条的 manifest/trace sha256 与 82 个 JSON Pointer 复算一致。
- **§3**：`fields 427`、`requiredFields 423`、`directBothScoped 15`（host 8 / evidenceMeta 7）、`noDirectBothRequired 408`、`commonKernelRequired 315`、`hostGapRequired 93`；`hostGapProfiles` 合计 108。独立脚本按 SCHEMAS 的 `x-mapping` 复算得到同值（315/93/408），每对象映射行数 = schema 属性数、无空单元、每侧单元均含证据 id。

## ④ 改动文件与行数

- `docs/evofence-harness-kernel/spec/contracts/HOST-MAPPING.md`：**1396 → 1472 行（+76）**；无空段/无截断。
- `docs/evofence-harness-kernel/spec/contracts/README.md`：**307 行**；改 6 处计数（44 证据、63 对象/427 字段/423 必填/315/408、ERRORS 58）与校验脚本 6 处断言（`proofIds.size 44`、members 与 stats 数组、新增 8/7 断言、`objects.length 63`、log）。
- 新增内容全部落在两个文件内；未触碰保护路径。

**一处需你知悉（非我文件）**：README 内嵌七文件校验脚本目前仍会在**跨 pane 一致性**上停住——SCHEMAS 侧尚未同步：① `ProtocolVersion.schemaVersion` 表单元格描述落后于其 JSON；② `ErrorCode` enum 仍 57 而 ERRORS.md 已 58。这两处属 SCHEMAS/ERRORS pane 的在改产物，我未越权修改；把它们落齐后整脚本即可通过（我另跑的隔离版已确认 HOST-MAPPING/README 侧全部断言通过）。

---

## review-1 · 回合 21

Now let me run the verbatim verifier and capture the full failure list.

---

## review-1 · 回合 22

已完成本轮修改并跑到脚本末尾。**结论：脚本仍未全绿——但不是 README 断言过时，而是 SCHEMAS.md 内部（表↔JSON）13 处内容漂移**，全部落在 SCHEMAS 侧，我无权改。以下按你要的三项回报。

## ① 是否全绿

**不完全绿。** 逐条跑到函数末尾（无中途抛错），共 **13 处** 断言失败，**全部是 SCHEMAS 内部/跨 SCHEMAS-ERRORS 的内容不一致**，与 README 计数无关。

原样跑（README §5 抽出的脚本）第一次就断在：
```
AssertionError [ERR_ASSERTION]: type row ProtocolVersion.schemaVersion
    at verifyFreeze (...:50:12)
```
把断言改成"收集而不中断"后跑完全程的最后输出（`status:passed` 行是收集器不抛错的副作用，真实脚本会在此前的断言处抛错）：
```
{"status":"passed","objectDefinitions":63,"fields":427,"requiredFields":423,"evidence":44,
 "errorCodes":58,"sourcePins":23,"commandKinds":15,"nativeBothRequired":15,
 "kernelMissingRequired":315,"hostMissingRequired":93,"humanItems":13,"reserveUsdMicros":9547}
FAILURES(13)
```
即：计数/证据/哈希/pointer/23 输入 pin/A15/H13/链接/命令枚举 **全绿**，只有下面 ③ 的 13 条红。

（提醒：你预期 `objects.length` 会到 64，实测 SCHEMAS 就是 **63**（`NodeStateEntry` 已计入），无需再改。）

## ② 改动的断言与计数（旧 → 新）

`README.md`（仅此文件）：
| # | 位置 | 旧 | 新 |
|---|---|---|---|
| 1 | 行3 结论 | `l1-freeze.1`；`schemaVersion 1.0.0` | `l1-freeze.2`；runtime `1.1.0`／asset `1.0.0` 分列 |
| 2 | §1 OWNERSHIP | `A01–A14` | `A01–A15` |
| 3 | §1 OPEN-ITEMS | `H01–H11` | `H01–H13` |
| 4 | §2 预算/错误 | `57具体错误码` | `58具体错误码` |
| 5 | §3 | `I01–I08/A01–A14` | `I01–I08/A01–A15` |
| 6 | §4 json | `"proposal":"l1-freeze.1"` | `"l1-freeze.2"` |
| 7 | 脚本 | `assert.equal(defs.ProtocolVersion...schemaVersion.const,'1.0.0')` | `assert.deepEqual(...schemaVersion.enum,['1.0.0','1.1.0'])` |
| 8 | 脚本 | 仅 `/\| A14 /`、`/\| I08 /` | 追加 `/\| A15 /`、`/### H13 /` |
| 9 | 脚本 log | `humanItems:11` | `humanItems:13` |

`HOST-MAPPING.md`（仅头部标签）：行3 `l1-freeze.1` → `l1-freeze.2`；正文未动。

（本会话此前已同步、本轮未再动的 README 数值：`63` 对象 / `427` 成员 / `423` 必填 / `15` 直接 / `408` 无直接 / `315` 共同kernel / `93` host缺口 / `44` 证据 / `58` 错误码；`objects.length===63`、`proofIds.size===44` 断言均按实值，无需改。）

## ③ 内容级不一致（单列，SCHEMAS 侧，建议路由给 SCHEMAS owner）

**A. 属"已文档化的核对边界"（README §3 明列"类型""错误码枚举一致"），必须由 SCHEMAS 修：**
1. `ProtocolVersion.schemaVersion` **类型列格式**：表=`"1.0.0" / "1.1.0"`（带引号），JSON=`enum:["1.0.0","1.1.0"]`→脚本 `types()` 渲染为 `1.0.0 / 1.1.0`。全篇其余枚举列（`EdgeSpec.type`/`Event.type`/`NodeSpec.kind`/`CommandPayload.kind`/`Usage.source`/`Receipt.status`/`Effect.kind`）都是**不带引号**，此格是唯一例外 → 表应改为 `1.0.0 / 1.1.0`。
2. `ErrorCode.enum` 仍 **57**，缺 `EFK_HOST_BOARD_AUTHORITY_CONFLICT`；ERRORS.md 已 58（`### 变更记录` 也自认"枚举同步归 SCHEMAS owner"）。

**B. 超出 README §3 文档化边界（脚本额外断言"表语义/来源 == JSON description/x-source"），为表↔注解文本漂移：**
3. `ProtocolVersion.schemaVersion` 语义：表少尾注"…枚举供 compatibleProtocols 逐版声明"。
4. `ResourcePolicy.maxHolders` 来源：表多"; 对应示例的 `quota`"。
5. `LoopSpec.maxIterations` 语义：表多"（来源：§4 的 `bound{...}` 包装在本版拍平为顶层可空字段）"。
6. `LoopSpec.maxWallClock` 语义：表多"（同上层拍平说明）"。
7. `LoopSpec.maxTokensOrCost` 语义：表多"（同上层拍平说明）"。
8. `LoopSpec.maxDepth` 语义：表多"（同上）"。
9. `NodeSpec.resources` 语义：表多整段"；来源：CONTRACTS §1 “read/write resources”，本版按 SEMANTICS §3.2 改为 …"。
10. **`EventPayload.before` / `EventPayload.after` 语义（真实漂移，非单纯措辞）**：表把"（epoch 变化由 `Event.epoch` 承载）"挂在 **after** 上，JSON 把同义注记"（session.epoch-changed 的新 epoch 由 Event.epoch 承载）"挂在 **before** 上——两处载体互相错位，建议以一处为准。
11. `ArtifactRef.producer` 语义：表"…为产出该快照的主体" vs JSON"…的 producer 为产出该快照的主体"。
12. `CapabilityJudgement.cellStatus` 语义：表"（上游混合形式，本层不规范化）" vs JSON"；上游为 underscore/hyphen 混合，本层不做规范化"。

**我的处置与建议**：按你"内容不一致要报、不要盖"的要求，我**没有**放宽这些断言（放宽也救不绿——第 1、2 条是 README §3 明列的核对边界）。两条路可选，我倾向前者：
- **（推荐）SCHEMAS owner** 把上述单元格/枚举对齐 JSON（第 10 条二者取一，其余把表的加注并入 `description` 或把表改回短句）；
- 或 **明确**由 README owner 收窄脚本：删掉"语义/来源文本全等"断言、只保留 §3 已文档化的"同名/类型/必填 + 错误码枚举一致"——但这会隐藏第 10 条的真实错位，需你点头我才做。

硬约束遵守：本轮只写 `README.md` 与 `HOST-MAPPING.md`；未动 `.graph/`、`src/`、`test/`、`test-e2e/`、`integrations/`、`package.json`、CONTEXT-MAP/DECISIONS/contexts/adr，亦未改 SCHEMAS/INTERFACES/ERRORS/OWNERSHIP/OPEN-ITEMS；未 commit/发布/装包。

---

# 复核者：`review-2`（分片：OWNERSHIP.md + ERRORS.md + OPEN-ITEMS.md（分片 3））

## review-2 · 回合 5

Now I'll make the edits. Starting with `OWNERSHIP.md`:

---

## review-2 · 回合 6

## ① A15 的可检验判据（全文）

加在 `OWNERSHIP.md` §4 表内，作为与 A01–A14 同级的表行（**可失败**，不是声明）：

```
| A15 宿主board无第二owner | 对每个 (sessionId,nodeId,attemptId)，宿主原生 board 的 task owner 集合必须 ⊆
{kernel claim 的 owner}；HostPort 枚举到 owner ≠ kernel claim 的原生 task，或枚举到无 kernel 映射的原生 task，
即拒绝 | HostPort spy 记录 board create/claim 并枚举原生 task；出现未映射 owner 记
EFK_HOST_BOARD_AUTHORITY_CONFLICT，该 attempt 不推进、原 claim 保留 |
```

配套三处（同一文件）：
- §4 引言改为："**A01–A14** 中的 Active 由 journal 和注入时刻/撤销代数确定，不依赖 board 缓存；**A15 另外对宿主原生 board 做一次只读枚举**，语义仍是'枚举结果必须与 kernel claim 一致'。"
- §4 结论段补："A15 把 A01 的单 claim 从 kernel journal 延伸到宿主原生 board——具备原生 board 的宿主（DSH D12）不得对同一 attempt 另立 owner，无原生 board 的宿主（Pi P12 absent）该判据空成立"；"A01–A14"→"A01–A15"。
- §5 新增最小反例："**'不能独立claim同节点'由 A15 判定，不是配置声明。最小反例：DSH adapter 越过投影路径，直接调用原生 team board 为某 node 建立 owner，而 kernel journal 无对应 claim——A15 在 HostPort 上枚举到该未映射的原生 owner，记 EFK_HOST_BOARD_AUTHORITY_CONFLICT 并拒绝推进该 attempt。**"

新错误码（`ERRORS.md`，含触发与可重试性）：
```
| EFK_HOST_BOARD_AUTHORITY_CONFLICT | 宿主原生 board 对某 node/attempt 的 task owner ≠ kernel claim，
或存在无 kernel 映射的原生 task（A15） | after-reconcile |
```
并在"原生错误归一化"表加一行把 D12（原生 board CAS 能力）映射到该码，注明"board CAS 不是 kernel claim；拒绝后把 board 归回投影，原 claim 不变"。

## ② 条目数与新增码

- **H01–H13（13 条，+2）**：新增 **H12**（会话 custom entry 语义 / `sessionCustomEntries`，Pi verified vs DSH unknown）与 **H13**（父子 cancel 级联 + 运行中工具取消，DSH 两项 unknown）；H13 内含 H03 的覆盖边界说明。§1 表、§2 依据、§3 处置、文件头三处计数同步。
- **错误码 57 → 58（+1）**：`EFK_HOST_BOARD_AUTHORITY_CONFLICT`。重试分布变为 `never 26 / after-refresh 9 / after-authorization 9 / after-reconcile 14`。
- 新增待办 **T01/T02/T03**（OPEN-ITEMS §4，owner 移交）。

## ③ 原 MINOR/NIT 逐条

| 原条目 | 处置 |
|---|---|
| MAJOR：宿主 board 双 owner 无判据 | **接受并改**：A15 + `EFK_HOST_BOARD_AUTHORITY_CONFLICT` + §5 反例 |
| MINOR：H 项漏 sessionCustomEntries / parentChild / toolCancellation | **接受并改**：H12/H13 |
| MINOR：ERRORS 多码优先级未定义 | **接受并改**：§1 加一句优先级（具体码 > `EFK_INVARIANT_VIOLATION`；graph/预算/usage/artifact > host；kernel > 同义 host） |
| MINOR：`EFK_SOURCE_PIN_DRIFT` 重试类错 | **接受并改**：`after-refresh` → `after-authorization`，触发补"重读无法修复，须重新准入" |
| MINOR：I04/I05 非完备机检 | **接受并改**：§2 标明 I01–I03/I06–I08 完全机检，I04/I05 为静态 best-effort（字面量与单层别名可判；需常量折叠/跨函数纯度的写法超出该 guard，由 I07 的 port spy 在运行期暴露） |
| MINOR：runtime 禁定时器却无 Scheduler port | **接受并改**：§2 定案"到期与超时一律在调用点比较 `Clock.now()` 惰性判定，core 不使用定时器，也不新增 Scheduler port；主动定时行为经 HostPort 进出" |
| MINOR：A09/A13 是否定式性质 | **接受并改**：两行的可机检条件改为显式调用图断言（A09：无到 `HostPort.dispatch` 的可达调用边；A13：执行者可见读取路径不含 final/held-out 工件引用） |
| NIT：README 输入 pin 措辞歧义 | **反驳/转交**：`README.md` 归 review-1，不在我可改范围；事实无误——我重算 23/23 pin 全匹配，问题只在"不变"相对什么，属措辞，交 README owner |
| 新增发现：HOST-MAPPING 索引缺 `toolCancellation`/`providerCancelBilling`（实测全文 0 引用） | **登记为 T01**（HOST-MAPPING owner），未改该文件 |
| 新增发现：SCHEMAS 已改 `l1-freeze.2`/`schemaVersion 1.1.0`，本 lane 与 README 仍 `l1-freeze.1`/`1.0.0` | **登记为 T03**（README owner 定稿），未擅自改版本号 |
| 新增发现：内嵌 `verify-l1-freeze` 的 `codes.length===57`/enum 断言与 README 的"57/A01–A14/H01–H11"引用 | **登记为 T02**（SCHEMAS + README owner） |

风格约束遵守：新增内容都是契约/证据门禁（A15 拒绝、错误码、显式 unknown），无运行时守卫、吞错、双保险或"万一…则…"分支；惰性到期是删能力而非加守卫。

## ④ 改动文件与行数

| 文件 | 行数 | sha256 (after) |
|---|---|---|
| `OWNERSHIP.md` | 131 → **134**（+3） | `1cc63b1cef6d8ac81bf66c9af4c93195912dd24a99019bd55c84649c6c2f9bb0` |
| `OPEN-ITEMS.md` | 112 → **130**（+18） | `32f4c61f23404fdf0faf4c8fbaa48ee455650a98b4146c1eddb04e05b800f921` |
| `ERRORS.md` | 88 → **90**（+2） | `431ff25f268d662ae90d3618ee42a159aa6f467db5b6e2269dcb09c9068d1ba3` |

自证：三文件无截断/空段、表格列数一致（node 校验 0 issue）；`ERRORS.md` 58 行唯一码、每行有触发、重试全部落在 4 类内；`OWNERSHIP` A01–A15 / I01–I08；`OPEN-ITEMS` H01–H13 表行与小节一一对应、T01–T03 就位；`git diff --exit-code -- src test test-e2e integrations package.json` = 0，`git status --short` 仍只有两个既存 untracked 目录。

注：内嵌 `verify-l1-freeze` 当前**跑不到我的断言**就失败了——它在 `SCHEMAS.md` 的第一处断言 `ProtocolVersion.properties.schemaVersion.const === '1.0.0'` 处中断（另一 pane 正在把 SCHEMAS 改成 `l1-freeze.2`、`schemaVersion` 变为 `["1.0.0","1.1.0"]` 枚举）。其后还有两处会因本轮修订失败：`codes.length===57`、`ErrorCode.enum` 等价。三者已登记在 T02/T03。

---

## review-2 · 回合 7

## ① 版本标签

三份头部均已改为 `l1-freeze.2`，并各加一句如实变更说明（直接引 SCHEMAS 变更记录，未自编理由）：`l1-freeze.1`→`l1-freeze.2`，`SessionView` 增必填 `nodeStates`／新对象 `NodeStateEntry`，`DecisionRecord` 按 `kind` 约束各 receipt ref，`CapabilityJudgement` 增护栏字段；并声明"本文件语义不由该变更改写"，仅随 lane 版本与 `schemaVersion 1.1.0` 对齐。

`grep -n "l1-freeze\.1"` 现在只剩三处，全部在变更说明的 "`l1-freeze.1`→`l1-freeze.2`" 箭头里（有意保留），没有任何文件仍以 `.1` 自我标注。

同批清掉的分量版本残留（都属"版本标签"）：
- `OPEN-ITEMS` H01：`schemaVersion1.0.0` → `schemaVersion1.1.0（1.0.0 保留为可读 codec）`
- `OPEN-ITEMS` H01 §2：`"保留1.0.0名称但改语义"` → `"保留同名但改语义"`
- `OPEN-ITEMS` H07 行／H07 §2／H10 §2：`1.0.0仅投影`、`1.0.0提案board仅投影`、`1.0.0提案采用…` → `本提案…`（H07 两处补 `（A15）`）
- `OWNERSHIP` §5：`1.0.0 默认选择**board仅投影**` → `本版（l1-freeze.2）默认选择…`

## ② T02 / T03 收敛后的表述

```
| T02 | SCHEMAS.ErrorCode.enum 与 README 计数/引用同步 | **本 lane 已完成**：ERRORS 58 码、OWNERSHIP A01–A15、
OPEN-ITEMS H01–H13、三份 l1-freeze.2。剩余：实测 SCHEMAS.ErrorCode.enum 仍 57（缺
EFK_HOST_BOARD_AUTHORITY_CONFLICT）、README 仍“57/A01–A14/H01–H11”，归各自 owner | SCHEMAS owner / README owner |
| T03 | 版本号对齐 | **本 lane 已完成**：ERRORS/OWNERSHIP/OPEN-ITEMS 头部改 l1-freeze.2，H01 的 schemaVersion
改 1.1.0（枚举保留 1.0.0）。剩余：README 仍 l1-freeze.1/1.0.0，归 README owner | README owner |
```

不再是悬空待办：我方半边明确"已完成"，另一侧点名 owner 与实测事实。T01（HOST-MAPPING 索引缺 `toolCancellation`/`providerCancelBilling`）保持原样。

## ③ 58 个错误码逐项核对（ERRORS ↔ SCHEMAS.ErrorCode.enum）

**不一致，差异 1 条**：

- `ERRORS.md` 58 行、58 唯一码；`SCHEMAS.md` `$defs.ErrorCode.enum` 仍为 **57** 项。
- 在 ERRORS 不在 enum：**`EFK_HOST_BOARD_AUTHORITY_CONFLICT`**（本轮 A15 新增）。
- 在 enum 不在 ERRORS：无。其余 57 项逐项同名同集合，完全一致。
- 未改 SCHEMAS（非我可改）；已写入 ERRORS 头部与 T02 一行，指出"实测枚举仍 57（缺该码）"。SCHEMAS 现已在其变更记录里同步升到 `1.1.0`，但 `ErrorCode.enum` 未跟随——需 SCHEMAS owner 补该枚举值。

## ④ 口径差修补（A01–A15 × 正文）

- `OWNERSHIP` §3「宿主执行权（HostPort）」不得产生的输出补一句：`…；queued冒充delivered；独立 board owner 或第二调度（board 只投影，A15）` —— 把 §3 四权威域与 §4 A15 接上，"四个权威域"说法不变（board 属 HostPort 面，不新增第五域）。
- §5 首段与新增的反例段现已同为"本版（l1-freeze.2）默认选择 board 仅投影 … 该禁止由 A15 判定"，无口径差。

## ⑤ 改动文件与行数

| 文件 | 行数 | sha256 (before → after) |
|---|---|---|
| `ERRORS.md` | 90（±0） | `431ff25f…` → `be3c6769cda817bb16e001b9a7c399eaccc695448e38ac63a5c22b7247e3ddf6` |
| `OWNERSHIP.md` | 134（±0） | `1cc63b1c…` → `c0c0bff3a95fb2da71d1684dec12ad96a0668da9100a0dab7291d6a5092be264` |
| `OPEN-ITEMS.md` | 130（±0） | `32f4c61f…` → `49b7180dcb871c371878be4d3dbb23f6c1c1de0baa6691f218fcaea705186de2` |

本轮全部为既有行的就地替换（标签/口径），**无新增行**。自证：三份表格列数一致（0 issue）；ERRORS 58 码、每行有触发、重试落在 4 类内；OWNERSHIP A01–A15 / I01–I08；OPEN-ITEMS H01–H13 表行与小节一一对应、T01–T03 就位；`git diff --exit-code -- src test test-e2e integrations package.json` = 0；`git status --short` 仍只有两个既存 untracked 目录。未动 `.graph/`、`src/`、`test/`、`test-e2e/`、`integrations/`、`package.json`，也未改 README/HOST-MAPPING/SCHEMAS/INTERFACES。

---

