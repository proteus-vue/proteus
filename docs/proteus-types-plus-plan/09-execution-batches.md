# 09 · 分批执行策略（B1-B9）

> 9 批 = 9 个独立 PR，每批可并行可串行。防上下文撑爆规则：每批仅喂 `00-overview.md`（快速回顾）+ 当前模块文件（≤3 份）+ 其直接依赖。

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
 ├──▶ B6 (超级应用加固: 循环检测/品牌/迁移, 依赖 B1+B2)
 │     │
 │     └──▶ B7 (测试+迁移+CI: 依赖 B1-B6 全部)
 │
 └──▶ B8 (小程序官方类型整合: 依赖 B1 Platform + B6 registry)
       │
       └──▶ B9 (跨端 API 统一层: 依赖 B8 官方类型 + B1 Platform)
```

**串行链**：
- 主干：`B1 → B2 → {B3, B4, B5} → B6 → B7`
- 类型支线：`B1 → B8 → B9`（可与 B2-B7 **并行**，因为只依赖 B1）

> B8/B9 越早做越好：它们是**唯一会接触外部类型来源（官方 typings）的批次**，越早锁定边界，越避免后续各层各自造 `wx` 类型。

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
| **B8** | `01-m1-core-types.md` §8-§11（mp/ 子目录） | 官方 `miniprogram-api-typings` 接入 + WXML 组件 schema + 版本锁定 | B1 | `mp/official-typings.ts` + `mp/component-schema.ts` |
| **B9** | 新增 `10-m9-platform-api.md` | 跨端 `PlatformAPI` 统一接口（`wx.request`/`fetch`/`nativeFetch` 分派） | B1, B8 | `@proteus-vue/types/api` |

> B3/B4/B5 可并行；B8/B9 可与 B2-B7 并行（仅依赖 B1）；B6/B7、B9 各自串行。

---

## 3. 上下文预算（防撑爆）

| 批次 | 喂入文件 | 估 tokens |
|------|---------|-----------|
| B1 | `00-overview` + `01-m1-core-types` | ~22k（含 §8-§11 官方类型边界） |
| B2 | `00-overview` + `01` + `02` | ~28k |
| B3 | `00-overview` + `02` + `03` | ~25k |
| B4 | `00-overview` + `01` + `04` | ~22k |
| B5 | `00-overview` + `02` + `05` | ~24k |
| B6 | `00-overview` + `06` + `08` + 依赖摘要 | ~30k |
| B7 | `00-overview` + `07` + 各模块测试摘要 | ~30k |
| **B8** | `00-overview` + `01`(§8-§11) + `08` | ~24k |
| **B9** | `00-overview` + `01`(§2,§8) + `10-m9-platform-api` | ~26k |

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
- 第三方类型优先复用官方包，禁止重复造轮子（铁律 #6）

【上下文】
- 必读：`00-overview.md`（5 分钟快速回顾架构、铁律、里程碑）
- 当前批次：{批次文件，如 01-m1-core-types.md}
- 直接依赖：{如 B1 需 01；B8 需 01 §8-§11；B9 需 01 + 10}

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
[x] B1 核心类型系统        (P0, 先行)
[x] B2 Config Schema       (P0, 先行)
[x] B3 Codegen 派发
[x] B4 平台守卫
[x] B5 校验器 + 错误定位
[x] B6 超级应用加固 + 关系契约
[x] B7 测试 + 迁移 + CI
[x] B8 小程序官方类型整合  (可与 B2-B7 并行, P1；2026-08-31 落地)
[x] B9 跨端 API 统一层    (依赖 B8；2026-08-31 落地)
```

> ★B8 落地说明（2026-08-31）：`packages/types/src/mp/`（component-schema / sdk-version / official-typings）+ `@proteus-vue/types/mp` 子路径 + 8 单测（757 全绿，Node 22）。`wx: any` shims 替换为官方类型列为后续批次（需解决 App/Page/Component/console 全局冲突）。
> ★B9 落地说明（2026-08-31）：`packages/types/src/platform-api.ts`（PlatformAPI/StorageAPI/RouterAPI/UIAPI 契约，request 复用 api-types 单一来源，契约自包含 re-export RequestConfig/RequestResponse）+ `@proteus-vue/types/platform-api` 子路径 + 根 index 导出 + **`@proteus-vue/api` 运行时 createPlatformAPI**（storage/router/ui/request 四域 wx/web 双端适配 + 内存/DOM/console 兜底，MP 产物 ES5 安全）+ `@proteus-vue/api` re-export；类型断言 tests/types/platform-api.types.ts + 运行时单测 tests/platform-api.test.ts 7 用例（764 全绿）。

---

## 6. 验收口径（全局）

- **类型**：`tsc --strict --noEmit` 零错误，零 `any` 泄漏（`@typescript-eslint/no-explicit-any: error`）
- **Schema**：合法配置通过，非法配置抛 `ValidationError` 且定位行列
- **Codegen**：`proteus generate --check` 在 CI 通过（产物与源码一致）
- **守卫**：穷尽检查覆盖全部 Platform 分支
- **迁移**：存量配置 `proteus migrate types` 幂等成功
- **官方类型**：`wx.*` / `App`/`Page`/`Component` 参数全部源自 `miniprogram-api-typings`，Proteus 不自造（B8）
- **模板类型**：WXML 属性校验走自建 `MpComponentSchema`，与 `p-*` 映射一致（B8）
- **跨端统一**：业务层只依赖 `PlatformAPI`，不出现 `wx.`/`window.`/`plus.` 裸调用（B9）
- **CI**：typecheck + test + generate-check + audit 全绿

---

## 7. 风险提示

- **B1 是地基**：`Platform`/`IR` 定义不稳 → 后续批次全部返工。**先冻结类型，再动其他**。
- **B3 codegen 与 Compiler 耦合**：需确认 Compiler `02-ir.md` 的 IR 字段已冻结，否则派生产物冲突。
- **B6 循环检测**：类型层面递归深度有限，千级模块可能触达 `MAX_DEPTH` → 预留可调。
- **B7 CI 矩阵**：需在 Compiler/CLI 落地后才有完整 `proteus generate`/`audit` 命令可执行。
- **B8 官方 typings 滞后**：Skyline 新 API / 刚发版能力可能未同步 → 用 `mp/shims.d.ts` 临时补，并提 issue 上游。
- **B8 版本对齐**：`MpSdkVersion` 必须与 `proteus.config` 的 `mp.libVersion` 联动，否则高版本 API 在低版本基础库误用无提示。
- **B9 统一层边界**：只收敛**常用跨端 API**（请求/存储/路由/UI），平台独占能力仍走 `CapabilityIR`，不强行塞进统一接口。

---

## 8. 下一步建议

B1+B2 落地后，**同步暂停本计划**，优先推进：
1. `proteus-testing-plan`（测试基础设施，依赖本计划 types）
2. `proteus-devtools-plan`（调试工具链，依赖 trace 类型）
3. `proteus-build-pipeline`（CI/CD，依赖 CLI + audit）
4. **B8/B9（小程序官方类型 + 跨端 API 统一）**：越早做越避免各层各自造类型

> 本计划（Types + Config Schema）是所有基建与运行时层的"接口定义"，**先于一切但滞后于 Compiler/CLI**（复用其 IR + 命令体系）。
