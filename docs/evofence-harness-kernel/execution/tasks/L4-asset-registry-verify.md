# l4_asset_registry 独立复核简报（review-1）

> 图：`evofence-harness-kernel` · 节点 `l4_asset_registry`（L4 波次 1） · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。

## 0. 复核对象

- 集成提交：orchestrator 派单时给出（lane `refactor/hk-l4-assets` 并入后的 commit；基线 `6728aae`）。
- 交付面：`src/learning/assets/**`（含 `evidence/**` 原始日志）+ `test/l4-assets-*.test.js`（3 文件 / 29 用例）。
- lane 作者工作区（仅 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-assets`。
- 节点合同：plan = graph-template/strategy/experience/skill/tool/code-patch 的不可变 asset revision、适用范围/来源/依赖与 `staged/validated/promoted/active/revoked` 状态；**既有用户 Skills 只读**、新候选在项目授权区。DoD① 版本/来源/宿主-模型-仓库兼容条件可验证；DoD② `validated ≠ activated`；过期/撤销**依赖传播**、**不抹除历史**。cp1 identity 与状态、cp2 scope/dependency compatibility、cp3 失效与权限边界。
- 简报：`docs/evofence-harness-kernel/execution/tasks/L4-asset-registry-brief.md`；管辖 ADR：`adr_0005`、`adr_0007`。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | 不可变 revision：identity（assetId+revision+digest+kind+provenance）不可变；历史 append-only（revoked/替换不删旧 revision） | 读源码 + 探针构造重复/覆盖尝试 |
| 2 | 状态机：合法转换通过、非法转换 typed 拒绝；`validated ≠ activated`（未显式晋升不得 active/可用） | 自建非法转换探针 + 复刻用例 |
| 3 | DoD①：兼容条件（host/model/repo/task scope）可验证、确定性 `qualification` 查询（同输入逐字相同） | 探针两次比较 + 条件不匹配用例 |
| 4 | DoD②：撤销/过期沿**依赖传播**（dependents 失效/unknown），历史保留；依赖环/缺失依赖处理明确 | 自建传播探针 + 构造依赖图 |
| 5 | 权限边界：既有用户 Skills **只读**；候选写入限项目授权区（越界 typed 拒绝）；不自动修改全局 Skills | grep + 探针（越界路径） |
| 6 | 复用而非重造：内容身份/digest 语义与 kernel/artifacts（S01/S22 口径）一致，无第二套 digest 真相源 | 读 import + grep `crypto`/自算 digest |
| 7 | core 未被污染：`static-audit` exit 0、0 violations；learning 层不外溢宿主 I/O 到 core | 重跑审计 + 读依赖方向 |
| 8 | 门禁 | build/typecheck/src:policy/dep:check=0；`node --test test/l4-assets-*.test.js` 两次 29/29；证据文件与报告一致 |
| 9 | 负控 | 至少抽查 1-2 个变异（现有 5 个：validated 自动激活、撤销不传播、越界写、抹历史等）0→1→0 可复现；未证明项（生产 journal/CAS 接线、真实宿主激活、真实 Skills 采样、能力收益）如实 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l4_asset_registry-review.md`，格式同前几份复验 dossier（对象/结论/逐条证据/未证明项/收工一致性）。
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异只在 `dist/` 或临时副本，复原用 `git cat-file blob`。
- 只跑本次 build 的 `dist/`；结论以实测为准。
