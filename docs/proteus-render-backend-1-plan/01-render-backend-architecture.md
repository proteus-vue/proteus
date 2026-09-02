# Proteus 可插拔渲染后端架构（G-27）

> **一句话定位**：Proteus 不自研布局算法、不自研渲染引擎，而是在"响应式/组件/语义"之上构建一个**渲染后端无关的上层模型**——通过统一的 `ProteusRenderBackend` 接口，让 **Vue Custom Renderer、Flutter Engine（Embedder）、原生 UIKit/Jetpack/ArkUI、Canvas/Skia、Web DOM** 等任意底层渲染引擎成为可插拔的实现。上层业务零修改，仅换 Backend 即可切换渲染底座。

---

## 0. 为什么这件事是架构级决策（而不只是一个适配层）

### 0.1 三种路线的本质分野

| 路线 | 代表 | 布局 | 渲染 | 跨端一致性 | 原生体验 |
|------|------|------|------|-----------|---------|
| **A. 自绘引擎** | Flutter | 自带（Yoga-like / Impeller） | 自带（Skia/Impeller） | ★★★★★ | ★★（一致性优先） |
| **B. 原生映射** | RN、uni-app、KuiKly | 原生（Yoga/原生布局） | 原生控件 | ★★ | ★★★★★ |
| **C. 上层模型 + 可插拔后端**（**Proteus**） | — | **后端决定**（Yoga/原生/自绘均可） | **后端决定** | **可高可低，按需选择** | **可高可低，按需选择** |

> **关键洞察**：A 和 B 都是在"自绘 vs 原生"里二选一，被迫取舍。
> **Proteus 的 C 路线把选择权交给业务和场景**——同一个 `<p-card>`，手机用原生控件（体验优先），复杂动效用 Skia（一致性+性能优先），开发期用 DOM（热更新优先）。**一套语义，多种渲染底座，按需切换。**

### 0.2 业界已验证的先例（说明这条路走得通）

这不是拍脑袋，而是已被主流框架验证过的分层范式：

- **Vue 3 `@vue/runtime-core`**：渲染管线四阶段中，自定义渲染器**只替换"宿主平台操作"一环**，前三个阶段（响应式追踪、VNode 生成、Diff/patch 决策）完全不变，通过 `RendererOptions`（`nodeOps`）注入 [citation:2][citation:6][citation:10]。`createRenderer(nodeOps)` 即可渲染到 Canvas、终端、Three.js（TresJS）[citation:14][citation:18]。
- **Flutter Embedder**：引擎本身是 window toolkit agnostic，通过**稳定的 C ABI**（`embedder.h`）暴露 `FlutterEngineRun`、`FlutterRendererConfig`、`FlutterProjectArgs`，官方支持的平台（iOS/Android）和第三方平台（OpenHarmony、Tizen、嵌入式 Linux）走的**是同一套 Embedder 模式——接口一致，仅底层实现不同** [citation:3][citation:7][citation:11]。鸿蒙 `flutter_flutter`、三星 Tizen 都是靠 Embedder 接入 [citation:15]。
- **RN Fabric**：把 Shadow Tree、布局（Yoga）、Mounting 提到 C++ Core，跨平台共享，新平台（VR 等）更容易采纳 [citation:5][citation:17]。
- **MAUI Graphics / Uno Platform**：定义 `ICanvas`/`AbstractCanvas` 统一接口，下接 Skia、Android Canvas、Win2D、Blazor——**每个平台实现一套，上层共享** [citation:12][citation:20]。

**结论：Proteus 不是发明新模式，而是把这套已被验证的"核心/后端分离"范式，与自身的"语义收敛（原则 #10）"方法论结合到极致。**

---

## 1. 核心设计：`ProteusRenderBackend` 接口

### 1.1 分层架构

```
┌─────────────────────────────────────────────────────┐
│  业务层：SFC / Vue 组件 / p-* 语义原语              │  ← 开发者写一次
├─────────────────────────────────────────────────────┤
│  上层模型（Backend-Agnostic，不自研布局/渲染）       │
│   ├─ @vue/reactivity（响应式，平台无关）             │
│   ├─ Vue VNode / Diff / Patch 决策（runtime-core）  │
│   ├─ LayoutConstraint IR（G-22，语义级，非像素）    │
│   └─ ★ ProteusBackend SPI（统一接口契约）           │
├─────────────────────────────────────────────────────┤
│  渲染后端（Pluggable，可插拔、可替换）               │
│   ├─ VueDomBackend      ← Web DOM / Vue CustomRender │
│   ├─ FlutterBackend     ← Flutter Engine (Embedder) │
│   ├─ NativeBackend      ← UIKit / Jetpack / ArkUI   │
│   ├─ SkiaCanvasBackend  ← Skia / Impeller / Canvas2D│
│   └─ HeadlessBackend    ← SSR / 测试 / 截图         │
└─────────────────────────────────────────────────────┘
```

