# 返工复核：`l2_host_port`（review fixes `f218b00`）

- 复核者：`fix-verifier`（**新 pane、新 tab**，未参与该节点写作或修复）。全程只读源码；负控在**集成 worktree** 上按任务指定回退 `src/runtime/host-port`（保留 22 例测试），复核结束时逐字节复原。
- 复核对象：集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，分支 `refactor/harness-kernel`。
  - 开工时 HEAD `0c028bd`；复核期间另一 actor 提交了 **docs-only** 的 `6f5f5fe`（re-export 视图 + 归档 review dossiers），HEAD 变为 `6f5f5fe`。该提交**未触碰** `src/runtime/host-port` 或测试（`git show --stat 6f5f5fe` 无 host-port/测试文件）。本复核**未做任何 commit**。
  - `git diff --stat f218b00 HEAD -- src/runtime/host-port test/l2-hostport-contract.test.js` → **空**（hostport 交付物就是 `f218b00` 的内容）。
- lane 副本 `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\hostport`（分支 `refactor/hk-hostport`，基线 `d47f0ca`，untracked）：8 个源文件 + 1 个测试，与集成副本**逐个 sha256 相同**（见 §1）。lane 只读，复核后 lane `git status` 仍为 `?? src/runtime/`、`?? test/l2-hostport-contract.test.js`，sha256 不变。
- 基线原复核：`docs/evofence-harness-kernel/execution/reviews/l2_host_port-review.md`（结论：需修订；blocker 1 / major 1 / minor 1 / nit 3）。
- 契约真相源：`spec/contracts/INTERFACES.md` §5、`SCHEMAS.md`（`Binding`/`Effect`/`Receipt`）、`execution/L1-REPLAN-DECISION.md` R6。
- 未跑全量 `npm test`（按任务要求）；未碰 `.graph/`、其他 lane、`scripts/**`。

## 结论

**可接受（0 blocker / 0 major / 0 minor）** —— 原复核的 3 个必修项与 2 个 NIT 均按裁定修复，且**每项都有可复现的实测证据**；第 3 个 NIT（epoch 下界）按原复核"仅记录"的定位**未改**，与代码一致。23 条验收断言（22 例 + 自写 4 组探针）在修复版全绿，在回退版按预期变红。

---

## 1. 构建与契约测试（实测）

```
npm run build                                       # exit 0
node --test test/l2-hostport-contract.test.js
#   ℹ tests 22 / ℹ pass 22 / ℹ fail 0
```

lane ↔ 集成逐文件 sha256（9/9 相同，`test/l2-hostport-contract.test.js` 亦相同）：

```
cfd1ec8ca4a3e98917ec6fee4f763f9ecd05a47fd46f7781bc8de827acc22f6a  src/runtime/host-port/capabilities.ts
2da095fefbd50e93dd3127f1dafa38e3c06a77de7543c8f61ff0a33c0555a16f  src/runtime/host-port/grant.ts
bf4b67c032c6583d7be69077ffdcd291fc2e5f8fb90b4c99c50ecc8baa27391b  src/runtime/host-port/host-fake.ts
0566d1707ba055b32e8c04c81d3874d9254021b8e801707baea9b88f70fd0209  src/runtime/host-port/index.ts
72f13314b2aea2e6be9a84ef44cd7ff7f86be0de3dc89277af8ef13d6db1efe9  src/runtime/host-port/replay.ts
65a5b6ddad9ce9ff0f7f31291bed61d7aab10bfe610212defff5694516f03e0a  src/runtime/host-port/types.ts
0c252d6f8e0386625ee5e88c5f8c331f7b27802a2c628cb68aac68c701fca6c8  src/runtime/host-port/usage.ts
3b6ae8fea898dd16e60d5f76e573d72cef69a61ad3273c23eb6cb9aa06dd0178  src/runtime/host-port/verify.ts
ce5dbfd08bd4b661805bd1aa3ea79bb96742ee21f8521235d25b754e2b291612  test/l2-hostport-contract.test.js
```

## 2. 独立 negative control（回退源码、保留 22 例测试）

