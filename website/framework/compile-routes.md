---
title: 路由生成
order: 8
group: 编译期
---

# 路由生成

跨端路由的麻烦：Web 是 SPA 路由表（history），小程序是页面栈（`app.json` pages + tabBar）——两套心智、两份配置。`gen-routes` 的答案是**编译期页面表**：页面 `<route>` 块是唯一真相源，扫描收敛成一棵路由树，再分别生成双端配置。

## 管线

```
<route> 就近声明 → scan + validate → 嵌套树 → 双端 codegen
```

- **扫描**：CLI 递归扫描 `pagesDir`，`<route>` 块复用 `@vue/compiler-sfc` 解析（天然拿到文件与行号）
- **校验**：schema 校验、path 查重、嵌套解析（path 前缀自动推导 + 显式 `parent` 覆盖）
- **产物**（每条记录含 `loc`，可反查源码）：

| 端 | 形态 | 产物 |
|---|---|---|
| Web | SPA 路由表 | vue-router `RouteRecordRaw` 代码（lazy → `() => import()` 代码分割，嵌套 → children 递归） |
| 小程序 | 页面栈 | `app.json` 页配置（Skyline 是 MPA：嵌套降级平铺 + `meta.__parent` 保留父链；`meta.transition` → `routeType`） |

## 零样板

`<route>` 块完全可选：`path` / `name` 从文件位置推导（`pages/user/profile.vue` → path `pages/user/profile`、name `user-profile`；`index.vue` 归并为目录路径），无块页面也收录，meta 由配置集中注入。

## Skyline 字段自动生成

Skyline 所需字段无需手配：`app.json` 的 `lazyCodeLoading`、各页 `page.json` 的 `"renderer": "skyline"` 均由 gen-routes 自动生成。

## 下一步

- [路由与导航](/docs/16-router)：运行时 `createRouter` 与守卫
- [编译规则与决策链](/docs/framework/compile-rules)
