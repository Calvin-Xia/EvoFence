# 任务简报：l1_eval_protocol（冻结实用场景和收益评测协议）

> 执行者：pi pane `verify-main`（model `deepseek/deepseek-flash` / thinking `high`），cwd = 本 worktree。
> 图状态由 orchestrator S02 记录，你**不要**改 `.graph/`。本节点是**首稿作者**，之后会有第二双眼睛复核并可能要求你修订。

## 0. 工作区

- cwd：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`
- 只许写本简报第 4 节列出的路径。不改 `.graph/`、`src/`、`test/`、`test-e2e/`、`integrations/`、`package.json`；不 git commit；不发布。

## 1. 先读（按顺序）

1. `docs/evofence-harness-kernel/execution/SESSION-PROTOCOL.md`（授权、预算与证据分级纪律）
2. `docs/evofence-harness-kernel/CONTRACTS.md`（协议/状态/并发/恢复/授权预算草案）
3. `docs/evofence-harness-kernel/ARCHITECTURE.md`（三项价值假设与演化闭环）
4. `docs/evofence-harness-kernel/REVIEW.md`（人审取舍、未知毕业条件、验收边界）
5. `docs/evofence-harness-kernel/SOURCES.md`（资料范围，**不得**把其中未核实的说法当结论）
6. `docs/evofence-harness-kernel/probes/pi/README.md` + `HOST-MANIFEST.json`（已完成的 Pi 探针：固定版本、usage 来源、模型真实性限制）
7. `docs/evofence-harness-kernel/execution/MODEL-BUDGET.json`（历史预算记账形状，本节点**不**改动它）
8. 管辖 ADR：`adr_0005`（任务完成、评价、晋升与激活分离）、`adr_0008`（收益证据的对照、盲测与总预算）

## 2. 节点合同（逐条满足）

**Plan**：输入＝长程编码、多 agent、长期演化三项价值假设。设计 train/dev/held-out/终审拆分、原宿主对照、图编排组、长期演化组、固定模型版本/总预算与停止规则。预算计入全部 planner、worker、reviewer、学习与评测调用；预注册主要指标、最小有价值收益和区间方法。输出＝可复现实验协议，**阈值须在结果出现前审定**。

**DoD**
- 普通任务完成与能力改善有**不同**验收合同。
- 冻结成功率/质量主指标、成本/时间约束和学习消融；**不足统计证据可给 inconclusive**。

**Checkpoints**
- `cp1` 冻结场景与数据拆分
- `cp2` 定义总资源匹配和对照
- `cp3` 人审阈值与终审盲测流程

## 3. 必须回答的硬问题（写进产物，逐条有明确立场）

1. **三个对照臂**：原 harness 基线 / 图编排 / 图编排＋长期演化——各自的最小可运行定义是什么？如何保证"同模型、同总预算"（不是同 token 而是同**成本与墙钟**约束）？
2. **分区**：train / dev / held-out / 终审怎么切？污染控制（同仓库、同题目来源、模型训练数据泄漏）怎么做？
3. **主指标**：任务完成率与代码质量分别怎么测、谁判？"唯一裁决入口"与 judge 的独立性怎么保证？
4. **统计方法**：样本量、区间方法（bootstrap/贝叶斯区间）、多重比较、最小有价值收益（MVE）阈值，以及**在结果产生前**如何冻结。
5. **预算会计**：planner/worker/reviewer/学习/评测全部调用如何计入；缓存 token、重试、隐式请求（title/summary、auto-compact）怎么算；缺 usage 怎么处理。
6. **停止规则**：何时判 `inconclusive`／负结果，而不是硬凑显著性。
7. **不可比情形**：某宿主缺能力时，如何记录为"能力缺失"而不是悄悄降级对照。

## 4. 交付物（全新 lane，无冲突）

```
docs/evofence-harness-kernel/spec/evaluation/PROTOCOL.md      冻结的实验协议正文（可被 L4 直接执行）
docs/evofence-harness-kernel/spec/evaluation/SCENARIOS.md     场景集与数据拆分定义
docs/evofence-harness-kernel/spec/evaluation/METRICS.md       主指标、测量方式、区间方法与 MVE 阈值
docs/evofence-harness-kernel/spec/evaluation/PREREGISTRATION.md  预注册表（结果出现前冻结的字段清单）
docs/evofence-harness-kernel/spec/evaluation/OPEN-QUESTIONS.md   本轮无法定案、需人审或需实测才能定的问题
```

## 5. 硬约束

1. **阈值与指标必须写死到可执行**：给出具体数字或明确的判定公式；不允许"视情况而定"。
2. 不假装已经跑过实验。协议是**预注册**文件，不是结果。
3. 与 Pi 探针已知的事实矛盾时以事实为准（例：Pi `high` 实际只发送 `thinking.type=enabled` + `reasoning_effort=high`，服务端是否真有独立档位**未证实**——协议必须能容忍这种"参数被接受但档位未证实"的情形）。
4. 引用外部方法（bootstrap、预注册、盲测）时写明适用前提与局限，不要堆名词。
5. 中文书写，术语首次出现给出英文原文。表格化能显著提升可读性。
6. 篇幅克制：能一页说清的不写三页；不复制设计文档原文。

## 6. 完成时回报格式（回给我，简洁）

```
cp1: <passed|failed> — <一句话证据>
cp2: ...
cp3: ...
交付文件: <路径列表 + 各自行数>
关键决策: <5-8 条，含你主动冻结的具体阈值>
未定案项: <列出 OPEN-QUESTIONS 里最关键 3 条>
阻塞: <无 / 具体描述>
```
