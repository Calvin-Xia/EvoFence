# l3_context_router 独立复核简报（review-1）

> 图：`evofence-harness-kernel` · 节点 `l3_context_router` · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。

## 0. 复核对象

- 集成提交 `1dcf506`（相对基线 `8bffca8`）：`src/learning/context/**`（9 文件）+ `test/l3-router-*.test.js`（4 文件 / 37 用例）。
- lane 作者工作区（仅 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-router`（branch `refactor/hk-l3-router`，基线与产物未提交）。
- 节点合同：plan 见 `graph get-node`（bounded context packet + 审计来源；区分 executor/fresh verifier/private evaluator）；DoD① 单节点 context 可追溯且有 token 上限、长任务压缩仍保留证据引用；DoD② 私有评分器/终审/候选验证反馈不泄露给学习/执行 agent；cp1 角色与可见性、cp2 packet/摘要/引用构建、cp3 窗口/隐私/过时核验。
- 生产简报：`docs/evofence-harness-kernel/execution/tasks/L3-context-router-brief.md`。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | **复用** `src/kernel/artifacts/**` 的受众判定（无第二套真相源） | 读 `src/learning/context/access.ts` 等：是否 import kernel artifacts 的 `withheldReason`/`partitionFeedback`/`isRestrictedPartition`（或其封装）；grep 是否自建平行表 |
| 2 | 决定性：同输入 packet 逐字节相同 | 自建探针两次调用比较（作者套件之外）；查有无 ambient 读取（Date/random/env） |
| 3 | token 上限真实：超限拒绝/裁剪，不静默丢证据 | 构造超限输入看结果；核 `window.ts` 语义 |
| 4 | 压缩保留**引用**（artifact id + digest + 可见性），非仅摘要 | 检查长正文压缩路径与 `EXAMPLE.json`；探针：压缩后仍能解析出引用清单 |
| 5 | DoD② 隐私：私有数据对 executor/learner 不可见；无影子通道（id/hash/文件名/日志） | 复刻作者负控 + 自建反例（held-out/final 引用、private-eval 内容）；确认拒绝回包不带私有身份 |
| 6 | fail-closed：未知角色/未声明可见性/越枚举值 | 探针传入非法枚举/未知角色，必须 typed 失败而非默认可见 |
| 7 | 门禁与边界 | lane/集成跑 `npm run build/typecheck/src:policy/dep:check`、`node --test test/l3-router-*.test.js`（两次）；`node verification/kernel/static-audit.mjs` exit 0、0 violations（core 未被污染） |
| 8 | 证据诚实 | `src/learning/context/EVIDENCE.md` 的未证明项（真实宿主接线、模型 tokenizer、长程收益、未标记正文 secret 检测）如实；负控证据非镜像测试 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l3_context_router-review.md`：

```
# l3_context_router 独立交叉复核（review-1）
日期 / 复核者（pane）：
复核对象（commit + 文件/行数 + 用例数）：
结论：可接受 / 需修订（blocker/major/minor/nit 计数）
逐条：上表 1-8 判定 + 实测证据（命令、输出摘要、用例名、sha256）
未证明项与保留意见：
收工一致性：git 状态（仅 dossier）、测试与审计数字
```

最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异/负控只允许在 `dist/` 或临时副本，复原用 `git cat-file blob`（CRLF 陷阱）。
- 只跑本次 build 的 `dist/`；测试两次；结论以实测为准。
