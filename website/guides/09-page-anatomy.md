---
title: 页面构成
order: 9
group: 代码构成
---

# 页面构成

一个页面就是一个**标准 Vue SFC**（`.vue` 文件），最多四个部分：`<template>`、`<script setup>`、`<style>` 和 Proteus 特有的 `<route>` 块。

脚手架自带的 `src/pages/index.vue` 是一个**可直接跑的展示页**（品牌区 + 关键数字 + 交互演示 + 下一步，样式与四端一致）。下面是它的骨架（已精简，真实文件更完整）：

```vue
<route>
{
  "meta": { "title": "首页", "isTab": true }
}
</route>

<script setup lang="ts">
import { ref } from 'vue'

// 唯一动态状态：交互演示的计数（点击实时更新，四端一致）
const count = ref(0)
</script>

<template>
  <div class="page">
    <h1 class="hero-title">一次编写，多端运行</h1>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">5</div>
        <div class="stat-label">目标端</div>
      </div>
      <div class="stat">
        <div class="stat-value">1</div>
        <div class="stat-label">份源码</div>
      </div>
    </div>

    <button class="btn" @click="count++">点我 +1</button>
    <div class="counter">已点击 {{ count }} 次</div>
  </div>
</template>

<style>
.page { width: 100%; min-height: 100vh; background-color: #f5f6f8; padding: 20px 16px; }
.hero-title { display: block; font-size: 28px; font-weight: 800; color: #16181d; }
.stats { display: flex; flex-direction: row; gap: 12px; }
.stat { flex: 1; background-color: #ffffff; border-radius: 14px; padding: 16px; }
.btn { display: block; width: 100%; font-size: 16px; color: #ffffff; background-color: #4f46e5; border-radius: 12px; padding: 13px; }
</style>
```

> ★**跨端一致性写法**（对齐仓库 `css-conformance` 全端验收基准）：**用原始标签**（`div / h1 / p / button`，不依赖内置组件）+ **静态 class + 设计令牌**（`var(--x)` 指向 `global.css` 的 `:root`，App 端编译期展开为具体值）。避免 `:hover` / 伪类等 App 端尚不支持的写法；`inline-block` 等 Skyline 不接受的取值会被门禁拦下。跨页复用的基线样式放 `src/styles/global.css`（小程序走 `globalStyle`、Web 在 `main.ts` import、App 编译期折叠——一份文件四端同源）。
>
> ★**事件写法**（影响 App 端可交互性）：App 的事件编译**只支持内联动作**（`@click="count++"` / `@click="count = count + 1"` / `@click="show = !show"`），**不支持方法引用**（`@click="handleTap"`）——后者在 Web/小程序可用、但 App 端**不产出事件**（看得见、点不动）。起步模板统一用内联写法，多端一致。

## 四个部分，一套语义 → 各端产物

| SFC 部分 | Web 端产物 | 小程序端产物 |
|---|---|---|
| `<template>` | 直接渲染 DOM | WXML（标签映射 `div→view`、`h1/p→text`、`img→image`、`a→view` 等） |
| `<script setup>` | Vue 真实响应式直跑 | `Page()` 构造器；`ref` 读写重写为 `setData`（16ms 窗口批量合并） |
| `<style>` | 原样 CSS | WXSS（px→rpx 转换可配） |
| `<route>` 块 | Web 路由表 | `app.json` / `page.json` |

> 上表以 **Web / 小程序两类编译形态**为例说明一份 SFC 的各端去向；iOS / Android / 鸿蒙 / Flutter 等原生端不经过 WXML 这类中间形态——各渲染后端**直接消费同一份 SFC 的语义 IR**（见[渲染后端](/docs/framework/23-render-backend)），业务代码零改动。

## 三个要点

1. **业务代码零条件编译**：没有任何 `#ifdef`——标签映射、响应式重写、样式转换全部由编译器完成
2. **`<route>` 块可选**：`title` / `isTab` 等页面元信息就近声明；不写也能跑，路由由文件位置推导
3. **新建页面**：在 `src/pages/` 下添加 `.vue` 文件，重新 `npm run build:mp`，**所有目标端同时生效**——Web 直出 DOM、小程序出编译产物、原生/Flutter 渲染后端消费同一语义（业务代码不因目标端而分叉）

## 下一步

- [编译器配置与页面配置](/docs/10-config)：编译器配置与页面配置各管什么
- [语义模型](/docs/framework/11-semantic-model)：理解这套映射背后的 IR
