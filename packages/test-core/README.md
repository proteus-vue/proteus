# @proteus-vue/test-core

Proteus 测试核心（test-framework M3 + B7 + 统一测试 API）——L1-L3 标准件。

## 能力

| API | 说明 |
|-----|------|
| `createMockContext(options?)` | **唯一 wx 来源**：wx 全局 mock（storage/router/ui 内存实现 + vi.fn 可断言）+ Page/Component/App 构造器捕获 + getApp/getCurrentPages + 内存存储。`afterEach` 调 `cleanup()` 恢复全局 |
| `mountMpComponent(sfc, options?)` | SFC → 真实编译（`compileVueSfc`）→ 执行逻辑层 JS → 返回 `{ instance, wxml, js, context, config }`——**逻辑 + WXML 双断言**（不真实渲染，真机行为下沉 L4）；★方法已摊平（组件 methods + 页面顶层函数绑定实例），setData 合并进 data（真实语义） |
| `mountComponent(sfc, { platform: 'web' \| 'mp' })` | **统一挂载**：同一份 SFC → Web（@vue/test-utils 真实渲染，需 happy-dom 环境）或 MP（逻辑层归一化 host：instance 摊平 + wxml 顶层暴露）——配合 `stateOf`/`textOf`/`tap` 跨端复用同一份断言 |
| `createDriver({ platform: 'web' \| 'mp', page/mini, cdp?/debugger? })` | **统一测试 API（E2E 层）**：一套 `TestDriver` 能力接口 → web（注入 playwright Page + 可选 CDP 会话）/ mp（注入 automator miniProgram + 可选 wechatide debugger 句柄）/ app（预留）；零硬依赖（结构类型 + 注入句柄）；**全部能力 API 说明见下方「统一测试 API（E2E 层）完整能力清单」** |
| `mountWebComponent(sfc)` / `sfcToComponent(sfc)` | Web 分支底层：SFC → 组件对象（compileScript + compileTemplate 双段编译 + esbuild 剥离 TS + __VUE__ 注入执行）→ mount |
| `stateOf(host)` / `textOf(host)` | **统一断言**：状态读取（Web `vm.$.setupState`+`$data` / MP `data` 快照）与文本读取（Web `wrapper.text()` / MP wxml 规范化）——06 铁律：状态跨端完全共用、DOM 各自断言 |
| `tap(el, selector?)` / `isWebElement` / `isMpElement` | 统一事件分发（Web `trigger('click')` / 小程序 automator `tap()`）+ 类型守卫 |

## 使用

### MP 逻辑 + WXML 双断言

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createMockContext, mountMpComponent } from '@proteus-vue/test-core'

describe('p-button 逻辑 + WXML', () => {
  let ctx: ReturnType<typeof createMockContext>
  afterEach(() => ctx?.cleanup())

  it('渲染 + disabled 态', () => {
    const { instance, wxml, context } = mountMpComponent(`
      <template><button class="p-btn" :disabled="disabled">{{ label }}</button></template>
      <script setup>
      import { ref } from 'vue'
      const disabled = ref(true)
      const label = '确认'
      </script>
    `)
    expect(wxml).toContain('button') // 结构断言
    expect(instance.data).toHaveProperty('disabled', true) // 逻辑断言
    // wx 断言（唯一来源）
    context.wx.storage.setStorageSync('k', 1)
    expect(context.wx.storage.getStorageSync('k')).toBe(1)
  })
})
```

### 统一测试 API：同一份 SFC 双端挂载 + 跨端复用断言

```ts
// @vitest-environment happy-dom  ← 必须（esbuild TextEncoder instanceof 检查在 jsdom 跨 realm 崩）
import { describe, it, expect } from 'vitest'
import { mountComponent, stateOf, textOf, tap } from '@proteus-vue/test-core'

