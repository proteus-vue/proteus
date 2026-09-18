# Proteus 柔性布局：与 rpx 的本质差异

> 执行位：**G-22**（补充定位文档，配套 `02-system-capability-mapping.md`）
> 状态：Draft → 待评审 → 合并至 `01-fluid-layout.md` 第 2 章
> 核心主张：**rpx 是"单位换算"，Proteus 是"把终端厂商 / 操作系统的柔性布局能力搬进框架"——两者不在同一层级。**

---

## 1. 一句话定位

**rpx 解决的是"不同屏幕宽度下数值怎么等比缩放"，Proteus 解决的是"不同屏幕尺寸、密度、形态、折叠状态下，布局结构如何自适应"。**

前者是**标量换算**，后者是**布局引擎能力**。Proteus 的柔性布局不是"升级版 rpx"，而是把各平台原生布局系统的语义直接收敛进框架。

---

## 2. rpx 的本质：响应式单位（Scalar）

rpx（uni-app / 微信小程序）的设计：

```
设计稿 750rpx = 屏幕宽度 100%
1rpx = 屏幕宽度 / 750
```

| 维度 | rpx 的行为 |
|------|-----------|
| 换算时机 | 编译期 / 运行时按比例缩放 |
| 本质 | 把 `px` 换成"相对于基准宽度的比例值" |
| 适配对象 | 仅**屏幕宽度** |
| 布局结构 | **不变**（列数、换行、方向都不变） |
| 开发者负担 | 仍需手写 media query 或手动调整 flex |

**rpx 的盲区**（这些是真实业务痛点）：

- ❌ 屏幕变宽后，元素只是"等比变大"，不会"多排一列"
- ❌ 折叠屏展开 / 平板横屏，布局结构不变 → 两侧留白巨大
- ❌ 分屏模式、多窗口、桌面窗口缩放无感知
- ❌ 无法表达"最小 160dp 自动换行"这种**结构自适应**
- ❌ 与系统级 `ConstraintLayout` / `UIStackView` / `SwiftUI Layout` **无任何对接**

**结论：rpx 是"单位层"方案，解决的是数值缩放，不是布局自适应。**

---

## 3. Proteus 的本质：系统级布局能力收敛（Capability）

Proteus 柔性布局的语义直接来源于各平台原生布局系统：

| 平台 | 系统级柔性布局能力 | Proteus 语义原语 |
|------|------------------|----------------|
| **iOS** | `UIStackView`（axis/distribution/alignment）、`UICollectionView` 自适应网格、`NSLayoutConstraint` 不等式约束 | `<p-stack>`、`<p-grid>`、`p-fluid` 区间 |
| **Android** | `ConstraintLayout`（chains/barriers/guidelines）、`FlexboxLayout`、`GridLayoutManager` spanSizeLookup | `<p-stack direction wrap>`、`<p-grid :min-col-width>` |
| **鸿蒙** | `Flex` 组件（wrap/reverse）、`Grid`（`columnsTemplate`/`minCount`）、`RelativeContainer` | `<p-stack>`、`<p-grid>` |
| **Web** | CSS Flexbox / Grid、`clamp()`、`minmax()`、`auto-fill`/`auto-fit`、`container queries` | `p-fluid` → `clamp()`、`p-grid` → `repeat(auto-fit)` |
| **Skyline** | 同 Web，但编译期为静态 WXSS + Worklet 驱动 | AOT 预编译网格 + 原生滚动容器 |

**核心洞察：这些平台的"柔性"能力在语义上高度同构——都有"主轴/交叉轴"、"换行"、"最小尺寸约束"、"自适应列数"。Proteus 做的是把这套**共同语义**抽象出来，而不是发明新单位。**

---

## 4. 三层对照（rpx vs Proteus）

### 第一层：数值缩放

```vue
<!-- rpx：等比缩放，750 设计稿直接换单位 -->
<view style="width: 375rpx; font-size: 32rpx;" />

<!-- Proteus：区间 + 断点推导，数值本身参与布局决策 -->
<h1 p-fluid="font-size(20, 32)" />
<div p-fluid="width(300, 600)" />
```

| | rpx | Proteus `p-fluid` |
|---|---|---|
| 换算 | `值 × (屏幕宽/750)` | `clamp(min, vw 线性, max)` |
| 有下限 | ❌ 会无限小 | ✅ `min` 兜住 |
| 有上限 | ❌ 会无限大 | ✅ `max` 兜住 |
| 对应系统能力 | 无 | CSS `clamp` / `UIView` 约束不等式 / `ConstraintLayout` bias |

### 第二层：结构自适应（**rpx 完全做不到**）

```vue
<!-- 屏幕窄 → 1 列；宽 → 自动 4/8 列；折叠屏展开 → 更多 -->
<p-grid :min-col-width="160">
  <p-card v-for="item in items" :key="item.id" />
</p-grid>
```

| 屏幕宽度 | 列数 | rpx 能做到吗 |
|---------|------|------------|
| 320 (小屏手机) | 1 | ❌ rpx 只是把每张卡片等比缩小 |
| 768 (平板) | 4 | ❌ |
| 1440 (桌面/展开) | 8 | ❌ |
| 动态窗口缩放 | 实时重算 | ❌ |

