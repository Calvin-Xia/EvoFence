# L4 promotion lane

入口为 `createPromotionService`。这是注入式晋升与激活协调器；不构造 backend、不发现宿主、不写用户 Skills。`PromotionRecord`、指针和 registry 是本地 journal projection，不扩展冻结 wire schema。

调用方先创建专用 EventStore session，再用可信 registry projection 和无激活资产的基础快照初始化。原 session journal 与 ArtifactStore 一并恢复后，新 service 可直接 `inspect` / `reconcile`，无需重新初始化。`inspect` 是内核内部视图，包含私有评价引用；任务只消费 `activatedVersions(context)` 返回的确切版本与快照。

## 事务与调用顺序

1. `promote` 消费一个 EvaluationReceipt，按可信 PolicyPort 提供的规则核验精确 revision、session、scope、权限交集、深度、能力、期限和撤销代数。原有 `recordDecision` 是评价完整绑定、guardrails 和资格转移的判定入口。临时策略还需要 `allowTemporary=true` 的明确规则。
2. 完整旧指针（包含 version、scope、资产身份和实际 snapshot）参与 CAS。registry、正式指针和 PromotionRecord 原子写入同一 session journal；评价内容 digest 不重复消费。同请求同内容返回已有记录，改内容返回 `EFK_IDEMPOTENCY_COLLISION`。
3. `activate` 经 `HostPort.observe` 确认安全点，重新核验当前资格、权限、grant、lease、deadline 与能力。先提交 outbox intention，再领取 dispatch claim，最后调用 `HostPort.execute(authorized)`，其中 `authorized.effect.kind === 'host.activate'`。`previousSnapshot` 必须等于事务旧快照。
4. HostPort Receipt 绑定原 effect/attempt；其唯一 ActivationReceipt 必须由注册 host adapter 签发，绑定 asset、host session、scope、authorization、evaluation 和 previousSnapshot。只有实际 `active` 与可读 newSnapshot 才能切换已激活指针；`failed` 保留原实际资产与快照。
5. 同一 service 的修改串行排队。不同实例共享 EventStore CAS；同一 host session 有 pending activation 时拒绝其他指针变更和下一任务读取。并发提交不会覆盖已提交更新，冲突必须刷新后用新请求提交。

## 恢复与撤销

- intention 已提交但尚未 dispatch：reconcile 重新取得安全点和当前授权后领取原 intention；不会创建第二个 effect。
- Receipt 提交失败：HostPort.reconcile 查询原 effect 的真实结果，不重新 execute。
- Receipt 已保存但 registry/pointer CAS 失败：从 journal 的原回执重建最终提交；无需调用宿主。并发 reconcile 只应用一次。
- unknown 或缺失/绑定错误的激活证据：保留 pending 和旧指针，typed 拒绝后续任务。无法确认的外部动作不推断成失败，也不重发。
- 已实际应用但提交时资格/授权失效：记录 `applied-unqualified` 与真实新快照，保留 typed 拒绝，禁止任务使用。不会把外部真实变更伪装成旧快照，也不会授予新资格；可以预授权的补偿回退恢复已验证版本。
- `revoke` 复用原 registry 的撤销入口并保留证据。`rollback` 只选同 pointer/session/scope 的历史确认快照，要求目标目前仍有有效资格；经 `HostPort.observe` 和新的 `HostPort.execute(authorized)`（`authorized.effect.kind === 'host.activate'`）、新 ActivationReceipt 和 ActivationDecision 确认精确恢复。恢复既有资格不产生第二次评价/晋升，不重新授予 registry 资格。失败回退保留当前实际快照。
- 撤销、rollback 是独立、明确的操作，不自动替用户选择目标版本。

## 验证记录（2026-10-02）

`test/l4-promotion.test.js`：40 个独立顶层用例，最后两轮均 40/40，0 failed / skipped。

