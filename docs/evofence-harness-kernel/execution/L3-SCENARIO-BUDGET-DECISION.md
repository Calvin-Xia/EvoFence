# 待用户裁决：L3 长程场景的模型 / 预算 / 任务来源（2026-10-02）

> 状态：**待用户回答**（不阻塞其它 L3 节点；`l3_pi_scenario`/`l3_dsh_scenario` 开工前需要）。
> 关联：`L3-PI-VERSION-DECISION.md`（Pi 版本 pin）、`L3-DSH-VERSION-DECISION.md`（DSH 版本 pin）——场景运行在真实宿主上，宿主版本政策同样适用。

## 为什么需要这个决定

`l3_pi_scenario` 与 `l3_dsh_scenario` 的合同要求：在**授权的真实仓库任务**中跑 inspect/decompose/parallel workers/integrate/fresh verify/repair/finish，并「模型与预算须另行给定并计入真实用量」。当前没有指定：(1) 场景用哪些模型；(2) 美元/调用预算；(3) 用哪个仓库与任务。

## 需要用户给出的三项

| # | 项 | 选项/建议 |
|---|---|---|
| 1 | **模型** | Pi 侧：建议沿用编队标准 `deepseek/deepseek-flash`（high）或你偏好的模型；DSH 侧：用 DSH 自身配置的模型（等版本政策定案后在绑定 lane 里读取并固定）。若要真实供应商对照，请点名模型 |
| 2 | **预算** | 现状口径：本轮 deepseek/gpt「不设美元硬上限，但逐请求记录 usage 与参考成本」。场景是否沿用同一口径，或给一个明确的软上限（如 $X）？ |
| 3 | **任务来源** | (a) **建议**：EvoFence 的 scratch clone + 一个有界真实任务（例如在有测试的模块里实现一个小功能/修复一个预埋缺陷），跑完保留 trace 与产物，不触碰交付分支；(b) 你指定的其它仓库/任务；(c) 由场景 lane 提出候选任务书，你批准后开跑 |

## 建议默认（若你只回「按建议走」）

- 模型：Pi `deepseek/deepseek-flash` (high)；DSH 用其配置模型；全部请求逐条记 usage 与参考成本。
- 预算：不设美元硬上限（沿用本轮口径），但场景开始前在报告里给出预计上界与实际用量。
- 任务：(a) scratch clone + 有界真实任务；两份场景（DSH/Pi）使用**同一任务合同**（同语义对照），任务书与验收标准在开跑前写入 `scenarios/` 并冻结。

## 回答方式（一句话）

- 「按建议走」；或
- 逐项给出：模型 / 预算 / 任务来源。
