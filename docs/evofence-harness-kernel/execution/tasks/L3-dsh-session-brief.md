# L3 简报（待用户裁决 A 后生效）：l3_dsh_session — DSH 0.2.0-rc.2 原生会话绑定 — codex lane `l3-dsh`

> 前提：用户裁决 **A（跟随升级到 0.2.0-rc.2）**。若裁决为 B/C，orchestrator 先改写版本段与验收口径再派单。你只写本 lane 产物；图状态由 orchestrator 记录。

## 0. 工作区（orchestrator 派单时建）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-dsh` |
| 分支 | `refactor/hk-l3-dsh`（基线 = 派单时集成 HEAD） |
| node_modules | 指向集成 worktree 的 junction —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（graph get-node -i l3_dsh_session）

- **plan**：将已验证 Cordis lifecycle、tool policy/result、session projections、usage 和用户交互接到 runtime。注册原生 EvoFence 操作与状态视图，**沿用现有 session/model/tools/context**。输出：DSH binding，不以只读 ledger tool 或 `run` 子 CLI 为实现。
- **DoD①**：在持续 DSH 会话中建立/继续/恢复同一 EvoFence session。
- **DoD②**：钩子失效、卸载或 runtime 错误时保留普通宿主工作并停止未确认晋升。
- **DoD③（版本）**：目标 DSH 版本 = 本机实测 **0.2.0-rc.2**（`probes/dsh/VERSION-PIN.json`）；**更新 `integrations/deepseek-harness` 的 `engines`/`peerDependencies` 到 0.2.0-rc.2 并记录升级决定**（用户裁决 A 的落地动作；0.1.7-rc.1 的旧钉法仅作历史）。
- **checkpoints**：cp1 接入事件和会话身份；cp2 context/tool/usage 映射；cp3 恢复/卸载/异常核验。

## 2. 必读输入（真相源）

- `probes/dsh/{VERSION-PIN,HOST-MANIFEST,offline-trace,live-trace}.json`、`README.md`、`HOST-MAPPING.md` D1–D17/DV/D16（**13 项 unknown 与 D16 兼容缺口**——如实保留，不得当已验证）
- `src/runtime/host-port/**`（HostPort 契约，L2 已过）、`src/runtime/session/**`（应用服务）、`src/kernel/store/**`（ports）
- `integrations/deepseek-harness/**`（Cordis 集成现状；升级目标 0.2.0-rc.2）+ `integrations/deepseek-harness/cordis.patch.yml`
- `spec/contracts/{INTERFACES.md,SCHEMAS.md,OWNERSHIP.md}`（A15 board 仅投影、A05 单裁决）、`adr_0001`、`adr_0006`、`L2-PROTOCOL-NOTES.md`
- `docs/evofence-harness-kernel/execution/L3-DSH-VERSION-DECISION.md`（用户裁决落地说明）

## 3. 落点与所有权

- **独占**：`src/hosts/dsh/**`（新建；hosts 层在 core 闭包之外）+ `test/l3-dsh-*.test.js`；`integrations/deepseek-harness/**` 的版本声明与必要适配（单列 diff 说明）。
- **禁止改**：core（`src/{protocol,kernel,runtime}/**`）与已 passed 模块；HostPort 契约若必须改 → 停下报告 drift。
- 不 commit、不 install、不操作 `.graph`；**凭据不打印、不入库**。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 事件与会话身份**：Cordis lifecycle（session 创建/继续/恢复）、tool policy/result、session projections、usage、用户交互 → HostPort/runtime 观察与回执；原生 session identity 与 kernel session 绑定（同一 session 可 continue/resume）。
2. **cp2 context/tool/usage 映射**：context/tool hooks、usage（按 invocation 去重、缺 usage 不归零）、状态视图注册（EvoFence 操作与状态展示）；**A15**：原生 board 只作投影（board owner ⊆ kernel claim），不得另立 owner。
3. **cp3 恢复/卸载/异常**：DSH 重启/卸载/钩子失效时保留普通宿主工作、未确认晋升停止；恢复路径可复现；13 项 unknown 如仍无法覆盖 → 明确 `unsupported/unknown` 记录（不猜测）。
4. 证据分级：offline/native-fixture 与真实 provider 调用分开标注；真实会话 smoke 记账（usage/成本）；升级到 0.2.0-rc.2 后对 D1–D9/D17 等版本敏感项给出**重验或保留 unknown** 的结论。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build/typecheck/src:policy/dep:check` 全 0；`node --test test/l3-dsh-*.test.js` 两次一致全绿；`node verification/kernel/static-audit.mjs` exit 0、0 violations。
- DoD①（同 session continue/resume）与 DoD②（钩子失效保留宿主工作/停止未确认晋升）各至少一个真实 negative control（变异→变红→复原→复绿，记录变异点与用例名）。

## 6. 完成回报格式

```
lane: l3-dsh
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据
cp3: <passed|failed> — 证据
版本落地: engines/peerDependencies 更新 diff + 0.2.0-rc.2 重验/保留 unknown 清单
真实宿主证据: <provider-live / native-fixture / unknown 分级>
门禁: build/typecheck/src:policy/dep:check/test 数字；static-audit 结果
未证明项: <如实（13 项 unknown 现状）>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者；D16 兼容缺口按裁决 A 收口（更新声明），但 D10/D13/D14/D15/D18/D19/D20 等未知不得因升级而冒充已验证。
- 防御性编程禁令与证据分级见 `SESSION-PROTOCOL.md`；不新增只镜像实现的测试。
