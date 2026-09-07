---
title: 页面构成
order: 9
group: 代码构成
---

# 页面构成

一个页面就是一个**标准 Vue SFC**（`.vue` 文件），最多四个部分：`<template>`、`<script setup>`、`<style>` 和 Proteus 特有的 `<route>` 块。

脚手架自带的 `src/pages/index.vue` 完整可用：

```vue
<route>
{
  "meta": {
    "title": "首页",
    "isTab": true
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)

function handleTap() {
  count.value++
}
</script>

<template>
  <div class="home">
    <h1>Hello Proteus</h1>
    <p class="tapped-count">tapped {{ count }} times</p>
    <button @click="handleTap">tap</button>
  </div>
</template>

<style>
.home {
  text-align: center;
  padding: 48px 0;
}
</style>
```

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

- [全局配置与页面配置](/docs/10-config)：两层配置各管什么
- [语义模型](/docs/framework/11-semantic-model)：理解这套映射背后的 IR
