# Proteus 全局类型系统与配置 Schema 落地执行文档（types + config-schema 合并版 v1.0.0-alpha.0 · 对齐 v2.47 Skyline + Vapor Mode · 配套 Compiler/CLI/Audit 已落地 · 本计划优先级 P0，与其他 9 份计划平行，必须先行（B1-B2）后才可进入 testing/devtools/build-pipeline · 全部类型与 schema 对齐 `--trace-transform`/`--trace-lifecycle`/`proteus audit` 可审计 · 所有模块文件独立可喂 LLM，禁止单次全量塞入上下文 · 禁止依赖本计划未定义的外部类型（禁止裸 `any` 跨层泄漏） · 全量执行分 B1-B7 共 7 批，每批 = 1 个独立 PR · 每批喂 LLM 时仅给 `00-overview.md`（快速回顾）+ 当前模块文件（≤3 份）+ 其直接依赖模块文件，禁止一次塞入全部 10 份 · 分批策略、依赖关系、Prompt 模板、验收口径详见 `09-execution-batches.md` · 类型/配置错误须有可定位的诊断信息（对齐 Compiler `05-sourcemap-trace.md` 的 `--trace-transform`） · 任何 `proteus.config.ts` 字段变更须同步更新本计划 schema + `proteus-cli-plan` 的 audit 规则 + 对应 transform JSDoc（铁律 #5） · 本计划不引入新的运行时依赖，仅产出 `.d.ts` + schema + 校验器 + 代码生成器（铁律 #1） · 禁止在业务层手写平台判别（必须用 `Platform` 类型收窄，替代 `#ifdef`）（铁律 #4） · 禁止配置字段跨层隐式依赖（字段归属必须显式，铁律 #3） · 本计划与 `proteus-compiler-plan`（IR 类型）、`proteus-cli-plan`（config loader + audit 规则）、`proteus-lifecycle-plan`（phase 类型）强耦合，执行前须确认三份已落地（详见 `00-overview.md` 依赖关系）

> **★实现状态（2026-08）**：✅ 核心类型分散落地 + **B3/B4/B5/B6 已落地**——shims/各包 IR/ProteusConfig TS；平台守卫（铁律 #4）；validateConfig（config:check）；@proteus/types 独立包（Platform 共享类型 + JSON Schema + generate types --check 防漂移）；**B6 超级应用加固**（品牌类型 Brand/StoreId/ModuleDomain/RouteName + 配置版本迁移 migrateConfig/CONFIG_VERSION + Schema Registry extendConfigSchema，6 用例）；**B7 待**（测试矩阵/Registry .d.ts codegen 完整化）；类型诊断经 `proteus config:check`/`generate types --check`/`module:check`/`router:check`/`capabilities:check` 可定位。

## 文档结构

```
proteus-types-plan/
├── README.md                    ← 本文件
├── 00-overview.md               ← 架构总览、5 条铁律、M1-M6 里程碑、依赖关系、验收
├── 01-m1-core-types.md          ← B1: Platform/AppPhase/各 IR/全局 Registry 推断
├── 02-m2-config-schema.md       ← B2: ProteusConfigSchema + 字段归属 + 默认值
├── 03-m3-codegen.md             ← B3: 单一来源 → .d.ts + JSON Schema + audit 规则
├── 04-m4-platform-guards.md     ← B4: assertPlatform/matchPlatform/穷尽检查
├── 05-m5-validator.md           ← B5: validateConfig + IR 守卫 + 错误码（source map）
├── 06-m6-super-app.md           ← B6: 循环检测/品牌类型/配置迁移/schema registry
├── 07-m7-testing-migration.md   ← B7: 四层测试矩阵 + codemod + CI 门禁
├── 08-relations-contracts.md    ← 与其他 9 份计划的关系 + 变更同步规则
└── 09-execution-batches.md      ← B1-B7 分批策略 + Prompt 模板 + 进度追踪
```

## 快速定位

| 你想了解 | 看哪个文件 |
|---------|-----------|
| 整体架构、依赖、铁律 | `00-overview.md` |
| Platform 类型 / Registry 推断 | `01-m1-core-types.md` |
| `proteus.config.ts` 字段 | `02-m2-config-schema.md` |
| `proteus generate types` | `03-m3-codegen.md` |
| 替代 `#ifdef` 的守卫 | `04-m4-platform-guards.md` |
| 配置/IR 校验与报错定位 | `05-m5-validator.md` |
| 千级 store 加固 | `06-m6-super-app.md` |
| 与 Compiler/CLI/各层关系 | `08-relations-contracts.md` |
| 先实现哪个批次 | `09-execution-batches.md` |

## 防上下文撑爆规则

1. 每次只实现一个模块（一个 `.md` 文件），实现前先把该文件读进上下文。
2. 实现期间如需参考其他模块，只读其**对外接口（types/函数签名）**，不读完整实现。
3. 每批完成后更新 `09-execution-batches.md` 的进度追踪表。
4. 严格遵循 `proteus-compiler-plan` 的 transform 规范（每条规则可审计、产物可追溯到源码）。
5. **禁止新增 `any` 类型**（除非经铁律 #1 豁免），所有跨端差异收敛到 capability 接口。

## 当前进度

```
[ ] B1 核心类型系统        (P0, 先行)
[ ] B2 Config Schema       (P0, 先行)
[ ] B3 Codegen 派发
[ ] B4 平台守卫
[ ] B5 校验器 + 错误定位
[ ] B6 超级应用加固 + 关系契约
[ ] B7 测试 + 迁移 + CI
```

> 状态：文档阶段完成，等待 B1 代码落地。
