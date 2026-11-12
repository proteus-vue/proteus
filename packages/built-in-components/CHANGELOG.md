# @proteus-vue/built-in-components

## 0.3.0-beta.34

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/animation`
  - `@proteus-vue/api`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/consistency`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/devtools`
  - `@proteus-vue/glass`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/types`

- 9790036: 修 Web 弹层被 page 挂载层盖住（"看得见、点不到、关不掉"）——body 追加弹层迁到 overlay 域

  背景（CI e2e-web 长期 3 红 · 用户提来）：`e2e-overlay-family.test.ts`（p-drawer / p-popover）
  与 `e2e-web-keypaths.test.ts`（showModal）**30s 超时**。真因不是"慢"、更不是"timeout 太短"：

  - GP3-a 三层挂载（`packages/web/src/mount-layers.ts`）给 `page` 层 `z-index =
mountLayerDomainOffset('page') = 1_000_000`（overlay=2_000_000）。
  - 而**追加到 `<body>` 的弹层**（组件 `<teleport to="body">`、WeUI 平台层
    `document.body.appendChild`）**不受挂载层约束** ⇒ 裸 z-index 若仍取旧值（999 / 9990 /
    99990…），就被 page 层（1e6）**盖住**：遮罩/按钮可见但点不到 ⇒ Playwright 点不动、等超时。

  修法（★ 对齐既有先例，非新造约定）：`p-loading-host`(2000000) / `p-toast-host`(2000010) /
  `p-auth-gate`(2000020) 本轮之前就已用 **overlay 域**（注释写明"原 9999 < 页面层 1e6 ⇒ 被盖住"）。
  把**其余** body 追加弹层一并迁到 overlay 域（≥ `mountLayerDomainOffset('overlay')`）：

  - `p-drawer` `.p-drawer-root` 999 → 2000000
  - `p-popover` `.p-popover-layer` 998 → 2000000 · `.p-popover-panel` 999 → 2000001
  - `p-picker` `.p-picker-root` 9990 → 2000200
  - WeUI 平台层（`@proteus-vue/built-in-components/style.css`）：ui-mask 99990→2000190 ·
    modal 99991→2000191 · actionsheet 99991→2000191 · picker-sheet 99992→2000192 ·
    toast 99999→2000199 · image-menu-mask 3000→2000100

  （`p-modal` / `p-action-sheet` **不 teleport**（留在页面层内），其内部 999 相对页面内容仍在上层，不动。）

  ★**回归锁**：新增 `tests/teleport-overlay-zindex.test.ts`——静态扫描所有 body 追加弹层的
  z-index，断言 ≥ overlay 域（**破坏性验证过**：改回 999 即红）。

  验证：`test:e2e:web` **28/28 全过**（原 3 红；overlay 61s→4.5s、keypaths 超时 →0.8s）· 全量
  5620 通过 · `check:style-ir-golden` / `check:layers` / `check:app-css-surface` / `check:mp-attrs` 绿。
  （`check:component-demo` 的 p-view/p-webview 漂移在干净树同样红，属另一 pre-existing，不在本批。）

- Updated dependencies
  - @proteus-vue/shared@0.3.0-beta.34
  - @proteus-vue/types@0.3.0-beta.34

## 0.3.0-beta.28

### Patch Changes

- 全量重发（scripts/release.mjs --all）：把全部包的 `latest` tag 归位到当前版本。
  动机——npm 强制每包须有 `latest`，而事后改 tag（npm dist-tag）属包管理操作、
  会被要求交互式 2FA；发布时设置 tag 不受此限，故重发是零手工的归位路径。

  - `@proteus-vue/agent`
  - `@proteus-vue/animation`
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
  - `@proteus-vue/consistency`
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
  - `@proteus-vue/layout-core`
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
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/test-core`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/shared@0.3.0-beta.28
  - @proteus-vue/types@0.3.0-beta.28

## 0.3.0-beta.23

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/css-compat`
  - `@proteus-vue/devtools`
  - `@proteus-vue/fluid`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/shared@0.3.0-beta.23
  - @proteus-vue/types@0.3.0-beta.23

## 0.3.0-beta.21

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/api`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/devtools`
  - `@proteus-vue/fluid`
  - `@proteus-vue/mcp`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/shared`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/shared@0.3.0-beta.21

## 0.3.0-beta.12

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/built-in-components`
  - `@proteus-vue/compiler`
  - `@proteus-vue/types`

- Updated dependencies
  - @proteus-vue/types@0.3.0-beta.12

## 0.3.0-beta.11

### Patch Changes

- @proteus-vue/shared@0.3.0-beta.11
- @proteus-vue/types@0.3.0-beta.11

## 0.3.0-beta.10

### Patch Changes

- @proteus-vue/shared@0.3.0-beta.10
- @proteus-vue/types@0.3.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- @proteus-vue/shared@0.3.0-beta.9
- @proteus-vue/types@0.3.0-beta.9

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

- Updated dependencies
  - @proteus-vue/types@0.3.0-beta.8
  - @proteus-vue/shared@0.3.0-beta.8

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
  - @proteus-vue/types@0.3.0-beta.7

## 0.1.1-beta.4

### Patch Changes

- Updated dependencies
  - @proteus-vue/shared@0.2.0-beta.2

## 0.1.1-beta.3

### Patch Changes

- Updated dependencies
  - @proteus-vue/shared@0.2.0-beta.1

## 0.1.1-beta.2

### Patch Changes

- @proteus-vue/types@0.2.0-beta.2

## 0.1.1-beta.1

### Patch Changes

- Updated dependencies
  - @proteus-vue/types@0.2.0-beta.1

## 0.1.1-beta.0

### Patch Changes

- Web 模拟层与端对齐修复 + CLI 小程序 E2E 二进制归一

  - **`@proteus-vue/built-in-components`**（Web 小程序语义模拟层）：多词属性 kebab+camel 双读（`:scroll-y` / `:hover-class` 此前静默失效）；`view` 按压反馈支持 `hover-start-time` / `hover-stay-time` / `hover-stop-propagation`；`scroll-view` 事件改发**裸载荷**并支持受控 `scroll-top/left`；`text` 支持 `user-select` / `overflow` / `max-lines`；`image` 支持 `show-menu-by-longpress`（长按/右键自绘菜单）。
  - **`@proteus-vue/cli`**：`proteus test e2e:mp` 的 IDE 路径**归一到同目录 `wechatide` 二进制**——此前探测到的是已弃用的 automator `cli`，导致整条 MP E2E 链路静默失败（报「输出非 JSON」）。
  - **`@proteus-vue/component-ir`**：端对齐批次 1/2 的属性语义登记（view/text/icon/image/page-container/scroll-view/picker/nav/router-link 的 IR props 同步）。

- Updated dependencies
  - @proteus-vue/types@0.1.1-beta.0
