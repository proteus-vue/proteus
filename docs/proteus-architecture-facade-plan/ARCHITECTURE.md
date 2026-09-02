# Proteus Architecture（一页全景）

> 全局缝合规约的**可视化总纲**。18 份原始 plan + 10 份新增 plan + 1 规约层的关系、依赖、执行序一页看清。
> Scope：`@proteus-vue/*`（npm org 已被占，统一用此 scope，对齐 GitHub org `proteus-vue`）。
> 校验：`node scripts/check-consistency.js` ✅

---

## 1. 分层（L0 地基 → L5 门面）

```
L5 门面    : Website              （框架官网，dogfooding）
L4 验证    : Blueprint            （150 页超级应用验证）
L3 工具    : Test Framework       （Vitest + automator + Playwright）
L2 横切    : Security · i18n      （加密/权限/国际化）
L1 运行时  : Pinia · Router · API · Component · Platform · Lifecycle · Module
L0 基建    : Compiler · CLI · Types · Testing · DevTools · Build
            └─ Architecture（本文件，规约层，不生成产物）
```

**依赖方向单向**：L(n) 只能依赖 L(<n)。`types` 不得 import 任何业务层（pure type）；`contracts.ts` 只聚合、不含逻辑。

---

## 2. monorepo `packages/*` 结构

```
proteus-monorepo/
├── packages/
│   ├── types/          ← @proteus-vue/types        (L0, 全局 Registry + Platform 判别联合)
│   ├── compiler/       ← @proteus-vue/compiler     (L0, SFC → IR → 四件套)
│   ├── css-compat/     ← @proteus-vue/css-compat   (L0, CSS 跨端兼容校验/重写/报告, G-21)
│   ├── cli/            ← @proteus-vue/cli          (L0, 命令面)
│   ├── testing/        ← @proteus-vue/testing      (L0, 测试金字塔基建)
│   ├── devtools/       ← @proteus-vue/devtools     (L0, TraceBus + 六源汇聚)
│   ├── build/          ← @proteus-vue/build        (L0, Vite 插件 + CI/CD)
│   ├── pinia/          ← @proteus-vue/pinia        (L1, 状态 + M7 分片)
│   ├── router/         ← @proteus-vue/router       (L1, 路由 + chunk 分包)
│   ├── api/            ← @proteus-vue/api          (L1, 端点注册 + 拦截器)
│   ├── component/      ← @proteus-vue/component    (L1, p-* + WXML schema)
│   ├── built-in-components/ ← @proteus-vue/built-in-components (L1, 微信内置组件为基准，决策 #162)
│   ├── contracts/      ← @proteus-vue/contracts     (L0, 跨层共享 DTO，types-plan §07)
│   ├── platform/       ← @proteus-vue/platform     (L1, 端能力 + typings 整合)
│   ├── lifecycle/      ← @proteus-vue/lifecycle    (L1, 生命周期编排)
│   ├── module/         ← @proteus-vue/module       (L1, 模块化 + 循环检测)
│   ├── security/       ← @proteus-vue/security     (L2, 加密/凭证/权限)
│   ├── i18n/           ← @proteus-vue/i18n         (L2, ICU + 分包 + RTL)
│   ├── test-framework/ ← @proteus-vue/test-framework(L3, E2E + 编译快照)
│   └── blueprint/      ← @proteus-vue/blueprint    (L4, 验证样板)
├── apps/
│   └── website/        ← @proteus-vue/website      (L5, 官网)
├── scripts/
│   ├── check-consistency.js   ← 跨层一致性 CI
│   └── pack-*.sh              ← 各 plan 打包
└── docs/                       ← 19 份落地文档（本仓库即 docs 源）
```

每个 `packages/*` 对应一份落地文档；包名 = 文档里的 scope，做到**文档与代码 1:1**。

---

## 3. 依赖图（箭头 = 依赖）

```
Compiler ──▶ Types ◀── CLI
              ▲
   ┌──────────┼──────────┐
   ▼          ▼          ▼
 Pinia     Router      API ──▶ Component ──▶ Platform
                                            ▲
   ┌────────────────────────────────────────┘
   ▼
 Lifecycle ──▶ Module ──▶ Security / i18n
                             ▲
                             └── Build / DevTools / Testing / Blueprint / Website / TestFramework
```

`Types` 是所有层的地基；`Build` 是总汇合点（依赖所有层，最后落地）。

---

## 4. 全局执行序（G-01 ~ G-40）

LLM 按 **G 序号**推进，同 G 内可并行。批次号跨 plan 统一为 G，避免 B1-Bn 冲突。

