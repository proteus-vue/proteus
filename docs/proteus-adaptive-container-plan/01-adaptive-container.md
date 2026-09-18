# Proteus 自适应容器（Adaptive Container）

> **执行位**：G-22 补充（柔性布局体系第五个原语 `p-adaptive`）
> **关联**：`p-grid` / `p-fluid` / `p-stack` / `p-fit`（G-22 四原语）、Compiler Plugin（G-21）、Style Safety（G-16）、Safe Area（G-09）、Glass（G-07）
> **状态**：规划（M1 后落地，**B1 已落地**：parse/validate/compute 纯逻辑在 `@proteus-vue/fluid` adaptive.ts + fluid:check FLD007-009）

---

## 1. 问题：柔性布局只解决了"内容"，没解决"容器形态"

G-22 的四个柔性原语覆盖的是**内容布局层**：

| 原语 | 解决的问题 |
|------|-----------|
| `p-grid` | 列数随容器宽度自适应 |
| `p-fluid` | 数值（字号/间距）在 min-max 间流式缩放 |
| `p-stack` | 方向 + 换行策略自适应 |
| `p-fit` | 尺寸由内容内在需求驱动 |

但有一类布局**不在内容层，而在容器形态层**：

- 弹窗：手机上应该是底部 Sheet，平板上应该是居中 Dialog，桌面应该是指向触发源的 Popover
- 导航：手机上应该是底部 TabBar + 汉堡菜单，平板上应该是左侧 Sidebar，桌面应该是顶部 NavBar
- 详情：手机上应该全屏跳转，平板上应该做 Master-Detail 双栏

**这些是"同一个语义在不同宽度下呈现完全不同的 UI 形态"，不是"同一个 UI 等比缩放"。**

rpx 解决不了（它是数值缩放），CSS 媒体查询能做但**只生成样式分支，映射不到各端原生容器**——uni-app/Flutter/RN 最终都得让开发者手动 `if (width < 600)` 切换组件。

## 2. 本质洞察：把"自适应容器"也做成系统能力映射

柔性布局体系的方法论是**原则 #10（统一语义 + 原生实现）**：

- `p-grid` → iOS `UICollectionView` / Android `GridLayoutManager` / 鸿蒙 `Grid`
- `p-fluid` → CSS `clamp()` + `vw`
- **`p-adaptive` → iOS `UISheetPresentationController` / `UISplitViewController` / Android `BottomSheet` / `NavigationRail` / 鸿蒙 `SideBarContainer`**

**iOS/Android/鸿蒙系统本身就有"同一语义随尺寸切换形态"的能力**，Proteus 只是把它语义化 + 声明式化 + 跨端统一。这与 Glass（`UIGlassEffect`）、SafeArea（`safeAreaInsets`）、Memorial（系统灰度 API）是同一套方法论。

## 3. 核心原语：`p-adaptive`

### 3.1 API 设计

```vue
<!-- 弹窗：随宽度切换 sheet / dialog / popover -->
<p-modal p-adaptive="
  sheet(0, 600) |
  dialog(600, 840) |
  popover(840, ∞)
" :anchor="triggerRef">
  弹窗内容（内部用 p-grid / p-stack 自适应排布）
</p-modal>

<!-- 导航：随宽度切换 drawer / sidebar / topnav -->
<p-nav p-adaptive="
  drawer(0, 840) |
  sidebar(840, 1280) |
  topnav(1280, ∞)
" />

<!-- 详情：随宽度切换 fullscreen / master-detail -->
<p-detail p-adaptive="
  fullscreen(0, 768) |
  split(768, ∞)
" />
```

### 3.2 断点语义

`p-adaptive` 接收一个**有序的形态区间列表**：

- 格式：`形态名(起始宽度, 结束宽度)`，单位逻辑点（pt）
- 区间必须**连续不重叠**，Compiler 校验（FLD007）
- 区间端点从 `app.config.layout.breakpoints` 读取（与 `p-fluid` 共享断点体系）
- **宽度指"容器宽度"，不是屏幕宽度**——嵌套容器各自独立判断

### 3.3 形态切换是"换容器"，不是"换样式"

关键点：`p-adaptive` 切换的不是 CSS class，而是**各端原生容器组件**：

```
sheet   → iOS UIViewController(Sheet) / Android BottomSheetDialog
dialog  → iOS UIAlertController(.alert) / Android AlertDialog
popover → iOS UIPopoverPresentationController / 鸿蒙 Popup
```

**这意味着形态切换由系统原生动画驱动**，不是 Vue 侧手动 `v-if` + CSS transition——与 Glass、SafeArea 一致，"系统级能力，框架只做语义收敛"。

## 4. 弹窗组件实战

### 4.1 开发者只写一次

```vue
<template>
  <button @click="open" ref="btn">操作</button>

  <p-modal
    v-model:visible="visible"
    p-adaptive="sheet(0,600) | dialog(600,840) | popover(840,∞)"
    :anchor="btn"
  >
    <template #header>确认操作</template>
    <p-stack direction="column" :wrap="true" :gap="12">
      <p-button variant="primary" @click="confirm">确定</p-button>
      <p-button @click="visible = false">取消</p-button>
    </p-stack>
  </p-modal>
</template>
```

