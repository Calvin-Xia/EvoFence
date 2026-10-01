# l2_graph_model blocker-1 修复独立复验（review-fix-verify）

日期：2026-10-01 · 复核者：独立复验 pane（新 tab/新 pane，**未参与本节点任何写作**）
工作区：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（集成分支 `refactor/harness-kernel`）
被验对象：`d803b57`（`src/kernel/graph/patch.ts` 旧边集遍历 + `test/l2-graph-patch.test.js` 2 例 + `test/l2-graph-compile.test.js` namespace 期望）
被验问题：review-1（`l2_graph_model-review.md`）blocker-1 —— applyGraphPatch 的中途锁定只挡「同 edgeId 重绑」，删/改型/替换锁定节点的 `data` 边会静默丢失输入。
环境：Windows、Node v24.12.0、HEAD `d803b57`、无 commit、无改 `.graph/`、未动其它 lane。

## 结论：可接受

blocker-1 已被真实修复，非纸面修复：三条逃逸路径（drop / retype / replace）在 5 个锁定态全部被拒，在 `ready` 态仍可提交（判别性成立），负控精确命中 2 条新用例，`git diff` 对 `patch.ts` 为干净。compile 期望变更与 `L2-PROTOCOL-NOTES.md §4.2` 一致，不是掩盖回归。4 条 minor 仍如实登记。范围外另记 1 条残留观察（不阻断本结论）。

| # | 要求 | 状态 | 证据 |
|---|---|---|---|
| 1 | `npm run build`=0 且 `node --test test/l2-graph-*.test.js`=92/92 | ✅ | §1 |
| 2 | 独立负控：去旧边集遍历 → 2 条新测试变红 → 恢复 → 92/92，`patch.ts` 无 diff | ✅ | §2 |
| 3 | 自写探针：drop/retype/replace 锁定态拒、ready 态提交 | ✅ | §3 |
| 4 | compile namespace 期望变更与 §4.2 一致 | ✅ | §4 |
| 5 | 4 条 minor 仍如实登记 | ✅ | §5 |
| 6 | 未 commit、未改 `.graph/`、未动其它 lane | ✅ | §6 |

lane 副本一致性：`src/kernel/graph/patch.ts` sha256 集成副本 = lane 副本 = `2399231c…18a3fc`（1/1 请求文件一致）。

---

## 1. 构建与测试

```
$ npm run build            # tsc via node node_modules/typescript/bin/tsc
exit 0
$ node --test test/l2-graph-*.test.js
ℹ tests 92   ℹ pass 92   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
（新增两条：`mid-flight input protection — dropping a data edge by omission is refused, and commits once ready`、
  `mid-flight input protection — retyping, retargeting or replacing a data edge is refused`，均 ✔）
```

## 2. 独立负控（不采信作者自报）

以 `12ed81b`（修复前版本，review-1 记录的 90 断言基线）覆盖 `patch.ts`：

```
$ git checkout 12ed81b -- src/kernel/graph/patch.ts
$ npm run build            → exit 0
$ node --test test/l2-graph-*.test.js
✖ mid-flight input protection — dropping a data edge by omission is refused, and commits once ready
✖ mid-flight input protection — retyping, retargeting or replacing a data edge is refused
ℹ tests 92   ℹ pass 90   ℹ fail 2
```

变红集合精确等于两条新用例（无溢出），证明这两条是真载荷、且修复前的旧边集遍历缺失会被它们抓住。

恢复并复绿：

```
$ git checkout d803b57 -- src/kernel/graph/patch.ts
$ git diff --quiet -- src/kernel/graph/patch.ts   → clean（DIFFSTAT 空）
$ sha256sum src/kernel/graph/patch.ts             → 2399231c…18a3fc（与修复后一致）
$ npm run build                                   → exit 0
$ node --test test/l2-graph-*.test.js             → tests 92 / pass 92 / fail 0
```

## 3. 自写探针（独立于作者套件，直接 import `dist/`）

构造：`nG(deterministic, outputSchemas=[report])`，`nC(agent, terminal)`，`nD(agent, terminal)`；边 `e-g-c: data nG→nC`（绑定 artifact）、`e-g-d: data nG→nD`。对锁定目标 `nC` 逐态施加四类改动：

```
escape     state       result
drop       ready       COMMITTED
retype     ready       COMMITTED e-g-c
replace    ready       COMMITTED
retarget   ready       COMMITTED e-g-c
rebind     ready       COMMITTED e-g-c
--- 5 个锁定态 leased/running/verifying/unknown/cancelling ---
drop/retype/replace/retarget/rebind  →  全部 EFK_GRAPH_ACTIVE_NODE_MUTATION
```

