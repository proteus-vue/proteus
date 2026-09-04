---
title: 液态玻璃：pg-glass
order: 15
group: 布局与组件
---

# 液态玻璃：pg-glass

玻璃材质（毛玻璃模糊 + 着色 + 高光边）在 Proteus 里只有一个入口：`<pg-glass>`（G-07 统一入口）。你声明**语义**（导航栏 / 卡片 / 悬浮层），组件负责按端映射到最优实现，并在能力不足时优雅降级为实色。

> **为什么禁止裸写 `backdrop-filter`：CSS017（error 级）+ GLS001-006。**
> 裸写意味着三件事全要自己扛：各端实现差异（iOS `UIGlassEffect` / 鸿蒙 fractal / Android `RenderEffect` / Web `backdrop-filter`）、无障碍（`prefers-reduced-transparency` 无人处理）、降级不崩溃（不支持时白块）。玻璃语义归组件，页面零裸写。

## 分层承诺

| 层级 | 内容 | 承诺 |
|---|---|---|
| L1 基础玻璃 | blur + tint + radius + border | 全端一致必达 |
| L2 质感 | 噪点层 + 顶部高光边 | Web / Skyline 尽力达 |
| L3 系统级 | iOS `UIGlassEffect` / 鸿蒙 fractal | 仅原生端 |

## Props

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `preset` | String，`'custom'` | 预设：`navigationBar` / `tabBar` / `modal` / `card` / `floating` / `sidebar` / `custom` |
| `intensity` | String，`'regular'` | 强度：`thin` / `regular` / `thick`（缩放 blur） |
| `tint` | String，`''` | 着色（覆盖预设 tint） |
| `radius` | Number，`0` | 圆角 px（`0` = 不覆盖，圆角归页面控制） |
| `border` | Boolean，`true` | 高光边（0.5px 内描边） |
| `noise` | Number，`0` | 噪点强度 0-1（L2；`0` = 关闭） |

## 预设数值表（blur / tint，Web 实现）

最终 `blur = round(预设基础 blur × 强度档位)`；档位：`thin` 0.6 / `regular` 1.0 / `thick` 1.4。

| preset | 基础 blur | 默认 tint |
|---|---|---|
| `navigationBar` | 20 | rgba(255, 255, 255, 0.15) |
| `tabBar` | 20 | rgba(255, 255, 255, 0.15) |
| `modal` | 24 | rgba(255, 255, 255, 0.15) |
| `card` | 16 | rgba(255, 255, 255, 0.08) |
| `floating` | 28 | rgba(255, 255, 255, 0.18) |
| `sidebar` | 20 | rgba(255, 255, 255, 0.12) |
| `custom` | 20 | rgba(255, 255, 255, 0.12) |

`radius` / `border` / `noise` 的按端预设规格属规划项（📋）；Web L1 实现里圆角与噪点由 props 显式传入，`border` 缺省开启高光边。

## 真实示例：官网导航栏

```vue
<!-- website/src/App.vue：吸顶导航栏 = pg-glass + 页面只管定位 -->
<pg-glass preset="navigationBar" class="nav-shell" :class="{ 'is-scrolled': scrolled }">
  <header>
    <p-stack direction="row" :gap="8" wrap class="nav">…</p-stack>
  </header>
</pg-glass>
```

```css
/* 页面只保留定位与描边——blur / tint / 高光边 / 噪点全归组件 */
.nav-shell { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--line); }
```

数据背书卡（首页玻璃卡，L2 噪点开启）：

```vue
<pg-glass preset="card" intensity="thin" :radius="14" :noise="0.03" class="stat">
  <p-text class="stat-value">{{ s.value }}</p-text>
  <p-text class="stat-label">{{ s.label }}</p-text>
</pg-glass>
```

## 定位与布局归消费方

根元素**不写 `position` / `display`**——sticky、absolute、宽高、内边距全部由页面类声明（组件不越权）；噪点层与高光边锚定在内层 `__in` 容器，不影响你的定位上下文。

## 降级：不崩溃铁律

| 场景 | 行为 |
|---|---|
| `prefers-reduced-transparency: reduce` | 关闭 blur，背景切实色 `#121216`（无障碍优先——铁律 4） |
| 不支持 `backdrop-filter`（`@supports` 探测） | 同样降级实色 |
| 小程序逻辑层 | 无 `matchMedia` → 恒玻璃（探测走 `globalThis`，渲染端自决） |

降级时噪点层与高光边一并关闭，文案与内容照常可读——玻璃是增强，不是依赖。

> 使用规则：优先 `preset`（经验证的最佳参数组合）；确有特殊需求再 `preset="custom"` 覆盖 props；**任何页面手写 `backdrop-filter` 都会被 audit 规则 CSS017 / GLS001 拦下**。

## 下一步

- [桌面端原语](/docs/14-desktop-primitives)：光晕 + 玻璃 = 桌面氛围层
- [布局组件](/docs/12-layout-components)：玻璃卡放进 p-grid / p-sidebar 的组合方式
- [语义组件总览](/docs/11-components-overview)：组件全景与分类表
