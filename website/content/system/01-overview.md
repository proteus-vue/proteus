---
title: 柔性系统总览
order: 1
group: 柔性系统
---

# 柔性系统总览

> **声明响应式意图，框架按容器求解。**
> 你不写 `@media`、不写 JS 宽度分支、不算列数——你声明「要什么」，容器查询运行时负责「怎么算」。

柔性系统是 Proteus 的响应式布局体系（G-22 Fluid System）。它的本质是**把各终端厂商与操作系统级的柔性布局能力收敛进框架**——iOS `UIStackView` / `UICollectionView`、Android `ConstraintLayout` / `GridLayoutManager`、鸿蒙 `Flex` / `Grid`、Web CSS Grid / `clamp()` / 容器查询——而不是发明一个新单位。

## 要解决什么：断点爆炸

手写响应式的成本不是「写一个 `@media`」，而是三个维度的组合爆炸：

| 维度 | 示例 | 后果 |
|---|---|---|
| 断点数量 | 768 / 1024 / 1440…… | 每加一档，所有页面重验一遍 |
| 设备形态 | 手机 / 平板 / 折叠屏 / 车机 / TV | 每种形态一套分支 |
| 容器位置 | 全屏 / 分屏半宽 / 卡片内 / 多窗口 | 同一组件在不同容器需要不同断点 |

第三个维度是 `@media` 的死穴：**媒体查询按视口求解，组件却活在容器里**。同一张卡片全屏时 1440px、放进分屏只剩 700px、塞进仪表卡片只剩 300px——视口断点对它全部失效，只能上 JS 宽度分支（FLD006 禁止的 `Dimensions.get()` 同族问题）。而且 `@media` 跨端无对等：App 原生端没有媒体查询，同一套源码在原生渲染端直接失配（FLD001 error 级禁止手写）。

rpx 也不是答案。rpx 是「单位换算」（值 × 屏幕宽 / 750），布局结构永远不变；柔性系统是「布局引擎能力」——三层对照：

| 层 | rpx | 柔性系统 |
|---|---|---|
| 数值缩放 | ✅ 等比换算（无上下限） | ✅ `p-fluid` clamp 区间（min/max 兜住） |
| 结构自适应 | ❌ 列数 / 换行 / 方向不变 | ✅ `p-grid` 自适应列数 / `p-stack` 换行 / `p-split` 分栏 |
| 形态自适应 | ❌ 折叠屏 / 分屏 / 多窗口无感知 | ✅ 容器查询 + 断点切换 + 折叠形态 |

## 核心哲学：布局 = 约束求解

布局的本质是约束求解——给定容器尺寸和子项约束，求解各子项怎么排。传统框架把这个求解过程丢给开发者（媒体查询、JS 计算、`LayoutBuilder`）；柔性系统把它下沉到框架：

```vue
<!-- 传统（命令式）：开发者手算列数 -->
<!-- if (width < 768) columns = 1; else if (width < 1024) columns = 2; else columns = 3 -->

<!-- 柔性（声明式）：只声明意图，框架求解 -->
<p-grid :min-col-width="160">
  <p-card v-for="item in items" :key="item.id" />
</p-grid>
```

框架只定义「你要什么」（语义原语 + FluidContext 响应式上下文）；各端用各自的原生容器实现「怎么做」——Web 用 CSS Grid / `clamp()` / 容器查询，原生端映射系统级网格容器。**Proteus 不模拟网格，让每个平台用自己的原生能力实现同一语义。**

## 一段代码看全柔性系统

本官网的真实写法（Hero 出自首页，侧边栏出自你正在看的文档页——拖动窗口直接验证）：

