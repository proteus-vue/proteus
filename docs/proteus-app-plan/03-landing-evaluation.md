# App 渲染器落地评估与批次重排（v2）

> 状态：已落地评估（2026-08）  
> 前置：`00-overview.md`（v0.6 渲染器 + Vapor）、`01-app-renderer.md`（createRenderer host config）、`02-vapor.md`  
> 结论先行：**B1 核心（`@proteus/renderer-app`：NativeAdapter 抽象 + createRenderer host config + 测试用 mock adapter）可在本仓先行落地验证 Vue 官方渲染器契约；B2-B5 依赖 iOS/Android 原生工程 + npm 发布脚手架，标 v0.6 正式启动；Vapor（B6）依赖 @vue/vapor 实验版，标后续**。

---

## 1. 现状核对（Draft 假设 vs 当前代码库现实）

| # | Draft 假设 | 当前现实 | 结论 |
|---|-----------|----------|------|
| 1 | `@proteus/renderer-app` 用 Vue 官方 `createRenderer` 定义 host config | @vue/runtime-core 3.5.42 已装（vue 依赖）；`createRenderer` 契约可用 | ✅ **B1 核心先行**：NativeAdapter 接口（原生节点抽象）+ host config 纯 TS 可单测——**无需真机即可验证渲染器接线** |
| 2 | host 内 createElement → iOS UIView / Android View | 本仓无 Xcode/Android SDK；原生工程骨架无法验证 | ⏸ B2-B5 **标 v0.6 正式启动**（npm 发布后脚手架 + 原生工程）；NativeAdapter 接口已为原生实现留好接缝 |
| 3 | 样式系统（rpx→dp / flexbox 引擎） | 无原生布局引擎 | ⏸ 标 B2（Yoga/flexbox-layout 选型）；props 透传契约已定 |
| 4 | 路由/状态桥（router app adapter + Pinia） | createRouter API 已就绪（三端一致） | ⏸ 标 B3（原生导航栈适配）；API 契约已定 |
| 5 | capabilities app adapter | capability 契约已就绪（web/skyline adapter） | ⏸ 标 B4（补 app adapter） |
| 6 | Vapor 兼容（@vue/vapor 双模式编译 + 特性矩阵）| @vue/vapor 实验阶段（非稳定依赖）| ⏸ **特性子集兼容矩阵可先行文档化**（vue-compat 已覆盖大部分特性）；@vue/vapor 接入标后续 |
| 7 | 依赖 vue 运行时 | @vue/runtime-core 是 App 端专属依赖（App 通道永不编译进 MP）| ✅ renderer-app 包依赖 @vue/runtime-core（peerDependency），与 MP 编译互不干扰 |

---

## 2. 批次重排

| 批 | 交付物 | 说明 |
|----|--------|------|
| B1 | `@proteus/renderer-app`：NativeAdapter 接口 + host config（createRenderer）+ mock adapter（可断言原生树）+ createAppRenderer | ✅ **本批**（纯 TS 可单测：渲染/更新/事件契约验证）|
| B2 | 原生 host 完整（iOS/Android 视图 + 样式 rpx→dp + 事件桥）| ⏸ v0.6 正式启动（npm 发布 + 原生工程）|
| B3 | 路由/状态桥（router app adapter + routeType 原生转场）| ⏸ v0.6 |
| B4 | capabilities app adapter | ⏸ v0.6 |
| B5 | demo（同一份示例 iOS/Android 跑通）| ⏸ v0.6 |
| B6 | Vapor 双模式构建 + 特性矩阵 | ⏸ 特性矩阵先行文档化；@vue/vapor 接入标后续 |

---

## 3. B1 设计（本批）

```
packages/renderer-app/
  src/
    native.ts      # NativeAdapter 接口（createElement/createText/insert/remove/setText/patchProp/...）
    host.ts        # createAppHostConfig(adapter) → RendererOptions（Vue createRenderer 契约）
    index.ts       # createAppRenderer(adapter) → renderer.createApp（三端同源 SFC 的 App 通道）
    adapters/mock.ts  # 测试用 mock adapter：构建可断言的原生节点树 + 操作日志
```

```ts
// 用法（v0.6 正式形态：adapter 由原生工程注入——iOS UIView / Android View）
const renderer = createAppRenderer(nativeAdapter)
const app = renderer.createApp(App)
app.mount(containerNode)
```

★关键：host config 与原生平台解耦——本仓验证的是 **Vue 渲染器 → 原生节点树** 的接线正确性（diff/更新/事件属性），原生视图实现只差 adapter 的实现。

---

## 4. 验收（B1）

1. `renderer.createApp` 挂载组件 → mock 原生树结构正确（view/text 嵌套、props 应用、事件属性记录）。
2. 响应式更新（ref 变更）→ 原生树正确 patch（setText/setElementText 调用）。
3. 卸载 → 节点 remove 调用。
4. 宿主 config 契约完整（RendererOptions 全字段实现，querySelector/nextSibling 等 App 平台语义降级）。
5. 每批独立提交，验证 = `npm run verify` 全绿。

---

## 5. 进度追踪

| 批 | 状态 | 说明 |
|----|------|------|
| B1 renderer 核心（NativeAdapter + host config + mock）| ✅ 已落地 | 2026-08——@proteus/renderer-app：NativeAdapter 接口 + createAppHostConfig（Vue createRenderer 契约）+ mock adapter + createAppRenderer，5 用例（挂载/响应式更新/事件属性/卸载/v-if）|
| B2-B6 | ⏸ v0.6 正式启动 / @vue/vapor 后续 | 原生视图/样式/路由桥/能力桥/demo 需 npm 发布 + 原生工程 |
