# @proteus-vue/component-ir

## 0.3.0-beta.11

### Patch Changes

- @proteus-vue/contracts@0.3.0-beta.11

## 0.3.0-beta.10

### Patch Changes

- @proteus-vue/contracts@0.3.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- @proteus-vue/contracts@0.3.0-beta.9

## 0.3.0-beta.8

### Patch Changes

- @proteus-vue/contracts@0.3.0-beta.8

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
  - @proteus-vue/contracts@0.3.0-beta.7

## 0.2.0-beta.1

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
  - @proteus-vue/contracts@0.1.1-beta.0

## 0.1.1-beta.0

### Patch Changes

- Web 模拟层与端对齐修复 + CLI 小程序 E2E 二进制归一

  - **`@proteus-vue/built-in-components`**（Web 小程序语义模拟层）：多词属性 kebab+camel 双读（`:scroll-y` / `:hover-class` 此前静默失效）；`view` 按压反馈支持 `hover-start-time` / `hover-stay-time` / `hover-stop-propagation`；`scroll-view` 事件改发**裸载荷**并支持受控 `scroll-top/left`；`text` 支持 `user-select` / `overflow` / `max-lines`；`image` 支持 `show-menu-by-longpress`（长按/右键自绘菜单）。
  - **`@proteus-vue/cli`**：`proteus test e2e:mp` 的 IDE 路径**归一到同目录 `wechatide` 二进制**——此前探测到的是已弃用的 automator `cli`，导致整条 MP E2E 链路静默失败（报「输出非 JSON」）。
  - **`@proteus-vue/component-ir`**：端对齐批次 1/2 的属性语义登记（view/text/icon/image/page-container/scroll-view/picker/nav/router-link 的 IR props 同步）。
