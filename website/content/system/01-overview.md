---
title: 柔性系统总览
order: 1
group: 柔性系统
---

# 柔性系统

**柔性系统是 Proteus 的布局语义层。** 你只声明「要什么」——字号在多宽之间变化、卡片最少多宽、侧栏何时出现——框架根据**容器宽度**与**设备形态**推导出「用哪套结构、多大度量、哪些能力」，再交给**各端布局实现**去算几何。

> **边界说清**：框架**不自造**跨端自绘布局引擎（不自研 Yoga / Skia 当统一引擎），而是把语义交给各端——原生布局容器（CSS Grid / `UIStackView` / `ConstraintLayout` / ArkUI / Skyline）**或**第三方自绘引擎后端（`BackendId` 已登记 `skia` / `canvas2d` / `flutter`；Flutter 后端的布局即复用 Flutter 内部的 Yoga 布局层）。两种后端消费**同一份布局语义**——这正是「一套代码多端同构」的落点。

一句话概括它的三个替代：

- **替代断点**：不写 `@media`，字号在两档之间**连续**缩放（断点处不跳变）
- **替代手算列数**：说「一列至少 250px」，列数随容器自动求解——放进侧栏、分屏、卡片里都对
- **替代形态分支**：同一份代码，车机上自动是驾驶舱、TV 上自动是海报流（见[多端同屏](/multi-device)）

## 一眼看懂：同一个网格，两种写法

手写响应式（断点 + 手算列数，且**容器一变窄就失效**）：

```css
/* 4 个断点、4 遍列数，全屏还凑合——放进侧栏或分屏就全错 */
.grid { display: grid; grid-template-columns: repeat(1, 1fr); }
@media (min-width: 768px)  { .grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .grid { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 1440px) { .grid { grid-template-columns: repeat(4, 1fr); } }
```

柔性系统（只声明一列的最小宽度，列数由**容器**求解）：

```vue
<p-grid :min-col-width="250" :gap="14">
  <p-box v-for="item in items" :key="item.id" />
</p-grid>
```

差别不只是「少写几行」：`@media` 按**视口**求解，而组件活在**容器**里——同一张卡片全屏 1440px、分屏 700px、仪表卡片 300px，视口断点对它全部失效。

## 30 秒上手

另外两个常用原语（流式排版、自适应侧栏）：

```vue
<template>
  <!-- 流式排版：设计稿 375 宽处 32px → 1440 视口处 54px，中间连续插值（零跳变） -->
  <p-heading :level="1" v-p-fluid="'font-size(32, 54)'">One semantic model.</p-heading>

  <!-- 自适应侧边栏：容器够宽出侧栏，窄了自动折叠成「☰ 导航」切换条 -->
  <p-sidebar :min-sidebar-width="720" :nav-width="224">
    <template #nav>…</template>
    …
  </p-sidebar>
</template>
```

> 关键声明与本官网在用的真实代码一致（网格与流式排版出自首页 `website/src/pages/Home.vue`，侧栏出自**你正在读的这篇文档页** `DocsPage.vue`）；子元素做了简化。拖动窗口可直接验证。

## 三个核心概念

| 概念 | 一句话 | 深入 |
|---|---|---|
| **容器求解** | 断点看**容器**宽度而非视口——组件放进任何容器都正确 | [容器查询](/docs/system/02-container-query) |
| **形态画像** | 一张 `FORM_PROFILES` 表声明 7 种设备形态（输入 / 观看距离 / 拓扑 / 导航 / 能力），框架据此换布局 | [形态画像](/docs/system/06-form-profiles) |
| **能力三态** | 能力不是布尔值：`supported` / `fallback`（降级路径）/ `unsupported`，且每项都有渲染后果 | [能力三态](/docs/system/08-capabilities) |

底层是一条求解公式：**尺寸只由容器宽度驱动**——`k = clamp(min, w/ref, max)`，各变量皆为 `k × 基准`（[流体度量](/docs/system/07-fluid-metrics)）。

## 按目标选路径

| 我想… | 读这几篇 | 用时 |
|---|---|---|
| **把页面排版做对** | 本页 → [柔性网格](/docs/system/03-fluid-grid) → [自适应侧边栏](/docs/system/04-sidebar) | 15 分钟 |
| **一套代码跑多端** | [形态画像](/docs/system/06-form-profiles) → [一套内容槽，七种形态](/docs/system/11-formfactor-composition) → [多端同屏演示](/multi-device) | 30 分钟 |
| **理解尺寸怎么求解** | [流体度量](/docs/system/07-fluid-metrics) → [容器查询](/docs/system/02-container-query) | 20 分钟 |
| **接折叠屏 / 车机 / TV** | [折叠姿态](/docs/system/09-postures) → [焦点导航](/docs/system/10-focus-navigation) → [能力三态](/docs/system/08-capabilities) | 30 分钟 |
| **查 API 与门禁** | [断点与形态](/docs/system/05-breakpoints) → [p-formfactor API](/docs/component/p-formfactor) | 按需 |

