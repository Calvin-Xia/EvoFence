# l2_artifact_port 修复复验（review-fix-verify）

日期：2026-10-01 23:56 +0800 · 复核者：**独立复验 pane**（新 pane、未参与本节点任何写作；只读，唯一写入本文件）
集成 worktree（本 pane cwd）：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`
修复提交（SHA）：`2bbbe300c9a5c0badd36f07dc93f10a30abeb38b`（subject `L2 l2_artifact_port: review fixes (M1-M4, N1-N3)`，父提交 `fa1731b`）
修复前基线（本节点合并提交）：`0c028bd`；`git diff --stat 0c028bd fa1731b -- src/storage/artifacts test/l2-artifact-` **为空**，故 `0c028bd..2bbbe30` 对该两处的差异即本次修复差异（5 src + 3 test，+333/−77）。
复核对象：`src/storage/artifacts/**`（8 文件 / 620 行）+ `test/l2-artifact-{access,binding,consumers,identity,repairs}.test.js`（5 文件 / 50 例）。
首轮复核：`docs/evofence-harness-kernel/execution/reviews/l2_artifact_port-review.md`（可接受 / 0 blocker / 0 major / 4 minor / 4 nit）。

## 结论：**接受**（0 blocker / 0 major / 0 minor；1 保留 nit（N4）+ 2 条保留观察，均不改变任何接受/拒绝判定）

- M1–M4、N1、N2 **全部按验收标准修复**，逐条有实测证据与可失败负控。
- N3 **已修**（拒绝回包不再带被 withholds 工件的 id/locator/digest），比「记录处置」更强的收口。
- N4 **保留**（未修，属分层卫生；见 §3）。
- 未见新引入缺陷；`src/**` 与 `test/**` 收工干净，dist 复原。

---

## 1. 逐条判定与实测证据

### M1 — consumer 读路径顺序 ⇒ 同一 stale-base 工件按 store 状态返回同一码 ✅

实现：`readArtifact(ref, audience, at, store, expectation?)`（`availability.ts:34`）顺序为
`withheldReason` → `checkAvailability`(过期) → `attributeProducer` → `matchSchema` → `checkBinding` → `store.get`；consumer 经 `admitBoundRef`（`consumer.ts:63`）把 `expectation` 传入同一读入口，不再自行在读过字节后判 binding。

我的独立探针（`/tmp` 脚本，直接 import 集成 dist，作者套件之外）：

```
PASS  P1a stale base / locator gone   : EFK_ARTIFACT_BINDING_MISMATCH   (store.get 调用 0 次)
PASS  P1b stale base / bytes present  : EFK_ARTIFACT_BINDING_MISMATCH
PASS  P1a==P1b deep equal             : true
PASS  P1 stale base never touches store: EFK_ARTIFACT_BINDING_MISMATCH/calls=0
```

A13 反例（held-out + stale base + 过期 + human/identityRef=null + schema 不符，五重拒绝条件叠加）：

```
PASS  A13 readArtifact held-out+stale => privacy : EFK_PRIVACY_VIOLATION/calls=0
PASS  A13 refusal names no withheld id           : false（回包里不含 ref.id）
PASS  A13 consumer held-out+stale   => privacy : EFK_PRIVACY_VIOLATION/calls=0
PASS  expiry precedes binding : EFK_ARTIFACT_UNAVAILABLE/calls=0
PASS  privacy precedes expiry : EFK_PRIVACY_VIOLATION/calls=0
```

即：绑定判定在「取字节」之前，但**受众判定仍最先**（隐私拒绝不触碰 store），A13 未退化。

### M2 — asset 撤销门提前，且不读作废材料 ✅

实现：`admitAssetMaterial`（`consumer.ts:87`）第一句即 `revokedDependencies.length > 0 → EFK_ASSET_QUALIFICATION_INVALID`，先于 `isRestrictedPartition` / `readArtifact`。

```
PASS  P2a revoked dep / locator gone : EFK_ASSET_QUALIFICATION_INVALID
PASS  P2b revoked dep / bytes present: EFK_ASSET_QUALIFICATION_INVALID
PASS  P2 revoked dep precedes even restricted material + no store: EFK_ASSET_QUALIFICATION_INVALID/calls=0
```

（探针把 contentRefs 换成 `visibility:final/partition:final/expiresAt:0` 的受限材料，仍是撤销码且 store 未被调用 → 撤销门确实在最前。）

### M3 — 越枚举值不再 fail-open（报告路径复用冻结 codec）✅

实现口径（`access.ts` 头注释写明）：`withheldReason` / `isRestrictedPartition` 及其报告入口 `partitionFeedback` / `defaultReportRefs` 一律先 `decode('ArtifactRef', ref)`，再查两轴表；`decode` 失败即返回该 typed 失败，**不构造半成品 partition**。这是首轮建议里比「仅写前提」更强的一条。

```
PASS  P3 defaultReportRefs(out-of-enum) : EFK_SCHEMA_INVALID（首轮为 {"visible":["weird"],...} fail-open）
PASS  P3 no partial visible side        : false（"value" in result === false）
PASS  P3 proto/constructor enums        : EFK_SCHEMA_INVALID（visibility:'__proto__'/partition:'constructor'）
PASS  P3 readArtifact(out-of-enum) no store : EFK_SCHEMA_INVALID/calls=0
```

作者新增用例 `M3: unknown visibility and partition enums are typed failures at report and classification entries`、`M3: malformed enums reject without relying on a store codec in direct and consumer reads` 覆盖同样断言。

### M4 — 空材料被拒（typed 拒绝路线）✅

实现：`admitAssetMaterial` 在撤销门后、任何读之前判 `contentRefs.length === 0 || sourceTraces.length === 0 → EFK_SCHEMA_INVALID`。与冻结 `SCHEMAS.md:86` `CapabilityAsset.contentRefs/sourceTraces` 的 `minItems: 1` 一致。

```
PASS  P5 both empty            : EFK_SCHEMA_INVALID/calls=0
PASS  P5 contentRefs empty     : EFK_SCHEMA_INVALID/calls=0
PASS  P5 sourceTraces empty    : EFK_SCHEMA_INVALID/calls=0
PASS  P5 non-empty still admitted: evidence.length = 2
```

### N1 — 注释与 `at >= expiresAt` 边界一致 ✅

`availability.ts` 注释改为「A reference is unavailable **at or after** its expiry」；`consumer.ts` 矩阵行同步为「at or after expiresAt」。实测边界：`at===expiresAt` 拒绝、`expiresAt-1` 通过。

### N2 — `sessionId`/`hostSessionId` 两轴已比对 ✅（选了「加入两轴」而非注释豁免）

实现：`BindingExpectation = Binding`（`types.ts:63`），`Binding` 把 `hostSessionId` 按冻结语义 re-narrow 成 `... | null`；`bindingMismatches`（`binding.ts:21`）新增 `sessionId`、`hostSessionId` 两项比对。冻结真相源核对：`src/protocol/objects/core.ts` `Binding` 的 `required` 含 `sessionId`、`hostSessionId`（`anyOf: [Id, null]`）。

```
PASS  N2 sessionId mismatch refused    : EFK_ARTIFACT_BINDING_MISMATCH
PASS  N2 hostSessionId mismatch refused: EFK_ARTIFACT_BINDING_MISMATCH
```

作者用例 `N2: kernel and host sessions must match on writer and bound consumer paths`（含 `admitArtifact` 写路径与 `pre-source`）与 `N2: hostSessionId preserves frozen null and string semantics in both directions` 通过。

### N3 — 拒绝回包不再携带被 withholds 工件身份 ✅（已修）

`readArtifact` 的 `EFK_PRIVACY_VIOLATION` 回包去掉了 `ref.id`（message 只给 audience 与 reason，refs 为空）；`protocolMismatch(what)` 去掉 id 形参；asset 路径对受限分区/非 train trace 只描述分区。实测：

```
PASS  A13 refusal names no withheld id       : false
PASS  N3 asset protocol refusal code          : EFK_EVALUATION_PROTOCOL_MISMATCH
PASS  N3 asset refusal names no restricted id : false
```

作者用例 `N3: privacy refusals contain no withheld id, locator or digest...`、`N3: asset protocol refusals contain no restricted material identity...` 对 4 个受限受众 + 2 类 asset 拒绝断言 `refs === []` 且渲染串不含 id/location/digest。

### N4 — 保留（见 §3）

---

## 2. 门禁 / 负控 / 探针（不采信作者自报）

### 2.1 门禁（全部通过；用例连跑两次逐名一致）

```
npm run build                      # exit 0
node --test test/l2-artifact-*.test.js      # ℹ tests 50 / pass 50 / fail 0
node --test test/l2-artifact-*.test.js      # 第二次：50/50，用例名集合 diff 为空（确定性）
  per-file: access 9 / binding 8 / consumers 12 / identity 9 / repairs 12 = 50
npm run typecheck                  # exit 0
npm run src:policy                 # 179 files，largest 350，0 JS；passed
npm run dep:check                  # 179 modules / 627 edges / cycles 0 / acyclic true
```

修复前 38 例，新增 `test/l2-artifact-repairs.test.js` 12 例（M1×3、M2×1、M3×2、M4×1、N1×1、N2×2、N3×2）。作者对既有 access/consumers 用例的改动仅是「解包 `StoreResult`」与「补足非空 sourceTraces」（M4 生效后），断言码与语义未削弱。

### 2.2 独立负控（在 gitignored 的 `dist/` 上精确变异 → 记录变红用例 → 按字节复原）

| # | 变异点 | 变红用例（实测） | 复原 |
|---|---|---|---|
| NC-M1 | `readArtifact` 把 `store.get` 提到 expectation 判定之前（还原首轮顺序） | `M1: stale binding rejection is independent...`、`M1: producer and every schema axis reject before retrieving bytes...`、`N2: kernel and host sessions...` | `cp` 备份字节 → 50/50 |
| NC-A13 | 把 producer/schema/binding 提到 `withheldReason` **之前** | `M1: privacy still precedes expiry, producer, schema and binding refusal`、`N1: exact expiry refuses before bytes...` | 同上 |
| NC-M2 | 把 `revokedDependencies` 门移回 `admitAssetMaterial` 末尾 | `M2: revoked qualification rejects before any material read regardless of store state` | 同上 |
| NC-M3 | 去掉 `withheldReason` 的 `decode('ArtifactRef', ...)` | `M3: unknown visibility and partition enums are typed failures...`、`M3: malformed enums reject without relying on a store codec...` | 同上 |
| NC-M4 | 删除空材料拒绝分支 | `M4: either empty material list and both empty lists reject before any asset read` | 同上 |
| NC-N2 | 删除 `sessionId`/`hostSessionId` 两项比对 | `N2: kernel and host sessions must match...`、`N2: hostSessionId preserves frozen null and string semantics...` | 同上 |

**探针在变异下复现首轮缺陷**（证明探针非空洞、修复确有效果）：

| 变异 | 探针结果 |
|---|---|
| NC-M1 | `P1a = EFK_ARTIFACT_UNAVAILABLE` vs `P1b = EFK_ARTIFACT_BINDING_MISMATCH`（首轮 M1 的码漂移复现），`P1a==P1b = false` |
| NC-M2 | `P2a = EFK_ARTIFACT_UNAVAILABLE` vs `P2b = EFK_ASSET_QUALIFICATION_INVALID`（首轮 M2 复现） |
| NC-M3 | `P3 defaultReportRefs(out-of-enum) = OK`（fail-open 复现） |
| NC-M4 | `P5 both empty = OK`（首轮 M4 复现） |

复原后：`dist` 无变异残留（`grep "const early ="` 等 0 命中）、`node --test` 50/50、探针 26 PASS / 0 FAIL。所有变异仅落在 gitignored 的 `dist/`，`src/`、`test/` 未被改写。

### 2.3 ambient / 真相源不变式（与首轮同法复核）

- `grep -rn "node:|Date|Math.random|process.|setTimeout|createHash|crypto|sha256" src/storage/artifacts/` = **0**；protocol 闭包 `grep -rn "node:" src/protocol/` = **0**（不造第二套 digest、无时钟/随机、无 node builtin）。
- 全部出现的错误码（7 个）都在冻结 `ERROR_CODES` 且都在 `ARTIFACT_ERROR_MATRIX` 内：`EFK_ARTIFACT_BINDING_MISMATCH`(8)、`EFK_ARTIFACT_UNAVAILABLE`(4)、`EFK_SCHEMA_INVALID`(3，含新增空材料)、`EFK_PRIVACY_VIOLATION`(3)、`EFK_EVALUATION_PROTOCOL_MISMATCH`(3)、`EFK_ASSET_QUALIFICATION_INVALID`(3)、`EFK_ARTIFACT_DIGEST_MISMATCH`(2)。
- `verifyForConsumer` 的 `switch` 无可达默认分支，`tsc` 的类型完备性仍在（首轮正面证据不变）。

---

## 3. 未证明项与保留意见

**保留 nit（N4，未修，按首轮做法仅记录）**：`identity.ts` / `binding.ts` / `availability.ts` / `admit.ts` 仍从父级 impl barrel `../index.js` 取 `storeOk`/`storeFail`/`StoreResult`（`access.ts` 新增同向），并新增 `access.ts → ../../protocol/index.js`。方向无环（dep:check 627 edges / 0 cycles）、闭包不含 node builtin、`src/storage/artifacts` 在仓库内**无子树外调用者**（`grep` 仅命中自身与 `src/storage/index.ts` 的 re-export 之外无引用）。故仅为「端口只依赖 contracts」的分层卫生，保留不改，理由：改动会牵动 4 文件的 import 图且无行为收益。

**保留观察（不计缺陷）**：
1. `Audience`（受众轴）是编译期封闭联合类型、不经 codec 边界；`AUDIENCE_CEILING[audience]` 对越枚举 audience 会得到 `undefined`（visibility 轴 fail-open）。因无运行时构造路径（不同于首轮 `ArtifactRef` 的越枚举，后者可经 codec 输入），判为非可达，不单列缺陷；若将来 audience 也从外部 decode，需同 M3 一并收口。
2. `AssetConsumerRequest` 是裸数组 + 直接可构造；本次已按冻结 `minItems: 1` 拒空，但未复检 `uniqueItems: true`（重复 ref 会被读入两次 evidence）。M4 验收标准只要求「空材料被拒」，此点在 M4 之外，不改变任何接受/拒绝语义，记为边界前提。

**沿用首轮的未证明项**（不受本次修复影响）：DoD② 只证到函数层（无真实报告渲染器）；三个 consumer 无 in-repo 适配器调用者；S17 资格完整性归 L4；`identityRef` 只判非 null，未证由权限根验证。按简报**未跑全量 `npm test`**（修复仅动 `src/storage/artifacts` + 其测试，且该子树无子树外 importer，对全量无影响；I01–I08 guard 仅扫 `src/protocol`，未被本修复触及）。

---

## 4. 收工一致性

- **lane vs 集成 sha256（13/13 全等）**：8 src + 5 test，逐文件 `sha256sum` 全等（前 12 位）——

  | 文件 | sha256(12) | 文件 | sha256(12) |
  |---|---|---|---|
  | `src/storage/artifacts/access.ts` | `6fc576b835b5` | `test/l2-artifact-access.test.js` | `1d2df8fca339` |
  | `src/storage/artifacts/admit.ts` | `0254ff55ddbc` | `test/l2-artifact-binding.test.js` | `83b3aedc678a` |
  | `src/storage/artifacts/availability.ts` | `ebfc6919dc4f` | `test/l2-artifact-consumers.test.js` | `b3772719c09e` |
  | `src/storage/artifacts/binding.ts` | `18dde755117b` | `test/l2-artifact-identity.test.js` | `42b48e54ce2b` |
  | `src/storage/artifacts/consumer.ts` | `894216487a7e` | `test/l2-artifact-repairs.test.js` | `49720e5c8129` |
  | `src/storage/artifacts/identity.ts` | `7890159c4e47` | | |
  | `src/storage/artifacts/index.ts` | `ed3ad0bef232` | | |
  | `src/storage/artifacts/types.ts` | `258309c186d9` | | |

  lane（`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\artifact`，分支 `refactor/hk-artifact`）HEAD 仍为 `7521ebc`，产物未提交（`git status`：`?? src/storage/artifacts/` + 5 个 `?? test/l2-artifact-*.test.js`）；lane 侧我未触碰。
- **集成侧**：HEAD = `2bbbe30`；`git status --porcelain`、`git diff --stat`、`git diff --cached --stat` 对 `src/storage` + `test/l2-artifact-*` **全空**；工作树 == HEAD。
- **dist 复原**：负控/变异后 `npm run build` + 逐字节回拷，无变异残留，套件 50/50、探针 26/0。
- 本 pane 未 commit、未写 `.graph`、未改 lane、未动其它文件；探针/变异脚本只落在系统临时目录 `%LOCALAPPDATA%\Temp\l2fix-probe\`。

**最终判定：接受（0 blocker / 0 major / 0 minor）。** M1–M4 与 N1–N2 的修复均可失败、可复现、且未削弱 A13「受众最先、隐私拒绝不触碰 store」；N3 已修；N4 保留为分层卫生 nit。
