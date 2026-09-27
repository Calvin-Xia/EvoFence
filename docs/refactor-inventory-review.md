# EvoFence 实现盘点文档 · 独立交叉复核报告

- 被复核对象：`docs/refactor-inventory.md`（831 行，untracked）
- 审计基线：`git status --porcelain` → 仅 `docs/refactor-inventory.md`、`nul`、`.pi/` 为 untracked；`src/`、`test/` 均干净（HEAD `5b51dae`），因此文档的行号应对应当前文件内容。
- 审计方式：全部只读（`read`/`grep`/`find`/`wc`/`node -e`）。未修改仓库任何文件；哈希链验证所用的临时 SQLite 建在 `os.tmpdir()` 并在同一条命令内 `rmSync` 删除（输出末尾自证 `temp dir removed: true`）。未运行任何会写仓的测试。
- 复核人角色：独立第二双眼，所有结论均从源码重新推导，未采信文档论断。

---

## 1. 一句话结论

**需修订。** 文档的内容层（错误码全集、哈希链算法、导出符号、事件类型、集成命令面、风险评分）经独立复算基本为真，哈希链 §4.4 可以逐字节复现；但**计数类结论 4 处错、行号引用约 18 处错、1 条测试覆盖论断是编造**，且缺一张重构必需的模块依赖图。修好下面 F1–F12 后可作真相源。**无阻塞级发现**（见 §3 末）。

---

## 2. 八项必做校验

| # | 校验项 | 结论 | 实测命令 + 输出摘要 |
|---|---|---|---|
| 1 | 哈希链算法可复现性 | **一致** | 从 §4.4 独立实现（`node --input-type=module -e`，自带 `stableStringify` + `crypto` sha256）对比源码 `eventHash`：**20/20 合成事件 + 2 个 undefined 边界全部相等**；真实 ledger（`Ledger` 类在 `os.tmpdir()` 建 3 事件，readOnly 回读裸行）：`seq=1/2/3 doc==stored`，`verify()={"valid":true,"events":3,"head":"df6c93ea91af…5196"}`，改 `payload_json` 后 `verify()={"valid":false,"sequence":1,"expected_previous_hash":"0000…","observed_hash":"5588356f…"}`。字段/顺序/`ZERO_HASH='0'.repeat(64)`/`event_hash` 不入摘要 全部与 §4.4 一致。**仅凭 §4.4 可复现（JS 实现者），但有 3 项边界未写**（见 §6） |
| 2 | 错误码表完整性 | **一致（计数除外）** | 自写扫描器抽取 `new EvoFenceError(` 第 1 参 / `invariant(` 第 2 参（跨行）→ **54 个去重码**；与 §3.3 逐项比对：**遗漏 0、编造 0**（`PROCESS_TREE_TERMINATION_FAILED` 已正确标为“只引用不抛出”，`grep -rn` 仅 `runner.js:837`）。但 3 处计数错（F6） |
| 3 | CLI 命令面完整性 | **一致** | 通读 `src/cli.js`：11 个 dispatch 分支 + `ledger` 4 子动作 + `proposal/evidence/experiment` 子动作，与 §2.3 表逐行对应；flag 全集 `run(--goal/--adapter/--iterations/--max-wall-clock-ms/--allow-unisolated-agent/--allow-readable-holdout/--json)`、`status/report/diff(--json)` 无遗漏；3 个 `parseOptions` 调用点全部覆盖。仅 F9/F10 两处小瑕疵 |
| 4 | 导出符号 | **一致** | `grep -rn "^export" src` → 86 行；`index.js` 8 行 re-export 展开 18 符号，其余 78 符号。§1 表逐文件符号数（adapter 8 / audit 2 / contract 5 / errors 2 / evidence 1 / fs 8 / git 20 / init 1 / ledger 2 / pi-ext 2 / pi-strategy 5 / policy 9 / process 6 / report 2 / runner 2 / status 3 / cli 0 / index 8）与实测**完全一致**；§7.1 的 18 个公共符号与 `index.js:1-8` 逐字一致 |
| 5 | 测试数量（12 文件 152 例） | **一致** | `grep -c '^test('` → 49/27/23/2/18/7/3/4/6/7/2/4 = **152**；`grep -cE '^[[:space:]]+test\('` = 0，`describe(`/`it(` = 0；行数 1456/1080/711/357/299/209/93/72/69/63/57/44 全对。未跑测试（写盘风险），纯静态计数 |
| 6 | 四条门禁（抽 budget + isolation） | **一致（1 处计数错）** | budget：`parseNumericBudget`、`usdToMicros`(runner:41 / adapter:26)、`recordTokenUsage`(194)、`recordCostUsage`(263)、`runBudgetedAdapter`(437)、`budget.exhausted/usage_unavailable/tokens.observed/usd.observed` 事件行号、`INVALID_BUDGET`/`BUDGET_ABOVE_POLICY`/`UNSUPPORTED_*_PROCESS_CONTROL` 触发条件全部核对为真；isolation：`createWorktree --detach`(git:45)、`assertInside`(355/854)、metadata 三函数(53/61/69)、`SENSITIVE_ENV_NAME` 正则逐字符一致 + extra 同名删除、`readJsonInside`、report 路径防护链、只读 ledger 全部核对为真。**唯一内容错：`BUILTIN_PROTECTED` 21→19 条**（F5） |
| 7 | 8 条抽样反查 | **2/8 命中** | 见 §4 |
| 8 | 遗漏扫描（src 16 文件） | **部分一致** | `find src -type f` = **18 文件**，§1 表 18 行无遗漏，无跳过文件。但缺模块依赖图 / `better-sqlite3` 顶层 import 事实 / `runner.js` 内部函数清单 / `scripts/` + CI 面（见 §5） |

