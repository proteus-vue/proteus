# 协同设计：Glass / AOT / IFR / CSS 矩阵

本方案不是孤立功能，而是**复用既有架构资产**——这决定了它能以极小成本落地。

## 1. 与 Glass（proteus-glass-plan）

### 1.1 滤镜管线复用

纪念日灰度的"滤镜挂载"与 Glass 的 `UIGlassEffect` / `backdrop-filter` / `RenderEffect` 走**同一条滤镜管线**：

```
[Glass 管线]  pg-glass → 滤镜 IR → 各端原生滤镜
                ↓ 复用
[Memorial]    grayscale → 滤镜 IR → 各端原生滤镜
```

iOS 端两者都落到 `CALayer` 滤镜层；Android 都走 `RenderEffect`；Web/Skyline 都是 CSS `filter`/`backdrop-filter`。**同一套 binding，新增能力 ≈ 新增一个 preset。**

### 1.2 组合能力（独家卖点）

```vue
<pg-glass preset="navigationBar">
  <!-- 悼念日：玻璃 + 灰度 + 骨架 一次声明 -->
</pg-glass>
```

悼念日导航栏玻璃 + 全站灰度**组合生效**——uni-app / RN / Flutter 均不提供此声明式组合。

### 1.3 注意：骨架态无玻璃

骨架屏阶段 `<pg-glass>` 降级为普通占位块（骨架是静态结构，不承担玻璃/模糊效果），真实 View 接管后再应用 Glass。这条降级规则写在 Glass plan 的"降级策略"章节。

## 2. 与 AOT / IFR（proteus-performance-plan）

### 2.1 IR 同源

```
SFC + 路由表
    ↓ Compiler 静态分析（一次）
┌────────────┬────────────┐
│ 真实 UI IR │ 骨架 IR    │  ← 同源产出
└────────────┴────────────┘
    ↓                ↓
  AOT 预编译      IFR 静态首帧
```

骨架 IR 与 AOT IR **同目录、同格式、同生命周期**——AOT 落地时骨架自动具备。

### 2.2 IFR 静态首帧 = 骨架屏

Performance plan 的 IFR（静态首帧）机制：**绕过 Vue，用 AOT 预编译的 IR 直接渲染首帧**。骨架 IR 正是这份"静态首帧"的理想内容：

- Web：`<head>` 内联骨架 HTML，Vue mount 前即显示；
- Skyline：骨架 WXML 静态节点，首屏直接渲染；
- App：AOT 预编译骨架 IR → JSI 直接 mount 原生占位 View，**无需等待 Vue 启动**。

→ **骨架屏与 IFR 是同一件事的两个名字**，合并落地，不重复建设。

## 3. 与 CSS 兼容矩阵（proteus-css-compat）

### 3.1 grayscale 的档位归属

| 能力 | 矩阵档位 | 说明 |
|------|---------|------|
| `filter: grayscale()` | ✅ 直映射 | Web/Skyline/鸿蒙原生支持；iOS/Android 走滤镜管线 |
| 骨架样式（shimmer） | ✅ 直映射 | `linear-gradient` 动画，五端支持 |

本方案**不引入任何 ❌ 禁止面**，完全在 ✅ 直映射范围内，符合原则 #10。

### 3.2 新增 lint 规则

- `memorial/no-hardcode-filter`（CSS016）：禁业务手写 `grayscale` → 引导用 `app.config.ts`
- `memorial/no-page-filter`（CSS017）：禁 Skyline `page` 直挂 → 改根容器
- `skeleton/no-screenshot-base64`（SKL001）：禁截图转 base64 → 强制结构化 IR

纳入 `--strict-css` 与 `proteus doctor`。

## 4. 与 Safe Area（proteus-safe-area）

纪念日灰度、骨架屏的占位层都需**避让安全区**（尤其灵动岛）：

- 灰度覆盖层 `pointer-events: none` + 全屏铺满，但不侵入 `p-safe-island` 区域；
- 骨架屏根节点继承 `p-safe-*` 语义，结构与真实页面一致（含安全区避让）。

→ 复用 Safe Area 的 `p-safe` 语义原语，不另造。

## 5. 协同总览

| 既有资产 | 本方案复用点 | 新增成本 |
|---------|------------|---------|
| Glass 滤镜管线 | 灰度滤镜挂载 | 极低（一个 preset） |
| AOT IR | 骨架 IR 同源 | 无（共用产出） |
| IFR 静态首帧 | 骨架即首帧 | 无（合并落地） |
| CSS 兼容矩阵 | grayscale = ✅ 直映射 | 仅新增 3 条 lint |
| Safe Area | `p-safe` 避让 | 无 |
| Compiler transform | 新增 skeleton transform | 中（静态分析） |

**结论**：纪念日灰度 + 骨架屏是**"既有架构资产的组合收益"**，不是从零新建——这正是原则 #10「语义统一、实现各端最优」的复利效应。
