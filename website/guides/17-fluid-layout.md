---
title: 柔性布局
order: 17
group: 渲染与能力
---

# 柔性布局（G-22：比 rpx 高一个代际）

## rpx 是单位换算，柔性是系统级布局

rpx 的本质是"数值等比缩放"——结构永远不变，大屏只是把手机放大。Proteus 把 **iOS `UICollectionView` / Android `GridLayoutManager` / CSS Grid 的系统级布局能力**收敛为语义原语：

- `p-fluid`：流式尺寸（clamp 插值，视口连续变化零跳变）
- `p-grid`：自适应网格（min-col-width 决定列数，屏越宽排越多列）
- `p-stack` / `p-split` / `p-aspect` / `p-fit`：结构语义
- `p-safe`：安全区语义（刘海/灵动岛/手势条）

## 本官网就是柔性布局写的（W-6 柔性框架优先）

```html
<!-- 排版：clamp 流式插值——375px 设计稿 30px，1440px 视口 58px，中间线性连续 -->
<h1 v-p-fluid="'font-size(30, 58)'">One semantic model.</h1>

<!-- 网格：列数随容器宽度自动伸缩，无断点魔数 -->
<div class="feature-grid">
  <!-- grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)) -->
</div>
```

**零 `@media` 断点**。断点是"平台 API 式"的离散跳变：375px 时 1 列、820px 时 2 列、中间宽度强行选边。柔性布局是连续解——这就是本官网（你自己正在看的页面）的响应式实现方式。

## 铁律（FLD 系列）

- FLD001：禁止手写 `@media` 断点（断点逻辑归语义原语）
- FLD002：禁止硬编码断点数字
- FLD003：`p-fluid` 必须给区间（min, max）
- FLD008：禁止手动 `if (width < 600)` 宽度分支

```bash
proteus fluid:check   # 编译期门禁
```

## 自适应容器（G-22.5）

`p-adaptive` 让弹窗**整个形态**随宽度切换：`sheet(0,600) | dialog(600,840) | popover(840,∞)`，映射各端原生容器（`UISheetPresentationController` / `BottomSheetDialog`）。开发者只写一次。
