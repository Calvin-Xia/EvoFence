# l3_dsh_session 独立复核 dossier（review）

**日期**：2026-10-02（Asia/Shanghai）
**复核者（pane）**：本会话独立 pane，未参与 `l3_dsh_session` 的写作或 lane 交付。
**复核对象**：集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，交付提交 **`6f0ad16`**（基线 `4ef6022`）。复核期间 orchestration 在其上追加了 docs-only 提交 `cef98e0`（只改两份 verify 简报，把目标 commit 钉为 `6f0ad16`），工作树最终干净。
**交付面（DSH）**：`src/hosts/dsh/**` 7 文件 / 726 行（新建）；`test/l3-dsh-fixtures.test.js` + `test/l3-dsh-session.test.js`（169+279 行，21 个行为用例 + 1 个 0 用例 fixture 文件）；`integrations/deepseek-harness/{index.js,package.json,README.md,L3-DSH-REPORT.md,evidence/**}`（`cordis.patch.yml` 无 diff）。
**lane 工作区（仅 sha256 比对，不写）**：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-dsh`，branch `refactor/hk-l3-dsh`，HEAD `4ef6022`（lane 基线）；`git status` 仅未跟踪/未提交的 `src/hosts/dsh/`、`test/l3-dsh-*`、`integrations/deepseek-harness/{index.js,package.json,README.md,L3-DSH-REPORT.md,evidence/}`——**未 commit、未碰 `.graph`**。
**节点合同**：plan = 把已验证 Cordis lifecycle / tool policy·result / session projections / usage / 用户交互接到 runtime，注册原生操作与状态视图，沿用现有 session/model/tools/context，**不以只读 ledger tool 或 `evofence run` 子 CLI 为实现**；cp1 事件与会话身份 / cp2 context·tool·usage 映射 / cp3 恢复·卸载·异常；管辖 ADR `adr_0001`、`adr_0006`。节点当前 `running`（graph 只读观察，未写 `.graph`）。

> 说明：`6f0ad16` 是 **Pi re-pin 与 DSH 两条 lane 的合并提交**（60 文件）。本 dossier 只裁定 **DSH 交付面**；`src/hosts/pi/**`、`test/l3-pi-*`、`probes/pi/VERSION-PIN.json` 及 `spec/contracts/HOST-MAPPING.md` 的 PV 行属 Pi lane（另一份复验简报），不计入本判定。

---

## 结论：**可接受**

**blocker 0 · major 0 · minor 0 · nit 5**（nit 见「未证明项与保留意见」，均不改变判定）。
11 条断言逐条通过；门禁与两次测试由复核者亲自复跑；DoD①/DoD② 负控以**独立机制**（改 `dist/` 而非 `src/`）重做 4/4 真红真绿；5 个自建探针全绿。

---

## 逐条判定

### ① 非只读、非子 CLI：真实 HostPort 绑定 —— 通过

- `src/hosts/dsh/port.ts:11` `createDshHost` 实现 `HostPort` 全部六个方法 `observe/execute/cancel/reconcile/context/usage`（契约 `src/runtime/host-port/types.ts:232`，本 lane 未改 core：`git diff 4ef6022 6f0ad16 -- src/protocol src/kernel src/runtime` 为空）。
- **对照旧实现**（`git show 4ef6022:integrations/deepseek-harness/index.js`）：旧入口是 `evofence_verify_ledger` / `evofence_recent_runs` 两个 SQLite **只读** tool；新入口 `index.js` 只 `import { createDshBinding } from '../../dist/hosts/dsh/index.js'`，`inject = ['tools','agents','sessionProjections','evofenceRuntime']`，`apply` 返回 `createDshBinding(ctx, ctx.evofenceRuntime)`——不含 `Ledger`/`sqlite`/`better-sqlite3`。
- 对 `src/hosts/dsh` + `integrations/deepseek-harness/index.js` grep `child_process|spawn|execSync|sqlite|evofence run|dist/cli`：**无命中**（唯一 `readArtifact` 是 kernel 的工件读取 port，不是 ledger）。
- 沿用宿主 session/model/tools/context：`session.agent.followup`、`session.agent.options.{model,maxTokens}`、`ctx.tools.execute`、`agent/pre-step` 追加 `helpers.message`、`ctx.sessionProjections.register`、`ctx.on('session/event',...)`——全是宿主原生对象，无第二 scheduler、无第二 session。
- 失败面 fail-closed：`host.delegate`/`host.activate`/`fresh` context 显式 `EFK_CAPABILITY_UNSUPPORTED`；非绑定 kind 显式拒绝。

### ② DoD①：持续 DSH 会话中建立/继续/恢复**同一** EvoFence session —— 通过

- 实现：`binding.attach` 要求 `request.sessionId === agent.id === agent.session.id` 且 `ctx.agents.get(agent.id) === agent`（同 ID 仿造拒绝）；`source==='resume'` 走 `runtime.open(request)` 重建**同一 journal**，`binding.hostSessionId` 冻结为 `null`、不重写 receipt binding。
- 作者用例 `DoD1: same native session continues and resumes the same kernel journal without model replay`（真 Cordis/AgentLoop/session/persistence + native `ctx.agents.resume`）绿。
- **自建探针 P1（作者套件之外）**：普通原生长跑 1 次 → `f.restore()`（native resume）后 `f.requests.length` 不变（**resume 不发模型请求**）、`binding.session(id).agent === resumed`、`binding.status(id).sessionId === id`、`dispatchMode==='paused'`（reopen 需重新准入）、journal 只多 1 条 disposal-pause 事件；显式 manifest `resume` 后 `epoch===2`，再 `step` 恰好 1 次预留请求且**全部请求 sessionId 恒为核心 seed**，节点进入 `verifying`。实测 `requests=2 epoch=2`。

### ③ DoD②：钩子失效/卸载/runtime 错误 ⇒ 保留普通宿主工作、停止未确认晋升 —— 通过

- 实现：`health.ts` 的 `stopEvolution` 写 `fault` 并 `pauseJournal`；`pauseJournal` 失败保留 `pauseError`、本地拒绝继续；`unexpected` 只保留 stage + typed 错误码，**丢弃外来异常文本**（防凭据/提示词外泄）。`binding.dispose()`（Cordis 卸载）对每个会话 pause + 置 `disposed`。
- 覆盖用例（作者，均绿）：observation hook 抛错、移除 `agent/pre-step`、移除 `session/event`、移除 `tools/result`、`fiber.dispose()` 真实卸载、runtime `step` 抛错、`pause` 端口抛错。
- **自建探针 P4（独立注入点）**：让 `composition.onObservation` 在 `tools/result` 上抛含 `review-secret-should-not-leak` 的异常 → `status.health==='degraded'`、`dispatchMode==='paused'`、`unknownEffectIds.length===1`、`evaluate` 被拒、`JSON.stringify(status)` **不含**该 secret，随后普通 followup 仍发 1 次请求且 agent 回 `idle`。

### ④ DoD③ 版本落地：0.2.0-rc.2 精确升级 + 决定记录 —— 通过

- `integrations/deepseek-harness/package.json` diff（`git show 6f0ad16`）：`engines.dsh: 0.1.7-rc.1 → 0.2.0-rc.2`、`peerDependencies["@deepseek-ai/dsh-tools"]: 0.1.7-rc.1 → 0.2.0-rc.2`，`description` 从 "Read-only EvoFence ledger tools" 改为 native checkout composition；包版本/Node 声明/`evofence@0.4.2` 依赖保留。
- 本机实测：`probes/dsh/VERSION-PIN.json /observedVersion = 0.2.0-rc.2`（`/pinSatisfied true`）；实测安装 `@deepseek-ai/dsh 0.2.0-rc.2`（`C:\Users\Calvin-Xia\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`），fixture 装载时断言 `installation.version === '0.2.0-rc.2'`。
- 决定记录：`evidence/version-decision.json`（`decision:"A"`、declared/observed 均 0.2.0-rc.2、`compatibleWithDeclaredExactVersions:true`、`profileInstallCompatibility:"unknown"`）、`README.md`（"The user selected version decision A…"）、`L3-DSH-REPORT.md`；`binding.ts` 运行时 `if (composition.version !== '0.2.0-rc.2') throw`（用例 `boundary: …wrong version` 断言 `/exact version/`）。
- 旧 0.1.7 的 Profile 安装证据显式降为历史，未迁移。

### ⑤ D1–D9/D17 逐项重验或保留 unknown；13 项 unknown 不得冒充已验证 —— 通过

- 复核者重跑原探针（lane 的 `revalidate-native` 把 writer 重定向到 `evidence/native-revalidation/`）：新产物 `recordedAt 2026-10-02T04:57:27Z` ≠ 原 `2026-10-01T10:58:45Z`，是**真实重跑**；`probeSha256`/`supportSha256` 记录原始哈希。
- 逐键比对原 `probes/dsh/offline-trace.json` 与新 `native-revalidation/offline-trace.json`：**39 checks 键完全相同**，`true 38 / non-true 1`（`teamMessageDurable=false`）一致；`capabilityStatusCounts = {absent:0, partial:1, unknown:13, verified:15}` 完全一致；`errors:[]`、`requests 6`、`receipts 6`、`modelCalls 6`、`trace 130` 一致。
- 13 项 unknown **逐项同一**：`teamMessageDelivery, parentChildCancellation, toolCancellation, diskCrashRecovery, osSandbox, externalEffectReconciliation, reasoningHighGuarantee, costInvoice, providerCancelBilling, existingIntegrationCompatibility, grantWriteScopeEnforcement, skillsPluginCoexistence, sessionCustomEntries`；`teamWaitAndInterrupt` 仍 partial。**升级未把任何 unknown 升格为 verified**，报告表格逐项如实（D10/D13/D14/D15/D18/D19/D20… 全部保留 unknown）。
- 报告引用的 JSON Pointer 抽样复核为真：`/checks/nativeSessionCreated`、`/checks/additiveNodeContext`、`/checks/toolGateAndResults`、`/checks/usagePreserved`、`/checks/failureUsageNotZeroInvented`、`/checks/nativeResumeWithMemoryPersistence`、`/checks/providerFailureIdle`、`/toolResults`（原 callId/sessionId/isError/frozen exec）。
- D16 收口口径与裁决 A 一致：`version-decision.json` 只对**静态声明相等**作新鲜检查，并显式写 `profileInstallCompatibility:"unknown"` 与 `historicalProbeCaveat`（原 support 脚本把 `integrationGap.compatibleWithDeclaredExactVersions` 写死为 false，不被当作新结论）。新入口在 native fixture 内**真实 import 并 `apply`**（见下「集成入口被真实执行」）。

### ⑥ cp2 usage：按 invocation 去重、缺 usage 不归零；context/tool hooks 映射正确 —— 通过

- 实现：`mapping.nativeUsage` 缺计数保持 `null`、`complete=false`；`invocationUsage` 用 `[session.agent.id, event.seq]` 派生稳定 invocation id 并 `dedupeUsage`；`reservedUsage` 仅在 `rows.length===1 && reservationRef!=null` 时回填，否则回 `[]`（未知而非 0）；`port.receipt` 对多 invocation 走 `EFK_USAGE_INCOMPLETE` 并暂停，不挤进一个 reservation。
- 实现：`agent/pre-step` 追加已授权 context packet（保留宿主 instructions/tools），**第二个隐式 loop step 在请求前 `reject`**；`tools/pre-execute` 走 `composition.allowTool`（保留宿主既有 denial），`tools/result` 观测 isError。
- 作者用例绿：`cp2 additiv…`、`cp2 actual tool gate…`、`cp2 usage deduplicated…`、`cp2 failed native model request…`、`cp2 native multi-step cannot spend an unreserved implicit request`、`cp2 committed tool effect traverses the actual native policy`。
- **自建探针 P2**：同 invocation 重复事件 → 1 行；`nativeUsage('m', undefined,…)` → `total/output=null, complete=false`；同 invocation 冲突计数 → `EFK_USAGE_CONFLICT`；不同 seq → 2 行保留。

### ⑦ A15 单裁决：原生 board 只作投影，board owner ⊆ kernel claim —— 通过

- 核心判定 `verifyBoardAuthority`（`src/runtime/host-port/verify.ts:116`）：任一 board owner 找不到 `(nodeId,attemptId,ownerClaimId)` 对应的 kernel claim → `EFK_HOST_BOARD_AUTHORITY_CONFLICT`；成功返回 `ok([])`，binding 用 `judged.ok ? ok(owners) : judged` 保留真实 owners。
- `mapping.nativeBoard` 只读 `team/task` 事件；owner 必须 `boardLinks.get(taskId).ownerSessionId === task.ownerId`，否则冲突。binding **从不创建/获取** board owner（`projectBoard` 只登记投影并立即校验）。
- 作者用例绿：`A15 actual native board claim with no kernel mapping refuses`、`A15 board owner is accepted only as projection of an actual current kernel claim`。
- **自建探针 P3（构造分歧）**：P3a 无映射 owner → step 直接 `EFK_HOST_BOARD_AUTHORITY_CONFLICT`、**0 次模型请求**、journal 暂停；P3b/c 先 `planOnly` 得到 kernel claim，投影 `ownerSessionId='not-the-owner'` → 拒绝；投影精确 owner → `observe().boardOwners` 恰为该 claim 且 `every(o => kernelClaims.includes(o.ownerClaimId))`（owners=1 / claims=1）。

### ⑧ cp3：恢复/卸载/异常路径可复现；无法覆盖项明确 `unsupported/unknown` —— 通过

- 复现路径（作者用例，绿）：native resume + 显式 manifest re-admission（`owner.agent !== resumed`、journal 不重放）；`fiber.dispose()` 真实卸载（`dispatchMode paused`、`health disposed`、`step` 拒绝、`host_echo` 仍在、`evofence_*` 已移除）；runtime `step` 抛错 → `EFK_EFFECT_UNKNOWN` + paused；`pause` 端口抛错 → `pauseError.code==='EFK_EFFECT_UNKNOWN'` 且本地拒绝继续；`resume`+`reconcile` 对 claimed unknown 不重放。
- 未覆盖项在 `L3-DSH-REPORT.md` 与探针 `limitations` 中逐项如实：delegation/fresh-child/activation/external-effect reconcile/timer 显式 unsupported；disk/crash、OS sandbox、tool cancellation、parent-child cancellation、provider cancel/billing、cost invoice、skills/plugin coexistence 等保持 unknown；跨成员 board 映射待显式 delegation。**无猜测升级**。

### ⑨ 负控：DoD① 与 DoD② 各至少一个真实 negative control —— 通过

- 作者负控（`evidence/negative-controls.mjs` → `negative-controls.json`）：DoD1 变异 `binding.ts` resume 分支注入 `sessionId:'mutated-resume'`；DoD2 变异 `health.ts` 反转 active-journal pause 条件。复核者验证：两处 `before` 串在源码中**唯一**、`originalSha256` **等于集成 HEAD 文件哈希**、`originalSha256===restoredSha256`；baseline 0 → red 1 → green 0。
- **复核者独立负控（改 `dist/`，不碰 `src/`）4/4 真红真绿**（`/…/Temp/l3-dsh-negative-controls.sh`，每例备份→改码→跑用例→复原）：

| 变异点（dist） | 锁定用例 | baseline | RED | GREEN |
|---|---|---:|---:|---:|
| `binding.js` resume 身份注入 | `DoD1: same native session continues and resumes` | fail 0 | **fail 1** | fail 0 |
| `health.js` pause 条件反转 | `DoD2: observation hook failure durably pauses` | fail 0 | **fail 1** | fail 0 |
| `mapping.js` `complete=true`（伪造完整 usage） | `cp2: usage is deduplicated by native invocation` | fail 0 | **fail 1** | fail 0 |
| `mapping.js` board 冲突改跳过 | `A15: an actual native board claim with no kernel mapping` | fail 0 | **fail 1** | fail 0 |

复原后 `dist` 变异串已归零，22/22 复绿；随后 `npm run build` 重新生成 `dist`，工作树 `git status` 为空。

### ⑩ 门禁 —— 通过（复核者亲自复跑，均为本次 build 的 `dist/`）

| 命令 | exit | 实测 |
|---|---:|---|
| `npm run build` | 0 | `tsc` 成功、重新生成 `dist/**` |
| `npm run typecheck` | 0 | 0 errors |
| `npm run src:policy` | 0 | 261 TS 文件；最大 350 行（`src/lib/pi-tool-strategy.ts`）；0 JS |
| `npm run dep:check` | 0 | modules 261 / edges 1020 / cycles 0 / acyclic true |
| `node --test test/l3-dsh-*.test.js`（第 1 次） | 0 | tests 22 / pass 22 / fail 0 / skipped 0 |
| 同命令（第 2 次） | 0 | tests 22 / pass 22 / fail 0 / skipped 0 |
| `node verification/kernel/static-audit.mjs` | 0 | status passed / moduleCount 88 / edgeCount 358 / violations **0** |
| `git diff --exit-code -- src/protocol src/kernel src/runtime` | 0 | core 未被污染（相对 `6f0ad16`、相对 `4ef6022` 均空） |

- 22 = **21 个行为用例 + 1 个 0 用例 fixture 文件**（Node 把无注册测试的文件计 1 项），与报告口径一致。
- `evidence/static-audit.json` 与复核者本次 fresh 运行的输出 **sha256 逐字节相同**（`d1bbb6587dd80f17e29501c3d8bb12c6056629e8ad1b1bc37c8e5372cf0b582e`），证明 lane 门禁证据非陈旧。

### ⑪ 范围与核心边界 —— 通过

- 相对 `4ef6022`，`src/{protocol,kernel,runtime}/**` diff 为空；`src/hosts/dsh/**` 全为新增；HostPort 契约（`src/runtime/host-port/types.ts`）未私改 → 无 drift。
- 变更文件全部落在授权面内：`src/hosts/dsh/**`、`test/l3-dsh-*.test.js`、`integrations/deepseek-harness/{index.js,package.json,README.md,L3-DSH-REPORT.md,evidence/**}`（`cordis.patch.yml` 无 diff）。lane `verify-lane.mjs` 的 scope 正则校验通过。
- 凭据/保密：对 DSH 交付面 grep `sk-…|api[_-]?key|authorization:|bearer …|ghp_…|AKIA…` 与 `process.env|DSH_HOME` → **无命中**；`unexpected` 只保留 stage+错误码；探针 CLI 只保留 semver、`stderrSuppressed`；无付费请求（`providerLive:false`、`paidRequests:0`、`credentialsRead:false`、`budgetMutated:false`），未改共享 `MODEL-BUDGET.json`。
- 未 commit、未 install、未操作 `.graph`（lane `git status` 为未提交变更；`.graph` 仅复核者只读观察）。

---

## sha256 比对（lane ↔ 集成 `6f0ad16`，26/26 MATCH）

以 `sha256sum "$LANE/<f>"` 对 `git cat-file blob 6f0ad16:<f>`。**23 个逐字节相等**；`package.json`、`README.md`、`cordis.patch.yml` 因 lane 工作树 CRLF（`core.autocrlf=true`）在去 `\r` 后相等（CRLF 陷阱已按简报提示规避）。关键面：

| 文件 | sha256（LF） |
|---|---|
| `src/hosts/dsh/types.ts` | `37416db6abe18c16ebcc70336c0d033cc64d33f8d0a7617be92c0501f653d514` |
| `src/hosts/dsh/port.ts` | `ae1fe5d62283d7491a355c81e122c77f3c45e6f1be87cad86aadbf3c31f3868e` |
| `src/hosts/dsh/binding.ts` | `506febdcf28519c7998b0aecda7a02f5bab41c6b0d915230175937c6fded98cf` |
| `src/hosts/dsh/mapping.ts` | `74cbfdfebfc6168df015909a3dfa4c78b58180a1094cb999ad15f4964df85479` |
| `src/hosts/dsh/health.ts` | `e7a404be29c5c0b04d8097d3b7e0a2a4221cf6eab4fd9e67869e7e47657e390d` |
| `src/hosts/dsh/controls.ts` | `e0ce51216833c87858e5042d78b776b8715230b4ba215c3b9d48a7b513355589` |
| `src/hosts/dsh/index.ts` | `3f63dc2f330f0c67118722fe131574646450859a2a7a88c0709d425df4405636` |
| `test/l3-dsh-fixtures.test.js` | `05949188ed188a97013c935e34e15a16e3bba1aaa5ebbae6faca6a67900036db` |
| `test/l3-dsh-session.test.js` | `16a863bc7c9c4687684becf14cafb8c1abb112b9606760a39cc1767134503f75` |
| `integrations/deepseek-harness/index.js` | `fde8ab545242bd3a02310a5def417154e991f1de2f295c9cc2d705ad4700872b` |
| `integrations/deepseek-harness/package.json` | `a3b86795fafdefa5d0234727c001c7f0ba263e5a651138ddcbe5d72d2a06f741` |
| `integrations/deepseek-harness/README.md` | `56283145d79891bdbcc08558e466d59b211365d734e74d1d325a7d028b09bd69` |
| `integrations/deepseek-harness/L3-DSH-REPORT.md` | `056aa9546436fe11124a76841cfa36a93792c8a331a48fd7dbfab76fdc29184f` |
| `evidence/gates.json` | `fa83824a36c7d7ed0051f02bfc04d8c9caa6a13f5f0c00638b6f91dca488c379` |
| `evidence/version-decision.json` | `42ec89936742edfa99e5e4116bc00dd5c2ab37a111c620564aa2f8a49e0be3b0` |
| `evidence/negative-controls.json` | `74415985fe56ee90fcae7281849a9b89e907c25d3bfdd7636b3eb4f3fb35c63e` |
| `evidence/native-revalidation/offline-trace.json` | `2ad5151f3508040e65bd8310299545c3e382a93975e4d4acc8f5ac9a26c810b3` |

（其余 `evidence/**` 9 个文件同样 MATCH，此处从略。）

## 独立探针与负控结果

- **集成入口被真实执行**：`test/l3-dsh-fixtures.test.js` `import * as plugin from '../integrations/deepseek-harness/index.js'`，并以包装 `apply(owner)` 调 `plugin.apply(facade)`——即被测对象是真实集成入口，不是绕过。
- 自建探针（`/…/Temp/l3-dsh-independent-probe.mjs`，只 import 本次 `dist/` 与真实 native fixture）：**P1 DoD1 身份/继续/恢复、P2 usage 去重与不归零、P3a/P3b-c A15 board 分歧、P4 DoD2 独立注入点故障** = **5/5 通过**；首轮两处失败均为探针自身缺陷（缺 `composition.usageSource`、在已消费的 round 上重复 `planOnly`），修探针后全绿，产品行为未改。
- 自建负控（改 `dist/`）：**4/4 真红真绿**（见 ⑨）。作者负控 2/2 经独立核验（变异点唯一、原哈希匹配、复原一致）。

---

## 未证明项与保留意见

以下为 nit（记录性，不阻断）：

1. **证据级别是 native-fixture + fault-injection，不是 provider-live**。真实运行的是 Cordis/AgentLoop/ToolRuntime/session projections/team board/native create·resume；LLM adapter 与 native persistence 是内存 fixture。DoD① 的"真实会话"= 真实原生 session 生命周期 + 合成模型；未发任何供应商请求（`providerLive:false`、付费 0）。报告与探针均如实标注，**不得外推为供应商/账单/GUI 结论**。
2. **`spec/contracts/HOST-MAPPING.md` 的 D16 行仍是冻结的旧文案**（"旧 peer/engines 0.1.7-rc.1 与 0.2.0-rc.2 不符"，指向 `probes/dsh/VERSION-PIN.json /integrationGap`，后者被原 support 脚本写死 false）。升级声明已在 `package.json` + `version-decision.json` 落地，D16 行未随之更新（该 export 视图的改动属 Pi lane 的 PV 行，非本 lane）。建议后续由持有图者 re-export 时同步；`existingIntegrationCompatibility` 状态仍为 unknown，仅备注过时。
3. **`nativeBoard` 要求本会话 transcript 中每个有 owner 的 `team/task` 都映射到 kernel claim**，含 teammate 拥有的任务；跨成员映射按报告所述待显式 delegation 实现，当前会 fail-closed 成 `EFK_HOST_BOARD_AUTHORITY_CONFLICT`（从严，非漏洞）。
4. **`host.agent` 的 `turn/end reason=completed` 且无任何 `assistant/message|attempt` 事件的边界**：此时 `nativeId=null` 而 receipt 可能记 `completed`、usage 空。正常路径由 `preSteps===1` 与事件覆盖检查兜底，作者套件未单独断言该退化组合，复核者亦未复现；仅记为未覆盖边界。
5. **`version-decision.json` 只覆盖静态声明相等**（`profileInstallCompatibility:"unknown"`），未安装/未验证新 Version 0.2.0-rc.2 的 Profile/发行包组合；属 packaging lane 范围。

**如实转述的未证明项（与本节点交付一致）**：13 项 unknown（D10/D13/D14/D15/D16/D18/D19/D20/D21/D22/D24/D26/D27）与 D23 partial 全部保留；delegation/fresh-child/activation/external-effect reconcile/timer 显式 unsupported；disk/crash、OS sandbox、tool cancellation、provider cancel/billing 未经真实磁盘或供应商验证。lane 未声称这些为已验证。

---

## 收工一致性

- **写入**：仅本 dossier `docs/evofence-harness-kernel/execution/reviews/l3_dsh_session-review.md`。临时探针/负控脚本与备份均在系统临时目录（`%TEMP%`），不在仓库内；负控只改 `dist/`（gitignored），复原后 `npm run build` 重生成并复绿。未写 `.graph`、未 commit、未改 lane、未改 core/spec。
- **测试/审计数字**：`npm run build|typecheck|src:policy|dep:check` = 0/0/0/0（261/350/0、261/1020/0）；`node --test test/l3-dsh-*.test.js` 两次均 **22/22**、fail 0、skipped 0；`static-audit` = passed、0 violations（88/358），且 `evidence/static-audit.json` 与本次 fresh 输出 sha256 相同；自建探针 **5/5**；自建负控 **4/4** 真红真绿；lane↔集成 **26/26** sha256 MATCH（3 个 CRLF 归一）。
- **工作树最终状态**：`git status --porcelain` 为空；`HEAD = cef98e0`（在目标 `6f0ad16` 之上仅两份 verify 简报的 docs-only 变更）。
