---
title: CSS cross-end support reference
order: 43
group: 工程参考
generated: true
---

# CSS cross-end support reference

> How 79 CSS capabilities are supported across **Web / Skyline / App**, with App extensibility tier.
> ★Auto-generated (`scripts/gen-css-support.mjs`), SSOT = `docs/generated/css-capability-alignment.json`; drift gate `--check`.

## End model

- **Web** — native browser CSSOM (the baseline).
- **Skyline** — WeChat Mini Program container (the one rigid external constraint).
- **App** — in-house self-drawn Rust engine (one engine, covering iOS / Android / HarmonyOS; the CSS surface is ours to define and extend).

## App status values

| Value | Meaning |
|---|---|
| `supported` | compile-time fold + engine + host drawing all pass (actually on screen) |
| `folded-only` | folded into the kernel tree at compile time, but the host does not draw it yet (read honestly, not as supported) |
| `engine-only` | engine / host can already draw it, but the compile-time fold surface is not wired yet (an available extension point) |
| `absent` | not present today (candidate; see tier / strategy) |

## App extensibility tiers (L0–L5 cost levels)

| Tier | Meaning |
|---|---|
| L0 | zero runtime cost (fully foldable at compile time: selectors / cascade / inheritance / specificity / unit conversion) |
| L1 | low runtime cost (pure drawing / direct mapping; e.g. backgroundColor / border-radius / opacity) |
| L2 | moderate cost (supported on demand; flex / position / overflow / grid — needs layout and containing-block resolution) |
| L3 | high cost (off by default; z-index / fixed·sticky / 3D / filter / shadow / will-change — affects compositing layers and memory) |
| L4 | not in-house (reuse the platform: fonts / BiDi / emoji / complex rich text) |
| L5 | forbidden (compile-time error: runtime dynamic selectors / unfoldable cascade / runtime stylesheet insertion / beyond profile) |

## Capability matrix

