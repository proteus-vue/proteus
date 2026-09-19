# @proteus-vue/cli

## 0.3.0-beta.4

### Patch Changes

- @proteus-vue/capabilities@0.1.1-beta.3
- @proteus-vue/router@0.2.0-beta.4
- @proteus-vue/runtime@0.2.0-beta.3
- @proteus-vue/plugin-vite@0.2.0-beta.4

## 0.3.0-beta.3

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/component-ir@0.2.0-beta.1
  - @proteus-vue/plugin-vite@0.2.0-beta.3
  - @proteus-vue/app-config@0.1.1-beta.0
  - @proteus-vue/capabilities@0.1.1-beta.2
  - @proteus-vue/compiler-backend@0.1.1-beta.1
  - @proteus-vue/css-compat@0.1.1-beta.0
  - @proteus-vue/devtools-runtime@0.1.1-beta.0
  - @proteus-vue/fluid@0.1.1-beta.0
  - @proteus-vue/module@0.1.1-beta.0
  - @proteus-vue/render-backend@0.1.1-beta.1
  - @proteus-vue/compiler@0.3.0-beta.3
  - @proteus-vue/runtime@0.2.0-beta.2
  - @proteus-vue/types@0.2.0-beta.2
  - @proteus-vue/router@0.2.0-beta.3

## 0.3.0-beta.2

### Minor Changes

- 组件库拆包：`@proteus-vue/components`（p-\* 语义组件）成为真实包，退役 alias 与 frameworkComponentsDir

  **新包 `@proteus-vue/components`**（第 41 包）：73 个 `p-*` 语义组件 + `pg-glass` + `virtual-list` + `runtime/contracts/theme`（90 文件）从仓库根 `src/components/` 迁入。**发源码**（`publishSource: true`）：① MP 编译器需在磁盘上扫 `.vue`（`<dir>/<tag>/index.vue`）；② 与「一份源码双端」一致（Web 由消费方 `@vitejs/plugin-vue` 编译）。

  **`@proteus-vue/plugin-vite`**：新增 `resolveComponentsRoot(projectRoot)`（`resolve-components.ts`，已导出）——自项目 node_modules 解析 `@proteus-vue/components` 包根；`mpTransform` / `runGenRoutes` 默认走该解析（不再需要配置项）；包缺失时显式**告警**（写明后果：`p-*` 不被注册 → WXML 整块不渲染），不再静默；产物路径 `proteus/<name>/index` **不变**（对外契约）。

  **`@proteus-vue/types` / `@proteus-vue/cli`**：删除 `frameworkComponentsDir` 配置项（config / config-layers / config-validate / build / dev 全链退役）——容器库已可从 node_modules 自解析。

  **端到端效果**：外部用户 `npm i @proteus-vue/components` 后，Web 直接 `import`、小程序标签 `<p-button>` 开箱可用（无需任何 alias 或配置）。

  **破坏性验证**（已入流程）：临时移走包 → `gen-routes` 报「未找到语义组件库 + p-\* 组件将不被注册（页面 usingComponents 缺失 → WXML 整块不渲染）」，而非静默不渲染。

### Patch Changes

- Updated dependencies
  - @proteus-vue/plugin-vite@0.2.0-beta.2
  - @proteus-vue/types@0.2.0-beta.1
  - @proteus-vue/capabilities@0.1.1-beta.1
  - @proteus-vue/compiler@0.3.0-beta.2
  - @proteus-vue/router@0.2.0-beta.2

## 0.3.0-beta.1

### Minor Changes

- a8633e9: MP E2E 后端迁移：miniprogram-automator → wechatide skill-CLI（官方 Electron 版唯一标准）

  - **起因**：`miniprogram-automator@0.12.1` 与新版 Electron 版微信开发者工具的 automation WS 协议/端口不可发现不兼容（`proteus test e2e:mp` launch 报 `Failed to launch ... http port is open`，服务端口一直开着也连不上）。
  - **`@proteus-vue/test-core`**：新增 `@proteus-vue/test-core/driver` 的 `createWxideMini`（实现 `AutomatorMiniLike`，内部 spawn `wechatide -c <client> <tool> --project` + 解析嵌套 JSON）与 `callWxide`；`createMpDriver` 无缝复用。`waitFor` 改烘字面量无参函数（wechatide `automation_evaluate` 只认裸函数源码，不支持带参/IIFE）。
  - **`@proteus-vue/cli`**：`proteus test e2e:mp` 改为 wechatide 装配——`open_project_window`（fullMode）+ skyline render config + 设 `PROTEUS_MP_E2E_WXIDE=1` 让 spec 走 `createWxideMini`；不再打 automator 兼容补丁 / 不 launch automator。
  - **兼容**：`tests/e2e-mp-smoke.test.ts` 加 `WXIDE_ENABLED` 分支——设 `PROTEUS_MP_E2E_WXIDE=1` 走 wechatide，否则保留 automator（向后兼容）。
  - 工具映射：`automation_navigate`（reLaunch/back）、`automation_runtime_info`（currentPage/systemInfo）、`automation_evaluate`、`automation_element_action`、`get_simulator_console`、`simulator_screenshot`、`simulator_refresh`、`debug_clear_cache`。

  ★ 环境前置：微信开发者工具（Electron 版）已安装 + 小程序产物 `dist/mp-weixin` + `build:mp` 通过；`--ide <cli>`（或 `PROTEUS_IDE_CLI`）指定 wechatide CLI 路径。工具签名/输出见 `docs/wechatide-skill`。

### Patch Changes

- Web 模拟层与端对齐修复 + CLI 小程序 E2E 二进制归一

  - **`@proteus-vue/built-in-components`**（Web 小程序语义模拟层）：多词属性 kebab+camel 双读（`:scroll-y` / `:hover-class` 此前静默失效）；`view` 按压反馈支持 `hover-start-time` / `hover-stay-time` / `hover-stop-propagation`；`scroll-view` 事件改发**裸载荷**并支持受控 `scroll-top/left`；`text` 支持 `user-select` / `overflow` / `max-lines`；`image` 支持 `show-menu-by-longpress`（长按/右键自绘菜单）。
  - **`@proteus-vue/cli`**：`proteus test e2e:mp` 的 IDE 路径**归一到同目录 `wechatide` 二进制**——此前探测到的是已弃用的 automator `cli`，导致整条 MP E2E 链路静默失败（报「输出非 JSON」）。
  - **`@proteus-vue/component-ir`**：端对齐批次 1/2 的属性语义登记（view/text/icon/image/page-container/scroll-view/picker/nav/router-link 的 IR props 同步）。

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.1
  - @proteus-vue/runtime@0.2.0-beta.1
  - @proteus-vue/types@0.1.1-beta.0
  - @proteus-vue/component-ir@0.1.1-beta.0
  - @proteus-vue/plugin-vite@0.2.0-beta.1
  - @proteus-vue/capabilities@0.1.1-beta.0
  - @proteus-vue/compiler-backend@0.1.1-beta.0
  - @proteus-vue/router@0.2.0-beta.1
  - @proteus-vue/render-backend@0.1.1-beta.0

## 0.2.1-beta.0

### Patch Changes

- Updated dependencies [7cf0406]
- Updated dependencies [00c9fb7]
- Updated dependencies [a501441]
- Updated dependencies [ae60825]
  - @proteus-vue/router@0.2.0-beta.0
  - @proteus-vue/compiler@0.3.0-beta.0

## 0.2.0

### Minor Changes

- v0.2 工程化基线完成：编译引擎独立包（monorepo）、CLI（build/explain/rules）、脚手架、CI、贡献设施。

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.2.0