const COUNTER = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(1)
const label = 'counter'
function increment() { count.value++ }
</script>
<template><view><text>{{ label }}: {{ count }}</text><button @click="increment">+1</button></view></template>`

describe('双端同一断言', () => {
  it('状态断言只写一份（06 分层断言）', async () => {
    const web = await mountComponent(COUNTER, { platform: 'web' })
    const mp = await mountComponent(COUNTER, { platform: 'mp' })
    for (const host of [web, mp]) {
      expect(stateOf(host).count).toBe(1)
      ;(host as any).vm?.increment?.() ?? (host as any).increment()
      expect(stateOf(host).count).toBe(2)
    }
  })
})
```

★Web 分支注意：increment 后同步读 `stateOf` 已变（ref 同步），但渲染更新在微任务队列——文本断言前需 `await host.vm.$nextTick()`。

### 统一测试 API（E2E 层）完整能力清单

> 子路径：`@proteus-vue/test-core/driver`。能力域来源：微信开发者工具官方 skill（wechatide-skill）automator 场景的「意图→工具」表——确定性 UI 操作抽象为跨端一致接口。★MP 经验内化：元素每次操作重新解析（导航后失效重查）、`reLaunch` 全链路最稳通道（05 真机实测）。

**入口工厂**

| 函数 | 签名 | 说明 |
|---|---|---|
| `createDriver` | `(options: { platform: 'web'; page } \| { platform: 'mp'; mini }) => TestDriver` | 统一入口（按 platform 分发） |
| `createWebDriver` | `(page: PlaywrightPageLike) => TestDriver` | Web 实现（playwright 适配：goto/locator/evaluate/screenshot） |
| `createMpDriver` | `(mini: AutomatorMiniLike) => TestDriver` | MP 实现（automator 适配：reLaunch/currentPage()/$/systemInfo/evaluate/screenshot） |

**TestDriver 全部方法**

| 方法 | 签名 | Web 行为 | MP 行为 |
|---|---|---|---|
| `platform` | `readonly 'web' \| 'mp'` | — | — |
| `close()` | `Promise<void>` | 空操作（浏览器句柄用户管） | `mini.disconnect()` |
| `navigate(url)` | `Promise<void>` | `page.goto(url)` | `mini.reLaunch(url)`（★最稳通道） |
| `reLaunch(url)` | `Promise<void>` | `page.goto(url)` | `mini.reLaunch(url)` |
| `back()` | `Promise<void>` | `page.goBack()` | `wx.navigateBack`（evaluate 降级） |
| `currentPage()` | `Promise<PageSnapshot>` | `{ path: URL pathname, url }` | `{ path: page route, url: '' }` |
| `systemInfo()` | `Promise<SystemSnapshot>` | `{ platform: 'web', version: UA 截断 }` | automator systemInfo（platform/SDKVersion + 透传） |
| `element(selector, options?)` | `TestElement` | `page.locator`（惰性重查） | `currentPage().$()`（每次重新解析） |
| `evaluate(fn, ...args)` | `Promise<T>` | `page.evaluate` | `mini.evaluate` |
| `screenshot(path?)` | `Promise<string>`（本地路径） | `page.screenshot({ path })`；无 path 返回 '' | `mini.screenshot({ path }).path` |
| `waitFor(ms)` | `Promise<void>` | `page.waitForTimeout(ms)` | evaluate 函数（★传函数，字符串挂起） |
| `consoleLogs(filter?)` | `Promise<ConsoleEntry[]>` | console/pageerror 事件收集 | wechatide get_simulator_console（注入 debugger 句柄） |
| `networkRequests(filter?)` | `Promise<NetworkEntry[]>` | request/response 事件收集 | wechatide get_simulator_network（注入 debugger 句柄） |
| `clearCache()` | `Promise<void>` | localStorage/sessionStorage 清理 | wechatide debug_clear_cache（注入 debugger 句柄） |
| `refresh()` | `Promise<void>` | `page.reload()` | wechatide simulator_refresh（注入 debugger 句柄） |
| `wxApi` 子域 | `call/mock/restore` | ❌ 降级抛错（业务已收口 platformAPI） | automator callWxMethod/mockWxMethod/restoreWxMethod |
| `ticket` 子域 | `set/get/refresh/testAccounts` | ❌ 降级抛错（web 无对等） | automator setTicket/getTicket/refreshTicket/testAccounts |
| `cdp` 子域 | `send/on`（任意 CDP 域命令透传） | 注入 CDP session（context.newCDPSession）——性能/网络/DOM 域 | ❌ 降级抛错（无 CDP） |