| Category | CSS | Web | Skyline | App status | App extensible | Strategy | Alignment |
|---|---|---|---|---|---|---|---|
| 绘制 | `outline-offset` | ◻ n/a | ◻ not listed | ✅ yes | L2 | host-drawn | conditional |
| 绘制 | `outline（+ outline-width/-color/-style 长手）` | ◻ n/a | ◻ not listed | ✅ yes | L2 | host-drawn | conditional |
| 布局 | `width` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 布局 | `height` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 布局 | `min-width / max-width / min-height / max-height` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 布局 | `margin（+ 四边简写 + 1–4 值 shorthand）` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 布局 | `padding（+ 四边简写 + 1–4 值 shorthand）` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 布局 | `display: flex / none` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `flex-direction` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `justify-content` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `align-items / align-self` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `flex-grow / flex-shrink / flex-basis` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `gap（+ row-gap / column-gap）` | ◐ partial | ◐ partial | ✅ yes | L2 | direct mapping | conditional |
| 布局 | `position: static / relative / absolute` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `top / left` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `overflow: visible / hidden / scroll / auto` | ◐ partial | ◐ partial | ✅ yes | L2 | direct mapping | conditional |
| 取值 | `margin/padding 1–4 值简写 + background 纯色简写 + flex 简写` | — | — | ✅ yes | L1 | compile-time fold | conditional |
| 单位 | `width/height 百分比` | — | — | ✅ yes | L1 | compile-time fold | conditional |
| 绘制 | `background-color（+ background 纯色简写）` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 绘制 | `background-size` | ◻ n/a | ✅ yes | ✅ yes | L2 | host geometry | conditional |
| 绘制 | `background-position` | ◻ n/a | ✅ yes | ✅ yes | L2 | host geometry | conditional |
| 绘制 | `background-repeat` | ◻ n/a | ✅ yes | ✅ yes | L2 | host geometry | conditional |
| 绘制 | `color` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 绘制 | `font-size` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 绘制 | `border-radius` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 绘制 | `opacity` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 特殊 | `box-sizing` | ✅ yes | ✅ yes | ✅ yes | L1 | direct mapping | universal |
| 绘制 | `border（简写）/ border-color / border-width` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 绘制 | `border-top` | ◻ n/a | ✅ yes | ✅ yes | L1 | compile-time fold | conditional |
| 绘制 | `border-right` | ◻ n/a | ✅ yes | ✅ yes | L1 | compile-time fold | conditional |
| 绘制 | `border-bottom` | ◻ n/a | ✅ yes | ✅ yes | L1 | compile-time fold | conditional |
| 绘制 | `border-left` | ◻ n/a | ✅ yes | ✅ yes | L1 | compile-time fold | conditional |
| 动效 | `transform（2D：translate / scale / rotate）` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 动效 | `transform-origin` | ✅ yes | ✅ yes | ✅ yes | L2 | compile-time fold | universal |
| 选择器 | `类选择器 .a / .a.b` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| 选择器 | `元素/类型选择器 h3 / p.foo` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| 选择器 | `后代 / 子组合 .a .b / .a > .b` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| 选择器 | `静态结构伪类 :first-child / :last-child / :nth-child(An+B\|odd\|even) / :not(简单选择器)` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| 选择器 | `状态伪类 :hover / :active / :focus / :checked` | — | — | no | L2 | degrade | unsupported |
| 选择器 | `属性选择器 [data-x]` | — | — | no | L0 | compile-time fold | unsupported |
| 选择器 | `Vue 作用域穿透 :deep() / ::v-deep() / >>>` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| 选择器 | `兄弟组合 + / ~` | — | — | no | L5 | forbidden | unsupported |
| 选择器 | `通配 *` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| 层叠 | `特异性 / 继承 / !important` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| @ 规则 | `@media（响应式 / 环境条件）` | — | — | ✅ yes | L2 | dedicated channel | conditional |
| @ 规则 | `@supports（特性检测）` | — | — | ✅ yes | L2 | dedicated channel | conditional |
| @ 规则 | `@keyframes（关键帧动画）` | — | — | ✅ yes | L1 | compile-time fold | conditional |
| @ 规则 | `animation（简写：name duration timing delay …）` | — | — | ✅ yes | L1 | compile-time fold | conditional |
| 层叠 | `CSS 自定义属性（design tokens）var(--x)` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| 单位 | `min() / max() / clamp()` | — | — | ✅ yes | L0 | compile-time fold | conditional |
| 单位 | `em / rem / vw / vh / calc / clamp` | — | — | no | L0 | compile-time fold | unsupported |
| 布局 | `display: grid + grid-template-columns/rows（显式轨迹）+ grid-column/row 线号放置` | ◐ partial | ◻ not listed | ✅ yes | L2 | direct mapping | conditional |
| 布局 | `justify-self（网格项行内轴自对齐）` | ◻ n/a | ◻ not listed | ✅ yes | L2 | direct mapping | conditional |
| 布局 | `place-items（+ justify-items 长手）` | ◻ n/a | ◻ not listed | ✅ yes | L2 | shorthand expand | conditional |
| 文本 | `word-break（行内断词策略）` | ✅ yes | ✅ yes | ✅ yes | L4 | direct mapping | universal |
| 布局 | `aspect-ratio` | ◻ n/a | ◻ not listed | ✅ yes | L2 | compile-time fold | conditional |
| 布局 | `flex-wrap` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `align-content` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `right / bottom` | ✅ yes | ✅ yes | ✅ yes | L2 | direct mapping | universal |
| 布局 | `inset（top/right/bottom/left 的 1–4 值缩写）` | — | — | ✅ yes | L2 | compile-time fold | conditional |
| 布局 | `order` | ✅ yes | ✅ yes | no | L2 | direct mapping | conditional |
| 层 | `z-index` | ✅ yes | ✅ yes | no | L3 | semantic component | conditional |
| 绘制 | `box-shadow` | ✅ yes | ✅ yes | ✅ yes | L3 | compile-time fold | universal |
| 绘制 | `text-shadow` | ◻ n/a | ✅ yes | ✅ yes | L3 | compile-time fold | conditional |
| 绘制 | `filter / backdrop-filter` | ✅ yes | ✅ yes | no | L3 | semantic component | conditional |
| 文本 | `font-weight` | ◻ n/a | ✅ yes | ✅ yes | L1 | compile-time fold | conditional |
| 文本 | `text-decoration` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 文本 | `text-align` | ◻ n/a | ✅ yes | ✅ yes | L1 | compile-time fold | conditional |
| 文本 | `line-height` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 文本 | `text-overflow` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 文本 | `-webkit-line-clamp: <integer>` | ◻ n/a | ◻ not listed | ✅ yes | L1 | compile-time fold | conditional |
| 文本 | `letter-spacing` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 文本 | `font-family` | ✅ yes | ✅ yes | ✅ yes | L4 | compile-time fold | universal |
| 文本 | `white-space` | ✅ yes | ✅ yes | no | L4 | degrade | conditional |
| 布局 | `pointer-events` | ◻ n/a | ✅ yes | ✅ yes | L2 | compile-time fold | conditional |
| 绘制 | `visibility` | ✅ yes | ✅ yes | ✅ yes | L1 | compile-time fold | universal |
| 布局 | `grid-auto-flow` | ◻ n/a | ◻ not listed | ✅ yes | L2 | direct mapping | conditional |
| 布局 | `grid-template-areas` | ◻ n/a | ◻ not listed | ✅ yes | L2 | direct mapping | conditional |
| 布局 | `grid-area` | ◻ n/a | ◻ not listed | ✅ yes | L2 | direct mapping | conditional |

## Per-capability notes (by category)

> Detailed semantics / boundaries are maintained in Chinese in the source of truth; this page lists the support matrix.

### 绘制