`git checkout 6e79b5e -- src/runtime/host-port` → `npm run build`（exit 0）→ `node --test test/l2-hostport-contract.test.js`：

```
ℹ tests 22 / ℹ pass 18 / ℹ fail 4
✖ R6: a multi-target cancel is never refused; unconfirmed targets keep it unknown
✖ executing a host.cancel effect carries R6 semantics, not a generic success
✖ stale receipts are archived, foreign receipts are refused
✖ replayView reports each unknown effect once
```

失败原因逐条命中**修复前的旧行为**（不是同义反复）：

| 变红用例 | 实测失败信息 |
|---|---|
| R6 多目标取消 | `AssertionError: dsh: the cancel action itself is never a capability refusal` → 旧代码返回 `EFK_CAPABILITY_UNSUPPORTED` |
| host.cancel effect 语义 | `actual 'completed' !== expected 'unknown'`（旧路径不按 R6 处置 cancel 效果） |
| stale receipts（base 断言） | `actual 'current' !== expected 'archived'`（旧 `sameBinding` 不看 `baseDigest`） |
| replayView 去重 | `actual [ 'e-dup', 'e-dup' ] !== expected [ 'e-dup' ]` |

复原：`git -c core.autocrlf=false checkout HEAD -- src/runtime/host-port` → `npm run build`（exit 0）→ `node --test` 回到 **22/22**；`git diff --stat -- src/runtime/host-port` **空**；`git status --porcelain src/runtime/host-port test/l2-hostport-contract.test.js` **空**；8 个源文件 sha256 与 §1 完全一致。

> 环境备注（如实记录，不影响结论）：集成 worktree 的 `core.autocrlf=true` 且无 `.gitattributes`。任务字面命令 `git checkout f218b00 -- src/runtime/host-port` 会把 blob（LF）smudge 成 CRLF，令工作区原始字节改变（`git` 内容判定仍相同，但裸 sha256 会与 lane 偏离）。本复核改用 `git -c core.autocrlf=false checkout HEAD -- …` 复原，使工作区**同时**满足：裸字节 = lane 原值、`git status` 干净、`git diff --stat` 为空。

## 3. 自写探针（独立于交付用例）

探针文件：`%TEMP%\l2hp-probe-verify.mjs`（4 组）与 `%TEMP%\l2hp-nit-probe.mjs`（NIT）。均从 `dist/` 加载，构造与交付用例同 schema 的 grant/binding/effect。

修复版输出：

```
P1 dsh: NOT unsupported (ok=true, code=EFK_CANCEL_UNCONFIRMED)
P1 pi:  NOT unsupported (ok=true, code=EFK_CANCEL_UNCONFIRMED)
P2 dsh delegate target: status=unknown, code=EFK_CANCEL_UNCONFIRMED, confirmation=unconfirmed
P2 control pi verified sdkAbort: status=cancelled
P2 override dsh: confirmation=native-ack, status=cancelled
P2 never-dispatched: confirmation=not-executed
P3 baseDigest: archived / epoch: archived / attemptOrdinal: archived
   attemptId: archived / graphRevision: archived / hostSessionId: archived
P4 unknowns=["e-dup","e-x"] (unique)
PROBE OK
```

- **P1（多目标 ≥2 取消）**：DSH 与 Pi 两 manifest 下 `ok=true`，错误码为 `EFK_CANCEL_UNCONFIRMED`，**均非** `EFK_CAPABILITY_UNSUPPORTED`。→ 原 blocker B1 已消除。
- **P2（未确认保持 unknown）**：`status='unknown'` + `EFK_CANCEL_UNCONFIRMED` + 目标 `confirmation='unconfirmed'`；正向对照（Pi `cancellation=verified` + `sdkAbort=verified`）→ `cancelled`；`cancelConfirmed` override → `native-ack`/`cancelled`；未派发目标 → `not-executed`。→ 符合 R6。
- **P3（换过 base 的回执）**：`verifyReceipt` 对 `baseDigest` / `epoch` / `attemptOrdinal` / `attemptId` / `graph.revision` / `hostSessionId` 任一变更均返回 `disposition='archived'`；相同 binding 为 `current`（sanity）。→ 原 major M1 已修复，且比较的是整块 `Binding`（8 字段全含，超集于 §5 的 epoch/attempt/base）。
- **P4（replayView 去重）**：3 条重复 `e-dup` + 2 条重复 `e-x` → `unknowns=["e-dup","e-x"]`，无重复、有序。→ 原 minor N1 已修复。

