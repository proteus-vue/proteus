# 五端映射与运行时适配

## 1. 映射总览

| 语义 | Web | Skyline | iOS | Android | 鸿蒙 |
|------|-----|---------|-----|---------|------|
| `p-fluid` | `clamp()` + `vw` | `clamp()` + `vw` | Auto Layout 约束 | ConstraintLayout | `LayoutConstraint` |
| `p-grid` | CSS Grid | CSS Grid | `UICollectionView` | `RecyclerView` | `Grid` |
| `p-stack` | Flexbox wrap | Flexbox wrap | `UIStackView` | `FlexboxLayout` | `Flex` |
| `p-fit` | `min-content` | `min-content` | `systemLayoutSizeFitting` | `wrap_content` | `wrapContent` |

## 2. Web / Skyline（零运行时开销）

`p-fluid` → CSS `clamp()` + `vw`：**浏览器原生响应式，零 JS 开销**。
`p-grid` → CSS Grid `repeat(auto-fill, minmax(X, 1fr))`：**CSS 引擎求解列数**。

> 这是最优解——**把求解过程交给平台渲染引擎，框架不下发 JS**。

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
