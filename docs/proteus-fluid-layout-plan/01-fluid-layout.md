# Proteus 柔性布局（Fluid Layout）方案

> 执行位：**G-22** · 优先级：**P0**（框架基础设施）
> 依赖：Compiler (G-02)、CSS 兼容矩阵 (G-06)、Style Safety (G-16)、IR 骨架
> 目标：开发者写**一次语义布局**，框架自动适配**任意屏幕**，无需手动媒体查询 / 手动改 flex

---

## 1. 问题定义

### 1.1 传统跨端框架的痛点

| 痛点 | uni-app / RN / Flutter 现状 | 开发者成本 |
|------|---------------------------|-----------|
| **不同屏幕手动适配** | 需要手写 `@media` / `Dimensions.get()` / `LayoutBuilder` | 每个页面都要写一遍 |
| **断点散落** | 断点定义在 CSS / 业务代码里，无统一管理 | 设计稿变更 → 全局搜索替换 |
| **网格列数手动算** | `flex-wrap` + 固定宽度，或 JS 运行时计算 | 横竖屏切换要监听 |
| **流式尺寸手写 clamp** | `clamp()` 语法开发者自己算斜率 | 容易算错、不响应式 |
| **多端差异** | Web 用 `vw`、`rem`；App 用 `Dimensions`；小程序用 `rpx` | 同一套布局写三遍 |
| **动态内容溢出** | 文本超长、图片比例变化 → 手动处理 | 边界 case 多 |

### 1.2 核心洞察

> **布局的本质是"约束求解"——给定容器尺寸和子项约束，求解各子项尺寸。**
>
> 传统框架把这个求解过程丢给开发者（媒体查询、JS 计算、`LayoutBuilder`）。
> **Proteus 把这个求解过程下沉到框架 + Compiler，开发者只声明"意图"。**

### 1.3 验证结果（可行性已确认）

```
✅ 断点推导算法        — 从设计稿尺寸自动生成断点区间
✅ 网格密度自适应      — 320px→1列, 768px→4列, 1440px→8列 (自动)
✅ 流式 clamp 生成     — clamp(20px, calc(15.77px + 1.1268vw), 32px)
✅ Flex 约束求解       — 400px 容器 / 三项 basis=100 / grow=1 → 各 133.33px
```

---

## 2. 设计原则

对齐 **Architecture 原则 #10**：

> **框架定义布局语义（"我想要什么"），Compiler + 各端运行时用各自最优方式求解（"怎么算"）。**

### 2.1 四个核心语义原语

| 原语 | 含义 | 编译期行为 | 运行时行为 |
|------|------|-----------|-----------|
| **`p-fluid`** | 流式尺寸（自动 clamp） | 生成 `clamp()` 表达式 | 跟随视口变化 |
| **`p-grid`** | 自适应网格（自动列数） | 生成列数约束 | 监听容器尺寸 → 重算列数 |
| **`p-stack`** | 弹性栈（智能换行） | 生成 flex-wrap + 最小宽度 | 空间不足自动换行 |
| **`p-fit`** | 内在尺寸（内容驱动） | 生成 `min-content` / `max-content` | 文本/图片自适应 |

### 2.2 与传统方案的对比

```
传统（命令式）:
  if (width < 768) { columns = 1 }       // 开发者手写
  else if (width < 1024) { columns = 2 }
  else { columns = 3 }

Proteus（声明式）:
  <p-grid :min-col-width="160">          // 框架自动算列数
    <p-card v-for="item in items" />
  </p-grid>
```

---

## 3. 语义 API 设计

### 3.1 `p-fluid` — 流式尺寸

```vue
<template>
  <!-- 字体：320px→20px, 1440px→32px，中间自动插值 -->
  <h1 p-fluid="font-size(20, 32)">标题</h1>

  <!-- 间距：设计稿 375 基准，自动缩放 -->
  <div p-fluid="padding(16, 24)">内容</div>

  <!-- 复合：一次声明多个流式属性 -->
  <section p-fluid="gap(12,20) margin(16,32)">
    ...
  </section>
</template>
```

