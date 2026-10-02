# 独立复核：`l3_pi_session` 重定版 0.99.2（review）

> 复核者：独立 pi pane（**新 tab / 新 pane**，未参与本节点写作或 lane 执行）。只读复核；唯一写入是本 dossier。
> 依据：`docs/evofence-harness-kernel/execution/tasks/L3-pi-session-repin-verify.md`；节点合同见 `L3-pi-session-repin-brief.md`；管辖 ADR `adr_0001`、`adr_0006`。
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。
> 纪律：不写 `.graph`、不 commit、不改 lane、不改 `src/`；变异/负控只在 gitignored 的 `dist/` 内，逐字节复原并核验与 `tsc` 产物一致。

## 复核对象

- 集成提交 **`6f0ad16`**（基线 `4ef6022`），Pi 交付面 `src/hosts/pi/**`、`test/l3-pi-*.test.js`、`docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json`、`HOST-MAPPING.md` Pi 版本行。
- 复核期间另一 actor 提交 **docs-only `cef98e0`**（只改两份 verify brief 两行）；`git diff --stat 6f0ad16 HEAD -- src/hosts/pi test/l3-pi-* docs/evofence-harness-kernel/probes/pi` **为空**，故按 `6f0ad16` 的交付物核验仍然成立。
- lane 工作区 `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-pi-b`（分支 `refactor/hk-l3-pi-b`，HEAD = `4ef6022`，交付为未提交工作树）：Pi 交付面 **8/8 sha256 与集成副本相同**；lane 无 commit。
- 本机 Pi：`pi --version` = **0.99.2**；包根 `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent`。
- 本次复核未跑 `--live`，未消耗任何供应商请求；native probe 与自建变异均为本地 fixture（0 付费）。

## 结论

**需修订（blocker 0 / major 1 / minor 2 / nit 1）**

唯一必修项是断言 4：DoD② 仅记录了「早结算」1 条真实 negative control，「重入」与「context 失效」两条**未记录**。我在同一 native harness 上用 dist 变异独立构造出这两条，均能稳定变红（见 §4），说明缺口是取证遗漏、可低成本补齐，而不是不可证。其余 9 条断言全部通过，DoD① 的真实持久会话证据与门禁数字经独立复跑成立。

---

## 逐条证据

### 1）VERSION-PIN 重定版 — ✔

- `git show 6f0ad16 -- .../probes/pi/VERSION-PIN.json`：顶层 `version` `0.87.1 → 0.99.2`；新增 `repin{recordedAt,from,to,decision,reason,historicalEvidencePolicy,currentEvidence}`；**完整 0.87.1 pin 保留在 `history[0].pin`**（含 providerModel、selectedModel、files sha256、pricingSource、price）。非静默改写。
- 逐文件复核 pin 的 8 个 sha256 与**本机已安装 0.99.2** 实测一致（package.json / sdk.js / agent-session.js / model-runtime.js / extensions/types.d.ts / extensions/loader.js / session-manager.js / pi-ai openai-completions.js，8/8 命中）。
- 观察（minor-1）：顶层 `providerModel`/`selectedModel` 由 `xiaomi/mimo-v2.6-flash` 改为 `deepseek/deepseek-flash`，`repin.reason` 只解释了版本、未解释模型切换。两 provider 在本机 catalog 与 `auth.json` 中均存在，属可选而非被迫；变更已落在 `history` + 顶层字段，故不算静默改写。

### 2）对照真实的 0.99.2 extension API — ✔

对本机 `0.99.2` 的 `dist/core/extensions/types.d.ts`、`agent-session.d.ts` 逐条核对 `src/hosts/pi/**`：

