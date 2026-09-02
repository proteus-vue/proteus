# 官方后端实现（G-27）

> 五个后端 = 框架自带 Backend 插件，dogfooding 原则（对齐 G-21 原则 #11）。

## 1. VueDomBackend（Web / Skyline）

```ts
import { createRenderer } from '@vue/runtime-core'
const nodeOps = {
  createElement: (tag) => document.createElement(tag),
  insert: (c, p) => p.appendChild(c),
  remove: (c) => c.parentNode?.removeChild(c),
  patchProp: (el, k, prev, next) => el.setAttribute(k, next),
  setText: (el, t) => (el.textContent = t),
}
export const VueDomBackend = createRenderer(nodeOps)
```

- 零自研，复用 Vue 官方管线 [citation:2][citation:10]
- Skyline 端：`createElement` → `skyline.createComponent`

## 2. FlutterBackend（Flutter Engine）

```
Proteus IR → FlutterBackend → Flutter Engine (Embedder API)
                                    ↓
                        Metal / Vulkan / OpenGL / Software
```

- 通过 `FlutterEngineRun` + `FlutterRendererConfig` 接入 [citation:3][citation:7][citation:22]
- `make_current` / `fbo_callback` / `present` 回调对接 [citation:19]
- 复杂动效/图表场景用 Skia/Impeller 保证一致性

## 3. NativeBackend（iOS / Android / 鸿蒙）

| 端 | 映射 |
|----|------|
| iOS | `UIView` / `UIGlassEffect` [G-07] |
| Android | `ViewGroup` / `RenderEffect` |
| 鸿蒙 | `ArkUI Node` / `fractal` |

- 原生事件 → `NormalizedInputEvent`
- 原生体验 + 系统能力直通（G-24/G-25）

## 4. SkiaCanvasBackend（自绘）

- Skia / Canvas2D / WebGL 对接 [citation:16][citation:23]
- `<p-chart>` 等组件代码不变，仅 Backend 切换

## 5. HeadlessBackend（SSR / 测试 / AI）

- 字符串产出（SSR）或虚拟节点树
- **G-23 AI Agent 核心**：无设备跑布局/截图/回归

## 后端对比

| Backend | 布局 | 渲染 | 典型场景 |
|---------|------|------|---------|
| VueDom | CSS/none | DOM | Web/Skyline 开发 |
| Flutter | yoga/自有 | Skia | 复杂动效/一致性 |
| Native | native | 原生 | 原生体验 |
| Skia | none | Skia | 图表/自绘 |
| Headless | none | 虚拟 | SSR/测试/AI |
