---
title: 自适应侧边栏
order: 4
group: 柔性系统
---

# 自适应侧边栏

> 导航是每个应用的骨架，也是响应式最繁琐的部分：宽屏要左侧栏、窄屏要折叠、展开要横排。`p-sidebar` 把这三套布局收进一个组件——你只写导航项和正文。

## 手写导航布局的问题

同一份导航：全屏要左侧栏；放进平板分屏半宽要折叠；塞进卡片 / 多窗口要横排。手写意味着三套 DOM 与样式、一堆 `@media` 或 JS 宽度分支、折叠交互、无障碍属性——每个页面重复一遍。`p-sidebar` 的分工是：**布局与折叠交互归组件，业务只接插槽**（`#nav` 放导航，默认插槽放正文）。

## 三态状态机

| 状态 | 根类名 | 触发 | 形态 |
|---|---|---|---|
| side-rail | `p-sidebar-side-rail` | 容器 ≥ `min-sidebar-width` | 左侧定宽垂直侧栏（`nav-width`） |
| collapsed | `p-sidebar-collapsed` | 窄容器 + 用户未表态 | 内建「☰ 导航」切换条，导航收起 |
| collapsed-open | `p-sidebar-collapsed-open` | 窄容器 + 用户点开切换条 | 导航横排显示 |

状态机是**正交设计**：容器派生（`isWide`）与用户意图（`userExpanded`）分离，合成出三态：

```ts
// 容器回调只更新 isWide，绝不触碰 userExpanded
mode = isWide ? 'side-rail' : (userExpanded === true ? 'collapsed-open' : 'collapsed')
```

这条纪律来自真实 bug：早期版本 ResizeObserver 回调无条件回写 mode，「渲染 → 尺寸微变 → RO 回调 → 回写」把用户点击吞掉——容器派生状态与用户意图必须正交，交互状态才不会被时序覆盖。

于是全部切换时机都由容器查询与用户意图自动求解，业务零代码：

| 时机 | 状态迁移 | 你要写的东西 |
|---|---|---|
| 容器拖窄到 < `min-sidebar-width` | side-rail → collapsed | 无（容器查询自动） |
| 用户点「☰ 导航」切换条 | collapsed ↔ collapsed-open | 无（切换条内建） |
| 容器拖宽到 ≥ `min-sidebar-width` | collapsed-open → side-rail | 无（用户意图保留，宽容器恒侧栏） |
| drive-mode / reduced-motion 命中 | 追加 `p-sidebar-no-motion` | 无（动效门自动） |

## Props

| Prop | 类型 / 默认 | 说明 |
|---|---|---|
| `min-sidebar-width` | Number，`640` | 容器达到此值 → side-rail；窄于此 → 折叠 |
| `nav-width` | Number，`200` | side-rail 侧栏宽度 px |
| `design-width` | Number，`375` | 容器断点推导基准 |
| `toggle-label` | String，`'导航'` | collapsed 切换条文案 |

## 用法：官网 /docs 页就是活例子

```vue
<p-sidebar :min-sidebar-width="720" :nav-width="224" class="guide">
  <template #nav>
    <p-view class="sidebar-card">分组导航清单…</p-view>
  </template>
  <p-view class="doc">正文…</p-view>
</p-sidebar>
```

这就是**你正在看的文档页的真实代码**：宽容器下导航在左侧 sticky 跟随滚动；把窗口拖窄（或把页面放进分屏），导航自动折叠成切换条、正文撑满——业务侧零布局代码、零 `@media`、零 JS 分支。

组件内建、不用你写的细节：

- 切换条是真实 `button`，带 `aria-expanded` 无障碍状态（side-rail 态自动隐藏）
- 面板间距组件化：side-rail 侧栏 ↔ 主内容列间距 32px，展开态行间距 24px
- 横向滚动收敛：折叠态导航容器 `min-width: 0` + `overflow-x: auto`——flex item 默认 `min-width: auto`，会被 nowrap 的长导航撑破整页
- **根类名是页面按状态适配呈现的官方信号**：如 side-rail 态给侧栏卡片加 sticky 避让导航高度——页面只写视觉，不写布局

## 页面按状态适配：消费根类

组件拥有布局与状态，页面只做模式化呈现。官网文档页消费 side-rail 根类的真实样式（窄容器 collapsed 态随文档流、无需 sticky）：

```css
/* side-rail 态：侧栏卡片 sticky 避让导航高度——页面只写视觉 */
.p-sidebar-side-rail .sidebar-card {
  position: sticky;
  top: calc(var(--nav-h) + 16px);
  max-height: calc(100vh - var(--nav-h) - 32px);
  overflow-y: auto;
}
```

反例值得记住：早期版本曾为 bottom-bar 手写「横排紧凑 chips」页面样式，#384 折叠模式上线后立即违规——**布局适应严禁直接改页面布局，要么页面没用对原语，要么组件该完善**（本例是后者先行：折叠交互最终内建进组件）。

## 车机 d-pad 焦点与动效门

- **d-pad 焦点导航**：Arrow 方向键在导航项间移动焦点——side-rail 态上 / 下移动，collapsed-open 态左 / 右移动。实现为组件内部焦点游标 + `focus()`，不读 `document.activeElement`（组件审计 no-platform-api 约束）。车机 / TV 的五向遥控场景开箱即用。
- **动效门**：`createDeviceEnv` 采集 drive-mode（车机宿主注入）与 `prefers-reduced-motion`，任一命中 → 根类追加 `p-sidebar-no-motion`，组件内全部 transition / animation 禁用——驾驶中不得有过渡动画。

## 跨端降级

- 小程序无 ResizeObserver → 恒 collapsed（手机主场景本来就是窄容器形态，渲染端自决降级，不崩）
- 无 DOM 环境 → 焦点监听自动跳过
- 容器求解走 [createContainerQuery](/docs/system/02-container-query)：`isWide = 容器宽 ≥ min-sidebar-width`，按容器而非视口——分屏 / 多窗口里行为自动正确

## 下一步

- [断点与形态](/docs/system/05-breakpoints)：formForWidth 与 G-25 三维断点
- [布局组件](/docs/13-layout-components)：p-view / p-stack / p-split / p-sidebar 配方
- [容器查询](/docs/system/02-container-query)：三态切换的求解底座
