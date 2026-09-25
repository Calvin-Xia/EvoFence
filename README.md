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
evofence proposal inspect <run-id>-i1
evofence gate <run-id>-i1
evofence ledger show <run-id>
evofence ledger verify
evofence ledger recent 10
evofence experiment export evidence.json
evofence rollback <generation-id>
evofence diff <generation-id> [--json]
```

回滚会切换 EvoFence 的当前新一代指针和 Git 引用，不会改写主工作树。下一个候选将从选定的新一代开始。每个已接受的新一代都是 Git commit，可通过 `refs/evofence/generations/*` 找到。

`evofence diff <generation-id>` 输出某个新一代的审计视图：新一代标识、短 SHA 与目标增量、变更路径列表、逐条证据检查（`id kind result`），最后是 `parent_sha..sha` 的统一 diff（上限 200 KiB，截断时 `diff_truncated` 为 true）。加 `--json` 会以格式化 JSON 输出同一份报告；`objective` 与 `evidence` 仅在 ledger 中存在对应记录时出现，证据只包含检查 id、类型和结果，不包含命令文本或输出内容。

```sh
evofence diff g-run-20260101120000-abcd1234-i01
evofence diff g-run-20260101120000-abcd1234-i01 --json
```

`evofence evidence run <candidate-directory>` 会针对指定目录重新运行已配置的检查并导出摘要，但不会接受或提交该候选。

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

## 已知限制

- 会强制执行 `max_iterations`、`max_wall_clock_ms`、失败候选数和连续无改进次数上限。设置 `max_tokens` 后，会按 Codex 完成的 turn、OpenCode 完成的 step 和 Pi 完成的 assistant 消息统计，并计入 Pi 报告的嵌套工具模型用量与压缩用量；达到或超过阈值时终止 agent 进程树，并停止评估和接受当前候选。CLI 只在完整消息/turn/step 边界报告用量，跨线响应已经完成，因此实际用量可能超过阈值；这不是请求前的严格 token 上限。Claude Code 的完整 whole-tree token 数只在任务结束的 result 事件中提供，因此设置 `max_tokens` 时会在启动 agent 前拒绝 Claude 运行。Pi 的自动重试若没有附带用量，会在 token 预算模式下触发 fail closed。预算模式下，用量缺失、字段不完整或被截断时会停止运行。Windows 会先探测系统能否终止整个进程树；若权限不足，预算运行会在启动智能体前拒绝执行。Claude Code v2.1.246+ 会记录完整的按模型 token 和 CLI 报告的美元成本估算；Pi 会按其模型价格记录 USD 成本估算。`max_usd` 目前只支持 Claude Code：EvoFence 把剩余 run-wide 预算传给每次 CLI 调用的 `--max-budget-usd`，并以完整的 `result.total_cost_usd` 估算值累计；达到上限、用量缺失/截断、超时或无法确认进程树终止时，会停止且不评估当前候选。触发上限的响应可能使估算值越过阈值；该值不是服务商最终账单。Codex、OpenCode 和 Pi 配置非空 `max_usd` 会在启动前拒绝。OpenCode 的 cost 仍保留 CLI 报告值，不推断币种，也不代表最终账单。
- 隐藏评估目前运行项目所有者提供的私有命令。内置适配器无法在共享主机上满足 PRD 中“智能体读不到 holdout 源码”的强隔离要求；该保证需要单独隔离的执行器。生成式变形测试、API daemon、Herdr 适配器、权威学习和长期漂移分析仍属于后续工作。
- 智能体 CLI 版本和用户配置会影响运行行为。Claude Code 适配要求 v2.1.259+（无提示运行参数）；请保持各 CLI 为较新版本，并在依赖结果前检查导出的证据。
- Worktree 隔离可以保护主工作树免受候选直接修改，但不能替代操作系统沙箱，尤其是面对可运行任意 shell 命令的智能体时。

## 开发

```sh
npm ci
npm test
npm pack --dry-run
```

研究报告源文件 `docs/deep-research-report.md` 不会包含在 npm 包中。

## 发布

npm 包 `evofence` 通过 GitHub Actions Trusted Publishing（OIDC）发布。Trusted Publisher 对应 Owner `Calvin-Xia`、Repository `EvoFence`、Workflow `publish.yml`，不使用 GitHub Environment，也不需要保存 `NPM_TOKEN`。

每次发布前，更新 `package.json`、`package-lock.json` 和 `CHANGELOG.md`，将更新合入 `main` 后创建对应的 GitHub Release，标签使用 `v<版本号>`。正式版本如 `v0.2.1` 会由 `.github/workflows/publish.yml` 发布到 npm `latest`；预发布版本如 `v0.2.1-beta.1` 需在 GitHub Release 中标记为 prerelease，并发布到 npm `beta`。工作流会检查标签、包版本和 prerelease 标记是否一致，并在发布前运行测试。
