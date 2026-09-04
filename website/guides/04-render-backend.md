---
title: 渲染后端
order: 4
group: 渲染引擎
---

# 渲染后端

Proteus 不自研渲染引擎。渲染流程的最后一步——把节点挂进引擎的 nodeOps——被定义为一个 SPI：`ProteusRenderBackend`（G-27）。任何渲染引擎只要实现这一个接口，就能渲染同一套语义模型；业务代码与框架核心对引擎零感知。

> **One semantic model. Any render engine.**
> 后端消费的是 `IRNode.semantic`（如 `layout.grid`），不是标签字符串——换引擎 = 换一张语义映射表。

## SPI 契约

接口只有 5 个必选方法（刻意对齐 Vue nodeOps 事实标准——`createRenderer(nodeOps)` 即零成本后端），其余全部可选：

```ts
export interface ProteusRenderBackend {
  readonly id: BackendId // 'vue-dom' | 'flutter' | 'native-ios' | ...
  readonly version: string
  readonly capabilities: BackendCapabilities // 能力声明——框架按能力降级，不按 if/else 判平台

  // —— 必选 nodeOps（对齐 Vue）——
  createElement(node: IRNode): NodeHandle
  insert(child: NodeHandle, parent: NodeHandle, anchor?: NodeHandle): void
  remove(child: NodeHandle): void
  patchProp(el: NodeHandle, key: string, prev: unknown, next: unknown): void
  setText(el: NodeHandle, text: string): void

  // —— 可选：布局 / 帧调度 / 输入 / 生命周期 / 纹理共享（节选）——
  measure?(node: NodeHandle, constraints: LayoutConstraints): Size
  scheduleFrame?(task: () => void): void
  dispatchInput?(event: NormalizedInputEvent): void
  onMount?(root: NodeHandle): void
  registerExternalTexture?(id: string, texture: ExternalTexture): void
}
```

- **`IRNode`**：`{ type, semantic?, props, children }`。`semantic` 是后端映射的依据（`layout.grid` → `UICollectionView` / `GridView` / `div.proteus-grid`），缺省回退 `type`（Layer 1 兼容层）。
- **`capabilities`**：layout / glass / blur / animation / textureSharing / remoteRendering / ssr / input 八字段诚实声明；未声明 = 不支持。
- 每个后端必须通过 `runBackendConformance(backend)` 接口完整性自检（RND002）。

## 六个官方后端

`@proteus-vue/render-backend` 内置六个可切换的后端——官网 Playground 的 RENDER BACKEND 切换器真实调用它们（零伪造）：

| 后端（id） | 目标端 | 产物形态 | 成熟度 |
|---|---|---|---|
| `vue-dom` | Web / H5 | 真实 DOM 元素树（浏览器渲染） | ✅ |
| `headless` | 内存（无 UI） | `HeadlessNode` 内存树（`toPlainTree` 可序列化） | ✅ |
| `native-ios` | iOS（UIKit） | `NativeViewDescriptor` 平台描述树 | ✅ 描述树 / 📋 真机桥 |
| `native-android` | Android（Jetpack） | 描述树（`TextView` / `GridLayoutManager`…） | ✅ 描述树 / 📋 真机桥 |
| `native-harmony` | 鸿蒙（ArkUI） | 描述树（`Text` / `Grid`…） | ✅ 描述树 / 📋 真机桥 |
| `flutter` | Flutter | `FlutterWidgetDescriptor` widget 树 | ✅ 映射 spike / 📋 Embedder 桥 |

成熟度诚实分级：**✅ = 代码已落地、可机器验证**（描述树 / 内存树 / 真实 DOM 都是真跑）；**📋 = 需要宿主工程**（原生 SDK 桥、Flutter Embedder——见[原生能力](/docs/05-native-backend)与[Flutter 后端](/docs/16-flutter-backend)）。SPI 还预留了 `skyline` / `skia` / `canvas2d` 三个 `BackendId`，引擎实例尚未实现。

各后端的能力声明不同——这正是「按能力降级」的数据源：

| 后端 | layout | glass | blur | animation | ssr | input |
|---|---|---|---|---|---|---|
| `vue-dom` | native | L1 | approximate | js | — | touch · cursor |
| `headless` | none | none | none | js | ✅ | touch |
| `native-*` | native | L3 | true | native | — | touch · cursor · remote |
| `flutter` | yoga | L3 | true | native | — | touch · cursor · remote |

> native 与 flutter 的 `textureSharing` 均声明 `true`（PlatformView / Texture 混合）；四个后端的 `remoteRendering` 均为 `false`。

## 如何渲染与切换

全部是真实 API（与官网 Playground、runtime 源码一致）：

```ts
import { createFlutterBackend, renderIRTree, toWidgetTree } from '@proteus-vue/render-backend'

// 直接渲染一棵 IR：递归 createElement + insert，返回根句柄
const root = renderIRTree(createFlutterBackend(), ir)
const widget = toWidgetTree(root as never) // { widget: 'Scaffold', children: [...] }
```

热切换由 Dispatcher（全局转发层）承载——**切换引擎 = 换 nodeOps 的转发目标，Vue 与业务代码零感知**：

```ts
import {
  createNodeOpsDispatcher,
  createBackendSwitcher,
  createVueDomBackend,
  createNativeBackend,
} from '@proteus-vue/render-backend'

const dispatch = createNodeOpsDispatcher(createVueDomBackend())
const switcher = createBackendSwitcher(dispatch)
switcher.mount(ir) // 首次挂载
switcher.switchBackend(createNativeBackend(undefined, 'ios'), {
  strategy: 'rehydrate', // 同一 IR 在新引擎重建，保业务状态
})
```

三种策略：**rebuild**（销毁重建——开发期 DevTools）/ **rehydrate**（同一 IR 重建——生产期路由切换）/ **hybrid**（同页面多引擎——区域路由）。标准 Vue 应用同样落到任意后端：

```ts
import { createProteusRendererForBackend } from '@proteus-vue/render-backend'

const { renderer, dispatch } = createProteusRendererForBackend(createVueDomBackend())
renderer.createApp(App).mount(containerNode) // Vue 代码不变，引擎可换
```

## 渲染驱动与引擎无关（H-03）

Dispatcher 记录每一次 nodeOps 调用（`trace`）。同一份 IR 在两个引擎下渲染，**trace 逐条一致**——这是「渲染驱动与引擎无关」的机器证据；`semanticSequence(ir)` 则是引擎无关的输入指纹：

```ts
semanticSequence(ir)
// ['shell.page', 'layout.grid', 'layout.box', 'ui.text', 'layout.box', 'ui.button']
```

在此之上还有两件武器：

- **混合渲染**：`createHybridRenderer` 按区域路由后端（视频区走 native、其余走 vue-dom）+ 纹理共享（`registerExternalTexture`）+ 路由 trace 供 DevTools 可视化。
- **conformance 门禁**：接口完整性自检 + G-31 组件渲染快照（6 后端 × L1 fixtures，控件 readback 对照参考表）——详见[一致性验证](/docs/26-conformance)。

**同一个 App 按页面选引擎**：商品详情 → Native、品牌动效 → Flutter、H5 落地页 → VueDom、测试/SSR → Headless——业务代码完全一样。Flutter 锁死 Skia、RN 锁死原生，只有「上层语义模型 + 可插拔后端」这条路线换来了渲染引擎自由。

## 下一步

- [原生能力](/docs/05-native-backend)：三平台语义映射与诚实边界
- [Flutter 后端](/docs/16-flutter-backend)：语义 → widget 树的映射层
- [一致性验证](/docs/26-conformance)：后端与语义映射的门禁
