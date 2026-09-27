# 测试覆盖点映射表（0.3.0 → 0.4.0）

本表由节点 `l3_tests_unit` 产出，回答一个问题：**`docs/refactor-inventory.md` §9 里的 12 个 0.3.0 测试文件，在重构后的架构里各自由哪个测试文件/用例继续锁定。**

- 来源清单：`docs/refactor-inventory.md` §9（含 §9.4 的用例全名、§9.5 不变式速查、§9.6 对复核 F1 的更正）。
- 方法：`test/**` 全部 import 指向 `dist/`（ADR-0004：测试以构建产物为被测对象），`npm test` = `npm run build && node --test`，先构建再跑。
- 运行：`npm test`，退出码 0 且 `fail` 为 0。
- 用例基线：0.3.0 §9 的 12 个文件合计 **152** 个用例；本节点开工前合计 **204**；l3_tests_unit 新增 17 个 → **221**（此为该节点产文时的时点快照）。
- **修订（fix/r3 复核整改 F9）**：本文原把 `integrations` 行现状数记 2（实为 4）、`release` 行记 4（实为 14），合计写成 221 与实测终值差 12。现把两行现状数更新为实测值（见 §2.11/§2.12），全库合计更新为 **234**（12 个旧文件 172 + 非旧 12 的新文件 62）；本文不再声称「221 = 现状」，221 只作 l3_tests_unit 时点快照保留。
- 计数口径：`node --test` 逐文件实测后求和（`npm test` 全绿：234/234，fix/r3 复核整改时粘贴）。
- 命名约定：本节点新增的补强文件为 `test/unit-*.test.js`（既有文件只改 import 路径与新增用例，不削弱既有断言）。

## 1. 迁移总表（12 条，条目数 = §9 旧文件数）

| # | 0.3.0 文件 | §9 用例数 | 现状用例数 | 新架构对应测试文件 | 本次变更 |
| --- | --- | --- | --- | --- | --- |
| 1 | `test/spec-f1.test.mjs` | 49 | 49 | 同名文件（`repoImport` 从 `process.cwd()` 动态解析，目标已指向 `dist/**`） | 无（L2 已完成路径迁移） |
| 2 | `test/spec-f2.test.mjs` | 27 | 27 | 同名文件（同上） | 无 |
| 3 | `test/spec-f3.test.mjs` | 23 | 23 | 同名文件（同上） | 无 |
| 4 | `test/runner.test.js` | 2 | 2 | 同名文件 + **新增** `test/unit-worktree-cleanup.test.js` | **补 worktree/临时目录清理回归（DoD 4）** |
| 5 | `test/adapter.test.js` | 18 | 18 | 同名文件（`../dist/lib/adapter.js`） | 无 |
| 6 | `test/pi-tool-strategy.test.js` | 7 | 7 | 同名文件（`../dist/lib/pi-tool-strategy*.js`） | 无（并行节点 `l3-integ` 独占，本节点不触碰） |
| 7 | `test/ledger.test.js` | 3 | 3 | 同名文件（`../dist/lib/ledger.js`）+ **新增** `test/unit-ledger-chain.test.js` | **补哈希链篡改负向用例（DoD 3）** |
| 8 | `test/git.test.js` | 4 | 4 | 同名文件（`../dist/lib/git.js`） | 无 |
| 9 | `test/contract-policy.test.js` | 6 | 14 | 同名文件（`../dist/lib/{contract,policy}.js`、`dist/lib/gate/index.js`） | L2 gate 域新增 8 例（见 §2.9） |
| 10 | `test/process.test.js` | 7 | 7 | 同名文件（`../dist/lib/process.js`） | 无 |
| 11 | `test/integrations.test.js` | 2 | **4** | 同名文件（不 import 仓库代码，只读插件文本） | 无（并行节点 `l3-integ` 独占；`l3-integ` 另加 2 例，见 §2.11） |
| 12 | `test/release.test.js` | 4 | **14** | 同名文件（import `../scripts/verify-release-metadata.js` 与 `../scripts/verify-publish-workflow.js`，非 `src/` 产物） | 无（`l4_release` 另加 10 例，见 §2.12） |

> §9 的 12 条全部有落点，无缺项。

## 2. 逐文件覆盖点映射