| 要求 | 证据 |
|---|---|
| cp1 / DoD① | evaluation 缺失、空集、多条、过期、替换、缺失 bytes、错误 codec；授权缺失、过期、撤销、错误资产、scope、depth、capability 均 typed 拒绝；临时策略无预授权不能晋升 |
| CAS / 串行化 | 修改旧 version/scope/snapshot/资产拒绝；两个独立指针均提交；两个实例争同指针仅一个成功，另一个 CAS 拒绝 |
| cp2 / DoD② | busy/能力不足/撤销 grant/过期资格/lease/deadline/错误 effect 绑定均阻止 dispatch；执行前有持久 intention/claim；失败后旧资产 qualification.usable=true，旧快照与内容可读 |
| 下一任务 | `task-2` 列出 `assetId/revision/digest` 和实际 snapshot；成功只列当前版本，失败仍列旧版本；异 session/无资格 task 不列资产 |
| cp3 | 重复无第二宿主调用；dispatch/receipt/最终 CAS 注错后的恢复；journal export/restore 后新 service 恢复；并发 reconcile 一次应用；unknown 阻止下一任务；撤销、精确回退、失败回退、在途撤销后的补偿 |

最终门禁：`npm run build`、`npm run typecheck`、`npm run src:policy`、`npm run dep:check` exit 0；`node verification/kernel/static-audit.mjs` exit 0，0 violations。static-audit 自身扫描 protocol/kernel/runtime，不能把该结果当成整个 learning 目录的完整静态证明。新 lane 源码只有相对 import，外部能力经 ports 注入。

### 真实 negative controls

每轮都先运行原始用例，再修改真实 `.ts` 源码并构建，确认用例因 AssertionError exit 1；随后写回原 Buffer，核对逐字节相等，重新构建并确认原用例 exit 0。

| DoD | 变异点 | 用例名 | baseline / mutated build / red / restored build / green |
|---|---|---|---|
| ① | `rules.ts` 将 `!rule.assets.some(ref => sameRevision(ref, asset))` 替换为 `false`，绕过授权资产绑定 | `DoD1 authorization wrong asset refuses promotion` | 0 / 0 / 1 / 0 / 0 |
| ② | `activation.ts` 的失败分支将旧 pointer.snapshot 换成失败 ActivationReceipt 引用 | `DoD2 failed host activation retains usable old snapshot and exact next-task versions` | 0 / 0 / 1 / 0 / 0 |

复原 SHA-256：

- `rules.ts`: `75a2c8cb510c53fb8cedf99c7f57ae86483ebfcbc5cf624434f2ddec84905632`
- `activation.ts`: `49c8f57ba3a9a01c5cb6a3898b7f13df3559e71eff63077e68df7e117d7fb48a`

## 证据边界

以上是离线 synthetic fixture、内存 EventStore / ArtifactStore、真实构建与源码变异证据。真实 DSH/Pi 激活、宿主 safe-point 与实际执行之间的原生原子性、真实快照恢复、数据库/进程崩溃持久性、完整 runtime/task/retrieval E2E、能力收益、供应商 billing 均未证明；全量 `npm test` 和 `test:e2e` 未运行。无法满足冻结 HostPort 的宿主仍应 typed 拒绝，不能用 fixture 证明其支持激活。

已知受限行为（交叉复核 F1，delta 复核判定**保持**）：判定期拒绝的路径不再落任何 DecisionRecord / PromotionState；但 CAS/commit 失败路径仍会在只增的 ArtifactStore 留下 1 条 DecisionRecord 与 1 条 PromotionState。冻结端口下无法消除：`publish(PromotionState)` 必须先于 `journal.append`（append 的 `objectRef` 与 `load()` 都依赖它），而 DecisionRecord 按真相源方向应写在 commit 之前。该残余是 private 分区、从不被指针或 journal 投影引用的记录，不影响晋升结果与可检索状态。

真实宿主/模型请求：0；本 lane 探针 usage：0 requests、0 input/output tokens、0 USD。没有 commit、install 或 `.graph` 操作。
