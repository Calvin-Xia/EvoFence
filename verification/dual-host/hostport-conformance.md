# HostPort conformance 核对 — `l3_dual_host_gate`

> 问题：两宿主对 `observe/execute/cancel/reconcile/context/usage` 的**实现**与 `capabilities` 的**声明**是否一致；不一致处逐条列出。
> 只读核对；不新增付费请求。核心能力矩阵的转录对象是 `docs/evofence-harness-kernel/probes/{dsh,pi}/HOST-MANIFEST.json`。

## 1. 契约面

| HostPort 方法 | 契约 | Pi 实现 | DSH 实现 |
|---|---|---|---|
| `observe` | `src/runtime/host-port/types.ts:233` | `src/hosts/pi/binding.ts:213-220` | `src/hosts/dsh/port.ts:40-50` |
| `execute` | `types.ts:234` | `binding.ts:183-210` | `port.ts:59-156` |
| `cancel` | `types.ts:235` | `binding.ts:221-240` | `port.ts:164-181` |
| `reconcile` | `types.ts:236` | `binding.ts:241-250` | `port.ts:182-195` |
| `context` | `types.ts:237` | `binding.ts:125-141` | `port.ts:12-24,51-58` |
| `usage` | `types.ts:238` | `binding.ts:251-260` | `port.ts:157-163` |

两宿主都**先过同一个能力判官**（`capabilities.ts:218 capabilityGate` / `capabilities.ts:190 judgeRequirements`）再触达原生动作；`cancel` 按设计不带 dispatch 门禁（`capabilities.ts:114-116` 注释），弱保证降级为 `unconfirmed/unknown` 而不是拒绝动作。

## 2. 方法级一致性核对

| 方法 | Pi | DSH | 一致性判定 |
|---|---|---|---|
| `observe` | 用 `PI_SESSION_CAPABILITIES`；`cancellation: partial`、`recovery: partial`、`isolation: partial`；`boardOwners: []` | 用 `DSH_CAPABILITIES`；`cancellation: partial`、`recovery: partial`、`isolation: unknown`；`boardOwners` 来自 `nativeBoard`，并被 `verifyBoardAuthority` 约束 | 一致（都只报自身状态，不报内核投影）；保证强度不同，与各自能力矩阵相符 |
| `execute` | 仅 `host.agent`；其余 kind 明确 `EFK_CAPABILITY_UNSUPPORTED`（"belongs to a separate host operation binding"） | `host.agent` / `host.tool` / `host.cancel`；其余 kind `EFK_CAPABILITY_UNSUPPORTED` | DSH 覆盖面更宽（tool 门禁已验证）；Pi 以单 effect 类型达成同一"会话内一次真实调用"语义 |
| `cancel` | 只取消**拥有中**的 active effect；preparedOnly → `not-executed`；abort+settled+idle → `native-ack`；否则 `unconfirmed`；未确认即 `unknown` | 只取消 active `host.agent` loop；`Agent.cancel({kind:user})`+`whenIdle` → `native-ack`；否则 `unconfirmed`/`unknown` | 一致（都拒绝越权取消、都保留 unknown） |
| `reconcile` | `resolved` / `not-executed` / `unknown` | `resolved` / `unknown` | **差异**：Pi 能表达"可证明未派发"，DSH 不能（靠核销记录表达） |
| `context` | 只接受 `current`，否则 `EFK_CAPABILITY_UNSUPPORTED`；`preservedHostResources: true` | 只接受 `current`；`fresh` 明确要求显式 delegation binding；`preservedHostResources: true` | 一致（fresh 都走独立委派 binding） |
| `usage` | `dedupeUsage` + `usageIsComplete`；`complete` 还要求预期 requestId 全部出现 | 同样 `usageIsComplete` + 请求 id 覆盖 | 一致（缺 usage 一律 `complete:false`，绝不写 0） |

## 3. 能力声明核对（实现使用的矩阵 vs 探针清单）