**编译产物**（开发者不可见）：

```css
/* Compiler 自动生成 */
h1 {
  font-size: clamp(20px, calc(15.77px + 1.1268vw), 32px);
}
```

### 3.2 `p-grid` — 自适应网格

```vue
<template>
  <!-- 关键：只声明"每列最小宽度"，列数自动 -->
  <p-grid :min-col-width="160" :gap="12">
    <p-card v-for="item in items" :key="item.id" />
  </p-grid>
</template>
```

**各端实现**：

| 端 | 实现方式 |
|----|---------|
| Web | CSS Grid：`grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))` |
| Skyline | CSS Grid（Skyline 支持） |
| iOS | `UICollectionViewCompositionalLayout` + `NSCollectionLayoutDimension.estimated` |
| Android | `StaggeredGridLayoutManager` / `GridLayoutManager` + SpanSizeLookup |
| 鸿蒙 | `Grid` 组件 + `columnsTemplate` |

### 3.3 `p-stack` — 弹性栈

```vue
<template>
  <!-- 横向栈，空间不足自动换行 -->
  <p-stack direction="row" :wrap="true" :gap="8">
    <p-tag v-for="tag in tags" />
  </p-stack>
</template>
```

### 3.4 `p-fit` — 内在尺寸

```vue
<template>
  <!-- 宽度由内容决定，但不会超过容器 80% -->
  <p-fit :max-ratio="0.8">
    <span>动态文本</span>
  </p-fit>
</template>
```

---

## 4. 编译器实现

### 4.1 编译期推导（核心创新）

Compiler 在 SFC 编译阶段**静态分析布局意图**，生成最优代码：

```
SFC 模板 + p-* 语义
    ↓ Compiler 静态分析
布局约束（LayoutConstraint AST）
    ↓ 按 target 分发
各端原生布局代码
```

**推导规则**（已验证可行）：

```
p-fluid="font-size(20, 32)"
  → 已知设计稿宽度 375，目标区间 [320, 1440]
  → slope = (32-20)/(1440-375) = 0.011268
  → intercept = 20 - 0.011268*375 = 15.77
  → clamp(20px, calc(15.77px + 1.1268vw), 32px)  ✅

p-grid :min-col-width="160"
  → calcColumns(viewport, 160, gap)
  → 320px → 1, 768px → 4, 1440px → 8  ✅
```

### 4.2 断点系统

```typescript
// Compiler 根据设计稿自动推导（验证通过）
function deriveBreakpoints(designWidth: number) {
  return [
    { name: 'sm', min: Math.round(designWidth * 0.5) },   // 188
    { name: 'md', min: Math.round(designWidth * 0.875) }, // 328
    { name: 'lg', min: Math.round(designWidth * 1.25) }, // 469
    { name: 'xl', min: Math.round(designWidth * 1.625) },// 609
  ]
}
```

**开发者可覆盖**：

```typescript
// app.config (G-20)
export default defineAppConfig({
  layout: {
    designWidth: 375,
    breakpoints: { sm: 320, md: 768, lg: 1024, xl: 1440 }, // 自定义
  },
})
```

### 4.3 与 CSS 四级矩阵的联动

| 语义 | CSS 矩阵档位 | 说明 |
|------|-------------|------|
| `p-fluid` → `clamp()` | ✅ 直映射（Web/Skyline） | App 端由原生布局引擎求解 |
| `p-grid` → `grid-template-columns` | ✅ 直映射 | iOS/Android/鸿蒙用原生网格 |
| `p-stack` → `flex-wrap` | ✅ 直映射 | 五端均支持 |
| `p-fit` → `min-content` | 🔶 语义封装 | 部分端需 polyfill |

---

## 5. 运行时适配

### 5.1 容器尺寸监听（仅 App 端需要）

Web/Skyline：`clamp()` / `vw` **CSS 原生响应式**，零 JS 开销。
App 端：需要监听容器尺寸变化 → 重算布局。

```typescript
// iOS: UIView.layoutSubviews / traitCollectionDidChange
// Android: View.OnLayoutChangeListener
// 鸿蒙: onAreaChange
```

