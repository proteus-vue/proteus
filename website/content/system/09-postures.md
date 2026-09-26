---
title: 折叠姿态与连续性
order: 9
group: 柔性系统
---

# 折叠姿态与连续性

> **折叠屏是动态形态**：同一台设备在「折叠态外屏 / 半折桌面模式 / 展开态内屏」之间切换，应用不应重启、不该丢状态，布局应连续重排。柔性系统把姿态做成一等数据——`postures[]` 声明每个姿态的拓扑、导航、视口与度量基准。

## 三姿态

| 姿态 `key` | 视口 | 拓扑 | 导航 | 特殊语义 |
|---|---|---|---|---|
| `folded` 折叠态（外屏） | 340×800 | `stack` 单列 | bottom-tabs | 度量按**窄手机**基准（`ratio.ref: 300`） |
| `tabletop` 半折（桌面模式） | 673×420 | `stack` | tabs | 水平铰链——上半展示 / 下半操作 |
| `expanded` 展开态（内屏） | 673×841 | `duo` 双窗格 | tabs | 主图 + 详情分列 |

```ts
// packages/fluid/src/formfactor.ts（fold 画像摘录）
postures: [
  { key: 'folded',   topology: 'stack', nav: 'bottom-tabs', viewport: { width: 340, height: 800 },
    ratio: { baseFont: 13, ref: 300, min: 0.85, max: 1.5 } },   // ← 姿态级度量
  { key: 'tabletop', topology: 'stack', nav: 'tabs', viewport: { width: 673, height: 420 }, hinge: 'horizontal' },
  { key: 'expanded', topology: 'duo',   nav: 'tabs', viewport: { width: 673, height: 841 } },
]
```

## 连续性契约

1. **形态不重启**：业务状态（表单输入、选中项、滚动位置）跨姿态保留——由「同一组件实例重排」保证，不是重新挂载。
2. **拓扑连续重排**：`stack` ⇄ `duo` 是结构变化，不是缩放；折叠/展开拓扑**必须不同**（`validateFormProfiles` 强制），否则「形态切换」名不副实。
3. **视口递增**：展开态视口必须宽于折叠态（340 → 673），门禁校验。
4. **度量随姿态**：姿态可覆写 `ratio`——外屏 340pt 若沿用内屏基准（ref 420）会得到 k=0.81 → 正文 9.7px（连 WCAG 2.5.8 的 24px 触控下限都不达）；改按窄手机基准后正文 14.7px。

## 半折（tabletop）的取舍

半折是「上半屏展示、下半屏操作」的物理形态，可视高度只有 420pt。实现按**优先级取舍**而非等比压缩：

- 媒体区上限 40%（保证上屏有内容、下屏可操作）
- 描述与规格收起（抬腕/半折场景读不完次要信息）
- 主操作与 Tab 保留在可达位置

内容不得跨折痕：水平铰链时折痕横贯中部（演示页按 `posture.hinge` 画横折痕，此前恒为竖折痕是错的）。

## 铰链几何

真机（Web 折叠屏）经 `env(fold-*)` 提供铰链带宽度，框架发射 `--pf-fold-width` 并由 `duo` 拓扑消费：

```css
.topo-duo .pf-body {
  /* 真机 env(fold-width) > 0 时自动让开折痕；普通屏幕回退 0px = 与设计间距一致 */
  column-gap: max(calc(var(--pf-gap) * var(--pf-gap-dense)), var(--pf-fold-width, 0px));
}
```

> 历史坑：早期实现同时输出「左侧按铰链左缘缩进」与「右侧按右窗格宽缩进」——中置铰链设备上两侧内边距之和 = 100%，**内容宽归零**。正确语义是「单流内容只避让铰链带」，而非双向内边距。

## 姿态如何被消费

| 环节 | 说明 |
|---|---|
| 声明 | 宿主传 `posture="folded \| tabletop \| expanded"`（演示页走 `?posture=` 可分享） |
| 生效条件 | **仅当该形态的画像真有此姿态**才生效——`phone + posture=tabletop` 会被忽略（否则会静默隐藏 SKU 槽/压封面，声明与渲染打脸） |
| 覆盖范围 | `topology` / `nav` / 视口 / `ratio`（度量基准） |
| 诊断属性 | 根节点 `data-pf-posture` / `data-pf-topology` / `data-pf-nav`（可被 e2e 断言） |

## 诚实边界

- 姿态**来自宿主声明**。Web 端可读 `display-mode: fold/span` 做增强，但真机姿态事件（WM FoldingFeature / ArkUI foldStatus / hinge 角度）属**形态感知服务**范畴，尚未接入——愿景见 [OS 级路线图](/docs/system/01-overview)。
- 当前只建模三个离散姿态；铰链**角度**是连续量，不扩成枚举（按几何输入处理属规划项）。

## 下一步

- [焦点导航](/docs/system/10-focus-navigation)：键盘/遥控可达性的空间导航引擎
- [p-formfactor](/docs/system/11-p-formfactor)：`posture` prop 的组件层用法
