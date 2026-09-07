# @proteus-vue/plugin-vite

Proteus Vite 插件（mp-weixin 编译管线适配层）+ `gen-routes` 路由表生成器。Web 端零转换直跑（标准 Vue SPA），小程序端经编译管线适配直出微信产物。

## 导出

| API | 说明 |
|-----|------|
| `mpTransform(options?)` | **Vite 插件**：mp-weixin 编译管线适配层（SFC 编译 / WXML 直出 / app.json 拼装 / 分包）——框架内部消费 |
| `defaultScopedPlugin` | Web 端默认 scoped 改写（`scoped` 样式编译对齐） |
| `runGenRoutes(options)` | **路由表生成器**：扫描 `<route>` 块 / router 目录 → 生成 `auto-routes`（供 `createRouter` 注入）+ 小程序 `app.json` 路由段 |
| `ProteusConfig` / `PluginOptions` | 配置类型（与 `@proteus-vue/types` schema 对齐） |

## 使用（vite.config.ts）

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { mpTransform, runGenRoutes } from '@proteus-vue/plugin-vite'

export default defineConfig({
  plugins: [
    vue(),
    // Web 端：默认 scoped 语义对齐
    mpTransform({ platform: 'web' }),
    // 小程序端：直出 mp-weixin 产物
    mpTransform({ platform: 'mp-weixin' }),
  ],
})

// 路由表生成（独立命令 / 构建前钩子）
await runGenRoutes({ root: process.cwd(), outDir: 'src/router/auto-routes.ts' })
```

## 设计要点

- **双端同一套 Vite 配置**：`platform` 决定编译管线分支，业务代码零改动
- **gen-routes 为收口**：页面路由表由生成器产出并注入 `createRouter`，避免手写路由表与页面清单漂移（对齐 docs/proteus-router-plan M2）
