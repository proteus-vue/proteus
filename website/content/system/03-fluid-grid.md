---
title: 柔性网格
order: 3
group: 柔性系统
---

# 柔性网格

> **列数不该由你算。** 你只声明「每列最小宽度」，列数随容器宽度自动伸缩——中间连续变化，没有断点跳变。

## 手写网格的问题

```css
/* ❌ 手写：列数是断点魔数的函数 */
.cards { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 1024px) { .cards { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px)  { .cards { grid-template-columns: 1fr; } }
```

三个断点 × 每个页面一遍 × 每种容器位置一遍——[断点爆炸](/docs/system/01-overview)的标准形态。更糟的是：这张卡片被放进 500px 的侧栏时，视口断点毫不知情，三列直接挤爆。而手动算列数（JS 读宽度再 `setState`）正是 FLD008 禁止的宽度分支。

## p-grid：只声明最小列宽

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `min-col-width` | Number，`160` | 每列最小宽度 px——列数自动求解（FLD004 必须声明） |
| `gap` | Number，`12` | 列 / 行间距 px |

```vue
<p-grid :min-col-width="160" :gap="12">
  <p-card v-for="item in items" :key="item.id" />
</p-grid>
```

Web 端生成原生 CSS Grid（浏览器自己重排，零 JS 开销）：

```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
gap: 12px;
```

容器 320px → 1 列、768px → 4 列、1440px → 8 列；拖动窗口时连续变化。**断点魔数被一个语义参数（min-col-width）取代**——设计稿说「卡片最小 280px」，你写 `:min-col-width="280"`，列数是求解结果，不是手写结论。

## 与手写网格的对比

| 维度 | 手写 grid + `@media` | `p-grid` |
|---|---|---|
| 列数 | 每个断点手写一遍 | auto-fill 自动求解 |
| 断点魔数 | 768 / 1024 / 1440 散落各处 | 无（只有 min-col-width 语义） |
| 容器位置 | 视口断点对卡片 / 分屏失效 | 按容器宽自动正确 |
| 跨端映射 | 仅 CSS | iOS `UICollectionView` / Android `GridLayoutManager` / 鸿蒙 `Grid` / Web CSS Grid |
| 治理 | 无 | FLD004 门禁强制声明 min-col-width |

原则 #10 的又一次投影：框架定义「自适应网格」语义，各端用**各自的系统级网格容器**实现——Proteus 不模拟网格。

## 真实示例：本官网

官网首页的能力卡与数据背书条就是 `p-grid`（拖动窗口看列数连续伸缩，全程零断点）：

```vue
<!-- 能力卡：卡片最小 280px -->
<p-grid :min-col-width="280" :gap="14">
  <p-view v-for="p in pillars" :key="p.no" class="pillar-card">…</p-view>
</p-grid>

<!-- 数据条：格子更小，最小 200px -->
<p-grid :min-col-width="200" :gap="12">
  <p-view v-for="s in stats" :key="s.label" class="stat">…</p-view>
</p-grid>
```

## 降级：朴素但正确（G-22.2）

网格是纯 CSS 求解，不需要 JS 监听尺寸；降级发生在「渲染端不支持 grid」时：

- 组件初始化执行一次 `detectFluidCapabilities().grid`（`CSS.supports` 探测 `repeat(auto-fit, minmax(...))`）：
  - 支持 → 原生 CSS Grid
  - 不支持 → **flex-wrap 模拟**：容器 `display: flex; flex-wrap: wrap`，子项 `min-width: var(--pgrid-min)` + `flex: 1 1 auto`——`--pgrid-min` 由组件内联注入，全局规则 `.p-grid-fallback > *` 按容器类切换生效
- 小程序：逻辑层无 `CSS.supports` → 假设支持、恒 grid 模式；渲染端自决——webview 渲染支持 grid，Skyline 降级为普通容器（仍是朴素但正确的排列）

## 什么时候不用网格

| 需求 | 用谁 | 理由 |
|---|---|---|
| 一维内容流、空间不足换行 | `p-stack`（`:wrap="true"`） | 标签 / 按钮组不需要等宽列 |
| 两栏分屏（编辑器 + 产物） | [p-split](/docs/13-layout-components) | 堆叠 / 并排切换，不是多列等分 |
| 单属性流式缩放（字号 / 间距） | `p-fluid`（`v-p-fluid` 指令） | 见[柔性布局指南](/docs/17-fluid-layout) |

## 下一步

- [自适应侧边栏](/docs/system/04-sidebar)：导航布局的三态状态机
- [柔性布局](/docs/17-fluid-layout)：G-22 四原语与 FLD 铁律
- [布局组件](/docs/13-layout-components)：p-view / p-stack / p-split / p-sidebar 配方