| 宿主 | 实现使用的矩阵 | 与探针清单的关系 | 结果 |
|---|---|---|---|
| DSH | `DSH_CAPABILITIES`（`capabilities.ts:22-50`，28 键） | 逐键转录自 `probes/dsh/HOST-MANIFEST.json#capabilities` | **0 处不一致**（本包脚本逐键比对） |
| Pi | `PI_SESSION_CAPABILITIES`（`src/hosts/pi/capabilities.ts`）= `PI_CAPABILITIES`（14 键）**+ 2 处收窄** | `PI_CAPABILITIES` 转录自 `probes/pi/HOST-MANIFEST.json`（0.87.1 时代）；session lane 覆盖 2 键 | **有意收窄**，非笔误（见下） |

`PI_CAPABILITIES` 的 14 键与 `probes/pi/HOST-MANIFEST.json` 逐键比对 **0 处不一致**。`src/hosts/pi/capabilities.ts` 额外把 `sdkChildSessionIsolation` 与 `reasoningHighGuarantee` 从 `verified`/`partial` 收窄为 `unknown`（理由：0.99.2 child session 不在本 session lane；payload high 已观测但无服务端档位保证）。`binding.ts` 的 `execute/observe/context` 用的正是这个收窄矩阵，因此**运行期声明比探针清单更保守**——方向安全，但必须显式记录，否则会被误读为"探针与运行时不一致"。

## 4. 不一致 / 需显式解释处（逐条）

1. **`sdkChildSessionIsolation`：探针 `verified` vs Pi session lane `unknown`。** 解释：版本漂移（0.87.1 → 0.99.2）下的保守收窄；DSH 探针仍是 `verified`（native-fixture）。两宿主都不在主 port 创建 fresh transcript。
2. **`reconcile` verdict 集合不同。** 解释：Pi 的 abort-before-dispatch 状态可在内存/entry 中证明，故给 `not-executed`；DSH 的 port 只读内存 receipt，未派发由 `reconciled-blocked-integration` 核销记录表达。这是**宿主机制差异**，不是契约违反（`ReconcileVerdict` 允许三者子集）。
3. **`boardOwners` 语义不同。** DSH 返回真实原生板 owner，并用 `verifyBoardAuthority`（`verify.ts:116`）证明投影等于 kernel claims；Pi 恒返回 `[]`（无原生板，`nativeTeamGraphBoard: absent`）。解释：投影只是观测，不产生第二裁决者。
4. **`execute` 覆盖面不同。** DSH 支持 `host.tool`；Pi 只支持 `host.agent`，工具门禁在 hook 层（`binding.ts:107-108 tool_call`）。解释：Pi 把"工具是否允许"作为 host hook 门禁，而不是一个可 `execute` 的 effect；两者都过 `judgeRequirements`。
5. **生产 DSH HostPort 未被场景 E2E 覆盖。** `scenarios/dsh/host.mjs:1-4` 只从 dist 导入 `DSH_CAPABILITIES`/`verifyBoardAuthority`/`ok`，自己实现 observe/execute/...；生产 `createDshHost`/`createDshDelegationBinding` 本轮回合**只做静态核对**。DSH lane 已在 REPORT/HANDOFF 显式声明"生产 binding 多请求 E2E 未证"（unknown）。Pi 场景则直接驱动生产 `src/hosts/pi`。
6. **`host-fake.ts` / `replay.ts` 未被任一场景使用。** `grep` 两场景驱动：无 `createFakeHost`、无 `evofence run`、无 fixture/synthetic/stub 端点。即两场景的 HostPort 面都是真实宿主路径，不是替身。
7. **Pi `capabilities.ts` 注释写 "Pi 0.87.1 … (15 entries)" 但常量实为 14 键。** 文档笔误级，不影响判定；建议后续修正注释或补齐。

## 5. 结论

- 两宿主的生产 HostPort **都通过了方法级一致性核对**：签名、错误契约（`HostResult` + 冻结 envelope）、能力门禁、usage 单次归约与"缺 usage 不归零"都与 `capabilities` 声明一致。
- 所有不一致都是**已声明或有解释的差异**（§4），没有发现"实现偷偷放宽声明的保证"或"声明了实现做不到的事"。
- 唯一实质缺口是**验证覆盖**而非语义：生产 DSH `createDshHost`/`createDshDelegationBinding` 的多请求 E2E 未证（unknown），这是 `gate-verdict.md` §3.2 的未证明项，不构成本 gate 的阻塞（本 gate 证明的是"实用闭环可用"，且 DSH 场景在真实原生 seam 上确实完成了闭环）。