### 2.1 `test/spec-f1.test.mjs`（49 例，diff 审计视图）

| 覆盖点（§9.1 分组） | 新架构对应测试文件 | 代表用例 |
| --- | --- | --- |
| 基本报告形状 / 证据不外泄 | `test/spec-f1.test.mjs` | `generationDiff returns the full documented report for an accepted generation`、`formatGenerationDiff renders the audit view without leaking evidence output` |
| 哈希链/篡改 | 同名 + `test/unit-ledger-chain.test.js`（补强，见 §3.1） | `... rejects a tampered ledger with EvoFenceError LEDGER_CORRUPT before presenting evidence`、`CLI diff exits 1 with LEDGER_CORRUPT when the ledger hash chain is broken` |
| 链接唯一性/歧义 | 同名 | `... rejects ambiguous evidence candidates for the accepted artifact` 等 8 例 |
| 顺序与窗口 | 同名 | `... rejects gate evidence that follows the acceptance` 等 4 例 |
| 门禁/证据一致性 | 同名 | `... rejects a generation with no ACCEPT gate decision` 等 15 例 |
| 增量基线 | 同名 | `... derives improvement from a validated prior acceptance` 等 6 例 |
| diff 口径 | 同名 | `... recomputes diff_sha256 and flags a ledger claim that does not match the git diff` 等 3 例 |
| CLI 用法 | 同名 | `CLI diff exits 1 with GENERATION_NOT_FOUND for an unknown generation` 等 2 例 |

### 2.2 `test/spec-f2.test.mjs`（27 例，report 视图）

| 覆盖点（§9.2 分组） | 对应测试文件 | 代表用例 |
| --- | --- | --- |
| 形状与渲染 / CLI report | `test/spec-f2.test.mjs` | `buildEvolutionReport returns the documented report shape for a seeded ledger`、`CLI report --json/...` |
| fail-closed（symlink/hardlink/protected state） | 同名 | `... refuses to summarize payloads behind a forged hash chain`（该例用 `forgeEventHashChain` 证明**可重算的伪造链能通过 verify()**，把"篡改"与"重算"两件事分开）、`CLI report rejects outputs hard-linked to control-plane state` |
| 预算/用量口径 | 同名 | `... counts final cumulative totals from exhaustion and run-level events` 等 4 例 |
| objective 历史快照 | 同名 | `... leaves unknown objective direction null instead of defaulting to maximize` |
| run 状态 / 原子快照 | 同名 | `... marks run.failed runs as FAILED and reports the failure code`、`Ledger.readSnapshot returns integrity, events and generations from one transaction` |

### 2.3 `test/spec-f3.test.mjs`（23 例，status 视图）

| 覆盖点（§9.3 分组） | 对应测试文件 | 代表用例 |
| --- | --- | --- |
| 形状与渲染 / CLI status | `test/spec-f3.test.mjs` | `buildStatus returns the documented status with totals across all runs and a capped recent_runs`、`formatStatus renders Active generation: none and Ledger integrity: FAILED for a stub status` |
| 空库/坏库边界 | 同名 | `CLI status reports a partially missing ledger schema as LEDGER_UNAVAILABLE instead of empty`、`CLI status treats a zero-byte ledger file as an empty ledger` |
| 完整性/失败呈现 | 同名 + `test/unit-ledger-chain.test.js`（补强，见 §3.1） | `buildStatus reports invalid ledger integrity for a tampered ledger`、`CLI status exits 1 when the ledger hash chain is tampered and 0 when healthy` |

### 2.4 `test/runner.test.js`（2 例，端到端演化）

| 覆盖点（§9.4） | 对应测试文件/用例 |
| --- | --- |
| `checkFinalCandidate` 四条返回（accept / CAPABILITY / EVIDENCE_MODIFIED / POLICY） | `test/runner.test.js` → `final candidate validation honors approved capabilities and detects evidence mutations` |
| 真实 `git init` worktree、20 轮 accept、rollback、protected-path QUARANTINE | `test/runner.test.js` → `one evolution is evaluated, committed, pinned, and can be rolled back` |
| 预算与拒绝路径（token/USD 耗尽、`*_USAGE_UNAVAILABLE`、`UNSUPPORTED_*`、`CLAUDE_SANDBOX_REQUIRED`、`PRIVATE_ORACLE_READABLE`、`process.tree_termination_failed`） | 同上（用例内各段） |
| **worktree 清理与临时目录回收（复核 F1：原为弱覆盖）** | **`test/unit-worktree-cleanup.test.js`（本节点新增，见 §3.2）**；`test/runner.test.js:350-351` 的末尾全局断言保留为冒烟兜底 |

