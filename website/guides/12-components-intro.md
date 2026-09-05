---
title: 语义组件总览
order: 12
group: 基础概念
---

# 语义组件总览

Proteus 的组件不是「又一套跨端 UI 库」，而是**语义组件**：每个 `p-*` 标签只声明「你要什么」——语义 + 约束（props 契约）。编译期由 **G-31 语义映射**把语义翻译成各端原生控件：Web 的 `div` / `button`、小程序的 `view` / `text`、iOS 的 `UIView` / `UIButton`、Android 的 `FrameLayout` / `TextView`。业务代码对渲染端零感知。

> **组件是语义的组件形态，不是样式的容器。**
> 同一份源码：`p-view` 在 Web 渲染 `div`、编译期映射为小程序 `view`（双端同源码）；`p-button` 的 `@click` 编译为 `bind:tap`。语义 → 原生控件的映射由七端对照表锁定，并用 conformance 快照门禁（implemented 语义 × 6 渲染后端）防止漂移。

## 为什么不是「样式库」

| | 传统跨端 UI 库 | Proteus 语义组件 |
|---|---|---|
| 组件本质 | 样式 + 结构打包 | 语义 + 约束（props 契约） |
| 渲染形态 | 自绘或 WebView 模拟 | 编译期映射到各端原生控件 |
| 平台差异 | 运行时 `if (isXxx)` 分支 | 后端实现，业务零分支（PRIM001 禁手动平台判断） |
| 跨端一致 | 人肉对齐 | conformance 快照门禁 |

组件层之下是 **136 原语 SSOT**（layout / ui / shell / gesture / capability / engineering 六族）：组件是原语的 `p-*` 组件形态，能力 Hook（`useXxx`）是原语的 API 形态——两层共享同一份语义清单。

## 组件分类总表

清单唯一聚合点：`src/components/index.ts`（59 个 `p-*` 语义组件 + 玻璃容器 `pg-glass`）。

### 布局（G-22 柔性布局 + 布局原语）

| 组件 | 一句话定位 |
|---|---|
| `p-view` | 通用容器：默认 flex 纵向 + content-box（铁律见[布局组件](/docs/13-layout-components)） |
| `p-stack` | 弹性栈：方向 + 间距 + 空间不足自动换行 |
| `p-grid` | 自适应网格：只声明 `min-col-width`，列数自动求解 |
| `p-split` | 自适应分栏：窄容器堆叠、宽容器并排（容器查询求解） |
| `p-zone` | 容器断点分区：sm/md/lg/xl 渲染不同子布局 |
| `p-sidebar` | 自适应导航栏：宽容器左侧栏、窄容器折叠 |
| `p-toolbar` | 工具栏溢出折叠：放不下自动收进「更多」 |
| `p-safe` | 安全区避让：刘海 / 铰链 / 圆角 |
| `p-aspect` | 纵横比容器 |
| `p-fit` | 内在尺寸 |
| `p-scale` | 动态字号 / 密度（无障碍档位） |
| `p-adaptive` | 形态区间声明 → sheet / dialog / popover |
| `p-modal` | 弹窗：形态随宽度自动切换 |
| `p-inline` | 行内排布 |
| `p-spacer` | 弹性空白：撑开布局让后续元素靠边 |
| `p-divider` | 分隔线：水平 / 垂直 + 内缩 |
| `p-scroll` | 滚动容器（布局原语形态） |

### 滚动与列表

| 组件 | 定位 |
|---|---|
| `p-scroll-view` | 可滚动区域 |
| `p-list-view` | 列表容器 |
| `p-virtual-list` | 虚拟列表（长列表只渲染可视区） |
| `p-masonry` | 瀑布流 |
| `p-scrollable` | 可滚动（手势语义：触底 loadMore） |
| `p-draggable` | 可拖拽（手势语义：拖影 + 网格吸附） |
| `VirtualList` | 虚拟列表 Web 端兼容形态（非 `p-` 前缀，按需 import） |

### 基础视图

| 组件 | 定位 |
|---|---|
| `p-text` | 文本（selectable 双端映射） |
| `p-heading` | 标题 level 1-6 |
| `p-button` | 按钮（loading / throttle 内建） |
| `p-image` / `p-icon` / `p-avatar` | 图片 / 图标 / 头像 |
| `p-media` | 媒体统一入口（image / video / audio / live） |
| `p-canvas` / `p-svg` / `p-rich-text` | 画布 / 矢量 / 富文本 |
| `p-router-link` | 声明式导航 |

### 表单

| 组件 | 定位 |
|---|---|
| `p-input` / `p-textarea` | 输入框 / 多行输入 |
| `p-select` / `p-picker` | 下拉选择 / 选择器 |
| `p-checkbox` / `p-radio` / `p-switch` / `p-slider` | 复选 / 单选 / 开关 / 滑块 |
| `p-form` | 表单：rules 校验聚合 + validate / submit |

### Shell 与导航

| 组件 | 定位 |
|---|---|
| `p-page` | 页面根：title / statusBar / pullRefresh 语义声明 |
| `p-nav-bar` / `p-nav` | 导航栏 / 导航（左右插槽） |
| `p-tabbar` | 底部标签栏 |
| `p-drawer` | 抽屉 |
| `p-segment` | 分段控制器（见[反馈与动效](/docs/14-feedback-components)） |
| `p-popover` / `p-action-sheet` | 气泡 / 动作面板 |

### 反馈与动效

| 组件 | 定位 |
|---|---|
| `p-toast` | 轻提示 |
| `p-loading` / `p-skeleton` | 加载指示 / 骨架屏 |
| `p-mask` / `p-popup` | 遮罩 / 弹出层 |
| `p-error-boundary` | 错误边界 |
| `p-transition` / `p-animate` | 显隐过渡 / 动画原语 |

### 桌面与玻璃

| 入口 | 定位 |
|---|---|
| `v-p-hover` / `v-p-shortcut` / `v-p-focus-trap` / `v-p-context-menu` / `v-p-permission` / `v-p-cursor-glow` | 桌面交互指令（见[桌面端原语](/docs/30-desktop-primitives)） |
| `pg-glass` | 液态玻璃统一入口（见[液态玻璃](/docs/31-liquid-glass)） |

## 如何使用

```ts
// Web 端：按需 import（聚合导出，精确别名）
import { PView, PStack, PgGlass } from '@proteus-vue/components'
```

```ts
// 全局注册（官网 dogfooding 现状——website/src/main.ts）
import { PView, PSidebar, PgGlass } from '@proteus-vue/components'
app.component('p-view', PView)
app.component('p-sidebar', PSidebar)
app.component('pg-glass', PgGlass)
```

小程序端**零 import**：模板直接写 `<p-view>`，编译期自动解析框架组件（`/proteus/` 前缀），无需注册。

> 命名契约（G-31.1）：语义组件一律 `p-` 前缀、玻璃 `pg-` 前缀，禁止与小程序 / HTML 标签同名——非 `p-` 标签不产生语义 IR，只进兼容层。

## 下一步

- [布局组件](/docs/13-layout-components)：p-view / p-stack / p-split / p-sidebar 逐个拆解 + 配方
- [反馈与动效](/docs/14-feedback-components)：p-segment / p-toast / p-animate
- [柔性布局](/docs/17-fluid-layout)：布局组件背后的响应式求解体系
