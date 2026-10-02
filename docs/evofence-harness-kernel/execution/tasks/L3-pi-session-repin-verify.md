# l3_pi_session 重定版 0.99.2 独立复核简报（review）

> 图：`evofence-harness-kernel` · 节点 `l3_pi_session` · 你的角色：**独立复核者**（新 tab / 新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。
> 用户裁决 A：**Pi 跟随 0.99.2**（本机 `pi --version` = 0.99.2；不使用 1.0）。

## 0. 复核对象

- 集成提交：**orchestrator 派单时填入**（lane `refactor/hk-l3-pi-b` 产物并入后的 commit）。
- 交付面（预期）：`src/hosts/pi/**`（演进既有绑定 + 新证据）、`test/l3-pi-*.test.js`、`docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json`、`HOST-MAPPING.md` 的 Pi 版本行。
- lane 作者工作区（仅 sha256 比对，不写）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-pi-b`。
- 节点合同：plan = 把版本固定的 Pi extension events、context/tool hooks、appendEntry/session identity 与 usage 接到 runtime；保留宿主持久 session。
- DoD①：**在既有 Pi session 内运行内核，不再以 `--no-session` 等参数启动隔离子 CLI。**
- DoD②：`agent_end` / `settled` / `abort` 的版本差异**不造成早结算、重入或 context 失效**。
- cp1 扩展 lifecycle 绑定（0.87.1 时代 failed/blocked-on-version）、cp2 tool/context/usage 映射、cp3 恢复/idle/卸载核验。
- 简报：`docs/evofence-harness-kernel/execution/tasks/L3-pi-session-repin-brief.md`；管辖 ADR：`adr_0001`、`adr_0006`。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | VERSION-PIN 重定版：目标版本 0.87.1 → **0.99.2**，保留历史记录与变更理由，不是静默改写 | 读 `probes/pi/VERSION-PIN.json` diff；确认历史字段仍在 |
| 2 | 适配真实 API：`src/hosts/pi/**` 对照本机 `@earendil-works/pi-coding-agent@0.99.2` 的 `dist/core/extensions/types.d.ts` 逐条核对（`agent_end`/`agent_before_settle`/`agent_settled`/abort、tool hooks、`appendEntry`、usage、session identity） | 自行打开 0.99.2 的 d.ts 与实现比对；注意 `agent_before_settle` 可触发后续请求 ⇒ `agent_end` 不能作最终结算点 |
| 3 | DoD① 真实性：确有**真实 Pi 0.99.2 进程的持久 session** 内加载本扩展并跑内核（非 `--no-session`、非 fixture、非子 CLI 冒充） | 读证据轨迹（事件序列/session identity/settle 时机）；必要时自建最小真实会话复跑；拒绝只给 fixture 结论 |
| 4 | DoD② 负控：早结算 / 重入 / context 失效三条各有**真实 negative control**（变异→变红→复原→复绿），且变异点与用例名可复核 | 复跑负控；确认不是只镜像实现的测试 |
| 5 | P1/P2/P3/P4/P9/P17 逐项：**0.99.2 实测重验** 或 **如实保留 unknown**；不得沿用 0.87.1 结论充当 0.99.2 证据 | 逐项对照 `HOST-MAPPING.md` / `VERSION-DIFFERENCES.md` 与证据文件 |
| 6 | 版本拒绝门禁保留：非 0.99.2 目标版本被显式拒绝适配（typed），未静默降级 | 探针 + 读实现 |
| 7 | cp2/cp3 在 0.99.2 下**重新成立**，不能只引用 0.87.1 时代的 fixture 通过 | 复跑 `test/l3-pi-*.test.js` 并抽验映射/恢复用例 |
| 8 | 证据分级：provider-live / native-fixture / unknown **分开标注**；真实请求**最小化并逐条记账**；凭据未打印/未入库 | 读证据文件与 usage 账；grep 凭据 |
| 9 | 门禁 | `npm run build/typecheck/src:policy/dep:check` = 0；`node --test test/l3-pi-*.test.js` 两次一致全绿；`node verification/kernel/static-audit.mjs` exit 0、0 violations |
| 10 | 范围与核心边界 | `src/{protocol,kernel,runtime}/**` 未被本 lane 污染；未 commit、未碰 `.graph`；落点仅授权路径 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l3_pi_session-review.md`，格式同前几份复验 dossier（复核对象 / 结论 / 逐条证据 / 未证明项 / 收工一致性；结论 = 可接受 或 需修订 + 计数）。
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异/负控只在 `dist/` 或临时副本，复原用 `git cat-file blob`（CRLF 陷阱）。
- 只跑本次 build 的 `dist/`；结论以实测为准；真实 Pi 会话操作最小化请求数。
- unknown 保留为 unknown，负结果写入 dossier，不夸大。
