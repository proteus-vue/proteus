---
title: `<route>` 配置参考
order: 10
group: 编译期
---

# `<route>` 配置参考

页面级配置的唯一入口。`gen-routes` 编译期读取，双端产物自动生成。**显式声明永远优先于推导。**

## 完整结构

```vue
<route>
{
  "name": "user-profile",
  "path": "pages/user/profile",
  "parent": "pages/user",
  "meta": {
    "title": "个人资料",
    "isTab": true,
    "requiresAuth": true,
    "permissions": ["order:read"],
    "transition": "slideUp"
  }
}
</route>
```

## meta 字段全集

契约定义于 `@proteus-vue/contracts`（`RouteMeta`）：

| 字段 | 类型 | 产物 |
|---|---|---|
| `title` | string | MP 导航栏标题 / Web 页面标题 |
| `isTab` | boolean | tab 页（收进 tabBar 声明） |
| `requiresAuth` | boolean | 登录守卫（createRouter auth 检查器） |
| `permissions` | string[] | 权限守卫（`resource:action`，permissions 检查器） |
| `transition` | `'slideUp' \| 'slideDown' \| 'halfScreen' \| 'scaleDown' \| 'none'` | MP `routeType` 转场（Skyline 自定义路由） |
| 任意扩展 | JSON 可序列化 | 保留在 meta（集中式配置合并产物） |

## 顶层字段

| 字段 | 说明 |
|---|---|
| `name` | 命名路由（kebab-case）；省略时从文件位置推导 |
| `path` | 页面路径；省略时从目录推导（`pages/user/profile.vue` → `pages/user/profile`） |
| `parent` | 显式嵌套父级（默认按 path 前缀推导；Skyline MPA 下嵌套降级平铺 + `meta.__parent` 保留父链） |
| `meta` | 上表元信息 |

## 路由记录（生成物）

每条 `RouteRecord`（生成物，勿手改）含 `name` / `path` / `component` / `parent` / `meta` / `subPackage`（主包 undefined）/ `customRouteKeyName` / `params`（路由参数类型声明）。

## 分包

`proteus.config.ts` 声明 `subPackages`（name + root），各分包**独立扫描 + 树推导，跨分包不嵌套**；分包依赖（dependencies）与 `preloadRule` 按 chunk 与 name/root 基名匹配自动生成。

## 下一步

- [编译规则与决策链](/docs/framework/compile-rules)
