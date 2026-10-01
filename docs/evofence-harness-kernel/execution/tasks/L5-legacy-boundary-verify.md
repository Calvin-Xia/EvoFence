# l5_legacy_boundary 独立复核简报（review-1）

> 图：`evofence-harness-kernel` · 节点 `l5_legacy_boundary` · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。

## 0. 复核对象

- 集成提交：`c89e62d`（相对基线 `d2e311d`）：`src/storage/legacy/**`（含 `evidence/**`、`REPORT.md`）+ `test/l5-legacy-*.test.js`（4 文件 / 23 用例）。
- lane 作者工作区（仅 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l5-legacy`。
- 节点合同：plan = 为旧 CLI/config/ledger 提供明确升级说明与**只读** exporter/importer；新 namespace/schema，**不原地 migrate、不重算旧 chain**；旧日志只作历史来源、**不直接晋升 asset**；用户选择旧版继续或显式导入。DoD① 原文件摘要保持不变、未知旧版格式明确拒绝；DoD② breaking 对照清单、旧历史不被写成新版执行证据。cp1 冻结旧格式与只读导出、cp2 新 namespace 导入与来源标记、cp3 原件保持和指南核验。
- 简报：`docs/evofence-harness-kernel/execution/tasks/L5-legacy-boundary-brief.md`；管辖 ADR：`adr_0004`、`adr_0010`。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | 只读导出：exporter 不改原文件、不重算旧 hash 链；原件 digest 前后一致 | 读源码 + 自建探针（导出前后 sha256 对比；变异写入应破坏负控） |
| 2 | 版本探测：未知/损坏旧格式**明确拒绝**（typed），不猜测、不降级 | 自建畸形/未知版本输入 |
| 3 | 新 namespace 导入：来源标记（原文件 digest/时间/导入器版本）逐条可核；导入幂等或 typed 冲突；不在原地 migrate/合并旧 chain | 探针重复导入 + 读 importer |
| 4 | 旧历史不作新版执行证据：不进 asset 晋升路径、不冒充新 journal 事件 | grep 调用方向 + 探针（旧记录是否出现于新证据路径） |
| 5 | DoD② breaking 对照：`BREAKING_CHANGES` 清单覆盖旧命令/字段（与 `CHANGELOG.md`/`docs/config.md` 对照抽样）；升级指南（继续旧版 vs 显式导入）可执行 | 读 `breaking.ts`/README + 抽样核对 |
| 6 | 真实旧 ledger/config **未被触碰**（lane 只用临时副本） | lane 与集成的工作树 diff（`.evofence/**`、主 checkout 不涉及）；证据里的路径均为临时目录 |
| 7 | 门禁与边界 | build/typecheck/src:policy/dep:check=0；`node --test test/l5-legacy-*.test.js` 两次 23/23；`static-audit` exit 0、0 violations；只增不改（`git show --name-status c89e62d`） |
| 8 | 证据与负控 | `evidence/summary.json`/`negative-controls.json` 与实况一致；抽查 1-2 个负控 0→1→0；未证明项（旧 GUI/外部导入器覆盖、旧链真实性、断电持久性、真实宿主激活）如实 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l5_legacy_boundary-review.md`，格式同前几份复验 dossier。
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异只在 `dist/` 或临时副本，复原用 `git cat-file blob`。
- **绝不触碰真实旧 ledger/config**（只读复制到临时目录）。
- 只跑本次 build 的 `dist/`；结论以实测为准。
