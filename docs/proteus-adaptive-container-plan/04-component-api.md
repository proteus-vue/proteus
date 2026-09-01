# 自适应组件库 API 规范

> **执行位**：G-22 补充（组件生态层 P1）
> **关联**：组件库规范（待补 P1）、`p-adaptive` 原语（01）、Compiler（02）

---

## 1. 设计原则

自适应组件库的目标：**开发者只声明语义，框架自动选形态。**

- 组件内部**必须用** `p-adaptive` + 四原语（`p-grid`/`p-fluid`/`p-stack`/`p-fit`）实现，禁止硬编码媒体查询
- 所有尺寸走 `app.config.layout.breakpoints`（单一事实源）
- 组件自身**也是自适应容器**，可嵌套

## 2. `<p-modal>` 弹窗

### 2.1 API

```vue
<p-modal
  v-model:visible="visible"
  p-adaptive="sheet(0,600) | dialog(600,840) | popover(840,∞)"
  :anchor="triggerElement"
  :title="string"
  :closable="boolean"
  :mask-closable="boolean"
>
  <template #header>...</template>
  <template #default>...</template>
  <template #footer>...</template>
</p-modal>
```

### 2.2 形态映射

| 宽度 | 形态 | 触发方式 | 动画 |
|------|------|----------|------|
| < 600pt | Sheet | 底部滑入 | `UISheet` 系统动画 |
| 600–840pt | Dialog | 居中缩放 | `UIAlert` 系统动画 |
| > 840pt | Popover | 指向 anchor | `UIPopover` 系统动画 |

### 2.3 内部布局示例

```vue
<template #default>
  <p-stack direction="column" :wrap="true" :gap="12">
    <p-input v-model="value" />
    <p-stack direction="row" :wrap="true" :gap="8" justify="end">
      <p-button @click="visible = false">取消</p-button>
      <p-button variant="primary" @click="confirm">确定</p-button>
    </p-stack>
  </p-stack>
</template>
```

窄屏：按钮竖排；宽屏：按钮横排（`<p-stack :wrap>` 自动换行）。

## 3. `<p-nav>` 导航

### 3.1 API

```vue
<p-nav
  p-adaptive="drawer(0,840) | sidebar(840,1280) | topnav(1280,∞)"
  :items="navItems"
  v-model:active="current"
/>
```

### 3.2 形态映射

| 宽度 | 形态 | 表现 |
|------|------|------|
| < 840pt | Drawer | 汉堡菜单 + 侧滑抽屉 |
| 840–1280pt | Sidebar | 常驻左侧栏（`NavigationRail`） |
| > 1280pt | TopNav | 顶部导航条 |

### 3.3 嵌套自适应

```vue
<p-nav p-adaptive="drawer(0,840) | sidebar(840,∞)">
  <template #item="{ item, active }">
    <p-nav-item :icon="item.icon" :label="item.label" :active="active" />
  </template>
</p-nav>
```

`p-nav-item` 内部也自适应：窄屏只显示 icon，宽屏 icon + label（`p-fluid` 控制 label 显隐阈值）。

## 4. `<p-detail>` Master-Detail

### 4.1 API

```vue
<p-detail
  p-adaptive="fullscreen(0,768) | split(768,∞)"
  :master="masterData"
  v-model:selected="selectedItem"
>
  <template #master="{ item }">...</template>
  <template #detail="{ item }">...</template>
</template>
```

### 4.2 形态映射

| 宽度 | 形态 | 表现 |
|------|------|------|
| < 768pt | Fullscreen | 列表页 → 点击全屏跳转详情 |
| > 768pt | Split | 左列表 + 右详情，点击就地更新 |

**这是 iPad 分屏场景的核心模式**，iOS `UISplitViewController` 原生支持。

## 5. `<p-drawer>` 独立抽屉

```vue
<p-drawer
  v-model:visible="open"
  p-adaptive="overlay(0,840) | embed(840,∞)"
  side="left | right"
/>
```

- `overlay`：悬浮覆盖（窄屏）
- `embed`：嵌入布局（宽屏，类似 `SideBarContainer` Embed 模式）

## 6. 组件实现约定

### 6.1 内部必须用柔性原语

```vue
<!-- ✅ 正确 -->
<p-modal>
  <p-stack :wrap="true">...</p-stack>
</p-modal>

<!-- ❌ 禁止（FLD010） -->
<p-modal>
  <div class="modal-inner" style="width: 320px">...</div>
</p-modal>
```

### 6.2 暴露 `adaptive-config` 允许覆盖

```vue
<p-modal
  :adaptive-config="{
    sheet: [0, 480],
    dialog: [480, 720],
    popover: [720, Infinity],
  }"
/>
```

高级用户可自定义断点区间（默认取自 `app.config.layout.breakpoints`）。

### 6.3 与 Safe Area（G-09）协同

Sheet 底部、Drawer 侧边自动应用安全区：

```vue
<p-modal form="sheet">
  <div p-safe="bottom">内容（自动避让 Home Indicator）</div>
</p-modal>
```

框架自动注入 `p-safe-*`——开发者无需手动 `padding-bottom: env(safe-area-inset-bottom)`。

### 6.4 与 Glass（G-07）协同

```vue
<p-modal p-adaptive="sheet|dialog" glass="auto">
  <!-- glass="auto"：sheet 形态用 L1 blur，popover 形态用 L3 UIGlassEffect -->
</p-modal>
```

`glass="auto"` 让玻璃效果也随形态自适应（iOS 上 sheet 用 `UISheet` + 毛玻璃，dialog 用 `UIAlert` + 轻 blur）。

## 7. 严格规则补充

| 规则 | 级别 | 说明 |
|------|------|------|
| FLD010 | error | 自适应组件内部禁止硬编码固定宽度（须用 `p-fluid`/`p-grid`） |
| FLD011 | warning | 组件应暴露 `adaptive-config` 允许断点覆盖 |

## 8. 收益总结

| 场景 | 传统做法（uni-app/RN） | Proteus |
|------|----------------------|---------|
| 弹窗 | 手动 `if (width < 600) showSheet()` | `<p-modal p-adaptive>` 一次声明 |
| 导航 | 手动切换 TabBar / Drawer / Rail | `<p-nav p-adaptive>` |
| Master-Detail | 手动判断 + 两套页面 | `<p-detail p-adaptive>` |
| 折叠屏展开 | 手动监听 `onConfigurationChanged` | 容器宽度自动 reflow |
| 横竖屏切换 | 手动处理 | 系统原生动画自动 |
| 内部布局 | 媒体查询 | `p-stack`/`p-grid` 自动 |

**开发者写一次，五端 + 任意尺寸自动适配。这是把 iOS/Android/鸿蒙的系统级自适应能力搬进了框架。**
