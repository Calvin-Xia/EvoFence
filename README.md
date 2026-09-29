<div align="center">

<h1>EvoFence</h1>

<p><strong>让代码智能体持续改进，让证据守住每一次接受</strong></p>
<p>Agent 提案 · 环境度量 · 门禁决策</p>

<p>
  <a href="https://www.npmjs.com/package/evofence"><img alt="npm 版本" src="https://img.shields.io/npm/v/evofence"></a>
  <a href="https://www.npmjs.com/package/evofence"><img alt="npm 周下载量" src="https://img.shields.io/npm/dw/evofence"></a>
  <a href="https://www.npmjs.com/package/evofence"><img alt="Node.js 版本" src="https://img.shields.io/node/v/evofence"></a>
  <a href="https://github.com/Calvin-Xia/EvoFence/blob/main/LICENSE"><img alt="许可证" src="https://img.shields.io/npm/l/evofence"></a>
  <a href="https://github.com/Calvin-Xia/EvoFence/actions/workflows/ci.yml"><img alt="CI 状态" src="https://github.com/Calvin-Xia/EvoFence/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
<p><a href="#安装">安装</a> · <a href="#配置演化契约">配置</a> · <a href="#运行演化循环">运行</a> · <a href="#agent-插件与扩展">Agent 插件</a> · <a href="#安全边界">安全边界</a> · <a href="#开发">开发</a></p>

</div>

---

EvoFence 是一个用于管理代码智能体变更的实验性控制面。智能体在一次性 Git worktree 中提出方案并修改代码；EvoFence 运行仓库声明的检查、比较数值目标、记录证据，只有满足条件才接受并记录新一代。

