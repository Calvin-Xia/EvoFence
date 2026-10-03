# EvoFence 0.3.0 实现盘点（重构前基线）

- 目标仓库：`C:\Users\Calvin-Xia\EvoFence`
- 包版本：`package.json` → `"name": "evofence"`, `"version": "0.3.0"`, `"type": "module"`, `"engines": { "node": ">=22.13.0" }`
- 入口：`"bin": { "evofence": "src/cli.js" }`，`"exports": { ".": "./src/index.js" }`
- 运行时依赖仅两个：`better-sqlite3@^12.6.2`、`yaml@^2.8.1`
- 盘点方式：全部结论来自 `read`/`grep`/`find`/`bash`（`wc -l`、`grep -n`）取证；凡无法从源码确认的条目均标 `未确认`。

> 与任务描述的差异（已核实）：任务书写「`src/` 16 文件 4419 行」，实际 `find src -name '*.js' -exec wc -l {} +` 为 **18 个文件，合计 4419 行**。行数一致，文件数不一致，以源码为准。
>
> **行号约定（v2 修订）**：本文件所有 `src/…js:NNN` 都在 2026-09-27 的第二轮修订中用 `grep -n` 逐条实测回填（第一版约 18 处为誊写估计值，已全部修正）。**请以符号名为主要锚点、行号为辅助**：符号名是稳定契约，行号随源码变动即腐。
>
> v2 修订依据：`docs/refactor-inventory-review.md`（独立交叉复核报告）的 F2–F12，以及本节末的「复核异议」记录（F1 经实测为误报）。

---

## 1. 文件清单与职责

行数由 `find src -name '*.js' -exec wc -l {} +` 取得（`src/` 下无 `.mjs`/`.ts`）。

| 路径 | 行数 | 职责（一句话） | 导出的真实符号 |
| --- | --- | --- | --- |
| `src/cli.js` | 429 | CLI 入口：命令分发、flag 解析、退出码、报告输出路径防护 | 无 `export`（顶层 `await main()`，`bin` 入口） |
| `src/index.js` | 8 | 包的公共 API 聚合出口（纯 re-export） | `initializeRepository`、`loadContract`、`loadPrivateHoldout`、`validateContract`、`runEvolution`、`Ledger`、`ledgerPath`、`checkChangedPaths`、`checkClaims`、`checkProposal`、`isAllowedPath`、`isProtectedPath`、`matchesGlob`、`assessRisk`、`collectEvidence`、`buildEvolutionReport`、`formatEvolutionReport`、`EvoFenceError` |
| `src/lib/adapter.js` | 584 | 四个 agent CLI 适配器的 argv/env 构造、token/USD 用量解析与实时预算监视 | `claudeCodeArgs`、`piArgs`、`createAdapterUsageMonitor`、`parseAdapterUsage`、`runAgentAdapter`、`adapterCommand`、`adapterModel`、`adapterAgent` |
| `src/lib/audit.js` | 345 | 单新一代的审计视图：交叉校验 ledger 链接并现场重算 git diff 哈希 | `generationDiff`、`formatGenerationDiff` |
| `src/lib/contract.js` | 106 | `.evofence/contract.yaml` 与私有 holdout 的加载与校验 | `validateContract`、`loadYamlFile`、`loadContract`、`loadPrivateHoldout`、`parseYamlText` |
| `src/lib/errors.js` | 12 | 统一错误类型与断言助手（**不含错误码常量表**） | `EvoFenceError`、`invariant` |
| `src/lib/evidence.js` | 99 | 收集 public/hard-invariant/private/objective 四类证据并落盘 artifact | `collectEvidence` |
| `src/lib/fs.js` | 68 | 规范化 JSON、sha256、路径包含断言、原子写、受限读取/删除 | `stableStringify`、`sha256`、`assertInside`、`ensureDirectory`、`writeJsonAtomic`、`writeNewFile`、`readJsonInside`、`removeInside` |
| `src/lib/git.js` | 141 | 全部 git 操作、worktree 生命周期、generation 引用与 run id 生成 | `runGit`、`gitVersionAtLeast`、`requireGitVersion`、`assertGitVersionAtLeast`、`repositoryRoot`、`headSha`、`createWorktree`、`worktreeMetadataSnapshot`、`restoreWorktreeMetadata`、`worktreeMetadataMatches`、`removeWorktree`、`changedPaths`、`changedPathsBetween`、`diffHash`、`commitCandidate`、`pinGeneration`、`setActiveGenerationRef`、`createRunId`、`openTreeCount`、`detachedWorktreeAt` |
| `src/lib/init.js` | 157 | `evofence init`：建 `.evofence/` 骨架、写 config/.gitignore/schema/ledger | `initializeRepository` |
| `src/lib/ledger.js` | 257 | SQLite ledger 的 DDL、哈希链追加、generation/state 事务、校验与导出 | `Ledger`、`ledgerPath` |
| `src/lib/pi-tool-strategy-extension.js` | 205 | pi 扩展：注册 `before_agent_start`/`tool_call`/`tool_result`/`agent_end` 钩子 + 写 sidecar 遥测 | `installPiToolStrategy`、`default`（`evoFencePiToolStrategy`） |
| `src/lib/pi-tool-strategy.js` | 276 | pi 工具策略的纯逻辑：阶段优先级、失败降级、重复调用拦截、遥测汇总 | `PI_TOOL_STRATEGY_VERSION`、`piToolStrategyGuidance`、`createPiToolStrategy`、`summarizePiToolStrategyTelemetry`、`unavailablePiToolStrategy` |
| `src/lib/policy.js` | 162 | 路径白/黑名单 glob、proposal/claims 结构校验、风险评分、能力审批 | `matchesGlob`、`isProtectedPath`、`isAllowedPath`、`checkChangedPaths`、`checkProposal`、`checkClaims`、`assessRisk`、`assessCapabilities`、`requireEvidenceConfigured` |
| `src/lib/process.js` | 241 | 子进程执行、输出限长、超时/进程树终止、**环境变量剥离** | `sanitizedEnvironment`、`canTerminateProcessTree`、`runProcess`、`runTrustedCommand`、`finalNumericLine`、`waitForClose` |
| `src/lib/report.js` | 388 | 跨 run 汇总报告（runs/generations/objective/budgets/integrity）与 Markdown 渲染 | `buildEvolutionReport`、`formatEvolutionReport` |
| `src/lib/runner.js` | 858 | 演化主循环：worktree 隔离、提案/实现两阶段、四条门禁决策、预算核算、接受与提交 | `checkFinalCandidate`、`runEvolution` |
| `src/lib/status.js` | 83 | `status` 命令的数据聚合与文本渲染 | `emptyStatus`、`buildStatus`、`formatStatus` |

证据：`src/index.js:1-8` 的 8 条 `export ... from`；其余每行的 export 符号由 `grep -rn "^export " src` 逐条核对。

### 1.1 `src/lib/runner.js` 内部结构清单（858 行，拆分前必读）

`runner.js` 是最大的模块，且**拆分时没有中间边界可盲拆**。统计：模块级 `const` 仅 2 个、内部函数 17 个 + 2 个 `export`、另有 1 个定义在 `runEvolution` 内部的闭包 `runBudgetedAdapter`。

| 行号 | 符号 | 一句话职责 |
| --- | --- | --- |
| 14 | `BUILTIN_TASK_RULES`（const） | 写进 `.evofence-task.md` 的内建规则文本（不改受保护文件、不宣称接受、补丁原子可回滚） |
| 15 | `USD_MICROS`（const） | `1_000_000`，micros 与 USD 的换算基数 |
| 17 | `loadConfig(root)` | 读并校验 `.evofence/config.yaml`（`version===1` + 4 个 adapter 条目；`pi.agent` 必须为空） |
| 33 | `parseNumericBudget(value, ceiling, name)` | CLI/参数数值预算与契约上限的比较（`INVALID_BUDGET` / `BUDGET_ABOVE_POLICY`） |
| 41 | `usdToMicros(value, rounding)` | BigInt 十进制解析 → 微美元（`floor` 记账 / `ceil` 上限格式化） |
| 65 | `usdFromMicros(value)` | 微美元 → USD 数值 |
| 69 | `taskContents({goal, iteration, baseSha, contract, previousFailure, phase})` | 渲染每轮 `.evofence-task.md`（含契约摘要快照 + phase 指令 + 失败包） |
| 106 | `publicFailurePacket(decision, details)` | 生成回灌给下一轮 agent 的失败包；`private_regressions` 一律替换为 `'failed; private oracle details withheld'` |
| 114 | `adapterEvent(result, adapter, phase, iteration)` | adapter 返回值 → `adapter.finished` 事件 payload（含 usage/tool_strategy 与 stdout/stderr 摘要） |
| 140 | `currentPolicyHashes(root)` | `{contract, holdout, config}` 三份 `sha256(stableStringify(...))`，用于 4 个漂移检查点 |
| 151 | `helperPath(filename)` | **不是通用路径工具**：只判定 `.evofence-task.md` / `.evofence-out/`（helper 文件不计入候选改动） |
| 155 | `runAdapter({...})` | 组装 `runAgentAdapter` 的入参（command/model/agent/timeout/预算余量） |
| 172 | `invokeAdapter(options, adapterRunner)` | 测试注入点：`adapterRunner` 优先，否则走 `runAdapter` |
| 177 | `checkTaskFile(contract, actualPaths, proposal, claims)` | 候选违规判定，返回 6 种 code 之一：`POLICY_VIOLATION` / `NO_CHANGE` / `UNDECLARED_CHANGE` / `CLAIMS_DIFF_MISMATCH` / `CAPABILITY_VIOLATION` / `INSUFFICIENT_EVIDENCE` |
| 194 | `recordTokenUsage(result, {...})` | token 记账 + 预算闸门：写 `budget.tokens.observed` / `budget.exhausted` / `budget.usage_unavailable` 并 throw |
| 263 | `recordCostUsage(result, {...})` | USD 记账 + 闸门：写 `budget.usd.observed` / `budget.exhausted` / `budget.cost_usage_unavailable` 并 throw |
| 339 | `checkFinalCandidate(...)`（export） | `checkTaskFile` + 证据前后 diff 哈希复检（`EVIDENCE_MODIFIED_CANDIDATE`） |
| 348 | `ensurePrivateIgnored(root)` | `git check-ignore -q` 保证私有 holdout 不入 Git |
| 354 | `removeCandidate(root, worktree, tempRoot)` | `assertInside` + `removeWorktree`（容忍 ENOENT） |
| 361 | `runEvolution({...})`（export） | 主循环与状态机（见下）；内部定义 `runBudgetedAdapter` |
| 437 | `runBudgetedAdapter({iteration, phase, ...})`（`runEvolution` 内闭包） | 每轮调用前的余量检查 → `invokeAdapter` → `adapter.finished` → 成本/token 记账 |

**`runEvolution` 的状态机（`outcome.status`）**：初始 `RUNNING`；基线不健康 → `BASELINE_UNHEALTHY`（`runner.js:497-517` 两条早退路径）；迭代内 `QUARANTINE` / `ESCALATE` 立刻终止循环；循环末尾 `RUNNING` → `ACCEPTED`（有任一 `decision==='ACCEPT'`）或 `PLATEAU`（`runner.js:831`）；墙钟到期 → `RESOURCE_EXHAUSTED`（`reason:'max_wall_clock_ms'`）。

**`catch` 折叠映射（`runner.js:836-851`）**：`['RESOURCE_EXHAUSTED','TOKEN_USAGE_UNAVAILABLE','USD_USAGE_UNAVAILABLE','PROCESS_TREE_TERMINATION_FAILED'].includes(error.code)` → `RESOURCE_EXHAUSTED`，**其余一律 `HARNESS_ERROR`**；随后 `ledger.append('run.failed', ...)` 并 **rethrow**（`cli.js` 顶层 catch 把它变成退出码 1）。拆分时必须保留「先记账 `run.failed`、再抛出」的顺序，否则报告里的失败码会丢失。

**`finally`（`runner.js:852-857`）**：清 worktree（`removeCandidate()`，吞异常）→ `assertInside(tempParent, runTempRoot)` → `rm(runTempRoot, {recursive:true, force:true})` → `ledger.close()`。这是「进程结束不残留 worktree」的唯一实现点，且**无测试锁定**（见 §9.4 复核异议）。

---

## 2. CLI 命令面

### 2.1 usage/help 文本来源

- `HELP` 常量：`src/cli.js:20`（模板字符串，含 Usage 与 Options 两段）。
- 版本号拼接：`src/cli.js:18` `const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));`，`HELP` 首行 `EvoFence ${packageJson.version} — ...`。
- 打印时机：`src/cli.js:402-403`（`main()` 本体在 `src/cli.js:400`）：无命令、`--help`、`-h`、或**任意位置**出现 `--help` → 写 stdout 并 `return`（退出码 0）。
- `--version` / `-v` → `src/cli.js:406`，输出 `packageJson.version`。
- 未知命令 → `src/cli.js:421` `USAGE` 错误，提示 `Run evofence --help for usage.`
- 注意：`HELP` 是测试断言对象（`test/spec-f1.test.mjs:1448`、`test/spec-f2.test.mjs:605`、`test/spec-f3.test.mjs:454` 均断言 help 里出现对应命令名），因此 **HELP 文本属于兼容面**。

### 2.2 通用 flag 解析器

`parseOptions(args, booleanOptions)`（`src/cli.js:44`）：

- 不以 `--` 开头 → 进 `positional`。
- `--name` 在 `booleanOptions` 中 → `options[name.replaceAll('-','_')] = true`。
- 否则视为取值选项：`--goal x` → `options.goal = 'x'`；取值为空或以 `--` 开头 → `EvoFenceError('USAGE', 'Option --x requires a value.')`（`src/cli.js:61`）。
- `-` 短选项（除 `-h`/`-v` 在 `main()` 里特判）**不被识别**，会退化成 positional。

### 2.3 逐命令清单

| 命令 | 位置参数 | 取值 flag | 布尔 flag | 用途 / 关键行为 |
| --- | --- | --- | --- | --- |
| `evofence init` | 无（`commandInit()` 完全忽略 `args`） | 无 | 无 | `initializeRepository(process.cwd())`；输出 `existing` 或 `Created: ...` 列表，并提示去改 `.evofence/contract.yaml` |
| `evofence run` | 不允许（有 positional → `USAGE`，`src/cli.js:95`） | `--goal`（必填，缺失 → `USAGE`，`src/cli.js:96`）、`--adapter`（默认 `'codex'`）、`--iterations`、`--max-wall-clock-ms` | `--allow-unisolated-agent`、`--allow-readable-holdout`、`--json` | `runEvolution({...})`；`iterations`/`maxWallClockMs` 经 `Number()` 转换；非 `--json` 时打印 `progress` 事件；结果 status 不在 `ACCEPTED`/`PLATEAU` → 退出码 1（`src/cli.js:115`） |
| `evofence proposal inspect <proposal-id>` | 恰好 2 个（`action` 必须为 `inspect`，其余 → `USAGE`） | 无（多余 `--x` 会变成第三个 positional → `USAGE`） | 无 | 从 `proposal.created` 事件里找 `payload.proposal_id`，打印 `payload.proposal`；找不到 → `PROPOSAL_NOT_FOUND`（`src/cli.js:125`） |
| `evofence evidence run <candidate-directory>` | 恰好 2 个（`action` 必须为 `run`） | 无 | 无（`--json` 也会被当作 positional → `USAGE`） | 对指定目录重跑证据检查，**总是**输出 JSON；契约里既无 hard_invariant 又无 `evidence.public_commands` → `NO_EVIDENCE_CONFIGURED`（`src/cli.js:137`）；`!all_public_passed \|\| !all_private_within_tolerance` → 退出码 1（`src/cli.js:142`） |
| `evofence gate <proposal-id>` | 恰好 1 个 | 无 | 无 | 找同 run、同 iteration 的**最后一条** `gate.decision`；找不到 proposal → `PROPOSAL_NOT_FOUND`，找不到决策 → `GATE_DECISION_NOT_FOUND`（`src/cli.js:156`） |
| `evofence ledger <action> [value]` | `action` ∈ {`show`,`verify`,`recent`,`export`}；多余 → `USAGE` | `value` 含义随 action 变化（见下） | 无 | `show`/`verify`/`recent` 以 `readOnly: true` 打开 ledger（`src/cli.js:165`） |
| ├ `ledger show [run-id]` | 可选 run-id | — | — | `ledger.events(value)`，打印完整事件（**含 payload**，即含 prompt/命令/证据输出） |
| ├ `ledger verify` | 无 | — | — | `ledger.verify()`；`!result.valid` → 退出码 1（`src/cli.js:171`） |
| ├ `ledger recent [limit]` | 可选 limit，默认 10 | — | — | `ledger.recentRuns(limit)`；limit 非 1..20 整数 → `INVALID_RUN_LIMIT`（`src/lib/ledger.js:145`） |
| └ `ledger export [file]` | 可选输出路径，默认 `.evofence/experiment-<YYYY-MM-DD>.json` | — | — | `writeFile(output, ..., { flag: 'wx', mode: 0o600 })`；已存在则 **EEXIST 直接失败**；打印相对 root 的路径 |
| `evofence rollback <generation-id>` | 恰好 1 个 | 无 | 无 | 先 `ledger.verify()`，失败 → `LEDGER_CORRUPT`；再 `ledger.rollback()` + `setActiveGenerationRef()`；**不改主工作树**（stdout 明示） |
| `evofence diff <generation-id>` | 恰好 1 个（`src/cli.js:363`） | 无 | `--json` | `generationDiff()` → `printJson` 或 `formatGenerationDiff()`；其他 `--flag` → `USAGE` |
| `evofence experiment run <experiment.yaml>` | 恰好 2 个 | manifest 内字段：`goal_file`（必填，`INVALID_EXPERIMENT`）、`adapter`、`iterations`、`max_wall_clock_ms`、`allow_unisolated_agent`、`allow_readable_holdout` | 无（多余 `rest` → `USAGE`） | 总是输出 JSON；非 `ACCEPTED`/`PLATEAU` → 退出码 1（`src/cli.js:397`） |
| `evofence experiment export [file]` | 可选路径 | — | — | 直接委托 `commandLedger(['export', value].filter(Boolean))`（`src/cli.js:379`；`.filter(Boolean)` 使无参时回退到默认文件名） |
| `evofence report [file]` | 最多 1 个 | 无 | `--json` | 默认 Markdown 到 stdout；给路径则写文件（`mkdir -p` + `mode 0o600`）并打印相对路径；写了文件路径先做 `assertReportOutputOutsideState` 防护 |
| `evofence status` | 不允许（`src/cli.js:203`） | 无 | `--json` | 无 ledger 文件 / 0 字节 / 无 EvoFence 表 → `emptyStatus()`；打不开 → `LEDGER_UNAVAILABLE`；`!integrity.valid` → 退出码 1（`src/cli.js:230`） |

