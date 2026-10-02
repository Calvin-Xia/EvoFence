# 返工复核（fix-verify）：`l3_pi_session` 重定版 0.99.2（补证 `cf58120`）

> 复核者：独立 pi pane（**新 tab / 新 pane**，未参与本节点写作、lane 执行或前一轮复核）。只读复核；唯一写入是本 dossier。
> 依据：`docs/evofence-harness-kernel/execution/tasks/L3-pi-session-repin-fix-verify.md`。
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（分支 `refactor/harness-kernel`）。
> 纪律：不写 `.graph`、不 commit、不改 lane、不改 `src/`；变异只在 gitignored 的 `dist/`，逐字节复原并与 fresh `tsc` 产物比对；负控尝试全部零付费。

## 复核对象

- 原复核 dossier：`docs/evofence-harness-kernel/execution/reviews/l3_pi_session-review.md`（结论 **需修订**，blocker 0 / major 1 / minor 2 / nit 1；针对原提交 `6f0ad16`）。
- 补证提交：**`cf58120`**（`cf581207ee851f349a1eb3306308f7d212b8e658`，父链 `6f0ad16 → cef98e0 → 9a3ba64 → cf58120`）。
  - `cf58120` 自身 `git show --name-only` = **27 文件，全部落在 `src/hosts/pi/**`（25）与 `test/l3-pi-negative-controls.test.js` / `test/l3-pi-gates.test.js`（2）**；无 `src/{protocol,kernel,runtime}`、无 `.graph/`、无 `integrations/`。
  - `git diff --name-only 6f0ad16 cf58120` 另含 `cef98e0`（docs-only：两份 L3 verify brief）与 `9a3ba64`（docs-only：`execution/reviews/l3_dsh_session-review.md` + 图导出视图 `docs/evofence-harness-kernel/DECISIONS.md`）——与简报预期的「补证并入后可再有 docs-only commit」一致，无 `.graph/`。
- lane 工作区 `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-pi-b`（分支 `refactor/hk-l3-pi-b`，HEAD = 基线 `4ef6022`，交付为未提交工作树）：`src/hosts/pi/**` 全部 45 个文件 + 两份 `test/l3-pi-*.test.js` **逐个 sha256 与集成相同**；`docs/.../probes/pi/VERSION-PIN.json`、`docs/.../spec/contracts/HOST-MAPPING.md` 亦相同（47/47）。lane 只读，复核后未改动。
- 本机：`pi --version` = **0.99.2**；Node v24.12.0。
- 复核期间 HEAD 恒为 `cf58120`，未前移；`git status --porcelain` 仅有 2 个未跟踪 docs（原复核 dossier + 本简报）。

## 结论

**可接受（0 blocker / 0 major / 0 minor）**

原 major-1（DoD② 的「重入」「context/资源失效」两条只有正向断言、无真实 negative control）已闭环：两条控制**真实存在**、各有独立 red/green 轨迹、断言名与变异点齐备，且我在 `dist/` 内用**自建变异**独立复现「真红」。minor-1 已记录依据、minor-2 保留披露未升级、nit-1 已带 `sourceHashes`。门禁、测试、static-audit 全部通过；范围与零新增付费成立；未证明项未被补证升级。

---

## 逐条证据

### 断言 1｜两条新 negative control 真实存在且非镜像实现 — ✔

`src/hosts/pi/evidence/0992-negative-controls.json` 现含 **4 条**控制（DoD① 一条 + DoD② 三条），`cf58120` 新增两条：

| id | check | 变异点（`from` → `to`） | 变异后行为路径 |
|---|---|---|---|
| `dod2-reentry` | `settledReentryRefused` | `if (!isIdle()) return err(fail('EFK_HOST_REVISION_CONFLICT', 'Pi session is busy; dispatch only at an external safe point'));` → 删除 | 删除 `execute()` 的忙线门禁，真实 native `agent_settled` handler 中的第二个 effect 不再被拒 |
| `dod2-context` | `contextAndResources` | `active.ended = true;` → `active.ended = true; packet = [];` | 在 `agent_end` 清空 node context packet，真实 boundary continuation 的第 3 条请求丢 node 注入 |