---

## 3. 发现清单

### F1｜**重要**｜§9 表 + §9.4 runner.test.js 描述
- 文档：「`one evolution is evaluated, committed, pinned, and can be rolled back`（真实 `git init` worktree 端到端；**末尾断言 `git worktree list` 只剩 1 个 tree，即 worktree 清理生效**）」
- 反例：`grep -rn "worktree list\|openTreeCount" test/` → **exit 1，零命中**；`grep -rn "worktree" test/runner.test.js` 只有 `.evofence-out` 相关路径。runner.test.js 结尾断言的是 `ledger.verify().valid` 与 `ledger.rollback()`（:109-119），**从没有 worktree 数量断言**。
- 影响：让重构者误以为 worktree 清理已被测试锁定——实际 `removeCandidate`/`runTempRoot` 清理**无测试保护**，是最容易在重构中静默破坏的隔离不变量。
- 建议修法：删除该断言描述；在 §9.5 明确写「worktree 清理**未被测试锁定**（仅 `runner.test.js` 间接跑通）」，并标注为重构需补的测试。

### F2｜**重要**｜§7.1、§9、§10.6 item 27
- 文档三处称「10 个 `test/*.test.js` 直接 import `../src/...`」。
- 反例：`grep -rl "from '\.\./src" test | wc -l` → **7**（adapter/contract-policy/git/ledger/pi-tool-strategy/process/runner）。`ls test/*.test.js | wc -l` → **9**；`integrations.test.js` 不 import 任何 src（只当文本读文件），`release.test.js` import 的是 `../scripts/verify-release-metadata.js`。
- 影响：§10.6#27 是给重构者的耦合清单，多报 3 个文件会误导“改名即同步”的范围判断。
- 建议修法：改为「7 个 `.test.js` 静态 import `../src`，1 个 import `../scripts`，1 个只读文件文本，3 个 `.mjs` 用 `process.cwd()` 动态 import」。

### F3｜**重要**｜§5.2「默认值」列
- 文档把模板值当成代码默认值：`objective.direction = maximize`、`objective.min_delta = 0.01`、`acceptance.hidden_regression_tolerance = 0`、`allowed_evolution_surface = ["**/*"]`、`protected_paths`、全部 `budgets.*`。
- 反例：`src/lib/contract.js:21-61` 中**只有两处 `??`**：`:44 per_command_timeout_ms ?? 120000`、`:46 max_output_bytes ?? 1_048_576`。其余全是硬 `invariant`——缺字段（`undefined`）直接 `INVALID_CONTRACT`，不存在代码兜底。模板 `templates/contract.yaml` 提供这些值。
- 影响：重构若“顺手加上代码默认值”，就把 fail-closed（缺契约字段即拒绝）静默变成 fail-open。
- 建议修法：「默认值」列拆成「**代码默认（仅 2 项）**」与「**模板值（无代码兜底、缺失即 INVALID_CONTRACT）**」两列。

