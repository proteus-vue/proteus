---
title: 原生能力
order: 20
group: 渲染与能力
---

# 原生能力

传统跨端框架里，「原生能力」意味着自己写桥：Swift/Kotlin 各一份，常年维护。Proteus 把渲染后端的 SPI 方法论泛化到一切原生实现——**原生能力也是一行语义映射**。扫码、定位不是 `if (platform)` 分支，而是映射表里的 `capability.*` 行，与 `ui.*`、`shell.*` 同表同源。

> **业务调用语义，后端提供实现。**
> NativeBackend 的三平台映射表 `SEMANTIC_NATIVE_MAPS` 每平台 52 行，覆盖 layout / ui / shell / capability / gesture / engineering 六族。

## 三平台语义映射

`createNativeBackend(adapter, platform)` 按平台选用映射表（iOS UIKit 基准 / Android Jetpack / 鸿蒙 ArkUI），`createElement` 把 `semantic` 映射为原生视图类型：

| 语义 | iOS（UIKit） | Android（Jetpack） | 鸿蒙（ArkUI） |
|---|---|---|---|
| `layout.box` | UIView | FrameLayout | Stack |
| `layout.stack` | UIStackView | LinearLayout | Flex |
| `layout.grid` | UICollectionView | GridLayoutManager | Grid |
| `layout.scroll` | UIScrollView | ScrollView | Scroll |
| `ui.text` | UILabel | TextView | Text |
| `ui.button` | UIButton | Button | Button |
| `ui.input` | UITextField | EditText | TextInput |
| `ui.list` | UITableView | RecyclerView | List |
| `shell.tabbar` | UITabBar | BottomNavigationView | Tabs |
| `shell.modal` | UIAlertController | Dialog | CustomDialog |
| `layout.split` | UISplitViewController | SlidingPaneLayout | SideBarContainer |
| `ui.nav` | UINavigationController | NavigationRail | Navigation |
| `gesture.draggable` | UIPanGestureRecognizer | GestureDetector | PanGesture |
| `capability.scan-qr` | AVCaptureSession | CameraX | ScanKit |
| `capability.location` | CLLocationManager | FusedLocation | geoLocationManager |

表为节选。全部行与 component-ir 的 `SEMANTIC_BACKEND_MAP` 各端列**同源**——映射表是 SSOT，后端实现与 conformance 参考表都从它对齐，不允许各写一份。

## 产物是平台描述树（诚实边界）

NativeBackend 维护一棵 `NativeViewDescriptor` 树（`type` 已是原生视图名），并把每次变更同步给宿主适配器——宿主要实现的全部接口就是它：

```ts
export interface NativeViewAdapter {
  createView(descriptor: NativeViewDescriptor): unknown // 宿主句柄：UIView / View / ArkUI Node
  updateView(handle: unknown, key: string, prev: unknown, next: unknown): void
  insertView(child: unknown, parent: unknown, anchor?: unknown): void
  removeView(child: unknown): void
  setViewText(handle: unknown, text: string): void
}
```

当前代码现状，如实分级：

- ✅ **语义映射 + 描述树 + 接线验证**：`semantic → 原生视图类型` 真实生效；缺省适配器 `createMockNativeAdapter()` 用 ops 日志在无宿主环境下断言 create / update / insert / remove / setText 的调用序列。
- 📋 **真机渲染（bridge）**：把 adapter 换成 iOS / Android / 鸿蒙 SDK 桥即可上真机——`NativeViewAdapter` 与 `@proteus-vue/renderer-app` 的 NativeAdapter 同构。宿主工程落地前，产物停在**描述树**，不是真机视图。

渲染侧的接缝只有这一个接口：自研跨端壳接入 = 实现这五个方法，把描述树同步到自己的视图系统。mock 适配器就是照着这个面写的第一个「宿主」。

```ts
import { createNativeBackend, createMockNativeAdapter, renderIRTree } from '@proteus-vue/render-backend'

const adapter = createMockNativeAdapter()
renderIRTree(createNativeBackend(adapter, 'ios'), ir) // ir = p-grid > p-text
adapter.ops
// ['create:UICollectionView', 'create:UILabel', 'insert:UILabel', …]——接线序列可断言
```

## 能力语义也在同一张表

`capability.*` 行说明**渲染与原生能力共用同一语义模型**：扫码 → `AVCaptureSession` / `CameraX` / `ScanKit`，拍照 → `UIImagePicker` / `PhotoPicker` / `PhotoViewPicker`，定位 → `CLLocationManager` / `FusedLocation` / `geoLocationManager`。

两条消费路径收敛到同一份目录（128 原语 SSOT，capability 族 50 项）：

- **模板里**是能力入口语义——`capability.scan-qr` 在 vue-dom 端渲染为 `button.proteus-scan-qr`（能力实现由 Hook 注入）；
- **脚本里**是 Hook——`createCapabilityHooks()` 返回 50 个 `useXxx()`（`useCamera()` / `useLocation()` / `useQRCode()` …）。

详见[能力系统](/docs/18-capability-system)与[平台 API](/docs/19-platform-api)。

## 不是 wx.xxx 全局对象

G-31 对 API 面的改造与组件面同源：**API = Hook / Promise**（`useCamera()` / `useLocation()` / `router.push()`），没有 `wx.xxx` 全局对象。能力调用进绑定层而不是散落在业务里——编译器能扫描、类型系统能检查、conformance 能验证。这也正是映射表能「一表三端」的前提：入口是语义，实现才可能被后端接管。

## 怎么验证映射没漂

组件快照 conformance（G-31 渲染层）对每个后端做**控件 readback**，与参考表逐节点比对——后端实际产出什么控件，必须与 `SEMANTIC_BACKEND_MAP` 声明的一致：

```ts
import { createNativeBackend, renderComponentSnapshot, createControlReader } from '@proteus-vue/render-backend'
import { checkComponentSnapshot } from '@proteus-vue/component-ir'

const backend = createNativeBackend(undefined, 'android')
const snap = renderComponentSnapshot(backend, ir, createControlReader(backend.id))
// snap.control === 'GridLayoutManager'（ir 根为 p-grid 时）——readback 即真实产物
const result = checkComponentSnapshot(backend.id, snap) // 控件 readback == 参考表？
```

CI 门禁覆盖 6 后端 × L1 fixtures（`tests/component-conformance.test.ts`）——错映射直接红，`unverified` 诚实标注参考表未覆盖的组合而非放行。验证体系全貌见[一致性验证](/docs/framework/29-conformance)。

## 下一步

- [渲染后端](/docs/framework/23-render-backend)：SPI 契约与六后端全景
- [Flutter 后端](/docs/framework/24-flutter-backend)：同一套语义的另一张映射表
- [一致性验证](/docs/framework/29-conformance)：语义控件映射的门禁
