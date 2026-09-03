---
title: 快速开始
order: 2
---

# 快速开始

## 环境要求

- Node.js ≥ 18
- 微信开发者工具（小程序端调试，基础库 ≥ 2.29.2 启用 Skyline）

## 创建工程

```bash
npm create @proteus-vue/proteus my-app
cd my-app
npm install
```

## 启动双端

```bash
# Web 端（浏览器打开 Vite 提示的地址）
npm run dev:web

# 小程序端（构建后导入微信开发者工具）
npm run build:mp
```

- Web 产物：`dist/web/`（标准 Vite SPA，`npm run preview:web` 预览）
- 小程序产物：`dist/mp-weixin/`（微信开发者工具「导入项目」指向此目录）

## 第一个页面

```vue
<route>
{ "meta": { "title": "首页", "isTab": true } }
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
    <p>tapped {{ count }} times</p>
    <button @click="handleTap">tap</button>
  </div>
</template>

<style>
.home { text-align: center; padding: 48px 0; }
</style>
```

标准写法，无平台 DSL。同一份源码：Web 端由渲染后端直出 Vue DOM；小程序端由编译器转为 WXML + WXSS + `Page()` JS；将来接入 Native / Flutter 后端，这份代码一行不改。

## 切换编译器后端

```ts
// proteus.config.ts
export default {
  compiler: { backend: 'rust' }, // 'node'（默认）| 'rust'
}
```

Node / Rust 双端对同一 SFC 产出语义等价的 CompilerIR（81 用例 Golden 门禁）。

## 下一步

- [语义模型](/docs/semantic-model)
- [渲染后端](/docs/render-backend)
