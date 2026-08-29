---
'@proteus/plugin-vite': patch
'@proteus/router': patch
'@proteus/runtime': patch
'@proteus/shared': patch
---

拆包步骤 6：别名与引用面全量切换

- vite alias / tsconfig paths 全量精确映射 `@proteus/{router,runtime,shared,compiler,plugin-vite,components}`，删除泛化 `@proteus` → `src/`（防误匹配）
- 新增 `@proteus/components` 精确别名（框架内置组件暂留 `src/components`，组件库 v2.0 方向）
- create-proteus 模板 alias 同步精确化（vendored 结构）
