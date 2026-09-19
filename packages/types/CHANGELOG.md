# @proteus-vue/types

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies
  - @proteus-vue/contracts@0.1.1-beta.0

## 0.2.0-beta.1

### Minor Changes

- 组件库拆包：`@proteus-vue/components`（p-\* 语义组件）成为真实包，退役 alias 与 frameworkComponentsDir

  **新包 `@proteus-vue/components`**（第 41 包）：73 个 `p-*` 语义组件 + `pg-glass` + `virtual-list` + `runtime/contracts/theme`（90 文件）从仓库根 `src/components/` 迁入。**发源码**（`publishSource: true`）：① MP 编译器需在磁盘上扫 `.vue`（`<dir>/<tag>/index.vue`）；② 与「一份源码双端」一致（Web 由消费方 `@vitejs/plugin-vue` 编译）。

  **`@proteus-vue/plugin-vite`**：新增 `resolveComponentsRoot(projectRoot)`（`resolve-components.ts`，已导出）——自项目 node_modules 解析 `@proteus-vue/components` 包根；`mpTransform` / `runGenRoutes` 默认走该解析（不再需要配置项）；包缺失时显式**告警**（写明后果：`p-*` 不被注册 → WXML 整块不渲染），不再静默；产物路径 `proteus/<name>/index` **不变**（对外契约）。

  **`@proteus-vue/types` / `@proteus-vue/cli`**：删除 `frameworkComponentsDir` 配置项（config / config-layers / config-validate / build / dev 全链退役）——容器库已可从 node_modules 自解析。

  **端到端效果**：外部用户 `npm i @proteus-vue/components` 后，Web 直接 `import`、小程序标签 `<p-button>` 开箱可用（无需任何 alias 或配置）。

  **破坏性验证**（已入流程）：临时移走包 → `gen-routes` 报「未找到语义组件库 + p-\* 组件将不被注册（页面 usingComponents 缺失 → WXML 整块不渲染）」，而非静默不渲染。

## 0.1.1-beta.0

### Patch Changes

- 框架元素探针：打通「框架 API ↔ 测试数据屏障」（跨端自动化测试降级通道）

  - **`@proteus-vue/runtime`**：新增元素探针注册表（`recordProbe` / `readProbes` / `clearProbes` / `probeEnabled`，全局 `__PROTEUS_PROBES__`，跨端纯 JSON）。
  - **`@proteus-vue/compiler`**：组件 `ready()` 注入自测量——`wx.createSelectorQuery().in(this).select(.<tag>-scopeId)` 取 `boundingClientRect` + `scrollOffset` + `computedStyle` 写注册表（+150ms 二次重测兜首帧）；页面 `onLoad` 复位注册表（同页 key 稳定），`PROTEUS_DEBUG` 构建默认开启。新规则 `script/element-probe`（可禁用）。`ScriptTransformOptions` 增 `scopeId`。
  - **`@proteus-vue/test-core`**：`driver.probes(pid?)` / `driver.enableProbes()`（MP + Web 双端同 API）+ 契约断言原语 `assertProbeScrollable` / `assertProbeGeometry` / `assertProbeVisible` / `getProbe`。
  - **`@proteus-vue/api`**：`useElement`（C58）在工具查询落空时**回落读探针注册表**——框架 API 也能读组件内部节点。
  - **起因**：自动化工具只能查页面拥有的节点（glass-easel 组件内部隔离；Skyline 无 `selectAllComponents`）→ 组件内部几何/可见性/可滚性无法断言（本项目一个横向 scroll-view 容器塌陷漏检两轮）。测量必须从组件内部发起，本通道让断言面不再受运行时 DOM 隔离限制。