- `drop`：完整新边集省略 `e-g-c`（锁定节点失去输入声明）；
- `retype`：`e-g-c` 由 `data` 改 `dependency`；
- `replace`：删 `e-g-c` 并换成新 edgeId `e-g-c-new` 的未绑定 data 边（review-1 的 A2 等价形态）；
- `retarget`：`e-g-c` 的 `to` 改指向；
- `rebind`（对照，原有守卫形态）：同 edgeId 换 artifact digest。

三类逃逸 + retarget 在全部 5 个锁定态被拒；同一补丁在 `ready` 态可提交 → 守卫是**判别器**而非一律拒绝。对照 `rebind` 在 locked 亦被拒、ready 提交，说明新遍历与旧守卫串接正确、无回归。

## 4. compile namespace 期望变更（对照 §4.2）

`L2-PROTOCOL-NOTES.md §4.2` 逐字：「值与冻结值不符 → `EFK_PROTOCOL_UNSUPPORTED`，缺字段/结构错 → `EFK_SCHEMA_INVALID`」。被改用例把 `namespace` 设为 `evofence.runtime/2`（**值**不符）。我方探针独立复现：

```
value-mismatch namespace      -> EFK_PROTOCOL_UNSUPPORTED
value-mismatch schemaVersion  -> EFK_PROTOCOL_UNSUPPORTED
missing schemaVersion         -> EFK_SCHEMA_INVALID
misshaped protocol            -> EFK_SCHEMA_INVALID
missing graphLimits           -> EFK_SCHEMA_INVALID
```

与 `src/protocol/codec.ts:226`（`const`/`enum` 关键字失败 → `PROTOCOL_UNSUPPORTED`，其余 → `SCHEMA_INVALID`）、`src/protocol/version.ts:53`（namespace 不符 → `unsupported`）一致。同文件的 `check 1 — a missing required field is refused` 仍断言 `EFK_SCHEMA_INVALID` 且通过。判定：**与 §4.2 一致，非掩盖回归**。

## 5. 4 条 minor 仍如实登记（核对，非要求修）

| minor | 现状核对（HEAD `d803b57`） | 仍成立 |
|---|---|---|
| minor-1 patch 入口不做 check 1 schema 半边 | `patch.ts` 仅 `decodeRuntimeVersion`，无 `decode('GraphPatch', …)`；探针：`reason:''`、未知字段 `bogus:1`、`changes` 缺 `contextPlan` 均 **COMMITTED** | ✅ |
| minor-2 `verifying→unknown` 不在冻结状态机 | `decide.ts:54-55` `case 'unknown': return 'unknown'` | ✅ |
| minor-3 `<2 类 bound` 成码与 ERRORS.md 不符 | `test/l2-graph-compile.test.js:214` 仍断言 `EFK_SCHEMA_INVALID`（ERRORS.md 该条挂在 `EFK_GRAPH_BOUND_INVALID`） | ✅ |
| minor-4 check 8 未消费 `maxConcurrentAgents` / loop `maxIterations` | `maxConcurrentAgents` 全 `src/` 仅出现在协议 schema 定义、无 graph 层消费者；`bounds.ts` 只关联 node `maxAttempts` 与 loop `maxDepth`，未把 `loop.maxIterations` 接到 `graphLimits.maxAttempts` | ✅ |

## 6. 范围外残留观察（不阻断本结论，供登记）

修复覆盖了 blocker-1 列举的 drop/retype/replace/retarget。探针另测到一条**同类但范围外**的形态：

- 在**保留**原绑定边的前提下，向锁定节点**追加**一条新的未绑定 data 边（`e-h-c: data nH→nC`）在 running 态仍 **COMMITTED**。原 blocker-1 的反例是「删+换」（现已拒）；纯追加未被原复核点名，属本轮修复范围之外，记为后续 minor/观察。
- `from` 生产者改动单独测试实际被 `EFK_ARTIFACT_BINDING_MISMATCH` 拦下（artifact 生产者与边不一致），非可逃逸路径。

以上均不影响 blocker-1 的修复判定。

## 7. 收工状态

```
$ git status --short          → 仅若干未跟踪文档（含本复核产物），无 M/D
$ git diff --stat             → 空
$ git diff --quiet -- src/kernel/graph/patch.ts → clean
$ git rev-parse --short HEAD  → d803b57
```

未 commit、未改 `.graph/`、未动其它 lane 副本；探针临时文件建在系统临时目录并已删除。