### F4｜**重要**｜§5.2 capabilities 行
- 文档列 `capabilities.network / dependency_install / credentials`，漏掉模板里的 **`external_api: deny`**（`templates/contract.yaml:29`）。
- 反例：`assessCapabilities` 用 `contract.capabilities[capability]` 动态查表（`policy.js:148`），能力名来自 proposal 的 `requested_capabilities`，所以 `external_api` 是**真实生效的审批门**；而 `taskContents`（`runner.js:74-79`）只透传 network/dependency_install/credentials，`external_api` 与 `capabilities.shell.mode` **从不被代码读取**（`grep -rn 'external_api\|shell\.mode' src` → 零命中）。
- 建议修法：补 `external_api`；并明确列出“模板有、代码不读”的死键（现仅标注了 `require_proposal`/`require_claims`，应扩到 `external_api`、`capabilities.shell.mode`）。

### F5｜**重要**｜§6.4 isolation 表
- 文档：「`BUILTIN_PROTECTED`（**21 条**）」。
- 反例：`src/lib/policy.js:3-22` 逐条数 = **19 条**（`.git/**` … `.github/workflows/**`）。
- 建议修法：改 19。

### F6｜**重要**｜§3.2 / §3.3 计数
- `INVALID_CONTRACT`「**30 处**」→ 实测 **24**（`grep -c INVALID_CONTRACT src/lib/contract.js` = 24，全仓库 = 24）。
- `LEDGER_CORRUPT`「audit.js **27 处**，38–273 行」→ 区间对（首个 38、末个 273），但实测 **30 处**（`grep -c LEDGER_CORRUPT src/lib/audit.js` = 30）。
- `USAGE`「共 **14 处**」→ 文档自己列的 16 个行号就是实际全集（`grep -n USAGE src/cli.js` = 16 行：61,95,96,120,132,147,163,179,203,235,339,341,363,378,380,421），**自相矛盾**。
- 注：§3.2 的分布计数（runner 37 / contract 33 / audit 31 / cli 28 / policy 26 / adapter 14 / git 10 / fs 7 / init 7 / ledger 5 / errors 2 / evidence 1 / process 1 = 202）经 `grep -oE "(new EvoFenceError|invariant)\(" | wc -l` 逐文件核对**完全正确**。
- 建议修法：三处计数改为 24 / 30 / 16。

### F7｜**重要**（系统性）｜§2.1 / §4.3 / §6.x / §10.x 行号
文档共 **197 处 `src/....js:NNN` 引用**。抽检发现下列约 18 处指向错误行（内容正确、指针错）：

| 文档 | 实际 | 位置 |
|---|---|---|
| `HELP` cli.js:18 | 20 | §2.1 |
| help 打印 cli.js:400 | 402 | §2.1 |
| `--version` cli.js:404 | 406 | §2.1 |
| `verify()` ledger.js:246-258 | 218-232 | §4.4 |
| `recordGenerationTx` ledger.js:64-72 | 67-73 | §4.3 |
| `parseNumericBudget` runner.js:35 | 33 | §6.3 |
| `usdToMicros` adapter.js:25 | 26 | §6.3 |
| `recordTokenUsage` runner.js:180 | 194 | §6.3 |
| `recordCostUsage` runner.js:265 | 263 | §6.3 |
| `currentPolicyHashes` runner.js:110-119 | 140 | §6.1 |
| `checkTaskFile` runner.js:139 | 177 | §6.4 |
| `ensurePrivateIgnored` runner.js:347 | 348 | §6.4 |
| `assertInside(tempParent,…)` runner.js:845 | 854 | §6.4 |
| `canonicalizePath` / `sharesIdentityWithState` / `assertReportOutputOutsideState` cli.js:262 / 282 / 302 | 258 / 288 / 325 | §6.4 |
| `assertGitVersionAtLeast` audit.js:296 | 292 | §10.6#31 |
| `stopGraceMs: 0` adapter.js:557 | 542 | §10.4#20 |
| `isMissingEventsSchema` cli.js:191 | 196 | §10.6#37 |
| repoId `sha256(root)` runner.js | `sha256(root.toLowerCase())` runner.js:409 | §6.4 |

对照：§3.3 的错误码行号（`ledger.js:76`、`audit.js:276`、`cli.js:125/153/156` …）、§3.1 的 6 个 `exitCode` 行（115/142/171/230/397/428）、§4.2 的 13 个事件行（475/496/505/537/607/666/715/819/850 …）、§1 全部行数**均精确**。
- 建议修法：用脚本批量回填行号（或去掉易腐的行号，改用符号锚点）。

### F8｜**轻微**｜§自检 item 8
- 「`find integrations -type f` → **23 个文件**」→ 实测 **22**。

