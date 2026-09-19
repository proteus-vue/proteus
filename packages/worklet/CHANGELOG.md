# @proteus-vue/worklet

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

- Updated dependencies
  - @proteus-vue/shared@0.3.0-beta.7

## 0.1.1-beta.2

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

- Updated dependencies
  - @proteus-vue/shared@0.2.0-beta.2

## 0.1.1-beta.1

### Patch Changes

- Updated dependencies
  - @proteus-vue/shared@0.2.0-beta.1

## 0.1.1-beta.0

### Patch Changes

- 发布同步：修复「同版本号、内容不同」的发布漂移

  上述包在 npm 上的最新版本与本地源码**内容不一致**（版本号相同）——根因是
  `scripts/publish-all.sh` 旧逻辑「registry 已有该版本 → 跳过」无法区分「幂等重跑」与
  「改了源码但忘了 bump 版本号」，后者会让新内容永远发不出去。已实测：41 包中 36 个存在该漂移。

  后果（真实事故）：`@proteus-vue/cli@0.3.0-beta.2` 顶层 import `createFlamegraphCollector`，
  而 npm 上的 `devtools-runtime@0.1.0` 是旧构建（只有 8 个导出）→ 使用方**启动即崩**
  （`SyntaxError: ... does not provide an export named 'createFlamegraphCollector'`）。

  本次 bump 为**发布同步**（不含破坏性变更）；防复发改造见 `scripts/check-publish-drift.mjs`
  与 `publish-all.sh` 的内容校验（发布前自动拦截同类漂移）。
