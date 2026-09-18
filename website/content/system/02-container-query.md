---
title: 容器查询：按容器求解
order: 2
group: 柔性系统
---

# 容器查询：按容器求解

> 响应式基准 = **容器**，不是视口。车机分屏、平板分栏、嵌入卡片、多窗口——组件按自己实际分到的容器宽度求解，而不是窗口宽度。

## 视口断点为什么失效

组件不该关心自己被放进多大的窗口，只该关心自己分到多宽的容器：

| 场景 | 视口断点（`@media`） | 容器求解（Fluid） |
|---|---|---|
| 全屏页面 | ✅ 碰巧正确 | ✅ 正确 |
| 平板分屏（两面板各占一半） | ❌ 两个面板都按整屏宽求解 | ✅ 各按面板宽求解 |
| 卡片 / 仪表盘嵌入 | ❌ 视口再宽卡片也只有 300px | ✅ 按卡片宽求解 |
| 多窗口 / 折叠屏 | ❌ 布局结构无感知 | ✅ 容器变化即重算 |
| App 原生端 | ❌ 无 `@media` 对等物 | ✅ 同一 FluidContext 状态模型跨端 |

## createContainerQuery：真实 API

`createContainerQuery` 来自 `@proteus-vue/fluid`（纯逻辑、零依赖；ResizeObserver 以工厂注入，单测可传 fake 直接驱动尺寸）：

```ts
import { createContainerQuery } from '@proteus-vue/fluid'

const query = createContainerQuery(el, {
  designWidth: 375,       // 设计稿宽度（断点推导基准，缺省 375）
  breakpoints,            // 自定义容器断点 [{ name, min }]；缺省按比例推导
  createObserver,         // 尺寸观察器工厂（缺省 globalThis.ResizeObserver；无则 no-op）
  readSize,               // 初始尺寸读取器（测试注入）
})

query.get()   // 当前 FluidContextState（快照）
query.subscribe((state) => { /* 订阅变化；立即回调一次；返回取消函数 */ })
query.destroy() // 释放观察器与全部订阅
```

状态模型 `FluidContextState`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `width` / `height` | number | 容器尺寸（px） |
| `orientation` | `'portrait' / 'landscape'` | 方向（height > width → portrait） |
| `breakpoint` | `'sm' / 'md' / 'lg' / 'xl'` | **容器级**断点名（非视口） |

缺省断点由设计稿宽度按比例推导（`deriveContainerBreakpoints`：sm 0.5 / md 0.875 / lg 1.25 / xl 1.625）——375 设计稿 → sm 188 / md 328 / lg 469 / xl 609。要自定义档位就传 `breakpoints`，或用导出的 `resolveBreakpoint(width, breakpoints)` 手动求解。

## 按视口 vs 按容器：同一需求的两种写法

手写 JS 宽度分支（FLD008 禁止）：

```ts
// ❌ 手动监听 resize + 魔法数——组件放进分屏 / 卡片后全部失效
window.addEventListener('resize', () => {
  mode = window.innerWidth < 768 ? 'stacked' : 'split'
})
```

容器求解：

```ts
// ✅ 声明阈值，运行时按容器求解
const query = createContainerQuery(el, { designWidth: 375 })
query.subscribe((s) => {
  mode = s.width >= 640 ? 'split' : 'stacked'
})
```

差别不在代码量，在**求解基准**：前者看窗口，后者看元素自己。同一份组件放进全屏、分屏、卡片，容器求解全部自动正确——这正是 `p-split` / `p-sidebar` 内部的写法。

## 组件内部怎么用它

框架自己的柔性组件全部构建在这一个运行时上：

| 组件 | 求解逻辑 |
|---|---|
| `p-split` | `s.width >= minSplitWidth` → `split`（并排），否则 `stacked`（堆叠） |
| [p-sidebar](/docs/system/04-sidebar) | `isWide = s.width >= minSidebarWidth`，与用户展开意图**正交**合成三态 |
| `p-zone` | `s.breakpoint`（sm/md/lg/xl）→ 渲染对应命名插槽 |
| `p-adaptive` | `createAdaptiveController` 复用同一容器查询，按形态区间求解 |

组件薄壳只做「状态桥接」，求解逻辑全部在 fluid 包纯函数层——这也是它们能被单测精确覆盖的原因（fake 观察器 fire 尺寸即驱动状态机）。

## 统一断点入口与设备环境

- `createSizeAwareObserver(el)`：**容器级 + 视口级 + 方向**一次订阅。状态含 `containerWidth` / `containerBreakpoint` / `viewportWidth` / `viewportBreakpoint` / `orientation`——容器变化走 ResizeObserver，视口变化走 window resize / orientationchange（目标可注入）。需要「容器和窗口都看」的场景用它。
- `createDeviceEnv()`：设备环境信号——折叠形态 `displayMode`（`standard / fold / span / expand`）、`isDriveMode`（车机宿主注入）、`prefersReducedMotion`、`orientation`，从 matchMedia 采集并订阅变化（matchMedia 可注入）。

## 降级与可测性

- **无 ResizeObserver 环境**（小程序逻辑层）：观察器退化为 no-op，组件落静态兜底——`p-split` 恒堆叠、`p-sidebar` 恒 collapsed、`p-zone` 恒 sm。渲染端自决降级，不崩（铁律 G-22.2「朴素但正确」）。
- `detectFluidCapabilities().containerQuery` 用 `CSS.supports` 探测容器查询能力（`container-type: inline-size`）；无探测条件（MP 逻辑层 / SSR）时假设全支持。
- 一切依赖皆可注入：`createObserver` 工厂、`readSize` 初始尺寸、matchMedia、resize 目标——纯逻辑零 DOM 依赖，Node 环境可单测。

## 下一步

- [柔性网格](/docs/system/03-fluid-grid)：p-grid 只声明最小列宽，纯 CSS 求解
- [自适应侧边栏](/docs/system/04-sidebar)：三态状态机 + 车机 d-pad 焦点
- [柔性系统总览](/docs/system/01-overview)：回到全景