### 2.5 `test/adapter.test.js`（18 例，适配器 argv 与用量）

| 覆盖点（§9.4） | 对应测试文件 | 代表用例 |
| --- | --- | --- |
| Pi 显式扩展加载 | `test/adapter.test.js` | `Pi strategy loads one explicit EvoFence extension while keeping extension discovery disabled` |
| Codex/OpenCode/Claude 用量与失败关闭 | 同名 | `Codex usage stays unavailable when a completed turn omits usage or output is truncated`、`Claude Code requires whole-tree result telemetry and rejects incomplete results` |
| 实时 token 监视器（不双计、预算中断后仍消费、无尾换行 flush） | 同名 | `token monitor keeps consuming events after the first budget stop`、`token monitor flushes a final JSON event without a trailing newline` |

### 2.6 `test/pi-tool-strategy.test.js`（7 例，pi 工具策略）

| 覆盖点（§9.4） | 对应测试文件 | 代表用例 |
| --- | --- | --- |
| 只读工具选择 / 实现阶段保持相位起始顺序 | `test/pi-tool-strategy.test.js` | `proposal selects only active read-only tools and implementation orders the existing active set` |
| 工具错误降级与单次重复调用阻断 | 同名 | `tool errors demote that tool, add recovery feedback, and block an identical retry once` |
| 扩展 fail-open 与遥测脱敏 | 同名 | `Pi extension fails open and restores its original tool order if a controller API call fails`、`strategy telemetry keeps tool names and outcomes while discarding arguments and output` |

> 该文件由并行节点 `l3-integ` 独占（本节点按派单边界不触碰）。import 已指向 `dist/lib/pi-tool-strategy{,-extension}.js`。

### 2.7 `test/ledger.test.js`（3 例，账本追加与只读面）

| 覆盖点（§9.4） | 对应测试文件 | 代表用例 |
| --- | --- | --- |
| 哈希链追加 + append-only 触发器 + rollback | `test/ledger.test.js` | `SQLite ledger appends hash-chained events and keeps generation history`（含 `assert.throws(... /append-only/)`） |
| 只读 CLI 不建库、recent 脱敏 | 同名 | `ledger CLI recent returns sanitized run summaries and read-only commands do not create a ledger` |
| 拒绝迭代只计一次 / failed run 迭代数推断 | 同名 | `recent run summaries count rejected iterations once and infer failed run iteration counts` |
| **篡改定位（previous_hash / event_hash / seq 缺口 / 错误字段精确值）** | **`test/unit-ledger-chain.test.js`（本节点新增，见 §3.1）** | 见 §3.1 |

### 2.8 `test/git.test.js`（4 例，Git 兼容面）

| 覆盖点（§9.4） | 对应测试文件 | 代表用例 |
| --- | --- | --- |
| `diffHash` 口径 | `test/git.test.js` | `diff hash includes an addition-only candidate and matches its committed generation` |
| 版本解析与 `GIT_VERSION_UNSUPPORTED` | 同名 | `git version parsing accepts 2.42+ and rejects older or unparseable versions`、`requireGitVersion rejects unsupported versions with GIT_VERSION_UNSUPPORTED` |
| 版本探测 | 同名 | `assertGitVersionAtLeast probes the installed git` |
| worktree 计数能力（`openTreeCount`，0.3.0 零调用导出） | **`test/unit-worktree-cleanup.test.js`（本节点新增，首次调用）** | `removeCandidate deletes a registered candidate worktree and stays idempotent`、端到端用例的 `treeCount` 采样 |

### 2.9 `test/contract-policy.test.js`（6 → 14 例）

