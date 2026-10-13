---
title: 液态玻璃引擎：pg-glass
order: 31
group: 专题深入
---

# 液态玻璃引擎：pg-glass

液态玻璃（毛玻璃模糊 + 着色 + 高光 + 边缘折射）在 Proteus 里只有一个入口：`<pg-glass>`（G-07 统一入口，引擎代号 **Aether**）。你声明**语义**（导航栏 / 卡片 / 悬浮层），组件按端映射到该端**最强实现**，能力不足时优雅降级为实色。

> **为什么禁止裸写 `backdrop-filter`：CSS017（error 级）+ GLS001-006（`proteus audit glass`）。**
> 裸写意味着三件事全要自己扛：各端实现差异（iOS Metal 自绘 / Android AGSL / 鸿蒙 Vulkan / Web·小程序 `backdrop-filter`）、无障碍（`prefers-reduced-transparency` 无人处理）、降级不崩溃（不支持时白块）。玻璃语义归组件，页面零裸写。

## 一份声明，各端最强玻璃

同一份 `<pg-glass>` 声明，各端映射到该端最强实现：

| 端 | 实现 | 观感 |
|---|---|---|
| iOS / Android | 宿主自绘玻璃遍（Metal / AGSL，来自一份 Rust WGSL） | **真实边缘折射** |
| 鸿蒙 | 宿主离屏 Vulkan（同源 SPIR-V） | **真实边缘折射** |
| Web / 小程序 | CSS `backdrop-filter` | 模糊 + 着色 + 高光边（**无折射**） |

## 三层承诺

| 层级 | 内容 | 承诺 |
|---|---|---|
| L1 基础玻璃 | blur + tint + radius + border | 全端一致必达 |
| L2 质感 | 噪点层 + 高光边 | Web / 小程序（CSS） |
| L3 真实折射 | 边缘倒角厚板：折射 + 磨砂 + Fresnel 高光 | 原生端（自绘玻璃遍） |

## 快速开始

`<pg-glass>` 是**框架内置组件**，无需安装。三种工程的引入方式：

```vue
<!-- 任意 .vue：直接写标签即可（Web / 小程序由框架自动解析；App 端构建期折叠） -->
<pg-glass preset="card" :radius="16">
  <view class="card-body">…</view>
</pg-glass>
```

- **Web**：`<pg-glass>` 由框架注册表自动注册（`@proteus-vue/components`），无需手动 import。
- **小程序（Skyline）**：`gen-routes` 自动解析框架组件（`/proteus/pg-glass`），无需 `usingComponents`。
- **App（iOS/Android/鸿蒙）**：构建期由编译器把 `<pg-glass …>` 折叠为带 `glass` 字段的普通盒，宿主自绘玻璃面（产物见 `dist/app/<平台>/glass-manifest.json`）。

## Props

| prop | 类型 / 默认 | 说明 |
|---|---|---|
| `preset` | String，`'custom'` | 预设：`navigationBar` / `tabBar` / `modal` / `card` / `floating` / `sidebar` / `custom` |
| `intensity` | String \| Number，缺省用预设 | 档位 `none` / `thin` / `regular` / `thick` / `ultra`；或直接给数字缩放 blur |
| `tint` | String，`''` | 着色（覆盖预设 tint） |
| `radius` | Number，`0` | 圆角 px（`0` = 不覆盖，圆角归页面控制） |
| `border` | Boolean，缺省用预设 | 高光边（0.5px 内描边，L2） |
| `noise` | Number，缺省用预设 | 噪点强度 0-1（L2；`0` = 关闭） |
| `fallback` | String，`'solid'` | 降级策略：`solid`（半透明实色）/ `flat`（无背景仅边框） |

## 预设数值表

最终 `blur = round(预设基础 blur × 强度档位)`；档位：`none` 0 / `thin` 0.6 / `regular` 1.0 / `thick` 1.4 / `ultra` 1.8。

| preset | 基础 blur | 默认 tint | 典型用途 |
|---|---|---|---|
| `navigationBar` | 20 | rgba(255, 255, 255, 0.15) | 顶部导航条（吸顶） |
| `tabBar` | 20 | rgba(255, 255, 255, 0.15) | 底部标签栏 |
| `modal` | 24 | rgba(255, 255, 255, 0.15) | 模态面板 |
| `card` | 16 | rgba(255, 255, 255, 0.08) | 内容卡片 |
| `floating` | 28 | rgba(255, 255, 255, 0.18) | 浮动控件 |
| `sidebar` | 20 | rgba(255, 255, 255, 0.12) | 侧边栏 |
| `custom` | 20 | rgba(255, 255, 255, 0.12) | 自定义（配 props 覆盖） |

