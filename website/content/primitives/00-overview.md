---
title: 原语总览
order: 0
group: 总览
---

# 原语：Proteus 的灵魂

> 一句话框架哲学：**你写语义，端自决形态**。原语（primitive）就是那张唯一的语义表——声明一次，各端渲染引擎/系统能力把它变成各自的原生实现。

Proteus 的全部家当本质是 **一张语义目录（136 原语 SSOT，`PRIMITIVE_CATALOG`）× 多种消费形态**。本分区按「原语家族」逐条沉淀用法；组件/能力两列是同一张表的**组件形态 / API 形态**，与本区互补不重复。

## 家族 × 形态对照

| 家族 | 语义域 | 组件形态 | API/指令形态 | 官网逐条位置 |
|---|---|---|---|---|
| 语义组件 | layout / ui / shell（p-* 59） | `p-view` `p-grid` `p-stack`… | —— | [组件](/docs/12-components-intro) |
| 能力 Hook | capability（50 useXxx） | —— | `useFetch` `useStorage` `useCamera`… | [能力](/docs/18-capability-system) |
| 柔性布局 | fluid（G-22） | `p-fluid` `p-fit` `p-scale`… | `v-p-fluid` | [柔性系统](/docs/system/01-overview) |
| 桌面/系统 | desktop（G-24，21 模块） | —— | `createScrollObserver` `copyText` `v-p-shortcut`… | **本分区（下）** |
| 手势 | gesture（G-32 B4） | `p-*` 手势组件 | `v-gesture` `useGesture` | **本分区（下）** |
| 工程原语 | engineering（E1-E28） | —— | `useState` `createRouterEngineering`… | 见框架/能力 |

> 形态不是复制：同一个语义（如 `layout.grid`）既可以是 `p-grid`（组件形态），也在目录条目中登记——**两份消费面共享同一份语义清单**（136 SSOT），这就是「语义收敛」。

## 桌面/系统原语逐条（本分区）

以下页面由源码生成器产出（SSOT = `packages/desktop/src/*.ts`——模块头定位/语义 + 导出清单，跑 `npm run gen:primitives` 刷新，勿手改）：

- **B1 桌面交互**：`p-shortcut` 快捷键 · `p-focus-trap` 焦点陷阱 · `p-context-menu` 右键菜单 · `p-hover` 悬停 · 指令工厂（`v-p-*`）
- **B2 系统集成**：`p-notify` 通知 · `p-permission` 权限 · `p-clipboard` 剪贴板 · `p-deeplink` 深链 · 指针光晕
- **B3 导航结构**：`p-master-detail` 三栏 · `p-command` ⌘K · `p-tabs` 标签 · `p-breadcrumb` 面包屑
- **B4 生命周期/设备**：`p-lifecycle` · `p-state-restoration` · `p-network-status` · `p-low-power`
- **B5 网页原语（#449）**：滚动观测 · 跨窗消息 · 锚点定位 · 页面 URL

**手势原语（gesture——本分区）**：`Gesture 识别器`（tap/pan/swipe/pinch/rotate… 纯逻辑零依赖，Web Pointer / MP touch 归一 GestureInput）+ `useGesture Hook / v-gesture 指令`（Web 官方接线）——「事件是 Backend 实现细节」，MP/原生端由各端 Backend 承接。

每条都是：**定位（模块头原文）→ 核心导出表（API 面）→ 真实用法（dogfooding 出处）→ 用法与降级**。手把手示例见[桌面端原语](/docs/30-desktop-primitives)与[质量门禁违规速查](/docs/29-quality-gates)（官网自己就在用这些原语）。

## 去哪看下一层

- [框架总览](/docs/framework/overview)：六层架构里语义层的位
- [可插拔架构](/docs/framework/22-architecture)：G 系列维度表（平台 API / 渲染 / 编译器 / 布局 / 桌面…各归其位）
- [语义组件总览](/docs/12-components-intro) / [能力系统](/docs/18-capability-system)：同表的另两张脸