### 1.2 接口契约（最小完备集）

```ts
// ProteusRenderBackend —— 后端只需实现这套接口即可接入
export interface ProteusRenderBackend {
  readonly id: string          // 'vue-dom' | 'flutter' | 'native-ios' | 'skia'
  readonly capabilities: BackendCapabilities  // 能力声明（G-22 CapabilityRegistry 复用）

  // —— 节点操作集（对齐 Vue nodeOps，是业界事实标准）——
  createElement(node: IRNode): NodeHandle
  insert(child: NodeHandle, parent: NodeHandle, anchor?: NodeHandle): void
  remove(child: NodeHandle): void
  patchProp(el: NodeHandle, key: string, prev: unknown, next: unknown): void
  setText(el: NodeHandle, text: string): void

  // —— 布局（可选：后端可自带布局器，否则走框架 IR 求解）——
  measure?(node: NodeHandle, constraints: LayoutConstraints): Size
  layout?(root: NodeHandle, constraints: LayoutConstraints): void

  // —— 渲染提交（帧调度）——
  scheduleFrame?(task: () => void): void
  flush?(): void               // 批量提交，减少跨端开销（对齐 Fabric Mounting）

  // —— 输入事件（后端把平台事件归一化为 Proteus 事件）——
  dispatchInput?(event: NormalizedInputEvent): void

  // —— 生命周期钩子 ——
  onMount?(root: NodeHandle): void
  onUnmount?(root: NodeHandle): void
}
```

> **设计要点**：接口刻意对齐 Vue `nodeOps`（`createElement/insert/remove/patchProp/setText`）[citation:6][citation:10]，使 **Vue Custom Renderer 本身就是零成本的一个 Backend 实现**——这是复用生态的关键。

### 1.3 能力协商（对齐 G-22 CapabilityRegistry）

```ts
// 每个后端声明自己能做什么，框架按能力降级（不按 if/else 判断平台）
interface BackendCapabilities {
  layout: 'yoga' | 'native' | 'none'   // 谁负责布局
  blur: 'true' | 'approximate' | 'none' // 对应 G-07 Glass 能力矩阵
  glass: 'L3' | 'L2' | 'L1' | 'none'
  animation: 'native' | 'js' | 'none'
  textureSharing: boolean               // 原生视图混合（PlatformView）
  remoteRendering: boolean              // TV/车机跨进程渲染
}
```

框架根据后端声明的能力**自动选择最优路径**，这正是 G-07（Glass）、G-22（Fluid）、G-25（设备适配）已有的"能力协商"范式的延伸——**一致性是架构的副产品**。

---

## 2. 五个官方后端实现（核心能力 = 官方插件，对齐 G-21 原则 #11）

> **dogfooding**：这五个后端**本身就是框架自带的 Backend 插件**，外部开发者用同一套 SPI 接入自有引擎。这保证了 SPI 的完备性——框架自己就是最大的后端使用者。

### 2.1 VueDomBackend（Web / Skyline）

```ts
// 本质：把 nodeOps 映射到 DOM（Web）或 Skyline 原生组件（小程序）
import { createRenderer } from '@vue/runtime-core'
const nodeOps = {
  createElement: (tag) => document.createElement(tag),  // Web
  // createElement: (tag) => skyline.createComponent(tag) // Skyline
  insert: (child, parent) => parent.appendChild(child),
  patchProp: (el, key, prev, next) => el.setAttribute(key, next),
  // ...
}
export const VueDomBackend: ProteusRenderBackend = createRenderer(nodeOps)
```

- **零自研**：直接复用 Vue 官方渲染管线，框架不下场造轮子 [citation:2][citation:10]。
- Web/Skyline 端样式 → CSS `clamp()`/`vw`（G-22 流式尺寸），**无 JS 开销**。

### 2.2 FlutterBackend（Flutter Engine 接入）

```
Proteus IR → FlutterBackend → Flutter Engine (Embedder API)
                                    ↓
                        Metal / Vulkan / OpenGL / Software  ← 后端自动选
```