`radius` / `border` / `noise` 的按端预设规格属规划项；Web L1 实现里圆角与噪点由 props 显式传入，`border` 缺省开启高光边。

## 真实示例

官网吸顶导航栏（`pg-glass` + 页面只管定位）：

```vue
<!-- website/src/App.vue -->
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

App 端（superapp「我的」页，构建期折叠为 `style.glass` 自绘玻璃面）：

```vue
<pg-glass preset="card" :radius="12" style="height: 64px; margin: 0 12px 12px">
  <view class="mine-glass-in"><text class="mine-glass-t">液态玻璃 · 自研材质</text></view>
</pg-glass>
```

## 定位与布局归消费方

根元素**不写 `position` / `display`**——sticky、absolute、宽高、内边距全部由页面类声明（组件不越权）；噪点层与高光边锚定在内层容器，不影响你的定位上下文。

## 降级：不崩溃铁律

| 场景 | 行为 |
|---|---|
| `prefers-reduced-transparency: reduce` | 关闭 blur，背景切实色（无障碍优先——铁律 4） |
| 不支持 `backdrop-filter`（`@supports` 探测） | 同样降级实色 |
| 低端机（`tier: low`） | 降到 L1 |
| 小程序逻辑层 | 无 `matchMedia` → 恒玻璃（探测走 `globalThis`，渲染端自决） |

降级时噪点层与高光边一并关闭，文案与内容照常可读——玻璃是增强，不是依赖。降级决策由纯函数 `resolveGlassLevel()` 给出（`@proteus-vue/glass`）。

## 接入前必做：`proteus audit glass`

任何页面手写 `backdrop-filter` 都会被 audit 规则 **GLS001（error）拦下**：

```bash
proteus audit glass src        # 扫裸 backdrop-filter / 嵌套深度 > 2 / 单页玻璃节点 > 10
```

规则：**玻璃只走 `<pg-glass>` 单入口**；嵌套 ≤ 2 层、单页节点 ≤ 10（性能预算）。确需保留（自身即玻璃入口实现）用 `// d2-exempt: 理由` 或目录名含 `pg-glass` 具名豁免。CI 门禁：`check:glass-audit`。

## 玻璃系统外壳组件（Aether · 规划）

业务写 `<pg-glass>`；框架另有一套**玻璃系统外壳组件**（代号 **Aether**，`lg-*`，如 `lg-nav-bar` / `lg-tab-bar` / `lg-sheet`），**内部渲染 `<pg-glass>`**，提供系统级外壳语义（安全区、滚动钉住、状态栏对接）。**当前为立项规划（`docs/Proteus_液态玻璃系统组件库方案.md`），尚未落地**——届时业务可直接用系统外壳，无需自己拼 `pg-glass`。

## FAQ

**Q：为什么 Web 端玻璃没有 App 那种边缘折射？**
A：Web / 小程序走 CSS `backdrop-filter`（浏览器合成器原生快路径），**只有模糊**；真折射需自绘玻璃遍，仅原生端有（决策 #877，诚实边界）。

**Q：预设不够用怎么办？**
A：优先用最接近的 `preset`（经验证的最佳参数组合），再配 `preset="custom"` + props 精确覆盖；不要手写 `backdrop-filter`。

**Q：玻璃挡住了点击 / 影响布局？**
A：`pg-glass` 根元素不写 position/display——定位、尺寸、层级由你的页面类控制；玻璃是纯视觉增强。

**Q：圆角不生效？**
A：`radius` 缺省 `0`（不覆盖）——需显式传 `:radius="16"`；或把圆角写在页面类上（归消费方）。

## 下一步

- [液态玻璃引擎产品页](/liquid-glass)：真跑演示（预设 / 交互 / 端矩阵 / 降级）
- [桌面端原语](/docs/30-desktop-primitives)：光晕 + 玻璃 = 桌面氛围层
- [语义组件总览](/docs/12-components-intro)：组件全景与分类表