- **`outline-offset`** — host-drawn · conditional
- **`outline（+ outline-width/-color/-style 长手）`** — host-drawn · conditional
- **`background-color（+ background 纯色简写）`** — compile-time fold · universal
- **`background-size`** — host geometry · conditional
- **`background-position`** — host geometry · conditional
- **`background-repeat`** — host geometry · conditional
- **`color`** — compile-time fold · universal
- **`font-size`** — compile-time fold · universal
- **`border-radius`** — compile-time fold · universal
- **`opacity`** — compile-time fold · universal
- **`border（简写）/ border-color / border-width`** — compile-time fold · universal
- **`border-top`** — compile-time fold · conditional
- **`border-right`** — compile-time fold · conditional
- **`border-bottom`** — compile-time fold · conditional
- **`border-left`** — compile-time fold · conditional
- **`box-shadow`** — compile-time fold · universal
- **`text-shadow`** — compile-time fold · conditional
- **`filter / backdrop-filter`** — semantic component · conditional
- **`visibility`** — compile-time fold · universal

### 布局

- **`width`** — compile-time fold · universal
- **`height`** — compile-time fold · universal
- **`min-width / max-width / min-height / max-height`** — compile-time fold · universal
- **`margin（+ 四边简写 + 1–4 值 shorthand）`** — compile-time fold · universal
- **`padding（+ 四边简写 + 1–4 值 shorthand）`** — compile-time fold · universal
- **`display: flex / none`** — direct mapping · universal
- **`flex-direction`** — direct mapping · universal
- **`justify-content`** — direct mapping · universal
- **`align-items / align-self`** — direct mapping · universal
- **`flex-grow / flex-shrink / flex-basis`** — direct mapping · universal
- **`gap（+ row-gap / column-gap）`** — direct mapping · conditional
- **`position: static / relative / absolute`** — direct mapping · universal
- **`top / left`** — direct mapping · universal
- **`overflow: visible / hidden / scroll / auto`** — direct mapping · conditional
- **`display: grid + grid-template-columns/rows（显式轨迹）+ grid-column/row 线号放置`** — direct mapping · conditional
- **`justify-self（网格项行内轴自对齐）`** — direct mapping · conditional
- **`place-items（+ justify-items 长手）`** — shorthand expand · conditional
- **`aspect-ratio`** — compile-time fold · conditional
- **`flex-wrap`** — direct mapping · universal
- **`align-content`** — direct mapping · universal
- **`right / bottom`** — direct mapping · universal
- **`inset（top/right/bottom/left 的 1–4 值缩写）`** — compile-time fold · conditional
- **`order`** — direct mapping · conditional
- **`pointer-events`** — compile-time fold · conditional
- **`grid-auto-flow`** — direct mapping · conditional
- **`grid-template-areas`** — direct mapping · conditional
- **`grid-area`** — direct mapping · conditional

### 取值

- **`margin/padding 1–4 值简写 + background 纯色简写 + flex 简写`** — compile-time fold · conditional

### 单位

- **`width/height 百分比`** — compile-time fold · conditional
- **`min() / max() / clamp()`** — compile-time fold · conditional
- **`em / rem / vw / vh / calc / clamp`** — compile-time fold · unsupported

### 特殊

- **`box-sizing`** — direct mapping · universal

### 动效

- **`transform（2D：translate / scale / rotate）`** — compile-time fold · universal
- **`transform-origin`** — compile-time fold · universal

### 选择器

- **`类选择器 .a / .a.b`** — compile-time fold · conditional
- **`元素/类型选择器 h3 / p.foo`** — compile-time fold · conditional
- **`后代 / 子组合 .a .b / .a > .b`** — compile-time fold · conditional
- **`静态结构伪类 :first-child / :last-child / :nth-child(An+B|odd|even) / :not(简单选择器)`** — compile-time fold · conditional
- **`状态伪类 :hover / :active / :focus / :checked`** — degrade · unsupported
- **`属性选择器 [data-x]`** — compile-time fold · unsupported
- **`Vue 作用域穿透 :deep() / ::v-deep() / >>>`** — compile-time fold · conditional
- **`兄弟组合 + / ~`** — forbidden · unsupported
- **`通配 *`** — compile-time fold · conditional

### 层叠

- **`特异性 / 继承 / !important`** — compile-time fold · conditional
- **`CSS 自定义属性（design tokens）var(--x)`** — compile-time fold · conditional

### @ 规则

- **`@media（响应式 / 环境条件）`** — dedicated channel · conditional
- **`@supports（特性检测）`** — dedicated channel · conditional
- **`@keyframes（关键帧动画）`** — compile-time fold · conditional
- **`animation（简写：name duration timing delay …）`** — compile-time fold · conditional

### 文本

- **`word-break（行内断词策略）`** — direct mapping · universal
- **`font-weight`** — compile-time fold · conditional
- **`text-decoration`** — compile-time fold · universal
- **`text-align`** — compile-time fold · conditional
- **`line-height`** — compile-time fold · universal
- **`text-overflow`** — compile-time fold · universal
- **`-webkit-line-clamp: <integer>`** — compile-time fold · conditional
- **`letter-spacing`** — compile-time fold · universal
- **`font-family`** — compile-time fold · universal
- **`white-space`** — degrade · conditional

### 层

- **`z-index`** — semantic component · conditional

> Reproduce: the capability acceptance project (`css-conformance`) verifies each page against this matrix; end-specific boundaries follow real device measurement.

<!-- generated by scripts/gen-css-support.mjs (en overlay) · SSOT: docs/generated/css-capability-alignment.json -->