### 4.2 各端实际呈现

| 容器宽度 | 形态 | iOS | Android | 鸿蒙 | Web |
|----------|------|-----|---------|------|-----|
| < 600pt | Sheet | `UISheetPresentationController`（medium/large detent） | `BottomSheetDialog` | `Sheet` | `position: fixed; bottom: 0` |
| 600–840pt | Dialog | `UIAlertController(.alert)` 居中 | `AlertDialog` 居中 | `Dialog` | 居中 modal |
| > 840pt | Popover | `UIPopoverPresentationController`（指向 anchor） | `PopupWindow` + `Epicenter` | `Popup` + `target` | anchored popover |

### 4.3 内部布局依然柔性

弹窗**内部**用 `p-stack` / `p-grid` 排布按钮——窄屏竖排、宽屏横排换行。**外层形态 + 内层布局双重自适应**，开发者无需任何媒体查询。

## 5. 与 iOS 系统能力的同构性

iOS 15+ 的 `UISheetPresentationController` 本身就支持：

- `detents`: `[.medium, .large]` —— 根据内容/尺寸自动选
- `prefersEdgeAttachedInCompactHeight` —— 横屏自动贴边变 popover 形态
- `widthFollowsPreferredContentSizeWhenEdgeAttached` —— 跟随内容宽度

**Proteus `p-adaptive` = 把这套"系统自动选形态"的能力跨端统一 + 声明式化。** 这不是模拟，是映射。

> Flutter 的 `AdaptiveScaffold`（`go_router` + `adaptive_breakpoints`）尝试过类似方向，但只覆盖了 Material 规范的分支样式，**没有映射到各端原生容器**，且 API 冗长。Proteus 在编译期直接映射系统 API，更彻底。

## 6. 与 `p-fluid` / 媒体查询的边界

| 场景 | 用什么 | 为什么 |
|------|--------|--------|
| 字号/间距随宽度缩放 | `p-fluid` | 数值流式变化，结构不变 |
| 列数随宽度变化 | `p-grid` | 容器查询，内容重排 |
| **弹窗/导航/详情形态切换** | **`p-adaptive`** | **结构本身变了，必须换容器** |
| 简单样式微调 | CSS 媒体查询 | 无需换容器时直接用 |

**判断标准**：如果"窄屏和宽屏的 DOM 树结构不同"（弹窗 vs Sheet vs Popover 的触发/动画/层级都不同），就用 `p-adaptive`；如果只是样式差异，用 `p-fluid` 或媒体查询。

## 7. 严格规则补充（FLD 系列扩展）

| 规则 | 级别 | 说明 |
|------|------|------|
| FLD007 | error | `p-adaptive` 区间必须连续不重叠 |
| FLD008 | error | 禁止手动 `if (width < 600) showSheet()` 切换弹窗形态 → 用 `p-adaptive` |
| FLD009 | warning | `p-adaptive` 区间端点须来自 `app.config.layout.breakpoints` |

`--strict-fluid` 校验时一并检查。

## 8. 性能与降级

- **形态切换监听容器宽度变化**（ResizeObserver / `onSizeChanged` / `onConfigurationChanged`），**不监听屏幕旋转**——嵌套容器安全
- **切换过程走系统原生转场动画**，不消耗 Vue 响应式开销
- **低端设备降级**：不支持 `UISheetPresentationController`（iOS < 15）时降级为普通 `UIViewController` 模态——与 Glass 的降级链（L3→L2→L1→solid）一致
- **Web 不支持 popover 定位时**降级为 `position: fixed` 居中

## 9. 对标竞品

| 能力 | uni-app | Flutter | RN | **Proteus** |
|------|---------|---------|-----|-------------|
| 声明式断点形态切换 | ❌ 手动 | ⚠️ `AdaptiveScaffold`（样式级） | ❌ `Dimensions.get()` | ✅ `p-adaptive`（容器级） |
| 映射到系统原生容器 | ❌ | ❌ | ❌ | ✅ iOS/Android/鸿蒙 |
| 弹窗 sheet/dialog/popover 自动选 | ❌ | ⚠️ `showModalBottomSheet` 手动 | ❌ | ✅ 声明即自动 |
| 导航 drawer/sidebar/topnav 自动选 | ❌ | ⚠️ `NavigationRail` | ❌ | ✅ |
| 容器宽度感知（非屏幕） | ❌ | ⚠️ `LayoutBuilder` | ⚠️ `useWindowDimensions` | ✅ 容器查询 |

**Proteus 是唯一把"自适应容器"做成编译期系统原生映射的框架。**

## 10. 对外表述（一句话）

> **uni-app 的弹窗是"开发者自己判断屏幕宽度手动切换组件"；Proteus 的弹窗是 `<p-modal p-adaptive="sheet|dialog|popover">`——手机上 Sheet、平板上 Dialog、桌面上 Popover，系统原生动画，开发者写一次。这是把 iOS `UISheetPresentationController`、Android `BottomSheet`、鸿蒙 `SideBarContainer` 的系统级自适应能力搬进了框架，与 Glass、SafeArea 同源。**
