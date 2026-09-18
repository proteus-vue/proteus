# 06 Android 映射：RenderEffect + ROM 边界

## 目标

Android 端用 `RenderEffect`（API 31+）实现 L1；L3 不可达。

## 基础映射（API 31+）

```kotlin
// Proteus runtime (Android)
fun makeGlass(view: View, blurRadius: Float) {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    view.setRenderEffect(
      RenderEffect.createBlurEffect(blurRadius, blurRadius, Shader.TileMode.CLAMP)
    )
  } else {
    view.background = SolidFallbackDrawable(tintColor)  // 降级
  }
}
```

## 窗口级模糊（API 31+）

```kotlin
window.setBackgroundBlurRadius(20)
```

用于 `navigationBar` / `modal` 等全屏玻璃。

## Intensity 映射

| intensity | blur 半径 |
|-----------|----------|
| thin | 8 |
| regular | 16 |
| thick | 24 |
| ultra | 40 |

## 降级链

```
API 31+  → RenderEffect / BackgroundBlur  (L1)
API 21-30 → 半透明实色（无法 blur）         (L1 近似)
< API 21 → 实色                            (L1)
```

## ⚠️ 国内 ROM 边界（明确不做项）

小米 HyperOS / OPPO ColorOS / vivo OriginOS 的**控制中心玻璃特效是系统特权**，
第三方 App **调不到**：

- 私有 API 不稳定、随版本失效
- 无官方文档承诺
- 不同 ROM 实现差异大

**决策：主干不做国内 ROM 私有玻璃，仅留扩展口 `GlassExtension`。**

```ts
// 扩展口（未来可选）
export interface GlassExtension {
  name: 'miui' | 'coloros' | 'originos'
  apply(view: any, props: GlassProps): void
}
```

## 碎片化应对

- 低端机：`RenderEffect` 性能开销 → 降级 solid
- 性能监控：`Choreographer` 帧率 < 55fps → 自动降 L1

详见 `08-degradation.md`。
