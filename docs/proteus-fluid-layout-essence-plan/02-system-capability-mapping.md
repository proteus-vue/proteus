# 系统级柔性布局能力映射表

> 配套：`01-fluid-vs-rpx.md`
> 用途：作为 G-22 Compiler Plugin 的"语义 → 原生 API"对照字典；AI Agent（G-23）重构时的目标端参考。

---

## 1. 语义原语 → 五端原生能力映射

### `<p-grid :min-col-width="N">` 自适应网格

| 端 | 系统原生能力 | API / 组件 | 关键参数 |
|----|------------|-----------|---------|
| **iOS** | `UICollectionView` + `UICollectionViewFlowLayout` / iOS 16+ `NSCollectionLayoutSection` | `estimated(_:)` / `fractionalWidth` | `minimumInteritemSpacing` |
| **Android** | `RecyclerView` + `GridLayoutManager` + `SpanSizeLookup` | `setSpanSizeLookup` | 按 width 动态返回 span 数 |
| **鸿蒙** | `Grid` 容器 | `columnsTemplate("repeat(auto, minmax(160vp, 1fr))")` / `minCount` | `maxCount` |
| **Web** | CSS Grid | `grid-template-columns: repeat(auto-fit, minmax(Npx, 1fr))` | `auto-fit` / `auto-fill` |
| **Skyline** | 原生 `grid` 组件（编译期静态 WXSS） | `grid-template-columns` | 同 Web，AOT 预编译 |

**编译期推导**（G-22 `02-compiler-implementation.md`）：

```
min-col-width=160, 容器宽度 W
  → 列数 = floor((W + gap) / (160 + gap))
  → 生成各端对应声明
```

### `<p-stack direction="row" :wrap="true">` 弹性栈

| 端 | 系统原生能力 | API / 组件 |
|----|------------|-----------|
| **iOS** | `UIStackView` | `axis = .horizontal`, `distribution`, `spacing` |
| **Android** | `FlexboxLayout` / `ConstraintLayout` Flow | `flexWrap="wrap"` |
| **鸿蒙** | `Flex` 组件 | `wrap: FlexWrap.Wrap` |
| **Web** | CSS Flexbox | `flex-wrap: wrap` |
| **Skyline** | CSS Flexbox（原生渲染） | 同上 |

### `p-fluid="font-size(20, 32)"` 流式尺寸

| 端 | 系统原生能力 | 实现 |
|----|------------|------|
| **iOS** | `UIFontMetrics` + Auto Layout 约束不等式 | `≥20 && ≤32` 约束 |
| **Android** | `ConstraintLayout` bias / `Guideline` + `sp` | `layout_constraintWidth_min/max` |
| **鸿蒙** | `Length` 百分比 + 约束 | `min(20vp)` / `max(32vp)` |
| **Web** | CSS `clamp()` | `clamp(20px, ..., 32px)` |
| **Skyline** | CSS `clamp()` + Worklet | 同 Web，编译期为静态值 |

### `<p-fit>` 内在尺寸（内容驱动）

| 端 | 系统原生能力 |
|----|------------|
| **iOS** | `intrinsicContentSize` / `systemLayoutSizeFitting()` |
| **Android** | `wrap_content` / `onMeasure` |
| **鸿蒙** | `layoutWeight` + `wrapContent` |
| **Web** | `fit-content` / `max-content` |
| **Skyline** | `fit-content` |

---

## 2. 形态变化事件 → 系统 API 映射

| 场景 | iOS | Android | 鸿蒙 | Web/Skyline |
|------|-----|---------|------|-------------|
| 窗口尺寸变化 | `viewWillTransition(to:with:)` / `traitCollectionDidChange` | `onConfigurationChanged` / `WindowMetrics` | `onWindowStageEvent` / `onConfigurationUpdated` | `ResizeObserver` / `window.resize` |
| 折叠屏展开 | `UISplitViewController` / 尺寸类变化 | `FoldingFeature` (Jetpack WindowManager) | `foldStatus` / `windowStage` | 响应式媒体查询 |
| 分屏 / 多窗口 | iPad Multitasking | Multi-window mode | 自由窗口 | N/A |
| 横竖屏 | `UIDeviceOrientation` | `screenOrientation` | `orientation` | `orientationchange` |

**Proteus 统一入口**：`useBreakpoint()` + `onLayoutChange`（G-22 Runtime），内部桥接到上述各端 API。

---

## 3. 关键差异点：为什么不是"CSS flex 换皮"

1. **iOS / Android / 鸿蒙端不使用 Yoga / flex 引擎**——直接用平台原生布局容器，性能 = 系统级，无额外桥接
2. **Web / Skyline 端用 CSS Grid/Flex 原生能力**——`clamp()`、`auto-fit` 都是浏览器/小程序引擎原生支持，零 JS 开销
3. **编译期静态推导**——能确定的列数、断点、区间在编译期生成，运行时只做"容器尺寸变化时的重算"
4. **与 AI Agent（G-23）协同**——Agent 操作的 `LayoutConstraint` IR 直接对应这张映射表，重构产物天然对齐原生 API

---

## 4. 降级策略（对接 `08-degradation.md`）

| 能力 | 高版本 | 低版本降级 |
|------|--------|----------|
| CSS `clamp()` | Chrome 79+ / Safari 13+ | `calc()` + `@supports` 兜底 |
| CSS Grid `auto-fit` | 现代浏览器 | `flex-wrap` 模拟 |
| iOS `UICollectionView` estimated | iOS 10+ | 固定 `itemSize` |
| Android `GridLayoutManager` span 动态 | 全部 | `SpanSizeLookup` 返回 1 |
| 鸿蒙 `Grid minCount` | API 9+ | `columnsTemplate` 固定值 |

**铁律 G-22.2**：降级后布局必须"朴素但正确"——宁可单列，不可错乱。

---

## 5. 与 Glass（G-07）的类比（同一条原则 #10）

| | Glass | Fluid Layout |
|---|---|---|
| 语义 | `<pg-glass>` + preset | `<p-grid>` / `p-fluid` |
| iOS | `UIGlassEffect` | `UICollectionView` / `UIStackView` |
| Android | `RenderEffect` | `GridLayoutManager` / `ConstraintLayout` |
| 鸿蒙 | `fractal` / `blur()` | `Grid` / `Flex` |
| Web | `backdrop-filter` | CSS Grid / `clamp()` |
| 原则 | #10 统一语义 + 原生实现 | **#10 完全一致** |

**这是 Proteus 的核心方法论**：凡是操作系统提供的能力，框架都用"语义收敛 + 原生映射"的方式搬进来，而不是自己模拟或用 Web 能力替代。