- 绑定注册的事件 `session_start / session_shutdown / agent_start / context / before_provider_request / message_end / tool_call / tool_result / agent_end / agent_settled` 全部存在于 `ExtensionAPI.on()` 重载；`on()` 返回注销函数（`unload()` 逐个 `off()`）。
- `appendEntry(customType, data)` 签名一致；`ctx.sessionManager`（`ReadonlySessionManager`）含 `getSessionId/getSessionFile/getEntries`，与 `PiManager` 结构切片一致。
- `PiSession`（`sessionManager/isIdle/prompt/waitForIdle/abort`）对照 `AgentSession`：`get isIdle()`、`prompt()`、`waitForIdle()`、`abort()` 均真实存在（d.ts L383/497/598/599）。
- **`agent_before_settle` 语义核对成立**：d.ts 明写「Fired before final settlement. May append entries and ensure one next provider request」；`agent_settled` 才是「fully settled … no automatic retry, compaction, or queued continuation」。实现把 `agent_end` 当中间事件、以 `agent_settled` 为最终结算锚点，方向正确。native trace 实测印证：两次 `agent_end`（含一次 awaited）→ `boundary_continuation` → 第 3 次请求 → 最终 `agent_settled` 后才写 receipt。
- `tool_call` 的 `{block:true,reason}`、`tool_result`（含可选 `parentToolCallId`）与 0.99.2 类型一致；`capabilities.ts` 把未重验的 child/server-reasoning 保持 `unknown`，未擅改 core 矩阵。

### 3）DoD① 真实性（真实进程 + 持久 session）— ✔

- 证据：`src/hosts/pi/evidence/0992-live-trace.json`（`grade=provider-live`）与 `0992-native-trace.json`（`native-fixture`）。
- 轨迹显示：`SessionManager.create` 落盘 → 宿主真实 turn 完成 → `existing_host_session`（`sessionId 01a0fae9-…`，`file …\sessions\2026-10-02T04-40-11-….jsonl`）→ `SessionManager.open(saved)` 重开同一 disk session → `extension_session_start` 同 ID/同 file → kernel step。**非 `--no-session`、非子 CLI、非手搓 hook 事件**（走真实 `createAgentSession` + `bindExtensions`）。
- 我独立复跑（零成本）：`node test/l3-pi-native-session.test.js --probe` → **exit 0，22/22 checks = true，paidRequests=0**，含 `existingPersistentSession/realSessionUnchanged/kernelReceiptApplied/diskRestore` 等。
- kernel 侧：`0992-live-trace.json.kernel.json` → node 停在 `verifying`，`receipt.applied` = 1，`decision.recorded` = 0，`fakeHostExecutions` = 0；与 lane 声明一致。

### 4）DoD② 负控（早结算 / 重入 / context 失效）— ✖（major-1，1/3）

- 已记录：`0992-negative-controls.json` 只有 2 条，均为 **DoD① 1 条 + DoD②「早结算」1 条**。
  - DoD1：删除持久路径门禁 `manager.getSessionFile() === undefined → false`，`--memory-control` 下 `nativeMemorySessionRefused` 变红；red exit=1 / green exit=0，`binding.ts` sha `401fb5ce → 98d78189 → 401fb5ce`。
  - DoD2：`agent_end` 内直达 completed receipt，`noEarlySettlement` 变红；red exit=1 / green exit=0，sha `401fb5ce → 660d1752 → 401fb5ce`。
  - 我在 dist 内独立复现两条（`manager.getSessionFile() === undefined → false`；`active.ended = true; → …record('receipt', …, 'completed'…)`）：**red exit=1（ERR_ASSERTION at `l3-pi-native-session.test.js:149`）、复原后 green exit=0**，复原字节与 `tsc` 产物 sha256 一致。
