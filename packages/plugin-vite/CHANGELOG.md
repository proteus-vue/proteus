# @proteus-vue/plugin-vite

## 0.2.0-beta.2

### Minor Changes

- 组件库拆包：`@proteus-vue/components`（p-\* 语义组件）成为真实包，退役 alias 与 frameworkComponentsDir

  **新包 `@proteus-vue/components`**（第 41 包）：73 个 `p-*` 语义组件 + `pg-glass` + `virtual-list` + `runtime/contracts/theme`（90 文件）从仓库根 `src/components/` 迁入。**发源码**（`publishSource: true`）：① MP 编译器需在磁盘上扫 `.vue`（`<dir>/<tag>/index.vue`）；② 与「一份源码双端」一致（Web 由消费方 `@vitejs/plugin-vue` 编译）。

  **`@proteus-vue/plugin-vite`**：新增 `resolveComponentsRoot(projectRoot)`（`resolve-components.ts`，已导出）——自项目 node_modules 解析 `@proteus-vue/components` 包根；`mpTransform` / `runGenRoutes` 默认走该解析（不再需要配置项）；包缺失时显式**告警**（写明后果：`p-*` 不被注册 → WXML 整块不渲染），不再静默；产物路径 `proteus/<name>/index` **不变**（对外契约）。

  **`@proteus-vue/types` / `@proteus-vue/cli`**：删除 `frameworkComponentsDir` 配置项（config / config-layers / config-validate / build / dev 全链退役）——容器库已可从 node_modules 自解析。

  **端到端效果**：外部用户 `npm i @proteus-vue/components` 后，Web 直接 `import`、小程序标签 `<p-button>` 开箱可用（无需任何 alias 或配置）。

  **破坏性验证**（已入流程）：临时移走包 → `gen-routes` 报「未找到语义组件库 + p-\* 组件将不被注册（页面 usingComponents 缺失 → WXML 整块不渲染）」，而非静默不渲染。

### Patch Changes

- Updated dependencies
  - @proteus-vue/types@0.2.0-beta.1
  - @proteus-vue/compiler@0.3.0-beta.2
  - @proteus-vue/router@0.2.0-beta.2

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.1
  - @proteus-vue/types@0.1.1-beta.0
  - @proteus-vue/compiler-backend@0.1.1-beta.0
  - @proteus-vue/router@0.2.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- ecdcfdb: 拆包步骤 5：Vite 插件 + gen-routes 归 @proteus-vue/plugin-vite

  - `mpTransform` 插件 config 解耦：`PluginOptions.config` 由 vite.config 注入（不再 import 项目 config）
  - `ProteusConfig` 类型契约迁入包内 `config.ts`
  - gen-routes 双形态：纯函数 `runGenRoutes({ config, root })` + CLI 入口 `cli.ts`
  - appSkeleton（构建期 app.js 骨架模板）从 runtime 迁入 plugin-vite
  - 内置预设 builders 路径随 router 拆包同步（packages/router/src/presets）

- a501441: 拆包步骤 7：create-proteus 模板重构（npm 包形态）

  - 模板不再复制框架本体（src/platform|runtime|router 框架代码 + 插件），改依赖 `@proteus-vue/{router,runtime,shared,plugin-vite,compiler}` npm 包
  - `@proteus-vue/router` exports 补类型子路径（`./types`/`./schema`/`./scan`/`./tree`/`./merge`）+ `./package.json`；预设源码随包发布（`src/presets`，插件内联需要）
  - `@proteus-vue/plugin-vite` 插件支持 `node_modules/` 包内预设路径解析（resolvePkgPath，含 scoped 包）
  - snapshot-template 改为只快照应用壳；模板应用侧自带 shims 全局类型

- ae60825: 底线整改：AI-native 透明框架分派层 + 漂移门禁 + 路由透明化

  - `@proteus-vue/compiler`：规则注册表升级为**分派层**（阶段三落地）——`executeRule(id, ctx)` + 规则 `apply()`（style/px-to-rpx、template/scope-attr 已登记示范）；AI 覆盖规则实现 → 编译输出即时变化（底线循环 ① 完全形态）
  - 实现 ↔ 注册表**反向漂移门禁**（tests/registry-drift）：实现引用的规则 ID 必须全部已登记，新转换决策漏登记当场报错
  - `@proteus-vue/router`：路由生成规则注册表（route/scan、path-derive、parent-explicit 等 7 条 AI 说明书）+ `--trace-router` 闭环（buildRouteTree/runGenRoutes 输出嵌套推导决策链）

### Patch Changes

- 00c9fb7: 拆包步骤 6：别名与引用面全量切换

  - vite alias / tsconfig paths 全量精确映射 `@proteus-vue/{router,runtime,shared,compiler,plugin-vite,components}`，删除泛化 `@proteus-vue` → `src/`（防误匹配）
  - 新增 `@proteus-vue/components` 精确别名（框架内置组件暂留 `src/components`，组件库 v2.0 方向）
  - create-proteus 模板 alias 同步精确化（vendored 结构）

- Updated dependencies [7cf0406]
- Updated dependencies [00c9fb7]
- Updated dependencies [a501441]
- Updated dependencies [ae60825]
  - @proteus-vue/router@0.2.0-beta.0
  - @proteus-vue/compiler@0.3.0-beta.0
