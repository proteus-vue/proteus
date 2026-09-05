---
title: 开发一个 p-* 组件
order: 22
group: 自定义组件
---

# 开发一个 p-* 组件

从零写一个语义组件的完整流程——以最小可用的 `p-badge` 为例。

## 1. 目录与命名

```
src/components/p-badge/index.vue   ← 每组件一个目录，index.vue 为入口
```

命名铁律 G-31.1：`p-` 前缀 + 语义名（badge 表达「徽标意图」），禁止 `p-div` 这类结构命名，禁止与 HTML/小程序标签同名。

## 2. 组件本体

```vue
<!-- src/components/p-badge/index.vue -->
<template>
  <view class="p-badge" :class="['p-badge--' + tone]">
    <slot />
  </view>
</template>

<script setup lang="ts">
// ★对象形式 defineProps（编译器静态提取）；BaseProps 契约逐字面量落地
defineProps({
  pid: { type: String, default: '' },          // BaseProps：跨端唯一标识
  disabled: { type: Boolean, default: false }, // BaseProps
  ariaLabel: { type: String, default: '' },    // BaseProps
  tone: { type: String, default: 'brand' },    // 业务 prop（对象形式才能被静态提取）
})
</script>

<style scoped>
.p-badge { display: inline-flex; }
</style>
```

**MP 编译安全纪律**（对应编译器 MVP 限制）：

- 函数体内不用 `as` 断言与箭头参数标注——回调提为函数声明
- computed 用箭头简写 + 表达式体
- 非空断言 `x!` 改 `x ?? 兜底`

## 3. 聚合导出

`src/components/index.ts` 追加：

```ts
import PBadge from './p-badge/index.vue'
export { PBadge }
```

## 4. 审计与语义登记

```bash
npx proteus components:audit src/components   # 平台 API / 同步存储 / 清单完整性
```

- 平台 API 红线：组件内禁止 `document.*` / `window.*` / `wx.*` 直调
- 语义登记：`TAG_SEMANTIC_MAP` 追加 `p-badge → ui.badge`（语义枚举无对应值时先扩枚举，不臆造）

## 5. 验证

- Web：页面 `<p-badge>新</p-badge>` 渲染
- MP：`npm run build:mp` 后 `proteus/p-badge/index` 四件套产出 + usingComponents 自动写入

## 下一步

- [组件单元测试](/docs/framework/components-test)
