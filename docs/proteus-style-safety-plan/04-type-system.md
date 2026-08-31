# 样式值类型系统

> 属性名白名单解决"什么属性能写"，**值类型系统解决"什么值算合法"**。

---

## 1. 基础类型定义

```typescript
// runtime/style-safety/types.ts

/** 长度：number(px) | 带单位字符串 | auto */
export type Length =
  | number                          // 默认 px，如 100
  | `${number}px`                   // "100px"
  | `${number}rem`                  // "1.5rem"
  | `${number}%`                    // "50%"
  | 'auto'

/** 颜色：hex / rgba / theme token（编译期展开） */
export type Color = string

/** 透明度：0-1 的有限数 */
export type Opacity = number

/** 整数（zIndex 等） */
export type Integer = number

/** 弹性系数 */
export type FlexNumber = number

/** 变换：translate/scale 为主（rotate/skew 受限，见 CSS 矩阵） */
export type Transform = string
```

---

## 2. 类型守卫（运行时校验用）

```typescript
export function isLength(v: unknown): v is Length {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0
  if (typeof v !== 'string') return false
  if (v === 'auto') return true
  return /^\d+(\.\d+)?(px|rem|%)?$/.test(v)
}

export function isColor(v: unknown): v is Color {
  if (typeof v !== 'string') return false
  return /^#[0-9a-fA-F]{3,8}$/.test(v)
      || /^rgba?\(/.test(v)
      || v.startsWith('var(')   // CSS 变量（Theme token）
}

export function isOpacity(v: unknown): v is Opacity {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

export function isInteger(v: unknown): v is Integer {
  return typeof v === 'number' && Number.isInteger(v)
}
```

---

## 3. 逐平台类型收窄

> 同一 `Length` 在各端原生 API 的参数类型不同——**Validator 在 JSI 调用前做"逐平台收窄"**。

```typescript
interface PlatformLengthRules {
  ios:     { type: 'CGFloat'; min: 0; max: number }       // UIKit 尺寸
  android: { type: 'TypedValue'; allowNaN: false }         // LayoutParams
  harmony: { type: 'Length'; min: 0; max: number }        // ArkUI
  web:     { type: 'CSSLength'; allowNegative: true }     // 最宽松
  skyline: { type: 'Number'; finiteOnly: true }           // WXSS
}

export function narrowLength(
  value: Length,
  platform: Platform
): ValidationResult {
  switch (platform) {
    case 'ios':
      if (typeof value === 'number' && value < 0)
        return { valid: false, reason: 'iOS CGFloat 不能为负' }
      return { valid: true, nativeValue: toCGFloat(value) }
    case 'android':
      if (value === 'auto') return { valid: true, nativeValue: LayoutParams.WRAP_CONTENT }
      if (!isFinite(toNumber(value)))
        return { valid: false, reason: 'Android TypedValue 不可为 NaN' }
      return { valid: true, nativeValue: toTypedValue(value) }
    case 'harmony':
      // ...
    case 'skyline':
      if (!Number.isFinite(toNumber(value)))
        return { valid: false, reason: 'Skyline 需有限数' }
      return { valid: true, nativeValue: toNumber(value) }
    case 'web':
      return { valid: true, nativeValue: value }  // 最宽容
  }
}
```

### 各端典型非法值拦截

| 端 | 拦截场景 | 原因 |
|----|---------|------|
| iOS | 负数 width | `CGFloat` 负值导致布局异常 |
| Android | `NaN` / `Infinity` | `LayoutParams` 非法 |
| 鸿蒙 | 超出父容器 | `Constraint` 约束失败 |
| Skyline | 非有限数 | WXSS 渲染异常 |
| Web | （几乎不拦截） | CSSOM 天然宽容 |

---

## 4. 属性 → 类型映射

```typescript
export const PROP_TYPES: Record<AllowedStyleProp, (v: unknown) => boolean> = {
  width: isLength, height: isLength,
  padding: isLength, paddingTop: isLength, /* ... */
  color: isColor, backgroundColor: isColor, borderColor: isColor,
  opacity: isOpacity,
  zIndex: isInteger,
  flex: isFiniteNumber, flexGrow: isFiniteNumber,
  // ...
}

function validateProp(prop: string, value: unknown): ValidationResult {
  const guard = PROP_TYPES[prop]
  if (!guard) return { valid: false, reason: `属性 ${prop} 不在白名单` }
  if (!guard(value)) return { valid: false, reason: `${prop} 值类型非法: ${value}` }
  return { valid: true }
}
```

---

## 5. 编译期类型推导（与 Vue 类型联动）

```typescript
// 开发者获得的类型提示（TS 一等公民）
import type { AllowedStyleProp } from '@proteus-vue/runtime'

const style: Partial<Record<AllowedStyleProp, unknown>> = {
  width: 100,        // ✅
  opacity: 0.5,      // ✅
  'backdrop-filter': 'blur(10px)',  // ❌ TS 报错：不在 AllowedStyleProp
}
```

**配合 `vue-tsc` + `--strict-style`，IDE 即时红线 + 编译报错双保险。**

---

## 6. Theme Token 的类型展开

```typescript
// 主题色在编译期展开为字面量，运行期走 CSS 变量
:style="{ color: theme.colors.primary }"
//     ↓ 编译期（假设 primary = '#007AFF'）
:style="{ color: 'var(--color-primary)' }"
//     ↓ 运行期（CSS 变量 GPU 联动，不走 JSI）
```

→ **Theme token 不走 Runtime Validator**（值由框架保证），零开销。

---

## 7. 降级默认值

| 类型 | 默认值 | 说明 |
|------|-------|------|
| Length | `0` | width/height → 0（朴素但正确） |
| Color | `'inherit'` | 继承父级 |
| Opacity | `1` | 完全不透明 |
| Integer | `0` | zIndex 归零 |
| FlexNumber | `0` | 不参与弹性 |

> **宁可降级到"朴素但正确"的界面，也不让原生 crash。**
