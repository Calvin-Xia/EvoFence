已完成本 lane 独立复核的 B1、M1、m1–m5、n1–n4，全部处理，无延期项。分支 `refactor/hk-scheduler`，HEAD 保持 `12ed81b34808c129594d90a1bd6e6798752c791d`。本轮没有 commit、install 或操作 `.graph`。所有交付均在 `src/kernel/scheduler/**` 和 `test/l2-scheduler-*`。

| 发现 | 修复行为 |
|---|---|
| B1 | `classifyClaim` 以 ownerClaimId + epoch + expiresAt > now 判断活性。无匹配 lease 的 claim 显式报 `claim-without-lease`，曾持有但全部失效报 `lease-expired`；detail 标明 attempt tuple，blockedBy 标明该 node。没有活 claim 时 progress 为 stalled，刚派发并不构成活性证据。 |
| M1 | 公共入口导出 `reclaimExpiredClaims(state, now): ReclaimTransition`，返回 verdict/state/reclaimed/retained。只删除没有活 lease 的 claim；任一 matching live lease 都保留 claim。no-op state 恒等；有效回收仅加一次 revision；lease 历史、fencing token、未知 usage 预留保持原值。 |
| m1 | 冻结码表没有语义适合瞬时容量竞争的码，采用带 discriminator 的非错误业务结果 `LeaseTransition.verdict = capacity`，error 为 null；不改码表、不借用 retry=never 的 graph 编译错误。 |
| m2 | claimNode 唯一键改为 (sessionId, nodeId, attemptOrdinal, epoch)，不同 tuple 可创建；相同 tuple 即使 attemptId 不同仍拒绝。自动派发仍由 frontier 拦住已有 claim，重新派发需先显式回收并获新 attempt。 |
| m3 | dispatch 和 progress 都用 `liveAttemptClaims`，死 claim、已结算或出图 claim 不占 in-flight。active journal 状态没有活 claim 时要求 reconcile。同轮新发出的无 lease intention 仅保留本轮派发槽位，限制单轮总派发数，不作为跨轮活性信号。 |
| m4 | findClaim 用固定键排序选择，progress 逐 node 汇总并排序全部 claim；同节点旧/新 attempt 的数组排列不会改变 frontier、stalls 或 status。 |
| m5 | join 直接用完整 branchReport 分类 unknown 为 reconcile-required，保留 blocker id；不把它称为 live upstream，也不改写 graph readiness 真相源。 |
| n1 | declarationsOf 对未知节点抛冻结 EFK_GRAPH_REFERENCE_INVALID，对编译图缺 policy 抛 EFK_INVARIANT_VIOLATION，去掉非空断言。 |
| n2 | grantAll 按 capacity discriminator 直接消费 detail，删除 unreachable ?? fallback。此项负控为源码形状断言，非运行期触发不可达分支。 |
| n3 | joinGate 对省略 branches 容器显式拒绝，computeFrontier 在 outstanding join 上调用此入口；显式空 map 仍保留全部缺失分支、正常报 waiting。 |
| n4 | advanceFairness 增加 frontierIds 输入，只保留仍在 frontier 的计数；已 succeeded/cancelled/abandoned/出图节点的旧计数删去，等待者计数保留。 |

修复源码相对本轮开始时的 lane 文件共 +154 / -59 行（包括新增 activity.ts，排除本证据文件）。原有测试仅调整容量拒绝断言；fixtures、progress 和 resources 三个原有测试文件未改。新增 `test/l2-scheduler-review.test.js` 16 个定向用例。

| 验证 | 结果 |
|---|---|
| 修前原有命名用例 / 含 fixture | 22/22 / 23/23 |
| 新增用例在修前实现上 | 16 项全部红，exit 1（M1 API 不存在由存在性断言变红） |
| npm run build | 0 |
| npm run typecheck | 0 |
| npm run src:policy | 0，172 TS / 0 JS，最大 350 行 |
| npm run dep:check | 0，605 edges / 0 cycles / acyclic true |
| node --test test/l2-scheduler-*.test.js | 38 tests / 38 pass / 0 fail |
| node --test test/l2-scheduler-* | 39 tests / 39 pass / 0 fail，38 命名用例 + 1 fixture 文件 |
| 源码变异负控 | 17/17，所有 mutant 构建均 0，指定断言变红，源码恢复后 build 和同一断言复绿 |
| 恢复完整性 | 11/11 TS 文件与任何变异前的修复快照逐字一致；SHA256 记录在 JSON |
| lane 边界 | 收工 git status 仅出现授权 lane 文件；HEAD/分支未变 |

