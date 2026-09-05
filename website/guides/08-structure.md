---
title: 目录结构
order: 8
group: 代码构成
---

# 目录结构

脚手架生成的工程长这样，每个路径的职责：

| 路径 | 作用 |
|---|---|
| `proteus.config.ts` | 框架统一配置：appid / skyline / pagesDir / rules 规则覆盖 / setDataBridge / style（px→rpx）；编译期读取，改完需重新 `npm run build:mp` |
| `vite.config.ts` | 双端 Vite 配置：Web 端走 `@vitejs/plugin-vue`，小程序端走 `mpTransform` 编译管线 |
| `scripts/gen-routes.ts` | 递归扫描 `pagesDir`，按目录结构推导路由，生成 `app.json` / `page.json` / 路由表 |
| `scripts/mp-entry-stub.ts` | 小程序构建的 rollup 占位入口（真实 `app.js` 由插件直出） |
| `src/main.ts` | Web 入口 |
| `src/main.mp.ts` | 小程序极简入口：不写 `App()`，app 骨架由框架自动生成 |
| `src/pages/` | 页面目录（`pagesDir`），每个 `.vue` 即一个页面 |
| `src/router/` | RouterView / 路由实例 / `auto-routes.ts`（编译期生成，勿手动编辑） |
| `src/shims/` | wx / 事件 / Vue 类型声明 |
| `.github/workflows/proteus.yml` | CI 模板（双端构建） |

## 三个关键约定

1. **页面即文件**：`src/pages/` 下每个 `.vue` 就是一个页面，路径由目录结构推导（详见[路由与导航](/docs/16-router)）
2. **配置分两层**：全局配置在 `proteus.config.ts`，页面配置在各页面的 `<route>` 块（详见[全局配置与页面配置](/docs/10-config)）
3. **生成物勿手改**：`src/router/auto-routes.ts`、`app.json` 等由编译期生成，重新构建即刷新

## 下一步

- [页面构成](/docs/09-page-anatomy)：一个页面的 SFC 里有什么