| 覆盖点 | 对应测试文件 | 用例 |
| --- | --- | --- |
| 模板可校验 + 重复 key 拒绝 | `test/contract-policy.test.js` | `the generated contract template validates and YAML duplicate keys are rejected` |
| token 预算是正安全整数 | 同名 | `token budgets require positive safe integers` |
| glob 递归/单段 | 同名 | `glob matching supports recursive and single-segment patterns` |
| 内建受保护路径 | 同名 | `policy protects tests, manifests, local policy, and CI by default` |
| proposal/claims 结构化证据字段 | 同名 | `proposal and claims require structured evidence fields` |
| 能力默认拒绝 + 风险随面扩大 | 同名 | `capability requests default to denied and risk grows with surface` |
| **（L2 gate 新增 8）四条门禁判定 fail-closed** | 同名 | `gate judgement entries fail closed and name the missing input`、`budget judgement keeps the 0.3.0 thresholds and fails closed on missing counters`、`isolation gate fails closed on worktree metadata and holdout opt-ins`、`evidence gate recomputes public pass and refuses unreadable objective scores`、`policy gate and candidate-check verdicts keep the 0.3.0 mapping`、`contract gate attributes drift to the changed policy document`、`capabilities.external_api is a live dynamic-table capability gate`、`template-only contract keys are documented as unwired, not left as fake gates` |

### 2.10 `test/process.test.js`（7 例，进程与 env 剥离）

| 覆盖点（§9.4） | 对应测试文件 | 代表用例 |
| --- | --- | --- |
| 输出限长/截断/超时终止 | `test/process.test.js` | `process runner captures bounded output and exit status`、`process runner terminates a process that exceeds its time budget` |
| 回调触发停止（预算） | 同名 | `process runner stops when a streamed output callback reports a budget trigger` |
| 进程树能力探测 | 同名 | `process-tree termination capability probe is bounded and returns a boolean` |
| **env 剥离** | 同名 | `secret-like environment values are not passed to child processes` |
| objective 末行解析 | 同名 | `objective parser reads only a finite final score` |

### 2.11 `test/integrations.test.js`（4 例，集成/插件清单）

| 覆盖点（§9.4） | 对应测试文件 | 用例 |
| --- | --- | --- |
| Codex/Claude marketplace 命名空间完整 | `test/integrations.test.js` | `Codex and Claude marketplaces point to complete, namespaced plugins` |
| OpenCode/Pi 集成包声明模块依赖 | 同名 | `OpenCode and Pi integration packages declare the modules their extensions import` |
| **CLI 调用面与 catalog 一致（l3-integ 新增）** | 同名 | `every EvoFence CLI invocation shipped with an integration exists in the command catalog` |
| **项目级 pi 入口可运行且 src/ 无 .js 孪生（l3-integ 新增）** | 同名 | `the project-level pi entry keeps a runtime-loadable .js target and src/ holds no .js twin` |

> 该文件不 import 仓库代码（只读插件文本），由并行节点 `l3-integ` 独占。

### 2.12 `test/release.test.js`（14 例，发布元数据 + 发布面静态守卫）

| 覆盖点（§9.4） | 对应测试文件 | 用例 |
| --- | --- | --- |
| prerelease tag/flag 一致 | `test/release.test.js` | `release metadata accepts a matching prerelease tag and flag` |
| stable tag/flag 一致 | 同名 | `release metadata accepts a matching stable release tag and flag` |
| tag/prerelease 不匹配拒绝 | 同名 | `release metadata rejects tag mismatch and prerelease flag mismatch` |
| 作为脚本运行时必需 event 值 | 同名 | `release metadata requires event values when run as a script` |
| **0.4.0 stable tag 接受、0.3.0 拒绝（l4_release 新增）** | 同名 | `release metadata accepts the 0.4.0 stable tag this release ships, and still rejects 0.3.0` |
| **package.json 版本即发布版本（l4_release 新增）** | 同名 | `the shipped package.json is the version the release gate publishes` |
| **发布面：dist 形态接受 / 源码树形态拒绝 / 缺产物 fail-closed（l4_release 新增 3 例）** | 同名 | `publish surface accepts the dist-shaped package.json this repository ships`、`publish surface rejects the 0.3.0 source-tree package shape`、`publish surface fails closed when a promised dist artifact is missing` |
| **publish.yml 的 OIDC Trusted Publishing 守卫（l4_release 新增 5 例）** | 同名 | `the shipped publish workflow passes the OIDC Trusted Publishing gate`、`the publish workflow gate rejects a workflow without id-token: write`、`the publish workflow gate rejects a build that runs after the publish step`、`the publish workflow gate rejects an untagged publish and a missing npm CLI pin`、`the publish workflow gate reports invalid YAML instead of throwing a parse stack` |

