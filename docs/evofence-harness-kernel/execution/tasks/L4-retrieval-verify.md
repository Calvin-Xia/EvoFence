# l4_retrieval 独立复核简报（review-1）

> 图：`evofence-harness-kernel` · 节点 `l4_retrieval` · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。

## 0. 复核对象

- 集成提交：`8cef8ff`（相对基线 `d2e311d`）：`src/learning/retrieval/**`（含 `evidence/**`）+ `test/l4-retrieval-*.test.js`（5 文件 / 32 用例）。
- lane 作者工作区（仅 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-retrieval`。
- 节点合同：plan = 依据 task/node/host/model/repo metadata 选择已具资格且未撤销资产；**确定性筛选与预算排序**（无收益前不引入向量库/GraphRAG）；记录 retrieved/used/ignored 与 token 成本。DoD① 不注入 scope 不符/来源不明/失效/未验证经验；DoD② 无可用经验退回基础执行、检索开销纳入对照。cp1 资格筛选与排名、cp2 有限上下文与使用反馈、cp3 过时/空集/污染路径。
- 简报：`docs/evofence-harness-kernel/execution/tasks/L4-retrieval-brief.md`；管辖 ADR：`adr_0005`、`adr_0007`。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | 资格筛选**复用** `src/learning/assets` 的 qualification/状态/依赖传播（无第二套信任判定） | 读 import 与实现；grep 平行表 |
| 2 | 确定性：同输入 candidate 逐字节相同；排名稳定 + 显式 tie-breaker（revision 等） | 自建探针两次比较 + 乱序输入 |
| 3 | 预算裁剪：token/数量上限真实生效；开销可复算；tokenizer/计数器**注入**而非硬编码 | 读 `material.ts`/`retrieve.ts`；探针超限输入 |
| 4 | DoD①：scope 不符/来源不明/失效/未验证/撤销/held-out 污染全部 typed 拒绝、不进 candidate | 自建负控（逐类） |
| 5 | DoD②：空集 → 明确基础执行回退（不是错误、不是空注入）；开销记录在案 | 探针空候选集 + `evidence/empty-example.json` 对照 |
| 6 | cp2 归因：retrieved/used/ignored（含理由）可追溯到 asset/revision；与 `l3_context_router` packet 形态一致（无第二套 packet） | 读 `feedback.ts` + 与 router 类型对照 |
| 7 | 门禁与边界 | build/typecheck/src:policy/dep:check=0；`node --test test/l4-retrieval-*.test.js` 两次 32/32；`static-audit` exit 0、0 violations；只增不改（`git show --name-status 8cef8ff`） |
| 8 | 证据与负控 | `evidence/results.json`/`sourceHashes` 与实际一致；抽查 1-2 个变异 0→1→0；未证明项（真实收益、原生宿主激活、provider tokenizer/真实成本）如实 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l4_retrieval-review.md`，格式同前几份复验 dossier。
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异只在 `dist/` 或临时副本，复原用 `git cat-file blob`。
- 只跑本次 build 的 `dist/`；结论以实测为准。