```vue
<template>
  <!-- 流式排版：设计稿 375 处 30px，1440 视口处 60px，clamp 连续插值零跳变 -->
  <p-heading :level="1" v-p-fluid="'font-size(30, 60)'">One semantic model.</p-heading>

  <!-- 柔性网格：只声明最小列宽，列数随容器自动伸缩 -->
  <p-grid :min-col-width="280" :gap="14">…</p-grid>

  <!-- 自适应侧边栏：宽容器左侧栏，窄容器自动折叠 -->
  <p-sidebar :min-sidebar-width="720">
    <template #nav>…</template>
    …
  </p-sidebar>
</template>
```

## 三大件 + 原语全家桶

柔性系统的三个旗舰能力（本专区各有一篇）：

| 旗舰 | 原语 | 一句话 | 深入阅读 |
|---|---|---|---|
| 分屏 | `p-split` | 窄容器堆叠、宽容器并排——平板 / 车机 / 多窗口核心原语 | [容器查询](/docs/system/02-container-query) · [布局组件](/docs/12-layout-components) |
| 柔性网格 | `p-grid` | 只声明最小列宽，列数自动求解 | [柔性网格](/docs/system/03-fluid-grid) |
| 自适应侧边栏 | `p-sidebar` | 宽容器 side-rail、窄容器折叠切换条（VitePress 同款交互） | [自适应侧边栏](/docs/system/04-sidebar) |

原语全家桶与落地批次（诚实分级）：

| 批次 | 内容 | 状态 |
|---|---|---|
| G-22 四原语 | `p-fluid`（流式 clamp）/ `p-grid` / `p-stack`（弹性栈）/ `p-fit`（内在尺寸） | ✅ |
| S1 拆包 | `@proteus-vue/fluid` + FluidContext（容器查询 / 断点 / 方向）+ `p-split` + `p-zone`（容器断点分区）+ 能力检测 + `p-grid` 降级 | ✅ |
| S2 安全区与形态 | `p-safe`（刘海 / 铰链避让）+ `p-aspect`（纵横比）+ 折叠形态 display-mode | ✅ |
| S3 导航 | `p-sidebar` / `p-toolbar`（溢出折叠）+ 车机 d-pad 焦点 + drive-mode 动效门 | ✅ |
| S4 无障碍 | `p-scale` 动态字号 / 密度 + FLD012/013 规则 | ✅ |
| G-22.5 形态 | `p-adaptive` 形态区间表达式（sheet / dialog / popover 三档），`p-modal` 形态自动切换 | ✅ |
| S5 全端 | 组件目录入包 + App 端原生求解器接口 | ⬜ |

> 状态图例：✅ 已落地可验证 · ⬜ 规划已入库。

运行时核心是独立包 `@proteus-vue/fluid`（纯逻辑、零依赖）：`createContainerQuery`（容器查询）、`createSizeAwareObserver`（容器 + 视口统一断点入口）、`createDeviceEnv`（折叠形态 / 驾驶模式 / 减少动效）、`detectFluidCapabilities`（能力探测降级）、`createAdaptiveController`（形态求解）——API 细节见[容器查询](/docs/system/02-container-query)。

## 零 @media 铁律

- FLD001：禁止手写 `@media` 断点（跨端无对等，断点逻辑归语义原语）
- FLD002：禁止硬编码断点数字
- FLD003：`p-fluid` 必须给区间（min, max）
- FLD004：`p-grid` 必须声明 min-col-width
- FLD008：禁止手动 `if (width < 600)` 宽度分支

```bash
proteus fluid:check   # 编译期门禁：FLD 规则机器可查，CI 强制
```

这不是口号：你正在看的官网全站零 `@media`（W-6 柔性框架优先原则，CI 门禁拦截手写断点）——排版走 `v-p-fluid` clamp、能力卡走 `p-grid`、文档页走 `p-sidebar`，**官网自身就是柔性系统的验收场**。

## 下一步

- [容器查询：按容器求解](/docs/system/02-container-query)：createContainerQuery 真实 API 与求解基准
- [柔性网格](/docs/system/03-fluid-grid)：p-grid 只声明最小列宽
- [自适应侧边栏](/docs/system/04-sidebar)：三态状态机 + 车机 d-pad 焦点
