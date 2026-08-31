# 04 语义样式组件（🔶 级别封装）

> 对 Web 有、但原生端无一对一属性的能力，统一收敛为 `<p-*>` 语义组件。
> 组件内部按端映射，**业务层零平台分支**。

## 一、组件清单

### `<p-glass>` —— 背景模糊（Glass L3）

```vue
<p-glass preset="navigationBar" blur="20" />
```

| 端 | 映射 |
|----|------|
| Web | `backdrop-filter: blur(20px)` |
| Skyline | `backdrop-filter`（小程序同层渲染） |
| iOS | `UIGlassEffect`（iOS 26 系统级） |
| 鸿蒙 | `effect: blur` |
| Android | `RenderEffect.createBlurEffect` |

> 禁止裸写 `backdrop-filter`（`CSS009`），必须走 `<p-glass>`。
> 详细映射见 Glass plan §映射表。

### `<p-sticky>` —— 吸顶

```vue
<p-sticky offset="10">
  <p-view class="header">...</p-view>
</p-sticky>
```

| 端 | 映射 |
|----|------|
| Web | `position: sticky; top: 10px` |
| Skyline | `sticky-header` / `sticky-section` |
| iOS | `UICollectionViewCompositionalLayout` + sticky boundary |
| Android | `RecyclerView.ItemDecoration` + `StickyHeader` |
| 鸿蒙 | `List` + `sticky` 属性 |

### `<p-scroll>` —— 滚动容器

```vue
<p-scroll direction="vertical" :bounces="true">
  <p-view v-for="item in list" :key="item.id">...</p-view>
</p-scroll>
```

> Skyline 禁止裸 `overflow:scroll`，必须用 `<scroll-view>` 等价物 → `<p-scroll>`。
> 各端映射：Web=`overflow:auto`、iOS=`UIScrollView`、Android=`RecyclerView`、鸿蒙=`Scroll/List`。

### `<p-shadow>` —— 阴影

```vue
<p-shadow :elevation="4" color="#00000022" />
```

| 端 | 映射 |
|----|------|
| Web | `box-shadow` |
| iOS | `layer.shadow*` |
| Android | `elevation` + `translationZ` + 自定义 shadow |
| 鸿蒙 | `shadow` + ARGB |

颜色自动走 `rgba→ARGB` 重写（见 03）。

### `<p-bg-gradient>` —— 渐变

```vue
<p-bg-gradient direction="to-right" :stops="['#ff0','#f00']" />
```

| 端 | 映射 |
|----|------|
| Web | `linear-gradient()` |
| Skyline | 原生渐变 |
| iOS | `CAGradientLayer` |
| Android | `GradientDrawable` / `LinearGradient` (Compose) |
| 鸿蒙 | `LinearGradient` 组件 |

### `<p-safe-area>` —— 安全区

```vue
<p-safe-area edges="top,bottom" />
```

映射：`env(safe-area-inset-*)` / `UILayoutGuide` / `WindowInsets` / `getWindowAvoidArea`。

## 二、设计原则

1. **一个语义组件 = 一个跨端能力**，内部封装全部平台差异
2. **Props 用设计语义命名**（`blur/elevation/preset`），不用平台术语
3. **回退策略**：低端机/降级模式（见 App Renderer 降级章）自动退化为非模糊/普通滚动
4. **类型安全**：每个组件在 Types plan 有完整 Props 定义（判别联合 + 平台收窄）

## 三、禁止的反模式

```vue
<!-- ❌ 裸写 backdrop-filter -->
<p-view style="backdrop-filter: blur(20px)" />

<!-- ✅ 走语义组件 -->
<p-glass blur="20" />

<!-- ❌ 用 float 做布局 -->
<p-view style="float: left" />

<!-- ✅ 用 p-flex -->
<p-flex direction="row">...</p-flex>
```

`--strict-css` 自动检测反模式并提示替换为对应 `<p-*>`。
