# DoD② 判定 — 是否存在"仅能读 ledger"的宿主

> 节点 DoD② 逐字：**"首发任一宿主仅能读 ledger 时，拒绝本阶段通过。"**
> 这是一条**否决性**验收：只要任一宿主在首发时只能读 ledger（即接入面是只读工具/CLI，而不是真实闭环），本 gate 必须判**不通过**。
> 判定依据：`scenarios/TASK-CONTRACT.md` §2 的九阶段语义 + `adr_0006` 的"拒绝只读 tools 或 CLI integration"。两场景证据均为本地已产出的 provider-live 原始证据，本包 0 付费复核。

## 1. "仅能读 ledger" 的操作化定义

一个宿主若满足以下任一条件，即视为"仅能读 ledger"（对应 `adr_0006` 明确拒绝的捷径）：

- 接入面只有只读工具（读文件 / 读 ledger / 读图），**不能**在真实 workspace 产生写入；
- 不能驱动原生 agent loop（无 provider-live 真实请求），只做静态投影；
- 不能派发原生子会话（无真实并行），只能顺序伪并行；
- 不能取消/恢复同一原生会话；
- "完成"只由自己的 REPORT 声明，没有独立可核对的测试/门禁。

## 2. 逐条核对（两宿主）

| 判据 | Pi | DSH | 结论 |
|---|---|---|---|
| 真实 workspace 写入 | scratch 内 3 源码 + 2 新增文件；sha256 5/5 命中；`git status` = `M catalog.ts / M context.ts / M ledger.ts / ?? test/… / ?? docs/…` | scratch 内同 5 文件；staged diff `489 insertions / 8 deletions`；sha256 5/5 命中 | **都不是只读** |
| 真实原生 loop（provider-live） | 84 条真实 Provider HTTP 200 + 原始 usage；两个 SDK child session | 75 条真实 Provider HTTP 200；TeamService `spawnTeammate` 两个原生 worker | **都有真实执行面** |
| 原生子会话真实并行 | 两个 author child provider 窗口重叠 58,489 ms | 两个 worker 窗口重叠 49,627 ms | **都有真实并行** |
| 取消 + 同会话恢复 | `native-abort-ack` + 同 session 文件前缀 sha256 一致 + nonce 复现 | `native-cancel-ack`（`reason.kind=aborted`）+ 同 session 前缀 `d7d75e13…` 一致 + nonce 复现 | **都能恢复** |
| 独立 verification（非自证） | 独立 verifier child：负控 4 红 → 复原 → 7/7；四门禁 0 | 独立 verifier child：负控 4 红 → 复原 → 4/4；四门禁 0 | **都有独立验证** |
| 真实任务语义 | `ledger show … [--limit N]`：`N` 正十进制安全整数、非法显式 exit 1、缺省不改行为、先 run-id 过滤再取前 N | 同一功能，语义一致（同冻结合同） | **同一真实任务** |
| 拒读-only 证据 | 场景驱动无 `evofence run` / 无 fixture / 无 `createFakeHost` | 同上 | **无替身捷径** |

## 3. 判定

**DoD② 判定：满足（不触发否决）。** 两个宿主都完成了真实闭环——写入真实 workspace、驱动真实原生 loop、派发真实原生子会话、具备取消与同会话恢复、并由独立 verifier 复核——不存在"仅能读 ledger"的宿主。

补充口径（防止误读）：

- "读 ledger"在这里指**接入能力**，不是"任务碰巧读 ledger"。两个宿主都确有一次只读的 ledger 命令（`ledger show`），但那是被实现的**产品功能**，且两场景都另在 scratch 内产生了真实源码/测试写入，所以不构成"仅能读 ledger"。
- 本判定**不**蕴含 `adr_0008` 的能力收益结论；只回答"被否决条件是否成立"。

## 4. 与 DoD① 的关系

- DoD①：两宿主**均**通过合同与实际任务闭环 → 满足（见 `truthfulness-check.md`）。
- DoD②：不存在只读 ledger 宿主 → 不触发否决。
- 两条 DoD 同时成立，本 gate 具备判**通过**的验收前提（最终裁决与限制见 `gate-verdict.md`）。
