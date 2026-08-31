# 五端映射细则

两份能力在各端的**具体实现规范**，供 App Renderer / Compiler 落地参照。

## 1. 纪念日灰度

### Web

```css
/* 常态构建即含，日期命中加 class */
html.proteus-memorial,
html.proteus-memorial * {
  filter: grayscale(100%);
  -webkit-filter: grayscale(100%);
}
/* IE9- 兜底（极低概率，可选） */
@media all and (-ms-high-contrast: none) {
  html.proteus-memorial { filter: url("data:image/svg+xml;utf8,<svg...><feColorMatrix .../></svg>#g") }
}
```

**关键**：挂 `<html>` 而非 `body`，且不破坏 flex 布局（Web 对根 filter 处理成熟）。

### Skyline / 微信小程序

```css
/* ❌ 禁止：page { filter } → flex 失效 */
/* ✅ 正确：根容器 */
.proteus-memorial-root {
  filter: grayscale(1);
}
```

Compiler 自动给页面根节点加 `proteus-memorial-root` class，不污染 `page`。

### iOS

```swift
// 覆盖层方案（非私有 API，审核安全）
func applyMemorial(_ on: Bool) {
  if on {
    let cover = UIView(frame: window.bounds)
    cover.backgroundColor = .lightGray
    cover.isUserInteractionEnabled = false
    cover.layer.compositingFilter = "saturationBlendMode"
    cover.layer.zPosition = .greatestFiniteMagnitude
    cover.tag = 999_001
    window.addSubview(cover)
  } else {
    window.viewWithTag(999_001)?.removeFromSuperview()
  }
}
```

**禁止** `CAFilter` / `window.layer.filters` —— 私有 API，审核风险。

### Android

```kotlin
// 全局默认（普通页面）
fun applyMemorial(on: Boolean) {
  val paint = Paint().apply {
    colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) })
  }
  window.decorView.setLayerType(
    if (on) View.LAYER_TYPE_HARDWARE else View.LAYER_TYPE_NONE, paint
  )
}
// 特殊容器（WebView/视频）选择性排除 → GrayManager.setLayerGrayType(view)
```

**坑点**：`LAYER_TYPE_HARDWARE + ColorMatrix` 方案对 WebView、视频有视觉异常，需走"全局默认 + 特殊容器降级"。

### 鸿蒙

```typescript
@Entry @Component
struct Root {
  @State gray: number = 0
  // gray 桥接到 useMemorialState()
  build() {
    Column() { /* ... */ }
      .width('100%').height('100%')
      .grayscale(this.gray) // 1 = 全灰, 0 = 彩色
  }
}
```

ArkUI 原生 `.grayscale()` / `.saturate(0)`，最省心。

## 2. 骨架屏

### Web

Compiler 把骨架 IR 序列化为内联 HTML + CSS，注入 `<head>` 的 `#app` 之前：

```html
<div id="__proteus_skeleton__" data-route="/">
  <div class="p-block" style="width:100%;height:200px;border-radius:12px"></div>
  <div class="p-text" style="--lines:3"></div>
</div>
```

Vue mount 后按 `refKey` 对齐过渡淡出。

### Skyline

骨架 IR → WXML 静态节点，首屏直接渲染（与 Skyline 静态首屏机制协同）。

### App（iOS/Android/鸿蒙）

AOT 预编译骨架 IR → 原生占位 View：

- iOS：`UIView` + `backgroundColor` shimmer 动画
- 鸿蒙：`Stack` + `Column` + shimmer `Component`
- Android：`FrameLayout` + shimmer `View`

**均通过 JSI 直接 mount，无需等待 Vue 启动** ← 对齐 Lynx IFR / RN Fabric 档位。

骨架样式（shimmer）走 ✅ 直映射：

```css
.p-block { background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
```

## 3. 映射一致性校验

CI 通过 `proteus doctor --check-skeleton` 校验：

- 每端骨架结构与真实 IR **节点数、布局语义**一致；
- 灰度滤镜在各端**均不阻断交互**（覆盖层 `pointer-events: none` / `isUserInteractionEnabled = false`）；
- 灰度层**避让灵动岛 / 安全区**（复用 `p-safe`）。