- **缺口**：`重入`、`context 失效` 两条没有「变异→变红→复原→复绿」控制，只有正向断言（native `settledReentryRefused`、`contextAndResources`；fixture `DoD2 settlement hook reentry refuses…`、`cp3 asynchronous context resolver cannot inject after unload`）。正向断言不满足简报要求的「各有真实 negative control」。
- 为判定这是遗漏而非不可证，我在 dist 内**自建**两条控制（本地 fixture，0 付费，逐字节复原）：
  - 重入：删除 `execute()` 的 `if (!isIdle()) return err(EFK_HOST_REVISION_CONFLICT…)` → `AssertionError: settledReentryRefused` → exit 1；复原后 exit 0。
  - context 失效：在 `agent_end` 处置位 `packet = []`（切断 boundary continuation 的 node packet）→ `AssertionError: contextAndResources` → exit 1；复原后 exit 0。
  - 两条均**可复核的变异点 + 用例名**齐全，证明补齐成本仅是加进 `l3-pi-negative-controls.test.js` 的 control 列表。

### 5）P1/P2/P3/P4/P9/P17 逐项 — ✔

`VERSION-DIFFERENCES.md` 的「逐项版本重验」表逐条给出 0.99.2 结论与证据指针，我抽查对照证据文件均成立：

- P1 provider-live：live `/checks/existingPersistentSession`、`realSessionUnchanged`、`/trace/6`；同 ID、同 file。
- P2 provider-live：live `/checks/contextAndResources`（`hostContextPreserved && hostSkillPreserved && nodeContextInjected`）、`/payloads`（origin=`https://api.deepseek.com`）。
- P3 native-fixture：`blockedToolNeverExecutes=true`、`toolCalls` 有 `deny-1`、`toolResults` 仅 `echo-1`；provider-live 拒绝对照如实标 unknown。
- P4 provider-live：`toolCalls/toolResults` 同一真实 `toolCallId call_00_QmYUhe7JZ2a4hYjjHV1o5606`、同 effectId、`isError=false`。
- P9 native-disk：`diskRestore=true`、`/trace/24` 为 reopen 起点，同 receiptId 幂等读回。
- P17 provider-live + native-fixture：`noEarlySettlement/receiptAfterSettlement` + `continuation/settledReentryRefused/waitsForAsyncSettledHook`。
- 未重验项如实保留 unknown（用户 TUI / 第三方共存、provider retry/compaction、crash recovery、provider abort 计费、delegation/activation）。
- `HOST-MAPPING.md`：`git show 6f0ad16 -- HOST-MAPPING.md` 为**单行 diff**（只改 PV 行），明确「0.87.1 时代 P1–P17 为历史证据，需按 0.99.2 重验/补差，未重验项保留 unknown」；P1–P17 行仍指 0.87.1 trace，但已被 PV 行声明为历史，未冒充 0.99.2 证据。

### 6）版本拒绝门禁保留 — ✔

- 实现：`bindPiSession` 首行 `if (options.version !== PI_VERSION) return err(fail('EFK_SOURCE_PIN_DRIFT', …))`，在注册任何 handler 或触碰 SDK 前返回 typed envelope。
- `test/l3-pi-lifecycle.test.js`：用 `Proxy` 令任何 SDK 访问抛错，对 `0.87.1 / 0.99.0 / 1.0.0` 均断言 `EFK_SOURCE_PIN_DRIFT` → 证明**未触碰 SDK**、无静默降级。
- 拒绝路径族并存：in-memory/外部 ID → `EFK_HOST_SESSION_MISMATCH`；busy/reentry → `EFK_HOST_REVISION_CONFLICT`；未知 dispatch 不盲重派；unknown usage 保留 reservation。

### 7）cp2/cp3 在 0.99.2 下重新成立 — ✔

- `node --test test/l3-pi-*.test.js` 两次均 **tests 37 / pass 37 / fail 0**（第 1 次 2645ms，第 2 次 2542ms），覆盖 mapping（cp2）与 lifecycle/recovery（cp3）。
- cp2/cp3 不止 fixture：0.99.2 native trace 实测 additive context、controlled AGENTS/skill/read、允许/拒绝工具、raw↔SDK usage 对齐、disk reopen 同 ID 同 receiptId、unload 后普通 host 工作保留、native abort/断连/unknown 保留。独立复跑 §3 的 native probe 亦覆盖全部 22 项。