这是一个研究型 MVP，不提供形式化验证、企业级身份与访问管理，也不是通用安全沙箱。让智能体无人值守运行前，请先阅读[安全边界](#安全边界)。

## 安装

需要 Node.js 22.13 或更高版本。

```sh
npm install --global --allow-scripts=better-sqlite3 evofence
evofence init
```

npm 11 及以上版本默认会阻止依赖安装脚本。上面的命令只允许 `better-sqlite3` 下载或编译 SQLite 绑定。较旧版本的 npm 默认会运行安装脚本，可使用 `npm install --global evofence`。

`evofence init` 会在当前 Git 仓库创建 `.evofence/`。请按需检查并提交 `contract.yaml`、提示词和 schema 文件。机器本地状态、SQLite ledger、运行产物和私有 holdout 文件会被排除在 Git 之外。

## 配置演化契约

在配置至少一条硬性不变量和一个数值目标前，EvoFence 会拒绝运行。目标命令必须成功退出，并在最后一行输出一个有限数值：

```yaml
objective:
  name: benchmark_score
  command: "npm run benchmark:score"
  direction: maximize
  min_delta: 0.01

hard_invariants:
  - id: unit_tests
    command: "npm test"

evidence:
  public_commands:
    - "npm run lint"
```

契约中的命令由项目所有者配置，属于可信命令，并以当前用户权限运行。不要在命令或命令输出中放入凭证。

私有回归命令应放在 `.evofence/private/holdout.yaml`。该文件会被 Git 忽略，也不会复制到候选 worktree。只添加预期结果为成功的命令。EvoFence 只记录通过或失败的数量及哈希，不记录私有命令输出或 oracle 源码。

```yaml
regressions:
  - id: historical_case_01
    command: "python private_checks/case_01.py"
```

如果没有配置私有回归，EvoFence 就没有隐藏回归证据，不能据此声称隐藏测试表现良好。内置智能体适配器无法保证智能体读不到同一主机上的其他文件，因此默认不允许使用私有检查。`--allow-readable-holdout` 表示你接受智能体可能读取 oracle；如需真正保密，请使用限制挂载范围的容器或虚拟机。

### 配置校验（v2）与不生效的键

`.evofence/contract.yaml`、`.evofence/config.yaml`、`.evofence/private/holdout.yaml` 与 experiment 清单都由同一套 v2 校验器读取（完整字段表见 [`docs/config.md`](docs/config.md)）：

- **未知字段被拒绝**：0.3.0 会静默忽略拼错的键，现在以 `INVALID_CONTRACT` / `INVALID_CONFIG` / `INVALID_HOLDOUT` / `INVALID_EXPERIMENT` 失败并列出具体路径。
- **缺失必填字段被拒绝**：报 `missing field(s): ...`。整份配置只有两个代码默认值——`evidence.per_command_timeout_ms`（120000）与 `evidence.max_output_bytes`（1048576）；其余字段缺失即失败。`templates/contract.yaml` 里的初始值只是模板值，不是运行时兜底。
- `evofence init` 会校验自己写下的骨架，`evofence status` 会校验两份策略文件：无效的 `contract.yaml` / `config.yaml` 让 `status` 以退出码 1 失败并给出配置错误码，而不是被忽略；文件不存在仍是可容忍的。
- YAML 里的版本键没有变：`config.yaml` 仍要求 `version: 1`，`contract.yaml` 仍要求 `contract_version: 1`。“v2”指校验层，不是这两个键的新值。

以下模板键**当前不生效**，不要把门禁语义寄托在它们身上：

| 键 | 真实状态 |
| --- | --- |
| `acceptance.require_proposal` | 未生效：代码零引用；提案校验始终执行 |
| `acceptance.require_claims` | 未生效：代码零引用；claims 校验始终执行 |
| `capabilities.shell.mode` | 未生效：代码零引用 |
| `capabilities.authority_ceiling` | 仅校验 A0–A3（A4 被拒），不参与任何决策 |
| `capabilities.network` / `dependency_install` / `credentials` | 仅写进 `.evofence-task.md` 的契约摘要，不阻止任何行为 |

与此相对，`capabilities.external_api` 是**真实生效**的能力门：proposal 通过 `requested_capabilities` 请求它时，控制器按 contract 中该键的值裁决（模板为 `deny`，即请求被拒）。未配置的能力一律拒绝。

## 运行演化循环

```sh
evofence run --adapter codex --goal goal.md --iterations 20
```

每轮都会从当前已接受的新一代创建一个 detached worktree，先要求智能体提交提案，再允许它实现；控制器随后运行公开和私有检查，并记录门禁决定。迭代次数和运行时长上限不能超过 `.evofence/contract.yaml` 中的限制。默认契约最多运行 20 轮或一小时。

## 安全边界

Codex 使用 `workspace-write` 沙箱，该沙箱限制写入，但不限制读取主机文件系统（参见 [Codex 沙箱策略](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)）。OpenCode、Claude Code CLI 和 Pi 都不会由 EvoFence 放进操作系统沙箱。Claude Code 的非交互权限参数不能限制进程访问主机文件；其 headless 模式还可能运行 hooks、MCP servers 或 plugins（参见 [Claude Code 非交互运行](https://code.claude.com/docs/en/headless)）。Pi 使用 JSONL 模式，并关闭持久会话、项目配置批准、自动发现的扩展、skills、提示模板、主题和 `AGENTS.md`/`CLAUDE.md` 发现；CLI 适配器只显式加载 EvoFence 自带的受限工具策略扩展（参见 [Pi CLI](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/cli.md)）。这些参数减少项目资源加载，但不能限制 shell 对主机文件的访问（参见 [Pi 安全说明](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/security.md)）。OpenCode、Claude Code 和 Pi 需要显式传入 `--allow-unisolated-agent`：

```sh
evofence run --adapter opencode --allow-unisolated-agent --goal goal.md
evofence run --adapter claude --allow-unisolated-agent --goal goal.md
evofence run --adapter pi --allow-unisolated-agent --goal goal.md
```

如需有效隔离，请在 Docker 容器或虚拟机中运行智能体，只挂载候选 worktree，并且不提供网络、密钥或主机凭证。上面的标志本身不会创建这样的隔离边界。

EvoFence 会从子进程环境中过滤常见的凭证变量名，包括 `*_TOKEN`、`*_SECRET`、`*_PASSWORD`、API/访问令牌/私钥变量，以及认证辅助程序变量。这只是纵深防御：如果智能体仍可读取主机文件，就可能访问凭证文件或认证代理。

## 检查、导出与回滚

```sh
evofence init --json
evofence status
evofence status --json
evofence proposal inspect <run-id>-i1
evofence gate <run-id>-i1
evofence ledger show <run-id>
evofence ledger verify
evofence ledger recent 10
evofence ledger export evidence.json --json
evofence experiment export evidence.json
evofence rollback <generation-id> --json
evofence report evolution-report.md
evofence report evolution-report.json --json
evofence diff <generation-id> [--json]
```

### 命令面约定（0.4.0）

- `--json` 被**每一条**子命令接受（0.3.0 只在 `run` / `diff` / `report` / `status` 上生效）。`ledger show|verify|recent`、`proposal inspect`、`gate` 始终只输出 JSON；`evidence run` 默认先打印进度行再打印 JSON 文档，加 `--json` 会抑制进度行，让 stdout 只剩一个 JSON 文档。
- 未知 flag 在任何命令上都是用法错误（0.3.0 会静默忽略 `run` 上的未知取值 flag）；`--flag=value` 与 `--flag value` 等价。
- 退出码只有 `0`（成功）与 `1`（任何失败）。文本模式在 stderr 打印 `[CODE] message`；`--json` 模式下 stdout 保持为空，stderr 打印单个 `{"error":{"code","message","details"?}}` 对象。

### 导出 bundle 的离线校验

`evofence ledger export evidence.json` 导出的证据 bundle 可以复制到没有本地 SQLite ledger 的独立主机上校验：`evofence ledger verify --bundle evidence.json [--json]` 只读取指定 JSON 文件，复算冻结的事件链并输出 `valid`、`events`、`head`，或输出首个失败序号。该命令不会打开当前目录的本地 ledger；因此第三方可以在隔离的只读环境中核对导出证据。

`evofence status` 在一屏内展示控制面当前状态：当前新一代、ledger 完整性、累计总数（运行次数、新一代数、接受与拒绝的候选数）以及最近 5 次运行摘要。加 `--json` 输出结构化 JSON。状态输出不包含任何证据命令的输出内容。尚无 ledger、ledger 文件为 0 字节或尚未建表时，`evofence status` 输出上述空状态。ledger 健康或为空时退出码为 0，完整性校验失败或 ledger 无法读取时退出码为 1。

回滚会切换 EvoFence 的当前新一代指针和 Git 引用，不会改写主工作树。下一个候选将从选定的新一代开始。每个已接受的新一代都是 Git commit，可通过 `refs/evofence/generations/*` 找到。

`evofence diff <generation-id>` 输出某个新一代的审计视图：新一代标识、短 SHA 与目标增量、变更路径列表、逐条证据检查（`id kind result`），最后是 `parent_sha..sha` 的统一 diff（上限 200 KiB，截断时 `diff_truncated` 为 true，文本输出会显式标注截断）。输出前会先校验账本哈希链，并将 `generations` 行与哈希链上的 `generation.accepted` / `candidate.accepted` 记录交叉比对，链断裂或元数据不一致时以 `LEDGER_CORRUPT` 失败。展示的证据与提案绑定到验收记录的 `evidence_artifact` 与 `proposal_sha256`（验收需有唯一的前置 ACCEPT gate.decision 且绑定与基线证据通过其门（分数有效、增量达到契约 `min_delta`）；目标分数与增量绑定到重算的门证据，提案摘要会对其内容重算，增量基线取自已校验且与当前父提交成链的前置证据；验收之后追加的记录不会被当作其门证据、提案、基线或契约，重复、缺失或不可验证的链接视为歧义拒绝，且所有关联记录的 `base_sha` 必须等于已接受的父提交），链接断裂或有歧义时同样以 `LEDGER_CORRUPT` 失败（无这两个字段的历史验收记录保留 run/iteration 回退）。`diff_sha256` 由 Git 现场重算（口径为 `git diff --binary parent_sha..sha`，diff 属性钉在新一代的树上，主工作树的 `.gitattributes` 不会扭曲 diff 与哈希；属性钉住需要 Git 2.42 或更新版本，旧版 Git 会明确报错而不是静默跳过），与账本记录的 `diff_sha256_recorded` 比对，结果记入 `diff_sha256_matches`（账本无记录时为 `null`），不一致会在文本输出中标注。加 `--json` 会以格式化 JSON 输出同一份报告；`objective` 与 `evidence` 仅在 ledger 中存在对应记录时出现（没有 `candidate.accepted` 事件的新一代会标注 `not accepted`），证据只包含检查 id、类型和结果，不包含命令文本或输出内容。

```sh
evofence diff g-run-20260101120000-abcd1234-i01
evofence diff g-run-20260101120000-abcd1234-i01 --json
```

`evofence evidence run <candidate-directory>` 会针对指定目录重新运行已配置的检查并导出摘要，但不会接受或提交该候选。

`evofence report [file] [--json]` 会把 ledger 汇总为演化报告：运行记录（`run.failed` 记为 FAILED 并带出失败码）、已接受的新一代、目标得分变化、已观测的 token/USD 用量和 ledger 哈希链校验结果。目标的指标名与优化方向取自每个 run 自己的 `contract_snapshot` 历史快照：跨目标不可比的代不会被合并（聚合字段输出 null，并按目标分组列出），方向未知时不会默认按 maximize 计算。完整性一栏报告哈希链校验结果与断链位置（`failed_at_seq`）；哈希链不带密钥，只能发现意外损坏或未重算哈希的修改，不能作为防篡改证明。报告还会把 generations 表与哈希链上的 `generation.accepted` 事件交叉校验，不一致时拒绝汇总（`generations_mismatch`）。默认输出 Markdown（`--json` 输出机器可读的 JSON，同时适合写入文件）；传入文件路径时会写入该文件并自动创建父目录，然后打印相对于仓库根目录的路径；输出路径不得落在 `.evofence/` 内，否则拒绝写入以保护控制面状态。例如：

```sh
evofence report
evofence report reports/evolution.md
evofence report reports/evolution.json --json
```

### Agent 插件与扩展

仓库包含面向 Codex、Claude Code、OpenCode、Pi 与 DeepSeek Harness 的原生集成。Codex 和 Claude 插件提供显式触发的运行入口；OpenCode、Pi 和 Cordis 目前只读查看 ledger。所有会启动演化的入口仍由 EvoFence CLI 检查契约、预算和证据门禁。

- **Codex CLI 与 Codex 桌面端**：按 [`integrations/codex/README.md`](integrations/codex/README.md) 添加仓库 marketplace。技能名为 `$evofence:inspect-ledger` 和 `$evofence:run-evolution`。
- **Claude Code**：按 [`integrations/claude-code/README.md`](integrations/claude-code/README.md) 添加 marketplace；命令为 `/evofence:inspect-ledger` 与 `/evofence:run-evolution`。
- **OpenCode**：[`integrations/opencode/README.md`](integrations/opencode/README.md) 提供项目级只读工具。
- **Pi**：[`integrations/pi/README.md`](integrations/pi/README.md) 提供只读 ledger 扩展；CLI 适配器的 `evofence run --adapter pi` 还会加载阶段化工具策略：提案阶段仅选择当前已启用的只读工具，实施阶段保留当前工具集并根据调用反馈调整顺序。详见 [`docs/pi-tool-strategy.md`](docs/pi-tool-strategy.md)。

`inspect` 只验证 ledger 并读取脱敏摘要。`run` 必须由用户明确调用并提供已有目标文件；插件不会自动放宽 `--allow-unisolated-agent` 或 `--allow-readable-holdout` 等边界。OpenCode、Pi 和 Cordis 的只读插件入口与 `evofence run --adapter ...` CLI 适配器是两种独立集成。

### DeepSeek Harness Cordis 插件

仓库提供一个本地 Cordis bundle，可让 DeepSeek Harness 只读查询 EvoFence ledger 完整性和最近运行摘要。它不会启动演化、执行契约命令、接受候选或修改 Git 状态。使用前请在 EvoFence 仓库根目录运行 Harness：

```sh
dsh plugin --profile web add ./integrations/deepseek-harness
dsh --profile web --dump-config
dsh --profile web
```

当前包含 `evofence_verify_ledger` 与 `evofence_recent_runs` 两个工具；摘要会省略提示词、评估命令、源码和检查输出。Harness 的 Cordis API 仍处于预览阶段，详见其[工具开发文档](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)和[插件打包说明](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)。

实验清单示例：

```yaml
goal_file: ./goal.md
adapter: codex
iterations: 10
max_wall_clock_ms: 1800000
```

使用以下命令运行：

```sh
evofence experiment run experiment.yaml
```

## 门禁检查内容

- 在项目文件发生变化前，必须有一份绑定到确切基础 commit 的有效提案。
- 默认保护 EvoFence 策略、测试、package 清单与锁文件，以及 CI 工作流。
- 声明的变更文件必须与实际文件列表一致；实现开始后不能再修改提案。
- 所有配置的硬性不变量和公开检查都必须通过。
- 私有回归失败数量必须在配置的容忍范围内。
- 数值目标必须按照设定方向至少提升 `min_delta`。
- 高危变更会进入隔离；高风险变更需要升级审查；除非契约明确允许，否则会拒绝能力请求。
- 接受候选后，EvoFence 会先创建并固定 Git commit，再切换当前新一代。

ledger 是本地 SQLite 数据库，使用仅追加触发器和 SHA-256 哈希链。它能发现意外或不完整的修改，但同一操作系统账户下的进程仍可替换数据库文件。如果本地主机不在你的信任边界内，请备份数据库，或将导出的证据存放在单独受控的系统中。

账本 schema 在 0.4.0 升到 v2（在 `state` 表写入 `schema_version` 标记），哈希链算法、DDL、触发器与写入顺序不变。**读取 0.3.0 的账本会显式失败：不提供迁移，也不会就地升级或降级。** 拒绝发生在任何 pragma / DDL 之前，旧数据库不会被改动。`ledger show|verify|recent`、`diff`、`rollback`、`run` 以 `LEDGER_SCHEMA_INCOMPATIBLE` 退出 1；`status` 报 `LEDGER_UNAVAILABLE`，消息里说明观测到的是 0.3.0（v1）格式。升级步骤见 [CHANGELOG](CHANGELOG.md)。

## 已知限制

- 会强制执行 `max_iterations`、`max_wall_clock_ms`、失败候选数和连续无改进次数上限。设置 `max_tokens` 后，会按 Codex 完成的 turn、OpenCode 完成的 step 和 Pi 完成的 assistant 消息统计，并计入 Pi 报告的嵌套工具模型用量与压缩用量；达到或超过阈值时终止 agent 进程树，并停止评估和接受当前候选。CLI 只在完整消息/turn/step 边界报告用量，跨线响应已经完成，因此实际用量可能超过阈值；这不是请求前的严格 token 上限。Claude Code 的完整 whole-tree token 数只在任务结束的 result 事件中提供，因此设置 `max_tokens` 时会在启动 agent 前拒绝 Claude 运行。Pi 的自动重试若没有附带用量，会在 token 预算模式下触发 fail closed。预算模式下，用量缺失、字段不完整或被截断时会停止运行。Windows 会先探测系统能否终止整个进程树；若权限不足，预算运行会在启动智能体前拒绝执行。Claude Code v2.1.246+ 会记录完整的按模型 token 和 CLI 报告的美元成本估算；Pi 会按其模型价格记录 USD 成本估算。`max_usd` 对 Claude Code 和 Pi 生效，但语义不同：Claude Code 仍把剩余 run-wide 预算传给每次 CLI 调用的原生 `--max-budget-usd`，并累计完整的 `result.total_cost_usd`；Pi 没有请求前硬上限，而是在每次调用完成后依据模型价格报告的完整 USD 估算，用现有 micros 记账，并在达到 run-wide 阈值时终止后续调用。两者的用量都必须完整且可确认进程树终止，否则预算运行 fail closed，不评估当前候选。触发上限的那次响应可能已经完成并使估算值越过阈值；`max_usd` 不是服务商最终账单。Codex 仍不报告完整可验证的 USD telemetry，OpenCode 的 currency 未确定且不能推断为 USD；二者配置非空 `max_usd` 仍在启动前拒绝。OpenCode 的 cost 仍保留 CLI 报告值，不代表最终账单。
- 隐藏评估目前运行项目所有者提供的私有命令。内置适配器无法在共享主机上满足 PRD 中“智能体读不到 holdout 源码”的强隔离要求；该保证需要单独隔离的执行器。生成式变形测试、API daemon、Herdr 适配器、权威学习和长期漂移分析仍属于后续工作。
- 智能体 CLI 版本和用户配置会影响运行行为。Claude Code 适配要求 v2.1.259+（无提示运行参数）；请保持各 CLI 为较新版本，并在依赖结果前检查导出的证据。
- Worktree 隔离可以保护主工作树免受候选直接修改，但不能替代操作系统沙箱，尤其是面对可运行任意 shell 命令的智能体时。

## 开发

```sh
npm ci
npm run build        # tsc：把 src/**/*.ts 编译到 dist/，并生成 .d.ts / .d.ts.map / .js.map
npm run typecheck    # tsc --noEmit
npm run dep:check    # 检查 src/ 内部依赖图无环
npm test             # 先 npm run build，再用 Node 内置测试运行器跑 test/**
npm run test:e2e     # 先 npm run build，再跑 test-e2e/cli-flow.mjs
npm run check        # typecheck + dep:check + test
npm pack --dry-run   # 查看发布内容
```

源码是 TypeScript（`src/**/*.ts`）。运行时入口与发布产物只有 `dist/`：`package.json` 的 `bin.evofence` 指向 `dist/cli.js`，`exports["."]` 与 `types` 指向 `dist/index.js` / `dist/index.d.ts`。`files` 只发布 `dist/`、`templates/`、`README.md`、`README.en.md`、`CHANGELOG.md`、`LICENSE` 和 `docs/pi-tool-strategy.md`。测试直接从 `dist/**` import（ADR-0004），所以 `npm test` 一定先构建；改完源码请重新 `npm run build`，不要把过期的 `dist/` 结果当成测试结论。

消费者拿到类型的方式：`import { runEvolution, Ledger } from 'evofence'` 由 `exports["."].types` 解析到 `dist/index.d.ts`；公共 API 就是 `src/index.ts` 重新导出的 18 个符号。`npm pack --dry-run` 可确认 tarball 内只有 dist 形态。

研究报告源文件 `docs/deep-research-report.md` 不会包含在 npm 包中。

### 拓扑驱动的开发方式

0.4.0 这次重构由 [Super Plumber](https://github.com/LUKAWI/super-plumber) 驱动：它把需求拆成带依赖、门禁与 ADR 管辖的拓扑图（19 个工作流节点、5 份 ADR）。

- 图的运行态（节点、边、ADR、`events.jsonl` 审计日志）在 `.graph/`，**已被 Git 忽略**：它是驱动这次重构的过程状态，不是产品源码，也不进 npm 包。（它体积的大头是每次结构变更自动产生的快照副本。）
- 根目录的 `CONTEXT-MAP.md`、`DECISIONS.md`，以及 `docs/adr/`、`docs/contexts/`、`docs/topology.mmd` 是它导出的**可读视图**，已入库：没有图的人靠它们读这份设计与决议，所以不要手改，改动走图再重新导出。
- 导出与漂移检查：`graph export --docs --graph evofence-ts-refactor` / `graph export --docs --check --graph evofence-ts-refactor`。需要单独安装的 Super Plumber CLI（`npm install --global @lukawi/super-plumber`），它不是本仓库依赖，`npm run check` 与 CI 都不需要它。

## 发布

npm 包 `evofence` 通过 GitHub Actions Trusted Publishing（OIDC）发布。Trusted Publisher 对应 Owner `Calvin-Xia`、Repository `EvoFence`、Workflow `publish.yml`，不使用 GitHub Environment，也不需要保存 `NPM_TOKEN`。

每次发布前，更新 `package.json`、`package-lock.json` 和 `CHANGELOG.md`，将更新合入 `main` 后创建对应的 GitHub Release，标签使用 `v<版本号>`。正式版本如 `v0.2.1` 会由 `.github/workflows/publish.yml` 发布到 npm `latest`；预发布版本如 `v0.2.1-beta.1` 需在 GitHub Release 中标记为 prerelease，并发布到 npm `beta`。工作流会检查标签、包版本和 prerelease 标记是否一致，并在发布前运行测试。
