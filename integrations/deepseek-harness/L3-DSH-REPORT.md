# L3 DSH lane 交付报告

lane: `l3-dsh`；分支：`refactor/hk-l3-dsh`。本报告记录 lane 自证，节点图裁决由 orchestrator 完成。

## Checkpoints 与 DoD

| 项 | 结论 | 直接证据 |
| --- | --- | --- |
| cp1 | passed：原生 session 创建、继续、恢复与 kernel session 同 id；恢复不重放模型请求 | `test/l3-dsh-session.test.js` 的 `DoD1: same native session continues and resumes`；真实 Cordis/AgentLoop/native resume + memory persistence |
| cp2 | passed：沿用原生 model/tools/instructions，附加已授权 ArtifactRef context；调用去重和缺 usage 保留；原生 board owner 必须对应 kernel claim | 同文件 context、usage、tool、caller、A15 两个 board 用例；`src/hosts/dsh/{mapping,port,binding,controls}.ts` |
| cp3 | passed：钩子移除/抛错、真实插件卸载、runtime 错误和 pause-store 错误均停止后续 evolution；普通原生工作继续；unknown 不重放 | 同文件 DoD2、removed-hook、uninstall、runtime-error、pause-error、unknown-reopen 用例；两组真实源码变异见 [negative-controls.json](evidence/negative-controls.json) |
| DoD③ | passed：用户决定 A 已落地；两处精确版本声明从 `0.1.7-rc.1` 升为 `0.2.0-rc.2` | [package.json](package.json)、[version-decision.json](evidence/version-decision.json) |

原生工具：`evofence_status/continue/pause/resume/reconcile/evaluate`。`continue` 先返回当前 ToolRuntime 调用，再等同一个 agent idle 后排一次 runtime step，模型主动调用该工具也不会等待自身而死锁。`evaluate` 仅进入已有独立 TaskEvaluator；native completion 只到 verifying，不直接使任务通过。本 lane 没有新增 promotion 路径。

恢复沿用完全相同的显式 seed 与 ports，通过 runtime.open 重建同一 journal；epoch/re-admission 交给既有 runtime。冻结 HostPort 的 `binding.hostSessionId=null` 原样保留，绑定层用 kernel/native sessionId 和 exact live agent identity 关联，没有改 receipt binding 或 core 合同。

## 版本敏感项重验

重新执行原来的 `scripts/probes/dsh-native-probe.mjs`，只把 writer 重定向到本 lane 的 [native-revalidation](evidence/native-revalidation/)。原脚本、support 和原探针产物保持不变；[provenance.json](evidence/native-revalidation/provenance.json) 记录原文件哈希与三处机械重定向。原生探针 39 项检查中 38 项 true、1 项 false，errors 为空；false 为 `teamMessageDurable`，没有把 queued 当 delivered。

下表 JSON Pointer 均指本 lane 的 `evidence/native-revalidation/offline-trace.json`；结论仅为指定 native-fixture 检查，不外推 provider、磁盘或当前用户 GUI。

| 索引 | 重验结论 | JSON Pointer / 范围 |
| --- | --- | --- |
| D1 | verified-scoped | `/checks/nativeSessionCreated`、`/checks/sameSessionPreserved` |
| D2 | verified-scoped | `/checks/additiveNodeContext`、`/checks/hostToolPreserved` |
| D3 | verified-scoped | `/checks/toolGateAndResults`；request gate 不证明 OS 隔离 |
| D4 | verified-scoped | `/checks/deniedAndFailedResultsObserved`、`/checks/toolCallerIdentity`、`/toolResults` |
| D5 | verified-scoped | `/checks/usagePreserved`、`/checks/failureUsageNotZeroInvented`、`/receipts`；synthetic usage |
| D6 | verified-scoped | `/checks/cancelSignalsAndIdle`；仅 native stream/loop |
| D7 | verified-scoped | `/checks/nativeResumeWithMemoryPersistence`、`/checks/restoreWithoutModelReplay`；非磁盘 |
| D8 | verified-scoped | `/checks/freshChildContextIsolation`；原生探针 child 分离，非本 lane 的 host.delegate 实现 |
| D9 | verified-scoped | `/checks/projectionGapRejected`、`/checks/projectionCheckpointRestore`、`/checks/projectionVersionTailRejected` |
| D17 | verified-scoped | `/checks/providerFailureIdle`、`/checks/asyncCreatedBeforeReturn`；不涵盖任意 detached 插件 |
| DV | 固定版本 | `VERSION-PIN.json /observedVersion = 0.2.0-rc.2` |
| D16 | 声明缺口已闭合，整体兼容仍 unknown | 新入口已在 native fixture 内真实加载；没有安装新 Profile/验证发行包 |

