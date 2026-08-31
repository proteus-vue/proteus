# 07 Glass L3 系统级对接

> 本文件对接 `proteus-glass-plan`。App 端是本方案的核心价值所在——**只有原生端能解锁系统级玻璃（L3）**。

## 1. 层级回顾

| 层级 | 能力 | App 端 |
|------|------|--------|
| L1 | blur + tint + radius + border | ✅ 三端必达 |
| L2 | noise / 高光边 / 动态形变 | ✅ 尽力达 |
| **L3** | **系统级玻璃** | **✅ 仅 App 原生端** |

## 2. 三端 L3 实现

### 2.1 iOS：UIGlassEffect（iOS 26+）

```swift
// 自动生成类型（见 08）
let glass = UIGlassEffect.regular()
glass.setCornerRadius(16)
view.addGlassEffect(glass)
```

- iOS < 26 → 降级 `UIVisualEffectView(UIBlurEffect)`
- 版本守门：`assertPlatform('app', { ios: '>=26' })`

### 2.2 鸿蒙：ArkUI blur / fractal（NEXT 最完善）

```ts
// 鸿蒙 ArkUI Native
import { effectComponent } from '@kit.ArkUI'

component.blur(20)  // 基础
component.fractalBlur(...)  // NEXT 高级
```

鸿蒙是**中国系统里玻璃支持最完善的**，重点深耕。

### 2.3 Android：RenderEffect（API 31+）

```kotlin
view.setRenderEffect(
  RenderEffect.createBlurEffect(20f, 20f, Shader.TileMode.CLAMP)
)
```

- API < 31 → 降级 L1（backdrop-filter 模拟）

## 3. 统一入口

```vue
<pg-glass preset="navigationBar" intensity="regular">
  <slot/>
</pg-glass>
```

`regular` preset 在各端映射：

| 端 | 实际实现 |
|----|---------|
| iOS | `UIGlassEffect(.regular)` |
| 鸿蒙 | `blur(20)` |
| Android | `RenderEffect(20)` |
| Web | `backdrop-filter: blur(20px)` |
| Skyline | `backdrop-filter: blur(20px)` |

## 4. 版本守门

```ts
// Compiler 注入能力探测
const capability = detectCapability('glass', {
  ios: '>=26',
  harmony: '>=NEXT',
  android: '>=31'
})
// 不满足 → 自动降级 L1，业务零感知
```

## 5. 与 JSI 对接

```
<pg-glass> → IR → Custom Renderer → JSI invokeCapability('glass', {...})
                                      ↓
                            iOS/Android/鸿蒙 原生 API
```

## 6. 明确不做

- ❌ 国内 ROM（小米/OPPO/vivo）控制中心玻璃（系统特权，App 调不到）
- ❌ 跨版本像素级一致（系统实现差异，只保证语义一致）