**优化**：使用 `ResizeObserver`（Web）/ 原生 layout 回调（App），**节流 + 批量更新**。

### 5.2 与 Style Safety (G-16) 集成

柔性布局生成的样式**自动经过 Style Validator**：

```
p-fluid 编译产物 → clamp() 表达式
    ↓ Style Safety Validator (G-16)
校验：min ≤ max？单位合法？值类型正确？
    ↓
JSI → 原生布局引擎
```

---

## 6. 五端映射

| 语义 | Web | Skyline | iOS | Android | 鸿蒙 |
|------|-----|---------|-----|---------|------|
| `p-fluid` | `clamp()` + `vw` | `clamp()` + `vw` | Auto Layout 约束 | ConstraintLayout | `LayoutConstraint` |
| `p-grid` | CSS Grid | CSS Grid | `UICollectionView` | `RecyclerView` | `Grid` |
| `p-stack` | Flexbox wrap | Flexbox wrap | `UIStackView` | `FlexboxLayout` | `Flex` |
| `p-fit` | `min-content` | `min-content` | `systemLayoutSizeFitting` | `wrap_content` | `wrapContent` |

---

## 7. 对标竞品

| 能力 | uni-app | RN | Flutter | SwiftUI | **Proteus** |
|------|---------|-----|---------|---------|------------|
| 流式尺寸 `clamp` | ❌ 手写 | ❌ 手写 | ❌ 手写 | ✅ `@ScaledMetric` | ✅ **声明式 + 自动推导** |
| 自适应网格 | ❌ | ❌ | `SliverGrid` 手写 | ✅ `LazyVGrid` | ✅ **min-col-width 即够** |
| 断点系统 | ❌ | ❌ | ❌ | ✅ `SizeClass` | ✅ **设计稿自动推导** |
| 跨端一致 | — | — | — | ❌ 仅 iOS | ✅ **五端统一语义** |

> **SwiftUI 有 `SizeClass` + `LazyVGrid`，但它只解决 Apple 生态。**
> **Proteus 把 SwiftUI 级别的布局语义扩展到五端，且自动推导。**

---

## 8. 分批实施

| 批次 | 内容 | 依赖 | 状态 |
|------|------|------|------|
| **B1** | `p-fluid` 编译期 clamp 生成 + 断点推导 | Compiler | ✅ 已落地（纯函数 + 单测） |
| **B2** | `p-grid` Web/Skyline + CSS Grid | B1 | ✅ Web 已落地（Skyline 降级） |
| **B3** | `p-stack` + `p-fit` | B1 | ✅ 已落地 |
| **B4** | iOS/Android/鸿蒙 原生网格映射 | B2 + App Renderer | ⬜ 延后 |
| **B5** | 运行时容器监听 + 横竖屏 | B4 | ⬜ 延后 |

---

## 9. 严格规则（新增）

| 规则 | 级别 | 说明 |
|------|------|------|
| **FLD001** | error | 禁止手写 `@media (min-width: 768px)` — 改用 `p-fluid` / `p-grid` |
| **FLD002** | error | 禁止硬编码像素断点值 — 用 `app.config.layout.breakpoints` |
| **FLD003** | warning | `p-fluid` 必须提供 min/max 区间 |
| **FLD004** | error | `p-grid` 必须声明 `min-col-width` |

---

## 10. 收益总结

```
开发者写一次：     <p-grid :min-col-width="160">
框架自动适配：     320px → 1列, 768px → 4列, 1440px → 8列

开发者写一次：     <h1 p-fluid="font-size(20, 32)">
框架自动适配：     20px → ... → 32px (clamp + vw)

开发者写一次：     app.config.layout.breakpoints
框架自动推导：     设计稿 375 → sm/md/lg/xl
```

> **Proteus 柔性布局 = SwiftUI 的声明式布局语义 + Web 的 CSS Grid/Flex 生态 + 编译期自动推导。**
> **开发者从"手动算布局"解放为"声明意图"，框架负责求解。**