原 probe support 把 `integrationGap.compatibleWithDeclaredExactVersions` **写死为 false**，manifest 文案也写死为旧版本不匹配。重跑输出保留原始字段，不把它当新的兼容结论。[version-decision.json](evidence/version-decision.json) 对当前 manifest 与实际版本作了新鲜的精确相等检查，仅覆盖静态声明缺口。`existingIntegrationCompatibility` 仍 unknown；不会据此声称原来的安装/市场证据适用于新入口。

## 13 项 unknown 与 partial

新探针保持 15 项 scoped verified、1 项 partial、13 项 unknown。13 项完整保留如下：

| 索引 | 能力 | 本 lane 结论 |
| --- | --- | --- |
| D10 | teamMessageDelivery | unknown：durable delivery 检查 false；只确认 enqueue |
| D13 | grantWriteScopeEnforcement | unknown：advisory writeScopes 不能证明文件写入强制约束 |
| D14 | reasoningHighGuarantee | unknown：fixture high 参数不是服务端 high 保证 |
| D15 | osSandbox | unknown：未测试 OS sandbox |
| D16 | existingIntegrationCompatibility | unknown：仅声明相等与 checkout 原生 fixture 入口已验证 |
| D18 | parentChildCancellation | unknown：父子取消级联未验 |
| D19 | diskCrashRecovery | unknown：memory reopen 不能证明真实磁盘/crash 恢复 |
| D20 | externalEffectReconciliation | unknown：已知内存回执可读；未知外部副作用不猜测、不重做 |
| D21 | costInvoice | unknown：没有真实供应商 USD / invoice |
| D22 | sessionCustomEntries | unknown：未验证 Pi custom-entry 对应语义 |
| D24 | skillsPluginCoexistence | unknown：未验用户 GUI/Profile/任意第三方插件与 Skills |
| D26 | toolCancellation | unknown：未验长运行原生工具取消 |
| D27 | providerCancelBilling | unknown：未验供应商取消与计费 |

D23 `teamWaitAndInterrupt` 仍 partial，仅 wait signal cancellation 与 inactive-member interrupt 子集。D11/D12/D25 原生同进程身份、board restore、stale task revision 检查重验 true，均不冒充 kernel grant/跨进程 CAS。A15 新 binding 使用实际 native team board 和实际 kernel scheduler claim 两个行为用例证明 owner 投影约束；不会创建 board claim 或改变 scheduler owner。

## Negative controls 与门禁

| DoD | 真实变异点 | 锁定用例 | 要求与记录 |
| --- | --- | --- | --- |
| ① | `binding.ts` resume 分支向 runtime.open 注入 `sessionId: 'mutated-resume'` | `DoD1: same native session continues and resumes` | baseline 0 → mutation 1 → restore 0；恢复 SHA-256 等于原文件 |
| ② | `health.ts` 把 active journal 的 pause 条件反转，阻断故障暂停 | `DoD2: observation hook failure durably pauses` | baseline 0 → mutation 1 → restore 0；恢复 SHA-256 等于原文件 |

