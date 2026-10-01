# 待用户裁决：l3_dsh_session 开工前 DSH 版本策略（2026-10-02）

> 状态：**待用户回答**（节点 `l3_dsh_session` 因此暂停在 pending，不认领、不开工；其余 L3 节点继续）。
> 依据：`l3_dsh_session` 的 DoD 明确「目标 DSH 版本以本机实测的 0.2.0-rc.2 为准（见 probes/dsh/VERSION-PIN.json）；仓库内 integrations/ 的 DSH package 仍钉 engines.dsh 与 peerDependencies[@deepseek-ai/dsh-tools] = 0.1.7-rc.1。**开工前须由用户决定跟随升级或显式声明不兼容，不得静默按旧版本适配。**」

## 事实

| 项 | 值 | 证据 |
|---|---|---|
| 本机实测 DSH | **0.2.0-rc.2** | `probes/dsh/VERSION-PIN.json` `/observedVersion`（DV） |
| 集成包声明 | `engines.dsh` 与 `peerDependencies[@deepseek-ai/dsh-tools]` = **0.1.7-rc.1** | `integrations/deepseek-harness/package.json`；`HOST-MAPPING` D16 `existingIntegrationCompatibility: unknown`（「旧 peer/engines 0.1.7-rc.1 与 0.2.0-rc.2 不符」） |
| DSH 能力证据 | D1–D9/D11/D12/D17 verified（多为 native-fixture）；D10/D13/D14/D15/D16/D18/D19/D20 unknown | `probes/dsh/offline-trace.json`、`HOST-MANIFEST.json` |

## 选项

| 选项 | 内容 | 代价/风险 |
|---|---|---|
| **A. 跟随升级（推荐）** | 把 `integrations/deepseek-harness` 的 engines/peerDependencies 更新到 0.2.0-rc.2，并按**实测 0.2.0-rc.2**适配 Cordis lifecycle / tool policy / session projections / usage 绑定 | 0.1.7→0.2.0 的 API 差异需重新探针核验（D1–D9 的 fixture 证据可能要重跑）；升级本身不触碰 src core |
| **B. 显式声明不兼容** | 保留 0.1.7-rc.1 咬合，在集成 README/节点证据显式声明与 0.2.0-rc.2 不兼容 | 本机没有 0.1.7-rc.1 → 无法真实运行绑定，节点只能停在 blocked/部分证据；且 `l3_dual_host_gate` 的 DoD「首发任一宿主仅能读 ledger 时拒绝本阶段通过」将使 **L3 无法闭合** |
| **C. 其它** | 例如本机补装 0.1.7-rc.1 做双版本目标，或给出别的兼容口径 | 需用户明确给出 |

## 建议

选 **A**：目标版本已是本机实测的 0.2.0-rc.2，探针与 HOST-MAPPING 都以它为真；升级集成声明比把整条 DSH 侧锁死在不可运行版本上更符合 DoD 与 L3 目标（双宿主同等首发）。

## 用户回答方式（一句话即可）

- 「跟随升级到 0.2.0-rc.2」→ 我据此更新集成声明并派 l3_dsh_session lane（codex），随后按合同收口；
- 「声明不兼容（B）」→ 我把 DSH 侧标为 blocked/unsupported 并如实写入 L3 记录（L3 将无法按现 DoD 闭合，需同时改图或改 DoD——那属于目标变更，需你确认）；
- 其它口径请直接说明。
