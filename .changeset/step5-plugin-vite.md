---
'@proteus-vue/plugin-vite': minor
---

拆包步骤 5：Vite 插件 + gen-routes 归 @proteus-vue/plugin-vite

- `mpTransform` 插件 config 解耦：`PluginOptions.config` 由 vite.config 注入（不再 import 项目 config）
- `ProteusConfig` 类型契约迁入包内 `config.ts`
- gen-routes 双形态：纯函数 `runGenRoutes({ config, root })` + CLI 入口 `cli.ts`
- appSkeleton（构建期 app.js 骨架模板）从 runtime 迁入 plugin-vite
- 内置预设 builders 路径随 router 拆包同步（packages/router/src/presets）