> 该文件测的是 `scripts/verify-release-metadata.js`（发布脚本，不在 `src/`→`dist/` 编译面内），因此保持原 import 是正确落点，不是漏迁移。

## 3. 本节点新增的补强用例（不在旧 12 内）

### 3.1 `test/unit-ledger-chain.test.js`（11 例）——DoD 3

针对 `verifyChain` 的三重判定各给出**可单独击穿**的失败面（每条都做了变异验证：禁用对应判定后该用例必红）：

| # | 用例 | 击穿的判定 | 断言要点 |
| --- | --- | --- | --- |
| 1 | `verify() reports the contiguous chain head for an intact ledger` | —（正样本） | `deepEqual(verify(), {valid:true, events:3, head})` |
| 2 | `the append-only triggers refuse an event UPDATE and DELETE before any tampering` | 写入防线 | UPDATE 与 DELETE 均抛 `/append-only/`，被拒写后链仍 `valid` |
| 3 | `verify() localizes a payload_json rewrite without parsing the payload` | 行摘要 | `sequence=2`、`expected_previous_hash`/`observed_hash` 精确值、payload 为畸形 JSON 也不抛 |
| 4 | `verify() rejects a naive previous_hash rewrite whose stored digest no longer matches` | 行摘要（改链不重算） | 定位到被改行，`observed_hash` = 原存储摘要 |
| 5 | `verify() rejects a rehashed row that links to the wrong predecessor` | **链链接** | 行摘要自洽（`rehashRow` 复算相等）而 `previous_hash` 不等于前一行摘要 |
| 6 | `verify() requires the first event to link to the zero hash even when it is rehashed` | **链链接（创世）** | `sequence=1`、`expected_previous_hash = '0'.repeat(64)` |
| 7 | `verify() rejects a rewritten event_hash and echoes the observed digest` | 行摘要 | `observed_hash` 回显被写入的摘要 |
| 8 | `verify() detects a deleted row as a sequence gap before it checks the chain` | seq / 链接（真实删行） | 行 seq 变为 `[1,3]`，`sequence=3` |
| 9 | `verify() detects a non-contiguous seq even when the row is rehashed and its link is intact` | **seq 连续性** | 行改到 `seq=5` 且重算摘要后链接仍自洽，唯一能命中的是 seq 判定 |
| 10 | `CLI ledger verify prints the chain head and exits 0 for an intact ledger` | CLI 边界 | 退出码 0 + JSON 链头 |
| 11 | `CLI ledger verify exits 1 and prints the failing sequence for a rewritten previous_hash` | CLI 边界 + 错误定位 | 退出码 1 + `{valid,sequence,expected_previous_hash,observed_hash}` 精确 JSON，stderr 为空 |

**DoD 3 核对结论**：既有 0.3.0 用例覆盖了 `payload_json`/`created_at` 篡改（`spec-f1.test.mjs` 的 `UPDATE events SET payload_json=...`、`spec-f3.test.mjs` 的 `created_at`/畸形 payload→`LEDGER_CORRUPT`；`spec-f2.test.mjs` 还有"重算伪造链能通过 verify()"的对照 oracle），但**没有**：单独的 `previous_hash` 篡改、`event_hash` 篡改、seq 缺口、以及失败定位字段的**精确值**断言（`spec-f2.test.mjs:748-749` 只有 `typeof`）。本文件按上述三条判定补齐并做了变异验证。

### 3.2 `test/unit-worktree-cleanup.test.js`（6 例）——DoD 4

