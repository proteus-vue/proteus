---
'@proteus-vue/router': minor
'@proteus-vue/plugin-vite': minor
---

拆包步骤 7：create-proteus 模板重构（npm 包形态）

- 模板不再复制框架本体（src/platform|runtime|router 框架代码 + 插件），改依赖 `@proteus-vue/{router,runtime,shared,plugin-vite,compiler}` npm 包
- `@proteus-vue/router` exports 补类型子路径（`./types`/`./schema`/`./scan`/`./tree`/`./merge`）+ `./package.json`；预设源码随包发布（`src/presets`，插件内联需要）
- `@proteus-vue/plugin-vite` 插件支持 `node_modules/` 包内预设路径解析（resolvePkgPath，含 scoped 包）
- snapshot-template 改为只快照应用壳；模板应用侧自带 shims 全局类型
