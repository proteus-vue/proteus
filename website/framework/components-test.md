---
title: 组件单元测试
order: 23
group: 自定义组件
---

# 组件单元测试

用 `@proteus-vue/test-core` 做双端挂载断言：**同一份 SFC 源码**挂到 Web（真实渲染）与小程序（逻辑层 + WXML），断言复用（铁律 G-44.6：状态跨端共用）。

## 双端挂载

```ts
// @vitest-environment happy-dom  ← Web 挂载必须（esbuild TextEncoder 跨 realm 限制）
import { describe, it, expect } from 'vitest'
import { mountComponent, stateOf, tap } from '@proteus-vue/test-core'

const BADGE = `<script setup lang="ts">
defineProps({ tone: { type: String, default: 'brand' } })
</script>
<template><view class="p-badge">{{ tone }}</view></template>`

describe('p-badge', () => {
  it('双端渲染一致', async () => {
    const run = async (host: unknown) => {
      expect(stateOf(host as never)).toMatchObject({ tone: 'brand' })
    }
    await run(await mountComponent(BADGE, { platform: 'web' }))
    await run(await mountComponent(BADGE, { platform: 'mp' }))
  })

  it('事件统一分发', async () => {
    const host = await mountComponent(BADGE, { platform: 'web' })
    // tap / stateOf / textOf 是统一断言面（Web wrapper / MP data+WXML 双通道）
  })
})
```

## 统一 API 面

| API | 说明 |
|---|---|
| `mountComponent(sfc, { platform })` | 统一挂载：Web 走 @vue/test-utils 真实渲染；MP 走编译 → 逻辑层实例 + WXML |
| `stateOf(host)` / `textOf(host)` | 状态/文本统一读取（Web setupState / MP data 与规范化 WXML） |
| `tap(el, selector?)` | 统一事件分发（Web trigger / MP automator） |
| `mountMpComponent(sfc)` | MP 专项：真实编译 + 逻辑层实例 + WXML 双断言 |
| `createMockContext()` | 小程序测试唯一 wx 来源（wx mock + 内存存储 + Page/Component 捕获） |

## 环境约定

- Web 挂载用例文件头必须 `// @vitest-environment happy-dom`
- MP 挂载无需浏览器——逻辑层 + WXML 断言在 Node 直跑

## 下一步

- [第三方组件分发](/docs/framework/components-distribution)