### 2.4 值得注意的解析行为（重构易踩）

1. **`run` 静默忽略未知取值 flag**：`parseOptions` 会把任意 `--foo bar` 收进 `options.foo`，而 `commandRun` 只读 `goal/adapter/iterations/max_wall_clock_ms`，其余不校验、不报错（`src/cli.js:93-110`）。`status`/`report`/`diff` 则会显式拒绝未知 flag（`src/cli.js:202`、`339`、`363`）。
2. **`ledger verify --json` 合法但忽略 `--json`**：`const [action, value, ...rest] = args` 把 `--json` 收进 `value`，而 `verify` 分支不使用 `value`（`src/cli.js:162-179`）。
3. **`evidence run` 无任何 flag 支持**，输出恒为 JSON。
4. `main()` 的 `args.includes('--help')` 判定发生在命令分发**之前**，因此 `evofence run --help` 打印 HELP 而不执行 run。

---

## 3. 退出码与错误码

### 3.1 退出码（全集：只有 0 和 1）

`grep -rn "process.exitCode\|process.exit(" src` 结果：**没有任何 `process.exit(...)`**，只有 6 处 `process.exitCode = 1`（`src/cli.js:115,142,171,230,397,428`）。因此进程退出码只有 `0`（默认）与 `1`。

| 退出码 | 触发条件 | 证据 |
| --- | --- | --- |
| `0` | 所有成功路径（含 `ledger verify` 合法、`status` 完整性通过） | 默认行为 |
| `1` | 顶层 catch：**任何**抛出的值 —— `catch (error)` 不做类型判断，非 `EvoFenceError` 也会经 `printError` 后置 1（仅无 `code` 时少打印 `[CODE] ` 前缀） | `src/cli.js:426-428` |
| `1` | `run` / `experiment run` 结果 status ∉ {`ACCEPTED`,`PLATEAU`} | `src/cli.js:115`、`397` |
| `1` | `evidence run`：`!all_public_passed \|\| !all_private_within_tolerance` | `src/cli.js:142` |
| `1` | `ledger verify`：`!result.valid` | `src/cli.js:171` |
| `1` | `status`：`!status.integrity.valid` | `src/cli.js:230` |

补充：非零退出时错误文本写入 stderr，格式 `[CODE] message`；仅当 `EVOFENCE_DEBUG` 为真时附打印 `error.details`（`printError`，`src/cli.js:72-76`）。

### 3.2 错误码定义文件

**不存在集中错误码常量表。** `src/lib/errors.js` 只定义：

- `class EvoFenceError extends Error { constructor(code, message, details) }`（`this.name = 'EvoFenceError'`、`this.code = code`、`this.details = details`）
- `function invariant(condition, code, message, details)`（`condition` 为假则抛出）

所有错误码都是**调用点上的字符串字面量**（202 处 `new EvoFenceError(` / `invariant(` 调用，分布见下）。这是重构的首要风险之一（见 §10）。

调用点分布（`grep -cE "(new EvoFenceError|invariant\()"`）：`runner.js 37`、`contract.js 33`、`audit.js 31`、`cli.js 28`、`policy.js 26`、`adapter.js 14`、`git.js 10`、`fs.js 7`、`init.js 7`、`ledger.js 5`、`errors.js 2`、`evidence.js 1`、`process.js 1`；`report.js`/`status.js`/`pi-tool-strategy*.js` 为 0。

### 3.3 错误码全表（值 = 源码字面量）

**Ledger / 审计**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `LEDGER_CORRUPT` | 哈希链断（`rollback`/`runEvolution`/`generationDiff` 前置校验）；audit.js 中所有链接歧义/缺失/不一致判定 | `src/lib/audit.js`（**30 处**，38–273 行）、`src/cli.js:240`、`src/lib/runner.js:406` |
| `LEDGER_READ_ONLY` | 以 `readOnly: true` 打开的 Ledger 上调 `append`/`recordGeneration`/`rollback` | `src/lib/ledger.js:100,105,118` |
| `LEDGER_UNAVAILABLE` | `status` 打不开 ledger 文件，或读取失败且非「完全无 schema」 | `src/cli.js:215,221` |
| `INVALID_RUN_LIMIT` | `recentRuns(limit)` 的 limit 不是 1..20 整数 | `src/lib/ledger.js:145` |
| `GENERATION_NOT_FOUND` | `rollback`/`generationDiff` 找不到 generation | `src/lib/ledger.js:76`、`src/lib/audit.js:276` |
| `PROPOSAL_NOT_FOUND` | `proposal inspect` / `gate` 找不到 `proposal.created` | `src/cli.js:125,153` |
| `GATE_DECISION_NOT_FOUND` | `gate` 找不到该 proposal 的 `gate.decision` | `src/cli.js:156` |

**Contract / Holdout**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `UNSUPPORTED_CONTRACT` | `contract_version !== 1` | `src/lib/contract.js:22` |
| `INVALID_CONTRACT` | contract 任一字段校验失败（**24 处**，含 YAML 顶层非对象） | `src/lib/contract.js:8-60` |
| `INVALID_YAML` | `parseDocument` 有 errors（含重复 key，`uniqueKeys: true`） | `src/lib/contract.js:14` |
| `UNSAFE_POLICY_FILE` | 策略文件不是普通文件或本身是符号链接 | `src/lib/contract.js:68` |
| `MISSING_FILE` | `loadYamlFile` 遇 ENOENT | `src/lib/contract.js:73` |
| `INVALID_HOLDOUT` | holdout 结构非法 / id 缺失 / 重复 | `src/lib/contract.js:88-94` |

**Policy / Proposal / Claims**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `INVALID_PROPOSAL` | `checkProposal` 15 条断言（iteration/base_sha/hypothesis/expected_effect 等） | `src/lib/policy.js:77-91` |
| `INVALID_CLAIMS` | `checkClaims` 9 条断言 | `src/lib/policy.js:96-104` |
| `STALE_PROPOSAL` | `proposal.iteration !== iteration` 或 `proposal.base_sha !== parentSha` | `src/lib/runner.js:579` |
| `PROPOSAL_TAMPERING` | 实现阶段后重读 proposal，摘要与 `proposalDigest` 不符 | `src/lib/runner.js:652` |
| `NO_EVIDENCE_CONFIGURED` | 既无 `hard_invariants` 也无 `evidence.public_commands` | `src/lib/policy.js:157`、`src/cli.js:137` |
| `OBJECTIVE_NOT_CONFIGURED` | `acceptance.require_objective_improvement` 为真但 `objective.command` 为空 | `src/lib/policy.js:160` |

**Config / Budget 入口**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `INVALID_CONFIG` | `config.version !== 1`；`adapters.<name>` 非对象 / command 非空串 / model、agent 类型错；`adapters.pi.agent` 被设置 | `src/lib/runner.js:19-27` |
| `INVALID_BUDGET` | `--iterations`/`--max-wall-clock-ms` 非正整数；USD 金额非有限非负 / 无法表示为十进制 / 超出 safe integer / 小于 $0.000001；`remainingTokens` 非正整数 | `src/lib/runner.js:36,43,46,60,377`、`src/lib/adapter.js:28,31,45,53,227` |
| `BUDGET_ABOVE_POLICY` | CLI 预算参数超过 contract 上限 | `src/lib/runner.js:37` |

**Adapter / 隔离接受**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `UNKNOWN_ADAPTER` | adapter 名 ∉ {codex,opencode,claude,pi} | `src/lib/adapter.js:226,530` |
| `OPEN_CODE_SANDBOX_REQUIRED` | opencode 且未 `--allow-unisolated-agent` | `src/lib/adapter.js:484` |
| `CLAUDE_SANDBOX_REQUIRED` | claude 且未 `--allow-unisolated-agent` | `src/lib/adapter.js:506`、`src/lib/runner.js:381` |
| `PI_SANDBOX_REQUIRED` | pi 且未 `--allow-unisolated-agent` | `src/lib/adapter.js:512`、`src/lib/runner.js:384` |
| `UNSUPPORTED_ADAPTER_OPTION` | pi 配了 `agent` | `src/lib/adapter.js:515` |
| `UNSUPPORTED_COST_BUDGET` | 非 claude 适配器 + USD 预算 | `src/lib/adapter.js:479,482,510`、`src/lib/runner.js:373` |
| `UNSUPPORTED_CLAUDE_TOKEN_BUDGET` | claude + `budgets.max_tokens !== null` | `src/lib/runner.js:387` |
| `UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL` | token 预算已配但本机无法终止进程树 | `src/lib/runner.js:390` |
| `UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL` | USD 预算已配但本机无法终止 Claude 进程树 | `src/lib/runner.js:393` |
| `PRIVATE_ORACLE_READABLE` | 存在 holdout 且未 `--allow-readable-holdout` | `src/lib/runner.js:368` |
| `HOLDOUT_NOT_IGNORED` | `.evofence/private/holdout.yaml` 未被 git ignore | `src/lib/runner.js:351` |

**资源 / 预算耗尽**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `RESOURCE_EXHAUSTED` | 墙钟到期（证据循环 / 主循环 / adapter 超时）；进程树终止失败；token 阈值达到；USD 估算达到 | `src/lib/runner.js:211,227,253,295,301,312,334,442,448`、`src/lib/evidence.js:32` |
| `TOKEN_USAGE_UNAVAILABLE` | adapter 未给出完整 token 用量 / 累计越界 / 中途停止 | `src/lib/runner.js:233,240,258` |
| `USD_USAGE_UNAVAILABLE` | Claude 未给出完整 USD 估算 | `src/lib/runner.js:315` |

**文件系统 / 路径防护**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `PATH_ESCAPE` | `assertInside` 目标越出受控根；init 目录越出仓库 | `src/lib/fs.js:25`、`src/lib/init.js:81` |
| `UNSAFE_ARTIFACT` | artifact 目录非普通目录 / 文件非普通文件 / 候选替换了 task 文件 | `src/lib/fs.js:49,50`、`src/lib/runner.js:620` |
| `UNSAFE_PATH` | 经符号链接删除 / init 遇到非普通文件 | `src/lib/fs.js:63,66`、`src/lib/init.js:80,87,117,127,137,148` |
| `ARTIFACT_TOO_LARGE` | artifact 超过 `maxBytes`（默认 1 MiB） | `src/lib/fs.js:51` |
| `INVALID_JSON` | `readJsonInside` 解析失败 | `src/lib/fs.js:55` |
| `PROTECTED_PATH` | `report` 输出落在 `.evofence/**`、或其硬链接/符号链接链指向 state、或符号链接嵌套超 32 层 | `src/cli.js:273,331,334` |

**Git / worktree**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `GIT_COMMAND_FAILED` | `runGit` 非零退出（含超时） | `src/lib/git.js:13` |
| `GIT_VERSION_UNSUPPORTED` | git 版本低于要求 | `src/lib/git.js:28` |
| `WORKTREE_MISMATCH` | `git worktree add` 后 realpath 与预期不一致 | `src/lib/git.js:49` |
| `WORKTREE_METADATA_CHANGED` | 候选 worktree 的 `.git` 指针不是普通文件 | `src/lib/git.js:56` |
| `WORKTREE_REMOVE_FAILED` | `git worktree remove` 失败且 stderr 不含 `not a working tree` | `src/lib/git.js:81` |
| `GIT_STAGE_FAILED` | `git add --intent-to-add` / `git add -A` 失败 | `src/lib/git.js:102,111` |
| `NO_CHANGE` | `git diff --cached --quiet` 返回 0（无暂存改动） | `src/lib/git.js:113` |
| `GIT_DIFF_FAILED` | `git diff --cached --quiet` 返回非 0/1 | `src/lib/git.js:114` |
| `GIT_COMMIT_FAILED` | 提交失败 | `src/lib/git.js:117` |

**进程 / CLI**

| 码 | 触发条件 | 位置 |
| --- | --- | --- |
| `PROCESS_START_FAILED` | `spawn` 报错 | `src/lib/process.js:181` |
| `USAGE` | 参数/子命令用法错误（共 **16 处**） | `src/cli.js:61,95,96,120,132,147,163,179,203,235,339,341,363,378,380,421`（`grep -c USAGE src/cli.js` = 16，与列表逐行一致） |
| `INVALID_EXPERIMENT` | experiment manifest 非 YAML 对象 / 缺 `goal_file` | `src/cli.js:383,384` |

**被引用但从不抛出（可疑/防御性残留）**

- `PROCESS_TREE_TERMINATION_FAILED`：仅出现在 `src/lib/runner.js:837` 的 status 归类数组里，**全仓库没有任何 throw/append 使用它**（`grep -rn PROCESS_TREE_TERMINATION_FAILED src test` 只有这一行）。实际进程树失败路径抛出的是 `RESOURCE_EXHAUSTED`。标记为 `未确认其意图`，重构时需决策保留或删除。

### 3.4 非错误码的枚举值（同一批字面量，勿混淆）

- **gate 决策**：`ACCEPT` / `REJECT` / `ESCALATE` / `QUARANTINE`（`grep -rhoE "decision: '[A-Z_]+'" src` 恰好这 4 个）。
- **run status**：`RUNNING`、`ACCEPTED`、`PLATEAU`、`BASELINE_UNHEALTHY`、`ESCALATE`、`QUARANTINE`、`RESOURCE_EXHAUSTED`、`HARNESS_ERROR`（`src/lib/runner.js:829,837` 等）。
- **gate reason**：`BASELINE_UNHEALTHY`、`BASELINE_OBJECTIVE_INVALID`、`CAPABILITY_DENIED`、`WORKTREE_METADATA_CHANGED`、`POLICY_CHANGED_DURING_PROPOSAL`、`POLICY_CHANGED_DURING_RUN`、`POLICY_CHANGED_DURING_EVALUATION`、`AGENT_TIMEOUT`、`AGENT_CRASH`、`PREMATURE_PROJECT_CHANGE`、`PROPOSAL_OBJECTIVE_MISMATCH`、`PUBLIC_TEST_FAILURE`、`HIDDEN_REGRESSION`、`OBJECTIVE_SCORE_INVALID`、`NO_PRACTICAL_IMPROVEMENT`、`CRITICAL_CHANGE_RISK`、`HIGH_CHANGE_RISK`、`ALL_REQUIRED_EVIDENCE_PASSED`、`PRECOMMIT_VALIDATION_FAILED`、`COMMITTED_CANDIDATE_MISMATCH`、`max_wall_clock_ms`。
- **proposal/claims 检查码**（进 `gate.decision.failure.code`）：`POLICY_VIOLATION`、`NO_CHANGE`、`UNDECLARED_CHANGE`、`CLAIMS_DIFF_MISMATCH`、`CAPABILITY_VIOLATION`、`INSUFFICIENT_EVIDENCE`、`EVIDENCE_MODIFIED_CANDIDATE`。
- **process / 预算 stop_reason**：`TIMEOUT`、`OUTPUT_LIMIT`、`TOKEN_BUDGET_REACHED`、`TOKEN_USAGE_UNAVAILABLE`、`OUTPUT_CALLBACK_ERROR`、`process_tree_termination_failed`、`agent_timeout`、`usage_incomplete`、`usage_total_out_of_range`、`native_usd_cap_reached_usage_unavailable`、`claude_native_usd_cap_reached`、`run_usd_estimate_limit_reached`。
- **evidence result 值**：`PASS` / `FAIL` / `TIMEOUT` / `OUTPUT_LIMIT`（`src/lib/evidence.js:9`）。

