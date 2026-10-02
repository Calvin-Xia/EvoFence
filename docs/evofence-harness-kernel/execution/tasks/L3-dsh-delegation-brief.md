# L3 简报：`l3_dsh_delegation` — DSH 团队与子图执行 — codex lane `l3-dsh-deleg`

> 图：`evofence-harness-kernel` · 节点 `l3_dsh_delegation`（level 3, priority 17, context `ctx_host`）· 你是本 lane 的**执行 agent**（codex / gpt-6.1-sol xhigh）。图状态由 orchestrator 记录，你不写 `.graph`。

## 0. 工作区（orchestrator 已建好）

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-dsh-deleg` |
| 分支 | `refactor/hk-l3-dsh-deleg`（基线 = 集成 HEAD `32692a5`） |
| node_modules | 已 junction 到集成 worktree —— **不要 `npm install`** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（不要往那里写） |

## 1. 节点合同（逐字）

- **plan**：依据探针映射 agentTeams/workflow/child authority，按 **scoped grant** 调度已有团队；**保留 host authority 凭据，不用名称字符串冒充 caller**。把子任务产物、取消与 usage 映射为 receipts。输出：可延续团队委派适配。
- **DoD①**：创建/交接/等待/中断和失败反馈**覆盖 HostPort 契约**。
- **DoD②**：双方任务板同步**有唯一权威**，防止两套 scheduler 争抢和重复执行。
- **cp1** host 团队 identity 与 grant；**cp2** 执行与双向反馈；**cp3** 取消/接管/重复回包核验。
- 管辖 ADR：`adr_0001`、`adr_0006`。

## 2. 必读输入（真相源）

- `docs/evofence-harness-kernel/probes/dsh/{HOST-MANIFEST,offline-trace,live-trace}.json`、`README.md`：`teamDelegation = verified`（TeamService + spawn 创建 fresh child、parentSession 关联、消息 durable enqueue；**fork 未测**）；`HOST-MAPPING.md` 的 D 系列（含 **13 项 unknown**，不得当已验证）。
- `src/runtime/host-port/{types,capabilities,grant}.ts`：`HostPort` 的 execute/cancel/reconcile；`host.delegate` 需要 `parentChildCancellation`；`delegate()` 只做数据规则（交集 + 深度），**不授予第二裁决/权限根**。
- `docs/evofence-harness-kernel/spec/contracts/{INTERFACES,SCHEMAS,OWNERSHIP}.md`：`EffectPayload.graphRef` = 子图；`OWNERSHIP.md` §「宿主 board 作为子图调度 authority」**本版本不启用**（= projection-only，单一权威；不得以 hidden flag 启用第二权威）。
- `src/hosts/dsh/**`（刚 passed 的原生绑定，本 lane 的起点）、`integrations/deepseek-harness/**`（Cordis 集成现状）。

## 3. 落点与所有权

- **独占**：`src/hosts/dsh/delegation*.ts`（新建）、`test/l3-dsh-delegation*.test.js`。
- **禁止改**：core（`src/{protocol,kernel,runtime}/**`）与已 passed 模块；`HostPort` 契约若必须改 → **停下报告 drift**；`integrations/deepseek-harness/**` 如需小改须单列 diff 说明。
- 不 commit、不 install、不操作 `.graph`；**凭据不打印、不入库**。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

1. **cp1 host 团队 identity 与 grant**：把原生 team/agent identity 与 **scoped grant** 绑定（caller 由真实身份/凭据确定，**不得用名称字符串冒充 caller**）；child 权限 ≤ 父 grant；不改写宿主权限根。
2. **cp2 执行与双向反馈**：创建/交接/等待/中断/失败反馈全部走 HostPort 语义（execute → receipts），子任务产物、取消、usage 映射为 receipts（按 invocation 去重、缺 usage 不归零）；宿主 board 仅作**投影**，**唯一权威是 kernel claim**（DoD②：不得出现两套 scheduler 争抢同一工作）。durable enqueue/delivery 语义如实标注（`deliveryGuarantee`）。
3. **cp3 取消/接管/重复回包核验**：cancel 只作用于被点名的真实 child；重复/迟到的 child 回包只归档、不重复计费或重复推进；接管/恢复路径可复现（不盲重放）。
4. 探针未测项（如 fork）与 13 项 unknown **原样保留**，不得因本 lane 而升级为已验证。

## 5. 自证与门禁（硬性）

- lane 内 `npm run build/typecheck/src:policy/dep:check` 全 0；`node --test test/l3-dsh-delegation*.test.js` 两次一致全绿；`node verification/kernel/static-audit.mjs` exit 0、0 violations。
- DoD①（覆盖 HostPort 创建/交接/等待/中断/失败反馈）与 DoD②（单一权威、无重复执行）各至少一个真实 negative control（变异→变红→逐字节复原→复绿，记录变异点与用例名）。
- 证据分级：provider-live / native-fixture / unknown 分开标注；真实请求最小化并逐条记账。

## 6. 完成回报格式

```
lane: l3-dsh-deleg
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据
cp3: <passed|failed> — 证据
DoD①/②: HostPort 覆盖与单一权威的证据路径
门禁: build/typecheck/src:policy/dep:check；两次测试数字；static-audit 结果
真实宿主证据: <provider-live / native-fixture / unknown 分级>
未证明项: <如实（fork、13 项 unknown 等）>
阻塞: <无 / 具体>
```

## 7. 纪律

- 单写入者；防御性编程禁令（见 `SESSION-PROTOCOL.md`，硬性）；不用名称字符串冒充 caller；不新增只镜像实现的测试。
