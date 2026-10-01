# L3 简报（待用户裁决 A 后生效）：l3_pi_session 重定版 0.99.2 + 真实会话证据 — codex lane `l3-pi-b`

> 前提：用户裁决 **A（Pi 跟随 0.99.2）**。若裁决为 B/C（保持 0.87.1 / 提供 0.87.1 包），orchestrator 改写版本段后另行派单。你只写本 lane 产物；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 派单时建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-pi-b` |
| 分支 | `refactor/hk-l3-pi-b`（基线 = 派单时集成 HEAD，含部分交付 e6dd793 的 `src/hosts/pi/**`） |
| node_modules | 指向集成 worktree 的 junction —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 任务（基于已交付的部分实现续做）

已交付（commit `e6dd793`）：`src/hosts/pi/**` 绑定（持久 session 必需、agent_end ≠ 最终 settlement、context/tool/usage、appendEntry/session identity、恢复/idle/abort 路径）+ `VERSION-DIFFERENCES.md` + `evidence/*`；cp2/cp3 在 fixture 上通过；cp1 因 pinned 0.87.1 不可用而 blocked。

本 lane（裁决 A 后）：
1. **重定版**：把 `docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json` 的目标版本从 0.87.1 更新为 **0.99.2**（保留历史记录与变更理由），并在 `HOST-MAPPING.md` 的 Pi 列记录「0.87.1 时代的 P1–P17 证据需按 0.99.2 重验/补差」。
2. **适配**：按本机 `@earendil-works/pi-coding-agent@0.99.2` 的真实 extension API（`dist/core/extensions/types.d.ts`）核对/修正 `src/hosts/pi/**`：`agent_end`/`agent_settled`/abort、tool hooks、`appendEntry`、usage、session identity 的版本差异；更新 `VERSION-DIFFERENCES.md`（0.87.1 ↔ 0.99.2 对照与降级/拒绝路径）。
3. **真实会话证据（DoD① 关键）**：用**真实 Pi 0.99.2 进程**在既有持久 session 内加载本扩展并跑内核的最小 smoke（不用 `--no-session` 隔离子 CLI 冒充）；**最小化真实请求数并逐条记录 usage/参考成本**；轨迹证据（事件序列、session identity、settle 时机）落盘。
4. **重验版本敏感项**：对 P1/P2/P3/P4/P9/P17 等逐项给出「0.99.2 实测重验」或「保留 unknown」的结论（不得沿用 0.87.1 结论充当 0.99.2 证据）。
5. 保留版本拒绝门禁（非 0.99.2 版本拒绝适配）。

## 2. 必读输入

- `docs/evofence-harness-kernel/probes/pi/{VERSION-PIN,HOST-MANIFEST,live-trace,offline-trace}.json`、`README.md`、`HOST-MAPPING.md`（P1–P17）
- `src/hosts/pi/**`（已交付部分，本 lane 的起点）、`src/runtime/host-port/**`、`src/runtime/session/**`
- `docs/evofence-harness-kernel/execution/L3-PI-VERSION-DECISION.md`、`src/hosts/pi/VERSION-DIFFERENCES.md`
- `integrations/pi/**`（旧适配参考，只读）

## 3. 落点与所有权

- **独占**：`src/hosts/pi/**`（演进既有文件 + 新证据）、`test/l3-pi-*.test.js`、`probes/pi/VERSION-PIN.json` 与 `HOST-MAPPING.md` 的 Pi 版本行（单列 diff 说明）。
- **禁止改**：core 与已 passed 模块；`integrations/pi/**` 如有必要小改需单列 diff。
- 不 commit、不 install、不操作 `.graph`；**凭据不打印、不入库**（真实调用走用户既有认证）。

## 4. 自证与门禁（硬性）

- `npm run build/typecheck/src:policy/dep:check` 全 0；`node --test test/l3-pi-*.test.js` 两次一致全绿；`static-audit` exit 0、0 violations。
- DoD①（真实 Pi 0.99.2 会话内运行内核）与 DoD②（agent_end/settled/abort 差异不造成早结算/重入/context 失效）各至少一个真实 negative control（变异→变红→复原→复绿）+ 真实进程证据。
- 证据分级：provider-live / native-fixture / unknown 分开标注；不为凑证据放宽 smoke 口径。

## 5. 完成回报格式

```
lane: l3-pi-b
cp1: <passed|failed> — 证据（真实会话轨迹路径 + usage）
cp2: <passed|failed> — 证据
cp3: <passed|failed> — 证据
版本重验: P1/P2/P3/P4/P9/P17 逐项（0.99.2 实测 / 保留 unknown）
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
真实请求与成本: <条数 + usage 摘要>
未证明项: <如实>
阻塞: <无 / 具体>
```

## 6. 纪律

- 单写入者；不得用 `--no-session` 子 CLI 或 fixture 冒充 DoD①；真实请求最小化并记账。
- 防御性编程禁令与证据分级见 `SESSION-PROTOCOL.md`。
