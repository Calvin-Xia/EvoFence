# L3 简报：`l3_pi_delegation` — Pi 子会话与子图执行 — codex lane `l3-pi-deleg`

> 图：`evofence-harness-kernel` · 节点 `l3_pi_delegation`（level 3, priority 19, context `ctx_host`）· 你是本 lane 的**执行 agent**（codex / gpt-6.1-sol xhigh）。图状态由 orchestrator 记录，你不写 `.graph`。

## 0. 工作区（orchestrator 已建好）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-pi-deleg` |
| 分支 | `refactor/hk-l3-pi-deleg`（基线 = 集成 HEAD `32692a5`） |
| node_modules | 已 junction 到集成 worktree —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（逐字）

- **plan**：基于探针选定的 SDK child session/executor 实现委派，**不声称 Pi 原生有与 DSH 完全相同的 team board**。显式继承授权、模型配置、预算与 workspace 范围；管理 parent-child cancellation 与 session lifetime。输出：相同语义的 delegation receipts。
- **DoD①**：具备有界 child creation/result/abort/restore 的合同证据。
- **DoD②**：实现不读取或复制未经授权凭据；总预算含 parent/child 所有调用。
- **cp1** child session 与 scope；**cp2** 结果/用量/取消映射；**cp3** parent 退出与恢复核验。
- 管辖 ADR：`adr_0001`（宿主内嵌内核与显式子图委托）、`adr_0006`（双宿主同等准入与显式差异）。

## 2. 必读输入（真相源）

- `src/runtime/host-port/types.ts`（`HostPort`：observe/execute/cancel/reconcile/context/usage）、`src/runtime/host-port/grant.ts`（`delegate()` **只实现数据规则**：child = parent 交集、深度递减；**不**铸造原生 child）、`src/runtime/host-port/capabilities.ts`（`teamDelegation` 状态、`host.delegate` 要求的 `parentChildCancellation`）。
- `src/kernel/policy/authority.ts`（`deriveAuthority` / `maxDelegationDepth` 拒绝路径）、`src/runtime/session/**`（应用服务）。
- `docs/evofence-harness-kernel/probes/pi/{HOST-MANIFEST,live-trace,offline-trace}.json`：`nativeTeamGraphBoard = absent`；明确记录 **"SDK child isolation is not an EvoFence delegated subgraph implementation"**；"Own delegated graph child sessions and shared authority/budget/claims" 属需自建项。
- `docs/evofence-harness-kernel/spec/contracts/{INTERFACES,SCHEMAS,OWNERSHIP}.md`：`Effect.kind=host.delegate`（payload `graphRef` + `context`）= **子图/子 grant/父池；不授予第二裁决/权限根**；`OWNERSHIP.md` §「宿主 board 作为子图调度 authority」本版本**不启用**（projection-only 与 delegated-owner 不可并存）。
- `src/hosts/pi/**`（刚 passed 的 session 绑定，本 lane 的起点）。

## 3. 落点与所有权

- **独占**：`src/hosts/pi/delegation*.ts`（新建）、`test/l3-pi-delegation*.test.js`。
- **禁止改**：core（`src/{protocol,kernel,runtime}/**`）与已 passed 模块；HostPort 契约若必须改 → **停下报告 drift**（不要自己改契约）。必要时对 `src/hosts/pi/**` 既有文件的**最小**变更需在本报告单列 diff 说明。
- 不 commit、不 install、不操作 `.graph`；**凭据不打印、不入库**（真实调用走用户既有认证）。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 child session 与 scope**：有界 child 创建（depth≤1 父派生），child grant = parent∩request（不得放宽 scope/capabilities/过期），child session identity 与 parent 关联；**不得授予第二裁决权或新权限根**（不是 board owner）。
2. **cp2 结果/用量/取消映射**：child result / usage / cancel 映射为 **delegation receipts**；父池预算把 parent+child 调用合并计入（缺 usage 不归零）；cancel 只拥有被点名的 child，不误伤普通宿主工作。
3. **cp3 parent 退出与恢复核验**：parent 退出/卸载/异常时 child 生命周期与回执可 reconcile（不盲重放、不重复计费）；恢复路径可复现。
4. DoD②：grep 证明不读取/复制未授权凭据；预算合并口径有测试与证据。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build/typecheck/src:policy/dep:check` 全 0；`node --test test/l3-pi-delegation*.test.js` 两次一致全绿；`node verification/kernel/static-audit.mjs` exit 0、0 violations。
- cp1 与 cp3 各至少一个真实 negative control（变异→变红→逐字节复原→复绿，记录变异点与用例名）。
- 证据分级：provider-live / native-fixture / unknown 分开标注；真实请求最小化并逐条记账；**不声称 Pi 有原生 team board**。

## 6. 完成回报格式

```
lane: l3-pi-deleg
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据
cp3: <passed|failed> — 证据
DoD①/②: child creation/result/abort/restore 的证据路径；凭据与预算合并证据
门禁: build/typecheck/src:policy/dep:check；两次测试数字；static-audit 结果
真实请求与成本: <条数 + usage 摘要>
未证明项: <如实（Pi 无原生 board、fork、收益等）>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者；防御性编程禁令（见 `SESSION-PROTOCOL.md`，硬性）；证据分级；不新增只镜像实现的测试。
