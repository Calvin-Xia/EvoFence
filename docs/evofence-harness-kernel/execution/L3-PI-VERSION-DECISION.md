# 待用户裁决：l3_pi_session 的 Pi 版本政策（2026-10-02）

> 状态：**待用户回答**（不阻塞 lane 继续做版本无关部分；实体 DoD① 证据在裁决前保持 blocked）。
> 同批待决：`L3-DSH-VERSION-DECISION.md`（DSH 0.1.7-rc.1 pin vs 本机 0.2.0-rc.2）。

## 事实

| 项 | 值 | 证据 |
|---|---|---|
| 冻结目标版本 | **Pi 0.87.1** | `probes/pi/VERSION-PIN.json` `/version`；`HOST-MAPPING` P1–P17 均以该版本取证 |
| 本机现状 | 全局 `@earendil-works/pi-coding-agent` = **0.99.2**（唯一副本；未找到 0.87.1 包） | `C:\Users\Calvin-Xia\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\package.json` |
| fleet 自身 | herdr 编队里的 pi 就是 0.99.2（同一全局包） | 本 session/herdr 运行环境 |
| l3_pi_session DoD | 在既有 Pi session 内运行内核（不用 `--no-session` 子 CLI）；agent_end/settled/abort 版本差异不造成早结算/重入/context 失效 | 节点合同 |
| 执行纪律 | 不 install；不得静默换版本；证据不得升级 | `SESSION-PROTOCOL.md`、goal 约束 4 |

lane 已发现该漂移并自设版本拒绝门禁：不把 0.99.2 实跑冒充 0.87.1 证据，改为对照 v0.87.1 源码做离线实现（正在拉 `raw.githubusercontent.com/earendil-works/pi/v0.87.1/...`）。

## 选项

| 选项 | 内容 | 代价/风险 |
|---|---|---|
| **A. 跟随实际安装版本（推荐）** | 把目标版本重钉到 **0.99.2**（更新 VERSION-PIN/HOST-MAPPING 的版本行 + 记录「0.87.1 时代的 P1–P17 证据需按 0.99.2 重验/补差」），lane 按 0.99.2 实测适配 | 需要重跑受版本影响的能力探针（extension 事件/ idle 语义/tool hooks/usage）并把差异写进版本差异表；这是一次**合同版本变更**，需你确认（属于「目标变更需用户」） |
| **B. 保持 0.87.1 目标** | 保留 pin；lane 只交付版本无关实现与离线对齐 | 本机无 0.87.1 → 真实会话 DoD① 无证据，节点只能 blocked/部分证据；l3_pi_delegation / l3_pi_scenario / l3_dual_host_gate 连带受阻（L3 无法按现 DoD 闭合） |
| **C. 提供 0.87.1** | 你提供可运行的 0.87.1 包（绝对路径，如 `EVOFENCE_PI_PACKAGE_ROOT`）或授权 `npm i -g @earendil-works/pi-coding-agent@0.87.1` | 恢复原计划；需你给出路径或安装授权 |

## 建议

选 **A**（把 pin 更新到 0.99.2 并重验版本敏感项）。理由：0.87.1 已不在本机、编队与用户日常环境都已是 0.99.2；冻结 pin 的本意是「版本固定可复现」，而非锁死一个不可运行版本。若你更重视与 L1 证据严格同版本，可选 C。

## 回答方式（一句话）

- 「Pi 跟随 0.99.2（A）」或「保持 0.87.1，接受 blocked（B）」或「0.87.1 在我给的路径/授权安装（C）」。
