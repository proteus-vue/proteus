# 07 Web / Skyline 映射：CSS + Shader 模拟

## 定位

Web / Skyline 无系统级玻璃 API，**靠 `backdrop-filter` + CSS/Shader 模拟 L1 + L2**。

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
