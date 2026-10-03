# L4 revocation

本 lane 的退化检测和恢复协调模块。只增加 src/evaluation/revocation/** 与 test/l4-revocation*.test.js；沿用现有 registry、promotion、HostPort 和 EventStore 合同，不改冻结 DTO、已通过模块或 .graph。

## 接入与行为

`createRevocationService(ports)` 构造时零 I/O。调用方提供已初始化的 PromotionPorts、可信 QualityPolicy、完整 signalInventory、精确来源 verifySignal 和运行时签发的 restoreEffect。模块不发现 SDK、凭据或安装版本，不创建 store，不启动 timer，也不调用模型。

- `monitor(input)`：使用注入 Clock 的当前时间，比较 scope/repo/base/task、model/reasoning/payload、host/version/manifest、registry 资格有效期和质量门槛。返回 null 表示本次未失效；失效则提交 RevocationRecord。相同 requestId/内容稳定重放，换内容拒绝。
- `QualitySignal` 是本地监测工件，不是新的 CapabilityJudgement。value < minimum 即退化；年龄 >= maxAgeMs 即过期。requireQuality=true 时缺少指标也停止使用。最新观测决定指标，同一最新时点任何低值都不能被排列或遗漏隐藏。minimums 和有效期由可信 policy 提供。
- 信号只接受 dev 或 online（partition=not-evaluation）。先对全部输入拒绝隐藏分区/可见性，再核注册 monitor 主体、元数据来源及完整库存，最后读字节。source/context/asset/时间精确绑定；未知字段拒绝。held-out/final 不能改标签回流，来源侧证明必须绑定元数据和内容。
- 撤销通过精确 revision 的依赖 DAG 传播，显式撤销全部派生版本，包括 staged 候选。immutable candidate 原件保持原始 staged 内容；实际资格来自 append-only registry 的 revoked 事件，不再有可用的 staged 晋升。每个撤销事件绑定保留的 RevocationEvidence。
- 未派发晋升在同一个 journal CAS 中终止：PromotionState、RevocationRecord 与 kernel 的 not-executed Receipt 同事务提交。原 intention 留作证据，outbox 变为 resolved，nextEffects 不再返回它。无假 hostInvocationId 或 ActivationReceipt。
- 已派发晋升先检查当前 host.cancel 权限，再持久保存 requested 意图并调用 HostPort.cancel。取消回执保留；此前是否已激活须经真实效果核实。重启对 requested/observed 只 reconcile，不重复 cancel 或 activate。unknown 保持 pending；resolved 通过原 promotion receipt 校验/归约，已应用但失效的结果保留为 applied-unqualified 后补偿。not-executed 保留真实 ReconcileOutcome，并原子终止晋升。
- 回退目标是此 pointer/session/scope 中有真实 active 回执和 activationDecisionRef、且撤销后仍 eligible 的已验证快照。选择可以跳过立即前一个失效版本。恢复经过原 promotion.rollback/activate 的授权、safe point、lease/outbox/receipt 检查；最终实际快照必须逐字段等于记录的目标。若同资产的目标快照已真实 active 且仍合格，不重复操作宿主。
- `recover(requestId)` 返回持久记录：业务拒绝、未知效果、无合格目标或回退失败保留 pending/error；存储/CAS 错误返回 StoreErr。未知效果不重做。失败效果不会用同 ID 重发；必要时用新的明确 requestId 建立新的授权补偿计划，旧失败记录仍保留。
- `ordinaryView(context)` 复用唯一 promotion.activatedVersions 资格视图；学习不可用时返回空 versions 和仅含安全摘要的错误。`runOrdinary(context, task)` 调用已有的普通任务路径，独立于学习队列。该回调仍由 owning runtime 授权和执行；本 lane 没有接管普通任务调度。私有错误消息/引用不会被复制到普通任务反馈。

唯一状态真相是现有 promotion session journal；本地 RevocationRecord/RevocationEvidence/ReconcileOutcome 是不可变工件，使用现有 asset.transition/receipt.applied 事件，不新增 wire enum。跨实例的恢复比较已有 record 并以 journal CAS fencing；同一 service 的学习操作串行，普通任务不等待学习队列。撤销不清除预算预留、不声明取消等于供应商免费。

## 拒绝矩阵与证据

| 条件 | 结果与探针 |
|---|---|
| host/version/manifest、model/reasoning/payload、scope/repo/base/task 改变 | DoD1 十项矩阵；旧上下文再查也不可使用 |
| candidate/evaluation/依赖到期、质量下降/缺失/过期 | 立即 registry 撤销；ordinary 版本为空；阈值相等正例仍可用 |
| 来源不符、替换资产/上下文、未来信号、未知字段、signal 子集 | 明确 typed refusal，未产生撤销状态 |
| 撤销权不足、初次 CAS 失败 | 无部分传播/宿主调用 |
| staged 派生、多跳依赖、promoted/未派发 pending | 全部停止晋升；不可派发；原字节及历史保留 |
| 已派发 pending、取消失败/unknown/矛盾回执 | 取消意图/原结果保留；按真实效果核实；不盲重发 |
| 无已验证目标、目标随后失效、回退失败 | pending/error；保持实际 pointer/snapshot，普通任务仍运行 |
| 取消权撤销/过期/缺 host.cancel | 不派发取消；普通任务仍运行 |
| 学习存储故障、队列卡在取消、实现异常 | 普通任务回调继续；异常向调用方传播，不吞错 |
| 重启、receipt 已保存但最终 CAS 失败、并发恢复 | journal 恢复并一次应用，不重复实际激活 |
| 已撤销 root/derivative 再调用 retrieveContext | 返回 base/no-eligible-assets，materialReads=0 |
| hidden 分区、hidden visibility、改标签、混合输入 | 来源校验/隐藏字节读取之前拒绝；普通反馈无私有明细 |

DoD2 主例：依次实际模拟激活 revision 1、2、3，3 依赖 2，staged 4 依赖 3，未完成晋升 5 依赖 2。撤销 2 得到 affected=[2,3,4,5]，取消 5，目标为 revision 1 的已确认 newSnapshot，跳过 revision 2。恢复保留三个原快照、所有 revision、原 registry history 前缀以及质量信号引用。

## 源码变异负控（2026-10-02）

显式运行下列函数才写本 lane 的源文件。正常 node --test 发现此 helper 时不执行变异。每轮 baseline 绿、实际改源码、本次 tsc 构建、目标 assertion 红、finally 恢复原 Buffer、Buffer.equals 和 SHA-256 一致、重建后复绿。

```powershell
node --input-type=module -e "import { runNegativeControls } from './test/l4-revocation-negative-controls.test.js'; console.log(JSON.stringify(runNegativeControls(), null, 2));"
```

| # | 义务 | 实际变异文件 | 失败探针 | baseline/build/red/restored exit |
|---|---|---|---|---|
| 1 | DoD1 | conditions.ts | DoD1 host version | 0/0/1/0 |
| 2 | DoD1 | conditions.ts | cp1 quality threshold stops use | 0/0/1/0 |
| 3 | DoD2 | conditions.ts | DoD2 propagates through staged derivatives | 0/0/1/0 |
| 4 | DoD2 | plan.ts | DoD2 propagates through staged derivatives | 0/0/1/0 |
| 5 | feedback | signals.ts | feedback boundary rejects final before signal reads | 0/0/1/0 |

变异分别禁用 host 失效、禁用质量阈值、截断依赖传播、绕过回退目标资格、允许 final 分区。五轮 exit 全为 0/0/1/0；复原摘要：

- `conditions.ts`: `a698aa2e7523bc4aebff2dd997d5cd5fbd14d52eb4046606b1ed7a9a11e6f294`
- `plan.ts`: `2a30d085bacbd53c574a1e68e8672b33ced06042ed1fb14f7f7fcb06fa33174f`
- `signals.ts`: `c09c3668dfc2778ba1a6f216e74899603f17843fd94561ff39cb9bf4a63beded`

## 门禁与证据等级

最终门禁：npm run build/typecheck/src:policy/dep:check 各 exit 0；node --test test/l4-revocation*.test.js 两次各 65/65、fail=0、skip=0（63 个行为 test + 2 个 helper 文件发现）。node verification/kernel/static-audit.mjs exit 0、violations=[]。该静态审计只覆盖 protocol/kernel/runtime；本 lane 相对 import/注入能力/无 ambient I/O 另经源码检查与构造 port-spy 验证，不宣称整个 evaluation 目录已被该审计覆盖。

以上为离线协议实现与 memory journal/HostPort fixture 故障证据，测试执行真实 dist 的 registry/promotion/retrieval/revocation 入口。质量数值和宿主 activation/cancel/普通 tool 回执是明确的 fixture；不是原生 DSH/Pi、线上质量或供应商取消/费用证据。真实模型/原生宿主请求 0；usage 不适用；没有新增 provider 花费。

未证明：全量 npm test/test:e2e、真实宿主任务的应用接线和故障恢复、磁盘崩溃 durability、生产监控库存/来源证明实现、真实收益、供应商取消和 billing、OS sandbox。无已验证目标/失败回退是明确 pending 业务状态，不会升级为成功。源码与测试未 commit；未 install；未操作 .graph；无冻结合同 drift。