**`p-grid` 直接映射到：**
- iOS：`UICollectionViewFlowLayout` + `NSCollectionLayoutDimension.estimated()`
- Android：`GridLayoutManager` + `SpanSizeLookup`（按宽度动态返回 span）
- 鸿蒙：`Grid` 的 `columnsTemplate` / `minCount`
- Web/Skyline：`grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))`

**这些全都是系统级容器能力，不是单位换算。**

### 第三层：形态自适应（**跨代差**）

| 场景 | rpx | Proteus |
|------|-----|---------|
| 折叠屏展开/折叠 | ❌ 无感知 | ✅ 监听 `onWindowSizeChange` → 重算约束 |
| 分屏 / 多窗口 | ❌ | ✅ 基于 `SafeArea` + `Container` 尺寸 |
| 桌面窗口拖拽缩放 | ❌ | ✅ `p-grid` 实时 reflow |
| 横竖屏旋转 | 仅宽高变，结构不变 | ✅ 断点切换 + 布局结构变化 |
| 灵动岛 / 挖孔避让 | ❌ | ✅ 对接 `SafeArea`（G-09） |

---

## 5. 架构定位：为什么只有"原生渲染"框架能做这件事

**rpx 之所以停留在单位层，是因为它的宿主（WebView / 小程序逻辑层）没有跨端一致的布局引擎语义——它只能操作 CSS，而 CSS 的 `flex` 在不同端表现不完全一致。**

Proteus 能搬到框架里的原因是 **原则 #10：统一语义 + 原生实现**：

```
<p-grid :min-col-width="160">
    ↓ Compiler 分析（G-21 Plugin）
    ↓ 生成 LayoutConstraint IR
    ↓ 各端 nodeOps 映射
┌─────────────────────────────────┐
│ iOS     → UICollectionView      │  ← 系统级网格
│ Android → RecyclerView+GridLM   │  ← 系统级网格
│ 鸿蒙     → Grid(minCount)       │  ← 系统级网格
│ Web      → CSS Grid(auto-fit)   │  ← 浏览器原生
│ Skyline  → 原生滚动容器         │  ← 小程序原生
└─────────────────────────────────┘
```

**关键点：Proteus 不模拟网格，而是让每个平台用自己的原生网格容器去实现同一个语义。** 这与 Glass（G-07）的"系统级玻璃"、SafeArea（G-09）的"系统级安全区"、Memorial（G-11）的"系统级灰度"是**同一套哲学**——**把操作系统的能力搬进框架**。

---

## 6. 对标总结

| 能力 | rpx | Flutter Expanded/Flex | RN flex | **Proteus** |
|------|-----|----------------------|---------|------------|
| 数值等比缩放 | ✅ | ✅ | ✅ | ✅ (`p-fluid`) |
| 自适应列数 | ❌ | ⚠️ (需手动 SliverGrid) | ❌ | ✅ (`p-grid`) |
| 换行/换列结构变化 | ❌ | ⚠️ | ⚠️ | ✅ |
| 折叠屏/分屏感知 | ❌ | ⚠️ (MediaQuery) | ❌ | ✅ (系统事件) |
| **映射系统原生容器** | ❌ (仅 CSS) | ❌ (自绘) | ⚠️ ( Yoga) | ✅ (各端原生) |
| 编译期推导 | ❌ | ❌ | ❌ | ✅ (clamp/断点) |
| AI Agent 可操作 IR | ❌ | ❌ | ❌ | ✅ (G-23) |

**Proteus 是唯一把"系统柔性布局能力"+"编译期约束推导"+"AI 可操作 IR"三者合一的框架。**

---

## 7. 对外表述（可直接用于 positioning.md）

> **Proteus 的柔性布局与 rpx 有本质差异。rpx 是响应式单位——把 px 按屏幕宽度等比换算，只解决数值缩放，屏幕变宽后布局结构不变，折叠屏、分屏、窗口缩放全部无感知。Proteus 则是把 iOS UIStackView / UICollectionView、Android ConstraintLayout / GridLayoutManager、鸿蒙 Flex/Grid、Web CSS Grid 这些**终端厂商与操作系统级的柔性布局能力**，通过统一语义收敛进框架：开发者写一次 `<p-grid :min-col-width="160">`，框架让每个平台用各自的原生容器去实现——屏幕越宽自动排越多列，折叠屏展开、窗口拖拽实时 reflow。这是"把系统能力搬进来"，而不是"换个单位"。**

---

## 8. 后续动作

- [ ] 将此文档内容合并进 `01-fluid-layout.md` 第 2 章「为什么需要柔性布局」
- [ ] 在 `proteus-positioning-v3.md` 对标矩阵新增「布局适配」行，四列：rpx / Flutter / RN / **Proteus**
- [ ] G-22 Compiler Plugin 增加 `systemCapability` 检测：编译期校验目标端是否支持对应原生容器，不支持则降级（对接 `08-degradation.md`）

---

## 附：系统能力映射明细 → 见 `02-system-capability-mapping.md`
