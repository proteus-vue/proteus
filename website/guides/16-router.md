---
title: 路由
order: 16
group: 基础概念
---

# 路由

跨端路由的麻烦在于：Web 是 SPA 路由表（history），小程序是页面栈（`app.json` pages + tabBar）——两套心智、两份配置，改一个页面要动多处。Proteus 路由（`@proteus-vue/router`）的答案是**编译期页面表 + 按端 codegen**：页面 `<route>` 块是唯一真相源，扫描收敛成一棵路由树，再为每个目标端生成各自形态——当前已接线 Web（路由表）与小程序（页面配置）；iOS / Android / 鸿蒙 / Flutter 消费同一棵树的端语义（渲染层按后端实现，见[渲染后端](/docs/framework/23-render-backend)）。

> **`<route>` 就近声明 → scan + validate → 嵌套树 → 按端 codegen（Web / 小程序已接线，其余端同树语义）。**
> 配置零手写、各端不漂移、产物可反查源码（每条记录含 `loc`）。

## 路由模型：一棵树，两种形态

编译期：CLI 扫描页面文件中的 `<route>` 块（复用 `@vue/compiler-sfc` 解析，天然拿到文件与行号），校验 schema、查重、解析嵌套（path 前缀自动推导 + 显式 `parent` 覆盖），产出 `RouteNode[]`。之后按端分发：

| 端 | 形态 | 产物 |
|---|---|---|
| Web | SPA 路由表 | `generateWebRoutes(nodes)` → vue-router `RouteRecordRaw` 代码（lazy → `() => import()` 代码分割，嵌套 → children 递归） |
| 小程序 | 页面栈 | `generateMpConfig(nodes)` → `app.json` 页配置（Skyline 是 MPA：嵌套降级平铺 + `meta.__parent` 保留父链；`meta.transition` → `routeType`） |

> 原生/Flutter 端不生成 `RouteRecordRaw` / `app.json`——由各渲染后端对同一棵路由树做端适配（导航语义/转场映射，见[渲染后端](/docs/framework/23-render-backend)与[路由的端适配](/docs/framework/33-containers-hosts)）。

页面声明走**零样板**路线：`<route>` 块完全可选——`path` / `name` 可从文件位置推导（`pages/user/profile.vue` → path `pages/user/profile`、name `user-profile`；`index.vue` 归并为目录路径），无块页面也收录，meta 由配置集中注入；显式声明永远优先：

```vue
<!-- src/pages/user/profile.vue -->
<route>
{
  "name": "user-profile",
  "meta": { "title": "个人资料", "requiresAuth": true, "transition": "slideUp" }
}
</route>

<template><p-text>个人资料</p-text></template>
```

`RouteRecord` 由跨层契约包 `@proteus-vue/contracts` 收口（`name` / `path` / `component` / `parent` / `meta` / `subPackage` / `params`），`meta` 支持 `requiresAuth`、`permissions`、`title`、`isTab`、`transition` 等字段。

## 运行时：createRouter

路由表由调用方注入（工厂化，无全局单例——可测试、可多实例/微前端）：

```ts
import { createRouter } from '@proteus-vue/router'
import routes from './router/auto-routes' // 编译期 gen-routes 生成

const router = createRouter(routes, {
  auth: () => Boolean(getToken()),            // requiresAuth 自动守卫的检查器
  permissions: registry,                      // meta.permissions 的 hasAll 检查器
  onAuthFail: () => router.push({ name: 'login' }),
})

// 命名路由 + 类型安全：params 类型由 RouteParamsByName 模块扩充自动匹配
await router.push({ name: 'user-profile' })
await router.push({ path: 'pages/cart', query: { id: '7' } })
router.back()
```

