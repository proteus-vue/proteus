---
'@proteus-vue/shared': patch
'@proteus-vue/app-config': patch
'@proteus-vue/devtools-runtime': patch
'@proteus-vue/plugin-vite': patch
'@proteus-vue/cli': patch
'@proteus-vue/create-proteus': patch
'@proteus-vue/api': patch
'@proteus-vue/capabilities': patch
'@proteus-vue/devtools': patch
'@proteus-vue/web': patch
'@proteus-vue/worklet': patch
---

发布同步：有状态单例挂 globalThis（修「包副本分裂 → 静默失效」）+ Web 路由表/路由参数

**核心修复（来自外部实战报告，最隐蔽的一个）**：依赖树出现两份同一包时，模块被求值两次 →
**有状态单例分裂** → 订阅方与发布方各持一个实例 → **静默失效（无任何报错）**。
真实表现：URL 变了但视图永不更新。修复：单例经 `globalThis` 共享（键存在即复用）——
`shared` 的 adapter（`__PROTEUS_ADAPTER_{WEB,MP}__`）、`app-config` 的 store
（`configRef` **与 `listeners` 同槽**）、`devtools-runtime` 的 traceBus（`__PROTEUS_TRACE_BUS__`）。

**其余同期修复**：
- `plugin-vite` / `cli`：web 目标也更新**应用侧路由表**（`auto-routes.ts` 双端共用；此前只在
  MP 目标生成 → `proteus build --target web` 新增页面 **404**）；并提供 `routesOutput: ''`
  显式关闭语义（文档站等自带路由的工程）。
- `shared`：Web 端 **路由参数**双路补齐——`PageInstance.query`（对齐 MP `Page.options`）
  + `adapter` 当前页保留 query（此前 query 只传给 listeners，页内读不到）。
- `create-proteus`：模板 `RouterView` 把 query `v-bind` 给页面（页面 `defineProps` 即收到）。

**★为何 `api` / `capabilities` / `devtools` / `web` / `worklet` 也在内**（源码未改但须重发）：
这些包用 esbuild `--bundle` 构建，把 `shared` 的代码**内联**进了自身产物——`shared` 一变，
它们的 `dist` 随之变化。不重发则用户拿到的仍是旧行为。

（上述包均为**发布同步**，无破坏性变更。）
