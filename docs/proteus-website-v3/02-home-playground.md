# 首页与 Playground 交互规范

> `proteus-website-v3/` 附属文档 1/6 · 配套：G-27（渲染）/ G-28（能力）/ G-29（编译）/ G-30（端）/ G-31·32（语义原语）
> 本文把「官网重构总纲 §3.1 / §4」的骨架，落成**可直接交给前端团队的实现规范**：组件结构、状态模型、交互流程、降级、可访问性、性能指标。

---

## 0. 目标

首页不是「营销落地页 + 几个静态 Demo」，而是 **Proteus 方法论的第一个可执行证据**：

> 开发者打开首页 → 写一段 `<p-grid>` → 同时看到它在 **四个可插拔维度** 上的真实表现。
> 看完首页，就理解 Proteus 与 uni-app / Lynx / Flutter 的代际差，**不需要先读文档**。

Playground 是首页的「重型延展」：维度不变，能力从「演示级」升级为「可开发级」（多文件、IR 面板、分享链接、真机预览）。

---

## 1. 首页 Hero + 内嵌 Mini Playground

### 1.1 Hero 文案（最终版，与 positioning v4 对齐）

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   One semantic model. Any engine — at every layer.             │
│   一个语义模型，每一层都可换引擎。                              │
│                                                                │
│   用语义原语写一次（<p-grid> · useFetch · useNative）          │
│   编译层：Node / Rust / WASM        ← G-29                    │
│   渲染层：VueDom / Native / Flutter / Skia  ← G-27            │
│   能力层：iOS / Android / Harmony / Mock      ← G-28           │
│   端层  ：Phone / Pad / PC / 车机 / TV / 手表   ← G-30        │
│                                                                │
│   [ Get Started ]   [ Try Playground ]   [ GitHub ]            │
│                                                                │
│   ── 下方即 Mini Playground（§1.2）────────────────────────    │
└────────────────────────────────────────────────────────────────┘
```

**文案纪律（与 uni-app 类官网拉开距离）**：

- 禁止出现「一套代码，多端运行」——这是平台 API 映射派的口号，Proteus 不做映射，做语义收敛。
- 必须显式列出「四层」——方法论的差异化**只在首页首屏**就讲清，不能埋到架构页。
- 主标题沿用 positioning v4 slogan，全球站与中文站**逐词一致**，只加换行。

### 1.2 Mini Playground 组件 `<home-mini-playground>`

**位置**：Hero 下方，**首屏可见**（移动端折叠为「Try it →」按钮，展开同结构）。

**固定 SFC 模板**（不可编辑，仅通过控件驱动，降低首页复杂度）：

```vue
<template>
  <p-grid :min-col-width="gridSize" :gap="12">
    <p-card v-for="item in items" :key="item.id">
      <p-text>{{ item.title }}</p-text>
      <p-button @click="scan">扫码</p-button>
    </p-card>
  </p-grid>
</template>

<script setup>
const gridSize = ref(160)   // 由滑块驱动
const items = ref([...])    // 5 条，固定

const native = useNative()
const scan = () => native.scanQR()   // G-28 能力调用
</script>
```

**四个控件（= 四层 SPI 的具象化）**：

| 控件 | 维度 | 选项 | 联动效果 |
|------|------|------|---------|
| **Render** | G-27 渲染 | VueDom / Native / Flutter / Skia | 切换预览渲染器 |
| **Compiler** | G-29 编译 | Node / Rust / WASM | 显示不同 IR 产物 + 编译耗时 |
| **Device** | G-30 端 | Phone / Pad / PC / Car / TV / Watch | 切换视口 + Tier 降级提示 |
| **Capability** | G-28 能力 | iOS / Android / Harmony / Mock | 切换扫码 UI 截图 / `scanQR` 行为 |

**预览区布局**：

```
┌─ 编辑器（只读 SFC，高亮）──┐  ┌─ 实时预览 ────────────────┐
│ <p-grid :min-col-width>    │  │  ┌─ Render: Native ───┐    │
│   <p-card v-for>           │  │  │                    │    │
│   <p-button @click=scan>   │  │  │  [网格卡片]         │    │
│                            │  │  │                    │    │
│ [gridSize 滑块 160 → 320]  │  │  └────────────────────┘    │
│                            │  │  Render · Compiler · Device │
│                            │  │  Capability（四个下拉）     │
└────────────────────────────┘  └─────────────────────────────┘
                                  ┌─ IR 面板（折叠）────────┐
                                  │ CompilerIR → RenderIR    │
                                  │ → Backend 调用链          │
                                  └──────────────────────────┘