变异脚本每个阶段重新编译，不用旧 dist。最终门禁由 [gates.json](evidence/gates.json) 记录 command、exitCode、stdout/stderr、源码哈希和变异记录哈希一致性：

- `npm run build/typecheck/src:policy/dep:check` 各 exit 0。
- `node --test test/l3-dsh-*.test.js` 连续两次 22/22、fail 0、skipped 0。这里为 **21 个行为用例 + 1 个无注册测试的 fixture 文件**，不把 fixture 文件计为第 22 个行为验证。
- `node verification/kernel/static-audit.mjs` exit 0，0 violations；全量闭包清单保存在 [static-audit.json](evidence/static-audit.json)。
- `git diff --check` exit 0；所有 tracked/untracked 变更均在授权目录内。

## 证据分级、账目与边界

真实宿主证据级别：**native-fixture + fault-injection**。真实 Cordis、AgentLoop、ToolRuntime、session projections、team board 和 native create/resume 被执行；LLM adapter 与 native persistence 为内存 fixture。独立 evaluator/政策/存储由既有 L2 fixture ports 注入，并不是生产私有任务评价部署证据。

provider-live：**not-run**；付费调用 **0**，本 lane 外部模型花费 **0 USD**（因为未发请求；不由缺失 usage 推成零）。原生重验探针包含 6 次 synthetic 模型调用，四份 complete token usage 和两份 unknown attempt；测试中的合成请求不计入付费账目。不修改共享 MODEL-BUDGET.json，也没有能力收益/供应商语义/账单结论。

调用使用 `sessionId + settlement seq` 派生稳定 invocation id，按 invocation 去重、冲突拒绝。native token input 为 uncached；cacheRead/cacheWrite/output 分离，reasoning 是 output 子集；缺计数为 null。没有 USD 价格的回执不会消除 runtime reservation。一个已预留模型 effect 只允许一个 pre-step；第二个隐式 loop step 在请求前拒绝。SDK/provider 内部重试不受此 pre-step 数量证明，若观察到多次 invocation 则保留未知、暂停且不挤进一个 reservation；付费重试上界仍需后继 provider 验证。

实现支持 host.agent、host.tool 和绑定中正在运行的 native-loop cancel。host.delegate、host.activate、fresh child context、外部 effect reconcile/timer execution 未在此 lane 实现，显式 unsupported；原生探针验证 child 能力不等于 delegation lane 已完成。board 链接覆盖绑定会话自身投影；跨成员映射待显式 delegation 实现。

hook/卸载/异常会留下可见 fault；若真实 store 异常阻止 durable pause，status 显示 pauseError，本地继续拒绝，重启仍需 re-admission/reconcile。插件在既有 live agent 上重装不承诺自动恢复后续 epoch；验证的恢复入口为 native resume + 显式 manifest re-admission。

## integrations 独立 diff 说明与交接

- `package.json`：description 改为 native checkout composition；`engines.dsh` 与 tools peer 两处精确升级。包版本、Node 声明、现有 `evofence@0.5.0` dependency 和 private 状态保留。
- `index.js`：原 read-only SQLite ledger 工具入口改为 native binding，显式注入 runtime composition；不启子 CLI、不查凭据。
- `README.md`：改为新入口 composition、六个原生操作、usage/恢复边界与证据说明；旧 0.1.7 安装结论归为历史。
- `cordis.patch.yml`：无 diff，既有 bundle/row 标识保留。
- 新增本报告及 scoped evidence/复跑脚本。没有修改原 probe、spec、graph 导出或共享 execution 文档。

阻塞：本 lane 合同与指定门禁无阻塞；HostPort drift 无。所有产物留在本 lane，**未 commit、未 install、未操作 .graph、未写集成 worktree**。下一步由 orchestrator 审核源码/证据并合入，图状态与独立 verdict 不由 lane 代签；发行包 composition/exports 留给后继 packaging lane。
