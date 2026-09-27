# EvoFence 0.4.0 · L2 域内 TypeScript 转换协议

本文件是图中 L2 各域节点（l2_ledger / l2_gate / l2_exec / l2_config）执行时必须遵守的唯一纪律源。
依据：ADR-0002（仅发布 dist 形态）、ADR-0004（测试以构建产物为被测对象）、ADR-0005（依赖方向单向无环）。

## 为什么需要这份协议

L2 四域**并行在不同 Git worktree 里各自改写**，而 0.3.0 的实现里各域互相 import。如果每个域的 agent 各自决定“怎么改、怎么挪、怎么改测试”，合并时必然互相打断。所以：**域内自由重构，域边界冻结**。

## 五条铁律

### R1 路径稳定（既有文件不移动）

域内每个既有文件在**原路径**上做 `.js` → `.ts` 同名替换，例如 `src/lib/ledger.js` → `src/lib/ledger.ts`。

- **禁止**移动或重命名既有文件路径（`src/lib/x.js` 不得变成 `src/other/x.ts`）。
- 原因：其他域此刻仍是 `.js`，通过既有相对路径 import 你；NodeNext 编译期会把 `'./x.js'` 正确解析到 `x.ts`，但**移动路径会一次性打断所有调用方**。
- 转换后**必须删除同名 `.js`**：否则 `tsc` 会把两份都编进 dist，产物冲突且 `dep:check` 会出现重复模块。

### R2 导出面稳定（域边界冻结）

- 既有 `export` 的**名字与语义不得删除或改名**；可以新增导出。
- 域门禁边界（谁做判定、谁做编排）在本阶段不动；跨域 API 的重新设计**推迟**到 L3/L4，写进执行报告的 notes，不在 L2 自行实施。
- 需要新的内部结构 → 走 R3，不要改入口的对外形状。

### R3 域内自由拆分（模块化的落点）

- 允许新建子目录与文件，例如 `src/lib/ledger/chain.ts`、`src/lib/gate/budget.ts`、`src/lib/exec/adapters/codex.ts`。
- 入口文件（R1 保留的那个）充当该域的 re-export 门面，可只做转发。
- **单文件 ≤ 350 行**是硬门禁，超了就继续拆。
- 域内依赖必须单向无环（`npm run dep:check` 会查）。

### R4 测试指向构建产物（ADR-0004）

- 把**本域对应的** `test/*.test.js` 里的 import 路径从 `../src/...` 改为 `../dist/...`。
- **只改 import 路径，不得修改任何断言、不得删除用例、不得放松判定**。
- `npm test` 现在会先构建再跑（`npm run build && node --test`），所以 dist 一定是最新的。
- 非本域的测试文件**不要动**。若发现非本域测试因你的改动而变红，停下上报，不要顺手改它。

### R5 不越域（文件边界）

允许写：本域源文件、本域测试文件、本域新建的子目录文件。
禁止写：`tsconfig.json`、`package.json`、`package-lock.json`、`scripts/**`、`docs/**`、`.github/**`、`integrations/**`、`.pi/**`、`.graph/**`、`src/types/**`（只读引用）、**其他域的源文件与其他域的测试文件**。

跨域需求（例如“我需要 gate 暴露一个新判定函数”）一律**不动手**，写进执行报告 blockers，由编排会话裁决后再合并或改图。

## 各域的独占文件

| 域 | 独占源文件 | 独占测试文件 |
|---|---|---|
| ledger | `src/lib/ledger.js`、`src/lib/audit.js` | `test/ledger.test.js` |
| gate | `src/lib/policy.js`、`src/lib/contract.js`、`src/lib/evidence.js` | `test/contract-policy.test.js` |
| exec | `src/lib/runner.js`、`src/lib/adapter.js`、`src/lib/git.js`、`src/lib/process.js` | `test/runner.test.js`、`test/adapter.test.js`、`test/git.test.js`、`test/process.test.js` |
| config（io 域的一个阶段） | `src/lib/init.js`（config 校验部分） | 见 doD 指定的配置用例 |

其余文件（`src/cli.js`、`src/index.js`、`src/lib/{fs,errors,report,status}.js`、`src/lib/pi-tool-strategy*.js`）**不在 L2 四域范围内**，由后续节点处理。

`src/lib/fs.js` 与 `src/lib/errors.js` 是全域共享叶子模块：**L2 期间保持 `.js` 不动**（任何域都不要转它们），避免四域同时依赖的公共底座在并行期漂移。

## 验证清单（每个域交报告前必须逐条跑）

```bash
npx tsc --noEmit          # 退出码 0
npm run build             # 退出码 0
npm run dep:check         # acyclic: true
npm test                  # 0 failures，用例数不少于 152 - （本域未对齐的用例数，且必须说明）
```

外加本节点 DoD 里的专项命令。**任何一条不过就停下上报，不要绕过。**

## 状态流转由编排会话统一记录

各域 agent 在 worktree 里工作，而 `.graph/` 只存在于主检出，因此**不要自己 claim/上报/流转节点**——worktree 里也跑不通 graph 命令。
你只需：干活 → 自证 → 在回复里给出证据清单与真实文件路径 → 由编排会话写入 checkpoint / execution_report / passed。
你的 `claim_by` 由编排会话按 `docs/refactor-dispatch.md` 记录为 `herdr-<域>`。

## 交付报告格式（回复用，不写文件）

1. 一句话结论（本域是否达标）。
2. 转换/拆分后的文件清单：路径 + 行数（**必须逐文件列行数**，≤350 是硬门禁）。
3. 验证清单 4 条 + 本域 DoD 专项命令的命令与实测输出摘要。
4. 测试改动的 import 路径清单（哪些文件、从什么改到什么），以及断言零改动的声明。
5. 跨域需求 / 发现的图错 / 任何绕过或折中（没有就写无）。