每条负控依次执行源码变异 → `npm run build` → 按 test-name-pattern 跑定向用例 → 恢复源码 → `npm run build` → 同一用例复绿。下表最后一列依次是 mutant build / red test / restored build / green test 的 exit code。完整变异前后文本、命令、原始 TAP、四项门禁输出、最终套件输出在 [review-evidence.json](review-evidence.json)。

| 项 | 变异 | 实测变红用例名 | exit codes |
|---|---|---|---|
| B1 | 将从未持 lease 的 claim 误判为 live | B1 — resource-free claims without live leases are explicit stalls | 0 / 1 / 0 / 0 |
| B1-epoch | 去掉 lease 与 claim 的 epoch 匹配 | B1 — a lease from another epoch is not a claim liveness signal | 0 / 1 / 0 / 0 |
| M1-live | 回收所有 claim，包括活 lease 的 owner | M1 — reclaim preserves any matching live lease and the identical state | 0 / 1 / 0 / 0 |
| M1-reclaim | 禁用死 claim 的回收转移 | M1 — reclaim expires dead claims, preserves lease history and enables a new attempt | 0 / 1 / 0 / 0 |
| M1-no-lease | 排除从未持 lease 的 claim 回收 | M1 — reclaim also retires claims that never held a lease | 0 / 1 / 0 / 0 |
| m1 | 重新用编译期 EFK_GRAPH_RESOURCE_CONFLICT 表达运行期容量竞争（负控刻意越过类型） | m1 — runtime capacity contention is a typed non-error and expires normally | 0 / 1 / 0 / 0 |
| m2 | 唯一键退回 nodeId | m2 — claim uniqueness is the session node ordinal epoch tuple | 0 / 1 / 0 / 0 |
| m3-dispatch | 并发额度重新计入死 claim、已结算与出图 claim | M1 m3 — dead claims release concurrency before explicit reclamation<br>m3 — settled and removed claims consume no concurrency | 0 / 1 / 0 / 0 |
| m3-progress | progress 改回只看 active/claimed，不要求活 lease | m3 — an active journal state without a live claim requires reconciliation | 0 / 1 / 0 / 0 |
| m4-order | frontier claim 选择退回数组首条 | m4 — multiple claims classify identically in either array order | 0 / 1 / 0 / 0 |
| m4-aggregate | progress 只报告首条 claim，不汇总同节点所有 attempt | m4 — multiple claims classify identically in either array order | 0 / 1 / 0 / 0 |
| m5 | 禁用 unknown 分支的 reconcile 分类 | m5 — an unknown join branch requires reconciliation using branch evidence | 0 / 1 / 0 / 0 |
| n1-node | 未知节点退回无资源 fail-open | n1 — unknown resource nodes and missing policies fail closed | 0 / 1 / 0 / 0 |
| n1-policy | 缺 policy 退回非空断言，丢失结构化错误 | n1 — unknown resource nodes and missing policies fail closed | 0 / 1 / 0 / 0 |
| n2 | 重新加入构造上不可达的 ?? fallback | n2 — capacity diagnostics have no unreachable fallback | 0 / 1 / 0 / 0 |
| n3 | 漏传 branch facts 静默退回空 map | n3 — missing branch facts are rejected while an explicit empty map is a gap | 0 / 1 / 0 / 0 |
| n4 | 保留所有历史 fairness 计数 | n4 — fairness prunes settled nodes and retains outstanding waiters | 0 / 1 / 0 / 0 |

仍未证明：未运行全量 `npm test` 或 `test:e2e`；本轮以注入状态建模 lease 过期/缺失，没有制造宿主进程被 kill，也未验证真实 host heartbeat、store CAS、journal/outbox 原子提交或下游 runtime 消费者。无资源 claim 立刻 stalled 表示缺少活性证据，不表示已证明 worker 死亡；reclaim 不核实外部效果、不释放未知 usage，实际 retry 仍须由调用方完成 reconcile/journal 授权并提供新 Binding。以上边界均未用本 lane 单测替代跨 lane 证据。
