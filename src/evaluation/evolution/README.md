# Evolution evaluator — l4-evo-eval

入口为 `createEvolutionEvaluator(registration, ports)`。此模块在 core 导入闭包之外；没有
`evaluateTask`、journal mutation、promotion decision 或 host activation。所有新增写入均在本目录
与 `test/l4-evo-eval-*.test.js`，未改冻结 schema、core、资产注册器或 `.graph`。

调用顺序：

1. `preregister(plan, at)` 保存不可变完整快照。输入必须显式指定 candidate revision/digest/
   dependencies/scope、base、协议与分析脚本工件、host manifest/version/model/payload、四路数据
   manifest、主/次指标、160 或预批准 165 的样本量、种子、试验次数、`all-required` 选择规则、
   停止规则与精确包络。返回 `RegisteredPlan.ref`；结果出现后禁止补注册、换指标或择优。
2. 宿主/应用的可信 journal 保存所有 run 与真实 request inventory，包括失败、取消、隐式请求。
   `evaluateCandidate(ref, at)` 委托同一个 `evaluateCapability` 路径读取全清单；调用者不能传子集。
3. 注入的独立盲验流水线接收随机顺序的 opaque 产物、实际 diff、合同、私有测试，逐必须分支
   保留 true/false/null；不接收 arm、host、作者身份或推理轨迹。成功指标来自实际检查。
4. 输出冻结的 `EvaluationReceipt` 与 `kind=candidate` 的 `DecisionRecord`，以及各自工件引用。
   下游先调用 `evaluationForPromotion(result, at)` 获取经过来源核验的完整回执，再由独立的
   promotion authority 验 grant/scope，并提交独立决策。这里不代替 promotion。

必要不变项：同任务各臂 base、host/version、model/thinking payload、采样参数、工具、权限及
资源上限相同；repo/family 不跨分区；确认集每 repo 一实例；held-out/final 不能进入 author /
report / asset-staging；仅 train 产生候选来源；样本、trial、seed 不重复；全量 ITT 不丢失败。
未匹配的 run 仍保留在分析中，不能形成确认性配对。放宽确认集 repo 重复的 DEFF 设计暂不
接受；不会静默使用 DEFF=1。

统计入口遵循 METRICS v3 §5.2 的有序函数：可比性 → 完整性 → look → n/discordance →
`Z_MVE`。MVE 为 B−A=0.15、C−B=0.10，c=1.960，确认 discordance≥25；10,000 次
分层 repo bootstrap 算 SE 与 BCa，repo jackknife 算加速度，ties 用 0.5 修正。BCa、精确
McNemar（Δ=0）及 score-null SE 只作报告/敏感性，不覆盖 Z_MVE。固定序列逐 host/trial/seed
执行；B−A 不 positive 则 C−B 不作确认性检验。futility 只停止或继续采样，永不报疗效。

收益资格须所有预注册判定 positive，且成本≤2×、p90 wall≤1.5×、截断率≤对照+0.10；
质量评分与其一致性是次指标，不覆盖主判定。缺预算、T0、样本或不确定测量不能形成资格；
usage 缺失保持 null 与 9,547 µUSD/request 的预留提示，完整 usage 才产生全额总量。
缓存 token 进入总量，reasoning 只为 output 子集；共享 requestId、未知来源伪称完整、矛盾
total 都拒绝。臂外 judge 用量单列，仍全额进入试验总额；全池 request cap 与成本也检查。

权限与证据边界：

- `authority.authorize` 必须由可信权限根核验绑定整个预注册的真实 T0/预算证据；仅字符串相同
  不是授权。`journal` 必须来自 owning application 的全量真相，特别是 `evidenceKind` 与 request
  inventory，不能由候选作者实现或用开发账冒充试验账。
- `authority.attest/verify` 提供签名或可核验的可信来源 sidecar；不在 wire receipt 添加 issuer 或
  signature 字段。issuer 绑定 `ArtifactRef.producer` 和 `DecisionRecord.issuer`。`publish` 的
  **无密钥 SHA-256 仅是字节完整性提示，不是签名，也不证明同用户攻击者无法篡改**。
  本 lane 的测试实现用独立测试 HMAC sidecar；生产 signer/root/journal 由集成方注入，不发现
  凭据、不附带默认信任实现。下游必须调用来源核验接口，不能只读一个裸 receipt/hash。
- 最早必需证据到期时间传播到 receipt/decision，过期资格不可消费。私有明细工件仅供 evaluator；
  应用的 author 反馈继续使用既有 artifacts 受众判定。

证据在 `evidence/`：门禁输出与数字、七个真实生产模块 loader mutation 的
green/red/restored 日志、真实离线 Node subprocess 的 private-check 输出。mutation 在子进程
加载阶段替换真实编译模块，不改磁盘源码/dist；每项核对目标只出现一次、断言变红、恢复后
复绿并核对文件未改。注册器消费测试直接传递本服务产生的真实 receipt/decision，再执行
上游 `recordDecision` 的 validated → promoted 路径；没有在此实现新 promotion 服务。

证据等级：confirmatory 分支测试是**模拟 T0/provider/journal 的 contract fixture**；其中的
positive 不代表真实收益。`offline.json` 是真实代码与真实独立进程检查，但只有六个 dev
实例，零付费请求，结果 inconclusive、禁止收益声明。真实未见试验、真实预算/T0签署、
真实宿主/provider结算、生产 signer 与 l4_promotion 应用接线由后续 lane 验证；本 lane
不声称这些已成立。PP/消融/人工终审整包分析属于 capability trial，不由本服务代签。