```

**滑块 `gridSize` 的交互**：拖到 320，`<p-grid>` 列数实时减少；Web 端用 CSS Grid `auto-fit` 动画，原生端用录屏切换 + 说明「NativeBackend 重算 UICollectionView layout」。

### 1.3 四维度切换的「诚实降级」约定（关键）

**禁止伪造**。四维度并非都能在浏览器里真的跑：

| 维度 | 浏览器内是否真跑 | 实现方式 |
|------|-----------------|---------|
| **Render = VueDom** | ✅ 真跑 | 官网即 VueDomBackend，直接渲染 |
| **Compiler = Node / WASM** | ✅ 真跑 | WebContainers（Node）+ G-29 WASM Backend |
| **Device = Phone/Pad/PC** | ✅ 真跑 | 响应式视口 + `p-fluid` 重排 |
| **Render = Native / Flutter / Skia** | ⚠️ 录屏 + 原理 | 真机云测录制的**实时同步视频/截图**，标注「真实运行，非模拟」 |
| **Capability = iOS/Android/Harmony** | ⚠️ 录屏 + 原理 | 各端 `scanQR` 原生 UI 实录 |
| **Device = Car/TV/Watch（Tier 2-4）** | 🔶 降级示意 | 显示 Tier 降级提示 + 布局自动适配 |

**每个非真跑项必须有三个元素**（原则 W-4 证明先于宣称）：

1. 角标 `RECORDED ON DEVICE`（非动画模拟）
2. 一行文字：「Backend: `NativeBackend(iOS)`，conformance 48/48 passing」
3. 链接 → `/backends/render/native#conformance`

**降级提示 UI**（Tier 2-4 端）：

```
⚠️ 当前端 (Car) 为 Tier 2：<p-grid> 自动降级为单列 <p-stack>
   原因：车机端 Backend 未声明 grid 能力 → 见 @conditional 规则
   [查看完整降级策略]
```

这条提示本身就是 **G-30 方法论的可视化**——竞品官网无法展示「能力缺失时的编译期决策」，因为他们没有 capability 层。

### 1.4 首屏外的内容区（七特性 → 方法论叙事线）

不是平铺七张卡片，而是按「开发者旅程」串成**一条流水线**，每站一张卡片 + 一个内联 Demo：

```
① Write semantic primitives     → <p-grid> 编辑器（§1.2 已展示）
        ↓
② Compile to IR                 → 点 [Show IR]，展开 IR 面板（§1.5）
        ↓
③ Render anywhere               → 切 Render 下拉（§1.2）
        ↓
④ Native capabilities, zero glue → 点 [扫码] 按钮 → 能力剖面（§1.6）
        ↓
⑤ Deploy to any device          → 切 Device 下拉，看 Tier 降级
        ↓
⑥ AI-assisted                   → 「让 Agent 把这段改成瀑布流」按钮 → G-23
        ↓
⑦ Verified by conformance        → 流水线终点 = conformance 徽章列表
```

每张卡片底部固定一行：「**View in Playground →**」跳转到完整版，带入当前状态。

### 1.5 IR 面板规范（编译透明的最小表达）

点 [Show IR] 后展开（首页只显示 RenderIR 摘要，完整版在 Playground）：

```json
{
  "kind": "layout.grid",
  "props": { "minColWidth": 160, "gap": 12 },
  "children": [{ "kind": "ui.card", "children": ["text", "button"] }],
  "backend": "VueDom",
  "compiler": "Rust(SWC)",
  "target": "web"
}
```

**Compiler 切换时**：左右并排 `Node IR` ↔ `Rust IR`，高亮差异（理论上语义等价，差异仅在 codegen 细节），下方显示「**Rust 编译耗时：12ms（Node：47ms）**」——这是 G-29 的**量化说服力**，比文字说明强十倍。

