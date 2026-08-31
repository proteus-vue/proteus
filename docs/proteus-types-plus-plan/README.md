# Proteus 全局类型系统与配置 Schema 落地执行文档（v2.0.0 · 含小程序官方类型整合 + 跨端 API 统一）

> **v2.0 新增**（本次）：§8-§11 小程序官方类型边界（`miniprogram-api-typings`）、WXML 组件属性自建 schema、`MpSdkVersion` 版本对齐、**B8 + B9 批次**（`mp/` 子目录 + 跨端 `PlatformAPI` 统一层）。

对齐 v2.47 Skyline + Vapor Mode · 配套 Compiler/CLI/Audit 已落地 · 本计划优先级 P0，与其他计划平行，必须先行（B1-B2）后才可进入 testing/devtools/build-pipeline · 全部类型与 schema 对齐 `--trace-transform`/`--trace-lifecycle`/`proteus audit` 可审计 · 所有模块文件独立可喂 LLM，禁止单次全量塞入上下文 · 禁止依赖本计划未定义的外部类型（禁止裸 `any` 跨层泄漏）。

**关键原则**：小程序端 `wx.*` / `App`/`Page`/`Component` 参数 → **直接复用官方 `miniprogram-api-typings`**（命名空间 `WechatMiniprogram`），Proteus 不自造；仅 WXML 标签属性类型官方不覆盖，由 Compiler 自建 `MpComponentSchema`。第三方类型优先复用，禁止重复造轮子（铁律 #6）。

## 文档结构

```
proteus-types-plan/
├── README.md                         ← 本文件
├── 00-overview.md                    ← 架构总览、6 条铁律、M1-M9 里程碑、依赖关系、验收
├── 01-m1-core-types.md               ← B1: Platform/AppPhase/各 IR/Registry
│                                      + §8 官方类型来源（miniprogram-api-typings）
│                                      + §9 WXML 组件 schema + §10 版本锁定 + §11 接口
├── 02-m2-config-schema.md            ← B2: ProteusConfigSchema + 字段归属 + 默认值
├── 03-m3-codegen.md                  ← B3: 单一来源 → .d.ts + JSON Schema + audit 规则
├── 04-m4-platform-guards.md          ← B4: assertPlatform/matchPlatform/穷尽检查
├── 05-m5-validator.md                ← B5: validateConfig + IR 守卫 + 错误码（source map）
├── 06-m6-super-app.md                ← B6: 循环检测/品牌类型/配置迁移/schema registry
├── 07-m7-testing-migration.md        ← B7: 四层测试矩阵 + codemod + CI 门禁
├── 08-relations-contracts.md         ← 与其他计划的接口关系 + 变更同步规则
├── 09-execution-batches.md           ← B1-B9 分批策略 + Prompt 模板 + 进度追踪
└── 10-m9-platform-api.md             ← B9: 跨端 PlatformAPI 统一层（request/storage/router/ui）
```

> 相比 v1.0（10 文件 / B1-B7），v2.0 新增：`01` 的 §8-§11、`10-m9-platform-api.md`、`09` 扩展至 B1-B9。

## 快速定位

| 你想了解 | 看哪个文件 |
|---------|-----------|
| 整体架构、依赖、铁律 | `00-overview.md` |
| Platform 类型 / Registry 推断 | `01-m1-core-types.md` |
| **小程序官方类型怎么来** | `01-m1-core-types.md` **§8** |
| **WXML 属性类型（官方不管的部分）** | `01-m1-core-types.md` **§9** |
| **基础库版本对齐** | `01-m1-core-types.md` **§10** |
| `proteus.config.ts` 字段 | `02-m2-config-schema.md` |
| `proteus generate types` | `03-m3-codegen.md` |
| 替代 `#ifdef` 的守卫 | `04-m4-platform-guards.md` |
| 配置/IR 校验与报错定位 | `05-m5-validator.md` |
| 千级 store 加固 | `06-m6-super-app.md` |
| 与 Compiler/CLI/各层关系 | `08-relations-contracts.md` |
| **跨端 API 统一层** | `10-m9-platform-api.md` |
| 先实现哪个批次 | `09-execution-batches.md` |

## 防上下文撑爆规则

1. 每次只实现一个模块（一个 `.md` 文件），实现前先把该文件读进上下文。
2. 实现期间如需参考其他模块，只读其**对外接口（types/函数签名）**，不读完整实现。
3. 每批完成后更新 `09-execution-batches.md` 的进度追踪表。
4. 严格遵循 `proteus-compiler-plan` 的 transform 规范（每条规则可审计、产物可追溯到源码）。
5. **禁止新增 `any` 类型**（除非经铁律豁免），所有跨端差异收敛到 capability 接口 / `PlatformAPI`。
6. **第三方类型优先复用**：能用 `miniprogram-api-typings` 的地方不许自建（铁律 #6）。

## 当前进度

```
[x] B1 核心类型系统        (P0, 先行)
[x] B2 Config Schema       (P0, 先行)
[x] B3 Codegen 派发
[x] B4 平台守卫
[x] B5 校验器 + 错误定位
[x] B6 超级应用加固 + 关系契约
[x] B7 测试 + 迁移 + CI
[x] B8 小程序官方类型整合  (2026-08-31 落地；★shims 替换为后续批次)
[x] B9 跨端 API 统一层    (2026-08-31 落地；运行时实现归 @proteus-vue/api)
```

> B1-B7 由 types-plan（决策 #274/#276 类型收口）落地；**B8 落地**：`packages/types/src/mp/`（component-schema 注册表 + sdk-version 对齐 + official-typings 官方类型桥，`@proteus-vue/types/mp` 子路径）+ 8 单测；**B9 落地**：`packages/types/src/platform-api.ts`（PlatformAPI 统一契约 + `@proteus-vue/types/platform-api` 子路径 + @proteus-vue/api re-export）+ 类型断言；遗留：shims `wx: any` 替换（独立批次）、`MpSdkVersion` 维护表补录。
