# 04 iOS 映射：UIGlassEffect + 回退链

## 目标

iOS 端解锁最高质感：iOS 26+ 用 `UIGlassEffect`，低版本回退 `UIVisualEffectView`。

## 版本守门

```swift
// Proteus runtime (iOS)
func makeGlass(intensity: Intensity, tint: Tint) -> UIView {
  if #available(iOS 26.0, *) {
    return UIGlassEffectView(style: intensity.toGlassStyle(), tint: tint)
  } else if #available(iOS 13.0, *) {
    return UIVisualEffectView(effect: UIBlurEffect(style: intensity.toBlurStyle()))
  } else {
    return SolidFallbackView(color: tint.color)  // L1 降级
  }
}
```

## Intensity 映射

| prop intensity | UIGlassEffect (iOS 26+) | UIVisualEffectView (≤25) |
|---------------|------------------------|--------------------------|
| thin | `.thin` | `.systemUltraThinMaterial` |
| regular | `.regular` | `.systemThinMaterial` |
| thick | `.thick` | `.systemMaterial` |
| ultra | `.ultraThick` | `.systemThickMaterial` |

## preset 映射

| preset | 实现 |
|--------|------|
| navigationBar | `UIGlassEffect` + 底部细边框 |
| modal | `UIGlassEffect` + 大圆角 |
| tabBar | `UIGlassEffect` + 顶部高光 |
| card | `UIVisualEffectView` + 圆角 |
| floating | `UIGlassEffect` + 阴影 |

## 注意事项

- `UIGlassEffect` 会自动处理内容对比度 → 无需手动 tint 优化
- 滚动联动：原生 `scrollEdgeAppearance` 自动切换透明/玻璃
- 无障碍：`accessibilityReduceTransparency` → 自动 solid

## Compiler 产物

```objc
// 生成的 .m（示意）
PROGlassView *view = [PROGlassView makeWithIntensity:PROGlassRegular tint:...];
```

IR → iOS backend 生成对应原生组件树，对齐 Compiler plan。

## 降级链

```
iOS 26+  → UIGlassEffect          (L3)
iOS 13-25 → UIVisualEffectView    (L1)
< iOS 13 → SolidFallback          (L1 实色)
```

详见 `08-degradation.md`。
