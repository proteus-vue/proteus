# @proteus-vue/shared

## 0.3.0-beta.7

### Patch Changes

- 全量重发（scripts/release.mjs --all）：把全部包的 `latest` tag 归位到当前版本。
  动机——npm 强制每包须有 `latest`，而事后改 tag（npm dist-tag）属包管理操作、
  会被要求交互式 2FA；发布时设置 tag 不受此限，故重发是零手工的归位路径。

  - `@proteus-vue/agent`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/cli`
  - `@proteus-vue/compat-miniprogram`
  - `@proteus-vue/compiler`
  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/css-compat`
  - `@proteus-vue/desktop`
  - `@proteus-vue/dev-host`
  - `@proteus-vue/devtools`
  - `@proteus-vue/devtools-runtime`
  - `@proteus-vue/docs`
  - `@proteus-vue/fluid`
  - `@proteus-vue/gesture`
  - `@proteus-vue/glass`
  - `@proteus-vue/hmr`
  - `@proteus-vue/i18n`
  - `@proteus-vue/mcp`
  - `@proteus-vue/module`
  - `@proteus-vue/pinia-sync`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/security`
  - `@proteus-vue/shared`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/test-core`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

## 0.2.0-beta.2

### Patch Changes

- 发布同步：有状态单例挂 globalThis（修「包副本分裂 → 静默失效」）+ Web 路由表/路由参数

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
    - `adapter` 当前页保留 query（此前 query 只传给 listeners，页内读不到）。
  - `create-proteus`：模板 `RouterView` 把 query `v-bind` 给页面（页面 `defineProps` 即收到）。

  **★ 为何 `api` / `capabilities` / `devtools` / `web` / `worklet` 也在内**（源码未改但须重发）：
  这些包用 esbuild `--bundle` 构建，把 `shared` 的代码**内联**进了自身产物——`shared` 一变，
  它们的 `dist` 随之变化。不重发则用户拿到的仍是旧行为。

  （上述包均为**发布同步**，无破坏性变更。）

## 0.2.0-beta.1

### Patch Changes

- 发布同步：shared / pinia-sync 的 npm 版本与本地内容不一致（补 bump）

  这两个包在 `sync-publish-drift` 批次中未被推进版本号——原因是它们此前已把 minor 提升
  消耗在 `0.2.0-beta.0` 上（pre 模式下同一 minor 只应用一次），本轮无新 minor 声明。

  但**内容**确实与 npm 上的 `0.2.0-beta.0` 不同（实测 integrity 不一致），故补 patch bump
  使新内容可发布。`shared` 被 7 个包依赖（api/router/runtime/worklet/…），本 patch 同时
  驱使其依赖方在 `changeset version` 中同步精确依赖（仓内内部依赖均为 exact pin）。

## 0.2.0-beta.0

### Minor Changes

- 1bda359: pinia-plan M1-M6 完整实现（多端持久化骨架）

  - `@proteus-vue/shared`：Storage 抽象层（Memory/LocalStorage/WxStorage/NativeKV 占位 + 统一 async 契约）+ 序列化（Date/Map/Set 标记、循环引用处理）+ 存储追踪（--trace-storage）
  - `@proteus-vue/runtime`：持久化层（社区插件兼容 createPersistedStatePlugin + 自研轻量 persisted()/createPersistence，可共存）+ 四端工厂（createWebPinia/createMpPinia/createAppPinia/createSsrPinia，平台标记注入）+ DevTools 追踪/快照（createDevtoolsPlugin/**PROTEUS_STORES**）
  - 迁移指南：docs/pinia-migration.md（≤10 行接入）+ examples/migration-from-vue 对照

### Patch Changes

- 00c9fb7: 拆包步骤 6：别名与引用面全量切换

  - vite alias / tsconfig paths 全量精确映射 `@proteus-vue/{router,runtime,shared,compiler,plugin-vite,components}`，删除泛化 `@proteus-vue` → `src/`（防误匹配）
  - 新增 `@proteus-vue/components` 精确别名（框架内置组件暂留 `src/components`，组件库 v2.0 方向）
  - create-proteus 模板 alias 同步精确化（vendored 结构）