### F9｜**轻微**｜§自检 item 3
- 「`grep -n "command === '" src/cli.js` 得到 11 个分支」→ 该 grep 返回 **13 行**（`--help`/`-h` 同行、`--version`/`-v` 同行各算一行 + 11 分支）。结论 11 分支对，命令描述不对。

### F10｜**轻微**｜§2.3 `experiment export`
- 文档写 `commandLedger(['export', value])`；源码是 `commandLedger(['export', value].filter(Boolean))`（`src/cli.js:379`）。

### F11｜**轻微**｜§9.4 runner.test.js 覆盖描述
- 只写「端到端 accept/rollback + checkFinalCandidate」，实际还覆盖 token/USD 预算耗尽、`TOKEN_USAGE_UNAVAILABLE`、`UNSUPPORTED_COST_BUDGET`、`CLAUDE_SANDBOX_REQUIRED` 拒绝路径（:164-236）。低估覆盖会误导重构风险评估。

### F12｜**轻微**｜§3.1
- 「`1` | 顶层 catch：任何抛出的 **EvoFenceError**」→ 源码 `catch (error)` 捕获**任意** error（非 Error 抛掷同样 `exitCode=1`；`printError` 对无 `code` 者只打印 message）。

**未发现**的其他类型：无编造的错误码名、无编造的导出符号、无编造的事件类型、无编造的门禁函数名。

**阻塞级发现：无。** 哈希链算法（最高风险项）经逐字节复算为真；错误码/导出/事件类型/门禁触发条件均无实质错误。上述 F1–F6 若被当作事实采纳，会造成“测试覆盖被高估”与“默认值语义反转”两类重构决策偏差，但都不会直接诱导改坏已在运行的不变量；F7–F12 属誊写精度问题。

---

## 4. 抽样反查命中率

**指定 8 条**（含行号/符号，逐条回源码）：

| # | 论断 | 结果 |
|---|---|---|
| 1 | §1 `adapter.js` 584 行 / 8 导出 | ✅ 命中（584 行，8 个 `^export`） |
| 2 | §2.1 `HELP` 在 `cli.js:18` | ❌ 实际 20 |
| 3 | §3.3 `USAGE` 共 14 处 | ❌ 实际 16（且与其自列 16 行号矛盾） |
| 4 | §3.3 `INVALID_CONTRACT` 30 处 | ❌ 实际 24 |
| 5 | §4.4 hash 算法 + `ZERO_HASH` + 6 键字母序 | ✅ 命中（真实 ledger 3 条 + 20 例逐字节全等） |
| 6 | §6.3 `recordTokenUsage` 在 `runner.js:180` | ❌ 实际 194 |
| 7 | §6.4 `BUILTIN_PROTECTED` 21 条 | ❌ 实际 19 |
| 8 | §9.4 runner.test.js「末尾断言 git worktree list 只剩 1 tree」 | ❌ 无此断言（编造） |

**命中率 2/8。** 扩展样本再加 4 条：§3.1 exitCode 6 行 ✅、§9 总计 152 例 ✅、§10.5 `allowScripts better-sqlite3@12.11.1` + lock 12.11.1 ✅、§3.3 `LEDGER_CORRUPT` 27 处 / 38–273 ⚠️（区间对、计数错）→ 扩展 **5 命中 + 1 部分 / 12**。

失败样例集中在**计数**与**行号**两类；凡属“符号存在性/内容语义”的抽样（错误码名、导出、事件类型、评分公式、集成命令面）全部为真。这说明文档是从源码如实读出的，错误来自誊写/统计而非臆造。

---

## 5. 重构必须知道但文档缺失的 Top 3

