---
title: CSS cross-end support reference
order: 43
group: 工程参考
generated: true
---

# CSS cross-end support reference

> How 79 CSS capabilities are supported across **Web / Skyline / App**, with App extensibility tier. **Every capability has its own anchor** (jump from the on-page outline; deep-linkable from anywhere), measured against the **Web baseline**, with the in-house Rust engine graded **L0–L5**.
> ★Auto-generated (`scripts/gen-css-support.mjs`), SSOT = `docs/generated/css-capability-alignment.json`; drift gate `--check`.

## Overview

**79** capabilities: **32** universal · **43** conditional · **4** unsupported. App currently supports **71**, with **8** not present yet (candidates graded by tier).

### End model

- **Web** — native browser CSSOM (the baseline).
- **Skyline** — WeChat Mini Program container (the one rigid external constraint).
- **App** — in-house self-drawn Rust engine (one engine, covering iOS / Android / HarmonyOS; the CSS surface is ours to define and extend).

### App status values

| Value | Meaning |
|---|---|
| `supported` | compile-time fold + engine + host drawing all pass (actually on screen) |
| `folded-only` | folded into the kernel tree at compile time, but the host does not draw it yet (read honestly, not as supported) |
| `engine-only` | engine / host can already draw it, but the compile-time fold surface is not wired yet (an available extension point) |
| `absent` | not present today (candidate; see tier / strategy) |

### App extensibility tiers (L0–L5 cost levels)

| Tier | Meaning |
|---|---|
| L0 | zero runtime cost (fully foldable at compile time: selectors / cascade / inheritance / specificity / unit conversion) |
| L1 | low runtime cost (pure drawing / direct mapping; e.g. backgroundColor / border-radius / opacity) |
| L2 | moderate cost (supported on demand; flex / position / overflow / grid — needs layout and containing-block resolution) |
| L3 | high cost (off by default; z-index / fixed·sticky / 3D / filter / shadow / will-change — affects compositing layers and memory) |
| L4 | not in-house (reuse the platform: fonts / BiDi / emoji / complex rich text) |
| L5 | forbidden (compile-time error: runtime dynamic selectors / unfoldable cascade / runtime stylesheet insertion / beyond profile) |

## Capability index

> Click any capability to jump to its section (each has a stable, deep-linkable anchor).

