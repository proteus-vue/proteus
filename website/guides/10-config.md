---
title: 全局配置与页面配置
order: 10
group: 代码构成
---

# 全局配置与页面配置

Proteus 的配置分两层：**全局配置**（`proteus.config.ts`，管整个工程）与**页面配置**（页面 `<route>` 块，管单个页面）。两层都在**编译期**读取——改完全局配置需重新 `npm run build:mp`。

## 全局配置：proteus.config.ts

| 配置项 | 作用 |
|---|---|
| `appid` | 小程序 AppID（模板默认占位 `wx0000000000`，使用前必须替换） |
| `skyline` | Skyline 渲染相关开关（`app.json` 的 `lazyCodeLoading` 等由 gen-routes 自动生成） |
| `pagesDir` | 页面目录（默认 `src/pages`），路由扫描的根 |
| `rules` | 编译规则覆盖（disabled / mapping / customTags，详见 `npx proteus rules`） |
| `setDataBridge` | 小程序端 setData 合并策略 |
| `style` | 样式转换（px→rpx 等） |

## 页面配置：`<route>` 块

每个页面用 `<route>` 自定义块就近声明元信息，`gen-routes` 在编译期读取：

```vue
<!-- src/pages/user/profile.vue -->
<route>
{
  "name": "user-profile",
  "meta": { "title": "个人资料", "requiresAuth": true, "transition": "slideUp" }
}
</route>
```

`meta` 常用字段：`title`（导航栏标题）、`isTab`（tab 页）、`requiresAuth`（登录守卫）、`permissions`（权限守卫）、`transition`（转场动画）。

## 省略也合法

`<route>` 块完全可选——`path` / `name` 从文件位置推导（`pages/user/profile.vue` → path `pages/user/profile`、name `user-profile`；`index.vue` 归并为目录路径），无块页面也收录，meta 由配置集中注入。**显式声明永远优先。**

## 下一步

- [路由与导航](/docs/16-router)：路由树与双端 codegen 的完整模型
- [CLI 与工程命令](/docs/28-cli)：`proteus` 命令行全家桶