1. **模块依赖图与原生依赖的加载时机（缺失）。** 文档零处提到内部 import 关系（`grep -n "依赖关系\|循环依赖\|依赖图" docs/refactor-inventory.md` → 零命中）。实测：`better-sqlite3` 只在 `src/lib/ledger.js:1` 顶层 `import`，而 `ledger.js` 被 `src/index.js`、`cli.js`、`init.js` 直接引——**只要 import 这个包或跑任何 CLI 命令，就会立刻加载原生模块**（读只读命令也一样）。重构若想把 ledger 改成惰性/可选依赖，将改变安装与加载契约。同时实测依赖图是 DAG（除 `cli.js`/`index.js` 外无人引 `runner.js`，无环），这本身是重构自由度的重要事实，文档未记。
2. **`src/lib/runner.js` 的内部结构与状态机（只记了门禁点，没记分解面）。** 858 行、最大最耦合的文件，文档 §1 一句话带过。实际需记录的函数：`loadConfig`(17)、`parseNumericBudget`(33)、`usdToMicros/usdFromMicros`(41/65)、`taskContents`(69)、`publicFailurePacket`(106)、`adapterEvent`(114)、`currentPolicyHashes`(140)、`helperPath`(151，**不是路径工具而是 `.evofence-task.md/.evofence-out` 判定**)、`runAdapter/invokeAdapter`(155/172)、`checkTaskFile`(177)、`recordTokenUsage/recordCostUsage`(194/263)、`ensurePrivateIgnored`(348)、`removeCandidate`(354)、`runBudgetedAdapter`(437)，以及 `runEvolution` 的 status 状态机与 `catch` 映射（`runner.js:837` 把 4 个 code 折成 `RESOURCE_EXHAUSTED`，其余 `HARNESS_ERROR`）。没有这张图，任何对 858 行的拆分都会盲拆。
3. **契约默认值语义与被模板“装饰”但代码不读的键（记录错误或不完整）。** 见 F3/F4：哪 2 个字段有代码默认、其余为何“缺失即 fail-closed”；以及 `external_api`（真实生效的能力门）、`require_proposal`/`require_claims`/`capabilities.shell.mode`（代码零引用）。这决定了重构者能否安全地“加默认值/删死字段”。

*附（超出 Top3，但建议补记）：* `scripts/verify-release-metadata.js` 与 `.github/workflows/{ci,publish}.yml` 在文档中零命中，而 `test/release.test.js` 正是测该脚本、`publish.yml:41` 直接 `node scripts/verify-release-metadata.js`——发布路径不在任何盘点范围内。

---

## 6. 对第 1 项“仅凭 §4.4 能否复现”的直接回答

**能，前提是按文档同款 JS 语义实现。** 用纯 §4.4 派生实现（自己的键排序 + 自己的 `JSON.stringify` + `crypto` sha256），对真实 ledger 3 条事件与源码 20 例合成事件**逐字节命中**，且 §4.4 给出的排序后字符串形态（`{"created_at":…,"seq":1}`）与实测完全一致。`event_hash` 确不入摘要、`payload_json` 以字符串参与、`ZERO_HASH='0'*64`、`sha256` 小写 hex——均核实。

**§4.4 本身缺的 3 条（复现边界，非 JS 实现者会踩）：**
1. `stableStringify` 的边界语义：值为 `undefined` 的键会**被丢弃**（且数组内 `undefined` → `null`）；非 ASCII（中文/emoji）**不转义**、按 UTF-8 原样输出；数字按 ECMAScript `Number::toString`（实测 `1e21` 存为 `"1e+21"`）。§4.4 只说“递归排序 + JSON.stringify（无缩进无空格）”，这些边界只在 §10.1 item 1 提了 `undefined`。
2. sha256 的**输入编码**未在 §4.4 说明（“是字符串不是 Buffer”但没写 utf8）。
3. `created_at` 的格式保证（`new Date().toISOString()`，毫秒/UTC/`Z`）只在 §10.1 item 5，不在 §4.4。

建议：§4.4 补一句「等价于 JS `JSON.stringify` 的默认语义 + 递归键排序；`payload_json` 以 utf8 字符串喂 `sha256`」，或直接把 `src/lib/fs.js:6-19` 的 6 行原文贴进来（低风险、高收益）。

---

## 7. 复核留痕（可复现命令清单）

- 文件/行数/导出：`find src -type f | sort`、`wc -l src/**`、`grep -rn "^export" src`
- 错误码全集：自写 `node -e` 扫描器（`new EvoFenceError(` 第 1 参 / `invariant(` 第 2 参，支持跨行与注释跳过）→ 54
- 哈希链：`node --input-type=module -e` 内联独立实现 + `os.tmpdir()` 临时 ledger（建/验/篡改/`rmSync` 清理）
- 测试计数：`grep -c '^test('`、`grep -cE '^[[:space:]]+test\('`、`grep -cE '^[[:space:]]*(describe|it)\('`
- 门禁：`grep -n` 定位 `runner.js`/`adapter.js`/`git.js`/`process.js`/`policy.js`/`cli.js` 的门禁函数与触发条件
- 集成面：`find integrations .pi .claude-plugin .agents -type f`、逐文件 `grep -n`
