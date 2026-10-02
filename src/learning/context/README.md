# L3 context router

本 lane 的入口是 `index.ts`。它不扩展冻结协议，不提交 journal、不做任务裁决、不派发宿主；所有文件位于 learning 层。`ContextInputs` / `WindowBudget` / `ContextPacket` 是进程内调用与派生视图，不是另一份 `TaskContract`、`NodeSpec` 或授权记录。

## 调用合同

```ts
const router = createContextRouter({ digest, tokenizer });
const result = router.buildContextPacket(taskContract, nodeRole, {
  contractRef,       // 当前 GraphSpec.taskContractRef，不从 task 本身猜 version/digest
  binding,          // 当前 consumer attempt 的完整 Binding
  nodeInputRefs,    // 当前已提交 NodeSpec.inputRefs
  plan,             // 当前 NodeSpec.contextPlan
  artifacts,        // { ref, bytes, purpose, expectation }[]，显式 hydrated 工件交接
  at,               // 注入 Clock 读数，不在 router 内读取时间
}, {
  windowTokens, reservedOutputTokens, hostInputTokens,
  strategy: 'compact', excerptChars: 64,
});
// 成功时宿主只派发 result.value.serialized；失败时不派发部分 packet。
```

也可调用导出的 `buildContextPacket(task, role, inputs, window, ports)`。`digest` 必须是纯函数，合同身份使用现有 `kernel/store/identity.canonical`；`tokenizer` 为 `{ id, countTokens }`，须由宿主提供固定版本、纯确定性的真实计数器。构造 router 不调用任何 port。

`artifacts` 的 `purpose` 必须显式为 `evidence`、`handoff`、`human-instruction`、`host-instruction`、`candidate-feedback` 之一。没有聊天继承、未声明 summary、latest 查找或未声明输入入口。每个输入 ref 必须与 `ContextPlan.inputRefs` 完整相等，plan 中每个 ref 又须与 `NodeSpec.inputRefs` 完整相等；重复 ID、替换 digest/visibility/partition 都拒绝。允许有 node 输入未被 context plan 选入，但不允许 caller 为可见 planned 输入省略 bytes。

`expectation` 使用 L2 `ArtifactExpectation`，从已提交 data edge / producer attempt 取得。producer 和 consumer 可以是不同节点、不同 attempt；session、host session、graph 全三元组、epoch、baseDigest 必须是当前值。L2 `verifyForConsumer` 再核 producer 的确切 node/attempt/ordinal 与 schema 三元组。事先源可显式使用 `pre-source` + `binding: null`；已有 binding 的 ref 不允许使用 null expectation 旁路。resolver/WorkspacePort 在调用前取得 bytes；router 只使用现有 memory artifact store 作调用内的摘要验证缓冲，不读取 locator，不持久保存新事实。

## 角色与隐私

| context role | L2 audience | public/internal | private-eval（wire visibility=private） | held-out/final（任一轴） |
|---|---|---|---|---|
| executor | author | 可见 | withheld | withheld |
| fresh-verifier | author | 可见 | withheld | withheld |
| private-evaluator | evaluator | 可见 | 可见 | 可见 |
| learner | asset-staging | 可见 | withheld | withheld |

表中的结果由 `kernel/artifacts.withheldReason` / `partitionFeedback` 决定；本 lane 只维护 role→audience 别名，不维护 visibility rank 或 partition 许可表。`private-eval` 不是新增 wire enum。`fresh-verifier` 另要求 `ContextPlan.isolation=fresh`；这要求下游创建 fresh transcript，router 不执行创建。`candidate-feedback` 即使错误标成 public 也只对 private evaluator 路由；任务行为反馈若获准公开，应由 evaluator 独立产生带正确可见性/来源分区的新工件，不能把私有 candidate feedback 改一个 purpose 后回流。

私有输入只产生 L2 同款 withheld 计数，不产生 ID、locator、digest、producer、摘要或日志。hidden bytes 不进入 put/get/digest/tokenizer。`TaskContract` 内嵌的检查、批准、价格等 artifact refs 也经同一个判定投影；private 引用从数组移除/对象槽置 null。完整合同 hash 只作内部门禁，不放进 agent packet。可见引用输出为 `EvidenceLink`，保留 id/digest/visibility/partition/schema/binding/producer kind+ID/expiry，移除 locator 和嵌套 identityRef，避免身份凭据引用搭便车。可见嵌入引用到期也拒绝。

