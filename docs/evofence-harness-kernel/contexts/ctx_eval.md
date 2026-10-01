# 任务验证与能力评价（ctx_eval）

分别判断普通任务完成、候选有效性、长期能力收益和退化；消费独立 evaluator 的证据与多指标合同。控制 held-out 数据和可反馈信息，输出唯一 DecisionRecord；不实施候选、不修改能力指针。

## 术语表

- **TaskVerdict**: 当前任务达到完成条件的判定；无需相对 baseline 提升。
- **EvaluationReceipt**: 绑定候选、评测协议、数据拆分、预算和原始证据的不可变评价凭据。
- **Uplift**: 资源匹配的未见任务收益估计及其不确定性；运行成功本身不是收益。

> 本文由 `graph export` 从 context 顶点 ctx_eval 生成（节点即文档，图是真相源）。