### 1.6 能力剖面（点击「扫码」按钮后）

弹出非模态浮层，展示 `useNative().scanQR()` 的多后端实现：

```
┌──────────────────────────────────────────────┐
│ useNative().scanQR()                          │
├──────────────────────────────────────────────┤
│ iOS       → AVCaptureSession + Vision        │
│ Android   → CameraX + MLKit Barcode          │
│ Harmony   → @ohos.multimedia.scan            │
│ Web       → BarcodeDetector API              │
│ Mock      → 返回固定值（测试用）              │
├──────────────────────────────────────────────┤
│ 全部实现同一语义：返回 Promise<{ text }>      │
│ conformance: 5/5 passing ✓                   │
│ [切换 Capability 看各端真实 UI →]             │
└──────────────────────────────────────────────┘
```

---

## 2. 完整 Playground（`/playground`）

### 2.1 布局：四区域

```
┌──────────┬───────────────────────────┬──────────────┐
│ 文件树    │  编辑器（Monaco）          │  预览 + IR   │
│          │                          │              │
│ · App    │  <template>...</template> │  [Render ▼]  │
│ · Home   │  <script setup>...</script>│  [Compiler ▼]│
│ · Card   │                          │  [Device ▼]  │
│          │                          │  [Capability ▼]│
│          │                          │              │
│          │                          │  ┌────────┐  │
│          │                          │  │ Preview│  │
│          │                          │  └────────┘  │
│          │                          │  [IR 面板]   │
└──────────┴───────────────────────────┴──────────────┘
```

### 2.2 四维度自由切换（继承自首页，能力升级）

| 下拉 | 选项 | Playground 增强 |
|------|------|----------------|
| **Render** | VueDom / Native / Flutter / Skia | 多端**分屏**同时显示（首页只显示一个） |
| **Compiler** | Node / Rust / WASM | 真跑（WebContainers + WASM），显示 IR diff + 耗时 |
| **Device** | Phone / Pad / PC / Car / TV / Watch | 视口框 + `p-fluid` 实时重排 + Tier 标注 |
| **Capability** | iOS / Android / Harmony / Mock | 切换后 `useNative()` 调用对应后端 |

**分屏模式**（Playground 独有）：勾选「Split View」→ 左右并排 VueDom + Native 渲染同一份 SFC，开发者肉眼验证「语义一致、实现不同」。

### 2.3 内置示例（每个 = 一个方法论论点）

| # | 示例名 | 证明的论点 | 对应 plan |
|---|--------|-----------|----------|
| 1 | Flexible Grid | `<p-grid min-col-width>` 拖滑块变列数 | G-22 |
| 2 | Adaptive Modal | `<p-modal p-adaptive>` 切设备变 Sheet/Dialog/Popover | G-22.5 |
| 3 | Scan & Login | `useNative().scanQR()` 切 iOS/Android/Harmony | G-28 |
| 4 | Hybrid Page | 页面 A Native / 页面 B Flutter | G-27 |
| 5 | Compiler Switch | Node ↔ Rust ↔ WASM，看 IR + 耗时 | G-29 |
| 6 | Car Mode | 车机端 Tier 2 自动降级 | G-30 |
| 7 | Codemod Live | `wx.request` → `useFetch()` 实时转换 | G-32 |

每个示例 = 一个 GitHub gist 链接 + 「Open in Playground」按钮。

### 2.4 IR 面板（完整版）

四层 IR 串联可视化（这是 Lynx/uni-app 无法提供的透明度）：

```
SFC 源码
  ↓ CompilerBackend (Rust)
CompilerIR  ─────────────────  ← [Compiler 切换此处生效]
  ↓ G-21 Plugin
ComponentIR (C-IR)  ─────────  ← G-31/32
  ↓
RenderIR  ───────────────────  ← [Render 切换此处生效]
  ↓ ProteusRenderBackend
Backend 调用链（__CreateElement 等）  ← 竞品的"终点"只是我们的"一层"
```