`packet.task` 是只读受众视图；不可把它当 executable TaskContract/Grant 交给 core。缺权限、身份校验、grant/lease/reservation 状态的核验仍属于既有 core 和调用方，router 不授予权限。learner 可见 dev 不代表 dev 获得资产来源资格；资产写入还须走 L2 asset consumer 的 train-only sourceTraces 门禁。

## 窗口与摘要

```text
packetLimit = min(
  TaskContract.budget.maxInputTokens - hostInputTokens,
  ContextPlan.maxTokens,
  windowTokens - reservedOutputTokens - hostInputTokens
)
```

`hostInputTokens` 必须包含全部保留的 native instructions/skills/tools 与消息封套开销；`reservedOutputTokens` 是这次实际请求的 output ceiling，正整数且不能超过 task 的 maxOutputTokens。没有 token 或预算默认值。计数覆盖完整 canonical `serialized`（task、正文、每个引用、audit、withheld 计数），成功须 `tokenCount <= packetLimit`。宿主不可另加未计数的聊天/metadata；拼接后 tokenization 的封套/边界差异由 hostInputTokens 的实测预留覆盖。

先试完整 packet。`reject` 超限直接 typed `EFK_BUDGET_EXHAUSTED`；`compact` 对 evidence/handoff 正文取显式 `excerptChars` 个 Unicode code points，然后按 64→32→…→0 这种确定序列缩短，每次重新计 token，不假设 tokenizer 单调。mode 为 full/excerpt/reference；0 时仍保留完整 EvidenceLink 和 audit。human/host instructions 始终全文保留；基础合同、引用或 instructions 仍放不下就拒绝，不删除引用换取成功。

这里的“摘要”是可见工件正文的确定性摘录，不调用模型，也不创造费用豁免。需要保留的每个证据必须作为独立 ArtifactRef 出现在当前 plan 中；藏在不透明正文里的 ID/URL 不会被猜成有效证据。长任务跨 revision 要显式提交新的 handoff 并声明相应证据，不能用旧 transcript 或摘要绕过绑定核验。

每个 admitted context 输入有一条 audit：`source=ContextPlan.inputRefs`、`reason=purpose`、完整安全 EvidenceLink。每个投影进合同的引用有 `source=TaskContract`、`reason=visible-contract-reference`。producer/node/attempt/graph/base 均留在 link 中，可沿当前声明取得原件。外层 `tokenCount/tokenLimit/tokenizerId/compressed` 为宿主审计 metadata；不额外派发给模型。

## 下游接线

- `l3_workspace_txn`：从当前 journal / graph snapshot 提供 contractRef、recipient binding、nodeInputRefs、contextPlan；在权限和实际路径核验后读取/验证工件，传入显式 bytes 和可信 producer expectation。packet 返回后还须核 grant/lease/fencing、实际 workspace base 和预算 reservation。重新恢复/修改图后重新构建，不复用旧 packet。
- `l3_task_evaluation`：独立复核使用 fresh-verifier 和 fresh transcript，私有评测只使用 private-evaluator。evaluator packet 不送入 executor/learner 的宿主日志或 asset staging；公开行为反馈须独立工件、独立声明。实际 DecisionRecord 仍使用完整可信 TaskContract 与绑定的 TaskEvidenceReport/receipt，不使用 packet.task 视图。privileged role 的授权由 evaluator orchestration 验证，调用 role 参数自身不是权限证明。
- 双宿主：保留原 instructions/skills/tools，提供确切 tokenizer、窗口和输入封套计数；只发送 serialized，不继承未计数父聊天。fresh 标记是必须执行的接线合同，不是“已经创建 child”的回执。

## 自证与边界

`test/l3-router-{packet,privacy,stale,negative}.test.js` 从本次 build 的 dist 导入。privacy matrix 运行 4×5×5=100 种 role/visibility/partition 组合；负控在单个 Node 子进程内用 ESM loader 变异 learning/context 的真实实现，要求 assertion 变红，再无 loader 重跑复绿，不改 source/dist/core 文件。

测试 tokenizer 为固定 `fixture:utf8-byte/v1`，每个 UTF-8 byte 就是一个 fixture token，精确计数而非 provider token 估价。它证明窗口算法接受/拒绝与 injected tokenizer 的一致性；本 lane 没有证明 Pi/DSH tokenizer、宿主 retained resources 计数、原生 fresh child 接线、真实长任务收益或任意未标记内容中的 secret 检测。可信输入由已提交声明提供，router 无法单凭字符串发现外部已经把私有源码伪装成 public evidence 的污染；它自身不会从 hidden 数据生成摘要或 hash/名称通道。

门禁与实测数字见 `EVIDENCE.md`（本地保留、未跟踪，见 `.gitignore`）。
