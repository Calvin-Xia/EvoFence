# l2_kernel_verification 独立交叉复核（review-1）

日期：2026-10-02（复核会话，UTC 2026-10-01 17:18）
复核者：独立复核 pane `wG:p12`（新 tab、新 pane，未参与本节点任何写作）
复核对象：commit `4734088`（相对基线 `aca2883`），含 I01 core-boundary 纯搬迁修复 + `verification/kernel/**` 证据包
cwd：集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（只读复核；未写 `.graph`、未 commit、未改 lane）

## 结论

**可接受** — blocker 0 / major 0 / minor 1 / nit 0。

9 条必须独立核验的断言全部通过，且均以**本人实测**（非采信作者自报）为据：搬迁行为不变（12/12 移动模块非 import 内容逐字节相同、19/19 既有文件仅改 import/export 来源）、storage 导出面 46/46 不变、static-audit 真实 0 violations 且负控红→复原→绿、12 条轨迹摘要与 pre-fix 逐字节一致、门禁 build/typecheck/src:policy/dep:check=0 与 npm test 814/814/0、错误码全 ∈ 冻结 58 码、2 个变异独立复跑红→复原→绿、cp3 唯一判定入口与 DRIFT wiring 与源码相符、REPORT/DRIFT/MIGRATION 与实际提交一致。

minor 1 条为**工作树脏度观察**（非本 commit 的产物缺陷）：收工时 `git status` 除本 dossier 外另有 2 个 untracked 文档（`SESSION-005-HANDOFF.md`、`tasks/L2-kernel-verification-fix-verify.md`），均为 orchestrator/派单产物，非 lane 写入。已被复核的 commit `4734088` 本身零工作树残留：复核期间的 `run.mjs` 重跑与负控注入均已复原，`git status --porcelain verification/kernel/` 为空。

---

## 逐条判定（断言 1–9）

### 断言 1 — 修复是行为不变的搬迁：非 import 内容逐字节未变 ✅

方法：`git show aca2883:<old>` 与 `git show 4734088:<new>` 对比；剥离 import/export-from 行（含跨行块）后逐字节比较。

- 移动模块 **12/12 非 import 字节相同**：
  `contracts/identity/projection/outbox`（`src/storage/*` → `src/kernel/store/*`）与 `artifacts/{access,admit,availability,binding,consumer,identity,index,types}`（`src/storage/artifacts/*` → `src/kernel/artifacts/*`）。
- 修改既有文件 **19/19 仅 import/export 来源变化**（9 runtime/session、5 storage backend+barrel、5 artifact 测试）。抽取样本原始 diff 确认无函数体/签名/断言差异。
- `src/storage/index.ts` 的多行 `export type {…} from './contracts.js'` 块经来源归一后也逐字节相同（`relocation-verification.json` 的 `beforeDigest/afterDigest` 与我一致地落在同 31 个已存在文件上）。

实测命令：`node /tmp/rev1-bytecheck.mjs`、`/tmp/rev1-bytecheck2.mjs`、`/tmp/rev1-idx.mjs`。
输出摘要：`moved pairs byte-identical (import lines excluded): 12/12`；`modified files import-only: 19/19`；`src/storage/index.ts import/export-source-stripped identical: true`。

### 断言 2 — `src/storage/index.ts` 公共导出面不变 ✅

方法：解析基线 `aca2883:src/storage/index.ts` 的 `export {…} from` / `export type {…} from` 声明名集合（46 名），与本次 build 的 `dist/storage/index.d.ts`（46 名）及 `dist/storage/index.js` 运行期 keys（13 个值导出）逐名 diff。

实测：`node /tmp/rev1-export2.mjs`
输出摘要：`baseline declared (src): 46` / `HEAD dist d.ts: 46` / `HEAD dist runtime keys: 13`；`d.ts missing/extra vs baseline: [] []`；runtime keys 无越界；`EXPORT SURFACE (d.ts) IDENTICAL: true`。同名 46 名（含 `createMemory*`、`replay`、`storeOk` 等）来源由 storage 换到 kernel，导出面不缩不扩。

### 断言 3 — I01 静态审计真实通过 + 未加宽 allowlist + 负控 ✅

