# 全端样式运行时安全解决方案

- 执行位：G-16 · 优先级：P1 · 依赖：CSS 兼容矩阵、App Renderer、Compiler IR、Memory Plan
- 一句话：**不让任何一条未经语义校验的样式值抵达原生渲染管线。**

---

## 1. 问题定义：为什么 Web 时代的"宽容"在原生端是 crash

### 1.1 三类运行时异常

| 类型 | 示例 | Web 后果 | **App 端（JSI）后果** |
|------|------|---------|---------------------|
| **平台不支持的属性** | `style="backdrop-filter: blur(10px)"` 在 Android < 31 | 静默失效 | ⚠️ 可能抛 `IllegalArgumentException` |
| **平台不支持的值** | `style="display: inline-flex"` 在 Skyline | 布局异常 | ⚠️ 原生 LayoutParams 非法 → crash |
| **动态计算值类型错误** | `:style="{ width: v }"` 其中 `v = undefined` | 样式不生效 | ❌ **JSI 收到 `null`/`undefined` → 原生 NPE** |

### 1.2 根因

```
开发者写的 CSS 属性名/值
    ↓ （Web 时代）浏览器 CSSOM 宽容解析 → 最多不生效
    ↓ （App 时代）JSI 直调 → 非法值直接塞给 UIView / View / Component
    ↓
原生 API 收到非法参数 → crash / 黑屏 / 布局错乱
```

> **CSS 是"声明式宽容"的，原生 API 是"强类型严格"的。**
> JSI 把这两者的鸿沟暴露了出来——这正是 Proteus 必须建样式安全层的原因。

### 1.3 竞品现状（痛点调研）

| 框架 | 样式安全机制 | 缺陷 |
|------|------------|------|
| **uni-app (WebView)** | 浏览器天然宽容 | 无问题，但也无原生性能 |
| **uni-app x (uvue)** | ucss 子集 + 编译期校验 | ✅ 有编译校验，但**脱离 JS 生态**；动态场景覆盖有限 |
| **React Native** | `StyleSheet.create` + 手动类型 | ❌ **全靠开发者自觉**，运行时无校验；非法值照样 crash |
| **Flutter** | Dart 强类型 Widget | ✅ 编译期类型安全，但**自绘、非原生** |
| **Lynx** | 真 CSS 子集 | ⚠️ 子集内安全，超出子集无运行时保护 |

**结论：现有框架要么"安全但放弃原生/生态"（Flutter/uvue），要么"原生但运行时裸奔"（RN）。**
**Proteus 的目标：原生 + 生态 + 运行时安全，三者兼得。**

---

## 2. 核心设计：三层防线

```
┌─────────────────────────────────────────────────────────┐
│  开发者代码                                             │
│  <style> 块  /  :style 绑定  /  p-* 语义组件            │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  ① 语义层校验（编译期，SFC <style> + :style AST）       │
│    - 只允许 p-* token + 白名单属性                      │
│    - 对照 CSS 四级矩阵（✅🔶⚠️❌）                      │
│    - 静态可达值集推导                                   │
└────────────────────┬────────────────────────────────────┘
                     ↓ 放行
┌─────────────────────────────────────────────────────────┐
│  ② 编译期代码生成                                       │
│    - 静态可达 → 生成 _validated() 内联调用              │
│    - 常量折叠、死分支消除                               │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  ③ 运行时 Validator（动态值最后闸门）                    │
│    - patchStyle 拦截 → O(n) 属性数                      │
│    - 开发模式：warn + 降级                              │
│    - 生产模式：静默丢弃 + 可选上报                      │
└────────────────────┬────────────────────────────────────┘
                     ↓ 只放行合法值
┌─────────────────────────────────────────────────────────┐
│  ④ JSI / 原生渲染管线                                   │
│    - 五端原生闸门（iOS/Android/鸿蒙/Web/Skyline）       │
│    - 绝无非法参数抵达原生 API                           │
└─────────────────────────────────────────────────────────┘
```

**关键：三层任一生效即安全。编译期覆盖越多，运行时开销越小，理想情况运行时 Validator 近乎零调用。**

---

## 3. 语义层：只允许"安全子集"

### 3.1 白名单属性（✅ 直映射 + 🔶 语义组件）

```typescript
// 运行时：只允许白名单内的属性名
const ALLOWED_STYLE_PROPS = {
  // ✅ 直映射（五端原生都有对应）
  width: 'length', height: 'length',
  padding: 'length', margin: 'length',
  paddingTop: 'length', ...padding*:'length',
  color: 'color', opacity: 'opacity',
  backgroundColor: 'color', borderRadius: 'length',
  transform: 'transform',
  // 🔶 语义组件（必须用 p-* 封装，禁止裸写）
  backdropFilter: 'semantic',  // → <p-glass>
  // ❌ 禁止（CSS 矩阵 ❌ 级）
  float: 'forbidden', display: 'forbidden',  // inline/float 禁用
} as const
```

### 3.2 `:style` 写法约束

```vue
<!-- ❌ 禁止：CSS 属性直通（绕过语义层） -->
<div :style="{ 'backdrop-filter': 'blur(10px)' }" />
<div :style="{ display: 'inline-flex' }" />

<!-- ✅ 允许：语义组件 -->
<p-glass :blur="10" />

<!-- ✅ 允许：白名单属性（✅ 直映射） -->
<div :style="{ opacity: 0.5, width: dynamicWidth }" />

<!-- ✅ 允许：p-* token / Theme token -->
<div :style="{ color: theme.colors.primary }" />
```

