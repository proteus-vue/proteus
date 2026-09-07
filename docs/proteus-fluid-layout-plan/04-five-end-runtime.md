# 五端映射与运行时适配

## 1. 映射总览

| 语义 | Web | Skyline | iOS | Android | 鸿蒙 |
|------|-----|---------|-----|---------|------|
| `p-fluid` | `clamp()` + `vw` | calc 变体待做（★Skyline 无 clamp，当前类兑底） | Auto Layout 约束 | ConstraintLayout | `LayoutConstraint` |
| `p-grid` | CSS Grid | ★#496 编译器 flex 档位（断点 + px basis + resize 重算） | `UICollectionView` | `RecyclerView` | `Grid` |
| `p-stack` | Flexbox wrap | Flexbox wrap | `UIStackView` | `FlexboxLayout` | `Flex` |
| `p-fit` | `min-content` | 上限 maxRatio 生效（无 fit-content——内容宽退块宽，诚实降级） | `systemLayoutSizeFitting` | `wrap_content` | `wrapContent` |

## 1.2 ★#496 修订（Skyline 实测，2026-09）

> 原「Web / Skyline（零运行时开销）：把求解过程交给平台渲染引擎，框架不下发 JS」的假设在 Skyline 不成立：
> Skyline 自研引擎**无 CSS Grid / clamp() / fit-content / 通配选择器**，style 绑定仅字符串、小数 px 取整不定（实测 basis 190.7×2+12=393.4 恰=容器宽时向上取整溢出 wrap 单列）——
> **布局求解权收回编译器**：p-grid 语义 → 编译期断点档 + 运行时一次性档位（SelectorQuery 实测容器宽 → 整 px basis，onWindowResize 重算），产物只依赖 flex/px（Skyline 支持表全 ✓）。
> Web 端仍为原生最优（CSS Grid auto-fill，真实 Vue 组件，零 JS）；WebView 与 Skyline 共享同一 flex 档位产物（双端一致）。

## 2. Web / Skyline（零运行时开销）

`p-fluid` → CSS `clamp()` + `vw`：**浏览器原生响应式，零 JS 开销**（★Skyline 无 clamp，calc 变体待做）。
`p-grid` → ★#496 语义编译：Skyline/WebView 编译器生成 flex 档位（容器 flex + 子项 px basis 档位容器），运行时 SelectorQuery 实测容器宽一次性求解列数 + onWindowResize 重算——Skyline 无 CSS Grid，求解权在编译器；Web 仍为 CSS Grid auto-fill（引擎求解）。

> 这是当前最优解——**渲染端只执行编译期求好的档位，框架运行时不下发布局引擎**（Web 例外：交给浏览器引擎原生求解）。

## 3. iOS 映射

### `p-fluid`
```swift
// Auto Layout 约束：width = (slope * superview.width) + intercept
let slope = (max - min) / (maxVw - minVw)
view.widthAnchor.constraint(
  equalTo: superview.widthAnchor,
  multiplier: slope,
  constant: intercept
)
```

### `p-grid`
```swift
// UICollectionViewCompositionalLayout
let item = NSCollectionLayoutItem(...)
item.widthDimension = .estimated(minColWidth)  // 自适应
let group = NSCollectionLayoutGroup.horizontal(
  layoutSize: .init(width: .fractionalWidth(1), height: .estimated(100)),
  subitems: [item]
)
group.interItemSpacing = .fixed(gap)
```

## 4. Android 映射

### `p-grid`
```kotlin
// StaggeredGridLayoutManager / GridLayoutManager
val spanCount = calcColumns(viewportWidth, minColWidth, gap)
layoutManager = GridLayoutManager(context, spanCount)
// 横竖屏变化 → onLayoutChange → 重算 spanCount
```

### `p-fluid`
```kotlin
// ConstraintLayout + Guideline (百分比)
// 或使用 DataBinding 表达式
```

## 5. 鸿蒙映射

### `p-grid`
```typescript
// ArkUI Grid
Grid() {
  ForEach(items, (item) => { GridItem() })
}
.columnsTemplate('1fr 1fr 1fr')  // 运行时根据宽度计算列数
```

## 6. 运行时容器监听

App 端需要监听容器尺寸变化（横竖屏、分屏）：

| 端 | API |
|----|-----|
| iOS | `layoutSubviews` / `traitCollectionDidChange` |
| Android | `View.OnLayoutChangeListener` / `OnConfigurationChangedListener` |
| 鸿蒙 | `onAreaChange` |

**优化**：节流 + 批量更新（对齐 Worklet (G-03) 的帧调度）。

## 7. 横竖屏与折叠屏

`p-grid` 天然适配：
- 竖屏 375px → 2 列
- 横屏 667px → 3 列
- 折叠屏展开 840px → 4 列

**开发者无需写任何媒体查询**——框架在容器尺寸变化时自动重算。