- 重跑 `node verification/kernel/static-audit.mjs`：**exit 0**，`status passed`，`violations 0`，`79 modules / 318 edges`，`parser typescript6 6.0.3`，stderr 0 字节。
- allowlist 来源：审计脚本从 `docs/evofence-harness-kernel/spec/contracts/OWNERSHIP.md` 的 ```json``` 冻结块解析。该文件在 `aca2883` 与 `4734088` 的 blob hash **均为 `000cb7ac6e8150391bcd461e55f94eff9b9c4731`（未改）**；`frozenAllowedEdges = {protocol:[protocol], kernel:[protocol,kernel], runtime:[protocol,kernel,runtime]}` 与冻结 JSON 一致，未加宽。`spec/` 与 `L1-REPLAN-DECISION.md` 整目录/整文件 baseline→HEAD diff 为空。
- **自建负控**：临时在 `src/runtime/session/types.ts` 追加 `import { storeOk as __negControl } from '../../storage/index.js'` → `static-audit.mjs` **exit 1**，`violations 1`（`rule I01, file src/runtime/session/types.ts, line 126, target src/storage/index.ts, reason "runtime may import only protocol/kernel/runtime"`）→ 用 `git cat-file blob 4734088:src/runtime/session/types.ts` 还原（blob hash 前=`b17179931d3d2a5d24a1dfae43c88add67590bb4`、后相同，byte-exact）→ 重跑**exit 0 / 0 violations**。
- 负控还原后 `git status --porcelain verification/kernel/ src/` 均无改动。

### 断言 4 — cp1/cp2 轨迹与修复前逐字节一致 ✅

- `evidence/repeatability.json` 与 `evidence/pre-fix/repeatability.json`：`cmp` 逐字节相同，两者 `sha256=fb55466caa617b70a679808f229f499f73835d03116014dc99cb906687c8fb6f`；12 条轨迹的 `run1/run2` 摘要 12/12 相同。
- 重跑 `node verification/kernel/run.mjs`（内含 build + 每条轨迹两次独立运行）：**exit 0**，stdout 12 行 `identical=true`，末行 **`cp1=passed cp2=passed cp3=passed errors=17 staticViolations=0`**。
- 重跑后对 `verification/kernel/evidence/**`（排除 pre-fix）逐文件 sha256 前后比对：**全部逐字节相同**（因此工作树未被复核动作污染）。
- 补充：pre-fix 证据自洽 —— `pre-fix/static-audit.json` 66 modules/269 edges/14 violations（全为 I01，涉及 9 个 `src/runtime/session/*.ts`，其中 11 值引用 + 3 type-only）；模块数 66→79 恰为搬迁 12 文件 + 新建 1 barrel。

### 断言 5 — 门禁与测试 ✅

本次 build 后的 `dist/` 上实测：

| 命令 | exit | 实测输出 |
|---|---|---|
| `npm run build` | 0 | tsc 无错误 |
| `npm run typecheck` | 0 | tsc --noEmit 无错误 |
| `npm run src:policy` | 0 | 191 TypeScript 文件，最大 350 行（`src/lib/pi-tool-strategy.ts`），0 JavaScript 文件 |
| `npm run dep:check` | 0 | modules 191 / edges 706 / cycles 0 / acyclic true |
| `npm test` | 0 | tests 814 / pass 814 / fail 0 / cancelled 0 / skipped 0 / todo 0 |

`npm test` 日志中实际出现 **12 条 `kernel verify …` 用例标题**（cp1×3、cp2×8、boundary×1），与 `gates/results.json` 的 `addedTestNames` 一致。

### 断言 6 — 错误矩阵与冻结码 ✅

- `evidence/error-matrix.json` **17 条**，`ERROR-MATRIX.md` **17 行**；逐 `path` 对应，code 完全一致（0 mismatch）。
- 17 条实际码去重后 **14 个**，全部 ∈ 本次 build 的 `dist/protocol` 冻结 `ERROR_CODES`（58 码）—— `codes NOT in frozen set: []`。
- 按 `ERROR-MATRIX.md` 的复现命令抽查 5 个场景（`delegation/concurrency/cancellation/budget/stale-lease/boundary-errors`），exit 0 且实测码与文档逐条一致（如 `child-scope-widening=EFK_AUTHORITY_DENIED`、`cancel-without-native-ack=EFK_CANCEL_UNCONFIRMED`、`expired-dispatch-lease=EFK_LEASE_STALE`、boundary-errors 的 7 条码全中）。`harness.error()` 运行期也断言 `ERROR_CODES.includes(code)`，非冻结码会在轨迹中就失败。

### 断言 7 — 变异证据非伪造 ✅

- `evidence/mutations/results.json` 7 条记录自洽：每条 `green exit 0/fail 0` → `red exit 1/fail > 0`（且输出含 `[mutation-applied:<id>]`）→ `restored exit 0/fail 0`，`diskDigestBefore === diskDigestAfter`，`fileWasModified: false`（7/7）。
- **独立复跑 2 个变异**（不经 `run-mutations.mjs`，直接用 `mutation-loader.mjs`）：`graph-completion-shadow`（`dist/kernel/graph/decide.js`）与 `budget-policy-bypass`（`dist/kernel/policy/risk.js`）——各自 green 1/1 通过、red 1/1 失败并打印 `[mutation-applied:…]` + AssertionError、restored 1/1 通过；变异只发生在 module-loader 内存态，目标 `dist` 文件 `git hash-object` 前后相同（未写磁盘源码/dist）。