---

## 4. ledger 结构

### 4.1 建表 DDL（原文摘录，`src/lib/ledger.js:31-60`）

构造函数在非只读模式下执行 `pragma` 后 `db.exec()`（`CREATE TABLE IF NOT EXISTS`，幂等）：

```sql
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  run_id TEXT,
  payload_json TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS generations (
  generation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sha TEXT NOT NULL,
  parent_sha TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS generations_no_update BEFORE UPDATE ON generations
  BEGIN SELECT RAISE(ABORT, 'generations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS generations_no_delete BEFORE DELETE ON generations
  BEGIN SELECT RAISE(ABORT, 'generations are append-only'); END;
```

PRAGMA（`src/lib/ledger.js:28-30`）：`foreign_keys = ON`、`journal_mode = WAL`、`synchronous = FULL`。
打开参数（`src/lib/ledger.js:23-25`）：`new Database(filename, ...)`；写模式 `{ timeout: 5000 }`；只读 `{ readonly: true, fileMustExist: true, timeout: 5000 }`。
`state` 表**没有** append-only 触发器（唯一被 upsert 的表，键固定为 `'active_generation'`）。
ledger 文件路径：`ledgerPath(root) = path.join(root, '.evofence', 'ledger.sqlite')`（`src/lib/ledger.js:255`）。

### 4.2 事件类型（kind）常量全集（22 个，均为字面量，无共享常量模块）

| 事件类型 | 写入者 |
| --- | --- |
| `run.started` | `src/lib/runner.js:475` |
| `run.finished` | `src/lib/runner.js:505,515,834` |
| `run.failed` | `src/lib/runner.js:850` |
| `prompt.prepared` | `src/lib/runner.js:537,623` |
| `proposal.created` | `src/lib/runner.js:607` |
| `claims.created` | `src/lib/runner.js:666` |
| `evidence.baseline` | `src/lib/runner.js:496` |
| `evidence.candidate` | `src/lib/runner.js:715` |
| `gate.decision` | `src/lib/runner.js`（13 处：500,513,544,554,611,629,640,684,701,726,767,787,807） |
| `capability.denied` | `src/lib/runner.js:610` |
| `candidate.accepted` | `src/lib/runner.js:819` |
| `candidate.rejected` | `src/lib/runner.js:564,582,597,655,670` |
| `adapter.finished` | `src/lib/runner.js:455` |
| `budget.tokens.observed` | `src/lib/runner.js:249` |
| `budget.usd.observed` | `src/lib/runner.js:325` |
| `budget.exhausted` | `src/lib/runner.js:226,252,300,311,333,441,447` |
| `budget.usage_unavailable` | `src/lib/runner.js:232,239,257` |
| `budget.cost_usage_unavailable` | `src/lib/runner.js:314` |
| `budget.termination_failed` | `src/lib/runner.js:210`（三元式的 `maxTokens !== null` 分支） |
| `process.tree_termination_failed` | `src/lib/runner.js:210`（三元的 `maxTokens === null` 分支；`recordTokenUsage` 的早退 `return` 在 213 行，因此无 token 预算时也能写这条） |
| `generation.accepted` | `src/lib/ledger.js:70`（`recordGenerationTx` 内部，**不是 runner 直接 append**） |
| `generation.rollback` | `src/lib/ledger.js:77`（`rollbackTx` 内部） |

### 4.3 写入顺序

**单条事件**（`append` → `insertEventTx` → `#insertEvent`，`src/lib/ledger.js:99-102 / 66 / 84-97`）：准备 → 取 latest → 算哈希 → `INSERT`，全程一个 SQLite 事务。

**接受一个 generation**（`recordGeneration` → `recordGenerationTx`，`src/lib/ledger.js:104-110 / 67-73`），严格三步且同一事务：

1. `INSERT INTO generations (generation_id, run_id, sha, parent_sha, created_at)`
2. `#insertEvent('generation.accepted', generation.run_id, generation)`（payload 就是整条 generation 记录）
3. `INSERT INTO state (key, value) VALUES ('active_generation', @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value`

**回滚**（`rollback` → `rollbackTx`，`src/lib/ledger.js:117-120 / 74-83`）：`SELECT * FROM generations WHERE generation_id = ?`（无则 `GENERATION_NOT_FOUND`）→ `#insertEvent('generation.rollback', null, { generation_id, sha })` → upsert `state.active_generation`。

**一次演化 run 的事件顺序**（`src/lib/runner.js`，按行号）：

1. `run.started`（含 `contract_snapshot`、`holdout_sha256`、预算快照等）
2. `evidence.baseline`；若基线不健康 → `gate.decision`(QUARANTINE) → `run.finished` 并提前返回
3. 每个 iteration（1..limitIterations）：
   1. `prompt.prepared`(phase=proposal)
   2. adapter 调用 → `adapter.finished` → 0..n 个 `budget.*`
   3. 失败即 `candidate.rejected`；否则 `proposal.created`
   4. 能力被拒 → `capability.denied` → `gate.decision`(ESCALATE)
   5. `prompt.prepared`(phase=implementation)
   6. adapter 调用 → `adapter.finished` → 0..n 个 `budget.*`
   7. `claims.created`
   8. `candidate.rejected` 或 `gate.decision`（任一早期拒绝）
   9. `evidence.candidate`
   10. `gate.decision`（最终裁决，含 `evidence_ok`）
   11. 若 ACCEPT：`generation.accepted`（+ generations/state 事务）→ `candidate.accepted`
4. `run.finished`；异常路径 `run.failed`（`src/lib/runner.js:850`，随后 rethrow）

> 注意顺序约束：`candidate.accepted` 在 `generation.accepted` **之后**；audit.js 依赖此顺序（各链接查找函数都用 `event.seq < accepted.seq` 过滤，见 `grep -n "seq < accepted.seq" src/lib/audit.js` → 行 67, 79, 92, 155, 191, 202）。

### 4.4 哈希链算法（可据此复现）

**相关字段**：`seq`、`created_at`、`event_type`、`run_id`、`payload_json`、`previous_hash`、`event_hash`。

**常量**：`const ZERO_HASH = '0'.repeat(64);`（`src/lib/ledger.js:6`）。

**哈希函数**：`sha256(value)` = `createHash('sha256').update(value).digest('hex')`，即 64 位小写十六进制（`src/lib/fs.js:17-19`）。输入是**字符串**（不是 Buffer），按 **utf8** 编码喂给哈希（Node `update(str)` 默认 utf8）。

**规范化 JSON**：`stableStringify(value)` — 递归排序对象键（数组保序），再 `JSON.stringify`（无缩进、无空格）（`src/lib/fs.js:6-15`）。

**摘要算法**（`src/lib/ledger.js:8-16`，等价伪码）：

```js
function eventHash(event) {
  return sha256(stableStringify({
    seq: event.seq,
    created_at: event.created_at,
    event_type: event.event_type,
    run_id: event.run_id,
    payload_json: event.payload_json,
    previous_hash: event.previous_hash,
  }));
}
```

复现要点（缺一不可）：

1. **`event_hash` 本身不参与摘要**——它是输出，不是输入。
2. 参与摘要的 6 个键经 `stableStringify` 后**按字母序**排列，最终被哈希的字符串形如
   `{"created_at":"...","event_type":"...","payload_json":"...","previous_hash":"...","run_id":null,"seq":1}`
   （即 `created_at, event_type, payload_json, previous_hash, run_id, seq`）。
3. `payload_json` 参与哈希的是**字符串本身**（已有的规范化 JSON 文本），不是被解析后的值。
4. 追加逻辑（`src/lib/ledger.js:84-96` 的 `#insertEvent`）：`seq = (latest?.seq ?? 0) + 1`；`created_at = new Date().toISOString()`；`run_id = runId ?? null`；`payload_json = stableStringify(payload)`；`previous_hash = latest?.event_hash ?? ZERO_HASH`；`event_hash = eventHash(event)`。
5. `event_hash` 有 `UNIQUE` 约束；`seq` 是 `INTEGER PRIMARY KEY`（= rowid，自增语义由代码显式赋值保证）。
6. `payload_json` 在 eventHash 前**不再重新序列化**（`INSERT ... VALUES (@seq, ...)` 直接写字符串）。

**复现边界（非 JS 实现者必踩——复核报告 §6 的 3 条）**：

- `stableStringify` 等价于「JS `JSON.stringify` 的默认语义 + 递归键排序」：值为 `undefined` 的键**被丢弃**（数组元素 `undefined` → `null`）；非 ASCII（中文/emoji）**不转义**，按 utf8 原样输出；数字用 ECMAScript `Number::toString`（例：`1e21` 存为 `"1e+21"`）。
- 喂给 `sha256` 的是 **utf8 字节**，不是 hex、不是 Buffer 字面量。
- `created_at` 的格式由 `new Date().toISOString()` 保证（毫秒精度、UTC、尾缀 `Z`）；它参与摘要，因此格式变化即断链。

**校验函数**：`Ledger.verify()`（`src/lib/ledger.js:218-232`）：

```js
const rows = this.db.prepare('SELECT * FROM events ORDER BY seq').all();
let previous = ZERO_HASH;
for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  if (row.seq !== index + 1 || row.previous_hash !== previous || eventHash(row) !== row.event_hash) {
    return { valid: false, sequence: row.seq, expected_previous_hash: previous, observed_hash: row.event_hash };
  }
  previous = row.event_hash;
}
return { valid: true, events: rows.length, head: previous };
```

损坏判定（三选一即判失败，返回**首个**失败行）：

- **序号连续性**：`row.seq !== index + 1`（删除/插入/跳号）。
- **链接关系**：`row.previous_hash !== previous`（前驱被改或重排）。
- **内容自洽**：`eventHash(row) !== row.event_hash`（该行任一入哈希字段被改）。

返回结构两种形态：`{ valid: false, sequence, expected_previous_hash, observed_hash }` 或 `{ valid: true, events, head }`。`verify()` **不解析 `payload_json`**，因此 payload 改写一定会被哈希发现。链中不存在签名/密钥，`README.md:124` 明确「不是防篡改证明」。

**关联读一致性**：`readSnapshot()`（`src/lib/ledger.js:234-243`）用 `db.transaction()` 包住 `verify()` + `events()` + `generations()`，保证三者在同一 ledger 状态下读出；`buildEvolutionReport` 消费它（`src/lib/report.js:286`）。

**其他读取/导出 API**：`events(runId)`、`recentRuns(limit=10)`、`schemaTables()`、`activeGeneration()`、`generation(id)`、`generations()`、`export()`（`{ schema_version: 1, integrity, active_generation, generations, events }`，`src/lib/ledger.js:245-248`）、`close()`。

---

## 5. config 契约

有 **4 类 YAML 输入**，解析入口有 2 个。

### 5.1 解析与校验函数

| 文件 | 解析函数 | 校验函数 |
| --- | --- | --- |
| `.evofence/contract.yaml` | `loadYamlFile` → `parseYaml`（`uniqueKeys: true`, `schema: 'core'`） | `validateContract`（`src/lib/contract.js:21`） |
| `.evofence/private/holdout.yaml` | 同上 | 内联于 `loadPrivateHoldout`（`src/lib/contract.js:84`） |
| `.evofence/config.yaml` | 同上 | `loadConfig`（`src/lib/runner.js:17`，**未导出**） |
| experiment manifest（`experiment run <file>`） | `parseYamlText`（`src/lib/contract.js:104`） | 内联于 `commandExperiment`（`src/cli.js:383-384`） |

`loadYamlFile(filename, root = dirname(filename))`（`src/lib/contract.js:64`）对每个策略文件强制：`lstat` 必须是普通文件且非符号链接（`UNSAFE_POLICY_FILE`）→ `realpath` 后 `assertInside(root, ...)`（`PATH_ESCAPE`）→ 读文本 → `parseYaml`；ENOENT → `MISSING_FILE`。

### 5.2 `.evofence/contract.yaml`（字段 / 类型 / 代码默认 / 模板值 / 校验）

**先读这条语义（复核报告 F3，重构最容易改错的一点）**：`validateContract`（`src/lib/contract.js:21-61`）里**只有 2 处 `??` 代码默认**——`src/lib/contract.js:43` 的 `per_command_timeout_ms ?? 120000` 与 `:45` 的 `max_output_bytes ?? 1_048_576`（实测：`grep -c '??' src/lib/contract.js` = **2**）。**其余全部字段都是硬 `invariant`：字段缺失（`undefined`）直接 `INVALID_CONTRACT`，代码里没有任何兜底。**`templates/contract.yaml` 只是 `init` 写下的初始值，**不是默认值**——重构若「顺手加代码默认值」，就把 fail-closed 静默变成 fail-open。

「模板值」列 = `templates/contract.yaml` 的当前内容（`init` 会复制到 `.evofence/contract.yaml`）；它**不参与任何运行时兜底**。

| 字段 | 类型 | 代码默认 | 模板值（无兜底，缺失即 `INVALID_CONTRACT`） | 校验规则（失败码） |
| --- | --- | --- | --- | --- |
| `contract_version` | int | **无** | `1` | 必须 `=== 1`（`UNSUPPORTED_CONTRACT`） |
| `objective` | object | **无** | 模板有该键 | 必须是 object（`INVALID_CONTRACT`） |
| `objective.name` | string | **无** | `project_improvement` | 非空（trim 后） |
| `objective.command` | string | **无** | `""` | 必须是 string（可为空；为空表示无 objective 命令） |
| `objective.direction` | enum | **无** | `maximize` | ∈ {`maximize`,`minimize`} |
| `objective.min_delta` | number | **无** | `0.01` | 有限且 `>= 0` |
| `hard_invariants` | array | **无** | `[]` | 必须是数组；每项 `{id, command}`，id/command 非空，id 唯一 |
| `allowed_evolution_surface` | string[] | **无** | `["**/*"]` | 元素全为 string；**空数组 = 全部允许**（`isAllowedPath` 特判） |
| `protected_paths` | string[] | **无** | 12 条（`.evofence/**`、`.git/**`、`test/**`、`tests/**`、`**/*.test.*`、`**/*.spec.*`、`package.json`、`package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`、`bun.lock*`、`.github/workflows/**`） | 元素全为 string；与 `BUILTIN_PROTECTED`（19 条）合并 |
| `evidence` | object | **无** | 模板有该键 | 必须是 object |
| `evidence.public_commands` | string[] | **无** | `[]` | 元素全为 string |
| `evidence.per_command_timeout_ms` | int | **有**：`?? 120000`（`contract.js:43`） | `120000` | 整数，`100 ≤ x ≤ 86_400_000` |
| `evidence.max_output_bytes` | int | **有**：`?? 1_048_576`（`contract.js:45`） | `1048576` | 整数，`1024 ≤ x ≤ 100_000_000` |
| `acceptance` | object | **无** | 模板有该键 | 必须是 object |
| `acceptance.require_rollback_point` | bool | **无** | `true` | **必须 `=== true`**（不可关） |
| `acceptance.hidden_regression_tolerance` | int | **无** | `0` | 整数 `>= 0` |
| `acceptance.require_objective_improvement` | bool | **无** | `true` | `validateContract` 不校验；由 `requireEvidenceConfigured`（`policy.js:159`）读取 |
| `acceptance.require_proposal` | bool | **无** | `true` | **模板有、代码零引用（死键，见下）** |
| `acceptance.require_claims` | bool | **无** | `true` | **模板有、代码零引用（死键，见下）** |
| `capabilities` | object | **无** | 模板有该键 | 必须是 object |
| `capabilities.authority_ceiling` | enum | **无** | `A2` | ∈ {`A0`,`A1`,`A2`,`A3`}；**`A4` 不接受**（`INVALID_CONTRACT`）；**仅校验、从不参与运行时决策**（全仓库只出现在 `contract.js:53`） |
| `capabilities.network` | 任意 | **无** | `deny` | 不校验；仅透传进 task 文件（`taskContents`，`runner.js:76`）；不阻止任何行为 |
| `capabilities.dependency_install` | 任意 | **无** | `deny` | 同上（`runner.js:77`） |
| `capabilities.credentials` | 任意 | **无** | `deny` | 同上（`runner.js:78`） |
| `capabilities.external_api` | 任意 | **无** | `deny` | **真实生效的能力门**：`assessCapabilities` 用 `contract.capabilities[capability]`（`policy.js:148`）动态查表，proposal 请求 `external_api` 时即按此值裁决；但**不**透传进 task 文件 |
| `capabilities.<name>`（能力审批通用形状） | 任意 | **无** | — | 未配置 = 拒绝；`assessCapabilities`：`configured === true \|\| configured === 'allow' \|\| configured?.mode === 'allow'` |
| `capabilities.shell.mode` | string | **无** | `evidence_commands_only` | **模板有、代码零引用（死键，见下）**；不校验 |
| `budgets.max_iterations` | int | **无** | `20` | `>= 1` 整数 |
| `budgets.max_wall_clock_ms` | int | **无** | `3600000` | `>= 1` 整数 |
| `budgets.max_failed_candidates` | int | **无** | `5` | `>= 1` 整数 |
| `budgets.max_consecutive_no_improvement` | int | **无** | `3` | `>= 1` 整数 |
| `budgets.max_tokens` | int \| null | **无** | `null` | `null` 或正整数 safe integer |
| `budgets.max_usd` | number \| null | **无** | `null` | `null` 或正有限数 |

