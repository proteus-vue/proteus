# @proteus-vue/worklet

> **Skyline 线收口**：worklet（UI 线程动画）统一入口——封装官方 `wx.worklet`，非 Skyline 环境**诚实降级** JS 线程。
> 官方机制来源：`miniprogram-api-typings`（`lib.wx.api.d.ts` Worklet + `lib.wx.skyline.d.ts`）。

## 一句话

**让高频动画（手势/滚动/形变）跑在 Skyline UI 线程；不是 Skyline 就退回 JS 线程，且如实告知（`hasWorklet()` / `real === false`）。**

## 为什么需要

Vue 响应式默认在 JS 主线程。高频路径（滚动、手势、动画）在 JS 线程执行会阻塞 → 掉帧。Skyline 提供 UI 线程 worklet 机制（官方 `wx.worklet` + 组件 `applyAnimatedStyle`），本包把这条官方能力面统一封装，并补上非 Skyline 的降级。

## 用法

```ts
import { shared, timing, applyAnimatedStyle, hasWorklet } from '@proteus-vue/worklet'

const offset = shared(0)
// 组件实例（如 this / 自定义组件）在 Skyline 上绑定 UI 线程样式
const unbind = applyAnimatedStyle(this, '.card', () => ({
  transform: `translateX(${offset.value}px)`,
}))
```

模板侧走官方 WXML 前缀（编译器透传，无需运行时 API）：

```vue
<view worklet:style="{{animatedStyle}}">…</view>
```

## 导出

- `shared` / `derived` — 共享值（官方 `wx.worklet.shared` / `derived`）
- `timing` / `spring` / `decay` — 动画工厂（官方同名）
- `runOnJS` / `runOnUI` — 线程切换（官方同名）
- `applyAnimatedStyle(scope, selector, updater, config)` — 绑定 worklet 驱动样式，返回解绑函数
- `Easing` — 缓动函数集（`linear/quad/cubic/circle/sin/exp/bounce/ease/elastic/bezier/in/out/inOut`；Skyline 优先原生）
- `hasWorklet()` — 是否真实 Skyline worklet 可用
- `getWorklet().real` — 运行时是否真实（false = JS 降级）

## 降级（诚实边界）

| 环境 | 行为 |
|------|------|
| 真·小程序 + Skyline + `wx.worklet` | 官方原生（UI 线程隔离） |
| WebView / Web / SSR | JS 线程：`shared` = 普通对象；`timing/spring` = 占位；`runOnJS/runOnUI` = 直接调用；`applyAnimatedStyle` 一次性应用（**无 UI 线程驱动**） |

调用方应先 `hasWorklet()` / `real` 判断，不可用时用 `capabilityWarn` 显式告知用户（对齐能力铁律 C6：禁止静默失效）。

## 与编译器的关系

- `worklet:xxx` 属性是**官方 WXML 前缀**，编译器原样透传（本轮验证已支持），无需本包参与。
- 函数内 `'worklet'` 指令：官方靠 bundle 工具的静态指令保留（route builder 已用此法）；本包提供**运行时驱动**而非编译期提取。
- 诚实边界：不做「编译期 worklet 提取到独立 UI runtime」的自动隔离（那需要自定义 UI runtime + JSI，超出小程序 Skyline 语义）；Skyline 的 UI 线程由官方引擎管理。
