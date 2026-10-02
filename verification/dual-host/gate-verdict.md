# 阶段裁决与限制报告 — `l3_dual_host_gate`

## 1. 裁决

**cp3 阶段裁决：通过（双宿主准入成立，仅证明"可用"）。**

- 本裁决只回答 gate plan 的问题："两宿主是否都能在真实仓库任务上跑通实用闭环，且 HostPort 语义与能力声明自洽"。答案是**能**。
- 本裁决**不**声明任何能力收益、晋升或激活（`adr_0005`、`adr_0008`）。"能用"与"有效益"是两件事，本包只支持前者。

## 2. 逐条理由

| 判据 | 结论 | 依据 |
|---|---|---|
| **cp1 合同比较** | 通过 | 两宿主引用同一份 FROZEN v1（内容 `9c6c5680…`，LF 口径说明见 `README.md` §3）；九阶段语义按同一合同覆盖；差异仅在宿主原生机制/适配层。矩阵：`admission-matrix.md` |
| **cp2 真实任务与恢复证据复核** | 通过 | provider-live + 真实并行（58,489 / 49,627 ms）+ 唯一 writer + 同会话恢复（前缀哈希复算一致）+ 独立 verify + 负控红→绿 + finish 两轮聚焦与四门禁 0；本包 26/26 独立复算 + 本地 0 付费复跑。详见 `truthfulness-check.md`、`evidence/independent-checks.json` |
| **HostPort conformance** | 通过（含 7 条已解释差异） | `hostport-conformance.md`：签名/错误契约/门禁/usage 归约一致；无"实现偷偷放宽声明"或"声明做不到的事" |
| **DoD①** | 满足 | 两宿主**均**通过合同与实际任务闭环（各自 5 文件真实产物 + 测试 + 门禁 + 恢复） |
| **DoD②** | 不触发 | 不存在仅能读 ledger 的宿主；两宿主都有真实写入/loop/并行/恢复/独立验证。详见 `dod2-determination.md` |
| **plan"修复或列出阻塞"** | 无阻塞 | 两 lane 的 `blocker: null`；本包复核未发现需修复的阻塞。非阻塞观察见 §3.3 |

## 3. 限制报告（强制项）

### 3.1 两宿主的证据不对称（必须显式列出）

1. **场景↔生产接线不对称**：Pi 场景直接用生产 `src/hosts/pi`（`bindPiSession`/`bindPiChildExecutor`/`bindPiSharedRequests`/`bindPiDelegation`）；DSH 场景用**适配器** `scenarios/dsh/host.mjs`，生产 `createDshHost`/`createDshDelegationBinding` 本轮未跑多请求 E2E。→ DSH 的生产 HostPort 只有静态 conformance，没有 E2E 覆盖。
2. **证据等级不对称**：Pi 多项探针为 provider-live / native-disk（如 `hostToolsAndSkillPreserved`、`diskRestore`）；DSH 多项为 native-fixture（如 `additiveNodeContext`、`teamBoardRestored`）。本包不把 native-fixture 升级为 provider-live。
3. **基线不一致**：Pi `5ec65f1`、DSH `b574b1c`（合同允许派单指定 commit，两 lane 都已声明）。→ 两宿主的请求数/费用/耗时不具可比性。
4. **失败路径形态不同**：Pi 有 attempt-1 的 4 类失败（动态边缺 relation、等待唤醒 stall、artifact restore 不支持 `node.transition`、过小传输界）与 30 条已计费请求；DSH 有首会话外传审批拒绝（0 请求）、原生流 usage 旁路失效、后台 child-settled 通知阻断、角色登记缺失。两者都保留原样，但不能据此互相推断宿主行为。
5. **聚焦测试形态不同**：Pi 7 例纯 CLI 子进程；DSH 4 例 CLI 子进程 + 真实 SQLite。覆盖点不同，不能简单比"用例数"。
6. **修复红来源不同**：Pi 的 fresh-verify red 是 driver **注入**的 negative control（合同 §2 允许"由注入或自然产生"）；DSH 的 red 同时包含注入变异与测试作者自身的断言语法缺陷（后者被单独修复，未降低行为验收）。两者都**不是**自然产生的实现缺陷被修复。
7. **裁决者与工作板**：DSH 有原生 task board（仅投影，`verifyBoardAuthority`）；Pi 无原生板。两者的 verdict 都由内核产生，无第二裁决者。

### 3.2 各自 unknown / 未证明（逐条，不夸大）