| API | 说明 |
|---|---|
| `createRouter(routes, options?)` | 路由工厂；`options.auth` / `permissions` / `traceBus` 可选注入 |
| `router.push(options)` | 命名/路径跳转；`replace` / `reLaunch` / `switchTab` / `routeType` 选项 |
| `router.back(delta?)` | 后退（默认 1） |
| `router.beforeEach(guard)` / `afterEach(guard)` | 用户守卫（三端一致；返回 false 取消导航） |
| `router.stackDepth` | 页面栈深度（MP 真实栈深；Web 恒为 1） |

导航链路的守卫顺序是固定的：`requiresAuth` 自动守卫（读 `options.auth`）→ `permissions` 自动守卫（读 `options.permissions.hasAll`）→ 用户 `beforeEach`。平台细节被 adapter 吃掉：小程序端栈深 ≥ 9 自动降级 `redirectTo`（10 层硬边界），Skyline 自定义路由转场由 `isSkyline()` 探测分支接管；`traceBus` 注入后每次导航发射 start / point / end 事件（DevTools route 回溯，生产零开销）。

## 转场与导航语义

转场是**声明式枚举**（`RouteTransition`）：`slideUp` / `slideDown` / `halfScreen` / `scaleDown` / `none`——`WEB_TRANSITION_MAP` 与 `MP_ROUTE_TYPE_MAP` 两张共享映射表分别翻译成 Web CSS 转场名与 Skyline `routeType`，双端动效一致而不必写两份：

```ts
import { webTransitionName, mpRouteType } from '@proteus-vue/router'

webTransitionName('slideUp') // Web 端 CSS 转场名
mpRouteType('halfScreen')    // Skyline 自定义路由 routeType
```

在此之上，导航栈语义层（G-32 M1）提供 `NAVIGATION_MAP`（导航语义 → 各端原生 API）与 `computeRoutePatch` / `applyRoutePatch`（页面栈 diff——转场事务的输入）；深链（B11）覆盖 URL 解析、白名单校验与冷启动多级栈构建：

```ts
import {
  parseDeepLinkUrl,
  isDeepLinkAllowed,
  resolveDeepLink,
  buildColdStartStack,
} from '@proteus-vue/router'
import type { DeepLinkConfig } from '@proteus-vue/router'

// scheme + host 白名单 + pattern → 路由映射（defineProteus router.deepLink 配置）
const config: DeepLinkConfig = {
  scheme: 'deeplink',
  routes: [{ pattern: '/user/:id', path: 'pages/user/profile', stack: 'push' }],
}

if (isDeepLinkAllowed(parseDeepLinkUrl('deeplink://app/user/7'), config)) {
  const target = resolveDeepLink('deeplink://app/user/7', config) // → { path, params, stack }
  if (target) {
    // allPaths = 应用路由表全部 path——冷启动栈取目标路由的祖先链
    const stack = buildColdStartStack('/' + target.path, allPaths) // ['/pages', '/pages/user', …]
  }
}
```

## 诚实边界：官网现状

本官网自身**当前用 vue-router 承载**——`website/src/router.ts` 的头注如实写道：`@proteus-vue/router` 的路由模型面向「编译期页面表 + 按端 codegen（已接线 Web / 小程序）」（gen-routes 页面路由 / 小程序页面栈），而官网是纯 Web SPA + 动态文档段（`/docs/:slug`），这批页面用 vue-router 过渡。这个差距是刻意公开的 dogfooding 信号：官网没有把自家路由包装成已经全量落地，替换工作已登记评估（W-1 可审计缺口）——与「写官网回填 Router plan」的预期一致。路由框架本身的端能力是真实落地的：scan / tree / codegen / 守卫 / 转场映射均有测试覆盖，小程序侧由编译期产物（`app.json` + 页面栈）承载。

## 下一步

- [容器与宿主](/docs/framework/33-containers-hosts)：页面栈与容器形态的关系
- [测试与部署](/docs/27-testing-deploy)：路由表与双端产物的验证
- [编译管线](/docs/framework/26-compiler-pipeline)：`<route>` 块在编译期如何被消费