| Category | Capabilities |
|---|---|
| [绘制](#cat-paint) | [outline-offset](#outline-offset) · [outline（+ outline-width/-color/-style 长手）](#outline) · [background-color（+ background 纯色简写）](#background-color) · [background-size](#background-size) · [background-position](#background-position) · [background-repeat](#background-repeat) · [color](#color) · [font-size](#font-size) · [border-radius](#border-radius) · [opacity](#opacity) · [border（简写）/ border-color / border-width](#border-color-width) · [border-top](#border-top) · [border-right](#border-right) · [border-bottom](#border-bottom) · [border-left](#border-left) · [box-shadow](#box-shadow) · [text-shadow](#text-shadow) · [filter / backdrop-filter](#filter-backdrop) · [visibility](#visibility) |
| [布局](#cat-layout) | [width](#width) · [height](#height) · [min-width / max-width / min-height / max-height](#min-max-wh) · [margin（+ 四边简写 + 1–4 值 shorthand）](#margin) · [padding（+ 四边简写 + 1–4 值 shorthand）](#padding) · [display: flex / none](#display) · [flex-direction](#flex-direction) · [justify-content](#justify-content) · [align-items / align-self](#align-items-self) · [flex-grow / flex-shrink / flex-basis](#flex-grow-shrink-basis) · [gap（+ row-gap / column-gap）](#gap) · [position: static / relative / absolute](#position) · [top / left](#top-left) · [overflow: visible / hidden / scroll / auto](#overflow) · [display: grid + grid-template-columns/rows（显式轨迹）+ grid-column/row 线号放置](#grid) · [justify-self（网格项行内轴自对齐）](#justify-self) · [place-items（+ justify-items 长手）](#place-items) · [aspect-ratio](#aspect-ratio) · [flex-wrap](#flex-wrap) · [align-content](#align-content) · [right / bottom](#right-bottom) · [inset（top/right/bottom/left 的 1–4 值缩写）](#inset) · [order](#order) · [pointer-events](#pointer-events) · [grid-auto-flow](#grid-auto-flow) · [grid-template-areas](#grid-template-areas) · [grid-area](#grid-area) |
| [取值](#cat-value) | [margin/padding 1–4 值简写 + background 纯色简写 + flex 简写](#value-shorthand) |
| [单位](#cat-unit) | [width/height 百分比](#width-ratio) · [min() / max() / clamp()](#math-functions) · [em / rem / vw / vh / calc / clamp](#unit-relative) |
| [特殊](#cat-special) | [box-sizing](#box-sizing) |
| [动效](#cat-motion) | [transform（2D：translate / scale / rotate）](#transform) · [transform-origin](#transform-origin) |
| [选择器](#cat-selector) | [类选择器 .a / .a.b](#selector-class) · [元素/类型选择器 h3 / p.foo](#selector-type) · [后代 / 子组合 .a .b / .a > .b](#selector-combinator) · [静态结构伪类 :first-child / :last-child / :nth-child(An+B\|odd\|even) / :not(简单选择器)](#selector-pseudo-structural) · [状态伪类 :hover / :active / :focus / :checked](#selector-pseudo-state) · [属性选择器 data-x](#selector-attr) · [Vue 作用域穿透 :deep() / ::v-deep() / >>>](#selector-deep) · [兄弟组合 + / ~](#selector-sibling) · [通配 *](#selector-wildcard) |
| [层叠](#cat-cascade) | [特异性 / 继承 / !important](#specificity-inheritance) · [CSS 自定义属性（design tokens）var(--x)](#css-vars) |
| [@ 规则](#cat-at-rule) | [@media（响应式 / 环境条件）](#at-media) · [@supports（特性检测）](#at-supports) · [@keyframes（关键帧动画）](#keyframes) · [animation（简写：name duration timing delay …）](#animation) |
| [文本](#cat-text) | [word-break（行内断词策略）](#word-break) · [font-weight](#font-weight) · [text-decoration](#text-decoration) · [text-align](#text-align) · [line-height](#line-height) · [text-overflow](#text-overflow) · [-webkit-line-clamp: <integer>](#-webkit-line-clamp) · [letter-spacing](#letter-spacing) · [font-family](#font-family) · [white-space](#text-attrs) |
| [层](#cat-layer) | [z-index](#z-index) |

## Per-capability reference

## 绘制 · 19 {#cat-paint}

### outline-offset {#outline-offset}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** host-drawn · **Alignment** conditional

> host-drawn · conditional

### outline（+ outline-width/-color/-style 长手） {#outline}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** host-drawn · **Alignment** conditional

> host-drawn · conditional

### background-color（+ background 纯色简写） {#background-color}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### background-size {#background-size}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** host geometry · **Alignment** conditional

> host geometry · conditional

### background-position {#background-position}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** host geometry · **Alignment** conditional

> host geometry · conditional

### background-repeat {#background-repeat}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** host geometry · **Alignment** conditional

> host geometry · conditional

### color {#color}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### font-size {#font-size}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### border-radius {#border-radius}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### opacity {#opacity}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### border（简写）/ border-color / border-width {#border-color-width}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### border-top {#border-top}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### border-right {#border-right}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### border-bottom {#border-bottom}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### border-left {#border-left}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### box-shadow {#box-shadow}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L3 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### text-shadow {#text-shadow}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L3 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### filter / backdrop-filter {#filter-backdrop}

**Web** ✅ yes · **Skyline** ✅ yes · **App** no · **App extensible** L3 · **Strategy** semantic component · **Alignment** conditional

> semantic component · conditional

### visibility {#visibility}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

## 布局 · 27 {#cat-layout}

### width {#width}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### height {#height}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### min-width / max-width / min-height / max-height {#min-max-wh}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### margin（+ 四边简写 + 1–4 值 shorthand） {#margin}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### padding（+ 四边简写 + 1–4 值 shorthand） {#padding}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### display: flex / none {#display}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### flex-direction {#flex-direction}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### justify-content {#justify-content}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### align-items / align-self {#align-items-self}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### flex-grow / flex-shrink / flex-basis {#flex-grow-shrink-basis}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### gap（+ row-gap / column-gap） {#gap}

**Web** ◐ partial · **Skyline** ◐ partial · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** conditional

> direct mapping · conditional

### position: static / relative / absolute {#position}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### top / left {#top-left}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### overflow: visible / hidden / scroll / auto {#overflow}

**Web** ◐ partial · **Skyline** ◐ partial · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** conditional

> direct mapping · conditional

### display: grid + grid-template-columns/rows（显式轨迹）+ grid-column/row 线号放置 {#grid}

**Web** ◐ partial · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** conditional

> direct mapping · conditional

### justify-self（网格项行内轴自对齐） {#justify-self}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** conditional

> direct mapping · conditional

### place-items（+ justify-items 长手） {#place-items}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** shorthand expand · **Alignment** conditional

> shorthand expand · conditional

### aspect-ratio {#aspect-ratio}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### flex-wrap {#flex-wrap}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### align-content {#align-content}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### right / bottom {#right-bottom}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### inset（top/right/bottom/left 的 1–4 值缩写） {#inset}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L2 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### order {#order}

**Web** ✅ yes · **Skyline** ✅ yes · **App** no · **App extensible** L2 · **Strategy** direct mapping · **Alignment** conditional

> direct mapping · conditional

### pointer-events {#pointer-events}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### grid-auto-flow {#grid-auto-flow}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** conditional

> direct mapping · conditional

### grid-template-areas {#grid-template-areas}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** conditional

> direct mapping · conditional

### grid-area {#grid-area}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L2 · **Strategy** direct mapping · **Alignment** conditional

> direct mapping · conditional

## 取值 · 1 {#cat-value}

### margin/padding 1–4 值简写 + background 纯色简写 + flex 简写 {#value-shorthand}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

## 单位 · 3 {#cat-unit}

### width/height 百分比 {#width-ratio}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### min() / max() / clamp() {#math-functions}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### em / rem / vw / vh / calc / clamp {#unit-relative}

**Web** — · **Skyline** — · **App** no · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** unsupported

> compile-time fold · unsupported

## 特殊 · 1 {#cat-special}

### box-sizing {#box-sizing}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

## 动效 · 2 {#cat-motion}

### transform（2D：translate / scale / rotate） {#transform}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### transform-origin {#transform-origin}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L2 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

## 选择器 · 9 {#cat-selector}

### 类选择器 .a / .a.b {#selector-class}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### 元素/类型选择器 h3 / p.foo {#selector-type}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### 后代 / 子组合 .a .b / .a > .b {#selector-combinator}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### 静态结构伪类 :first-child / :last-child / :nth-child(An+B|odd|even) / :not(简单选择器) {#selector-pseudo-structural}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### 状态伪类 :hover / :active / :focus / :checked {#selector-pseudo-state}

**Web** — · **Skyline** — · **App** no · **App extensible** L2 · **Strategy** degrade · **Alignment** unsupported

> degrade · unsupported

### 属性选择器 [data-x] {#selector-attr}

**Web** — · **Skyline** — · **App** no · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** unsupported

> compile-time fold · unsupported

### Vue 作用域穿透 :deep() / ::v-deep() / >>> {#selector-deep}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### 兄弟组合 + / ~ {#selector-sibling}

**Web** — · **Skyline** — · **App** no · **App extensible** L5 · **Strategy** forbidden · **Alignment** unsupported

> forbidden · unsupported

### 通配 * {#selector-wildcard}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

## 层叠 · 2 {#cat-cascade}

### 特异性 / 继承 / !important {#specificity-inheritance}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### CSS 自定义属性（design tokens）var(--x) {#css-vars}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L0 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

## @ 规则 · 4 {#cat-at-rule}

### @media（响应式 / 环境条件） {#at-media}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L2 · **Strategy** dedicated channel · **Alignment** conditional

> dedicated channel · conditional

### @supports（特性检测） {#at-supports}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L2 · **Strategy** dedicated channel · **Alignment** conditional

> dedicated channel · conditional

### @keyframes（关键帧动画） {#keyframes}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### animation（简写：name duration timing delay …） {#animation}

**Web** — · **Skyline** — · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

## 文本 · 10 {#cat-text}

### word-break（行内断词策略） {#word-break}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L4 · **Strategy** direct mapping · **Alignment** universal

> direct mapping · universal

### font-weight {#font-weight}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### text-decoration {#text-decoration}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### text-align {#text-align}

**Web** ◻ n/a · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### line-height {#line-height}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### text-overflow {#text-overflow}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### -webkit-line-clamp: <integer> {#-webkit-line-clamp}

**Web** ◻ n/a · **Skyline** ◻ not listed · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** conditional

> compile-time fold · conditional

### letter-spacing {#letter-spacing}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L1 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### font-family {#font-family}

**Web** ✅ yes · **Skyline** ✅ yes · **App** ✅ yes · **App extensible** L4 · **Strategy** compile-time fold · **Alignment** universal

> compile-time fold · universal

### white-space {#text-attrs}

**Web** ✅ yes · **Skyline** ✅ yes · **App** no · **App extensible** L4 · **Strategy** degrade · **Alignment** conditional

> degrade · conditional

## 层 · 1 {#cat-layer}

### z-index {#z-index}

**Web** ✅ yes · **Skyline** ✅ yes · **App** no · **App extensible** L3 · **Strategy** semantic component · **Alignment** conditional

> semantic component · conditional

> Reproduce: the capability acceptance project (`css-conformance`) verifies each page against this matrix; end-specific boundaries follow real device measurement.

<!-- generated by scripts/gen-css-support.mjs (en overlay) · SSOT: docs/generated/css-capability-alignment.json -->