### 8）证据分级 / 用量记账 / 凭据 — ✔

- 分级分开标注：`0992-live-trace.json` = provider-live；`0992-native-trace.json` = native-fixture；`0992-memory-control.json` = native-fixture memory-control；unknown 在 `VERSION-DIFFERENCES`/`SUMMARY.limits` 单列。非 0.99.2 结论未借历史升级。
- 真实请求最小化并逐条记账：`paidRequests=2`，`provider-1` prompt 10841 / cache 0 / output 59 / reasoning 12；`provider-2` prompt 10916 / cache 10752 / output 104 / reasoning 99；合计 21920 tokens，参考 USD 0.003561612（明标「catalog/官方峰时参考，非 invoice」），历史 MiMo 预算未改。
- 凭据：`grep -rE 'sk-…|api[_-]?key=|Bearer …|authorization'` 在 `src/hosts/pi/**` 与 `probes/pi/**` **0 命中**；live trace 不含 prompt/工具输入正文与推理文本；凭据只经用户既有认证进内存（`readStoredCredential`），未落盘、未入库。

### 9）门禁 — ✔

我在集成 worktree 实跑：

```
npm run build      → exit 0
npm run typecheck  → exit 0
npm run src:policy → exit 0（261 files，最大 350 行，0 JS）
npm run dep:check  → exit 0（edges 1020，cycles 0，acyclic true）
node --test test/l3-pi-*.test.js → 两次：tests 37 / pass 37 / fail 0
node verification/kernel/static-audit.mjs → exit 0，violations.length = 0
```

`0992-gates.json` 记录的 8 项门禁数字与实测一致，其 `sourceHashes` 10/10 与当前文件 sha256 相同。

### 10）范围与核心边界 — ✔

- `git show --name-only 6f0ad16` 无 `src/{protocol,kernel,runtime}/**`、无 `.graph/`；Pi 交付面仅授权路径（`src/hosts/pi/**`、`test/l3-pi-*.test.js`、`probes/pi/VERSION-PIN.json`、`HOST-MAPPING.md` PV 行）。
- lane 工作区 HEAD = 基线 `4ef6022`，全部交付为 `M/??` 未提交；`integrations/pi/**` 未被触碰。
- 复核结束时 `git status --porcelain` 为空（工作树干净）；dist 变异已逐字节复原，与 `tsc` 产物 sha256 相同。

---

## 未证明项（保留 unknown，不夸大）

- 当前用户 TUI / 全部第三方扩展共存、provider 自动 retry/compaction、crash/断电恢复、provider abort 计费、server-tier high、child delegation、activation、OS sandbox、外部 effect exactly-once、收益：**均未证明**，与 lane 声明一致。
- **minor-2（取证可复现性）**：provider-live trace 由迁移前的探针产物生成（`sourceHashes` 记为 `native-session.mjs:74b6780e` / `native-support.mjs:316a7602`），后被重命名/调整为提交版 `test/l3-pi-native-session.test.js`。被审运行逻辑 `binding.ts` 自 live 取证起未变（`401fb5ce`，与当前一致），且 `types.ts` 仅类型声明变化、对运行无影响；但 live 证据无法用提交版 harness 逐字节复现，该限制已在 `VERSION-DIFFERENCES.md` / `LANE-REPORT.md` 如实披露。
- **nit-1**：`0992-memory-control.json` 是唯一不带 `sourceHashes` 的 0992 证据文件。

## 收工一致性

- `0992-SUMMARY.json` / `LANE-REPORT.md` 的 cp1/cp2/cp3、版本重验表、门禁数字、2 条请求与参考费用、未证明项，与我实测/证据文件逐项一致；无夸大。
- 复核过程只读 lane 工作区与集成 worktree；未改 `.graph`、未 commit、未 install、未发布、未留后台进程；dossier 是本轮唯一写入。