**非镜像**：两条落在**不同函数/不同检查**上（`execute` 的忙线门禁 vs `agent_end` 的 context packet）；与既有 `dod2`（早写 completed receipt，check `noEarlySettlement`）虽共用 `active.ended = true;` 落点，但替换串与断言名均不同，语义互异。每条 `from` 在 `binding.ts` 中**唯一**（负控脚本断言 `split(from).length === 2`；我离线复核 `active.ended = true;` 与忙线门禁各 1 处命中）。

**独立变异（在 `dist/hosts/pi/binding.js` 内自建，gitignored，零付费，逐字节复原）**：

| 自建变异 | 命中数 | exit | 首个 false check | stderr 断言 |
|---|---|---|---|---|
| A：删除 `execute` 忙线门禁（作者同点） | 1 | **1** | `settledReentryRefused` | `AssertionError: settledReentryRefused` |
| A'：忙线门禁条件改 `if (0 === 1)`（独立写法） | 1 | **1** | `settledReentryRefused` | `AssertionError: settledReentryRefused` |
| B：`active.ended = true;` → `…; packet = [];`（作者同点） | 1 | **1** | `contextAndResources` | `AssertionError: contextAndResources` |
| B'：context hook 返回去掉 `...packet`（独立路径） | 1 | **1** | `contextAndResources` | `AssertionError: contextAndResources` |

两条检查均可被真实变红，且**首个**失败断言与声明一致。

> 过程如实记录：A/A' 首轮用 TS 源码的单行 `if (!isIdle()) return …` 作为 `from` 在 `dist` 中 0 命中——`tsc` 输出把该守卫折成两行；改为编译后字面量后 1 命中并变红。这是 `tsc` 排版差异，不影响结论（负控脚本本身对 `src/` 做变异并重新 `build`，不依赖该排版）。

### 断言 2｜红/绿可复现、逐字节复原、与 fresh `tsc` 一致 — ✔

- `0992-negative-controls.json` 四条控制逐条记录：`originalSha256` = `restoredSha256` = **`401fb5ce46258074d25af30c313f5d95c91395e0c2be2c6031aa738201482672`**（当前 `src/hosts/pi/binding.ts` 实测同值）；`red.exit = 1`、`green.exit = 0`；`redTrace`/`greenTrace` 独立成对。
- 我按声明重建变异并比对：`dod1→98d78189…`、`dod2→660d1752…`、`dod2-reentry→4d03406e…`、`dod2-context→3b1c3309…`，**与 4 条 `mutatedSha256` 逐一相同**。
- red 轨迹内 `sourceHashes[src/hosts/pi/binding.ts]` = 声明变异哈希（证明探测确实跑在变异源码上）；green 轨迹内同项 = 复原哈希。red/green 均 `grade=native-fixture`、`paidRequests=0`。
- 用例名齐全：red stderr 分别含 `AssertionError: settledReentryRefused` / `AssertionError: contextAndResources`；脚本额外断言 `red.checks[check] === false`、`green.checks[check] === true`、`red.red.stderr.includes(assertion)`。
- 我自己的复原验证：四次 `dist` 变异后逐字节回写，末态 `dist/hosts/pi/binding.js` sha256 = `393af72949a438861281f7956b9c63414e1e7ce7799020bc6242d9d324a5a749`；`npm run build` 后 fresh `tsc` 产物同哈希（**复原后与 fresh tsc 产物 sha256 相同**）。复原后跑 `node test/l3-pi-native-session.test.js --probe` → **exit 0，22/22 checks = true，paidRequests=0**。

### 断言 3｜无回归：门禁 + 测试双跑 + static-audit — ✔

在集成 worktree 本次 `build` 的 `dist/` 上实跑：