| G | 内容 | 对应层 | 落地文档 |
|---|------|--------|---------|
| G-01 | Types 地基（Registry + Platform + contracts） | L0 | types-plan B1 / types-plus B1-B2 |
| G-02 | Compiler（parser/IR/后端） | L0 | compiler-plan B1-B3 |
| G-03 | Platform + 官方 typings 整合 | L1 | platform-plan B1 + types B8 |
| G-04 | Pinia / Router / API（运行时三联） | L1 | pinia/router/api |
| G-05 | Lifecycle / Module | L1 | lifecycle / module |
| G-06 | Component（p-* + WXML schema） | L1 | component-plan |
| G-07 | CLI / Testing 基建（含 test-framework） | L0 | cli / testing / test-framework |
| G-08 | DevTools（TraceBus + 六源） | L0 | devtools-plan |
| G-09 | Security / i18n | L2 | security / i18n |
| G-10 | Compiler 优化 + Types 加固 | L0/L1 | compiler B4-B6 + types B4-B7 |
| G-11 | Build B1-B5（Vite 插件 + 多入口 + 分包） | L0 | build-plan B1-B5 |
| G-12 | Router 强类型钩子 + module B5 + api A1-A4 | L1 | router M7.1/M8.4 + module B5 |
| G-13 | DevTools 面板 + Build 缓存 | L0 | devtools B2-B9 + build B6-B8 |
| G-14 | Security 权限树 + i18n RTL/Audit | L2 | security B2-B8 + i18n B2-B7 |
| G-15 | 体积预算 + 快照 + 契约门禁 | L0 | build B9-B10 + testing 全量 |
| G-16 | Blueprint 骨架 + 核心 30 页 | L4 | blueprint B1-B5 |
| G-17 | Blueprint 150 页全量 | L4 | blueprint B6-B10 |
| G-18 | Website 文档站 + Playground | L5 | website B1-B5 |
| G-19 | Website + test-framework E2E | L5 | website B6-B8 + test-framework |
| G-20 | 全量回归 + CrossLayerChecker + changeset 发布 | 发布 | **v1.0** |
| G-21 | CSS 跨端兼容（矩阵 + --strict-css） | L1 横切 | css-compat |
| G-22 | App Renderer（Custom Renderer + JSI） | App 层 | app-renderer |
| G-23 | Safe Area + 灵动岛 | App 层 | safe-area |
| G-24 | 内存四层治理 + Owner 模型 | L1 横切 | memory-plan |
| G-25 | 纪念日一键置灰 | L2 横切 | memorial-skeleton |
| G-26 | 骨架屏自动生成（与 IFR 同源） | L1 基建 | memorial-skeleton |
| G-27 | 主题 + 字体缩放 | L2 横切 | app-capabilities |
| G-28 | 缓存分层 | L2 横切 | app-capabilities |
| G-29 | Glass 液态玻璃（L1-L3 + 降级） | L2 横切 | glass |
| G-30 | 性能深度优化（AOT/IFR/Worklet） | L0 基建 | performance |
| G-31 | Style Runtime Safety（白名单 + Validator + 编译期推导 + 五端闸门） | L1 横切 | style-safety |
| G-32 | 严格路由（配置校验 + 导航映射 + 转场事务 + deep link） | L1 | router-plus |
| G-33 | 严格 CLI（编译管线 + dev server + strict 门禁） | L0 | cli-plus |
| G-34 | HMR + DevTools 协议 + Style Safety 可视化 | L0 | devtools-plus |
| G-35 | 应用全局配置（运行时配置 + 远端更新 + 五端存储） | L2 横切 | app-config |
| G-36 | AI Agent 接入（MCP Server + Agent Kit + 4 Skill + Guardrails） | L3 能力 | ai-agent |
| G-37 | RenderBackend SPI 规范（G-27 执行契约 + Conformance 42 + 双参考实现） | L1 方法论 | render-backend-spi |
| G-38 | CompilerBackend SPI 规范（G-29 执行契约，与 G-37 同形设计） | L1 方法论 | compiler-backend-spi |
| G-39 | Host Runtime SPI（L0-L4 五层唯一拥有者 + Conformance 42） | L1 方法论 | host-runtime |
| G-40 | Execution Carrier SPI（G-39 执行层：JSI/AOT 双载体 + 批处理差分 + 零拷贝 + 实时逃逸） | L1 方法论 | execution-carrier |

**关键路径**：G-01 → G-02 → G-03 → G-04 → G-07 → G-08 → G-10 → G-16/G-17 → G-18 → G-20；新增能力（G-21~G-40）各按其依赖插入，不阻塞原始主链。
**并行空间**：G-04 内三联可并行；G-09 两横切可并行；G-16/G-17 双端可并行；G-21/G-24/G-25/G-27 的 M1 纯逻辑批次可与 G-01 地基同期启动。

---

## 5. 铁律（9 条，CI 强制）

1. 单一事实源（全局 Registry）
2. Platform 判别联合（无 `any`）
3. 端能力静态可分析
4. 渐进式适配
5. 源码即文档（Zod + 示例）
6. 第三方类型复用（`miniprogram-api-typings`，不重复造）
7. 向后兼容（major 版本化 + deprecation）
8. 分层锁定（import 方向单向）
9. 跨层一致性（同名必同义，契约先行）

违规 → `check-consistency.js` 报错 → CI 红 → PR 阻断。

---

## 6. 验收（v1.0 发布门槛）

- [x] scope 全统一为 `@proteus-vue/*`，`grep "@proteus/"` = 0
- [x] `check-consistency.js` 全绿
- [ ] 地基三联跑通：Compiler B1 + Types B1 + TestFramework B1
- [ ] Blueprint 150 页三端 build 通过、体积/耗时/审计全绿
- [ ] `proteus audit all` 全量 < 12s、零违规
- [ ] Website 上线 + Playground 实时 transform 可演示

---

## 7. 文档清单（29 plan + 1 规约 + 1 原则补充）

```
运行时 (7): pinia · router · api · component · platform · lifecycle · module
基建   (6): compiler · cli · types(v2.1) · testing · devtools · build
横切   (2): security · i18n
验证   (1): blueprint
门面   (1): website
工具   (1): test-framework
新增  (10): css-compat · app-renderer · safe-area · memory-plan
              memorial-skeleton · app-capabilities · types-plus(v2.0) · glass
              performance · design-principle(原则补充)
规约   (1): architecture  ← 本文件所在层
```
