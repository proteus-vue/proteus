---
'@proteus-vue/cli': patch
'@proteus-vue/create-proteus': patch
'@proteus-vue/plugin-vite': patch
---

自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

- `@proteus-vue/cli`
- `@proteus-vue/create-proteus`
- `@proteus-vue/plugin-vite`