| # | 用例 | 断言要点 |
| --- | --- | --- |
| 1 | `worktreeTempParent is deterministic, per-checkout, and inside the OS temp directory` | 位于 `<TMPDIR>/evofence-worktrees/`、`repoId` 为 16 hex、同 checkout 稳定、大小写不分裂（Windows）、不同 checkout 不共享 |
| 2 | `runTempRoot nests the per-run directory strictly inside the shared temp parent` | 每 run 根目录严格是父目录的直接子目录 |
| 3 | `cleanupEmptyWorktreeTempParent removes only an empty parent and never disturbs a sibling` | 空目录→`true` 并消失；缺失→`false` 不抛；非空→`false` 且**兄弟 run 目录原样保留** |
| 4 | `removeCandidate refuses a worktree that escapes the run temp root` | 越界路径/兄弟 run 的 worktree/父目录本身 → `PATH_ESCAPE` |
| 5 | `removeCandidate deletes a registered candidate worktree and stays idempotent` | 真实 `git worktree add` 后 `openTreeCount` 2→1、目录消失、二次调用不抛 |
| 6 | `a finished evolution leaves no candidate worktree, no run directory, and no shared temp parent` | 端到端：运行中采样（父目录存在、恰好 1 个 run 目录、候选 worktree 已注册、tree 数 = 2）证明非空断言；运行后 `openTreeCount === 1`、父目录不存在、共享根下无本 repo 目录；**异常路径**（adapter 抛错）同样清理；连续两次运行不累积 |

**DoD 4 核对结论**（复核 F1）：0.3.0 仅有的相关断言是 `test/runner.test.js:350-351`（整个 20 轮用例末尾 `git worktree list` 只剩 1 个），属弱覆盖且不覆盖异常路径。本节点保留该兜底断言，并用 `test/unit-worktree-cleanup.test.js` 锁定"每轮 `removeCandidate()` + 每 run `runTempRoot` + 空父目录回收"三处观察点；变异验证：注释掉 `runner-run.ts` 的 `removeCandidate(...)` **或** `cleanupEmptyWorktreeTempParent(...)` 后，用例 6 必红。

## 4. 新增（非旧 12）测试文件索引

| 文件 | 例数 | 归属 | 主题 |
| --- | --- | --- | --- |
| `test/cli-surface.test.js` | 10 | L2（io/cli）+ fix/r3 | CLI 命令面 manifest 驱动冒烟 + `--json` 契约（含写文件形态，见 `JSON_WRITE_SMOKES`）+ handler 注册表一致性 |
| `test/config.test.js` | 21 | L2（io/config） | v2 config 面与校验 |
| `test/report-view.test.js` | 14 | L2（io/report） | `report.gate_decisions`/`report.ledger` 新字段 + `--json` 失败契约 |
| `test/unit-ledger-chain.test.js` | 11 | **l3_tests_unit** | 哈希链三重判定负向用例（DoD 3） |
| `test/unit-worktree-cleanup.test.js` | 6 | **l3_tests_unit** | worktree/临时目录清理与隔离回归（DoD 4） |

## 5. 关键不变式 → 测试速查（§9.5 的更新版）

| 不变式 | 锁定测试 |
| --- | --- |
| 哈希链算法、三重判定与错误定位 | `test/ledger.test.js`（3/3）、**`test/unit-ledger-chain.test.js`（11/11，含 previous_hash/event_hash/seq 三条判定的独立击穿）**、`spec-f1` tamper 组、`spec-f2` forged-chain/`generations_mismatch`、`spec-f3` tampered-integrity 组 |
| 哈希链 append-only（UPDATE/DELETE 触发器） | `test/ledger.test.js`（UPDATE，`/append-only/`）、**`test/unit-ledger-chain.test.js`（UPDATE + DELETE 两条触发器）**；其余篡改用例在 `tamper` 前显式 `DROP TRIGGER`，即建立在触发器默认存在之上 |
| fail-closed 读取/写入 | `spec-f2` symlink/hardlink/protected-state 组、`spec-f3` partial-schema/zero-byte/`LEDGER_UNAVAILABLE` 组、`test/contract-policy.test.js`（四条门禁） |
| 预算（token/USD） | `test/adapter.test.js`、`test/process.test.js`（callback budget trigger）、`test/runner.test.js` 第 2 例 |
| 四条门禁 | `test/runner.test.js`、`test/contract-policy.test.js`（14 例）、`spec-f1` gate/evidence 组 |
| **worktree 清理与临时目录回收** | **`test/unit-worktree-cleanup.test.js`（6/6）为主锁定；`test/runner.test.js:350-351` 为端到端冒烟兜底**（复核 F1 的"弱覆盖"已消除） |
| env 剥离 | `test/process.test.js`（`secret-like environment values are not passed to child processes`） |
| 集成/发布契约 | `test/integrations.test.js`、`test/release.test.js` |