未在表中列出的键**不报错**（`validateContract` 无 `additionalProperties: false` 语义），YAML 顶层必须是对象否则 `INVALID_CONTRACT`。

**死键与半死键清单（复核报告 F4）** —— 逐条用 `grep -rn "<key>" src --include=*.js` 实测：

| 键 | 状态 | 证据 |
| --- | --- | --- |
| `acceptance.require_proposal` | **死键**：模板有、代码零引用 | `grep -rn "require_proposal" src` → 0（仅出现在模板与 `runner.test.js` 的 fixture 文本中） |
| `acceptance.require_claims` | **死键**：同上 | `grep -rn "require_claims" src` → 0 |
| `capabilities.shell.mode` | **死键**：模板有、代码零引用 | `grep -rn "shell\.mode" src` → 0；`grep -rn "shell:evidence_commands_only" src` → 仅 `runner.js:186`，那是**硬编码**的内建能力名集合（`builtInCapabilities`），并非读取 contract 字段 |
| `capabilities.authority_ceiling` | **半死键**：被 `invariant` 校验（A0–A3），但从不参与任何决策 | `grep -rn "authority_ceiling" src` → 仅 `contract.js:53` |
| `capabilities.network` / `dependency_install` / `credentials` | **半死键**：只写进 task 文件的契约摘要，不阻止任何行为 | `grep -rn "capabilities.network\|..." src` → 仅 `runner.js:76-78`（`taskContents`） |
| `capabilities.external_api` | **活键（动态）**：`src` 中无字面量，但 `policy.js:148` 的 `contract.capabilities[capability]` 会在 proposal 请求它时生效 | `grep -rn "external_api" src` → 0；`grep -rn "capabilities\[capability\]" src` → `policy.js:148` |

> 重构含义：删 `require_proposal`/`require_claims`/`shell.mode` 是安全的（需同步模板）；但**不能**删 `external_api`（它经动态查表生效），也**不能**给任一字段加代码默认值。|

### 5.3 `.evofence/config.yaml`（适配器配置）

`init` 写入的模板原文（`src/lib/init.js:12-28`）：

```yaml
version: 1
adapters:
  codex:    { command: codex,    model: null }
  opencode: { command: opencode, model: null, agent: null }
  claude:   { command: claude,   model: null, agent: null }
  pi:       { command: pi,       model: null }
```

模板原文位于 `src/lib/init.js:10-26` 的 `const configTemplate`（上面是等价缩进缩写；真实模板为逐行 YAML）。

| 字段 | 类型 | 默认值 | 校验（`INVALID_CONFIG`） |
| --- | --- | --- | --- |
| `version` | int | `1` | 必须 `=== 1` |
| `adapters` | object | 模板 4 键 | 可整体缺失（`config.adapters?.[name]`） |
| `adapters.<name>` | object | — | 若存在必须是 object；`<name>` ∈ {codex,opencode,claude,pi} |
| `adapters.<name>.command` | string | 缺省 = 适配器名（`adapterCommand` 回退 `return ... : name`） | 非空串（undefined 允许） |
| `adapters.<name>.model` | string \| null | `null`（`adapterModel` 回退 null） | string 或 null |
| `adapters.<name>.agent` | string \| null | `null` | string 或 null；**`pi.agent` 必须为空** |

### 5.4 `.evofence/private/holdout.yaml`

```
regressions: [ { id: <非空 string>, command: <非空 string> } ]   # id 唯一
```

- 文件缺失 → 返回 `[]`（**fail-open**，有意为之：`src/lib/contract.js:99`；该分支在 `:102` 的 `catch` 之前提前 return）。
- 文件存在但 `regressions` 不是数组 / 项非法 / id 重复 → `INVALID_HOLDOUT`（**fail-closed**）。
- 运行时另有强约束：holdout 文件必须被 git ignore，否则 `HOLDOUT_NOT_IGNORED`（`src/lib/runner.js:348-352`，用 `git check-ignore -q`）。
- 有 holdout 但未传 `--allow-readable-holdout` → `PRIVATE_ORACLE_READABLE`（`src/lib/runner.js:367-369`）。

### 5.5 experiment manifest（`experiment run <file>`）

| 字段 | 类型 | 默认 | 校验 |
| --- | --- | --- | --- |
| `goal_file` | string | — | 必填，否则 `INVALID_EXPERIMENT`；路径相对 manifest 所在目录解析 |
| `adapter` | string | `'codex'` | 不校验（下游 `UNKNOWN_ADAPTER`） |
| `iterations` | number | `undefined` | 不校验（下游 `INVALID_BUDGET`） |
| `max_wall_clock_ms` | number | `undefined` | 同上 |
| `allow_unisolated_agent` | bool | 非 `true` 即 false | `=== true` 严格判定 |
| `allow_readable_holdout` | bool | 非 `true` 即 false | `=== true` 严格判定 |

顶层必须是 YAML 对象（数组/标量 → `INVALID_EXPERIMENT`）。

### 5.6 fail-closed 行为汇总

| 场景 | 行为 |
| --- | --- |
| contract.yaml 缺失 | `MISSING_FILE` 抛错，run 不启动 |
| contract.yaml 是符号链接 / 非常规文件 | `UNSAFE_POLICY_FILE` |
| contract.yaml 经符号链接指向仓库外 | `PATH_ESCAPE` |
| YAML 重复键 | `INVALID_YAML`（`uniqueKeys: true`） |
| contract 字段类型/取值非法 | `INVALID_CONTRACT`，不做默认值兜底 |
| **contract 字段缺失**（除 `per_command_timeout_ms` / `max_output_bytes`） | `INVALID_CONTRACT` —— 全文件只有 2 处 `??` 代码默认（`contract.js:43,45`），**其余字段一律 fail-closed**；`templates/contract.yaml` 的初始值不构成兜底 |
| `require_rollback_point` 被改成 false | `INVALID_CONTRACT`（硬性拒绝） |
| `authority_ceiling: A4` | `INVALID_CONTRACT`（A4 不可自动授予） |
| 未知 adapter 名 | `UNKNOWN_ADAPTER` |
| 无任何证据配置 | `NO_EVIDENCE_CONFIGURED` |
| 未声明 objective 命令但要求改进 | `OBJECTIVE_NOT_CONFIGURED` |
| token/USD 用量不完整 | `TOKEN_USAGE_UNAVAILABLE` / `USD_USAGE_UNAVAILABLE`，**不估算、不继续** |
| holdout 文件存在但非法 | `INVALID_HOLDOUT` |
| 适配器无法保证隔离 | `*_SANDBOX_REQUIRED` / `PRIVATE_ORACLE_READABLE` |
| contract 字段缺失（除上表 2 个代码默认） | `INVALID_CONTRACT`（`undefined` 不进 `invariant` 分支即失败；**无模板回填、无默认对象**） |

---

## 6. 四条门禁的实现位置

### 6.1 Contract gate

| 门禁点 | 函数 | 触发条件 |
| --- | --- | --- |
| 加载即校验 | `loadContract` → `validateContract`（`src/lib/contract.js:79,21`） | 每次 `runEvolution` / `currentPolicyHashes` / `evidence run` 读契约 |
| 证据可配置性 | `requireEvidenceConfigured`（`src/lib/policy.js:155`） | run 启动前 |
| 策略漂移（提案后） | `currentPolicyHashes`（`runner.js:140`）+ 比较 `if`（`src/lib/runner.js:552`） | `POLICY_CHANGED_DURING_PROPOSAL` → QUARANTINE 并终止 |
| 策略漂移（实现后） | 同上（比较 `if` 在 `src/lib/runner.js:638`） | `POLICY_CHANGED_DURING_RUN` |
| 策略漂移（评估后） | 同上（比较 `if` 在 `src/lib/runner.js:763`） | `POLICY_CHANGED_DURING_EVALUATION`（覆盖已成型的 decision） |
| 提案与 objective 一致性 | `runner.js:595-596` | `expected_effect.primary_metric/direction` 与契约不符 → `PROPOSAL_OBJECTIVE_MISMATCH`（REJECT） |
| 提案防篡改 | `runner.js:652`（`PROPOSAL_TAMPERING`） | 实现后 proposal 摘要变化 |
| 提案结构 | `checkProposal`（`src/lib/policy.js:76`） | 15 条断言 |
| claims 结构 | `checkClaims`（`src/lib/policy.js:95`） | 9 条断言 |
| 审计侧复算 | `verifyProposalDigestClaim`、`verifyProposalLink`、`verifyLinkedBaseSha`（`src/lib/audit.js:33-61`） | `diff` 时 `proposal_sha256`/`base_sha` 与链上记录不符 → `LEDGER_CORRUPT` |

`currentPolicyHashes` 覆盖三个文件：`{ contract, holdout, config }` 的 `sha256(stableStringify(...))`（`src/lib/runner.js:140-149`），比较用 `stableStringify` 再 `!==`。

### 6.2 Evidence gate

| 门禁点 | 函数 | 触发条件 |
| --- | --- | --- |
| 证据采集 | `collectEvidence`（`src/lib/evidence.js:36`） | 顺序执行 `hard_invariants` → `evidence.public_commands` → private holdout → `objective.command` |
| 超时与预算联动 | `boundedTimeout`（`src/lib/evidence.js:31`） | `deadlineAt - now <= 0` → `RESOURCE_EXHAUSTED`；否则 `min(per_command_timeout_ms, remaining)` |
| 公共判定 | `all_public_passed = results.every(i => i.passed)` | `passed = code === 0 && !timed_out && !output_limited` |
| 私有判定 | `all_private_within_tolerance = failed <= acceptance.hidden_regression_tolerance` | 默认 tolerance 0 → 任何私有回归即 false |
| objective 判定 | `finalNumericLine(result.stdout)`（`src/lib/process.js:231`） | 只取**最后一行**的有限数值；否则 `valid_score=false` |
| artifact 落盘 | `writeFile(..., { flag: 'wx', mode: 0o600 })` + `artifact_sha256` | 路径 `.evofence/artifacts/<runId>/<phase>-<iteration>-<ts>.json` |
| 候选后置复检 | `checkFinalCandidate`（`src/lib/runner.js:339`） | `beforeEvidenceHash !== afterEvidenceHash` → `EVIDENCE_MODIFIED_CANDIDATE`（QUARANTINE） |
| 最终裁决映射 | `runner.js:748-767` | 公共失败→REJECT/PUBLIC_TEST_FAILURE；私有失败→REJECT/HIDDEN_REGRESSION；objective 无效→QUARANTINE/OBJECTIVE_SCORE_INVALID；增量不足→REJECT/NO_PRACTICAL_IMPROVEMENT；否则按风险 → ACCEPT/ESCALATE/QUARANTINE |
| 审计侧复算 | `verifyAcceptanceEvidence`、`verifyGateDecision`、`verifyImprovementEvidence`、`improvementBaselineScore`（`src/lib/audit.js:150-238`） | 绑定证据未过门 / `evidence_ok !== true` / score 与 improvement 无法从链上推导 → `LEDGER_CORRUPT` |
| 只读 CLI 复跑 | `commandEvidence`（`src/cli.js:130`） | 输出 JSON，失败退出码 1；不提交、不接受 |

### 6.3 Budget gate

| 门禁点 | 函数 | 触发条件 |
| --- | --- | --- |
| CLI 参数上限 | `parseNumericBudget`（`src/lib/runner.js:33`） | 非正整数 → `INVALID_BUDGET`；超过契约上限 → `BUDGET_ABOVE_POLICY` |
| 墙钟 | `deadlineAt = Date.now() + wallClockLimit`；循环与 adapter timeout 均以 `deadlineAt - Date.now()` 计算 | 迭代开始时已过期 → `RESOURCE_EXHAUSTED` / failure `{reason:'max_wall_clock_ms'}` |
| 迭代数 | 主循环 `for (let iteration = 1; iteration <= limitIterations; ...)` | — |
| 失败计数 | `failureCount` / `noImprovementCount`（`src/lib/runner.js`） | `>= max_failed_candidates` 或 `>= max_consecutive_no_improvement` → break |
| token 实时拦截 | `createAdapterUsageMonitor`（`src/lib/adapter.js:225`）+ `runProcess({ onChunk, stopGraceMs: 0 })` | 累计 `>= maxTokens` → `TOKEN_BUDGET_REACHED`；解析失败/缺失 → `TOKEN_USAGE_UNAVAILABLE` |
| token 记账与闸门 | `recordTokenUsage`（`src/lib/runner.js:194`） | 写 `budget.tokens.observed`；`observedTotal >= maxTokens` → `budget.exhausted` + throw `RESOURCE_EXHAUSTED` |
| USD 记账与闸门 | `recordCostUsage`（`src/lib/runner.js:263`） | Claude `--max-budget-usd`；`cost_budget_reached` 或累计 ≥ limit → `budget.exhausted` + `RESOURCE_EXHAUSTED` |
| 每轮调用前的余量检查 | `runBudgetedAdapter`（`src/lib/runner.js:437-450`） | 余量 `< 1` → 直接 `budget.exhausted` + throw |
| 主机能力前置 | `canTerminateProcessTree`（`src/lib/process.js:72`） | 无法终止进程树 → `UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL` / `UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL` |
| 不变量：不做估算 | `estimated_tokens: usage.tokens_complete ? usage.tokens_total : null`（`src/lib/adapter.js:567`） | 不完整即为 null |
| 金额精度 | `usdToMicros(value, rounding)`（`src/lib/runner.js:41`、`src/lib/adapter.js:26`，BigInt 十进制解析） | 超 safe integer → `INVALID_BUDGET`；floor / ceil 语义区分记账与上限格式化 |

### 6.4 Isolation gate

| 门禁点 | 函数 | 触发条件 |
| --- | --- | --- |
| worktree 隔离 | `createWorktree`（`src/lib/git.js:45`） | 临时根 = `path.join(os.tmpdir(), 'evofence-worktrees', sha256(root.toLowerCase()).slice(0,16))`，run 目录 = `<临时根>/<runId>`，在其下 `git worktree add --detach <worktreePath> <baseSha>`（`runner.js:409-413`） |
| 临时根包含性 | `assertInside(tempRoot, worktree)`（`runner.js:355`）、`assertInside(tempParent, runTempRoot)`（`src/lib/runner.js:854`） | 越界 → `PATH_ESCAPE` |
| worktree 路径一致性 | `createWorktree` 内 realpath 比对 | `WORKTREE_MISMATCH` |
| `.git` 指针防替换 | `worktreeMetadataSnapshot` / `worktreeMetadataMatches` / `restoreWorktreeMetadata`（`src/lib/git.js:53,69,61`） | 提案后与实现后各检一次；不一致 → 恢复 + `gate.decision`(QUARANTINE)/`WORKTREE_METADATA_CHANGED`；指针非常规文件 → `WORKTREE_METADATA_CHANGED` |
| 环境变量剥离 | `sanitizedEnvironment`（`src/lib/process.js:12`）+ 正则 `SENSITIVE_ENV_NAME`（`src/lib/process.js:6`） | 每次 `spawn` 都过滤：名字匹配 `TOKEN\|SECRET\|PASSWORD\|PASSWD\|CREDENTIAL\|AUTH\|BEARER\|COOKIE\|SESSION`、`API\|ACCESS\|PRIVATE\|CLIENT\|SIGNING\|ENCRYPTION`＋`KEY`、`ASKPASS\|AUTH_SOCK\|KUBECONFIG\|DOCKER_CONFIG`；`extra` 中同名的会被**删除** |
| 受保护路径 | `isProtectedPath` / `checkChangedPaths`（`src/lib/policy.js:55,64`） | `BUILTIN_PROTECTED`（**19 条**，`src/lib/policy.js:3-22`；实测命令见 §自检 第 16 项）+ 契约 `protected_paths` → `POLICY_VIOLATION` |
| 演化面限制 | `isAllowedPath`（`src/lib/policy.js:59`） | 不在 `allowed_evolution_surface` → `outside_evolution_surface` |
| 未声明改动 | `checkTaskFile`（`src/lib/runner.js:177`） | `UNDECLARED_CHANGE` |
| claims 与 diff 一致 | 同上 | `CLAIMS_DIFF_MISMATCH` |
| 能力越权 | 同上 + `assessCapabilities` | `CAPABILITY_VIOLATION`（ESCALATE）、`capability.denied` |
| artifact 读取加固 | `readJsonInside`（`src/lib/fs.js:45`） | 非普通文件/符号链接 → `UNSAFE_ARTIFACT`；超 1 MiB → `ARTIFACT_TOO_LARGE` |
| task 文件不可被替换 | `runner.js:619-620` | 候选把 `.evofence-task.md` 换成非普通文件 → `UNSAFE_ARTIFACT` |
| 隔离期望的显式接受 | `--allow-unisolated-agent` / `--allow-readable-holdout` | 见 §3.3 `*_SANDBOX_REQUIRED`、`PRIVATE_ORACLE_READABLE` |
| 私有 oracle 入库防护 | `ensurePrivateIgnored`（`src/lib/runner.js:348`） | `HOLDOUT_NOT_IGNORED` |
| 控制面状态写保护 | `assertReportOutputOutsideState`（`src/cli.js:325`）/ `canonicalizePath`（`src/cli.js:258`）/ `sharesIdentityWithState`（`src/cli.js:288`） | 报告路径在 `.evofence/**`、或经符号链接/硬链接指向 state → `PROTECTED_PATH` |
| ledger 只读与 append-only | `Ledger({ readOnly: true })`、DDL 触发器 | 写只读实例 → `LEDGER_READ_ONLY`；UPDATE/DELETE → SQLite `ABORT 'events are append-only'` |

