# TestDriver 统一测试 API（全部能力接口）

> 包：`@proteus-vue/test-core/driver`。一套能力接口 → web（Playwright）/ mp（automator）/ app（预留）。
> 完整 API 参考：`docs/proteus-test-framework-plan/13-test-driver-api.md`（签名/参数/双端行为逐方法）。

## 入口

```ts
import { createDriver } from '@proteus-vue/test-core/driver'
import type { TestDriver, MpDebuggerLike } from '@proteus-vue/test-core/driver'

const web = createDriver({ platform: 'web', page })              // playwright Page
const mp = createDriver({ platform: 'mp', mini })                // automator miniProgram
const mpDebug = createDriver({ platform: 'mp', mini, debugger }) // + wechatide debugger 句柄（console/network）
const webCdp = createDriver({ platform: 'web', page, cdp })     // + CDP 会话（context.newCDPSession）
```

**注入句柄 + 结构类型**：不依赖 playwright/automator 包，形状兼容即用。句柄由用户/CLI 装配。

## TestDriver 方法（导航/运行时/元素/执行/截图/等待）

| 方法 | 说明 |
|------|------|
| `platform` | `'web' \| 'mp'` |
| `close()` | 解绑（mp: disconnect；web: 浏览器句柄用户管） |
| `navigate(url)` / `reLaunch(url)` / `back()` | 导航（mp: reLaunch 最稳通道；back 用 wx.navigateBack 降级） |
| `currentPage()` / `systemInfo()` | 页面/运行时快照（断言稳通道） |
| `element(selector, opts?)` | 惰性元素（web locator 重查 / mp 每次重新解析） |
| `evaluate(fn, ...args)` | 受控表达式（★mp 必须传**函数**，传字符串运行时无响应挂起） |
| `screenshot(path?)` | 截图（mp 受模拟器激活态影响，可能挂起——3s 有界） |
| `waitFor(ms)` | 固定等待 |

## TestElement（element(selector) 返回值）

| 方法 | 说明 |
|------|------|
| `tap()` / `input(text)` / `longPress(ms?)` | 交互 |
| `text()` / `value()` / `attribute(name)` | 读取 |
| `waitFor({ timeout?, state? })` | 等待 attached/visible/detached |
| `exists()` | 存在性 |

## debug 能力域

| 方法 | 说明 |
|------|------|
| `consoleLogs(filter?)` / `networkRequests(filter?)` | web: 事件收集（开箱即用）；mp: 需注入 debugger 句柄 |
| `clearCache()` / `refresh()` | web: localStorage 清理 / reload；mp: 需注入 debugger 句柄 |
| `cdp.send(method, params)` / `cdp.on(event, handler)` | web CDP 域命令透传（性能/网络节流/DOM）；mp 降级抛错 |
| `wxApi.call/mock/restore(method, ...)` | 小程序独有（automator 原生）；web 降级抛错 |
| `ticket.set/get/refresh/testAccounts()` | 小程序独有（登录凭据/测试号）；web 降级抛错 |

## 组件层统一挂载（L3）

```ts
// tests/*.test.ts —— 文件头 // @vitest-environment happy-dom
import { mountComponent, stateOf, textOf, tap } from '@proteus-vue/test-core'

const SFC = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(1)
function increment() { count.value++ }
</script>
<template><view><text>{{ count }}</text><button @click="increment">+1</button></view></template>`

const host = await mountComponent(SFC, { platform: 'web' | 'mp' })
expect(stateOf(host).count).toBe(1)   // 统一状态（web: vm.$.setupState / mp: data）
// web 文本断言前 await host.vm.$nextTick()（渲染微任务队列）
```

- `mountMpComponent(sfc)`：MP 逻辑层 + WXML 双断言（`{ instance, wxml, js, context, config }`）
- `createMockContext()`：唯一 wx 来源（storage/router/ui 内存实现 + 构造器捕获）
