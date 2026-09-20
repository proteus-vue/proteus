# @proteus-vue/components

## 0.3.0-beta.15

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/compiler`
  - `@proteus-vue/components`

## 0.3.0-beta.12

### Patch Changes

- @proteus-vue/api@0.3.0-beta.12

## 0.3.0-beta.11

### Patch Changes

- @proteus-vue/api@0.3.0-beta.11
- @proteus-vue/devtools-runtime@0.3.0-beta.11
- @proteus-vue/fluid@0.3.0-beta.11
- @proteus-vue/gesture@0.3.0-beta.11
- @proteus-vue/glass@0.3.0-beta.11
- @proteus-vue/shared@0.3.0-beta.11
- @proteus-vue/worklet@0.3.0-beta.11

## 0.3.0-beta.10

### Patch Changes

- @proteus-vue/api@0.3.0-beta.10
- @proteus-vue/devtools-runtime@0.3.0-beta.10
- @proteus-vue/fluid@0.3.0-beta.10
- @proteus-vue/gesture@0.3.0-beta.10
- @proteus-vue/glass@0.3.0-beta.10
- @proteus-vue/shared@0.3.0-beta.10
- @proteus-vue/worklet@0.3.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- @proteus-vue/api@0.3.0-beta.9
- @proteus-vue/devtools-runtime@0.3.0-beta.9
- @proteus-vue/fluid@0.3.0-beta.9
- @proteus-vue/gesture@0.3.0-beta.9
- @proteus-vue/glass@0.3.0-beta.9
- @proteus-vue/shared@0.3.0-beta.9
- @proteus-vue/worklet@0.3.0-beta.9

## 0.3.0-beta.8

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/built-in-components`
  - `@proteus-vue/cli`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/components`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/types`
  - @proteus-vue/api@0.3.0-beta.8
  - @proteus-vue/devtools-runtime@0.3.0-beta.8
  - @proteus-vue/fluid@0.3.0-beta.8
  - @proteus-vue/gesture@0.3.0-beta.8
  - @proteus-vue/glass@0.3.0-beta.8
  - @proteus-vue/shared@0.3.0-beta.8
  - @proteus-vue/worklet@0.3.0-beta.8

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
  - @proteus-vue/api@0.3.0-beta.7
  - @proteus-vue/devtools-runtime@0.3.0-beta.7
  - @proteus-vue/fluid@0.3.0-beta.7
  - @proteus-vue/gesture@0.3.0-beta.7
  - @proteus-vue/glass@0.3.0-beta.7
  - @proteus-vue/shared@0.3.0-beta.7
  - @proteus-vue/worklet@0.3.0-beta.7

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies
  - @proteus-vue/shared@0.2.0-beta.2
  - @proteus-vue/devtools-runtime@0.1.1-beta.1
  - @proteus-vue/api@0.2.0-beta.4
  - @proteus-vue/worklet@0.1.1-beta.2

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies
  - @proteus-vue/shared@0.2.0-beta.1
  - @proteus-vue/api@0.2.0-beta.3
  - @proteus-vue/worklet@0.1.1-beta.1

## 0.2.0-beta.0

### Minor Changes

- 端对齐批次 3（宿主能力）全部收口 + 标尺精度修复

  - **批次 3 八组件对齐官方属性 100%**（+88 属性）：
    - `p-media`（video）6→47/47：播放控制 / 控件显隐族（show-\*）/ 手势族 / 弹幕族 / 画中画族 /
      投屏·截屏·后台播放 / **DRM 族**（is-drm·provision-url·certificate-url·license-url）
    - `p-map` 7→29/29：缩放族 / 图层族（polyline·circles·polygons·include-points）/ 个性化 / 视角 / 交互族 / setting
    - `p-camera` 2→5/5：mode·resolution·frame-size（+ stop/scancode 事件）
    - `p-canvas` 0→3/3：官方 `type` **归一**为框架 `engine` + canvas-id·disable-scroll
    - `p-webview` 1/1：补 load 事件（跨端同名）
    - `p-ad` 3→4/4：ad-theme
    - `p-rich-text` 0→4/4：nodes·space·user-select·mode（source 保留为别名）
    - `p-draggable` 0→13/13：**能力真升级**——此前 MP 端仅 `capabilityWarnOnce('元素静态')` 静默降级
      （Web-only 实现），改为原生 `<movable-area>`+`<movable-view>` 双端同语义（含 area 侧 scale-area）
  - **标尺精度修复（生成器）**：官方页把**子对象 schema**（map 的 marker/polyline/polygon/circle/control/
    position、rich-text 的 node/text 字段）与组件属性混在同页不同 h2 区块——全页扫描误计入清单
    （map 61→43、rich-text 8→4；官方属性总数 793→771），制造虚假缺口并诱导把端私有结构固化成框架语义
    （违反 G-31 铁律）。改为只采四类属性区块（通用属性/属性说明/Skyline 特有属性/WebView 特有属性）。
  - **属性归一按 tag 限定**（`SEMANTIC_ALIAS_BY_TAG`）：同名不同义不进全局别名表
    （官方 `canvas.type`=渲染上下文 vs `button/scroll-view.type`=视觉模式；`movable-view.scale` 布尔 → `scaleEnabled`）。
  - `@proteus-vue/plugin-vite`：`MP_ONLY_TAGS` 补宿主能力原生标签（rich-text/map/camera/canvas/ad/web-view），
    消除 Web 端死分支的 resolveComponent 告警。

### Patch Changes

- Updated dependencies
  - @proteus-vue/devtools-runtime@0.1.1-beta.0
  - @proteus-vue/fluid@0.1.1-beta.0
  - @proteus-vue/glass@0.1.1-beta.0
  - @proteus-vue/worklet@0.1.1-beta.0
  - @proteus-vue/api@0.2.0-beta.2

## 0.2.0-beta.0

### Minor Changes

- 组件库拆包：`@proteus-vue/components`（p-\* 语义组件）成为真实包，退役 alias 与 frameworkComponentsDir

  **新包 `@proteus-vue/components`**（第 41 包）：73 个 `p-*` 语义组件 + `pg-glass` + `virtual-list` + `runtime/contracts/theme`（90 文件）从仓库根 `src/components/` 迁入。**发源码**（`publishSource: true`）：① MP 编译器需在磁盘上扫 `.vue`（`<dir>/<tag>/index.vue`）；② 与「一份源码双端」一致（Web 由消费方 `@vitejs/plugin-vue` 编译）。

  **`@proteus-vue/plugin-vite`**：新增 `resolveComponentsRoot(projectRoot)`（`resolve-components.ts`，已导出）——自项目 node_modules 解析 `@proteus-vue/components` 包根；`mpTransform` / `runGenRoutes` 默认走该解析（不再需要配置项）；包缺失时显式**告警**（写明后果：`p-*` 不被注册 → WXML 整块不渲染），不再静默；产物路径 `proteus/<name>/index` **不变**（对外契约）。

  **`@proteus-vue/types` / `@proteus-vue/cli`**：删除 `frameworkComponentsDir` 配置项（config / config-layers / config-validate / build / dev 全链退役）——容器库已可从 node_modules 自解析。

  **端到端效果**：外部用户 `npm i @proteus-vue/components` 后，Web 直接 `import`、小程序标签 `<p-button>` 开箱可用（无需任何 alias 或配置）。

  **破坏性验证**（已入流程）：临时移走包 → `gen-routes` 报「未找到语义组件库 + p-\* 组件将不被注册（页面 usingComponents 缺失 → WXML 整块不渲染）」，而非静默不渲染。

### Patch Changes

- @proteus-vue/api@0.2.0-beta.1