> 边界声明：仓库只声明 worktree 隔离，**不声称 OS 沙箱**（`AGENTS.md`、各 `*_SANDBOX_REQUIRED` 错误文案、`docs/pi-tool-strategy.md` 均如此）。

### 6.5 风险门禁（附带第五道，非四条之一但决定 ACCEPT/ESCALATE）

`assessRisk(paths, proposal, contract)`（`src/lib/policy.js:108`）：基础 0.05；`>20` 文件 +0.35、`>8` +0.2、`>3` +0.1；有 capability 请求 +0.3；命中 auth/security/permission/policy/workflow 正则 +0.35；命中 test 路径 +1；`primary_metric !== objective.name` +0.15；`min(1, round(x*100)/100)`。
band：`<0.3 LOW`、`<0.65 MEDIUM`、`<0.9 HIGH`（→ ESCALATE）、否则 `CRITICAL`（→ QUARANTINE）。

---

## 7. 公开导出

### 7.1 `src/index.js`（包的 `exports["."]`，18 个符号）

```
initializeRepository                                                  (from ./lib/init.js)
loadContract, loadPrivateHoldout, validateContract                    (from ./lib/contract.js)
runEvolution                                                          (from ./lib/runner.js)
Ledger, ledgerPath                                                    (from ./lib/ledger.js)
checkChangedPaths, checkClaims, checkProposal, isAllowedPath,
  isProtectedPath, matchesGlob, assessRisk                            (from ./lib/policy.js)
collectEvidence                                                       (from ./lib/evidence.js)
buildEvolutionReport, formatEvolutionReport                           (from ./lib/report.js)
EvoFenceError                                                         (from ./lib/errors.js)
```

**未进入公共 API 但被测试直接 import 的模块**（内部模块路径与导出名事实上也是兼容面）：共 **11 个** —— `adapter.js`、`contract.js`、`errors.js`、`git.js`、`init.js`、`ledger.js`、`pi-tool-strategy.js`、`pi-tool-strategy-extension.js`、`policy.js`、`process.js`、`runner.js`。

测试导入方式人口普查（复核报告 F2，`grep -rl "from '\.\./src" test | wc -l` = **7**）：

| 导入方式 | 文件数 | 文件 |
| --- | --- | --- |
| 静态 `import ... from '../src/lib/*.js'` | **7** | `adapter`、`contract-policy`、`git`、`ledger`、`pi-tool-strategy`、`process`、`runner` |
| 静态 `import ... from '../scripts/*.js'` | 1 | `release`（只测发布元数据校验脚本） |
| 不 import 任何 src/scripts，仅把插件文件当文本读 | 1 | `integrations`（用 `readFile` + 正则断言 marketplace/plugin.json 形状） |
| 从 `process.cwd()` 动态 import（可对候选 checkout 跑） | 3 | `spec-f1` / `spec-f2` / `spec-f3` |

注意：`audit.js` 与 `fs.js` **没有任何测试文件直接 import**（`audit.js` 只经 `spec-f1` 的 CLI/动态 import 路径间接受测，`fs.js` 仅作为其他模块的依赖间接受测）。

### 7.2 各模块导出符号全集

见 §1 表格「导出的真实符号」列。补充高层 API 说明：

- `Ledger`（class）：`append(eventType, runId, payload)`、`recordGeneration(generation)`、`rollback(generationId)`、`activeGeneration()`、`generation(id)`、`generations()`、`events(runId?)`、`recentRuns(limit=10)`、`schemaTables()`、`verify()`、`readSnapshot()`、`export()`、`close()`；字段 `filename`、`readOnly`、`db`。
- `runEvolution({...})`：`{ cwd, goal, adapter='codex', iterations, maxWallClockMs, allowUnisolatedOpenCode=false, allowUnisolatedAgent=allowUnisolatedOpenCode, allowReadableHoldout=false, onProgress=()=>{}, adapterRunner=null }` → outcome `{ run_id, status, adapter, base_sha, iterations[], active_generation, token_usage_total, cost_estimate_total_usd, duration_ms, decision?, failure?, previous_failure_packet? }`。
- `collectEvidence({...})`：`{ root, artifactRoot, contract, holdout=[], runId, iteration=0, deadlineAt=Infinity, phase='candidate', onProgress }` → `{ schema_version:1, run_id, iteration, phase, candidate_sha, started_at, duration_ms, public[], private{total,passed,failed,cases[]}, objective, all_public_passed, all_private_within_tolerance, artifact?, artifact_sha256? }`。
- `buildEvolutionReport({root, ledger})` → `{ schema_version:1, generated_at, run_count, generation_count, runs[], generations[], objective, budgets{tokens_total,usd_total}, integrity }`。
- `generationDiff({root, ledger, generationId})` → 见 `src/lib/audit.js:308-327` 的 20 个字段。
- `buildStatus({root, ledger})` → `{ root, active_generation, integrity{valid}, recent_runs[], totals{runs,generations,accepted_candidates,rejected_candidates} }`。

---

## 8. 集成消费方命令面

`integrations/` 下 5 个目录 + 1 个项目级 pi 入口。

### 8.1 总表

| 目录 | 消费方式 | 依赖的 EvoFence 命令 / API | 文件路径 | 权限/策略声明 |
| --- | --- | --- | --- | --- |
| `integrations/pi` | pi 扩展（`pi.registerTool`） | CLI：`evofence ledger verify`、`evofence ledger recent 10`；Windows 用 `evofence.cmd` + `shell: true` | `integrations/pi/evofence.js`；依赖声明 `integrations/pi/package.json`（`typebox@1.3.34`） | 只读：`readonly` 工具、`spawnSync` 15s 超时、`maxBuffer: 1_000_000`；README 明示「never initialize a repository or modify Git state」 |
| `integrations/claude-code` | Claude Code 插件（slash commands） | CLI：`evofence ledger verify`、`evofence ledger recent 10`、`evofence run --goal <file> --json [--adapter <a>]` | `integrations/claude-code/.claude-plugin/plugin.json`；`commands/inspect-ledger.md`；`commands/run-evolution.md` | 无机器可读 permissions 字段；**由 prompt 文本声明**：不得运行 `ledger show`（含完整 payload）、不得改文件、未获显式授权不得加 `--allow-unisolated-agent` / `--allow-readable-holdout`、被拒时报告而非绕过 |
| `integrations/codex` | Codex 插件（skills） | CLI：`evofence ledger verify`、`evofence ledger recent 10`、`evofence run --adapter <a> --goal <file> --json` | `integrations/codex/plugin.json`（portable，`$schema` = agent-plugins 1.0.0）、`integrations/codex/.codex-plugin/plugin.json`（`skills: "./skills/"`）、`skills/inspect-ledger/SKILL.md`、`skills/run-evolution/SKILL.md` | `extensions["com.openai"].interface.capabilities = ["Read","Write"]`（**唯一的机器可读权限声明**，两处 manifest 均为 `["Read","Write"]`）；skill 文本声明同 claude 的只读/授权约束 |
| `integrations/opencode` | OpenCode 项目插件（`tool({...})`） | CLI：`evofence ledger verify`、`evofence ledger recent 10`；同样 Windows `evofence.cmd` + `shell: true` | `integrations/opencode/plugins/evofence.js`；依赖声明 `integrations/opencode/package.json`（`@opencode-ai/plugin@1.18.32`） | 只读（返回 `JSON.stringify(...)`），无权限字段；安装说明要求 `npm ci --prefix .opencode` |
| `integrations/deepseek-harness` | Cordis bundle，**直接 import 库**（不经 CLI） | **公共 API**：`import { Ledger, ledgerPath } from 'evofence'` → `new Ledger(ledgerPath(process.cwd()), { readOnly: true })` → `ledger.verify()` / `ledger.recentRuns(10)` | `integrations/deepseek-harness/index.js`；`cordis.patch.yml`（`insert: [{ id: evofence-tools, name: '@local/evofence-deepseek-harness' }]`）；`package.json` | README 声明：只读打开 `.evofence/ledger.sqlite`，不访问网络、不 spawn、不读凭据、不启动 run、不改 Git；返回 `integrity + runs` |
| `.pi/extensions/evofence.js`（项目级） | pi **自动发现**的项目级扩展入口 | 无自身逻辑，`export { default } from '../../integrations/pi/evofence.js'`（1 行） | `.pi/extensions/evofence.js` | 继承 `integrations/pi` 的只读工具 |

### 8.2 pi 扩展自动加载机制与本仓库的关系

- pi 在**启动目录**为仓库根时自动发现 `<cwd>/.pi/extensions/*.js` 作为项目级扩展；本仓库的 `.pi/extensions/evofence.js` 只是把 default 再导出到 `integrations/pi/evofence.js`（唯一实现）。
- 因此「自动加载」= **依赖相对路径耦合**：`.pi/extensions/evofence.js` → `../../integrations/pi/evofence.js`。移动/改名 `integrations/pi/` 会静默失效。
- 这条耦合被测试锁定：`test/integrations.test.js:51-56` 断言 `.pi/extensions/evofence.js` 存在且匹配正则 `/export\s+\{\s*default\s*\}\s+from\s+['"]\.\.\/\.\.\/integrations\/pi\/evofence\.js['"]/`。
- 安装前置：`npm ci --prefix integrations/pi`（`typebox` 是运行时 import，缺失则扩展加载失败）。
- 与 `evofence run --adapter pi` **是两条独立路径**：CLI 适配器走 `--no-extensions`（`src/lib/adapter.js:75-88` 的 `piArgs` 含 `--no-extensions`），只显式加载 `--extension ./src/lib/pi-tool-strategy-extension.js`，**不会**加载 `.pi/extensions/evofence.js`。测试为此设防：`test/adapter.test.js:5`「Pi strategy loads one explicit EvoFence extension while keeping extension discovery disabled」。

### 8.3 新 CLI 必须兼容的命令/子命令（契约面）

1. `evofence ledger verify` → stdout 为 JSON `{ valid: boolean, events?, head? }` 或失败对象；退出码 0/1。
2. `evofence ledger recent 10` → stdout 为 JSON 数组（`recentRuns(10)`）；**不得包含 prompt/命令/源码/评估输出**（三方 README 与 test/ledger.test.js 都以此为前提）。
3. `evofence run --adapter <a> --goal <file> --json` → stdout 单份 JSON；退出码 0/1。
4. 二进制名与 Windows 形态：`evofence` / `evofence.cmd`（两个 JS 集成硬编码这两个名字）。
5. 库面：`evofence` 包的 `{ Ledger, ledgerPath }`（deepseek-harness 直接 import，且其 `package.json` 声明 `"evofence": "0.2.0"` —— **与当前 0.3.0 不一致**，重构需同步）。
6. 插件元数据版本一致性：**携带 `version` 且被断言等于根 `package.json.version` 的有 4 个** —— `.claude-plugin/marketplace.json`（`metadata.version` 与 `plugins[0].version`）、`integrations/codex/plugin.json`、`integrations/codex/.codex-plugin/plugin.json`、`integrations/claude-code/.claude-plugin/plugin.json`（当前均为 `0.3.0`）。注意 **`.agents/plugins/marketplace.json` 不携带 `version`**（只有 `name`/`interface`/`plugins[0].{name,source,policy,category}`），测试只断言它的 `plugins[0].name` 与 `plugins[0].source.path`（`test/integrations.test.js:9-15`）。

---

## 9. 测试覆盖点

运行方式：`npm test` = `node --test`（`package.json` scripts）；`npm run check` = `node --check src/cli.js && node --check src/index.js && node --test`。
全部 12 个文件使用**扁平 `test(...)`**，无 `describe`/`it`（`grep -rn "describe(" test` 与 `grep -cE '^[[:space:]]+test\(' test/*` 均无命中）。
测试导入方式分三类：**7 个** `test/*.test.js` 静态 `import ... from '../src/lib/*.js'`（路径与导出名即契约）；**1 个**（`release.test.js`）import `../scripts/verify-release-metadata.js`；**1 个**（`integrations.test.js`）不 import 仓库代码，只当文本读插件文件；`test/spec-f*.test.mjs`（**3 个**）用**从 `process.cwd()` 解析的动态 import**，文件头注释明示 mount-independent。

| 文件 | 行数 | 用例数 | 覆盖主题 | 锁定 |
| --- | --- | --- | --- | --- |
| `test/spec-f1.test.mjs` | 1456 | 49 | `generationDiff` / `formatGenerationDiff` / `CLI diff` 审计视图（F1 验收 oracle） | **hash chain + 门禁** |
| `test/spec-f2.test.mjs` | 1080 | 27 | `buildEvolutionReport` / `formatEvolutionReport` / `CLI report`（F2 验收 oracle） | **hash chain + fail-closed** |
| `test/spec-f3.test.mjs` | 711 | 23 | `buildStatus` / `formatStatus` / `CLI status`（F3 验收 oracle） | **hash chain + fail-closed** |
| `test/runner.test.js` | 357 | 2 | 端到端演化（真实 `git init` worktree、accept/rollback）+ `checkFinalCandidate` + **token/USD 预算耗尽与拒绝路径**（见 §9.4） | **门禁 + 预算 + isolation** |
| `test/adapter.test.js` | 299 | 18 | 4 个适配器的 argv、JSON 事件 token/cost 解析、实时 token 监视器 | **预算（fail-closed 用量）** |
| `test/pi-tool-strategy.test.js` | 209 | 7 | pi 工具策略与扩展钩子（fail-open、遥测脱敏） | 无（隔离/降级语义） |
| `test/ledger.test.js` | 93 | 3 | ledger 哈希链追加、append-only 触发器、read-only CLI 不建库、recent 脱敏 | **hash chain** |
| `test/git.test.js` | 72 | 4 | `diffHash` 口径、git 版本解析与 `GIT_VERSION_UNSUPPORTED` | 无（Git 兼容面） |
| `test/contract-policy.test.js` | 69 | 6 | 契约模板可校验、重复 key、token 预算、glob、内建受保护路径、proposal/claims 结构、能力默认拒绝与风险评分 | **fail-closed** |
| `test/process.test.js` | 63 | 7 | 输出限长、超时终止、回调触发停止、进程树能力探测、**env 剥离**、objective 末行解析 | **预算 + env 剥离** |
| `test/integrations.test.js` | 57 | 2 | 5 个集成包/插件清单与命名空间、依赖声明、`.pi/extensions` 入口形状 | 无（发布面） |
| `test/release.test.js` | 44 | 4 | `verifyReleaseMetadata`（tag/version/prerelease 一致性） | 无（发布面） |

### 9.1 `test/spec-f1.test.mjs`（diff 审计，49 例）

主题分组（完整名见文件，此处按主题归纳并给出代表性用例）：

- **基本报告形状**：`generationDiff returns the full documented report for an accepted generation`、`... reports null links for a generation without candidate events`、`... rejects an unknown generation with EvoFenceError GENERATION_NOT_FOUND`、`formatGenerationDiff renders the audit view without leaking evidence output`（**证据不外泄**）、`CLI diff --json prints the documented report as parseable JSON`、`CLI help lists the diff command`。
- **哈希链/篡改**：`... rejects a tampered ledger with EvoFenceError LEDGER_CORRUPT before presenting evidence`、`CLI diff exits 1 with LEDGER_CORRUPT when the ledger hash chain is broken`、`... rejects a generation row that disagrees with its hash-chained record`、`... rejects a proposal digest claim that does not match its proposal content`、`... rejects a digest claim with no proposal object`。
- **链接唯一性/歧义**：`... rejects ambiguous evidence candidates for the accepted artifact`、`... rejects an acceptance record whose proposal digest matches no proposal`、`... rejects ambiguous acceptance records for a generation`、`... rejects ambiguous proposal digest matches`、`... rejects ambiguous proposal links in the legacy fallback`、`... rejects ambiguous baseline preceding the acceptance`、`... rejects ambiguous run started events before the acceptance`、`... rejects ambiguous legacy evidence links`。
- **顺序与窗口（记录必须早于 acceptance）**：`... rejects gate evidence that follows the acceptance`、`... rejects a proposal that follows the acceptance`、`... rejects a contract snapshot that follows the acceptance`、`... ignores baseline evidence that follows the acceptance`。
- **门禁/证据一致性**：`... rejects a generation with no ACCEPT gate decision`、`... rejects a generation whose gate decision is not ACCEPT`、`... rejects an ACCEPT gate decision whose evidence_ok is not true`、`... rejects bound evidence that failed its gate`、`... rejects bound evidence with an invalid objective score`、`... rejects an acceptance score that disagrees with its bound evidence`、`... rejects an improvement below the contract min_delta`、`... rejects an acceptance without a numeric score and improvement`、`... rejects a gate decision whose improvement disagrees with the acceptance`、`... rejects an improvement that disagrees with the ledger evidence`、`... rejects a proposal whose embedded base_sha disagrees with the accepted parent`、`... rejects linked records from a different parent`、`... rejects evidence bound to a different artifact than the acceptance record`、`... rejects candidate.accepted evidence recorded under a different run`。
- **增量基线**：`... derives improvement from a validated prior acceptance`、`... rejects an improvement baseline from an unsupported prior acceptance`、`... rejects an improvement baseline from a different branch`、`... rejects an improvement baseline that failed its gate`、`... rejects an improvement baseline with an invalid objective score`、`... keeps the run/iteration fallback for legacy acceptance events without bindings`。
- **diff 口径**：`... recomputes diff_sha256 and flags a ledger claim that does not match the git diff`、`... caps an oversized diff and formatGenerationDiff marks the truncation`、`... pins diff attributes to the generation despite a divergent primary worktree`（需 Git 2.42）。
- **CLI 用法**：`CLI diff exits 1 with GENERATION_NOT_FOUND for an unknown generation`、`CLI diff exits 1 with the documented usage error when the generation id is missing`。
- 常量：`EVIDENCE_SECRET = 'EVIDENCE-STDOUT-MUST-NOT-LEAK-7f3c9a'`（泄露检测哨兵）。

