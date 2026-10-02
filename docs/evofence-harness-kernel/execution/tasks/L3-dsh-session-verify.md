# l3_dsh_session 独立复核简报（review）

> 图：`evofence-harness-kernel` · 节点 `l3_dsh_session` · 你的角色：**独立复核者**（新 tab / 新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。
> 用户裁决 A：**DSH 跟随升级到 0.2.0-rc.2**（本机实测版本；`0.1.7-rc.1` 旧钉法仅作历史）。

## 0. 复核对象

- 集成提交：**`6f0ad16`**（lane `refactor/hk-l3-dsh` 产物并入后的 commit；基线 `4ef6022`）。
- 交付面（预期）：`src/hosts/dsh/**`（新建）、`test/l3-dsh-*.test.js`、`integrations/deepseek-harness/**` 的版本声明与必要适配（单列 diff 说明）、`probes/dsh/VERSION-PIN.json`。
- lane 作者工作区（仅 sha256 比对，不写）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-dsh`。
- 节点合同：plan = 将已验证 Cordis lifecycle、tool policy/result、session projections、usage 和用户交互接到 runtime；注册原生 EvoFence 操作与状态视图，沿用现有 session/model/tools/context；**不以只读 ledger tool 或 `run` 子 CLI 为实现**。
- DoD①：在持续 DSH 会话中**建立/继续/恢复同一 EvoFence session**。
- DoD②：钩子失效、卸载或 runtime 错误时**保留普通宿主工作并停止未确认晋升**。
- DoD③（版本）：`probes/dsh/VERSION-PIN.json` = 本机实测 **0.2.0-rc.2**；**更新 `integrations/deepseek-harness` 的 `engines.dsh` 与 `peerDependencies[@deepseek-ai/dsh-tools]` 到 0.2.0-rc.2 并记录升级决定**，不得静默按旧版本适配。
- cp1 接入事件和会话身份、cp2 context/tool/usage 映射、cp3 恢复/卸载/异常核验。
- 简报：`docs/evofence-harness-kernel/execution/tasks/L3-dsh-session-brief.md`；管辖 ADR：`adr_0001`、`adr_0006`。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | 非只读/非子 CLI：`src/hosts/dsh/**` 是真实 HostPort 绑定（Cordis lifecycle / tool policy / session projections / usage / 用户交互），不是只读 ledger tool 或 `evofence run` 子 CLI 包装 | 读实现 + 接口形状；确认沿用宿主 session/model/tools/context |
| 2 | DoD①：**同一 EvoFence session** 可在持续 DSH 会话中建立/继续/恢复（真实证据，非模拟） | 读轨迹（session identity、continue/resume 事件）；自建最小真实会话复跑 |
| 3 | DoD②：钩子失效 / 卸载 / runtime 错误 ⇒ 普通宿主工作保留、**未确认晋升被停止** | 自建故障注入；复刻作者用例 |
| 4 | DoD③ 版本落地：`engines.dsh` 与 `peerDependencies.@deepseek-ai/dsh-tools` 均更新为 **0.2.0-rc.2**，升级决定有记录 | 读 `integrations/deepseek-harness/package.json` diff 与 `VERSION-DECISION` 记录 |
| 5 | D1–D9/D17 逐项：0.2.0-rc.2 下**重验** 或 **保留 unknown**；D10/D13/D14/D15/D18/D19/D20 等 13 项 unknown **不得**因升级而冒充已验证 | 逐项对照 `probes/dsh/HOST-MAPPING.md` 与证据文件 |
| 6 | cp2 usage：按 invocation 去重、**缺 usage 不归零**；context/tool hooks 映射正确 | 复跑测试 + 读实现；抽样核对回执 |
| 7 | A15 单裁决：原生 board 只作投影，**board owner ⊆ kernel claim**，未另立 owner | 读实现 + 探针（构造 board/claim 分歧） |
| 8 | cp3：恢复 / 卸载 / 异常路径**可复现**；无法覆盖项明确记 `unsupported/unknown`，不猜测 | 复跑恢复用例；读 unknown 清单 |
| 9 | 负控：DoD① 与 DoD② 各至少一个真实 negative control（变异→变红→复原→复绿，记录变异点与用例名） | 复跑负控 |
| 10 | 门禁 | `npm run build/typecheck/src:policy/dep:check` = 0；`node --test test/l3-dsh-*.test.js` 两次一致全绿；`node verification/kernel/static-audit.mjs` exit 0、0 violations |
| 11 | 范围与核心边界 | `src/{protocol,kernel,runtime}/**` 未被本 lane 污染；HostPort 契约未被私改（若改须停下报告 drift）；未 commit、未碰 `.graph`；凭据未打印/未入库 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l3_dsh_session-review.md`，格式同前几份复验 dossier（复核对象 / 结论 / 逐条证据 / 未证明项 / 收工一致性；结论 = 可接受 或 需修订 + 计数）。
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异/负控只在 `dist/` 或临时副本，复原用 `git cat-file blob`（CRLF 陷阱）。
- 只跑本次 build 的 `dist/`；结论以实测为准；真实会话 smoke 记账（usage/成本），凭据不打印。
- D16 兼容缺口按裁决 A 收口（更新声明）；其余 unknown 原样保留。