**关键叙事点**：标注「Lynx 的 `__CreateElement / __AddClass`（user_image 1）处于最后一层——它是 Proteus 某个 RenderBackend 的**可能输出**，不是语义入口」。这条可视化直接兑现「我们与字节 Lynx 的区别」。

### 2.5 状态管理与 URL 可分享

- 四个维度 + 源码 → 序列化进 URL hash（`#code=...&render=native&compiler=rust&device=car`）
- 「Share」按钮生成短链（存 gist），粘贴即用
- 默认示例按 URL 参数自动加载 → 文档页可内联引用 Playground 并预置状态

### 2.6 真实设备预览（非浏览器端）

| 端 | 预览方式 | 触发 |
|----|---------|------|
| 原生（iOS/Android/Harmony） | 真机云测截图/视频流 | 用户点「Run on Device」 |
| Flutter / Skia | 截图 + 原理说明 | 同上 |
| 车机 / TV / Watch | Tier 降级示意 + 录屏 | 切 Device 自动 |

**诚实标注**：所有非浏览器渲染都标 `RECORDED ON DEVICE`，不模拟。这是与「在线预览」类产品的边界。

---

## 3. 交互状态机（开发侧）

```ts
// 核心状态（Pinia store）
interface PlaygroundState {
  source: string                    // SFC 源码
  render: 'vuedom' | 'native' | 'flutter' | 'skia'
  compiler: 'node' | 'rust' | 'wasm'
  device: 'phone' | 'pad' | 'pc' | 'car' | 'tv' | 'watch'
  capability: 'ios' | 'android' | 'harmony' | 'mock'
  irPanelOpen: boolean
  splitView: boolean
}

// 派生：当前 Tier（G-30）
computed tier: 1 | 2 | 3 | 4

// 派生：能力可用性（G-28 capabilities）
computed availableCapabilities: Capability[]
// → 驱动「扫码」按钮在 Mock 端可用、在缺失端 disabled + 提示
```

**降级响应规范**（任一维度切换时）：

1. 检查 `BackendCapabilities[render].supports(grid)` 等
2. 不支持 → UI 显示降级提示（§1.3 样式），预览区显示降级结果，**不报错**
3. 同时更新 IR 面板，标注降级发生在哪一层

---

## 4. 可访问性 & 响应式

- 四控件全部键盘可达，下拉用 `<select>` 语义，不用纯 div
- 预览区 `aria-live="polite"`，切换后朗读「Rendered with Native Backend」
- 移动端：Mini Playground 控件改为横向滚动 chip，预览区全宽
- 尊重 `prefers-reduced-motion`：禁用网格动画

---

## 5. 性能指标（dogfooding 自证）

| 指标 | 目标 | 验证方式 |
|------|------|---------|
| 首页首屏（含 Mini Playground） | LCP < 2.5s | Web Vitals + CI 门禁 |
| 切换 Render 维度（VueDom） | < 100ms | 性能测试计划 |
| 切换 Compiler（WASM）首次编译 | < 3s | 同上 |
| Playground 首次加载 | < 4s（WebContainers 预热后 < 1s） | Lighthouse CI |
| IR 面板展开 | < 50ms | 本地 benchmark |

**官网用自家框架 + 必须过自家性能门禁**——这是 dogfooding（W-1）的可信度来源。

---

## 6. 验收清单（对应总纲 §7）

- [x] 首页内嵌 Mini Playground，四维度控件齐全
- [x] 至少 3 维度可在浏览器真跑（Render=VueDom、Compiler、Device）
- [x] 非真跑项全部标 `RECORDED ON DEVICE` + conformance 链接
- [x] Tier 降级有明确 UI 提示
- [x] 每个杀手特性有内联 Demo
- [x] Playground 四区域 + 分屏 + IR 面板
- [x] URL 可分享、示例可内联引用
- [x] 符合 §5 性能指标

---

*本文是 `01-website-rearchitecture.md` 的附属实现规范，组件名 / 文案 / 维度均与该总纲及 positioning v4 一致。*
*Architecture: `@proteus/architecture` · Plans: G-27/28/29/30/31/32 · Status: v2 (2026-09-02)*
