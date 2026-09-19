# @proteus-vue/compiler

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
  - @proteus-vue/component-ir@0.3.0-beta.7
  - @proteus-vue/contracts@0.3.0-beta.7
  - @proteus-vue/types@0.3.0-beta.7

## 0.3.0-beta.3

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/component-ir@0.2.0-beta.1
  - @proteus-vue/contracts@0.1.1-beta.0
  - @proteus-vue/types@0.2.0-beta.2

## 0.3.0-beta.2

### Patch Changes

- Updated dependencies
  - @proteus-vue/types@0.2.0-beta.1

## 0.3.0-beta.1

### Minor Changes

- 编译器静默陷阱治理 + 事件名单段归一（真机驱动）

  - **静默陷阱告警**：顶层 `let x = <非 null 初值>` 被丢弃（→ 方法体引用抛 `ReferenceError`）、模板表达式内函数调用（WXML 不支持，崩事件链）、`:class` 通道漏后缀等此前**完全静默**的失败，现编译期告警并全仓扫修。
  - **事件名单段归一**：父级手写 `@update:{arg}` 归一为 `bind:update-{arg}`（与子组件 `triggerEvent('update-{arg}')` 同口径）——此前产出双冒号 `bind:update:show`，与子组件**永不匹配**（真机弹层遮罩点击关不掉的根因）。
  - 新规则登记：`script/element-probe`（元素探针注入，见对应 changeset）。

- 框架元素探针：打通「框架 API ↔ 测试数据屏障」（跨端自动化测试降级通道）

  - **`@proteus-vue/runtime`**：新增元素探针注册表（`recordProbe` / `readProbes` / `clearProbes` / `probeEnabled`，全局 `__PROTEUS_PROBES__`，跨端纯 JSON）。
  - **`@proteus-vue/compiler`**：组件 `ready()` 注入自测量——`wx.createSelectorQuery().in(this).select(.<tag>-scopeId)` 取 `boundingClientRect` + `scrollOffset` + `computedStyle` 写注册表（+150ms 二次重测兜首帧）；页面 `onLoad` 复位注册表（同页 key 稳定），`PROTEUS_DEBUG` 构建默认开启。新规则 `script/element-probe`（可禁用）。`ScriptTransformOptions` 增 `scopeId`。
  - **`@proteus-vue/test-core`**：`driver.probes(pid?)` / `driver.enableProbes()`（MP + Web 双端同 API）+ 契约断言原语 `assertProbeScrollable` / `assertProbeGeometry` / `assertProbeVisible` / `getProbe`。
  - **`@proteus-vue/api`**：`useElement`（C58）在工具查询落空时**回落读探针注册表**——框架 API 也能读组件内部节点。
  - **起因**：自动化工具只能查页面拥有的节点（glass-easel 组件内部隔离；Skyline 无 `selectAllComponents`）→ 组件内部几何/可见性/可滚性无法断言（本项目一个横向 scroll-view 容器塌陷漏检两轮）。测量必须从组件内部发起，本通道让断言面不再受运行时 DOM 隔离限制。

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @proteus-vue/types@0.1.1-beta.0
  - @proteus-vue/component-ir@0.1.1-beta.0

## 0.3.0-beta.0

### Minor Changes

- ae60825: 底线整改：AI-native 透明框架分派层 + 漂移门禁 + 路由透明化

  - `@proteus-vue/compiler`：规则注册表升级为**分派层**（阶段三落地）——`executeRule(id, ctx)` + 规则 `apply()`（style/px-to-rpx、template/scope-attr 已登记示范）；AI 覆盖规则实现 → 编译输出即时变化（底线循环 ① 完全形态）
  - 实现 ↔ 注册表**反向漂移门禁**（tests/registry-drift）：实现引用的规则 ID 必须全部已登记，新转换决策漏登记当场报错
  - `@proteus-vue/router`：路由生成规则注册表（route/scan、path-derive、parent-explicit 等 7 条 AI 说明书）+ `--trace-router` 闭环（buildRouteTree/runGenRoutes 输出嵌套推导决策链）

## 0.2.0

### Minor Changes

- v0.2 工程化基线完成：编译引擎独立包（monorepo）、CLI（build/explain/rules）、脚手架、CI、贡献设施。
