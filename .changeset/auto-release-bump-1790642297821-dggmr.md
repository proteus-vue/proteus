---
'@proteus-vue/agent': patch
'@proteus-vue/api': patch
'@proteus-vue/built-in-components': patch
'@proteus-vue/capabilities': patch
'@proteus-vue/compiler-backend': patch
'@proteus-vue/compiler-backend-rust': patch
'@proteus-vue/component-ir': patch
'@proteus-vue/components': patch
'@proteus-vue/devtools': patch
'@proteus-vue/fluid': patch
'@proteus-vue/mcp': patch
'@proteus-vue/render-backend': patch
'@proteus-vue/renderer-app': patch
'@proteus-vue/shared': patch
'@proteus-vue/web': patch
'@proteus-vue/worklet': patch
---

自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

- `@proteus-vue/agent`
- `@proteus-vue/api`
- `@proteus-vue/built-in-components`
- `@proteus-vue/capabilities`
- `@proteus-vue/compiler-backend`
- `@proteus-vue/compiler-backend-rust`
- `@proteus-vue/component-ir`
- `@proteus-vue/components`
- `@proteus-vue/devtools`
- `@proteus-vue/fluid`
- `@proteus-vue/mcp`
- `@proteus-vue/render-backend`
- `@proteus-vue/renderer-app`
- `@proteus-vue/shared`
- `@proteus-vue/web`
- `@proteus-vue/worklet`
