---
title: 快速开始
---

# 快速开始

Proteus 是**渲染引擎无关**的跨端框架：用统一语义模型描述 UI，通过可插拔渲染后端自由接入 Vue DOM、Flutter、原生 UIKit/Jetpack/ArkUI。

## 安装

```bash
npm create @proteus-vue/proteus my-app
```

## 第一个页面

```vue
<template>
  <p-page title="首页">
    <p-stack gap="md">
      <p-text content="Hello Proteus" />
      <p-button variant="primary" label="开始" />
    </p-stack>
  </p-page>
</template>
```

## 核心概念

- **语义原语**：`p-*` 组件是唯一的 UI 词汇表
- **渲染后端**：同一份代码跑 Web/小程序/原生（换一个 flag）
- **文档引擎**：本页即由 `@proteus-vue/docs` 编译渲染

> 提示：官网本身就是用 Proteus 构建的——你现在看到的每一个标题、代码块都是框架的编译产物。
