---
title: 布局组件：p-view / p-stack / p-split / p-sidebar
order: 12
group: 布局与组件
---

# 布局组件：p-view / p-stack / p-split / p-sidebar

布局组件把「响应式意图」交给框架求解：你声明容器语义（分栏 / 侧栏 / 换行），断点与形态切换由组件内的容器查询运行时完成——**按容器而非视口求解**（分屏、多窗口、嵌入卡片都按自身容器宽自适应），业务侧零 `@media`、零 JS 宽度分支（FLD001 / FLD006）。

> **本篇第一铁律：`p-view` 默认 `box-sizing: content-box`。**
> 这是与小程序 Skyline 对齐的刻意设计。凡「宽 100% + padding」组合必须显式写 `border-box`，否则 padding 向外扩、击穿父容器——官网实测根因：内容区 584px > 容器 556px。页面样式一律 scoped + 显式 `box-sizing`。

## p-view：一切容器的基底

默认样式只有三条：`display: flex; flex-direction: column; box-sizing: content-box`。props：`pid` / `disabled`（透明度降为 0.6）/ `ariaLabel`。

```vue
<p-view class="hero-content">
  <p-heading :level="1">One semantic model.</p-heading>
  <p-text>语义组件总览</p-text>
</p-view>
```

```css
/* ❌ 默认 content-box：width 100% + padding → padding 外扩击穿容器 */
.card.p-view { width: 100%; padding: 16px; }

/* ✅ 显式 border-box——凡 width 100% + padding 组合必写 */
.card.p-view { width: 100%; padding: 16px; box-sizing: border-box; }
```

需要横向排布时显式覆盖方向（页面修饰类，组件保持语义默认）：

```css
.row.p-view { flex-direction: row; }
```

## p-stack：弹性栈

方向 + 间距 + 智能换行，内部是 `flex + gap`：

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `direction` | String，`column` | 主轴方向：`row` 横向 / `column` 纵向 |
| `wrap` | Boolean，`false` | 空间不足自动换行（row 横排时生效） |
| `gap` | Number，`0` | 子项间距 px |

官网导航栏真实用法（横排 + 可换行，窄屏自动折行不溢出）：

```vue
<p-stack direction="row" :gap="8" wrap class="nav">
  <router-link to="/" class="brand">…</router-link>
  <p-stack direction="row" :gap="4" wrap class="nav-links">
    <router-link v-for="l in links" :key="l.key" :to="l.to" class="nav-link">…</router-link>
  </p-stack>
</p-stack>
```

## p-split：自适应分栏

平板 / 车机 / 多窗口的核心原语。容器宽 `< min-split-width` → 堆叠（纵向），`≥` → 并排（横向）——同一份代码，无断点无 JS 分支。

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `min-split-width` | Number，`640` | 达到此值并排，窄于此堆叠 |
| `gap` | Number，`16` | 分栏 / 堆叠间距 px |
| `design-width` | Number，`375` | 容器断点推导基准 |

**第一栏必须写 `#aside` 具名插槽**，第二栏进默认插槽（官网曾把两栏都放默认插槽，split 态从未生效——#386 修复）：

```vue
<p-split :min-split-width="880" :gap="16" class="pg-grid">
  <template #aside>
    <p-view class="pg-pane">编辑器…</p-view>
  </template>
  <p-view class="pg-pane">产物 / IR / Trace…</p-view>
</p-split>
```

```css
/* 模式归原语、列宽归页面：双栏等分 + 面板撑满高度在页面声明 */
.pg-grid { display: flex; align-items: stretch; }
.pg-grid > .pg-pane { flex: 1 1 0; min-width: 0; }
```

> 小程序端无 ResizeObserver → 恒堆叠（手机主场景，渲染端自决降级）。

## p-sidebar：自适应导航栏

文档页 / 设置页的骨架。三态状态机：**isWide（容器派生）与 userExpanded（用户意图）正交**——容器变化只更新 isWide，绝不覆盖用户交互状态。

| 状态 | 根类名 | 触发 | 形态 |
|---|---|---|---|
| side-rail | `p-sidebar-side-rail` | 容器 ≥ min-sidebar-width | 左侧定宽垂直侧栏 |
| collapsed | `p-sidebar-collapsed` | 窄容器 + 用户未表态 | 切换条常驻，导航收起 |
| collapsed-open | `p-sidebar-collapsed-open` | 窄容器 + 用户点开切换条 | 导航横排显示 |

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `min-sidebar-width` | Number，`640` | 达到此值 → side-rail |
| `nav-width` | Number，`200` | side-rail 侧栏宽度 px |
| `design-width` | Number，`375` | 容器断点推导基准 |
| `toggle-label` | String，`'导航'` | collapsed 切换条文案 |

官网文档页真实用法（导航 + 正文两个插槽，业务零布局代码）：

```vue
<p-sidebar :min-sidebar-width="720" :nav-width="240" class="guide">
  <template #nav>
    <p-view class="sidebar-card">分组导航清单…</p-view>
  </template>
  <p-view class="doc">正文…</p-view>
</p-sidebar>
```

内建能力（组件送的，不用写）：

- **面板间距组件化**：侧栏 ↔ 主内容列间距 32px、展开态行间距 24px。
- **车机 d-pad 焦点导航**：Arrow 方向键在导航项间移动焦点（side-rail 态上下、展开态左右）。
- **动效门**：drive-mode / `prefers-reduced-motion` → 根类加 `p-sidebar-no-motion`，全组件禁用过渡动画。
- 根类名是**页面按状态适配呈现的官方信号**（如 side-rail 态侧栏卡片 sticky 避让导航）。
- 小程序端无 ResizeObserver → 恒 collapsed。

## 配方：常见布局怎么写

```vue
<!-- 卡片网格：列数自动（越窄列越少，越宽列越多） -->
<p-grid :min-col-width="280" :gap="14">
  <p-view v-for="p in pillars" :key="p.no" v-p-hover class="pillar-card">…</p-view>
</p-grid>

<!-- 横排推挤：左标题右按钮，中间弹性空白 -->
<p-stack direction="row" :gap="12">
  <p-heading :level="3">标题</p-heading>
  <p-spacer />
  <p-button>操作</p-button>
</p-stack>

<!-- 设置页骨架：窄容器折叠、宽容器侧栏 -->
<p-sidebar :min-sidebar-width="720" :nav-width="240">
  <template #nav>…</template>
  …
</p-sidebar>
```

| 需求 | 用谁 | 一句话理由 |
|---|---|---|
| 纵向内容流 | `p-view` | 默认就是 flex-column |
| 横排 / 换行 / 间距 | `p-stack` | gap + wrap 一处声明 |
| 等分自适应网格 | `p-grid` | 只声明列最小宽 |
| 双栏分屏 | `p-split` | 容器查询自动堆叠 / 并排 |
| 导航 + 内容 | `p-sidebar` | 三态 + d-pad + 动效门全内建 |
| 推挤对齐 | `p-spacer` | 弹性占位（flex-grow:1） |

## 下一步

- [柔性布局](/docs/06-fluid-layout)：v-p-fluid clamp 表达式与断点体系
- [反馈与动效](/docs/13-feedback-components)：p-segment / p-toast / p-animate
- [液态玻璃](/docs/15-liquid-glass)：pg-glass 与布局组件的组合
