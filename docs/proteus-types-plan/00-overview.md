# 00 · 架构总览、依赖关系与里程碑

> 本文档定义 Proteus 全局类型系统（`@proteus-vue/types`）与配置 Schema（`@proteus-vue/config-schema`）的落地方案，是 Compiler/CLI/Audit 之后的**横切契约层**。所有运行时层（Platform/Lifecycle/Module/Pinia/Router/API/Component）共享本文档定义的类型与配置约束。

---

## 1. 定位：横切契约层

```
┌────────────────── 运行时层（已有 7 份）──────────────────┐
│  Platform → Lifecycle → Module → Pinia → Router → API → Component  │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ 依赖（读类型、校验配置）
                           ▼
┌────────────────── 基建层（本次 + 已落地）──────────────────┐
│  Compiler → CLI → 【Types + Config Schema】← 本次              │
│         → Testing → DevTools → Build Pipeline                 │
└───────────────────────────────────────────────────────────────┘
```

**Types + Config Schema 是基建层的"接口定义"**：Compiler 产出 IR 要符合类型；CLI 加载配置要走 schema 校验；Audit 检查规则引用 schema；各运行时层 import 共享类型。

---

## 2. 依赖关系（必须先于 testing/devtools/build-pipeline）

| 依赖方 | 依赖本计划什么 | 说明 |
|--------|--------------|------|
| `proteus-compiler-plan` | IR 类型定义（`SFCIR`、`TransformIR`） | Compiler 产出须符合本计划类型，本计划在 Compiler **之后**执行（复用其 IR 设计） |
| `proteus-cli-plan` | config loader、audit 规则类型 | CLI 的 `loadConfig()` + `audit` 命令消费本计划的 schema |
| `proteus-lifecycle-plan` | `AppPhase`、`LaunchType` 类型 | `defineApp` 的阶段钩子签名 |
| Platform / Router / API / Component / Pinia / Module | 各自的 config 字段类型、`Platform` 判别 | 业务代码 import 类型做收窄 |

**执行顺序（硬约束）**：
```
Compiler (✅) → CLI (✅) → Types+ConfigSchema (本次, B1-B2 先行) → Testing → DevTools → Build Pipeline
```
> B1-B2（核心类型 + schema）落地后，其他基建与运行时层才可安全引用。本计划自身不依赖任何运行时层，可独立并行启动。

---

## 3. 设计原则（5 条铁律）

1. **不引入运行时依赖**：本计划只产出 `.d.ts` + JSON Schema + 校验器 + 代码生成器，零运行时开销（类型在编译期擦除）。
2. **单一来源（Single Source of Truth）**：每个类型/配置字段只有一个定义点，通过 `generate` 命令派发到各层（禁止各层各自定义后手动同步）。
3. **字段归属显式**：配置字段必须声明所属层（`platform`/`router`/`pinia`/...），禁止跨层隐式依赖（如 `router` 字段不得悄悄影响 `pinia`）。
4. **禁止 `#ifdef`，用类型收窄**：平台判别统一通过 `Platform` 判别联合 + `assertPlatform()` 守卫，业务代码不允许 `process.env`/`wx.`/`window.` 裸判断。
5. **变更同步三处**：`proteus.config.ts` 字段变更 → 本计划 schema + CLI audit 规则 + 对应 transform JSDoc **必须同步更新**，否则 CI 阻断。

---

## 4. 里程碑（M1-M6）

| 里程碑 | 内容 | 批次 |
|--------|------|------|
| **M1 核心类型系统** | `Platform` 判别、`AppPhase`、`CapabilityIR`、`RouteIR`、`StoreIR`、`ModuleIR`、全局 Registry 推断（`StoresRegistry`/`ModulesRegistry`/`RoutesRegistry`） | B1 |
| **M2 Config Schema** | `proteus.config.ts` 完整 JSON Schema + zod 校验器 + 字段归属标注 + 默认值合并 | B2 |
| **M3 Codegen 派发** | 从单一类型源生成各层 `.d.ts` + schema + audit 规则骨架（DRY） | B3 |
| **M4 平台判别与守卫** | `assertPlatform()`、`PlatformGuard`、条件类型工具（`IfPlatform`/`ExtractByPlatform`） | B4 |
| **M5 校验器 + 错误定位** | 配置校验、SFC IR 类型守卫、错误码 + 行列号（对齐 `--trace-transform`） | B5 |
| **M6 超级应用加固** | 循环依赖检测（类型层面）、品牌类型防混淆、配置版本迁移、schema registry 可扩展 | B6 |
| **M7 测试 + 迁移** | 四层测试 + 存量 `proteus.config.ts` codemod + CI 门禁 | B7 |

> M1-M2 为 P0（B1-B2），**必须先行**；M3-M7 可后置但不得省略（M5 错误定位对齐 Compiler 的 source map 体系）。

---

## 5. 与其他计划的关系（引用点）

| 本计划产出 | 被谁引用 |
|-----------|---------|
| `Platform` 判别联合 | Platform plan（capability 分叉）、所有业务代码 |
| `AppPhase` / `LaunchType` | Lifecycle plan（`defineApp` 阶段钩子） |
| `RouteIR` | Router plan（路由树、codegen） |
| `StoreIR` / `StoresRegistry` | Pinia plan（M8.4 类型注册表） |
| `ModuleIR` | Module plan（依赖图、分包） |
| `CapabilityIR` | Platform plan（capability 契约） |
| `ProteusConfig` schema | CLI plan（config loader）、Audit plan（规则校验） |

---

## 6. 验收标准

- [ ] 业务代码 `import type { Platform } from '@proteus-vue/types'` 可在三端正确收窄
- [ ] `proteus.config.ts` 写错字段 → tsc + CLI audit **双报错**且定位到行列
- [ ] 任一 IR 变更 → 各层 `.d.ts` 通过 `generate` 自动同步，无需手写
- [ ] 新增平台（如鸿蒙）只需扩展 `Platform` 联合 + 对应 schema，业务代码零改动
- [ ] 全部类型零 `any` 泄漏（CI 通过 `@typescript-eslint/no-explicit-any` 硬卡）

详细分批、Prompt 模板、依赖图见 `09-execution-batches.md`。
