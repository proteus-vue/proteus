# Component 补充：布局语义规范

> 归属：`proteus-component-plan`
> 对齐：Architecture 原则 #10（统一语义 + 原生实现）

---

## 1. 布局组件清单（统一语义层）

Proteus 暴露给业务的布局组件，**五端通用**：

| 组件 | 语义 | L 层 | 各端原生映射 |
|------|------|------|-------------|
| `<p-view>` | 通用容器 | L1 | `UIView` / `Component` / `View` / `div` |
| `<p-flex>` | 弹性布局 | L1 | `UIStackView` / `Flex` / `ConstraintLayout` / `flex` |
| `<p-stack>` | 堆叠布局 | L1 | `UIStackView(overlay)` / `Stack` / `FrameLayout` / `grid` |
| `<p-grid>` | 网格布局 | L1 | `UICollectionView` / `Grid` / `RecyclerView(Grid)` / `grid` |
| `<p-scroll>` | 滚动容器 | L1 | `UIScrollView` / `Scroll` / `NestedScrollView` / `scroll-view` |
| `<p-recycle>` | 回收列表 | L1 | `UITableView` / `List` / `RecyclerView` / `recycle-view` |
| `<p-masonry>` | 瀑布流 | L2 | 原生容器 / 降级 `p-flex wrap` | 
| `<p-divider>` | 分隔线 | L1 | `Separator` / `Divider` / `View` / `border` |

**L1 = 五端必达，L2 = 尽力达（低版本降级）。**

---

## 2. `p-flex` 完整语义

```vue
<p-flex
  direction="row | column"
  justify="start | center | end | space-between | space-around | space-evenly"
  align="start | center | end | stretch | baseline"
  :gap="8"
  :wrap="false"
>
  <slot />
</p-flex>
```

### 2.1 属性 → 原生枚举映射

| `justify` | iOS `UIStackView.Distribution` | 鸿蒙 `FlexAlign` | Android `ChainStyle` | CSS |
|-----------|-------------------------------|-----------------|---------------------|-----|
| `start` | `.fill` (leading) | `Start` | `Packed` (start) | `flex-start` |
| `center` | `.centered` | `Center` | `Packed` (center) | `center` |
| `end` | `.fill` (trailing) | `End` | `Packed` (end) | `flex-end` |
| `space-between` | `.equalSpacing` | `SpaceBetween` | `Spread` | `space-between` |
| `space-around` | `.equalCentering` | `SpaceAround` | `Spread_Inside` | `space-around` |
| `space-evenly` | `.equalSpacing` (custom) | `SpaceEvenly` | `Spread` | `space-evenly` |

> 这张表是**单一事实源**，写在 Component plan 的映射表文件里。

---

## 3. `p-stack` 完整语义

```vue
<p-stack alignment="top-start | top-center | top-end | center | bottom-start | ...">
  <slot />
</p-stack>
```

| `alignment` | iOS | 鸿蒙 | Android | CSS |
|-------------|-----|------|---------|-----|
| `center` | `.alignment = .center` | `Alignment.Center` | 居中约束 | `place-items: center` |
| `top-start` | `.topLeading` | `TopStart` | 左上约束 | `align-items: start` |

---

## 4. `p-grid` 完整语义

```vue
<p-grid :columns="3" :gap="8">
  <slot />
</p-grid>
```

| 端 | 实现 |
|----|------|
| iOS | `UICollectionView` + `UICollectionViewFlowLayout` |
| 鸿蒙 | `Grid` + `GridItem` |
| Android | `RecyclerView` + `GridLayoutManager` |
| Web / Skyline | CSS `display: grid; grid-template-columns: repeat(3, 1fr)` |

---

## 5. 语义收敛规则

### 5.1 只定义"五端都能表达"的语义

- ✅ `justify` 6 种值：五端全支持 → 纳入 L1
- ✅ `align` 5 种值：五端全支持 → 纳入 L1
- ⚠️ `gap` 小数精度：iOS/Android 支持任意值，Web 支持 → 纳入 L1
- ❌ `p-masonry` 精确控制：iOS/鸿蒙需自研 → 纳入 L2（降级）

### 5.2 不允许的语义

- ❌ "距左 13.7px" 这类**精确像素** → 违反语义一致（各平台最小间距单位不同）
- ❌ "阴影模糊半径 4.5" → 应用语义 token（如 `elevation.sm`）
- ✅ 改用语义 token：`spacing.md`、`radius.lg`、`elevation.sm`

---

## 6. 响应式与断点（语义层）

```vue
<p-flex
  direction="row"
  :wrap="true"
  :gap="spacing.md"
>
  <p-view :flex="1" />
  <p-view :flex="1" />
</p-flex>
```

**断点用语义 token，不用固定 px**：

```typescript
// tokens (五端统一语义)
spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }
radius  = { sm: 4, md: 8, lg: 12, xl: 20 }
```

各端映射到系统推荐值（iOS HIG spacing / Material spacing / 鸿蒙 design token）。

---

## 7. 对齐原则 #10 的验证清单

每个布局组件 PR 必须回答：

- [ ] 是否定义了清晰的**语义**（不依赖具体平台）？
- [ ] 是否映射到**各端原生实现**（非自绘）？
- [ ] 是否允许**平台差异**（语义一致而非像素一致）？
- [ ] 是否用了**语义 token**（非硬编码像素）？
- [ ] 是否遵循 **L1/L2/L3 分层**（五端支持情况）？

---

## 8. 示例：从 Vue SFC 到五端原生

```vue
<!-- 业务代码（一份，五端通用） -->
<p-flex direction="row" justify="space-between" align="center" :gap="spacing.md">
  <p-text>标题</p-text>
  <p-button>操作</p-button>
</p-flex>
```

Compiler 产出统一 IR → 各端 Renderer 映射：

```
iOS       → UIStackView (horizontal, equalSpacing, center, spacing=12pt)
鸿蒙      → Flex (Row, SpaceBetween, Center, gap=12vp)
Android   → ConstraintLayout (horizontal chain, spread, center, gap=12dp)
Web       → div (flex, row, space-between, center, gap=12px)
Skyline   → view (flex, row, space-between, center, gap=12px)
```

**视觉表现符合各平台规范，但"两端对齐 + 居中"语义完全一致。**

---

> **Component plan 的布局语义 = 原则 #10 在组件层的具体落地：定义"做什么"，让各端决定"怎么做"。**