### 9.2 `test/spec-f2.test.mjs`（report，27 例）

- **形状与渲染**：`buildEvolutionReport returns the documented report shape for a seeded ledger`、`... reports zero counts and nulls for an empty ledger`、`formatEvolutionReport renders Markdown headings, summary bullets and both tables`、`CLI report --json/`（stdout Markdown）/`<file>`（建父目录+相对路径）/`<file> --json`、`CLI report exits 1 with the documented usage error for extra arguments`、`CLI help lists the report command`。
- **fail-closed（本文件的核心）**：`... reports a broken hash chain instead of throwing on malformed payloads`、`... refuses to summarize payloads behind a forged hash chain`、`... refuses to summarize when the generations table contradicts the verified events`（`generations_mismatch`）、`CLI report refuses to write the report over protected EvoFence state`、`CLI report rejects state-alias symlink paths that resolve into .evofence`、`CLI report rejects dangling symlink targets that resolve into .evofence`、`CLI report fails closed on symlink chains that exceed the resolution cap`、`CLI report rejects outputs hard-linked to control-plane state`。
- **预算/用量口径**：`... counts final cumulative totals from exhaustion and run-level events`、`... falls back to complete adapter telemetry when usage budgets are disabled`、`... counts complete invocations trailing behind the latest cumulative observation`、`... counts complete invocations preceding stale terminal totals`。
- **objective 历史快照**：`... derives objective metadata from historical run contract snapshots`、`... aggregates a single objective group with that group's own direction`、`... leaves unknown objective direction null instead of defaulting to maximize`（**不假设 maximize**）。
- **run 状态**：`... marks run.failed runs as FAILED and reports the failure code`。
- **原子快照**：`Ledger.readSnapshot returns integrity, events and generations from one transaction`、`buildEvolutionReport reads integrity, events and generations through one atomic snapshot`。
- 常量：`EVIDENCE_SECRET = 'EVIDENCE-STDOUT-MUST-NOT-LEAK-f2b6d1'`。

### 9.3 `test/spec-f3.test.mjs`（status，23 例）

- **形状与渲染**：`buildStatus returns the documented status with totals across all runs and a capped recent_runs`、`... reports zero totals and null active generation for an empty ledger`、`formatStatus renders the root, active generation, integrity, totals and recent runs`、`formatStatus renders Active generation: none and Ledger integrity: FAILED for a stub status`、`CLI status --json` / `CLI status`、`CLI status exits 1 with the documented usage error for extra arguments`、`CLI help lists the status command`。
- **空库/坏库边界（本文件的核心）**：`init creates the ledger database so status reports the empty state immediately`、`CLI status reports the documented empty state when the ledger file does not exist`、`CLI status treats a zero-byte ledger file as an empty ledger`、`CLI status reports a partially missing ledger schema as LEDGER_UNAVAILABLE instead of empty`（对照 `isMissingEventsSchema` + `schemaTables()` 的判定）、`CLI status treats a ledger database without any EvoFence schema as empty`、`CLI status reports an unreadable ledger as LEDGER_UNAVAILABLE instead of crashing`。
- **完整性/失败呈现**：`buildStatus reports invalid ledger integrity for a tampered ledger`、`CLI status exits 1 when the ledger hash chain is tampered and 0 when healthy`、`buildStatus keeps the failed-integrity status when payload_json is malformed`、`CLI status keeps the failed-integrity presentation for a malformed payload_json`、`buildStatus keeps the failed-integrity status when payload aggregation fails`、`buildStatus surfaces payload aggregation failures when integrity is valid`、`buildStatus keeps the failed-integrity status when payload_json is valid non-object JSON`、`CLI status keeps the failed-integrity presentation for a non-object payload_json`、`CLI status reports runs with non-object payloads on a healthy ledger`。
- 常量：`EVIDENCE_SECRET = 'EVIDENCE-STDOUT-MUST-NOT-LEAK-f3c4e2'`。

### 9.4 其余 9 个文件的完整用例名

**`test/adapter.test.js`（18）**：`Pi strategy loads one explicit EvoFence extension while keeping extension discovery disabled`、`Codex usage sums completed turns without double-counting breakdown fields`、`Codex usage stays unavailable when a completed turn omits usage or output is truncated`、`Codex token monitor triggers at a completed-turn boundary and reports its overshoot`、`token monitor keeps consuming events after the first budget stop`、`malformed telemetry after a budget stop keeps the first reason and invalidates totals`、`token monitor flushes a final JSON event without a trailing newline`、`usage monitor stops on malformed or missing completed-turn usage`、`OpenCode token monitor includes reasoning in component totals`、`OpenCode usage sums completed steps and preserves its reported cost without claiming a currency`、`OpenCode usage does not expose partial token or cost totals`、`Pi CLI usage completes on agent_end and includes message and compaction telemetry`、`Pi usage fails closed for retry attempts, missing agent_end, and truncated streams`、`Claude Code usage reads complete whole-tree token totals and CLI USD estimates`、`Claude Code requires whole-tree result telemetry and rejects incomplete results`、`Claude Code token monitor only evaluates its whole-tree final result`、`Claude Code launch uses non-interactive streaming auto permissions and requires explicit isolation acceptance`、`OpenCode component totals stay unavailable when reasoning usage is absent`。

**`test/contract-policy.test.js`（6）**：`the generated contract template validates and YAML duplicate keys are rejected`、`token budgets require positive safe integers`、`glob matching supports recursive and single-segment patterns`、`policy protects tests, manifests, local policy, and CI by default`、`proposal and claims require structured evidence fields`、`capability requests default to denied and risk grows with surface`。

**`test/git.test.js`（4）**：`diff hash includes an addition-only candidate and matches its committed generation`、`git version parsing accepts 2.42+ and rejects older or unparseable versions`、`requireGitVersion rejects unsupported versions with GIT_VERSION_UNSUPPORTED`、`assertGitVersionAtLeast probes the installed git`。

**`test/integrations.test.js`（2）**：`Codex and Claude marketplaces point to complete, namespaced plugins`、`OpenCode and Pi integration packages declare the modules their extensions import`。

**`test/ledger.test.js`（3）**：`SQLite ledger appends hash-chained events and keeps generation history`（含 `assert.throws(... UPDATE events ...)` 断言 `/append-only/`）、`ledger CLI recent returns sanitized run summaries and read-only commands do not create a ledger`、`recent run summaries count rejected iterations once and infer failed run iteration counts`。

**`test/pi-tool-strategy.test.js`（7）**：`proposal selects only active read-only tools and implementation orders the existing active set`、`tool errors demote that tool, add recovery feedback, and block an identical retry once`、`successful recovery restores the phase-start order of unprioritized tools`、`Pi proposal extension activates only read-only tools from Pi's current tool set`、`Pi extension fails open and restores its original tool order if a controller API call fails`、`proposal strategy fails open when no active read-only tool is available`、`strategy telemetry keeps tool names and outcomes while discarding arguments and output`。

**`test/process.test.js`（7）**：`process runner captures bounded output and exit status`、`process runner marks a final chunk that crosses the output limit as truncated`、`process runner terminates a process that exceeds its time budget`、`process runner stops when a streamed output callback reports a budget trigger`、`process-tree termination capability probe is bounded and returns a boolean`、`secret-like environment values are not passed to child processes`（**env 剥离锁定点**）、`objective parser reads only a finite final score`。

**`test/release.test.js`（4）**：`release metadata accepts a matching prerelease tag and flag`、`release metadata accepts a matching stable release tag and flag`、`release metadata rejects tag mismatch and prerelease flag mismatch`、`release metadata requires event values when run as a script`。

**`test/runner.test.js`（2）**：

1. `final candidate validation honors approved capabilities and detects evidence mutations` —— 直接测 `checkFinalCandidate` 的四条返回：`{accepted:true}`、`CAPABILITY_VIOLATION`、`EVIDENCE_MODIFIED_CANDIDATE`、`POLICY_VIOLATION`。
2. `one evolution is evaluated, committed, pinned, and can be rolled back` —— 真实 `git init` 仓库 + 20 轮 accept、protected-path QUARANTINE、以及一组**预算与拒绝路径**（复核报告 F11）：
   - `UNSUPPORTED_CLAUDE_TOKEN_BUDGET`（且断言 adapter **未被启动**：`claudeBudgetCalls === 0`）；
   - token 耗尽→`RESOURCE_EXHAUSTED`（断言 `budget.exhausted.payload.observed_total === 115` 与 `run.failed.payload.token_usage_total === 115`）；
   - `TOKEN_USAGE_UNAVAILABLE`（断言 `budget.usage_unavailable.payload.reason === 'usage_incomplete'`）；无法终止进程树时降为 `UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL`；
   - USD：`UNSUPPORTED_COST_BUDGET`、`RESOURCE_EXHAUSTED`（断言 `cost_estimate_total_usd === 1.01`、`cost_estimate_complete === true`、且**没有** `gate.decision`/`candidate.accepted`）、`USD_USAGE_UNAVAILABLE`（断言 `budget.cost_usage_unavailable` 存在）、`UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL`；
   - `CLAUDE_SANDBOX_REQUIRED`（未传 `allowUnisolatedAgent` 时 adapter 未启动）；
   - `process.tree_termination_failed` 事件 + `RESOURCE_EXHAUSTED`（`tree_termination_failed: true`）；
   - `PRIVATE_ORACLE_READABLE`（有 holdout 但未 `allowReadableHoldout`）；
   - 末尾断言 `git worktree list --porcelain` 只剩 **1** 个 worktree（`test/runner.test.js:350-351`）—— 见下「复核异议」。

### 9.5 锁定关键不变式的测试（速查）

| 不变式 | 锁定测试 |
| --- | --- |
| 哈希链算法与 append-only | `test/ledger.test.js`（3/3 全部）、`spec-f1` 的 tamper 组、`spec-f2` 的 forged-chain / generations_mismatch、`spec-f3` 的 tampered-integrity 组 |
| fail-closed 读取/写入 | `spec-f2` 的 symlink/hardlink/protected-state 组、`spec-f3` 的 partial-schema / zero-byte / LEDGER_UNAVAILABLE 组、`test/contract-policy.test.js` |
| 预算（token/USD） | `test/adapter.test.js`（18 例中大部分）、`test/process.test.js:27`（callback budget trigger）、`test/runner.test.js` 第 2 例（token/USD 耗尽、`TOKEN_USAGE_UNAVAILABLE`、`USD_USAGE_UNAVAILABLE`、`UNSUPPORTED_*` 拒绝路径） |
| 四条门禁 | `test/runner.test.js`（capability + evidence mutation + accept/rollback + protected-path QUARANTINE）、`spec-f1` 的 gate/evidence 组 |
| **worktree 清理与临时目录回收** | **未被测试锁定**。仅有的相关断言是 `test/runner.test.js:350-351`（跑完全部用例后 `git worktree list` 只剩 1 个），它**不能**证明中间每轮的 `removeCandidate()` / `runTempRoot` 清理正确；`src/lib/git.js:134` 的 `openTreeCount()` 导出了类似的检查能力但**全仓库零调用**（`grep -rn openTreeCount src test` → 仅定义处）。**这是重构必须补的测试（§10.4 第 22 条）。** |
| env 剥离 | `test/process.test.js:43` |
| 集成/发布契约 | `test/integrations.test.js`、`test/release.test.js` |

### 9.6 复核异议（复核报告 F1 经实测存在假阴性）

复核报告 F1 的论断是「runner.test.js **从没有** worktree 数量断言」，依据是 `grep -rn "worktree list\|openTreeCount" test/` 返回空（exit 1）。**这个 grep 模式本身有缺陷**：源码里是数组形式 `runProcess('git', ['worktree', 'list', '--porcelain'])`，两个单词被 `', '` 分隔，因此字面字符串 `worktree list` 在仓库里根本不存在——零命中是 grep 模式的假阴性，不是「没有断言」。

实测证据（可在 HEAD `5b51dae` 复现）：

```
$ grep -n "worktree" test/runner.test.js | tail -2
350:    const trees = await runProcess('git', ['worktree', 'list', '--porcelain'], { cwd: root });
351:    assert.equal(trees.stdout.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).length, 1);
$ grep -rn "worktree list" test/ ; echo $?
1
```

**结论（一半更正、一半采纳）**：

1. ❌ 复核报告「无此断言」的判断错误：该断言**存在**于 `test/runner.test.js:350-351`，位于整个用例的最后（在 `finally` 之前），是第一版文档的描述正确。本节已按实测行号保留并加固引用。
2. ✅ 复核报告的**实质风险仍然成立**：该断言只覆盖「整个用例跑完之后」的全局状态，**不能**证明每轮迭代的 `removeCandidate()` / `runTempRoot` 清理正确（也不覆盖异常路径）。它属「弱覆盖」而非「无覆盖」。因此已写入 §9.5：worktree 清理**实质上未被锁定**，是重构需补的测试；另核实 `src/lib/git.js:134` 的 `openTreeCount()` 是**零调用导出**（`grep -rn openTreeCount src test` 仅命中定义），可直接拿来写这个缺失的测试。

---

## 10. 重构风险清单（必须保住的不变式）

### 10.1 哈希链（最高风险）

1. **摘要输入必须逐字节一致**：`sha256(stableStringify({seq, created_at, event_type, run_id, payload_json, previous_hash}))`；`stableStringify` 的**递归键排序**、无缩进、数组保序、`undefined` 会丢键（`JSON.stringify` 语义）都必须完全复刻。
2. `event_hash` 不进摘要；`payload_json` 以**字符串**参与。
3. `ZERO_HASH = '0'.repeat(64)`；`seq` 从 1 连续；`previous_hash = 上一个 event_hash`。
4. `verify()` 的三重判定与**返回结构**（`valid/sequence/expected_previous_hash/observed_hash` 与 `valid/events/head`）被 `cli.js` 与 3 个 spec 文件依赖。
5. `created_at` 是 `new Date().toISOString()`（毫秒精度、UTC、`Z`），任何格式变化都会改变历史哈希（**存量 ledger 无法再校验**）。
6. 已有 WAL + `synchronous=FULL` + 触发器；换 DB 引擎或改触发器文案（`'events are append-only'`）会破坏 `test/ledger.test.js` 的 `/append-only/` 断言。

### 10.2 退出码与错误码面

7. **只有 0/1 两个退出码**，且 5 个具体条件被测试锁定（§3.1）。不要引入 2/3/127 等。
8. 错误码是**调用点字面量，无集中定义**；外部集成只对 `LEDGER_CORRUPT`、`GENERATION_NOT_FOUND`、`GIT_VERSION_UNSUPPORTED`、`USAGE` 等有显式断言，但 `spec-f1/f2/f3` 大量断言 `LEDGER_CORRUPT`。抽常量表可以，**改动字符串值等于破坏契约**。
9. `PROCESS_TREE_TERMINATION_FAILED` 是被引用但从不抛出的死值——重构时须显式决策（保留为兼容、或删除并同步 `runner.js:837`）。
10. 错误输出格式 `[CODE] message` 到 stderr（`src/cli.js:64`），且 `EVOFENCE_DEBUG` 控制 details——集成方若解析 stderr 会被影响。

### 10.3 fail-closed 语义

