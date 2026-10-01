# l3-router lane 交付证据

日期：2026-10-02。worktree：`C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-router`；branch：`refactor/hk-l3-router`；base：`f74181d75c37450b1a4ccc7e0c134fdb0c48e74e`。未 commit、未 install、未操作 `.graph`、未修改 integration 或 `src/{protocol,kernel,runtime}/**`。运行环境 Node.js `v24.12.0`。

## checkpoint 证据

| checkpoint | 结果 | 可复验证据 |
|---|---|---|
| cp1 | passed | `access.ts` 只映射 role→现有 audience；`privacy.test.js` 核对 100 个 role/visibility/partition 组合，另以独立断言禁止 private/final/held-out 到 executor/learner/fresh-verifier。越枚举、未知 purpose、未声明/替换输入均 typed fail-closed。 |
| cp2 | passed | `packet.test.js` 验证逐字相同、键顺序无关、显式 handoff、audit 来源、全文/摘录/引用三种 mode；压缩后每个输入的 id+digest+visibility+binding 与 audit 均保留。human/host instructions 不裁剪。完整实测 fixture 输出是 `EXAMPLE.json`。 |
| cp3 | passed | `stale.test.js` 核验 expiry（at=expiresAt 拒绝）、旧合同、全部 producer binding 字段、旧 graph/base/epoch expectation、摘要代替 bytes、降级 held-out 引用路径；`negative.test.js` 三次真实实现变异均变红，移除变异复绿。 |

测试路径均为 `test/l3-router-*.test.js`，导入本次 build 的 `dist/learning/context/index.js`。最长 lane TS 文件 95 行，最长 lane test 192 行，均 ≤350。接线合同和信任边界见 `README.md`。

## 门禁数字

| 实际命令 | exit | 实测结果 |
|---|---:|---|
| `npm run build` | 0 | 本次源码生成 dist，未使用旧 build |
| `npm run typecheck` | 0 | 0 TypeScript errors |
| `npm run src:policy` | 0 | 197 TypeScript files；全仓最大 350 行；0 src JavaScript files |
| `npm run dep:check` | 0 | modules=197；edges=733；cycles=0；acyclic=true |
| `node --test test/l3-router-*.test.js`，第 1 次最终运行 | 0 | tests=37；pass=37；fail=0；skipped=0；cancelled=0 |
| 同命令，第 2 次最终运行 | 0 | tests=37；pass=37；fail=0；skipped=0；cancelled=0 |
| `node verification/kernel/static-audit.mjs` | 0 | status=passed；moduleCount=79；edgeCount=318；violations=[]；parser=typescript6 6.0.3 |
| `git diff --exit-code -- src/protocol src/kernel src/runtime` | 0 | core 无改动 |

static audit 是只读运行；不改其证据文件。其自身限制保持原样：I04/I05 不构成形式证明，尚无 `evofence/core` package export，dep cycle gate 不等于 domain boundary guard。此 lane 未运行全仓 `npm test` 或真实宿主实验。

## 可证伪负控

`node --test test/l3-router-negative.test.js` 或上述 lane suite 都会实际运行以下反例；独立子进程去掉继承的 `NODE_TEST_CONTEXT`，以免 Node 将它当递归 test runner 跳过。ESM loader 只改变该子进程内的 learning/context 模块源码，不写 source/dist/core，不安装依赖。要求 mutation site 恰好命中、行为断言报 `ERR_ASSERTION`；导入失败不算有效变红。

| 反例 | 真实变异 | 变异运行 | 移除 loader 后 |
|---|---|---|---|
| token-gate | 将完整 packet 的 `tokenCount <= tokenLimit` 判定改成 true | exit=1，pass=0，fail=1 | exit=0，pass=1，fail=0 |
| evidence-loss | 将 compact packet 的 entries 和 audit 全部清空 | exit=1，pass=0，fail=1 | exit=0，pass=1，fail=0 |
| private-leak | 将 executor/fresh-verifier/learner audience 改成 evaluator | exit=1，pass=0，fail=1 | exit=0，pass=1，fail=0 |

隐私反例含 public visibility + final partition、internal visibility + held-out partition，以及 private scorer/trace；变异使这些引用真正进入 executor packet，独立的“只允许 public-output”断言变红。隐私测试还证明改变 hidden bytes、hash、ID、producer、locator 不改变受限角色 packet，且 hidden 字节不会传给 digest/tokenizer；完整合同 digest 不向 agent 输出。

## packet 示例与审计来源

`EXAMPLE.json` 保存完整 `BoundedContextPacket`（所有数据均为公开合成 fixture）。输入包含两个长工件（`证据🙂` 重复 10,000 次、`trace ` 重复 10,000 次）和一个 private fixture；输出不保存 private fixture 的 ID、bytes 或 digest。

实测 `tokenizerId=fixture:utf8-byte/v1`，`tokenCount=7350`，`tokenLimit=12000`，`compressed=true`；重新计数 serialized 得到同一个 7350，withheld 仅 `{visibility:1, partition:0}`。

| packet entry | 真实完整内容 digest | visibility | mode | 摘录长度 |
|---|---|---|---|---:|
| proof-1 | `sha256:30360c8398292337ac6b6f655877981dd71452ef6d56ea2ed482deb1bdba0731` | internal | excerpt | 64 Unicode code points |
| handoff-1 | `sha256:43416c6bbead2270f6ede152dd258096a7ad8c5280022068e1fe6d2977f1e006` | internal | excerpt | 64 Unicode code points |

两条引用的 producer 为 `producer-1`、node 为 `producer-node`、attempt 为 `producer-attempt`，graph revision 为 2、epoch 为 1，完整 graph/base 摘要保留在输出中。audit 记录如下；每条还含对应安全 EvidenceLink：

```json
[
  {"id":"identity-1","source":"TaskContract","reason":"visible-contract-reference"},
  {"id":"price-1","source":"TaskContract","reason":"visible-contract-reference"},
  {"id":"proof-1","source":"ContextPlan.inputRefs","reason":"evidence"},
  {"id":"handoff-1","source":"ContextPlan.inputRefs","reason":"handoff"}
]
```

## 未证明项与阻塞

未证明：Pi/DSH 的实际 tokenizer/窗口封套与 retained resources 计数、native fresh transcript 与 evaluator-role 授权接线、workspace/evaluation 编排和真实长程收益；任意未标记正文中的 secret 检测不在实现内。fixture 是确切 byte-tokenizer 的门禁证明，不是实际模型 token 消耗或收益声明。router 自身不会把 hidden 字节编码到摘录、引用、hash 名、文件名或日志；上游若已把私有内容伪装成正确声明的 public artifact，须由 provenance/privacy pipeline 拒绝。

阻塞：无。未发现需修改冻结合同/core 的 drift。
