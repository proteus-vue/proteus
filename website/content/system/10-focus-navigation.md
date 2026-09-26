---
title: 焦点导航引擎
order: 10
group: 柔性系统
---

# 焦点导航引擎

> **遥控器只有一个方向键。** 车机旋钮、TV 遥控、键盘 Tab——这些形态没有"点哪儿去哪儿"的自由度，必须有可靠的**空间导航**：按方向键，焦点移动到几何上最合理的下一个目标。柔性系统把这套逻辑做成零依赖纯函数（`@proteus-vue/fluid` 的 `navigateFocus`），由能力声明自动启用。

## 为什么不用 DOM 顺序

浏览器的 Tab 顺序按 DOM 源码排列，而**视觉顺序 ≠ 源码顺序**（栅格/换行/多列布局下差异明显）。遥控用户按「右」期望焦点移到右边那个卡片——几何空间导航就是为这件事设计的（与 tvOS `UIFocusSystem`、Android `FocusFinder` 同思路）。

## 求解算法

```ts
navigateFocus(
  current: FocusRect | null,        // 当前焦点矩形（null = 首次进入）
  candidates: FocusRect[],          // 全部候选（纯数据，无 DOM 依赖）
  direction: 'up' | 'down' | 'left' | 'right',
  opts?: { preferredFirst?: string; crossWeight?: number },
): string | null
```

求解顺序（`packages/fluid/src/focus-nav.ts`）：

1. **方向筛选**——只保留目标方向上的候选（如按「右」取 `x > current.x`）
2. **主距离 + 交叉轴偏移加权**——主距离优先，交叉轴偏离越小越优先（`crossWeight` 默认 2：对齐性比距离更重要）
3. **同线优先**——同一行/列的候选优先于斜向候选
4. **确定性 tie-break**——完全同分时按稳定顺序取第一个（避免"随机跳动"的观感）

边界一律 **clamp**（不循环）：`clampOrWrap(index, total, wrap)` 保留 wrap 能力但不默认启用——tvOS / Leanback 的默认行为是不循环，循环会让"最后一张卡再按一次"产生不可预期的跳回。

配套单测 9 例（方向筛选/同线优先/交叉轴权重/确定性/空候选/唯一候选/边界）。

## 引擎启用条件（能力驱动）

```ts
// p-formfactor 内部
const focusEnabled = computed(() => capsEnabled(caps.value.dpad))   // 仅遥控系
```

| 形态 | 是否接管方向键 | 原因 |
|---|---|---|
| `car` / `tv` | ✅ | 遥控/旋钮输入，方向键是唯一移动方式 |
| `pc` | ❌ | 键盘用户期望**原生 Tab 顺序**；接管会违反 WCAG 2.1.1/2.4.3（曾误纳，已修） |
| 触控形态 | ❌ | 方向键应滚动页面，而非移动焦点 |

引擎启用时（遥控系）框架自动接线，**业务零改动**：

| 行为 | 说明 |
|---|---|
| roving tabindex | 当前焦点项 `tabindex=0`，其余 `-1`（容器内只保留一个可 Tab 停靠点） |
| 首焦点 | 进入形态即落定到首个可聚焦元素（TV/车机惯例：进来就能操作），且 `focusedId` 立即初始化（避免"第一次 Enter 空击"） |
| 候选集 | `button` / `[role=button]` / `.pf-focusable` / `.pf-rec-card` / `.fp-sku` / `.fp-rail-item` / Tab 项——覆盖内容槽里真实可点的元素 |
| 按键 | ↑↓←→ 几何移动；Enter / Space 触发 `click()` |
| 稳健性 | 稳定候选 id（非数组下标，防增删后撞名）；`focusin` 同步（外部点击后方向键从真实焦点出发）；候选集与姿态/形态变化时重建焦点；**可编辑元素守卫**（输入框内的方向键属于光标移动，不劫持） |
| 生命周期 | 随 `focusEnabled` 接/解绑——同会话切换形态后引擎正确启停（曾只在挂载时判一次） |

## 视觉：焦点必须可见

遥控形态（`visual.focus: 'ring'`）的焦点环由 `--pf-focus-ring` 驱动：

```css
.has-dpad :deep(*:focus-visible),
.has-focus-tree :deep(*:focus-visible) {
  outline: var(--pf-focus-ring, 3px) solid var(--pf-accent, #ffb13d);   /* 强调色 3px 环 */
  outline-offset: -2px;                                                 /* 内缩：防被海报行的 overflow 裁掉 */
  filter: brightness(1.07);                                             /* 提亮辅助 */
  box-shadow: 0 0 0 1px …, 0 6px 18px rgba(0,0,0,.45);
}
```

> 纪律：焦点强调**不用 `transform: scale`**——满行高的驾驶热区放大 4% 会溢出被裁（实测缺陷）。改用不改变布局几何的「环 + 投影 + 提亮」。

## 诚实边界

- **`clampOrWrap` 的 wrap 未见生产调用**：当前一律 clamp（符合平台惯例）；若将来给 TV 海报行开"行内循环"，需显式接线并补测试。
- **`crossWeight` 缺针对性测试**：当前 9 例未覆盖该参数的边际效应（已知项）。
- 旋钮（`crown`）目前只有视觉提示与热区语义，**连续调节输入**（旋转增减值）属规划项——愿景见 [OS 级路线图](/docs/system/01-overview)。

## 下一步

- [p-formfactor](/docs/system/11-p-formfactor)：引擎挂载的容器组件
- [能力三态与降级](/docs/system/08-capabilities)：`dpad` 声明从哪来
