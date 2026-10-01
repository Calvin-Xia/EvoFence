# l2_artifact_port 独立交叉复核（review-1）

日期：2026-10-01 · 复核者：独立 review pane（**新 pane、非作者、未参与本节点任何写作**）
lane（作者工作区，冻结）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\artifact`（分支 `refactor/hk-artifact`，基线 HEAD 仍为 `7521ebc`，产物未提交）
复核对象（集成副本，commit `0c028bd`，本 pane 的 cwd）：`src/storage/artifacts/**`（8 文件 / **601** 行）+ `test/l2-artifact-{identity,binding,access,consumers}.test.js`（4 文件 / 586 行 / **38** 例）
基准（本节点契约真相源）：`spec/contracts/{INTERFACES.md,SCHEMAS.md,OWNERSHIP.md,README.md(CONTRACTS §5)}`、`spec/evaluation/{SCENARIOS.md,PROTOCOL.md,METRICS.md}`、`spec/graph/SEMANTICS.md`、`adr_0004`/`adr_0009`（`graph get-node` 实测列出 `adr_0004`/`adr_0010`）

## 结论：**可接受**（0 blocker / 0 major / **4 minor** / 4 nit）

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 4 | M1 consumer 读路径先取字节后判 binding/schema（同一 stale-base 工件按 store 状态返回两个不同错误码）；M2 asset 的 `revokedDependencies` 门放在最后（同一已失效资格按 store 状态返回两个不同码，且先读了本已作废的材料）；M3 `visibility`/`partition` 越枚举值时受众表 fail-open（读路径被冻结 store 的 decode 兜住，**报告路径没有兜底**）；M4 `AssetConsumerRequest` 允许 `contentRefs`/`sourceTraces` 同时为空并返回 `ok`+空 evidence，而冻结 `CapabilityAsset` 两者均 `minItems: 1` |
| nit | 4 | N1 `checkAvailability` 注释「passed」与 `at >= expiresAt` 不符；N2 `BindingExpectation` 不比对 `sessionId`/`hostSessionId`；N3 拒绝回包在 `message`/`refs` 里带上被 withholds 工件的 id（与 `access.ts` 自己的注释口径有张力，但与冻结 store 同惯例）；N4 port 从父级 impl barrel `../index.js` 取 `storeOk/storeFail` |

**逐条核对通过**：plan 五项（内容摘要/生产者身份/绑定/权限分区/可用性）各自落在单一函数且有可失败用例；DoD① 与 DoD② 都有我的独立负控变红；cp1/cp2/cp3 与三个测试文件一一对应；38/38 两次运行一致；无 ambient 读取、无自造第二套 digest/schema 真相源；lane 与集成副本 **12/12 文件 sha256 全等**；收工时 `git diff --stat`（src/storage 与 test/l2-artifact-*）为空。

---

## 0. 复核方法（不采信作者自报）

1. **双份 sha256**：先逐文件比对 lane 与集成副本 —— 8 个 `src/storage/artifacts/*.ts` + 4 个 `test/l2-artifact-*.test.js`，**12/12 全等**（收工时再次校验，仍 12/12）。集成副本源码我全程未做内容改写。
2. **实测门禁**：`npm run build` → `node --test test/l2-artifact-*.test.js`；另跑 `npm run typecheck` / `src:policy` / `dep:check`（均 0）。按复核指令**未跑全量 `npm test`**。
3. **自建 negative control（5 组，见 §2.2）**：临时变异 → rebuild → 记录变红用例名 → 改回 → 复绿。
4. **我方探针**（`/tmp/*.mjs`，直接 import 集成副本的 `dist/`，独立于作者套件）：刻意覆盖作者用例没有直接命中的组合 —— 错误码优先级随 store 状态漂移、越枚举值 fail-open、空 asset 材料。
5. ambient/确定性、防御性编程判据以 `grep` + 通读源码核对，不依赖测试。

### 0.1 一条过程性记录（与本节点质量无关，供后续复核者避坑）

本 worktree 是 `core.autocrlf=true` 且被复核文件以 **LF** 形式提交/拷贝（`git ls-files --eol` = `i/lf w/lf`）。我的变异恢复用了 `git checkout -- <file>`，git 会按 autocrlf 重新写成 **CRLF**：此时 `git diff` 仍报「无差异」（clean 过滤器规范化），但与 lane 的 sha256 立即不等（每行多 1 字节）。正确恢复方式是从 blob 取原始字节（`git cat-file blob HEAD:<path> > <path>`，plumbing 不做 smudge），再用 `git add`（blob 哈希与 HEAD 相同、`git diff --cached` 为空）刷新 index stat cache。本 pane 已按此恢复，最终状态：lane 12/12 全等 + `git status`/`git diff`/`git diff --cached` 对 `src/storage`、`test/l2-artifact-*` 全空。

---

## 1. 契约逐条核对

### 1.1 plan（5 项行为 → 单一实现入口 → 可证伪用例）

| plan 项 | 实现（唯一入口） | 用例（实测命中） | 判定 |
|---|---|---|---|
| 内容摘要 | 不自己算 digest：`readArtifact` 只返回 `store.get(ref)`；写路径 `store.put` 的 digest/immutability/S01 判定原样外传（`admit.ts` 头部注释明示不复制） | `readArtifact resolves the real bytes…`；`a reference whose content is not stored is unavailable…`；`the store boundary refusals propagate unchanged: digest mismatch and a malformed reference` | ✅ |
| 生产者身份 | `attributeProducer`（`human` + `identityRef === null` → `EFK_ARTIFACT_BINDING_MISMATCH`） | `a human producer with no verified identity reference cannot be attributed`（+ 正例 2 例） | ✅ |
| 图/节点/attempt/base 绑定 | `checkBinding` → `bindingMismatches`（8 个字段一处比对，一处产生 mismatch 列表） | `every binding field is checked…`（8 字段逐一命名）+ `a result computed against a superseded base is refused` | ✅ |
| 权限分区 | `withheldReason`（visibility 天花板 × partition 两轴独立）→ `partitionFeedback`/`defaultReportRefs` | `an author-facing audience is withheld from private, held-out and final`；`a held-out or final source partition is withheld…even at internal visibility` | ✅ |
| 实际可用性 | `checkAvailability`（注入 `Instant`，`null` 不过期）+ `readArtifact`（audience→expiry→store 顺序） | `an expired reference is unavailable even while the store still holds its bytes`（含边界 `at === expiresAt`） | ✅ |

### 1.2 DoD① 「产物引用可核对内容、生产者和期望版本；对旧 base 的结果拒绝提交」

- 内容：读路径只经 `store.get`（真实字节），无 summary/digest 替代分支 —— **NC3 变异（返回 `ref.digest` 当内容）让 7 例变红**，涵盖 4 个测试文件。
- 生产者/期望版本：`attributeProducer` + `matchSchema`（name+version+**digest** 三元组）同时挂在写路径（`admitArtifact`）与读路径（`admitBoundRef`）。
- 旧 base 拒绝提交：`admitArtifact` 的顺序是 producer → schema → binding → `store.put`，因此旧 base 的字节**根本不进 store**；作者用例用 `store.ids()` 为空断言「无可提交残留」，**NC1 变异（去掉 `baseDigest` 比对）让该例 + 另外 3 例变红**。
- 判定：✅（`old-base` 在 writer 与 workspace consumer 两条路径都拒，且都拒绝在副作用之前）。

### 1.3 DoD② 「holdout 与普通 agent 可见反馈分区；敏感 trace 不进入默认报告」

- 分区：`FeedbackPartition` 的 withheld 侧只有 `withheldVisibility`/`withheldPartition` 两个计数，无 id/loctor/digest；作者用例对我方构造的 `heldout-repo-42-patch` 断言 `JSON.stringify(partition)` 里连 id 与 locator 片段都不出现。
- **NC2 变异（把 `held-out`/`final` 分区改为恒可见）让 4 例变红**，其中正是「分区恒等可见」这一 DoD② 的正例断言。
- 判定：✅（函数层；端到端缺口见 §4 未证明项 1）。

### 1.4 cp1 / cp2 / cp3

| cp | 承载 | 用例数（实测） | 判定 |
|---|---|---|---|
| cp1 内容身份与 binding | `identity.ts` + `binding.ts` + `admit.ts` | identity 9 / binding 8 | ✅ |
| cp2 访问分区与失效语义 | `access.ts` + `availability.ts` | access 9 | ✅ |
| cp3 consumer 验证与错误路径 | `consumer.ts`（单一 `verifyForConsumer` 三分支 + `ARTIFACT_ERROR_MATRIX`） | consumers 12 | ✅ |

38 = 9+8+9+12，与作者自报一致（我逐文件跑过）。

### 1.5 契约来源一致性（不采信注释，逐条查真相源）

| 断言（实现/注释） | 真相源 | 实测 |
|---|---|---|
| visibility 与 partition 是**两轴、不互相推断** | `SCHEMAS.md` `ArtifactRef.partition`:「来源分区不由 visibility 推断」 | ✅ 两轴各自 withheld（用例覆盖「internal + held-out 也被拒」） |
| `privateTests` = evaluator-only | `SCHEMAS.md` `PrivacyPolicy.privateTests` | ✅ 天花板表把 `private` 及以上全部挡在 author/report/asset-staging 之外 |
| A13：执行者可见读路径不含 final/held-out 引用；泄露拒绝 `EFK_PRIVACY_VIOLATION` | `OWNERSHIP.md` A13 | ✅ 读路径先判受众（见 §3.2） |
| S09：产物 binding 非 null，graph/attempt/base/schema/producer 匹配 | `SCHEMAS.md` S09 | ✅ 8 字段单一比对 + `pre-source` 的 null 允许 |
| S18：sourceTraces 只能 train，held-out/final 不产资产 | `SCHEMAS.md` S18 | ✅ `EFK_EVALUATION_PROTOCOL_MISMATCH`（含 contentRefs 的 restricted 分区） |
| S17：撤销依赖使资格失效 | `SCHEMAS.md` S17 | ⚠️ 只落到 `EFK_ASSET_QUALIFICATION_INVALID` + 注入的 `revokedDependencies`（资格完整性归 l4，见 §4 未证明项 3） |
| S01/S22 digest 真相源是冻结 store/protocol | `SCHEMAS.md` S01/S22 + `INTERFACES.md` ArtifactStore 行 | ✅ lane 内 `grep -rn "crypto\|createHash\|sha256"` = 0；`matchSchema` 比的是声明三元组，不重算 |
| `types.ts` 的 re-narrow 不是「第二套 schema」 | `src/protocol/types.ts` | ✅ 实测 `Wire` 对 `$ref` 递归解析、`anyOf` 取首分支 —— 所以注释所写「`binding`/`expiresAt` 被类型化为非 null、`baseDigest` 变成普通 string」属真，三家 narrowing 都指回同一冻结定义 |
| `Binding` 字段名 | `SCHEMAS.md` §Binding（8 字段） | ✅ lane 未改名、未增字段；但 expectation 少了两个轴（N2） |

---

## 2. 实测命令与证据

### 2.1 门禁

```
npm run build                 # exit 0
node --test test/l2-artifact-*.test.js
#   ℹ tests 38 / ℹ pass 38 / ℹ fail 0   （连跑两次，数字与用例名一致 → 确定性）
npm run typecheck             # exit 0
npm run src:policy            # exit 0（169 文件，最大 350 行；artifacts 各文件 ≤144 行）
npm run dep:check             # exit 0（169 modules / 589 edges / cycles 0 / acyclic true）
```

### 2.2 我自建的 negative control（5 组，作者套件之外）

| # | 变异点 | 变红用例（实测） | 判定 |
|---|---|---|---|
| NC1 | `binding.ts` 删掉 `baseDigest` 比对 | `every binding field is checked…` / `a result computed against a superseded base is refused` / `the superseded-base result never reaches the store…` / `the workspace consumer refuses a result bound to a superseded base…`（4 红） | DoD① 可证伪 ✅ |
| NC2 | `access.ts` 把 `held-out`/`final` 分区改恒可见 | `a held-out or final source partition is withheld from an author…` / `the default report carries the author-visible references…` / `a partition-only restriction is also a privacy violation…` / `asset content from held-out or final never becomes asset material`（4 红） | DoD② 可证伪 ✅ |
| NC3 | `availability.ts` `readArtifact` 返回 `ref.digest` 代替 store 字节 | 7 红（identity 2、access 2、consumers 3：`readArtifact resolves the real bytes…` / `a reference whose content is not stored…` / `the workspace consumer admits…and receives its bytes` / `the evaluator consumer reads held-out evidence…` / `the asset consumer admits train source traces…`） | 「绝不因 ref 存在而通过」可证伪 ✅ |
| NC4 | `consumer.ts` 删掉 consumer 路径的 `checkBinding` | `the workspace consumer refuses a result bound to a superseded base instead of admitting it`（1 红） | cp3 入口自身持门 ✅（注意：该门只有 1 例守护） |
| NC5 | `availability.ts` 把 store 调用挪到受众检查**之前** | `a withheld reference is refused before the store is consulted`（1 红；spy store 的 `get` 抛错） | 「受众检查先于 store」可证伪 ✅ |

变异全部改回 → `npm run build` → 38/38；收工 `git diff --stat -- src/storage test/l2-artifact-*.test.js` 为空（§0.1 的 CRLF 过程已修正），lane 12/12 sha256 全等。

---

## 3. 关键不变量核查（任务点 3、4、5）

### 3.1 读路径必须取真实字节

`readArtifact` 是唯一读入口，返回 `store.get(ref)` 的结果或 typed 失败，没有任何「回退到 `ref.digest`/`location`/summary」的分支（NC3 实证）。消费者只把**已读出的字节**放进 `evidence`（`AdmittedArtifact{ref,bytes}`），参考只作为随附身份，不作为内容替代。证据缺失（未存储/已过期）与地址失效都是 `EFK_ARTIFACT_UNAVAILABLE`，与 DoD① 的 plan 语「不能以 summary 通过」一致。✅

### 3.2 受众检查先于 store

- 顺序：`withheldReason` → `checkAvailability` → `store.get`（`availability.ts` 注释与代码一致）。
- 可证伪：spy store 的 `get` 一旦被调用即 `throw`，作者用例 `store.calls` 为空；NC5 变异后该例变红。✅
- asset 路径也是分区判定先于读（`isRestrictedPartition` → `readArtifact`）。✅
- 但边界是「读路径」，不是「所有门」：consumer 路径把 producer/schema/binding 判在字节读取**之后**（M1）；写路径反过来（producer/schema/binding → store.put）。两种顺序我都认为可辩护（A13 要求受众最先），但代价见 M1。

### 3.3 digest/schema 真相源不造第二套

lane 内不 import `node:crypto`、不 hash、不重算 schema digest；S01（1 MiB/credential locator/immutability）与 S22（真实字节 sha256）全部由冻结 `ArtifactStore` 承担并在 `admit.ts`/`consumer.ts` 注释里显式声明「传出去不改」。`dep:check` 显示无环；`grep -rn "node:" src/storage/**` 为空 → **这个 port 的传递闭包不含任何 node builtin**（对将来 I01–I08「core 拒绝 node builtin」的机检友好，见 N4 的保留意见）。✅

### 3.4 错误矩阵都落在冻结 ErrorCode 内

我自己枚举了 lane 内出现的全部码，与 `ARTIFACT_ERROR_MATRIX` 的 key 集合逐一比对：

| 码 | lane 引用次数 | 矩阵? | 冻结 `ERROR_CODES`? |
|---|---|---|---|
| `EFK_ARTIFACT_BINDING_MISMATCH` | 8 | ✅ | ✅ |
| `EFK_ARTIFACT_UNAVAILABLE` | 4 | ✅ | ✅ |
| `EFK_PRIVACY_VIOLATION` | 3 | ✅ | ✅ |
| `EFK_EVALUATION_PROTOCOL_MISMATCH` | 3 | ✅ | ✅ |
| `EFK_ASSET_QUALIFICATION_INVALID` | 3 | ✅ | ✅ |
| `EFK_SCHEMA_INVALID` | 2 | ✅（标注为边界外传） | ✅ |
| `EFK_ARTIFACT_DIGEST_MISMATCH` | 2 | ✅（标注为 `store.put` 外传） | ✅ |

无第八个码、无自造码、矩阵无空说明（作者用例也断言了这一点）。`src/protocol/errors.ts` 另有 `EFK_ARTIFACT_UNAVAILABLE: 'after-refresh'` 的 retry 策略，本 lane 作为纯判定不消费 retry，属合理分工。✅

### 3.5 ambient/确定性与注入

`grep -rn "Date|Math.random|require(|import(|process.|setTimeout"` → **0 命中**；顶层只有 `const` 表 + `export function`（零副作用，I05）；时间一律走参数 `at: Instant`（`checkAvailability`/`readArtifact`/三个 consumer 请求都带 `at`），无时钟读取；digest 只在测试里作为注入的 `DigestPort` 出现。纯函数对同输入逐字相同（连跑两次 38/38 且用例名一致）。✅

### 3.6 防御性编程禁令

逐处过了一遍，**没有发现**不可能状态守卫、吞错、双保险、惩罚式回退、无依据默认值：

- 所有 `if (!x.ok) return x` 都是把**上游 typed 失败原样上抛**（契约/证据门禁，属例外 1/4），不是转成默认值；
- `attributeProducer` 对 `human + identityRef === null` 的拒绝是 `ActorRef` 的**冻结字段语义**（例外 1）；
- `binding === null` 分支是 `ArtifactRef.binding` 冻结允许的 `pre-source` 形态（不是「防御 null」）；
- `expiresAt !== null && at >= expiresAt` 是 `Instant / null` 的冻结语义（`null` = 不过期），不是默认值；
- `verifyForConsumer` 的 `switch` **故意没有 `default`**：我实测给它加第 4 个 role 会让 `tsc` 报 `TS2366: Function lacks ending return statement` —— 类型层已兜住，写运行时 `default` 反而会构成「双保险」。这一处是**正面证据**（按禁令「优先变成类型」做对了）。

---

## 4. 缺陷清单

### minor-1 — consumer 的字节读取先于 binding/schema 判定，错误码随 store 状态漂移（且与写路径顺序相反）

`admitBoundRef`（`consumer.ts:70`）顺序是 `readArtifact`（受众→过期→store）→ `attributeProducer` → `matchSchema` → `checkBinding`；`admitArtifact`（`admit.ts:35`）顺序是 producer → schema → binding → `store.put`。探针实证（同一份 stale-base 工件，只改 store 内容）：

```
P1a stale base, locator gone   -> EFK_ARTIFACT_UNAVAILABLE
P1b stale base, bytes stored   -> EFK_ARTIFACT_BINDING_MISMATCH
```

同一逻辑判定给出两个不同码，且是否触碰 store 取决于绑定是否成立。**不构成接受路径**（两支都是 typed 拒绝），DoD① 仍成立，I07 也未被破坏（同一输入 + 同一 store 状态 → 同一输出）。影响限于：诊断/回执码不稳定、审计时「旧 base 拒绝」与「地址失效」难以区分。

**建议**（仅在 owner 想收口时做）：把 `attributeProducer`/`matchSchema`/`checkBinding` 挪到 `readArtifact` 之前 —— **但必须保留「受众检查最先」**（A13），即顺序为 `withheldReason → 过期 → producer/schema/binding → store.get`；若把 binding 提到隐私门之前，held-out 工件会以 `BINDING_MISMATCH` 而非 `EFK_PRIVACY_VIOLATION` 结束，反而违反 A13。

### minor-2 — asset 的 `revokedDependencies` 门排在最后（先读了已经作废的材料）

`admitAssetMaterial`（`consumer.ts:118-136`）先读完全部 `contentRefs`+`sourceTraces`，最后才判 `revokedDependencies.length > 0`。探针实证：

```
P2a revoked dep + locator gone -> EFK_ARTIFACT_UNAVAILABLE
P2b revoked dep + bytes stored -> EFK_ASSET_QUALIFICATION_INVALID
```

S17「撤销使资格失效」是**已确定**的失效事实，却在拿到全部字节之后才生效，且被 store 状态改写错误码，还多读了一批注定不用的材料。

**建议**：把 `revokedDependencies` 判定提到函数开头（一行位置调整，无新代码）。

### minor-3 — `visibility`/`partition` 越枚举值时受众表 fail-open（读路径有 store 兜底，**报告路径没有**）

`withheldReason` 用两张 `Record<enum,…>` 查表：越枚举值时 `VISIBILITY_RANK[v]` 为 `undefined`（`undefined > n` = false）、`RESTRICTED_PARTITION[p]` 为 `undefined`（falsy），于是**视为可读**。探针实证：

```
P3  defaultReportRefs([{visibility:'secret-tier', partition:'holdout'}])
    -> {"visible":["weird"],"wv":0,"wp":0}        # 被放进「report 可见」一侧
P4  readArtifact(同一 ref, 'author', store)   -> EFK_SCHEMA_INVALID      # store.decode 兜住
P4b verifyForConsumer(asset, … 同一 ref)      -> EFK_SCHEMA_INVALID      # 同上
```

即：**读路径**因为 `store.get` 内部 `decode('ArtifactRef')` 而 fail-closed（我读过 `memory-artifact-store.ts` 确认），但 `partitionFeedback`/`defaultReportRefs` 不经过 store，于是这条路对越枚举值是 fail-open。可达性取决于调用方是否绕开 codec 造 ref（`types.ts`/`access.ts` 注释的前提是「已经过 codec 边界」），所以我定 minor 而非 major。

**建议**（按禁令「优先把不变量变成类型或校验时断言」，不要写运行时守卫）：在 `access.ts` 的文档注释里把前提写死（「本函数只接受 codec 解出的 ref；越枚举值不在契约域内」），并把该前提作为 L3 报告渲染器的接入条件；若要在报告路径也 fail-closed，则让报告入口复用 store/protocol 的 decode，而不是在查表处加默认分支。

### minor-4 — `AssetConsumerRequest` 允许空材料并返回 `ok` + 空 evidence（冻结资产不允许）

`CapabilityAsset.contentRefs` 与 `.sourceTraces` 都是 `minItems: 1`（`SCHEMAS.md:86` 实测），lane 的注释也承认「`minItems: 1` 是 codec 的边界，这里不复查」。但 lane 的公开请求类型是裸数组，探针实证一个**没有任何证据**的请求会静默通过：

```
P5 verifyForConsumer({role:'asset', contentRefs:[], sourceTraces:[], revokedDependencies:[], at:0}, store)
   -> OK evidence=[]
```

这是本节点唯一一处「证据缺失仍然 `ok`」的形状，与 plan 语「证据缺失…不能以 summary 通过」张力最大（虽然这里连 summary 都没有）。风险点在于 L4 asset 侧直接构造该请求时拿到一次空洞通过。

**建议**（类型层，符合禁令）：把请求改成接受 codec 解出的 `CapabilityAsset` 切片（或非空 tuple 类型 `readonly [ArtifactRef, ...ArtifactRef[]]`），让「至少一条」由类型承载；退路是在边界显式 `decode` 一次。

### nit-1 — `checkAvailability` 注释与边界语义不一致

注释写「A reference whose expiry has passed is unavailable」，代码是 `at >= ref.expiresAt`（恰好在到期时刻即拒绝，作者用例明确断言了这一点）。改成「at or after」即可。

### nit-2 — `BindingExpectation` 丢掉了 `sessionId`/`hostSessionId` 两个轴

冻结 `Binding` 有 8 字段，`bindingMismatches` 比 8 项但 expectation 里没有 session 两字段（比的是「expectation 有的字段」）。S09 对**产物**只点名 graph/attempt/base/schema/producer，对**事先源快照**才强调「绑定精确 session/task/graph/digest」，所以现状可辩护；但两个 session 里 graph revision/node/attempt 完全同形的工件在理论上能互相通过。建议要么把 `sessionId` 加进 `BindingExpectation`，要么在 `binding.ts` 注释里写明「session 轴不在本 lane 判定范围」。

### nit-3 — 拒绝回包会把被 withholds 的工件 id 交给受限受众

`availability.ts` 的 `EFK_PRIVACY_VIOLATION` 与 `consumer.ts` 的 `protocolMismatch` 都把 `ref.id` 写进 `message` 并放进 `error.refs`，即 author / asset-staging 受众能看到一个 held-out/final 工件的 id 与分区名。`access.ts` 自己的注释说 withheld 侧「只带计数与理由，绝不带 id/locator/digest」—— 那条只覆盖 `FeedbackPartition`（确实做到），而拒绝回包是第二条 agent 可见输出。与冻结 store 同惯例（`memory-artifact-store.ts` 也回 `[ref.id]`），故仅记 nit：若把 A13 的「调用图断言」读得绝对严格，这里需要一次决议（裸码 or 脱敏回包）。

### nit-4 — port 从父级 impl barrel 取 `storeOk`/`storeFail`

`identity.ts`/`binding.ts`/`availability.ts`/`admit.ts` 都 `import … from '../index.js'`（= `src/storage/index.ts`），而 `storeOk`/`storeFail`/`StoreResult` 定义在 `src/storage/contracts.ts`。方向无环、`dep:check` 通过、闭包不含 node builtin（§3.3），所以只是分层卫生：一个「port」模块把自己的 import 闭包挂到了 in-memory 实现子树（`memory-event-store`/`store-session`/`projection`…）。若将来 I01–I08 的 import-guard 按「端口只依赖 contracts」收口，这里会被点到。

---

## 5. 未证明项（如实列出）

1. **DoD② 只证到函数层**：`defaultReportRefs`/`partitionFeedback` 除本 lane 测试外**无 in-repo 调用者**；没有真实报告渲染器或 `PrivacyPolicy` 驱动的受众贯通，「敏感 trace 不进默认报告」尚未端到端证明。
2. **消费方不存在**：`verifyForConsumer` 的三个角色只被单元用例驱动，仓库内没有 WorkspacePort/EvaluatorPort/AssetRegistry 适配器调用它 ——「提供 workspace/evaluator/asset 的产物接口」目前是接口存在性证明。
3. **S17 资格完整性不在此 lane**：`qualification`/`evaluationRef`/`expiresAt`/依赖 revision 的完整断言归 `l4_asset_registry`、`l4_promotion`（`graph get-node` 实测两节点存在），本 lane 只接收 `revokedDependencies` 事实。S17 的端到端证明必须在 L4 补。
4. **`identityRef` 只判非 null**：无法在这里证明该引用「由权限根真正验证过」（A01/PolicyPort 职责）；lane 只把裸标签式 human 生产者挡掉。
5. **越枚举值的 fail-open 依赖冻结 store 的 decode**：本 lane 的两张受众表不是**枚举全覆盖**的表；M3 的读路径安全性完全由 `ArtifactStore.get/put` 内部的 `decode('ArtifactRef')` 提供（我已在当前冻结实现上核实）。换 store 实现若省掉 decode，M3 会升级为真实泄露。
6. **未跑全量 `npm test`**（按复核指令）；`typecheck`/`src:policy`/`dep:check` 已跑且为 0。
7. **`error.refs` 的受众语义**（nit-3）未经 OWNERSHIP/A13 明文裁决，属我读出的待决项而非已认定违约。

---

## 6. 收工一致性

- lane 侧：`git log -1` 仍为基线 `7521ebc`，产物未提交（作者工作区我未触碰）。
- 集成侧：`git diff --stat`（`src/storage`、`test/l2-artifact-*.test.js`）为空；`git diff --cached` 为空（无内容入 index）；`git status --porcelain` 对这两处为空；8 src + 4 test 与 lane sha256 **12/12 全等**。
- 本 pane 未 commit、未改 `.graph`、未动其它 lane、未跑全量测试；探针脚本只落在系统临时目录。

**最终判定：可接受。** 4 个 minor 都**不改变任何接受/拒绝判定**，属于「错误码优先级稳定化 + 边界前提写实 + 类型收紧」三类收口；M2/M4 各一行到几行即可修，M1 若修必须保住 A13 的「受众最先」。建议随下一次触碰本 lane 时一并处理，不需要单开一轮修复（若 owner 选择修，请务必对 M1/M2 各补一条错误码优先级用例，对 M4 补一条「空材料被拒」用例）。