```
npm run build        → exit 0
npm run typecheck    → exit 0
npm run src:policy   → exit 0（261 TypeScript files，largest 350 lines，0 JavaScript）
npm run dep:check    → exit 0（modules 261 / edges 1020 / cycles 0 / acyclic true）
node --test test/l3-pi-*.test.js   ×2  → 均 tests 37 / pass 37 / fail 0（2742ms / 2562ms）
node verification/kernel/static-audit.mjs → exit 0，violations.length = 0
```

- VERSION-PIN 重定版保留：顶层 `version = 0.99.2`；`repin.from = 0.87.1`；`history[0].pin.version = 0.87.1`（含历史 providerModel / 8 个文件 sha256 / price）；`providerModel = deepseek/deepseek-flash`。`VERSION-PIN.json`、`HOST-MAPPING.md` 在 `6f0ad16..cf58120` 内**零改动**（`git diff --name-only` 为空）。
- 非 0.99.2 typed 拒绝仍在：`binding.ts` 首行 `if (options.version !== PI_VERSION) return err(fail('EFK_SOURCE_PIN_DRIFT', …))`；`test/l3-pi-lifecycle.test.js` 用 `Proxy` 令任何 SDK 访问抛错，对 `0.87.1 / 0.99.0 / 1.0.0` 断言 `EFK_SOURCE_PIN_DRIFT`——该用例在 37/37 内通过。
- 生产代码未动：`binding.ts / types.ts / usage.ts / entries.ts / capabilities.ts / index.ts` 在 `6f0ad16..cf58120` 内**零改动**；本轮是纯取证/测试补强。

### 断言 4｜minor/nit 收口如实 — ✔

- **minor-1（模型选择依据）已记录**：`VERSION-DIFFERENCES.md` 新增「模型选择单独依据 SESSION-006-HANDOFF §1.3 …用户已裁决 deepseek/deepseek-flash high、无美元硬上限且逐请求记账…SDK 版本重定与模型选择是两项分别记录的决定」；`LANE-REPORT.md` 与 `0992-SUMMARY.json.fix1.minor1` 同口径。核对 `SESSION-006-HANDOFF.md` 第 12 行（§1 第 3 条）确为该裁决，引用准确。
- **minor-2（provider-live trace 无法用提交版 harness 逐字节复现）保留披露、未被静默升级**：`VERSION-DIFFERENCES.md` 明写 `native-session.mjs:74b6780e…` / `native-support.mjs:316a7602…` 的历史探针哈希无法由当前 `test/l3-pi-*.test.js` 逐字节复现，「运行绑定哈希不变只支持实现一致，不能消除探针差异」；`0992-live-trace.json`、`0992-native-trace.json` 在 delta 内**零改动**（历史产物原貌保留）。
- **nit-1 已修**：`0992-memory-control.json` 现携带 **7 条 `sourceHashes`**（binding/types/usage/entries/capabilities + 两份测试），逐条与当前文件 sha256 相同；`nativeMemorySessionRefused/extensionErrorsEmpty = true`、`paidRequests = 0`。

### 断言 5｜范围与成本 — ✔

- `git show --stat cf58120`：27 文件，全部在授权路径内；`grep -c '^\.graph'` on `6f0ad16..cf58120` = 0；`cf58120` 内 `src/{protocol,kernel,runtime}` 命中 0；`integrations/pi/**` 未触碰。
- **新增付费请求 0 有证据**：四条新控制 red/green 轨迹 `grade=native-fixture`、`paidRequests=0`；`0992-negative-controls.json` 的 command argv 内 `--live` **0 次**；`0992-memory-control.json` `paidRequests=0`；`0992-SUMMARY.json.usage` 段落（`paidRequests: 2`、`totalTokens: 21920`、`estimatedUsd: 0.003561612`、`historicalMimoBudgetChanged: false`）在 delta 内**逐字段未变**。我本轮全部探测为本地 fixture / dist 变异，付费 0。