**核心约束只有一个：动态 `:style` 只允许白名单属性 + `p-*` 语义组件。**

### 3.3 为什么 `:class` 不受影响

```vue
<!-- ✅ 完全不受影响：走 class 切换，编译期已校验 -->
<div :class="{ active: isActive, 'text-lg': isLarge }" />
```

`<style>` 块在**编译期被完全控制**（静态 CSS），`:class` 只是切换已校验的类名 → **零运行时开销、零安全风险**。

---

## 4. 样式值类型系统

> 属性名白名单只解决"什么属性能写"，**值类型系统解决"什么值算合法"**。

### 4.1 基础类型

```typescript
type Length = number | `${number}px` | `${number}rem` | `${number}%` | 'auto'
type Color = string  // hex/rgba/theme token，编译期展开
type Opacity = number // 0-1
type FlexNumber = number
```

### 4.2 逐平台类型收窄

```typescript
// 同一 Length 在各端原生 API 的参数类型不同
interface PlatformLength {
  ios: 'CGFloat'        // 需 ≥ 0
  android: 'TypedValue' // 需非 NaN
  harmony: 'Length'     // 需 ≤ 父容器
  web: 'CSSLength'      // 最宽松
  skyline: 'Number'     // 需有限数
}
```

**Validator 在 JSI 调用前做"逐平台收窄"**——比如 iOS 端拦截负数宽度、Android 端拦截 NaN、Skyline 端拦截 Infinity。

### 4.3 类型守卫

```typescript
function isLength(v: unknown): v is Length {
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string') return /^\d+(\.\d+)?(px|rem|%)?$/.test(v) || v === 'auto'
  return false
}
```

---

## 5. 降级与容错策略

| 场景 | 开发模式 | 生产模式 |
|------|---------|---------|
| 未知属性名 | ❌ 编译报错（CSS001） | 静默丢弃 |
| 白名单属性 + 非法值 | ⚠️ warn + 降级到默认值 | 静默丢弃 + 可选上报 |
| 语义组件属性 | — | 走组件内安全路径 |
| 类型错误 | ⚠️ warn + 降级 | 静默丢弃 + 上报 |

**降级默认值**：`width/height → 0`、`opacity → 1`、`color → 继承`、`borderRadius → 0`。

> 原则：**宁可降级到"朴素但正确"的界面，也不让原生 crash。**

---

## 6. 开关与模式

```bash
# 编译期严格模式（默认开启）
proteus compile --strict-style

# 生成样式安全报告（CI 用）
proteus compile --style-report=style-safety.json

# 生产环境运行时校验（默认关闭，按需开启）
proteus runtime --style-validator=loose   # loose | strict | off
```

| 模式 | 编译期 | 运行时 | 用途 |
|------|-------|-------|------|
| `development` | strict | warn + 降级 | 本地开发，即时反馈 |
| `production` | strict | off（零开销）| 线上，编译期已保证安全 |
| `production-debug` | strict | loose + 上报 | 灰度排查 |

---

## 7. 与 Architecture 原则 #10 的关系

> **框架定义统一语义，各端用原生方式实现。**

内联 style 的本质问题 = **绕过语义层，把 CSS 直塞各端**。

本方案 = 原则 #10 的**强制执行的运行时契约**：

- CSS 四级矩阵定义"什么合法"（静态事实）
- Style Safety 保证"非法值永远到不了原生"（执行机制）

**二者构成完整闭环，缺一不可。**

---

## 8. 分批落地（详见 `11-batches.md`）

| 批次 | 内容 | 依赖 |
|------|------|------|
| B1 | 属性名白名单 + Runtime Validator 骨架 | CSS 矩阵 |
| B2 | 值类型系统 + 逐平台收窄 | B1 |
| B3 | `:style` AST 静态推导 + 代码生成 | Compiler IR |
| B4 | 五端原生闸门 + DevTools 可视化 | App Renderer M2 |

**B1 纯逻辑零依赖，可单测，建议与 `--strict-css` 同期启动。**

---

## 9. 验收目标（详见 `10-benchmark-budgets.md`）

- ✅ 任何非法样式值 **100% 无法抵达原生 API**（五端真机验证）
- ✅ 运行时 Validator **额外开销 < 3%**（首屏 + 滚动）
- ✅ 编译期推导覆盖率 **> 80%**（即运行时 Validator 调用 < 20%）
- ✅ `--strict-style` 拦截所有 CSS 矩阵 ❌ 级属性

---

## 10. 对标总结

| 能力 | uni-app x | RN | Flutter | **Proteus** |
|------|-----------|-----|---------|------------|
| 编译期样式校验 | ✅ ucss | ❌ | ✅ | ✅ |
| 运行时动态值保护 | ⚠️ | ❌ | ✅ | ✅ |
| 原生渲染 | ✅ | ✅ | ❌ 自绘 | ✅ |
| JS/Vue 生态 | ❌ | ✅ | ❌ | ✅ |
| 五端同源 | ❌ | ❌ | ⚠️ | ✅ |

**Proteus = 唯一一个同时做到"原生渲染 + Vue 生态 + 运行时样式安全"的框架。**
