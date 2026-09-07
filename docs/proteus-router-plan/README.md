# Proteus Router — 路由管理透明化

> 让 `<route>` 块成为唯一真相源，CLI 自动收敛三端路由配置，全程可追踪。

## 现状 → 目标

```
现状：每个页面手写 <route> 块，配置分散，无自动校验，三端易漂移
                          ↓
目标：<route> 就近声明 → scan + validate → 嵌套树 → 三端 codegen
                          ↓
     Web (vue-router)  ·  小程序 (pages.json + routeType)  ·  App (StackNavigator)
```

## 核心特性

- 🎯 **`<route>` 是唯一真相源** — 页面级就近声明 path / meta / transition
- 🔍 **自动扫描 + 声明合并** — CLI 收敛全局 `router` 配置，零手改三端配置
- 🌳 **嵌套路由** — path 前缀自动推导 + 显式 `parent` 覆盖，tab + 二级页
- 🎬 **转场统一** — `meta.transition` 枚举 → Web/mp/App 三端一致映射
- 📱 **三端覆盖** — Web SPA / Skyline MPA / App 栈式导航
- 🔐 **守卫 + tabBar** — `beforeEach` 可读 Pinia 登录态，`router.tabBar` 唯一来源
- 🤖 **AI-native** — `transforms/` 模块化 + `--trace-router` 产物可追溯

## 快速示例

```vue
<!-- src/pages/home/Home.vue -->
<route>
{
  "path": "/home",
  "name": "home",
  "meta": { "title": "首页", "needLogin": true, "transition": "slideUp" }
}
</route>

<template><view>...</view></template>
```

```ts
// proteus.config.ts
export default defineConfig({
  router: {
    defaults: { meta: { transition: 'slide' } },
    tabBar: { list: [{ name: 'home', text: '首页' }, { name: 'user', text: '我的' }] },
    guards: { beforeEach: (to, from, next) => { /* 登录拦截 */ } },
  }
})
```

编译后自动生成：
- `dist/.proteus/routes.generated.ts` (Web)
- `dist/mp/app.json` (含 pages + routeType)
- `dist/.proteus/navigation.generated.ts` (App)

## 文档导航

| 文件 | 内容 |
|------|------|
| `00-overview.md` | 架构总览、设计原则、里程碑 |
| `01-m1-route-parser.md` | `<route>` 块解析 + Schema |
| `02-m2-route-tree.md` | 嵌套树 + meta 合并 |
| `03-m3-web-codegen.md` | Web (vue-router) |
| `04-m4-mp-codegen.md` | 小程序 (pages.json + routeType) |
| `05-m5-app-codegen.md` | App (StackNavigator) |
| `06-m6-guards-tabbar.md` | 守卫 + tabBar + redirect |
| `07-testing.md` | 四层测试 + 跨端矩阵 |
| `08-migration.md` | 存量迁移指南 |
| `09-execution-batches.md` | 分批执行 + Prompt 模板 |
| `10-transforms-contract.md` | transforms AI 可读契约 |
| `12-m7-scale-lazy-animations.md` | 🔒 超级应用 M7：规模/懒加载/转场性能 |
| `13-m8-auth-observability.md` | 🔒 超级应用 M8：权限/可观测/CI 审计 |

🔒 = 超级应用加固，追加式，不重构 M1-M6。

## 两档定位

### 企业级（M1-M6）：路由功能完整、三端可用
`<route>` 真相源、Web/Skyline/App 三端 codegen、守卫/tabBar/redirect、四层测试。

### 超级应用（M7-M8）：规模、性能、权限、可观测
- **M7**：路由分块（chunk）+ 分包懒加载、智能预加载、层级降级、转场调度器（Worklet/手势）、导航栈管理、构建优化
- **M8**：权限树 + 路由级声明 + 动态权限、路由 trace 可观测、DevTools 调试器、错误边界、`proteus audit` CI 门禁

## 执行顺序

```
企业级：  B1 → B2 → (B3 ∥ B4 ∥ B5) → B6 → B7
超级应用：                                    ↘ B8 → B9 → B10 → B11 → B12
```

先做 M1-M6 把骨架跑通，M7-M8 按需启动（架构已预留扩展点，不用回头改）。详见 `09-execution-batches.md`。

## 与 Pinia 计划的关系

共享 `platforms/*/`、`shared/`、`transforms/` 架构；路由守卫依赖 Pinia M1-M2。
**建议先完成 Pinia M1-M6，再启动 Router（本计划）。**

## 设计原则（对齐框架总定位）

> **编译层零黑盒，平台差异显式暴露，transforms AI 可读可改，产物可追溯到源码。**
> 在 vibe coding 时代，路由编译必须是可审计的。
