---
'@proteus-vue/plugin-vite': patch
'@proteus-vue/router': patch
'@proteus-vue/runtime': patch
'@proteus-vue/shared': patch
---

拆包步骤 6：别名与引用面全量切换

- vite alias / tsconfig paths 全量精确映射 `@proteus-vue/{router,runtime,shared,compiler,plugin-vite,components}`，删除泛化 `@proteus-vue` → `src/`（防误匹配）
- 新增 `@proteus-vue/components` 精确别名（框架内置组件暂留 `src/components`，组件库 v2.0 方向）
- create-proteus 模板 alias 同步精确化（vendored 结构）
