# 五端原生闸门（纵深防御）

> 即使前三层全漏（理论上不可能），**原生端 JSI binding 再做一次参数校验**。

---

## 纵深防御模型

```
① 编译期静态校验  ─┐
② 编译期代码生成  ─┤── 任一生效即安全
③ 运行时 Validator ─┤
④ 五端原生闸门    ─┘  ← 最后堡垒（触发即 bug）
```

---

## 各端闸门实现

### iOS（UIKit / Swift）

```swift
// native/ios/StyleGate.swift
@objc public class StyleGate: NSObject {
    @objc public static func applyWidth(_ view: UIView, _ value: CGFloat) {
        guard value >= 0 else {
            ProteusLogger.warn("width 不能为负: \(value), 降级为 0")
            view.frame.size.width = 0
            return
        }
        view.frame.size.width = value
    }

    @objc public static func applyInsets(_ view: UIView, top: CGFloat, ...) {
        // UIEdgeInsets 合法性校验
        guard top >= 0, left >= 0, bottom >= 0, right >= 0 else { ... }
        ...
    }
}
```

**关键点：**
- `CGFloat` 范围检查（≥ 0）
- `UIEdgeInsets` 各分量 ≥ 0
- `UIColor` 非空（hex 解析失败 → 降级 `systemGray`）

### Android（Kotlin）

```kotlin
// native/android/StyleGate.kt
object StyleGate {
    fun applyWidth(view: View, value: Float) {
        if (value.isNaN() || value.isInfinite()) {
            Logger.warn("width 非法: $value, 降级为 0")
            view.layoutParams.width = 0
            return
        }
        view.layoutParams.width = value.toInt()
    }

    fun applyLayoutParams(params: ViewGroup.LayoutParams) {
        // ConstraintLayout / LinearLayout 约束合法性
        require(params.width >= 0 || params.width == MATCH_PARENT || params.width == WRAP_CONTENT)
        require(params.height >= 0 || ...)
    }
}
```

**关键点：**
- `Float.isNaN()` / `isInfinite()` 拦截
- `LayoutParams` 宽高合法性（≥ 0 或 `MATCH_PARENT`/`WRAP_CONTENT`）

### 鸿蒙（ArkTS）

```typescript
// native/harmony/StyleGate.ts
export class StyleGate {
  static applyLength(value: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (!Number.isFinite(value) || value < min || value > max) {
      Logger.warn(`Length 越界: ${value}`)
      return 0
    }
    return value
  }

  static applyConstraint(constraint: Constraint): boolean {
    // Constraint 合法性（≤ 父容器、start < end）
    return constraint.start <= constraint.end
  }
}
```

### Web

```typescript
// runtime/style-safety/gates/web.ts
export function applyStyle(el: HTMLElement, prop: string, value: unknown) {
  // CSSOM 天然宽容，几乎无需拦截
  el.style[prop as any] = String(value)
}
```

→ **Web 端闸门最薄**（CSSOM 会自动忽略非法值）。

### Skyline（小程序）

```typescript
// runtime/style-safety/gates/skyline.ts
export function validateForSkyline(style: Record<string, unknown>) {
  for (const [prop, value] of Object.entries(style)) {
    // Skyline 限制：需有限数、布局参数合法
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Skyline: ${prop} 需有限数`)
    }
  }
}
```

---

## 触发条件（正常情况下永不触发）

第四层闸门只在以下情况触发（**均为框架 bug，DevTools 报警**）：

- 前三层校验逻辑漏洞
- JSI binding 版本不匹配
- 第三方原生插件绕过 Renderer

→ **触发即 bug**，开发模式下 DevTools 高亮报警 + 上报。

---

## 与 App Renderer 的关系

```
Vue Reconciler
    ↓ patchStyle
Runtime Validator（03 层）
    ↓ 已校验的 style 对象
Custom Renderer nodeOps
    ↓ JSI 调用
StyleGate（04 层，各端原生）
    ↓ 最终参数
UIView / View / Component
```

**StyleGate 是 JSI binding 的"最后一道参数校验"，与 nodeOps 同级。**

详见 `proteus-app-renderer-plan` 02-native-binding.md。