- **两宿主共同**：供应商取消计费；真实账单/发票（参考成本是本机固定 tariff 推算，`invoiceUsd:null`）；服务端是否存在独立于 `thinking` 的 high 档位保证；OS sandbox（工具权限有界 ≠ OS 沙箱）；process-kill / disk-crash 恢复（本轮都是"显式 cancel + 同 id 磁盘 reopen/abort"）；配对 held-out **能力收益**（`adr_0008` 禁止本轮声明）；`reasoningHighGuarantee`（Pi partial、DSH unknown）。
- **DSH 专属**：生产 `createDshBinding`/`createDshDelegationBinding` 在本多请求工具闭环中的 E2E；修复后整套驱动从零的单命令 paid 重跑；`teamMessageDelivery`、`parentChildCancellation`、`toolCancellation`、`diskCrashRecovery`、`externalEffectReconciliation`、`grantWriteScopeEnforcement`、`skillsPluginCoexistence`、`existingIntegrationCompatibility`、`sessionCustomEntries` 等探针 unknown。
- **Pi 专属**：服务端 high 档位语义；`externalEffectReconciliation` absent（依赖内核 journal/outbox）；`nativeTeamGraphBoard` absent；0.99.2 下 `sdkChildSessionIsolation` 被 session lane 收窄为 unknown（儿童隔离只在独立 delegation lane 假设）。
- **共享未知（账目）**：Codex 订阅执行者的逐请求 token/费用遥测两 lane 都记为 unknown（**不按 $0 声称免费**）。

### 3.3 可复现性限制

1. **行尾与哈希口径**：本机 `core.autocrlf=true`。合同与产物在 git 里是 LF，磁盘工作区可能是 CRLF；裸字节 sha256 会差。复现时必须先声明口径（LF 归一），否则会得到不同的 sha256。
2. **脱敏提交改变 HEAD**：`ccb4536..HEAD` 之间的 `503eafa`（脱敏本机绝对路径）改了 11 个 tracked 文件；它**没有**改 `scenarios/TASK-CONTRACT.md`（diff 为空）。若复盘发现 HEAD 不是复核 dossier 记录的 `7dafba2`/`ccb4536`，那是这条外部提交，不是合同或场景被改写。
3. **证据是本地 gitignored 目录**：两 lane 的 `evidence/`、`runtime/`、`MODEL-BUDGET.json` 不进 git。复核者需要本地那两个 worktree（`l3-pi-scenario` / `l3-dsh-scenario`）与两个 scratch（`scenario-pi-scratch` / `scenario-dsh-scratch`）才能重建；仅有仓库无法复算。
4. **DSH 审计的 cwd 要求**：`scenarios/dsh/audit.mjs --evidence-only` 必须从 **lane worktree** 运行（`io.mjs` 以脚本位置推断 lane）；从集成 worktree 跑会因 lane-ownership 断言失败。这是机制而非缺陷，但会使"集成点 dirty 则 cp3 failed"。
5. **前缀哈希序列化口径**：DSH 的 `interruption.beforeHash` 是对**事件对象 `JSON.stringify`**，不是原始 JSONL 行字节；Pi 的 `beforeReopenSha256` 是对**文件字节前缀**。两者语义都对，但口径不同，复现要照各自口径。
6. **非阻塞证据呈现 minor**（建议后续整理，不影响裁决）：Pi `result.json.settledRequests=78` 是主闭环快照的 stale 字段（权威账 84 全 settled）；DSH `shared-file-conflict.json` 未内嵌双方 proposal hash（只在 trace 里）、`audit.json.sourceHostDiff` 是硬编码 0、`dsh-http-2/4` 缺 `usageBasis` 标签；Pi `capabilities.ts` 注释写 15 键但常量 14 键。
7. **本包的复跑边界**：本包只复跑了两份聚焦测试与门禁判定依据，**未**重跑 provider-live 场景、**未**抓包、**未**联网核价。0 付费是硬约束。

### 3.4 "本轮不声明收益"的说明（`adr_0008`）

- 本轮**没有**冻结 A/B/C 配对试验、**没有** held-out 分区、**没有**预注册主指标/阈值、**没有**同模型版本与同总资源的对照。因此本轮**不可能**支持任何"Pi 比 DSH 好/差"、"委派比非委派省钱/更快"的因果结论。
- 两宿主的请求数（84 vs 75）、tokens（2,047,716 vs 1,684,159）、参考成本（$0.240 vs $0.146）差异来自：不同基线 commit、不同失败/续跑路径、不同角色构成。**不得**用作效率或能力证据。
- 收益实验需要另冻结匹配基线与资源、预注册指标与停止规则，并经人审。本轮结论的适用范围严格限定为：**双宿主准入（可用性）成立**。

## 4. 结论摘要（供回报）

```
gate: l3_dual_host_gate
cp1 合同比较: 通过 — verification/dual-host/admission-matrix.md（五维 + 每维两宿主锚点 + 9 条显式差异）
cp2 真实任务与恢复证据复核: 通过 — 26/26 独立复算 + 本地 0 付费复跑（Pi 7/7、DSH 4/4）
cp3 阶段裁决与限制: 通过 — 理由见 §2；限制报告 verification/dual-host/gate-verdict.md
DoD①: 两宿主均通过合同与实际任务闭环 — 证据 truthfulness-check.md
DoD②: 不存在仅能读 ledger 的宿主 — 判定不触发否决；dod2-determination.md
差异清单: 见 admission-matrix.md §6（9 条）与 hostport-conformance.md §4（7 条）
unknown/未证明: 见 §3.2
付费请求: 0
阻塞: 无（非阻塞观察见 §3.3）
```
