---
title: 测试与部署
order: 27
group: 架构与工程
---

# 测试与部署

> 一次编写，两端测试：状态断言跨端完全共用，DOM/WXML 各自断言。

## 测试分层

| 层 | 工具 | 验证什么 |
|---|---|---|
| 单元测试 | vitest | 纯逻辑（store/工具函数/编译器） |
| 组件双端挂载 | `@proteus-vue/test-core` | 同一份 SFC 在 Web 与小程序的行为一致 |
| E2E | `createDriver`（playwright / automator） | 真浏览器与真小程序的用户路径 |
| 一致性门禁 | test-ir / conformance | 语义树在六端渲染一致（见[一致性验证](/docs/framework/29-conformance)） |

## 双端挂载：@proteus-vue/test-core

核心思想：**同一份 SFC 源码，挂载到 Web（真实渲染）与小程序（逻辑层 + WXML 双断言），断言复用**。

```ts
// @vitest-environment happy-dom  ← 必须（esbuild TextEncoder instanceof 检查在 jsdom 跨 realm 崩）
import { describe, it, expect } from 'vitest'
import { mountComponent, stateOf, textOf, tap } from '@proteus-vue/test-core'

const COUNTER = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(1)
function increment() { count.value++ }
</script>
<template><view><text>{{ count }}</text><button @click="increment">+1</button></view></template>`
```

| API | 说明 |
|---|---|
| `mountComponent(sfc, { platform: 'web' \| 'mp' })` | 统一挂载：Web 走 @vue/test-utils 真实渲染；MP 走逻辑层归一化 host（instance 摊平 + WXML 顶层暴露） |
| `stateOf(host)` / `textOf(host)` | 统一断言：状态读取（Web setupState / MP data）、文本读取（Web wrapper.text() / MP wxml 规范化）——**06 铁律：状态跨端共用** |
| `tap(el, selector?)` | 统一事件分发（Web `trigger('click')` / MP automator `tap()`） |
| `mountMpComponent(sfc)` | MP 专项：真实编译 SFC → 执行逻辑层 → 返回 `{ instance, wxml, js, context }`，逻辑 + WXML 双断言 |
| `createMockContext(options?)` | 小程序测试的**唯一 wx 来源**：wx 全局 mock + 内存存储 + Page/Component 捕获；`afterEach` 调 `cleanup()` |
| `createDriver({ platform })` | E2E 统一 API：web（playwright + 可选 CDP）/ mp（automator + 可选 debugger）同一套能力接口 |

### 环境约定

- Web 挂载用例文件头必须 `// @vitest-environment happy-dom`（esbuild 的 TextEncoder instanceof 检查在 jsdom 跨 realm 下崩溃）
- 需要 localStorage/history 的用例可用 `@vitest-environment jsdom`

## 运行测试

```bash
npm test                # 全量单测（排除 e2e）
npm run test:e2e:web    # 先构建 Web 再跑浏览器 E2E
npm run verify          # 测试 + 双端构建 + 全 workspace 构建 + 包健康检查
```

## 构建产物

```bash
npm run build:web       # → dist/web/（标准 Vite SPA）
npm run build:mp        # → dist/mp-weixin/（微信小程序产物）
```

| 产物 | 部署方式 |
|---|---|
| `dist/web/` | 任意静态托管（nginx / OSS / CDN），`npm run preview:web` 本地预览 |
| `dist/mp-weixin/` | 微信开发者工具「导入项目」指向此目录；真机预览 → 上传 → 提审，走微信标准流程 |

## 部署前自检清单

- [ ] `npm run verify` 全绿（测试 + 双端构建 + 包健康）
- [ ] 小程序基础库 ≥ 2.29.2（Skyline 渲染）
- [ ] 能力声明与目标端匹配（见[能力系统](/docs/18-capability-system)）

## 下一步

- [一致性验证](/docs/framework/29-conformance) —— 六端渲染一致的机器门禁
- [CLI 与工程命令](/docs/28-cli) —— 命令全景
- [状态管理](/docs/15-state-management) —— store 的跨端测试姿势
