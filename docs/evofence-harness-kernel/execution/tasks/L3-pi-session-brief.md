# L3 波次 1 简报：l3_pi_session（Pi 原生扩展绑定）— codex lane `l3-pi`

> 图：`evofence-harness-kernel` · 阶段 L3 · 上游 L2 全部 passed（HEAD 见派单消息；集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`）。
> 你只写本 lane 产物；图状态由 orchestrator 记录（lane 内没有 `.graph`）。

## 0. 工作区（orchestrator 已建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-pi` |
| 分支 | `refactor/hk-l3-pi`（基线 = 集成 HEAD） |
| node_modules | 指向集成 worktree 的 symlink —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l3_pi_session）

- **plan**：将版本固定的 Pi extension events、context/tool hooks、`appendEntry`/session identity 与 usage 接到 runtime；必要的后台工作经 SDK/安全点调用。保留宿主持久 session 与资源。输出：Pi binding 与正式 idle 语义适配。
- **DoD①**：在既有 Pi session 内运行内核，**不再以 `--no-session` 等参数启动隔离子 CLI**。
- **DoD②**：`agent_end`/`agent_settled`/`abort` 的版本差异不造成早结算、重入或 context 失效。
- **checkpoints**：cp1 扩展 lifecycle 绑定；cp2 tool/context/usage 映射；cp3 恢复/idle/卸载核验。

## 2. 必读输入（真相源）

- `docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json`（**目标 Pi 0.87.1**）、`probes/pi/live-trace.json`、`offline-trace.json`、`HOST-MANIFEST.json`、`README.md`
- `docs/evofence-harness-kernel/spec/contracts/HOST-MAPPING.md`：P1（同 session 保留，provider-live）、P2（host tools/skills 保留）、P3/P4（tool gate/result 回调）、P5（raw usage）、P6（abort/断连）、P7（disk restore）、P8（child 隔离）、P9（appendEntry custom entry）、P12（无原生 board）、P17（agent_end 后 agent_settled）
- `spec/contracts/INTERFACES.md`（HostPort 行、createKernel(ports) 注入形态）、`OWNERSHIP.md` I01–I08（**core 闭包=protocol/kernel/runtime，任何 fs/node builtin 不得进 core**）、`L2-PROTOCOL-NOTES.md`
- L2 上游实现（只读参照）：`src/runtime/host-port/**`（HostPort 契约、receipt 幂等、unknown）、`src/runtime/session/**`（应用服务：observe/reconcile/usage）、`src/kernel/store/**`（ports/契约）
- 现有 Pi 适配参考（可读、可复用模式，不要破坏旧用法除非声明）：`integrations/pi/**`（`evofence.js`、`cli.js`、README）

## 3. 落点与所有权

- **独占**：`src/hosts/pi/**`（新建；hosts 层在 core 闭包之外，允许 node builtin/SDK/fs）；`test/l3-pi-*.test.js`（平铺，从 `dist/**` 导入，≤350 行/文件）。
- **禁止改**：`src/{protocol,kernel,runtime}/**`（core 冻结；若 HostPort 契约必须改，停下报告 drift，不自行改）。`integrations/**` 只在必要时小改并单列 diff 说明。
- 不 commit、不 install、不操作 `.graph`；结束时 lane `git status` 只显示你的文件。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 lifecycle 绑定**：Pi extension 事件（session start/end、tool request/result、`agent_end`、`agent_settled`、abort、自定义 entry、usage）→ 映射为内核观察/回执，绑定到**既有持久 session**（不得用隔离 sub-CLI 冒充）；idle 语义以 `agent_settled`（awaited `agent_end` 之后）为准，早结算/重入有防护与用例。
2. **cp2 映射**：context/tool hooks、usage（按 invocation 去重，缺 usage 不归零）、`appendEntry`/session identity；与 `SessionPorts`/HostPort 的适配层（纯映射 + 注入端口）。
3. **cp3 恢复/idle/卸载核验**：版本差异表（0.87.1 实测 vs 文档声明）；崩溃/卸载/异常时保留普通宿主工作、未确认晋升停止；恢复路径有可复现轨迹。
4. 证据分级：fixture/离线轨迹有价值；凡标 provider-live 的能力需**真实 Pi 进程**的最小 smoke（真实请求数尽量少并记录 usage/成本）；unknown/absent 如实保留。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build`、`typecheck`、`src:policy`、`dep:check` 全 0；`node --test test/l3-pi-*.test.js` 全绿（两次一致）。
- **core 未被破坏**：在集成 worktree 跑 `node verification/kernel/static-audit.mjs`（exit 0、0 violations）——你不在集成写文件，可只读运行或在 lane 内跑同一脚本（它只读仓库）。
- 每条 DoD 至少一个真实 negative control（变异→变红→复原→复绿，报告变异点与用例名）。
- 防防御性编程禁令与测试口径见 `SESSION-PROTOCOL.md`。

## 6. 完成回报格式

```
lane: l3-pi
cp1: <passed|failed> — 证据（命令/输出摘要/用例名/真实进程证据路径）
cp2: <passed|failed> — 同上
cp3: <passed|failed> — 同上
版本差异表: <路径>
真实宿主证据: <哪些是 provider-live / 哪些是 fixture / unknown>
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者：本 lane 独占上述目录；不得改集成 worktree。
- 证据不得升级：fixture 不等于真实宿主；`--no-session` 子 CLI 不算 DoD① 通过。
- 凭据不打印、不进命令行、不入库；真实调用走用户既有认证。