### 断言 8 — cp3 语义：唯一判定入口且无影子判定 ✅

- `static-audit.mjs` 的 single-decision 规则禁用集 = `{stateFromDecision, matchingOutgoing, evaluatePredicate, checkEnvelope, grantLease, claimNode}`；这些函数仅在 kernel 内部定义/调用。`src/runtime/session/**` 对它们的引用 **0**、`NOT WIRED` 扫描 **0**、namespace import **0**（不存在 `import *` 绕过 bindings 映射）。
- 审计断言 10 个 wiring 入口存在（`entrypoints`），我逐一 grep 复核：
  `plans.ts:44 → kernel/policy.decide`、`plans.ts:57 → scheduler.computeFrontier`、`plans.ts:65 → scheduler.dispatchRound`、`evaluation.ts:50 → graph.decide`（经第 20 行 `ports.evaluator.evaluateTask`）、`dispatch.ts:74 → session/plans.planRound`（第 49 行 `ports.host.execute`）、`service.ts:30/44 → session/project`、`project.ts:46/75 → policy.reserve/settle`、`scheduler/frontier.ts:64 → graph.evaluateReadiness`、`graph/readiness.ts:71 → graph.decide`。
- DRIFT.md 列出的 wiring 行号与源码一致；应用服务无第二套 graph/policy/scheduler 判定；`session.plans` 的过滤只做可调度性筛选，注释与实现都声明动作选择归 `graph.decide`。
- `adr_0004`（事件真相源/outbox/reconcile）导出文本确为 **proposed（待裁决）**，DRIFT 明示不代签；cp1/cp2 提供其行为证据（journal/outbox/unknown/reconcile）。

### 断言 9 — 证据包自洽 ✅

- `REPORT.md`/`DRIFT.md`/`MIGRATION.md` 的数字与实际提交一致：12 移动 + 1 新 barrel + 19 既有文件；79 modules/318 entries/0 violations；门禁 191/706/0 与 814/814/0；7 个变异。
- `evidence/gates/source-preservation.json`：`sourceFiles 194`，`before` 与 `after` 逐键相等（`before==after: true`），且我用 sha256 重算全部 `src/**` 194 个文件与记录值**逐一致**（mismatch 0、missing 0）——证明验收门禁运行不改源码。
- `evidence/command-repeatability.json`：记录的 `summaryDigest1/2 = sha256:8dcfd6e950980a36cef58903b238198cb43835c101d2ba68898f7bf0002c669f`，与我本次重跑 `run.mjs` 的完整 stdout sha256 **完全相同**；`tracePairs` 12 对磁盘摘要与磁盘文件实测一致（12/12）。
- pre-fix 证据与 post-fix 证据关系自洽（`repeatability.json` 逐字节同，`summary.json` 仅 cp3 `failed`/14 → `passed`/0 变化）。

---

## 未证明项与保留意见（如实）

1. 证据边界即作者自述：cp1/cp2 建立在 **内存 store + fake host + 序列化重启** 之上；**不证明 OS crash 耐久性、真实 Pi/DSH 双宿主闭环与真实 child lifetime/usage/activation**（归 L3），也不证明 SnapshotStore/LoggerPort 已在应用服务接线。
2. `static-audit.mjs` 自报限制（我认同）：I04/I05 非形式化；`dep:check` 的 `acyclic` 不等于冻结域边界；被动 import 无构造也算违规（本修复正是靠此发现）；任意反射/间接回调的完整 provenance 未证；`evofence/core` 发布导出闭包尚不存在。
3. 我的“非 import 内容逐字节一致”检查以剥离 import/export-from 语句为口径（与 MIGRATION 同口径）；对该口径之外是否存在语义等价但文本不同的改动，已由“修改文件仅 import 行 diff”逐一排除。
4. minor（工作树，非本 commit 产物）：复核结束时 `git status` 有 2 个 untracked 文档（`doc: SESSION-005-HANDOFF.md` 于复核期间由外部写入、`tasks/L2-kernel-verification-fix-verify.md` 为派单简报）。`verification/kernel/**` 与 `src/**` 复核后无残留改动。

## 收工一致性

- `git status --porcelain`：仅本 dossier 属于本次复核写入（外加上述 2 个 orchestrator untracked 文档）；`git status --porcelain verification/kernel/` 为空。
- 复核动作全部可逆并已复原：负控源码用 `git cat-file blob` 还原且 blob hash 一致；变异仅内存态；`run.mjs`/scenario 重跑产生的 `evidence/reproduce/**` 已删除，其余 evidence 文件 sha256 前后一致。
- 复核数字与作者报告逐项吻合；复现命令与哈希均在上文逐条给出，可独立重跑。
