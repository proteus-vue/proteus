---
title: 柔性系统总览
order: 1
group: 柔性系统
---

# 柔性系统

> **写意图，别算尺寸；写内容，别写形态分支。** 你声明「要什么」，容器与设备形态负责「怎么排」。

## 30 秒上手

```vue
<template>
  <!-- ① 流式排版：设计稿 375 宽处 32px → 1440 视口处 54px，中间连续插值（零跳变） -->
  <p-heading :level="1" v-p-fluid="'font-size(32, 54)'">One semantic model.</p-heading>

  <!-- ② 柔性网格：只声明「一列至少多宽」，列数由容器自动求解 -->
  <p-grid :min-col-width="250" :gap="14">
    <p-box v-for="item in items" :key="item.id" />
  </p-grid>

  <!-- ③ 自适应侧边栏：容器够宽出侧栏，窄了自动折叠成切换条 -->
  <p-sidebar :min-sidebar-width="720" :nav-width="200">
    <template #nav>…</template>
    …
  </p-sidebar>
</template>
```

三行声明解决三件事：**字号连续缩放、列数自适应、导航自适应**。没有 `@media`、没有 JS 宽度分支、没有 `window.innerWidth`。

> 以上是**本官网首页在跑的真实代码**（`website/src/pages/Home.vue`），不是示意——拖动窗口即可验证。

## 它解决什么

| 你要做的事 | 手写响应式 | 柔性系统 |
|---|---|---|
| 字号随屏幕缩放 | 3–4 个断点各写一遍，断点处跳变 | `v-p-fluid="'font-size(32, 54)'"` 一行，连续 |
| 卡片列数自适应 | 手算列数 + 断点 | `p-grid :min-col-width="250"`，列数自动求解 |
| 组件放进分屏 / 卡片 | `@media` 按**视口**失效 → 只能上 JS | 按**容器**求解，放哪都对 |
| 同一份代码上七种设备 | 每端一套分支 / `#ifdef` | **零形态分支**，框架换布局与能力集 |
| 跨端对等（原生端） | 原生端没有媒体查询，直接失配 | 语义原语 + 各端原生容器实现同一语义 |

第三行是关键：**媒体查询按视口求解，而组件活在容器里**。同一张卡片全屏时 1440px、放进分屏只剩 700px、塞进仪表卡片只剩 300px——视口断点对它全部失效。

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