**TestElement 全部方法**（`driver.element(selector)` 返回值）

| 方法 | 签名 | Web 行为 | MP 行为 |
|---|---|---|---|
| `tap(options?)` | `Promise<void>` | `locator.click()` | `element.tap()` |
| `input(text, options?)` | `Promise<void>` | `locator.fill(text)` | `element.input(text)` |
| `longPress(durationMs?)` | `Promise<void>` | hover + mousedown + 延时 + mouseup（近似模拟） | `element.longPress(durationMs)`（原生） |
| `text(options?)` | `Promise<string>` | `locator.textContent()`（null→''） | `element.text()` |
| `value(options?)` | `Promise<string>` | `locator.inputValue()` | `element.value()` |
| `attribute(name)` | `Promise<string \| null>` | `locator.getAttribute(name)` | 原生 attribute 或 MVP null |
| `waitFor(options?)` | `Promise<void>` | `locator.waitFor({ state, timeout })` | 轮询解析（attached/visible）或轮询消失（detached） |
| `exists(options?)` | `Promise<boolean>` | `locator.count() > 0` | `currentPage().$()` 解析成功 |

**类型**：`PageSnapshot { path, url }` · `SystemSnapshot { platform, version?, ... }` · `ElementWaitState 'attached' \| 'visible' \| 'detached'` · `ElementWaitOptions { timeout?, state? }` · `TestElementOptions { timeout? }`（缺省 5000ms）· 注入句柄结构类型 `PlaywrightPageLike`/`PlaywrightLocatorLike`/`AutomatorMiniLike`/`AutomatorElementLike`（形状兼容即用，零依赖）。

### 统一测试 API（E2E 层）完整跨端用例

```ts
// ★注入句柄：playwright page / automator miniProgram 由用户或 CLI（proteus test e2e:mp）装配
import { createDriver } from '@proteus-vue/test-core/driver'
import type { TestDriver } from '@proteus-vue/test-core/driver'

// 跨端业务用例：只碰统一能力接口（不写 page./mini. 平台 API）
async function runShared(driver: TestDriver): Promise<void> {
  await driver.reLaunch('/pages/index')
  const btn = driver.element('button')
  await btn.waitFor()
  await btn.tap()
  expect((await driver.currentPage()).path).toContain('pages/index')
  expect((await driver.systemInfo()).platform).toBeTruthy()
  await driver.screenshot()
}

const web = createDriver({ platform: 'web', page })   // playwright Page
const mp = createDriver({ platform: 'mp', mini })     // automator miniProgram
await runShared(web)
await runShared(mp)
```

★能力域对照 wechatide-skill automator（完整 API 逐方法说明见 docs/proteus-test-framework-plan/13-test-driver-api.md）：`automation_navigate → navigate/reLaunch/back`、`automation_runtime_info → currentPage/systemInfo`、`automation_element_action → element(tap/input/longPress/text/value)`、`automation_evaluate → evaluate`、`simulator_screenshot → screenshot`、`waitForSelector/wait → waitFor`。★MP 经验内化：元素每次操作重新解析（导航后失效重查）、reLaunch 是全链路最稳通道。

## 铁律（03-component-integration.md + 06-cross-platform-assert.md）

- 测试环境只 mock wx，禁止真实引用
- 小程序用例只校验"逻辑 + WXML"，不校验视觉样式
- `createMockContext` 是唯一 wx 来源
- 跨端用例只碰逻辑/状态/语义，DOM 差异各自断言（06 铁律）
