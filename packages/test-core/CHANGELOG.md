# @proteus-vue/test-core

## 0.3.0-beta.19

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.19

## 0.3.0-beta.15

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.15

## 0.3.0-beta.12

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.12

## 0.3.0-beta.11

### Patch Changes

- @proteus-vue/compiler@0.3.0-beta.11

## 0.3.0-beta.10

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.9

## 0.3.0-beta.8

### Patch Changes

- @proteus-vue/compiler@0.3.0-beta.8

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
  - @proteus-vue/compiler@0.3.0-beta.7

## 0.2.0-beta.2

### Patch Changes

- @proteus-vue/compiler@0.3.0-beta.3

## 0.2.0-beta.1

### Patch Changes

- @proteus-vue/compiler@0.3.0-beta.2

## 0.2.0-beta.0

### Minor Changes

- 框架元素探针：打通「框架 API ↔ 测试数据屏障」（跨端自动化测试降级通道）

  - **`@proteus-vue/runtime`**：新增元素探针注册表（`recordProbe` / `readProbes` / `clearProbes` / `probeEnabled`，全局 `__PROTEUS_PROBES__`，跨端纯 JSON）。
  - **`@proteus-vue/compiler`**：组件 `ready()` 注入自测量——`wx.createSelectorQuery().in(this).select(.<tag>-scopeId)` 取 `boundingClientRect` + `scrollOffset` + `computedStyle` 写注册表（+150ms 二次重测兜首帧）；页面 `onLoad` 复位注册表（同页 key 稳定），`PROTEUS_DEBUG` 构建默认开启。新规则 `script/element-probe`（可禁用）。`ScriptTransformOptions` 增 `scopeId`。
  - **`@proteus-vue/test-core`**：`driver.probes(pid?)` / `driver.enableProbes()`（MP + Web 双端同 API）+ 契约断言原语 `assertProbeScrollable` / `assertProbeGeometry` / `assertProbeVisible` / `getProbe`。
  - **`@proteus-vue/api`**：`useElement`（C58）在工具查询落空时**回落读探针注册表**——框架 API 也能读组件内部节点。
  - **起因**：自动化工具只能查页面拥有的节点（glass-easel 组件内部隔离；Skyline 无 `selectAllComponents`）→ 组件内部几何/可见性/可滚性无法断言（本项目一个横向 scroll-view 容器塌陷漏检两轮）。测量必须从组件内部发起，本通道让断言面不再受运行时 DOM 隔离限制。

- a8633e9: MP E2E 后端迁移：miniprogram-automator → wechatide skill-CLI（官方 Electron 版唯一标准）

  - **起因**：`miniprogram-automator@0.12.1` 与新版 Electron 版微信开发者工具的 automation WS 协议/端口不可发现不兼容（`proteus test e2e:mp` launch 报 `Failed to launch ... http port is open`，服务端口一直开着也连不上）。
  - **`@proteus-vue/test-core`**：新增 `@proteus-vue/test-core/driver` 的 `createWxideMini`（实现 `AutomatorMiniLike`，内部 spawn `wechatide -c <client> <tool> --project` + 解析嵌套 JSON）与 `callWxide`；`createMpDriver` 无缝复用。`waitFor` 改烘字面量无参函数（wechatide `automation_evaluate` 只认裸函数源码，不支持带参/IIFE）。
  - **`@proteus-vue/cli`**：`proteus test e2e:mp` 改为 wechatide 装配——`open_project_window`（fullMode）+ skyline render config + 设 `PROTEUS_MP_E2E_WXIDE=1` 让 spec 走 `createWxideMini`；不再打 automator 兼容补丁 / 不 launch automator。
  - **兼容**：`tests/e2e-mp-smoke.test.ts` 加 `WXIDE_ENABLED` 分支——设 `PROTEUS_MP_E2E_WXIDE=1` 走 wechatide，否则保留 automator（向后兼容）。
  - 工具映射：`automation_navigate`（reLaunch/back）、`automation_runtime_info`（currentPage/systemInfo）、`automation_evaluate`、`automation_element_action`、`get_simulator_console`、`simulator_screenshot`、`simulator_refresh`、`debug_clear_cache`。

  ★ 环境前置：微信开发者工具（Electron 版）已安装 + 小程序产物 `dist/mp-weixin` + `build:mp` 通过；`--ide <cli>`（或 `PROTEUS_IDE_CLI`）指定 wechatide CLI 路径。工具签名/输出见 `docs/wechatide-skill`。

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/compiler@0.3.0-beta.1
