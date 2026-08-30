# 09 · 分批执行策略（B1-B7）

> 7 批 = 7 个独立 PR，每批可并行可串行。防上下文撑爆规则：每批仅喂 `00-overview.md`（快速回顾）+ 当前模块文件（≤3 份）+ 其直接依赖。

---

## 1. 依赖图

```
B1 (核心类型: platform/lifecycle/IR/registry)
 │
 ├──▶ B2 (Config Schema: 依赖 B1 的 IR 类型)
 │     │
 │     ├──▶ B3 (Codegen 派发: 依赖 B1 类型 + B2 schema)
 │     │
 │     ├──▶ B4 (平台守卫: 依赖 B1 Platform)
 │     │
 │     └──▶ B5 (校验器: 依赖 B2 schema + B1 IR)
 │
 └──▶ B6 (超级应用加固: 循环检测/品牌/迁移, 依赖 B1+B2)
       │
       └──▶ B7 (测试+迁移+CI: 依赖 B1-B6 全部)
```

**串行链**：B1 → B2 → B3/B4/B5（并行）→ B6 → B7

---

## 2. 分批清单

| 批次 | 文件 | 内容 | 依赖 | 产物 |
|------|------|------|------|------|
| **B1** | `01-m1-core-types.md` | Platform/AppPhase/IR/Registry | — | `@proteus-vue/types` 骨架 |
| **B2** | `02-m2-config-schema.md` | ProteusConfigSchema + 字段归属 | B1 | `@proteus-vue/config-schema` |
| **B3** | `03-m3-codegen.md` | generate 命令 + 四产物 | B1, B2 | `proteus generate types` |
| **B4** | `04-m4-platform-guards.md` | assertPlatform/matchPlatform | B1 | 运行时守卫 |
| **B5** | `05-m5-validator.md` | validateConfig + 错误码 | B1, B2 | 校验器 + source map |
| **B6** | `06-m6-super-app.md` + `08-relations-contracts.md` | 循环检测/品牌/迁移/关系 | B1, B2 | 加固层 + 契约文档 |
| **B7** | `07-m7-testing-migration.md` | 测试矩阵 + codemod + CI | B1-B6 | 全量测试 + 迁移工具 |

> B3/B4/B5 可并行（各自独立）；B6/B7 必须串行（依赖前面）。

---

## 3. 上下文预算（防撑爆）

| 批次 | 喂入文件 | 估 tokens |
|------|---------|-----------|
| B1 | `00-overview` + `01-m1-core-types` | ~20k |
| B2 | `00-overview` + `01` + `02` | ~28k |
| B3 | `00-overview` + `02` + `03` | ~25k |
| B4 | `00-overview` + `01` + `04` | ~22k |
| B5 | `00-overview` + `02` + `05` | ~24k |
| B6 | `00-overview` + `06` + `08` + 依赖摘要 | ~30k |
| B7 | `00-overview` + `07` + 各模块测试摘要 | ~30k |

> 单批 ≤ 30k tokens，安全线内。若超预算，把 `00-overview.md` 替换为 5 行摘要。

---

## 4. Prompt 模板（每批开头复用）

```
你是 Proteus 框架的贡献者。本次实现【批次名】。

【硬约束】
- 严格遵循 `proteus-compiler-plan` 的 transform 规范（每条规则可审计、产物可追溯到源码）
- 不允许新增 `any` 类型（除非经铁律豁免）
- 所有平台分支必须走 `Platform` 判别（禁止 `#ifdef`）
- 字段变更同步三处（schema + audit + transform JSDoc）

【上下文】
- 必读：`00-overview.md`（5 分钟快速回顾架构、铁律、里程碑）
- 当前批次：{批次文件，如 01-m1-core-types.md}
- 直接依赖：{如 B1 需 01；B2 需 01}

【产出】
- 按批次文件的功能点逐一实现
- 每个模块导出类型/函数 + 对应单测
- 跑通 `tsc --strict` + `vitest` 后提交

【验收】
- 严格对齐 `07-m7-testing-migration.md` 中本批次的验收清单
```

---

## 5. 进度追踪（逐批勾选）

```
[ ] B1 核心类型系统        (P0, 先行)
[ ] B2 Config Schema       (P0, 先行)
[ ] B3 Codegen 派发
[ ] B4 平台守卫
[ ] B5 校验器 + 错误定位
[ ] B6 超级应用加固 + 关系契约
[ ] B7 测试 + 迁移 + CI
```

---

## 6. 验收口径（全局）

- **类型**：`tsc --strict --noEmit` 零错误，零 `any` 泄漏（`@typescript-eslint/no-explicit-any: error`）
- **Schema**：合法配置通过，非法配置抛 `ValidationError` 且定位行列
- **Codegen**：`proteus generate --check` 在 CI 通过（产物与源码一致）
- **守卫**：穷尽检查覆盖全部 Platform 分支
- **迁移**：存量配置 `proteus migrate types` 幂等成功
- **CI**：typecheck + test + generate-check + audit 全绿

---

## 7. 风险提示

- **B1 是地基**：`Platform`/`IR` 定义不稳 → 后续批次全部返工。**先冻结类型，再动其他**。
- **B3 codegen 与 Compiler 耦合**：需确认 Compiler `02-ir.md` 的 IR 字段已冻结，否则派生产物冲突。
- **B6 循环检测**：类型层面递归深度有限，千级模块可能触达 `MAX_DEPTH` → 预留可调。
- **B7 CI 矩阵**：需在 Compiler/CLI 落地后才有完整 `proteus generate`/`audit` 命令可执行。

---

## 8. 下一步建议

B1+B2 落地后，**同步暂停本计划**，优先推进：
1. `proteus-testing-plan`（测试基础设施，依赖本计划 types）
2. `proteus-devtools-plan`（调试工具链，依赖 trace 类型）
3. `proteus-build-pipeline`（CI/CD，依赖 CLI + audit）

> 本计划（Types + Config Schema）是所有基建与运行时层的"接口定义"，**先于一切但滞后于 Compiler/CLI**（复用其 IR + 命令体系）。