11. 缺少 contract/config → 直接失败（`MISSING_FILE`），**不得**注入默认契约继续跑。
12. `acceptance.require_rollback_point` 必须恒为 true；`authority_ceiling` 不接受 A4。
13. 证据/用量不完整就停（`TOKEN_USAGE_UNAVAILABLE`/`USD_USAGE_UNAVAILABLE`），**永不估算**；`estimated_tokens` 只在完整时非 null。
14. `verify()` 失败必须在任何消费/展示之前短路（`cli.js` rollback、`audit.js` generationDiff、`report.js`、`runner.js:403`）。
15. `recentRuns` / `status` / `report` / `diff` 的输出**不得**泄露 prompt、命令、源码、评估输出（3 个 spec 文件用 `EVIDENCE_SECRET` 哨兵字符串检测）。`ledger show` 是唯一有意暴露 payload 的命令。
16. `state` 表的 upsert 发生在 `generation.accepted` 之后、同一事务内；拆事务会破坏「表与链一致」的假设（`report.js:generationsTableConsistent`、`audit.js:verifyGenerationMetadata`）。
17. 只读打开 ledger 必须 `fileMustExist: true`（否则会**创建**一个空库，`test/ledger.test.js` 明确断言 read-only 命令不建库）。

### 10.4 env 剥离与进程隔离

18. `sanitizedEnvironment` 的正则 `SENSITIVE_ENV_NAME`（`src/lib/process.js:6`）是安全边界；所有 `spawn` 入口（`runProcess`）都必须经过它，且 `extra` 中同名键会被**删除**而不是覆盖。
19. `runProcess` 的 Windows 语义：`shell` 对 `.cmd/.bat` 自动置真、`detached: process.platform !== 'win32'`、`taskkill.exe /T /F` 终止整棵树、`canTerminateProcessTree()` 是预算功能的前置条件。跨平台重写必须保留 `tree_termination_failed` 语义。
20. `stopGraceMs: 0` 仅在启用 token 监视时使用（`adapter.js:542`），使预算触发能尽快杀树。
21. worktree 隔离**不等于 OS 沙箱**：`*_SANDBOX_REQUIRED`、`PRIVATE_ORACLE_READABLE` 的文案与行为都不能被弱化，README/AGENTS.md 都强调这一点。
22. `.git` 指针快照/比对/恢复（`worktreeMetadataSnapshot`/`worktreeMetadataMatches`/`restoreWorktreeMetadata`）是防「用子模块或目录替换 worktree」的关键，且 `restoreWorktreeMetadata` 里 `assertInside` + `flag: 'wx'` 必须保留。**同时注意：worktree 清理（`removeCandidate` + `runTempRoot` 的 `rm`，`runner.js:354-358 / 852-857`）与 `.git` 指针恢复的失败路径均无测试锁定**（§9.6），重构时须先补测试。

### 10.5 原生依赖 better-sqlite3 的使用方式

23. **同步 API**：`db.prepare(...).get/all/run`、`db.exec`、`db.transaction(fn)`、`db.pragma`。任何「改 async」的重构会波及 `Ledger` 全部方法签名与所有测试。
24. `better-sqlite3` 有安装期构建步骤（`prebuild-install || node-gyp rebuild`），`package.json` 里有 `"allowScripts": { "better-sqlite3@12.11.1": true }`（注意 `package-lock` 解析到的具体版本）；`deepseek-harness` README 明确提醒 pnpm 可能拦截构建脚本。替换驱动会同时影响安装体验与这三方文档。
25. 预处理语句字段名绑定（`@seq`、`@generation_id` 等）与列名一一对应；`events` 的 `payload_json` 是 TEXT（**不是** JSON1 列），`report.js` 依赖「JSON 文本可能被篡改/非对象」这个前提做防御（`spec-f2`/`spec-f3` 有专门用例）。

### 10.6 其他易碎面

26. **`src/index.js` 是公共 API 面**：18 个符号中至少 `Ledger`/`ledgerPath` 被 `integrations/deepseek-harness` 直接使用；该集成还声明 `"evofence": "0.2.0"`（与 0.3.0 不一致）。删改导出需同步集成与其 README。
27. **7 个 `test/*.test.js` 静态 import 内部模块路径**（`../src/lib/xxx.js`）与符号名（另有 1 个 import `../scripts/…`、1 个只读文件文本），重构目录结构或改名必须同步测试；**11 个内部模块**（全量见 §7.1）事实上也是兼容面。
28. **3 个 `spec-f*.test.mjs` 是验收 oracle**：用 `process.cwd()` 动态 import + CLI `spawnSync(process.execPath, [cliPath, ...])`，`cliPath` 由 cwd 推导。CLI 路径/参数/输出格式变化会直接打破验收基准。
29. **CLI 解析的既有怪癖**（§2.4）：`run` 静默忽略未知取值 flag；`ledger verify --json` 合法；`evidence run` 无 flag；`main()` 的 `--help` 短路。修「bug」可能打破集成与测试。
30. **HELP 文本是契约**：3 个 spec 断言 help 含 `diff`/`report`/`status` 命令名。
31. **Git 版本下限 2.42**：`audit.js` 的 `GIT_ATTR_SOURCE` 属性钉住（`assertGitVersionAtLeast(root, 2, 42, 'attribute-pinned audit diffs')`，`src/lib/audit.js:292`）；低于该版本必须报错而非静默降级（`spec-f1:980` 锁定）。
32. **diff 口径**：`git diff --no-ext-diff --no-renames --binary`，路径用 NUL 分隔并统一 `\` → `/`；`diffHash` 对未跟踪文件用 `git add --intent-to-add -- . :!.evofence-out :!.evofence-out/** :!.evofence-task.md`（`CANDIDATE_PATHSPEC`，`src/lib/git.js:8`）。任何口径变化都会让历史 `diff_sha256` 全部 mismatch。
33. **报告输出路径防护链**：`canonicalizePath`（最长存在祖先 realpath + 悬空链接跟随 + 32 层上限）、`sharesIdentityWithState`（dev/ino 硬链接检测）、Windows 下大小写归一。`spec-f2` 有 4 个专门用例。这是「不覆盖控制面状态」的最后一道防线。
34. **Windows/跨平台细节**：路径统一 `\` → `/`（多处 `.replaceAll('\\','/')`）、`realpathSync.native`、`process.platform === 'win32'` 分支、`isInsideDirectory` 的 `..` 判定、`status` 的 `root` 展示格式。
35. **`report.js` 的「最佳下界」用量估算**（`runTotals`：完整调用求和 vs 累计锚点 + 其后完整调用取最大）语义有 4 个专门测试（`spec-f2:829/866/981/638`）；改算法会静默改变历史报告数值。
36. **objective 元数据只能来自历史 `contract_snapshot`**，方向未知必须留 null，不得默认 maximize（`spec-f2:720` 锁定）。
37. **`isMissingEventsSchema`**（`src/cli.js:196`）用正则匹配 SQLite 错误文本 `no such table: ['"]?events['"]?$`；换驱动/换错误文本会改变「空库 vs 不可读」的判定（`spec-f3:656,690` 锁定两侧）。
38. **`package.json` 的 `files` 白名单**只含 `src/`、`templates/`、`docs/pi-tool-strategy.md`、README/README.en/LICENSE/CHANGELOG；`integrations/`、`.pi/`、`.claude-plugin/`、`.agents/` **不进 npm 包**（它们靠 marketplace 分发）。重构若把集成挪进 `src/` 或依赖包内路径会破坏分发模型。
39. **`init` 的幂等契约**：`copyIfMissing` 用 `COPYFILE_EXCL`、其余文件用 `flag: 'wx'`，且 `existing` 由 `created.length === 0` 推导；任何「覆盖已有文件」的改动都会破坏幂等与用户私有 holdout。
40. **`.evofence/.gitignore` 内容**固定为 `ledger.sqlite*`、`artifacts/`、`private/`、`out/`、`active-run.json`（含 `active-run.json` 这个当前代码**并未写入**的条目 → `未确认其用途`，可能为历史遗留）。
41. **`templates/` 与 `validateContract` 双向耦合**：`test/contract-policy.test.js:10` 断言模板本身可通过校验；改模板必须同步校验规则。
42. **Node 版本**：`engines` 要求 `>=22.13.0`；测试用 `import.meta.dirname`（Node 20.11+ 可用，但整体受 engines 约束）。降版本会破坏所有测试文件。

---

## 11. 模块依赖图与原生依赖加载时机

抽取方法（可复现）：用 Node 脚本对 `src/**/*.js` 正则抽取 `from './…'`，把 `lib/` 相对路径归一为目标模块，再做 DFS 环检测。

**结论：18 个节点 / 50 条内部边 / 0 个环 → 内部依赖图是 DAG**（脚本输出原文：`nodes: 18 edges: 50`、`cycles: NONE (DAG)`）。

### 11.1 边表（按源模块）

```
cli.js            → lib/{audit, contract, errors, evidence, git, init, ledger, report, runner, status}   (10 条)
index.js          → lib/{contract, errors, evidence, init, ledger, policy, report, runner}             ( 8 条)
lib/adapter.js    → lib/{errors, pi-tool-strategy, process}
lib/audit.js      → lib/{errors, fs, git}
lib/contract.js   → lib/{errors, fs}
lib/evidence.js   → lib/{errors, fs, process}
lib/fs.js         → lib/errors
lib/git.js        → lib/{errors, fs, process}
lib/init.js       → lib/{errors, git, ledger}
lib/ledger.js     → lib/{errors, fs}
lib/pi-tool-strategy-extension.js → lib/pi-tool-strategy
lib/policy.js     → lib/errors
lib/process.js    → lib/errors
lib/runner.js     → lib/{adapter, contract, errors, evidence, fs, git, ledger, policy, process}          ( 9 条)
lib/errors.js                 → （无内部 import）
lib/pi-tool-strategy.js       → （无）
lib/report.js                 → （无）
lib/status.js                 → （无）
```

**叶子模块**（零内部 import）：`lib/errors.js`、`lib/pi-tool-strategy.js`、`lib/report.js`、`lib/status.js`。

### 11.2 入度（谁被依赖）

| 入度 | 模块 |
| --- | --- |
| 0 | `cli.js`、`index.js`、`lib/pi-tool-strategy-extension.js`（均为入口/侧车） |
| 1 | `lib/adapter.js`、`lib/audit.js`、`lib/status.js` |
| 2 | `lib/init.js`、`lib/pi-tool-strategy.js`、`lib/policy.js`、`lib/report.js`、`lib/runner.js` |
| 3 | `lib/contract.js`、`lib/evidence.js` |
| 4 | `lib/git.js`、`lib/ledger.js`、`lib/process.js` |
| 6 | `lib/fs.js` |
| 13 | `lib/errors.js`（最深基础层） |

### 11.3 `better-sqlite3` 的加载时机（重构必读）

- 唯一顶层 import：`src/lib/ledger.js:1` → `import Database from 'better-sqlite3';`（`grep -rn better-sqlite3 src` 只有这一行）。
- `ledger.js` 的导入者共 4 个：`src/cli.js:9`、`src/index.js:4`、`src/lib/init.js:6`、`src/lib/runner.js:5`。
- `src/cli.js` 的全部 import 都是**静态顶层 import**，因此**任何 CLI 命令都会立即加载原生模块** —— 包括 `evofence --help`、`evofence status`、`evofence ledger verify` 这类完全不碰写操作的调用。
- `import 'evofence'`（即 `src/index.js`）同样立即加载（`index.js` 对 `./lib/ledger.js` 是静态 re-export）。
- 从 `cli.js` 可达的内部模块共 **15 个**（除 `lib/pi-tool-strategy-extension.js` 外全部）。
- `src/lib/pi-tool-strategy-extension.js` **不在依赖图里**：没有任何 `import` 语句引用它；它由 `src/lib/adapter.js:520` 用 `fileURLToPath(new URL('./pi-tool-strategy-extension.js', import.meta.url))` 算成绝对路径，作为 `--extension <path>` 参数交给 **pi CLI 子进程** 去加载。

重构含义：

1. 若要让 `better-sqlite3` 变成惰性/可选依赖（例如只读命令不加载原生模块），必须在 `cli.js` 把 `./lib/ledger.js` 改为动态 `import()`，并同步 `index.js` 的导出形状 —— 这会改变安装契约（原生构建）与 `deepseek-harness` 依赖的库面（§8.1）。
2. DAG 意味着可以按「叶子→上层」顺序抽包/换实现，**没有环需要先打破**；`errors.js`（入度 13）与 `fs.js`（6）是最深基础层，动它们的代价最大。
3. `report.js` / `status.js` 零内部依赖（只接收 `{root, ledger}`），是最先可独立测试/替换的模块。

---

## 12. 发布路径（release → npm）

### 12.1 涉及文件清单

| 文件 | 行数 | 角色 |
| --- | --- | --- |
| `scripts/verify-release-metadata.js` | 36 | tag / version / prerelease 一致性校验；被 workflow 调用，也被单测 import |
| `.github/workflows/ci.yml` | 26 | push + PR 的测试矩阵 |
| `.github/workflows/publish.yml` | 49 | GitHub Release `published` → npm publish（OIDC） |
| `test/release.test.js` | 44 | 上述脚本的 4 条单测 |
| `package.json` | — | `version`、`scripts`、`files`（发布内容白名单） |
| 携带 `version` 的插件清单（4 个） | — | `.claude-plugin/marketplace.json`（`metadata.version` + `plugins[0].version`）、`integrations/codex/plugin.json`、`integrations/codex/.codex-plugin/plugin.json`、`integrations/claude-code/.claude-plugin/plugin.json` —— 当前均为 `0.3.0`，由 `test/integrations.test.js:9-45` 断言等于根 `package.json.version` |
| 不携带 `version` | — | `.agents/plugins/marketplace.json`（只有 `name`/`interface`/`plugins[0].{name,source,policy,category}`；测试只断言 `name` 与 `source.path`） |

### 12.2 `scripts/verify-release-metadata.js` 的校验逻辑与失败条件

导出的纯函数 `verifyReleaseMetadata({ version, releaseTag, releaseIsPrerelease })`（`:5`）：

1. `releaseVersion = releaseTag.replace(/^v/, '')`（`:6`）—— 因此 `v0.3.0` 与 `0.3.0` 都接受。
2. `packageIsPrerelease = version.split('+', 1)[0].includes('-')`（`:7`）—— 先剥掉 SemVer 的 build metadata（`+...`），再看是否含 `-` 预发布段。
3. **失败条件 A**：`releaseVersion !== version` → `throw new Error('Release tag <tag> does not match package version <version>')`（`:9-11`）。
4. **失败条件 B**：`releaseIsPrerelease !== packageIsPrerelease` → `throw new Error('GitHub Release prerelease status must match the package SemVer version')`（`:13-15`）。

CLI 入口 `run()`（`:18-27`）：读 `package.json` 的 `version`（`:19`），取 `RELEASE_TAG` / `RELEASE_IS_PRERELEASE`（`:20-21`）；

5. **失败条件 C**：`!releaseTag` 或 `releaseFlag ∉ {'true','false'}` → `throw new Error('RELEASE_TAG and RELEASE_IS_PRERELEASE must be provided by the GitHub Release event')`（`:22-24`）。
6. 成功 → stdout `Release <tag> matches package <version>.`（`:26`）。
7. 入口守卫（`:29`）：仅当 `process.argv[1]` 的 realpath 等于本文件路径时才自动 `run()`；catch → stderr + `process.exitCode = 1`（`:32-34`）。**所以 `import` 本文件不会执行任何校验，只有作为脚本运行才会。**

它**不做**的事（重构时的空白）：不校验 marketplace / plugin manifest 的版本（那是 `test/integrations.test.js` 的职责）；不校验 npm 上版本是否已占用；不校验 CHANGELOG；不生成任何 artifact。

### 12.3 `.github/workflows/ci.yml`

- **触发**：`on: push`（所有分支）+ `on: pull_request`。
- **权限**：顶层 `permissions: contents: read`（无任何 write）。
- **job `test`**：矩阵 `os: [ubuntu-latest, windows-latest] × node-version: [22, 24]` → **4 个组合**。
- **步骤**：`actions/checkout@v4` → `actions/setup-node@v4`（`cache: npm`）→ `npm ci` → `npm test` → `npm pack --dry-run`。
- 关键细节：CI **不跑 `npm run check`**（`node --check` 只在本地 `check` 脚本里）；`npm pack --dry-run` 是 `package.json` `files` 白名单的实际门禁。

### 12.4 `.github/workflows/publish.yml` 与 OIDC Trusted Publishing 完整链路

- **触发**：`on: release: types: [published]` —— GitHub Release **被发布**时触发（预发布 release 也会触发 `published`，分流靠 `github.event.release.prerelease`）。
- **权限（两层）**：顶层 `permissions: contents: read`；job 级再加 `id-token: write`。
- **`id-token: write` 的作用**：允许该 job 向 GitHub 的 OIDC provider 申请一个**一次性身份令牌**（claims 含 repo、workflow 文件、ref、可选 environment）。npm CLI 用它与 npm registry 换取短期发布凭据，从而**不需要** `NPM_TOKEN` / `NODE_AUTH_TOKEN` secret —— 这就是 Trusted Publishing，也是 provenance 的来源。
- **步骤（`:15-49`）**：
  1. `actions/checkout@v6`，`ref: ${{ github.event.release.tag_name }}`（**按 tag 检出**，不是默认分支），`persist-credentials: false`（不把 GITHUB_TOKEN 留在 git 配置里 → 工作流无法回写仓库）。
  2. `actions/setup-node@v6`：`node-version: 24`、`registry-url: https://registry.npmjs.org`、`package-manager-cache: false`。
  3. `npm install --global npm@11.17.0`（Trusted Publishing 需要支持它的 npm CLI，故在 workflow 里固定升级）。
  4. `test "$(npm --version)" = "11.17.0"`（版本自检，防止 runner 镜像自带 npm 覆盖）。
  5. `npm ci` → `npm test`（发布前的测试门禁）。
  6. `Verify release metadata`：把 `github.event.release.tag_name` / `github.event.release.prerelease` 传进 env，执行 `node scripts/verify-release-metadata.js`。
  7. 分流：`if: github.event.release.prerelease` → `npm publish --tag beta`；`if: ${{ !github.event.release.prerelease }}` → `npm publish --tag latest`。
