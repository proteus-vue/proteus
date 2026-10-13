# 07 Web / Skyline 映射：纯 CSS（backdrop-filter + L2）

## 定位

Web / Skyline 无系统级玻璃 API，**靠 `backdrop-filter` + CSS 模拟 L1 + L2**（**纯 CSS，无自定义着色器**）。

---

## ★边界声明（决策 #877 · 2026-10-13）：Web/Skyline 玻璃 = 纯 CSS，不做自绘玻璃

**一句话**：Web/小程序玻璃**固定走 CSS（`backdrop-filter`）**，**不接 `@proteus-vue/shader` 的自绘玻璃遍**，因此**没有 App 端的边缘折射/倒角**——这是**有意的平台边界**，不是未做。

**为什么不上 WebGL/WebGPU 自绘玻璃**（把"为什么"钉在这里，避免反复讨论）：

| 路线 | 结论 | 原因 |
|---|---|---|
| ③ **CSS `backdrop-filter`**（**本项采用**） | ✅ | 走**浏览器合成器的原生快路径**（采样+模糊在 GPU 合成层完成，JS 零成本）⇒ **性能最稳、成本最低、MP 与 Web 同构** |
| ① DOM + 叠一层 WebGL 玻璃 | ❌ 否定 | 玻璃最贵的一步是"**把背后内容变成纹理**"（见 App #862/#863/#864：正是优化它才从 10fps → 59.3fps）。DOM 模型下**没有廉价的背景纹理通道**（`captureStream` 只管 canvas/media；`html2canvas` 是软件栅格，极慢且脆）⇒ 帧率**保证不了**——**着色器再快也堵在背景捕获**，WebGL/WebGPU 都改变不了 |
| ② 整页 canvas 渲染（WebGPU/WebGL） | ⏸ 不做 | 原理上能达 App 同构的帧率 + 真折射，但**要求放弃 DOM/CSS**（≈ Flutter-Web 模型）⇒ a11y/SEO/文本/输入全要在 canvas 重建，是**Web 单开的架构分叉**、MP 跟不了；ROI 低 |

**边界（对业务的承诺）**：
- Web/Skyline **L1 必达**（`backdrop-filter` + tint + radius + border），能力不足降级实色（见 08-degradation）；
- **边缘折射/倒角/明暗自适应** = **原生端（iOS/Android/鸿蒙）自绘玻璃专属**，Web/MP **不承诺**；
- **禁止**在宿主/页面层为 Web 手写玻璃着色器或叠 WebGL 层（与 `check:shader-capability`「宿主无残留手写算法」同纪律）。

**性能判据**：CSS 路线天然走浏览器 GPU 合成快路径；Web 如需量化，按 `check:input-latency` 同口径（帧 p95 ≤ 1 帧预算 @60Hz）测。

> 参考：可行性对比全文见本决策（#877）。若未来 Web 要走"整页 canvas"（路线②），须**先 spike 量化**（覆盖率/实测帧率/成本），**不得**走路线①。

---

## L1：基础玻璃（两端通用）

```css
.pg-glass {
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  background: rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  border: 0.5px solid rgba(255, 255, 255, 0.3);
}
```

## L2：高级质感（CSS 组合）

```css
.pg-glass::before {
  /* 噪点 */
  content: '';
  background: url("data:image/svg+xml,...noise...");
  opacity: 0.05;
}
.pg-glass::after {
  /* 顶部高光边 */
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
}
```

## Skyline 的战略价值：worklet 动态形变

Skyline 支持 **worklet 动画**（60fps，不阻塞主线程）：

```ts
// worklet 驱动玻璃形变（滚动联动）
worklet function onScroll(offset: number) {
  const blur = 10 + offset * 0.5  // 滚动越深越模糊
  glassElement.style.backdropFilter = `blur(${blur}px)`
}
```

**这正是 Proteus 选 Skyline 的战略价值**：Web 端只能靠 CSS 动画，Skyline 可 60fps 动态玻璃。

## Compiler 产物

```html
<!-- Web -->
<div class="pg-glass pg-glass--regular pg-glass--navigationBar">
  <span class="pg-glass__noise"></span>
  <span class="pg-glass__highlight"></span>
  <slot/>
</div>

<!-- Skyline .wxml -->
<view class="pg-glass pg-glass--regular">
  <view class="pg-glass__noise"/>
  <view class="pg-glass__highlight"/>
  <slot/>
</view>
```

IR → Web/Skyline backend 生成对应 DOM/WXML + scoped CSS。

## 浏览器兼容

| 能力 | Chrome | Safari | 微信 WebView |
|------|--------|--------|-------------|
| backdrop-filter | ✅ 76+ | ✅ 18+ | ✅ |
| CSS noise (SVG) | ✅ | ✅ | ✅ |
| @supports | ✅ | ✅ | ✅ |

```css
@supports not (backdrop-filter: blur(1px)) {
  .pg-glass { background: rgba(255,255,255,0.85); }  /* 降级 */
}
```

## 无障碍

```css
@media (prefers-reduced-transparency: reduce) {
  .pg-glass { backdrop-filter: none; background: var(--tint-solid); }
}
```
