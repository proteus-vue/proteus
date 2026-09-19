# @proteus-vue/built-in-components

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
