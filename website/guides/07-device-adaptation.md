---
title: 全终端适配
order: 7
---

# 全终端适配（G-24 桌面原语 + G-25 全终端）

## 桌面交互原语（G-24，已落地）

一套代码适配 PC 时，缺的不是布局而是**交互语义**。`@proteus-vue/desktop` 提供 17 个模块 + 指令：

| 原语 | 语义 | 平台惯例 |
|------|------|---------|
| `p-hover` | 悬停状态 | 触屏自动降级 tap 高亮 |
| `p-shortcut` | 键盘快捷键 | `mod+s` → Mac ⌘S / Win Ctrl+S |
| `p-focus-trap` | 焦点陷阱 | 弹窗 Tab 循环 + Shift+Tab 反向 |
| `p-context-menu` | 右键菜单 | 防溢出定位 + 长按归一 |
| `p-notify` / `p-permission` / `p-deeplink` / `p-command`（⌘K） | 系统集成四件套 | PRIM 语义 |

```vue
<article v-p-hover class="card">…</article>
<input v-p-shortcut="'mod+s'" @shortcut="save" />
```

## 三维断点模型（G-25，规划中）

W（宽度）× H（高度）× F（输入形态）三维刻画终端：

| F | 设备 | 关键能力 |
|---|------|---------|
| touch | 手机 / 平板 / 车机 | 基础 |
| cursor | PC / 车机副屏 | 鼠标键盘 |
| remote | TV | 焦点引擎（UIFocusSystem / Leanback） |
| dial | 手表 | 表冠 + 并发症 |
| voice | 车机 | 语音导航 |

铁律：车机 driving-safe（VEH001）/ TV 焦点模式（TV001）/ 手表单列（WATCH001）。

## 降级不崩溃（原则 #4）

能力按 L1（必达）/ L2（尽力）/ L3（系统级）三档声明，高端能力缺失时沿 L3→L2→L1→solid 降级链回退——**编译期可见，运行时不崩**。