## 常用写法速查

```vue
<!-- 流式任意 CSS 属性：prop(min, max)——设计稿宽处取 min，大屏处取 max，中间连续插值 -->
<p-box v-p-fluid="'padding-top(24, 44) padding-bottom(40, 76)'" />

<!-- 网格：只给最小列宽，列数自动 -->
<p-grid :min-col-width="380" :gap="40">…</p-grid>

<!-- 弹性栈：窄了自动换行 -->
<p-stack direction="row" wrap :gap="12">…</p-stack>

<!-- 分栏：宽容器并排，窄容器堆叠 -->
<p-split :min-split-width="640" :gap="16">
  <template #aside>…</template>
  …
</p-split>
```

```bash
proteus fluid:check   # 编译期门禁：FLD 规则机器可查，CI 强制
```

## 两层能力（本专区 11 篇的组织方式）

| 层 | 解决什么 | 能力 |
|---|---|---|
| **L1 容器求解**（G-22 起） | 「组件活在容器里」——断点、网格、分栏、导航折叠 | `p-fluid` 流式 · `p-grid` 网格 · `p-stack`/`p-fit` 弹性 · `p-split` 分栏 · `p-sidebar` 侧栏 · `p-adaptive` 形态区间 · `createContainerQuery` |
| **L2 形态求解**（2026-09 重构） | 「设备形态是一等公民」——同一份代码换布局、换导航、换能力集 | `FORM_PROFILES` 形态画像 · `resolveFluidMetrics` 流体度量 · `CapsLevel` 能力三态 · `postures[]` 折叠姿态 · `navigateFocus` 焦点导航 · `p-formfactor` 形态容器 |

一句话区分：**L1 让「卡片放进窄容器」正确，L2 让「同一份代码在车机上是驾驶舱、在 TV 上是海报流」**。

## 零 `@media` 铁律

| 规则 | 内容 |
|---|---|
| FLD001 | 禁止手写 `@media` 断点（跨端无对等） |
| FLD002 | 禁止硬编码断点数字 |
| FLD003 | `p-fluid` 必须给区间 `(min, max)` |
| FLD004 | `p-grid` 必须声明 `min-col-width` |
| FLD008 | 禁止手动 `if (width < 600)` 宽度分支 |

这不是口号：**本官网全站零 `@media`**（首页排版走 `v-p-fluid`、能力卡走 `p-grid`、文档页走 `p-sidebar`），CI 门禁拦截手写断点——官网自身就是柔性系统的验收场。

## 落地状态（诚实分级）

| 批次 | 内容 | 状态 |
|---|---|---|
| G-22 四原语 | `p-fluid` 流式 / `p-grid` 网格 / `p-stack` 弹性栈 / `p-fit` 内在尺寸 | ✅ |
| S1–S4 | `@proteus-vue/fluid` 拆包 + `p-split`/`p-zone` + `p-safe`/`p-aspect` + `p-sidebar`/`p-toolbar` + `p-scale` 无障碍 | ✅ |
| G-22.5 形态区间 | `p-adaptive`（sheet / dialog / popover）+ `p-modal` 自动切换 | ✅ |
| **L2 形态层** | **形态画像 7 形态 + 流体度量 v3 + 能力三态 14 项 + 折叠三姿态 + 焦点导航 + `p-formfactor`** | **✅** |
| S5 全端 | 组件目录入包 + App 端原生求解器接口；`useContainerProfile()` 组合入口 | ⬜ |

> 状态图例：✅ 已落地可验证 · ⬜ 未实现。运行时核心是独立包 `@proteus-vue/fluid`（纯逻辑、零依赖）：`createContainerQuery` / `createSizeAwareObserver` / `createDeviceEnv` / `detectFluidCapabilities` / `createAdaptiveController`。

## 下一步

- **只想动手**：上面的 30 秒示例 + [柔性网格](/docs/system/03-fluid-grid) 足够开始
- **要做多端**：[多端同屏演示](/multi-device) 亲手切七种形态（右栏看能力三态）
- **通读全专区**：[容器查询](/docs/system/02-container-query) · [柔性网格](/docs/system/03-fluid-grid) · [自适应侧边栏](/docs/system/04-sidebar) · [断点与形态](/docs/system/05-breakpoints) · [形态画像](/docs/system/06-form-profiles) · [流体度量](/docs/system/07-fluid-metrics) · [能力三态](/docs/system/08-capabilities) · [折叠姿态](/docs/system/09-postures) · [焦点导航](/docs/system/10-focus-navigation) · [一套内容槽，七种形态](/docs/system/11-formfactor-composition)
- **相关分区**：[语义原语](/docs/primitives) · [组件总览](/docs/12-components-intro) · [端与成熟度](/docs/framework/ends-matrix)
