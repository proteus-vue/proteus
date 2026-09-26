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

## 两层能力（本专区 11 篇的组织方式）

柔性系统用**两层**解决适配问题——第一层管「组件活在容器里」，第二层管「设备形态是一等公民」：

**第一层：容器求解**（G-22 起，已稳定）

| 能力 | 原语 / API | 一句话 |
|---|---|---|
| 流式排版 | `p-fluid` / `v-p-fluid` | 声明 `font-size(30, 60)`，clamp 连续插值零跳变 |
| 柔性网格 | `p-grid` | 只声明最小列宽，列数自动求解 |
| 弹性栈 | `p-stack` / `p-fit` | 换行 / 内在尺寸 |
| 容器查询 | `createContainerQuery` | 按**容器**而非视口求解断点 |
| 分屏 | `p-split` | 窄容器堆叠、宽容器并排 |
| 自适应侧边栏 | `p-sidebar` | 宽容器 side-rail、窄容器折叠切换条 |
| 形态区间 | `p-adaptive` | sheet / dialog / popover 按容器宽切换 |

→ 深入：[容器查询](/docs/system/02-container-query) · [柔性网格](/docs/system/03-fluid-grid) · [自适应侧边栏](/docs/system/04-sidebar) · [断点与形态](/docs/system/05-breakpoints)

**第二层：形态求解**（2026-09 重构，本专区新增 6 篇）

| 能力 | SSOT / API | 一句话 |
|---|---|---|
| 形态画像 | `FORM_PROFILES` | 7 形态一张表：拓扑/导航/视觉/度量/能力 |
| 流体度量 | `resolveFluidMetrics` | 尺寸只由容器宽度驱动（无绝对 px、无 scale） |
| 能力三态 | `CapsLevel` + `FORM_CAP_KEYS` | supported / fallback / unsupported，每项有渲染后果 |
| 折叠姿态 | `postures[]` | 折叠/半折/展开的连续重排，含姿态级度量 |
| 焦点导航 | `navigateFocus` | 遥控/旋钮的空间导航（几何求解，非 DOM 顺序） |
| 形态容器 | `p-formfactor` | 业务只写语义槽，框架换布局/导航/能力集 |

→ 深入：[形态画像](/docs/system/06-form-profiles) · [流体度量](/docs/system/07-fluid-metrics) · [能力三态](/docs/system/08-capabilities) · [折叠姿态](/docs/system/09-postures) · [焦点导航](/docs/system/10-focus-navigation) · [一套内容槽七种形态](/docs/system/11-formfactor-composition)

**一句话记住两层的关系**：第一层让「卡片放进窄容器」正确，第二层让「同一份代码在车机上就是驾驶舱、在 TV 上就是海报流」。

原语全家桶与落地批次（诚实分级）：

| 批次 | 内容 | 状态 |
|---|---|---|
| G-22 四原语 | `p-fluid`（流式 clamp）/ `p-grid` / `p-stack`（弹性栈）/ `p-fit`（内在尺寸） | ✅ |
| S1 拆包 | `@proteus-vue/fluid` + FluidContext（容器查询 / 断点 / 方向）+ `p-split` + `p-zone`（容器断点分区）+ 能力检测 + `p-grid` 降级 | ✅ |
| S2 安全区与形态 | `p-safe`（刘海 / 铰链避让）+ `p-aspect`（纵横比）+ 折叠形态 display-mode | ✅ |
| S3 导航 | `p-sidebar` / `p-toolbar`（溢出折叠）+ 车机 d-pad 焦点 + drive-mode 动效门 | ✅ |
| S4 无障碍 | `p-scale` 动态字号 / 密度 + FLD012/013 规则 | ✅ |
| G-22.5 形态 | `p-adaptive` 形态区间表达式（sheet / dialog / popover 三档），`p-modal` 形态自动切换 | ✅ |
| **L2 形态层** | **形态画像 7 形态 + 流体度量 v3 + 能力三态 14 项 + 折叠三姿态 + 焦点导航引擎 + `p-formfactor` 容器** | **✅** |
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

- **容器求解层**：[容器查询](/docs/system/02-container-query) · [柔性网格](/docs/system/03-fluid-grid) · [自适应侧边栏](/docs/system/04-sidebar) · [断点与形态](/docs/system/05-breakpoints)
- **形态求解层**：[形态画像](/docs/system/06-form-profiles) · [流体度量](/docs/system/07-fluid-metrics) · [能力三态](/docs/system/08-capabilities) · [折叠姿态](/docs/system/09-postures) · [焦点导航](/docs/system/10-focus-navigation) · [一套内容槽，七种形态](/docs/system/11-formfactor-composition)
- **动手验证**：[多端同屏演示](/multi-device)（可切七形态 / 折叠三姿态，右栏看能力三态）
