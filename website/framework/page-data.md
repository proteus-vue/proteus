---
title: 页面间数据传递
order: 35
group: 数据与状态
---

# 页面间数据传递

页面间传数据有三条路径，按「数据生命周期」选择：

## 1. 导航参数（query / params）——一次性传值

```ts
const router = createRouter(routes, { ... })

// 命名路由 + 类型安全：params 类型由 RouteParamsByName 自动匹配
await router.push({ name: 'user-profile', query: { id: '7' } })

// path + query（自动 encode，params 与 query 合并拼接）
await router.push({ path: 'pages/cart', query: { id: '7' } })
router.back()
```

- query 经 `buildUrl` 拼接为 query string（自动 encode）
- Router Inspector / 面板 route 视图显示带参导航（`?id=1`）——导航可观测

## 2. 跨页共享状态——Pinia store

需要跨页存活的数据（登录态、购物车）走 store：`stores/player.ts` 同一份 `.ts` 四端共用（见[状态管理四端工厂](/docs/framework/state-factories)）。

## 3. 页面栈关系——页面间通信

小程序的页面栈天然存在「上一页 → 下一页」关系。Proteus 编译期保留父链（Skyline MPA 平铺 + `meta.__parent`），运行时通过事件与 store 组合传数据；作用域插槽类「子传父数据」场景用 props 接收 + `triggerEvent` 回传替代（平台限制，编译器会给出替代模式提示）。

## 选择判据

| 数据 | 传法 |
|---|---|
| 目标页一次性展示（id、来源） | 导航 query |
| 多页共享、需响应式 | Pinia store |
| 页面栈返回值 | 事件回传 + store 中转 |

## 下一步

- [跨端状态协同](/docs/framework/state-sync)