- **机制**：通过 Flutter 的 **Embedder C ABI**（`FlutterEngineRun` + `FlutterRendererConfig`）接入 [citation:3][citation:7][citation:22]，把 Proteus 的 `ProteusRenderBackend` 调用桥接到 `FlutterRendererConfig` 的 `make_current / fbo_callback / present` 回调 [citation:19]。
- **收益**：复杂动效、自定义绘制、游戏化 UI 场景，用 Skia/Impeller 保证**跨端一致性**（对齐 Flutter 自绘优势）。
- **布局**：可直接复用 Flutter 的 Yoga/C++ 布局层，或走框架 IR 求解——**后端可选**。

### 2.3 NativeBackend（iOS / Android / 鸿蒙）

- **iOS**：`createElement('p-card')` → `UIView`；`patchProp('blur', ...)` → `UIGlassEffect`（G-07）
- **Android**：→ `ViewGroup` / `RenderEffect`
- **鸿蒙**：→ `ArkUI Node` / `fractal`
- **事件**：后端把原生事件归一化为 Proteus 标准事件（`NormalizedInputEvent`），上层不感知平台。
- **收益**：原生体验 + 系统能力直通（G-24 系统集成、G-25 车机/TV/手表）。

### 2.4 SkiaCanvasBackend（自绘 / 小程序 2D / 图表）

- 当场景需要**像素级一致**（图表、设计稿还原、小程序 Canvas）时，切到 Skia 后端。
- 对接 Skia/Canvas2D/WebGL，复用 WAL（窗体抽象层）+ EGL/EAGL 上下文绑定 [citation:16][citation:23]。
- **上层 `<p-chart>` 等组件代码不变**，仅 Backend 切换。

### 2.5 HeadlessBackend（SSR / 测试 / 截图 / AI）

- 产出字符串（SSR）或虚拟节点树（测试/截图断言）。
- **G-23 AI Agent 的核心**：Agent 可在 Headless 模式下运行布局 IR、读取快照、做视觉回归，**不依赖真实设备**。

---

## 3. 关键机制

### 3.1 布局归属：谁说了算？

```
        框架 IR 求解（G-22）        后端自带布局器（Yoga/原生）
                    ↘                ↙
        ┌──────────────────────────────────────┐
        │  Backend.capabilities.layout          │
        │   = 'yoga'  → FlutterBackend 自己算  │
        │   = 'native' → NativeBackend 走系统   │
        │   = 'none'   → 框架按 IR 语义求解     │
        └──────────────────────────────────────┘
```

**原则：框架定义语义（p-grid/p-fluid），具体求解交给后端最擅长的方式。** 这正是"不自研布局算法"的含义——**Yoga、原生布局系统、CSS Grid 都是现成的，框架只负责选和映射**。

### 3.2 渲染后端热切换（开发期核心体验）

```ts
// 同一份 App，仅换 Backend
const app = createProteus(App, {
  backend: process.env.PROTEUS_BACKEND  // 'vue-dom' | 'flutter' | 'native' | 'skia'
})
```

| 场景 | Backend | 原因 |
|------|---------|------|
| 开发期 HMR | `vue-dom` | 秒级热更新 |
| 生产-普通页面 | `native-ios/android` | 原生体验 |
| 生产-复杂动画页 | `flutter` / `skia` | 一致性+性能 |
| 单元测试 | `headless` | 无 UI 依赖 |
| SSR | `headless`（字符串） | SEO |

> **这是 Proteus 相对 Flutter/RN 的差异化杀手点**：Flutter 绑定 Skia、RN 绑定原生，二者都**无法在同一个 App 内按页面自由切换渲染底座**。Proteus 可以。

### 3.3 编译器集成（对齐 G-21 Compiler Plugin）

- Backend 实现**本身就是 Compiler Plugin**（原则 #11），通过 `codegen` 钩子生成后端绑定代码（对齐 Fabric CodeGen / Flutter CodeGen 思路 [citation:5][citation:9]）。
- `--backend flutter` → 生成 Dart/Engine 绑定 + AOT
- `--backend native-ios` → 生成 ObjC++ 组件 + Pod 配置
- `--backend headless` → 生成 SSR/测试桩

### 3.4 混合渲染（Texture Sharing）

复杂场景允许**一个页面内多 Backend 共存**（对齐 Flutter PlatformView / RN 原生混合 [citation:16]）：

```
<p-modal>                ← NativeBackend（原生弹窗，交互优先）
  <p-chart/>             ← SkiaCanvasBackend（自绘图表，一致性优先）
  <p-webview/>           ← VueDomBackend（嵌入 Web 内容）
</p-modal>
```