- **完整链路**：GitHub Release(published) → checkout(该 tag) → Node 24 + npm 11.17.0 + registry-url → `npm ci` + `npm test` → `verify-release-metadata.js` 校验 tag↔version↔prerelease → OIDC 换凭据 → `npm publish --tag beta|latest`（registry 侧按 trusted-publisher 绑定校验身份）。
- **未确认（本仓库之外）**：npmjs.com 上该包的 trusted-publisher 绑定（repo / workflow / environment 三项 claim 的具体取值）、provenance 是否随该绑定自动生成、是否需要额外 `--provenance` —— 均无法从仓库内容核实，属上线配置而非代码。
- **重构风险（流水线级）**：publish.yml **只跑 `npm test`，不跑 build/typecheck**。会话期间工作区已出现（由**其他执行者**加入、尚未提交）`"bin": "dist/cli.js"`、`"exports"/"main" → dist/`、`"build": "tsc"`、`"files": ["dist/", …]` 等改动；一旦以 `dist/` 作为发布产物，发布流水线**必须补一个 build 步骤**（否则会发布空的/过期的 `dist/`），且 `npm pack --dry-run` 与 `files` 白名单要同步。

### 12.5 `test/release.test.js` 与脚本的耦合关系

- `test/release.test.js:4` 静态 `import { verifyReleaseMetadata } from '../scripts/verify-release-metadata.js'` —— **`scripts/` 与 `test/` 的硬耦合**：函数名、参数对象形状、两条错误消息的语义都被测。
- 4 条用例：`v0.1.2-beta.1` + prerelease=true ✓；`v0.1.1` + false ✓；tag 不匹配 ✗（匹配 `/does not match package version/`）；prerelease 标志不匹配 ✗（匹配 `/prerelease status must match/`）。
- 第 4 条（`:35-43`）用 `spawnSync(process.execPath, [script])` 并把 `RELEASE_TAG`/`RELEASE_IS_PRERELEASE` 置空，断言 `status === 1` 且 stderr 匹配 `/must be provided/` —— **锁定了「脚本可独立执行 + 缺 env 时退出码 1」**，与 publish.yml 第 6 步的调用方式一致。
- 重构约束：可以换实现，但必须保留 (a) 具名导出 `verifyReleaseMetadata`、(b) 三条错误消息的关键子串、(c) 缺失 env 时退出码 1。

---

## 13. 0.3.0 测试基线

本节记录一次**实测**的 `npm test` 结果，作为重构前后的对照基线。

| 项 | 值 |
| --- | --- |
| 命令 | `npm test`（= `node --test`，来自 `package.json` scripts） |
| 时间 | 2026-09-27 约 14:27（本地）；`duration_ms` **62213.5586**，wall clock ≈ 63 s |
| 环境 | Windows (win32)、Node **v24.12.0**、npm **11.17.0**、git **2.53.0.windows.2** |
| 版本基线 | `package.json` version `0.3.0`；git HEAD `5b51dae81a4965d9b66fac2da93392184a61e294`（`chore(release): prepare v0.3.0`） |
| **退出码** | **0** |
| 用例统计 | `tests 152` / `pass 152` / `fail 0` / `cancelled 0` / `skipped 0` / `todo 0` / `suites 0`（无 `describe`，故 suites=0） |
| 逐文件通过数 | adapter 18 / contract-policy 6 / git 4 / integrations 2 / ledger 3 / pi-tool-strategy 7 / process 7 / release 4 / runner 2 / spec-f1 49 / spec-f2 27 / spec-f3 23 = **152** ✓ 与 §9 表逐行一致 |
| 最慢用例 | `one evolution is evaluated, committed, pinned, and can be rolled back` = **61630 ms**（占总时长 99%；它在真实 git 仓库上跑 20 轮完整演化）。其余 spec-f1/f2/f3 用例多在 0.2–3.0 s，每条都建 git worktree + ledger fixture |

复现：`npm test`；等价门禁 `npm run check`（= `node --check src/cli.js && node --check src/index.js && node --test`）。

**并发修改的重要说明（用这份基线前必读）**：采集期间**另一个执行者正在同一工作区并发重构**（工作区出现本人未改动的 `package.json` / `package-lock.json` 修改：`bin` 指向 `dist/cli.js`、`exports`/`main` 指向 `dist/`、新增 `build`/`typecheck`/`dep:check` 脚本；以及新文件 `tsconfig.json`、`dist/`、`src/types/`、`.graph/`、`CONTEXT-MAP.md`、`DECISIONS.md`、`docs/adr/`、`docs/contexts/`、`scripts/check-deps.mjs`）。核对结论：

- **本文档描述的源码未被改动**：`git status --porcelain -- src/ test/` 只显示未跟踪的 `src/types/`；`src/*.js` 与 `test/**` 全部与 HEAD 一致；两个 package.json 版本的 `"test"` 都是 `node --test`。因此 152/0 描述的是 HEAD `5b51dae` 的源码。
- 但**这份基线在合并并发改动后必须重测**（并发版本已把 `check` 改为 `typecheck && build && dep:check && test`）。

**写盘副作用审计**：

- 测试只写 `os.tmpdir()`（`mkdtemp`）并在 `after()`/`finally` 清理；`git status` 显示 `src/`、`test/` 无被修改的跟踪文件 → **未污染仓库**（除下面的 tmp 残留）。
- **tmp 残留（本人未删除**：并发执行者同时也在跑测试，无法归因单次运行）：`$TMPDIR/evofence-*`（多条，含 2026-09-25/26 的旧条目）与 `$TMPDIR/evofence-worktrees/<repoId>/`。其中后者是**代码层面**的残留：`runEvolution` 的 `finally` 只 `rm(runTempRoot)`（即 `<repoId>/<runId>`），**从不删除父目录 `<repoId>`**（建立于 `runner.js:409-413`，清理于 `:852-857`）；实测该目录下已累积 **151 个** `<repoId>` 目录（约 69 KB），且因 `runner.test.js` 用的是**临时仓库路径**，每次运行都产生新的 repoId，所以每跑一次测试就新增一个（几乎为空的）目录。这与 §9.6 的「worktree 清理未锁定」是同一段代码，重构时应一并处理（父目录清理 + 补测试）。

---

## 自检

本清单的完整性用以下可复现命令核对（本次全部执行过）：

1. **文件清单无遗漏**：`find src -type f | sort` → 18 个文件；与 §1 表格 18 行逐一对齐。`wc -l` 合计 4419，与任务描述的行数一致（文件数差异已在文档开头标注）。
   - 每个文件的 export 用 `grep -c "^export " src` 反查：合计 86 条，其中 `src/index.js` 8 条 re-export（展开为 18 个符号）、其余文件 78 条单符号 `export` 声明（78 个符号，实测去重后仍为 78，说明无重名）。§1「导出的真实符号」列中的每个名字都能在对应文件的 `export` 行原文找到（含 `export default`）；机器核对结果：`78/78 symbols present in doc`。
2. **公共 API 无遗漏**：`src/index.js` 的 8 行 re-export 共 18 个符号，全部出现在 §7.1 的代码块中。
3. **CLI 命令面无遗漏**：通读 `main()`（`src/cli.js:400-422`）逐行枚举得 **11 个 dispatch 分支**（init/run/proposal/evidence/gate/ledger/rollback/diff/experiment/report/status），与 §2.3 表格的 11 行 + `experiment` 的 2 个子动作一致；每个 CLI 内的子动作（`ledger` 4 个、`proposal inspect`、`evidence run`、`experiment run|export`）逐条列出。
   - **命令描述已修正（复核报告 F9）**：`grep -n "command === '" src/cli.js` 实际返回 **13 行**，因为 `--help`/`-h` 与 `--version`/`-v` 各自写在同一个 `if` 里（各算 1 行）；11 是「分支数」而不是「grep 行数」。本节结论（11 分支）正确，上一版的命令描述错误，已改。
4. **错误码无遗漏**：`grep -rhoE "'[A-Z][A-Z0-9_]{3,}'" src --include=*.js | sort -u` 得到 109 个去重字面量；人工剔除状态/决策/枚举/SQLite 原生码（`ACCEPT`、`REJECT`、`QUARANTINE`、`ESCALATE`、`RUNNING`、`ACCEPTED`、`PLATEAU`、`HARNESS_ERROR`、`BASELINE_UNHEALTHY`、`INCOMPLETE`、`FAILED`、`FINISHED`、`PASS`、`FAIL`、`TIMEOUT`、`OUTPUT_LIMIT`、`LOW/MEDIUM/HIGH/CRITICAL`、`CANDIDATE_READY`、`NO_CHANGE`→既是码也是决策、`BLOCKED`、`ENOENT`、`ESRCH`、`SQLITE_ERROR`、`SIGTERM`、`SIGKILL`、`HEAD`、`UNKNOWN`）后，剩余全部错误码与 §3.3 各表逐条对应；反向核对：§3.3 中的每个码都能用 `grep -rn "<CODE>" src` 命中调用点（`PROCESS_TREE_TERMINATION_FAILED` 例外，已单独标注为「被引用但从不抛出」）。
5. **哈希链可复现**：§4.4 的伪码与 `src/lib/ledger.js:8-16`（`eventHash`）、`:218-232`（`verify`）逐行对照；键序来自 `stableStringify` 的 `Object.keys(item).sort()`（`src/lib/fs.js:6-15`）。
6. **config 字段无遗漏**：`src/lib/contract.js` 的 **33 处** `invariant`/`new EvoFenceError`（其中 **24 条**码为 `INVALID_CONTRACT`）与 `src/lib/runner.js:17-28`（`loadConfig`）的 6 条 `invariant` 逐条映射到 §5.2/§5.3 表格。
   - **F3 的两类默认值计数核对**：`grep -c '??' src/lib/contract.js` = **2**，`grep -n '??' src/lib/contract.js` → `43` 与 `45`；除这两处外无任何默认值。因此 §5.2「代码默认」列中恰好 **2 行**标「有」、其余全部标「无」，且 §5.6 有对应行。
7. **门禁位置无遗漏**：`grep -nE "new EvoFenceError\(|invariant\(" src/lib/runner.js` 的 37 处 + `src/lib/evidence.js`、`src/lib/policy.js`、`src/lib/process.js`、`src/lib/fs.js` 的相关处，全部归入 §6 的四个分组之一。
8. **集成面**：`find integrations -type f | sort` → **22 个**文件（复核报告 F8 修正：上一版误写 23）；5 个目录下的每个 consumer 文件（`integrations/*/package.json`、`plugin.json`、`README.md`、`*.js`、`*.md`、`cordis.patch.yml`、`LICENSE`）都在 §8 出现；`.pi/extensions/evofence.js` 单独说明并由 `test/integrations.test.js:51-56` 交叉印证。
9. **测试无遗漏**：`for f in test/*.test.js test/*.test.mjs; do grep -c '^test(' $f; done` 与 §9 表格用例数逐行一致（49/27/23/2/18/7/3/4/6/7/2/4，合计 **152**）；已确认 12 个文件均为列 0 的顶层 `test(`（`grep -cE '^[[:space:]]+test\(' test/*` 无命中），因此不存在被缩进漏计或重复计数的用例；9 个小/中文件逐条列出全部用例名，3 个 spec 文件按主题分组并给出代表用例 + 总数（任务允许长文件归纳）。与 §13 的实测 `pass 152` 交叉一致。
10. **未确认项已显式标注**（共 5 处，均不编造结论）：`PROCESS_TREE_TERMINATION_FAILED` 的实际意图（只引用不抛出）；`.evofence/.gitignore` 中 `active-run.json` 的用途（当前代码不写入）；deepseek-harness 依赖 `evofence@0.2.0` 与当前 0.3.0 的差异是否有意为之；npm trusted-publisher 绑定（在 npmjs.com，仓库外，见 §12.4）；`require_proposal` / `require_claims` / `capabilities.shell.mode` 三个死键的原始设计意图（现状已用 grep 确认零引用）。
11. **F2 耦合清单核对**：`grep -rl "from '\.\./src" test` = **7**；`grep -rl "from '\.\./scripts" test` = 1；`ls test/*.test.js | wc -l` = 9（剩下 1 个 `integrations.test.js` 不 import 仓库代码）；`grep -rhoE "from '\.\./src/lib/[a-z-]+\.js'" test | sort -u` 的并集 = **11 个模块**。§7.1 与本项逐条一致（上一版误写「10 个测试文件」）。
12. **发布路径文件清单核对**：`ls scripts/*.js .github/workflows/*.yml` → 1 个脚本 + 2 个 workflow；`wc -l` = **36 / 26 / 49**，与 §12.1 表一致；`grep -n "npm run\|npm ci\|npm test\|npm pack\|npm publish\|node scripts" .github/workflows/*.yml` 的每一行都落在 §12.3/§12.4 的步骤清单里（逐行对应，无遗漏）。
13. **依赖图无环结论核对**：Node 脚本静态抽取 `from './…'` → `nodes: 18 edges: 50`、`cycles: NONE (DAG)`、`leaf modules (no internal imports): lib/errors.js, lib/pi-tool-strategy.js, lib/report.js, lib/status.js`；`grep -rn "better-sqlite3" src` → 仅 `src/lib/ledger.js:1`；`grep -rn "from '.*ledger.js'" src` → 4 个导入者（`cli.js:9`、`index.js:4`、`init.js:6`、`runner.js:5`）。
14. **F1 复核异议核对**：`grep -n "worktree" test/runner.test.js | tail -2` → `350` / `351`（即断言**存在**）；`grep -rn "worktree list" test/` → exit 1（复核报告用的字面模式匹配不到数组形式）—— 见 §9.6。
15. **测试基线核对**：§13 的 `exit 0 / tests 152 / pass 152 / fail 0 / duration_ms 62213.5586` 来自本次真实执行 `npm test`（非静态推断）；其逐文件通过数与 §9 表相加一致。
16. **`BUILTIN_PROTECTED` 条目数实测**（§6.4 引用本项）：`sed -n '3,22p' src/lib/policy.js | grep -c "^ *'"` → **19**（复核报告 F5 修正：上一版误写 21）；对照 `src/lib/policy.js:3-22` 逐条列出为 `.git/**`、`.evofence/**`、`.evofence-task.md`、`test/**`、`tests/**`、`**/test/**`、`**/tests/**`、`**/__tests__/**`、`**/*.test.*`、`**/*.spec.*`、`**/test_*.py`、`**/*_test.py`、`**/*_test.go`、`package.json`、`package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`、`bun.lock*`、`.github/workflows/**`。
17. **markdown 表格完整性自查**：用 Node 脚本统计「每个表格块内各行**未被转义**的 `|` 个数」，与表头不一致的行数 = **0**（31 个表格块）。本轮修复了 2 处真实缺陷：§6.4 「环境变量剥离」行的正则名列表与「1 条 shell 管道」在单元格内用了未转义的 `|`（会把表格列数冲破）——这类缺陷是本次修订新增的自查项发现的。
18. **行号存在性全量检查**：Node 脚本解析全文 **227 处** `file:line` 引用（**201 个唯一引用**、**275 个行端点**），逐个断言目标文件存在且行号 ≤ 该文件行数 → 结果「every referenced line exists in its file」，越界 **0 处**；另外故意加入 1 处不存在的引用（`src/lib/ledger.js:452`，该文件共 257 行）验证脚本会报错。行号与符号的对应关系则抽检了复核报告 F7 列出的 18 处 + 本轮新增的 16 处（§2.1 / §4.1-4.4 / §5.1 / §6.1-6.4 / §10 / §11 / §12），全部逐行回源确认。

本文件是本次任务的唯一写入产出物；本轮修订未修改 `src/`、`test/`、`package.json` 或任何配置文件，未执行 `npm publish`/`npm pack`/`git commit`/`git tag`/推送。**本轮按 DoD 要求执行了 `npm test`**（结果见 §13：exit 0，152/152），未手动删除临时目录（并发执行者同时在跑测试，无法归因单次运行）。

> 工作区状态提醒：本轮修订期间，另一执行者在同一工作区并发添加了 `package.json`/`package-lock.json` 修改与 `dist/`、`tsconfig.json`、`src/types/`、`.graph/` 等新文件。本文件**未**描述那些改动（不在盘点范围内），也**未**回滚它们。
