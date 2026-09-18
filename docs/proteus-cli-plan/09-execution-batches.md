# 分批执行策略（详细版）

> 与 `05-testing-batches.md` 的 B1-B7 对应，此处展开每批的**输入/输出/验收/依赖**。

## B1 — 命令骨架 + config loader + reporter

**输入**：无（CLI 起点）
**产出**：
- `packages/cli/src/commands/{build,dev,preview,audit,doctor,inspect}.ts`
- `packages/cli/src/config/loader.ts`（zod schema）
- `packages/cli/src/reporter/index.ts`

**验收**：
- `proteus --help` 列出全部命令
- `proteus build --explain` 打印计划（不执行）
- config 校验失败 → 明确报错带 `file:line`

**依赖**：Compiler plan（只需接口类型，可先 mock）

## B2 — dev / build / preview

**产出**：
- `commands/build.ts` 完整实现（调 Compiler）
- `commands/dev.ts`（watch + HMR 降级）
- `commands/preview.ts`

**验收**：
- fixture 跑 `proteus build --platform mp` → `dist/mp/` 结构正确
- `--platform all` 三端产物并存

**依赖**：B1

## B3 — audit 规则引擎 + route/module/api 规则

**产出**：
- `audit/engine.ts`
- `audit/rules/{route,module,api}.ts`

**验收**：
- 故意写 `wx.navigateTo` → `audit route` 报 error
- `--strict` → 退出码 1

**依赖**：B1

## B4 — audit capability/lifecycle/compile

**产出**：`audit/rules/{capability,lifecycle,compile}.ts`
**验收**：同 B3，覆盖 Platform/Lifecycle/Compiler 规则
**依赖**：B3（复用引擎）

## B5 — plugin middleware + create-proteus

**产出**：
- `plugins/index.ts`（hook 系统）
- `create-proteus/` 模板（minimal/full/super-app）

**验收**：
- 自定义 plugin 能注入 transform + 钩入 `build:start`
- `proteus create demo --preset full` 生成可运行工程

**依赖**：B2

## B6 — 缓存 / 并行 / 增量

**产出**：`cache/task-cache.ts`、并行调度
**验收**：
- 二次 build 命中缓存 → 耗时显著下降
- `--platform all` 三端并行 → 总耗时 ≈ 最慢单项

**依赖**：B2、Compiler M6

## B7 — doctor + telemetry + CI

**产出**：
- `commands/doctor.ts`
- `.github/workflows/proteus.yml`
- telemetry span 输出

**验收**：
- `proteus doctor` 检测 Node/微信工具/基础库
- CI 跑 `audit all --strict` 阻断违规 PR

**依赖**：B3-B4、Compiler M8

---

## 进度追踪

| Batch | 名称 | 状态 |
|-------|------|------|
| B1 | 命令骨架 + config | ⬜ |
| B2 | dev/build/preview | ⬜ |
| B3 | audit 引擎 + 三组规则 | ⬜ |
| B4 | audit 剩余规则 | ⬜ |
| B5 | plugin + create | ⬜ |
| B6 | 缓存/并行 | ⬜ |
| B7 | doctor + CI | ⬜ |

## 与其他 plan 的执行顺序建议

由于 CLI 是"命令面"，编排所有层，**建议在 Compiler 稳定后第一个实现**：
```
Compiler (plan 02) 稳定
  → CLI B1-B2        ← 最先（让所有层能 build）
  → 其他七层可并行    ← CLI 提供 audit 门禁
```
