# l3_pi_session 重定版 0.99.2 复核后补证 (fix-verify) 独立复核简报

> 图：`evofence-harness-kernel` · 节点 `l3_pi_session` · 你的角色：**独立复核者（fix-verify）**（新 tab / 新 pane，未参与写作或前一轮复核）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是本简报指定的 dossier。

## 0. 复核对象

- 原复核 dossier：`docs/evofence-harness-kernel/execution/reviews/l3_pi_session-review.md`（结论：**需修订**，blocker 0 / major 1 / minor 2 / nit 1；原提交 `6f0ad16`）。
- 补证提交：**`cf58120`**（在 `6f0ad16` 之上；lane `refactor/hk-l3-pi-b` 的补证并入后可再有一次 docs-only commit，核验时请以 `git diff --name-only 6f0ad16 cf58120` 为准）。
- lane 工作区（仅 sha256 比对，不写）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-pi-b`。
- 本机 Pi：`pi --version` = 0.99.2。

## 1. 必须独立核验的断言（针对本轮 delta）

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | 原 major-1 已闭环：`settledReentryRefused`（重入）与 `contextAndResources`（context/资源失效）两条 negative control **真实存在**，且**不是镜像实现**（变异点落在被声明的行为路径上，不是重复同一条检查） | 读新证据文件与负控脚本；在 dist 内自行构造独立变异，确认两条都能真红 |
| 2 | 红/绿可复现：两条均为 变异→**exit 1**→**逐字节复原**→**exit 0**，且记录了变异点与用例名；复原后与 fresh `tsc` 产物 sha256 相同 | 自跑负控 + 比对 sha256 |
| 3 | 无回归：重跑 `npm run build/typecheck/src:policy/dep:check`、`node --test test/l3-pi-*.test.js` 两次、`node verification/kernel/static-audit.mjs` 全部通过（0 violations）；VERSION-PIN 仍为 0.99.2 且保留历史；非 0.99.2 typed 拒绝仍在 | 逐条复跑 |
| 4 | minor/nit 收口如实：minor-1（模型选择依据）已记录；minor-2（provider-live trace 无法用提交版 harness 逐字节复现的限制）**保留披露、未被静默升级**；nit-1（`0992-memory-control.json`）现已携带 `sourceHashes` | 读证据文件与 LANE-REPORT/VERSION-DIFFERENCES |
| 5 | 范围与成本：`git diff --name-only 6f0ad16 cf58120` 仅授权路径（`src/hosts/pi/**`、`test/l3-pi-*.test.js`；无 core、无 `.graph`）；本轮**新增付费请求 0** 的说法有证据支持 | `git show --stat`；读 usage/负控证据 |
| 6 | 证据诚实：未证明项（TUI 共存、provider retry/compaction、crash/断电恢复、provider abort 计费、child delegation、OS sandbox、收益等）仍如实保留，未因补证而升级 | 对照原 dossier 的未证明项清单 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l3_pi_session-review-fix-verify.md`，格式同前几份复验 dossier（复核对象 / 结论 / 逐条证据 / 未证明项 / 收工一致性；结论 = 可接受 或 需修订 + 计数）。
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane、不改 `src/`；变异/负控只在 gitignored 的 `dist/` 或系统临时目录，复原用 `git cat-file blob` / 与 `tsc` 产物比对。
- 只跑本次 build 的 `dist/`；尽量不产生 provider 调用（0 付费优先）。
- unknown 保留为 unknown，负结果如实写入。