### 断言 6｜证据诚实：未证明项未被升级 — ✔

对照原 dossier 的未证明项清单，补证后仍如实保留：

- `0992-SUMMARY.json.limits`：现有受控 native session ≠ 当前用户 TUI/全部第三方扩展；kernel 两请求才是 provider-live；非 crash recovery；「provider abort 计费、server-tier high、child delegation、activation、OS sandbox、capability uplift」仍未证明。
- `VERSION-DIFFERENCES.md`：用户 TUI/第三方共存、provider retry/compaction、第三方异步 actions 标 `unknown`；供应商 abort 计费、server-tier high、delegation、activation、OS sandbox、外部 effect exactly-once、收益均记为未证明；P8/P12/P14/P15/P20 不借历史升级。
- `LANE-REPORT.md`：明确列出 provider abort 计费、server-tier high、delegation、activation、OS sandbox、外部 effect exactly-once、收益仍未知；两条新控制 grade 均为 `native-fixture`，未冒充 provider-live。
- 每条轨迹自带的 `limitations` 数组（4 条）未因补证被删或升级。

---

## 观察（非阻塞，供作者/后续审阅取舍）

1. **`0992-gates.json` 的 stdout 计数来自 lane 环境**：`npm run src:policy` 记录 `254 TypeScript file(s)`、`dep:check` 记录 `modules: 254 / edges: 989`；集成 worktree 同一命令为 `261 / 1020`（集成 HEAD 已并入其它 lane 的 src 模块）。四条门禁在两边 `exit=0`；`sourceHashes` 12/12 与集成文件 sha256 相同（交付面 lane ≡ 集成）。该文件是 lane 侧取证，计数差异属环境事实（前轮复核的「数字与实测一致」说法规避了文件计数），不影响本轮结论，仅提示读者不要按计数逐字对齐。
2. **轨迹 JSON 内 `payloads` 是「累计日志」，而 `checks.*` 为运行中途计算**：如 `0992-dod2-context-green.json` 的 `checks.contextAndResources = true`，但文件里 5 条 payload 有 2 条 `nodeContextInjected=false`——那 2 条来自 kernel 步骤结束后的 ordinary-host/abort 阶段，不在该 check 的判定窗口内。red 轨迹里判定窗口内的第 3 条 payload 才是 `false`。这是探测既有的取证形状（`0992-dod2-green.json` 同样如此），非本轮引入；已用自建变异证明该 check 对「丢 node context」确有判别力，但**不能仅靠轨迹的 `payloads` 字段重算该 check**，建议在 `VERSION-DIFFERENCES.md` 注明判定窗口。

## 未证明项（保留 unknown，不夸大）

与 lane 声明一致，本轮补证未改变：当前用户 TUI / 全部第三方扩展共存、provider 自动 retry/compaction、crash/断电恢复、provider abort 计费、server-tier high、child delegation、activation、OS sandbox、外部 effect exactly-once、收益——**均未证明**。另：provider-live 历史 trace 的可复现性限制（minor-2）保留为限制，不因补证消除。

## 收工一致性

- `0992-SUMMARY.json`（含新增 `fix1` 段与 4 条 `negativeControls`）、`LANE-REPORT.md`、`VERSION-DIFFERENCES.md` 的声明与本轮实测逐条一致，无夸大：major-1 标 `evidence-complete`（DoD① 1 条 / DoD② 3 条）、`additionalPaidRequests: 0`、minor-1 `explained`、minor-2 `preserved-unproved`、nit-1 `rerun-with-source-hashes`。
- 复原后 `dist` 与 fresh `tsc` 一致；`git status --porcelain` 仅剩 2 个未跟踪 docs（原复核 dossier + 本 fix-verify 简报）；`src/**`、`test/**`、`.graph/`、lane 工作区均未改动；未 commit、未 install、未发布、无后台进程。
- 本 dossier 是本轮唯一写入。