后端间通过**纹理共享**（GPU Texture / `registerExternalTexture` [citation:11]）合成，避免跨进程拷贝。

---

## 4. 与既有体系的协同（一句话映射）

| 既有模块 | 协同方式 |
|----------|---------|
| **原则 #10**（统一语义 + 原生实现） | **本架构是原则 #10 的终极兑现**——语义收敛到 Backend 无关的上层模型，实现全交给后端 |
| **G-07 Glass** | `glass: 'L3'\|'L2'\|'L1'` 映射为各后端能力（UIKit/ArkUI/blur()） |
| **G-09 SafeArea** | 后端把 `safeAreaInsets` 注入 IR，框架只消费 |
| **G-16 Style Safety** | Validator 在 Backend 无关层拦截，后端实现只负责合法属性 |
| **G-21 Compiler Plugin** | Backend 实现 = 官方插件，codegen 钩子生成绑定 |
| **G-22/22.5 Fluid/Adaptive** | `p-grid/p-adaptive` 语义 → 后端自有布局器或框架 IR 求解 |
| **G-23 AI Agent** | HeadlessBackend 让 Agent 在无设备环境跑布局/截图/回归 |
| **G-24/25 全终端** | 同一 Backend SPI 覆盖手机/PC/车机/TV/手表，后端按端选最优 |

---

## 5. 严格规则（新增，对齐铁律风格）

| 规则 | 级别 | 说明 |
|------|------|------|
| **RND001** | error | 禁止在业务代码中直接调用任何后端专有 API（UIKit/Android/Skia）；必须走 `p-*` 语义或 Backend SPI |
| **RND002** | error | 新增后端必须完整实现 `ProteusRenderBackend` 接口并通过 `backend-conformance-test` |
| **RND003** | error | 布局语义不得硬编码为某后端算法；必须声明 `capabilities.layout` 由框架协商 |
| **RND004** | warning | 同一 App 混合多后端时，须明确纹理/事件边界，避免循环合成 |
| **RND005** | error | Backend 不得在 IR 层之外擅自修改组件树结构（保证上层可预测） |

---

## 6. 对标竞品（本质差异）

| 框架 | 后端可插拔？ | 同 App 多后端 | 布局归属 | 结论 |
|------|------------|--------------|---------|------|
| Flutter | ⚠️ 仅 Embedder（同一引擎） | ❌ 绑定 Skia | 自带 | 引擎绑定死 |
| RN | ⚠️ Fabric（原生绑定） | ❌ 绑定原生 | Yoga | 原生绑定死 |
| uni-app | ❌ | ❌ | 平台默认 | 无抽象 |
| KuiKly | ❌（编译期产物） | ❌ | 原生 | 无运行时切换 |
| **Proteus** | **✅ 任意后端（SPI）** | **✅ 按页面切换** | **后端决定 + 框架 IR 兜底** | **唯一"渲染底座自由"** |

---

## 7. 收益总结（对外话术）

> **Proteus 是唯一一个"渲染底座自由"的跨端框架：不自研布局、不自研渲染，而是构建了一个渲染后端无关的语义上层模型。Vue、Flutter、原生 UIKit/Jetpack/ArkUI、Skia、SSR——任意引擎通过统一 SPI 插拔；同一 App 可按页面在"原生体验"与"自绘一致性"间自由取舍。这是把 Vue Custom Renderer、Flutter Embedder、RN Fabric 的"核心/后端分离"范式，与原则 #10 的"语义收敛 + 原生映射"方法论结合到极致。**

---

## 8. 待办（落地路径，详见 06-integration-batches.md）

- **B1（推荐首发）**：定义 `ProteusRenderBackend` TypeScript 接口 + `BackendCapabilities` + `backend-conformance-test`（纯逻辑，零依赖，可单测）——**最小可运行 MVP**
- **B2**：实现 `VueDomBackend`（直接复用 `createRenderer`，验证 SPI 可行性）
- **B3**：实现 `HeadlessBackend` + G-23 AI Agent 布局回归闭环
- **B4**：实现 `NativeBackend`（iOS UIKit 先行，验证 nodeOps → UIView 映射）
- **B5**：实现 `FlutterBackend`（Flutter Engine Embedder C ABI 接入，验证跨引擎）
- **B6**：混合渲染（Texture Sharing）+ DevTools Backend 可视化

详见分批文档。**B1 验证"接口完整性"，B2 验证"Vue 生态零成本复用"，B4+B5 验证"原生与自绘双通"——这是证明整条路线走得通的三个关键里程碑。**
