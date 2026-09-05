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

## 四个部分，两端产物

| SFC 部分 | Web 端产物 | 小程序端产物 |
|---|---|---|
| `<template>` | 直接渲染 DOM | WXML（标签映射 `div→view`、`h1/p→text`、`img→image`、`a→view` 等） |
| `<script setup>` | Vue 真实响应式直跑 | `Page()` 构造器；`ref` 读写重写为 `setData`（16ms 窗口批量合并） |
| `<style>` | 原样 CSS | WXSS（px→rpx 转换可配） |
| `<route>` 块 | Web 路由表 | `app.json` / `page.json` |

## 三个要点

1. **业务代码零条件编译**：没有任何 `#ifdef`——标签映射、响应式重写、样式转换全部由编译器完成
2. **`<route>` 块可选**：`title` / `isTab` 等页面元信息就近声明；不写也能跑，路由由文件位置推导
3. **新建页面**：在 `src/pages/` 下添加 `.vue` 文件，重新 `npm run build:mp`，Web 与小程序两端同时生效

## 下一步

- [全局配置与页面配置](/docs/10-config)：两层配置各管什么
- [语义模型](/docs/11-semantic-model)：理解这套映射背后的 IR
