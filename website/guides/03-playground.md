---
title: 体验 Playground
order: 3
group: 起步
---

# 体验 Playground

不想先装环境？打开 [Playground](/playground)，在浏览器里实时体验 Proteus 的编译过程——左边写一份标准 Vue SFC，右边同屏看到它**在双端分别变成了什么**。

## 用这个最小例子

把下面内容粘贴进左侧编辑器：

```vue
<template>
  <div class="hello">
    <h1>Hello Proteus</h1>
    <button @click="count++">tapped {{ count }} times</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<style>
.hello { text-align: center; }
</style>
```

## 看五个 Tab

| Tab | 你看到的是什么 |
|---|---|
| **Skyline** | 小程序端产物预览 |
| **IR** | 编译器产出的 Compiler IR——语义树（只含 p-* 语义节点）+ 渲染树 |
| **Web** | Web 端结果：这份 SFC 就是标准 Vue 组件，零转换 |
| **WXSS** | 样式转换结果（px→rpx） |
| **Trace** | 编译器触发的每条规则决策（规则 ID + 行号 + before/after） |

## 两个值得注意的现象

1. **Web Tab 和你写的一模一样**——Web 端零转换，这就是「标准 SFC 直跑」
2. **Trace Tab 有决策链**——每条编译规则可解释、可反查（`npx proteus explain` 在本地工程里做同样的事）

## 下一步

- [创建你的第一个工程](/docs/05-create-project)：从浏览器走到本地双端工程
- [语义模型](/docs/11-semantic-model)：看懂 IR Tab 里的语义树