探针判别力（negative control）：同一探针跑回退版 `6e79b5e` 构建 → 在 P1 以 `AssertionError: dsh: multi-target cancel must not be a capability refusal`（`actual 'EFK_CAPABILITY_UNSUPPORTED'`）终止，证明探针确实能捕获旧缺陷。

## 4. NIT 处理核对（与代码一致）

| NIT | 原裁定 | `f218b00` 实际 | 与代码一致性 |
|---|---|---|---|
| module-scope 静态表 | 建议改惰性或改注释 | `capabilities.ts` 删除 `reconcileRequirements()`/`cancelRequirements()`，改为模块级字面量 `RECONCILE_REQUIREMENTS`；`toolCancellation` 经 `cancelConfirmationCapability(kind)` 在**运行期**按目标取用。`index.ts`/`types.ts`/`capabilities.ts` 注释统一为"module scope only defines static data and functions: it calls no port, constructs no backend and performs no I/O (I05)"。 | ✅ 一致。`grep -rnE "^[A-Za-z][A-Za-z0-9_]*\(" src/runtime/host-port/` **零命中**（无顶层调用）；`grep cancelRequirements\|reconcileRequirements` **零残留**；`toolCancellation` 由"仅矩阵一行"变为**实际被使用**（capabilities.ts:135）。 |
| `usageIsComplete` 注释 | 建议点明完整 S15 属 policy lane | `usage.ts` 增加 `Scope note: this is the minimal S15 check the port needs. The full S15 arithmetic (total against its components, cached/uncached split accounting) is UsageCompleteness and belongs to the policy lane — do not read this function as a complete usage validator.` | ✅ 与实现一致（函数体仍只校验 `complete` + `reasoning ≤ output`）。 |
| `epoch` 下界保留理由 | **仅记录**，不要求修 | `verify.ts:71` 仍为 `effect.binding.epoch < grant.issuedEpoch → EFK_AUTHORITY_DENIED`，**无上界、未加新注释**。 | ✅ 与代码一致，且与复核所记相同。探针实测：`epoch=3 vs issuedEpoch=5` → `EFK_AUTHORITY_DENIED`；`epoch=5` → ok；`epoch=9999` → **仍接受**（无上界）。会话当前 epoch 的权威在 `l2_state_store`/调度层，本层只做下界属设计内。 |

另：`INTERFACES.md` §5 的 stale 判据写的是 "epoch/attempt/base/fencing"。`Binding`（`SCHEMAS.md`）不含 `fencingToken`（fencing 在 `LeaseRef` 上），故整块 `Binding` 比较已覆盖 §5 在本层可判的全部字段（epoch/attempt/base，外加 session/graph），**无遗漏、无需额外改动**；仅记录该用词差异（非本轮返工缺陷）。

## 5. 副作用与边界

- `git status --porcelain`（集成）：仅本复核新增的未跟踪 review 文件（`l2_host_port-review-fix-verify.md`）；`src/**`、`test/**`、`.graph/` 无改动。**未 commit**。
- lane `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\hostport` 只读访问，状态与 sha256 均未变。
- 未跑全量 `npm test`；未运行任何写 `.graph/` 的命令。
- 已知环境事实：复核期间另一 actor 提交 `6f5f5fe`（docs-only），HEAD 前移；与本节点交付物无关。

## 遗留清单

无必修项。可选（非阻塞，供作者取舍）：

1. `INTERFACES.md` §5 用词 "fencing" 在 `Binding` 层无对应字段——若要让回执判据与文档逐词对齐，可在 §5 注明 fencing 属 lease 层；本层整块 `Binding` 比较已足够。
2. `epoch` 上界仍由调度层保证（本层只下界）；如担心下游误读，可在 `verify.ts:71` 旁加一行"上界属 state_store/调度层"的注释（原复核定为观察项，非缺陷）。
