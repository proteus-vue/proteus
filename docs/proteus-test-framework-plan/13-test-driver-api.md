# 统一测试 API 参考（TestDriver）

> **定位**：E2E 层（L4）多端自动化能力接口——**一套能力接口，多端实现**（Web Playwright / 小程序 automator / App 预留）。
> **包**：`@proteus-vue/test-core/driver`（实现 `packages/test-core/src/driver/`）
> **能力域来源**：微信开发者工具官方 skill（wechatide-skill）automator 场景的「意图→工具」表——把官方工具的确定性 UI 操作能力抽象为跨端一致接口。
> **分层衔接**：组件层统一挂载（§03b `mountComponent`/`stateOf`/`textOf`）管「组件状态」；driver 管「整页交互」——组件用例用 mountComponent，E2E 用例用 TestDriver。

---

## 1. 能力域总览

| 能力域 | 统一接口 | Web 实现 | 小程序实现 | App（预留） |
|---|---|---|---|---|
| 生命周期 | `close()` | 空操作（浏览器句柄用户管） | `mini.disconnect()` | — |
| 导航 | `navigate(url)` / `reLaunch(url)` / `back()` | `page.goto` / `page.goBack` | `mini.reLaunch` / `wx.navigateBack`（evaluate 降级） | — |
| 运行时信息 | `currentPage()` / `systemInfo()` | URL pathname / navigator 注入 | `mini.currentPage` / `mini.systemInfo` | — |
| 元素查找 | `element(selector)` | `page.locator`（惰性重查） | `currentPage().$()`（每次重新解析） | — |
| 元素交互 | `TestElement.tap/input/longPress/text/value/attribute` | locator click/fill/… | automator element tap/input/… | — |
| 等待 | `TestElement.waitFor()` / `driver.waitFor(ms)` | locator.waitFor / waitForTimeout | 轮询解析 / evaluate setTimeout | — |
| 执行表达式 | `evaluate(fn, ...args)` | `page.evaluate` | `mini.evaluate` | — |
| 截图 | `screenshot(path?)` | `page.screenshot` | `mini.screenshot` | — |
| 控制台日志 | `consoleLogs(filter?)` | page console/pageerror 事件收集 | wechatide `get_simulator_console`（注入 debugger 句柄） | — |
| 网络请求 | `networkRequests(filter?)` | page request/response 事件收集 | wechatide `get_simulator_network`（注入 debugger 句柄） | — |
| 清缓存 | `clearCache()` | localStorage/sessionStorage 清理 | wechatide `debug_clear_cache`（注入 debugger 句柄） | — |
| 刷新 | `refresh()` | `page.reload` | wechatide `simulator_refresh`（注入 debugger 句柄） | — |
| wx API（小程序独有） | `driver.wxApi.call/mock/restore` | ❌ 降级抛错（业务已收口 platformAPI） | automator `callWxMethod/mockWxMethod/restoreWxMethod` | — |
| 登录凭据（小程序独有） | `driver.ticket.set/get/refresh/testAccounts` | ❌ 降级抛错（web 无对等） | automator `setTicket/getTicket/refreshTicket/testAccounts` | — |
| CDP 底层会话 | `driver.cdp.send/on` | 注入 CDP session（`createWebDriver(page, cdp)`：Playwright `context.newCDPSession`）——性能/网络/DOM 域命令透传 | ❌ 降级抛错（无 CDP——原生 WXML 非 Chromium） | — |

**设计要点**：
- **注入句柄 + 结构类型**：driver 不直接依赖 playwright / miniprogram-automator 包，用户把已装配的句柄（playwright `Page` / automator `miniProgram`）传给工厂函数；句柄形状用最小结构类型声明（§6），形状兼容即用。
- **MP 经验内化**（真机实测，§05）：`Page.getData`/`getElement` 受模拟器激活态影响 → 断言走 `reLaunch`/`currentPage`/`systemInfo`/`evaluate` 稳定通道；元素操作每次重新解析（不缓存，导航后自动失效重查）；`reLaunch` 是全链路最稳导航。

---

## 2. 入口工厂

### `createDriver(options): TestDriver`
统一入口（对齐 `mountComponent` 的统一挂载模式）。按 `platform` 分发到各端工厂。

```ts
// web：注入 playwright Page
const driver = createDriver({ platform: 'web', page })
// mp：注入 automator miniProgram（launch/connect 由 CLI `proteus test e2e:mp` 或用户装配）
//     + 可选 debugger 句柄（wechatide 工具能力：console/network/clearCache/refresh）
const driver = createDriver({ platform: 'mp', mini, debugger: wechatIdeHandle })
```

### `createWebDriver(page: PlaywrightPageLike): TestDriver`
Web 端实现（playwright 适配）。句柄形状见 §6.1。

### `createMpDriver(mini: AutomatorMiniLike, debugger?: MpDebuggerLike): TestDriver`
小程序端实现（automator 适配）。句柄形状见 §6.2；debugger 句柄（§6.5）提供 console/network/clearCache/refresh（wechatide 工具能力）。

---

## 3. TestDriver 接口（全部方法）

### `platform: 'web' | 'mp'`
只读属性，当前驱动端。用于用例内按端分支（06 铁律：仅 DOM 各自断言时使用，状态断言不要分支）。

### `close(): Promise<void>`
解绑/断开。
- **web**：空操作——浏览器实例生命周期由用户句柄管理（launch/close 不进 driver）。
- **mp**：`mini.disconnect()`。

### `navigate(url: string): Promise<void>`
导航到页面（`automation_navigate`）。
- **web**：`page.goto(url)`。
- **mp**：`mini.reLaunch(url)`——★reLaunch 重置页面栈，不依赖模拟器激活态，全链路最稳（05 经验）。
- 语义收敛：两端都把「测试起始场景」定义为重置到指定页。

### `reLaunch(url: string): Promise<void>`
重置到指定页（reLaunch 语义，两端一致）。
- **web**：`page.goto(url)`。
- **mp**：`mini.reLaunch(url)`。

### `back(): Promise<void>`
返回上一页。
- **web**：`page.goBack()`。
- **mp**：automator 无 miniProgram 级 navigateBack → `evaluate('() => wx.navigateBack({})')` 降级（栈空时静默失败，不做断言）。

### `currentPage(): Promise<PageSnapshot>`
当前页面快照（`automation_runtime_info`）。

```ts
interface PageSnapshot {
  path: string   // web: URL pathname（http://host/pages/index → /pages/index）；mp: 页面 route（pages/index）
  url: string    // web: 完整 URL；mp: 无此概念，空串
}
```

### `systemInfo(): Promise<SystemSnapshot>`
运行时信息。

```ts
interface SystemSnapshot {
  platform: string            // web: 'web'；mp: automator systemInfo().platform（devtools/ios/android/…）
  version?: string            // web: userAgent 截断；mp: SDKVersion
  [key: string]: unknown      // 其余字段透传（mp 的完整 systemInfo）
}
```

### `element(selector: string, options?: TestElementOptions): TestElement`
查找元素（`querySelectorAll` → 惰性元素，不真实查询；操作时才对当前页面查询）。

```ts
interface TestElementOptions {
  timeout?: number   // 单次元素操作超时 ms，缺省 5000
}
```

- **web**：`page.locator(selector)`——Playwright locator 惰性查询（每次操作重查当前 DOM）。
- **mp**：`currentPage().$(selector)`——**每次操作重新解析**（页面实例随导航变化，旧引用自动失效）。

### `evaluate<T = unknown>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>`
执行受控表达式（`automation_evaluate`）。
- **web**：`page.evaluate(fn, ...args)`。
- **mp**：`mini.evaluate(fn, ...args)`。
- `fn` 支持函数或源码字符串（`'() => wx.getSystemInfoSync()'`）。

### `screenshot(path?: string): Promise<string>`
截图（`simulator_screenshot`），返回本地图片路径。
- **web**：`page.screenshot({ path })`；不传 path 返回空串（web 截图常由用户管理输出）。
- **mp**：`mini.screenshot({ path })` → 返回 `result.path`。

### `waitFor(ms: number): Promise<void>`
固定等待（`wait`）。用于确定性时序（如渲染动画）。
- **web**：`page.waitForTimeout(ms)`。
- **mp**：`evaluate((delay) => new Promise(...), ms)`（★必须传函数——automator 内部 `fn.toString()` 序列化，传字符串运行时无响应挂起）。

### `consoleLogs(filter?: string): Promise<ConsoleEntry[]>`
控制台日志（`get_simulator_console`）。`filter` 为子串过滤。

```ts
interface ConsoleEntry {
  level?: 'log' | 'info' | 'warn' | 'error' | 'debug'  // web 真实级别；mp grep 行首 [level] 猜测
  text: string
}
```

- **web**：`page.on('console'/'pageerror')` 事件缓冲收集（页面加载前的事件也记录）；`page.on` 未注入时返回空数组。
- **mp**：wechatide `get_simulator_console`（注入 debugger 句柄，§6.5）；未注入抛错提示。

### `networkRequests(filter?: string): Promise<NetworkEntry[]>`
网络请求（`get_simulator_network`）。

```ts
interface NetworkEntry {
  url: string
  method?: string
  status?: number
  text: string  // mp 为 grep 命中行原文
}
```

- **web**：`page.on('request'/'response')` 事件收集（response 回填 status）。
- **mp**：wechatide `get_simulator_network`（注入 debugger 句柄）；未注入抛错提示。

### `clearCache(): Promise<void>`
清缓存（`debug_clear_cache`）。
- **web**：`localStorage.clear() + sessionStorage.clear()`（cookies 由用户 context 管理）。
- **mp**：wechatide `debug_clear_cache`（注入 debugger 句柄）；未注入抛错提示。

### `refresh(): Promise<void>`
刷新（`simulator_refresh`）。
- **web**：`page.reload()`。
- **mp**：wechatide `simulator_refresh`（注入 debugger 句柄）；未注入抛错提示。

### `wxApi: WxApiHandle`（小程序独有能力）
wx API 调用/mock/恢复（`automation_wx_api`）。**web 端降级抛错**（业务已收口 platformAPI，web 无 wx 运行时对等）。

```ts
interface WxApiHandle {
  call<T>(method: string, args?: Record<string, unknown>): Promise<T>     // automator callWxMethod
  mock<T>(method: string, impl: ((...args: any[]) => T) | T): Promise<void> // automator mockWxMethod
  restore(method: string): Promise<void>                                  // automator restoreWxMethod
}
```

### `ticket: TicketHandle`（小程序独有能力）
登录凭据/测试号（`automation_testaccount`）。**web 端降级抛错**（web 无登录凭据对等）。

```ts
interface TicketHandle {
  set(ticket: string): Promise<void>       // automator setTicket
  get(): Promise<string>                   // automator getTicket
  refresh(): Promise<void>                 // automator refreshTicket
  testAccounts(): Promise<unknown>         // automator testAccounts
}
```

### `cdp: CdpHandle`（web debug 能力）
CDP 底层会话透传（性能/网络/DOM 域命令）——**web 注入式**（Playwright `context.newCDPSession(page)`），**mp 端降级抛错**（无 CDP 概念——渲染是原生 WXML 非 Chromium）。

```ts
interface CdpHandle {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>  // 任意 CDP 域命令
  on(event: string, handler: (...args: unknown[]) => void): unknown                 // CDP 事件订阅
}
```

```ts
const driver = createDriver({ platform: 'web', page, cdp: await context.newCDPSession(page) })
await driver.cdp.send('Performance.enable')                                          // 性能追踪
await driver.cdp.send('Network.emulateNetworkConditions', { latency: 200, offline: false, ... })
driver.cdp.on('Network.requestWillBeSent', (e) => console.log(e))
```

---

## 4. TestElement 接口（全部方法）

> 元素 = `driver.element(selector)` 返回值。**web 惰性重查 / mp 每次重新解析**，导航后引用依然可用（自动重查新页面）。

### `tap(options?: TestElementOptions): Promise<void>`
点击（`automation_element_action tap` / `locator.click`）。

### `input(text: string, options?: TestElementOptions): Promise<void>`
输入文本（input/textarea 清空后填入）。

### `longPress(durationMs?: number): Promise<void>`
长按（缺省 600ms）。
- **web**：无原生长按 → hover + mousedown + 延时 + mouseup（近似模拟，事件派发在目标元素）。
- **mp**：automator `element.longPress(durationMs)` 原生。

### `text(options?: TestElementOptions): Promise<string>`
读文本（`text` / `locator.textContent`，null → 空串）。

### `value(options?: TestElementOptions): Promise<string>`
读值（input/textarea 的 value）。

### `attribute(name: string): Promise<string | null>`
读属性（null = 缺失）。
- **web**：`locator.getAttribute(name)`。
- **mp**：automator 元素无通用属性 API → 有原生 `attribute` 用之，否则 MVP 返回 null（读属性请走 `evaluate` 或文本断言）。

### `waitFor(options?: ElementWaitOptions): Promise<void>`
等待元素状态（`waitForSelector` 语义）。

```ts
type ElementWaitState = 'attached' | 'visible' | 'detached'
interface ElementWaitOptions {
  timeout?: number   // 缺省 5000
  state?: ElementWaitState  // 缺省 visible
}
```

- **web**：`locator.waitFor({ state, timeout })`（attached/visible/detached 直接映射 playwright 语义）。
- **mp**：`attached`/`visible` → 轮询解析元素；`detached` → 轮询直到元素消失（每 200ms 一次）。

### `exists(options?: TestElementOptions): Promise<boolean>`
存在性（单次查询）。
- **web**：`locator.count() > 0`。
- **mp**：`currentPage().$()` 解析成功。

---

## 5. 完整跨端用例示例

```ts
// tests/e2e-shared.test.ts（同一份用例代码 → 双端跑）
import { describe, it, expect } from 'vitest'
import { createDriver } from '@proteus-vue/test-core/driver'
import type { TestDriver } from '@proteus-vue/test-core/driver'

/** 跨端业务用例：只碰统一能力接口，不写 page./mini. 平台 API */
async function runShared(driver: TestDriver): Promise<void> {
  await driver.reLaunch('/pages/index')          // 导航（mp: reLaunch 最稳通道）
  const btn = driver.element('button')           // 元素查找（惰性）
  await btn.waitFor({ timeout: 10_000 })          // 等待出现
  await btn.tap()                                 // 交互
  await driver.waitFor(100)                       // 确定性等待（动画等）
  const cur = await driver.currentPage()          // 页面断言
  expect(cur.path).toContain('pages/index')
  const info = await driver.systemInfo()          // 运行时断言
  expect(info.platform).toBeTruthy()
  await driver.screenshot('/tmp/result.png')      // 取证
  await driver.close()
}

it('双端同一份用例', async () => {
  await runShared(createDriver({ platform: 'web', page }))  // playwright Page
  await runShared(createDriver({ platform: 'mp', mini }))   // automator miniProgram
})
```

---

## 6. 注入句柄（结构类型，零硬依赖）

driver 只依赖句柄的形状，不 import playwright / automator 包——用户句柄满足形状即用（playwright `Page`、automator `MiniProgram` 天然满足）。

### 6.1 `PlaywrightPageLike`（createWebDriver 入参）
```ts
interface PlaywrightPageLike {
  goto(url: string, options?: unknown): Promise<unknown>
  goBack(options?: unknown): Promise<unknown>
  url(): string
  evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>
  waitForTimeout(ms: number): Promise<void>
  screenshot(options?: { path?: string }): Promise<Buffer | { path?: string }>
  locator(selector: string): PlaywrightLocatorLike
  reload(options?: unknown): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): unknown   // debug 能力（console/request/response/pageerror）；可选
}
```

### 6.2 `PlaywrightLocatorLike`
```ts
interface PlaywrightLocatorLike {
  click(options?: unknown): Promise<void>
  fill(text: string, options?: unknown): Promise<void>
  textContent(options?: unknown): Promise<string | null>
  inputValue(options?: unknown): Promise<string>
  getAttribute(name: string): Promise<string | null>
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>
  count(): Promise<number>
  dispatchEvent(type: string, init?: unknown): Promise<void>
  hover(options?: unknown): Promise<void>
}
```

### 6.3 `AutomatorMiniLike`（createMpDriver 入参）
```ts
interface AutomatorMiniLike {
  reLaunch(url: string): Promise<{ path: string; waitFor?(ms: number): Promise<void> }>
  currentPage(): Promise<{ path: string; $?(selector: string): Promise<AutomatorElementLike | null> }>
  systemInfo(): Promise<Record<string, unknown>>
  evaluate(fn: string | ((...args: unknown[]) => unknown), ...args: unknown[]): Promise<unknown>
  screenshot(options?: { path?: string }): Promise<{ path: string }>
  disconnect(): void
  // ★wx API（automation_wx_api）与登录凭据（automation_testaccount）——可选：缺省时 wxApi/ticket 句柄抛错
  callWxMethod?(method: string, args?: Record<string, unknown>): Promise<unknown>
  mockWxMethod?(method: string, impl: ((...args: unknown[]) => unknown) | (() => unknown)): Promise<void>
  restoreWxMethod?(method: string): Promise<void>
  setTicket?(ticket: string): Promise<void>
  getTicket?(): Promise<unknown>
  refreshTicket?(): Promise<void>
  testAccounts?(): Promise<unknown>
}
```

### 6.4 `AutomatorElementLike`
```ts
interface AutomatorElementLike {
  tap(): Promise<void>
  input(text: string): Promise<void>
  longPress(durationMs?: number): Promise<void>
  text(): Promise<string>
  value(): Promise<string>
  attribute?(name: string): Promise<string | null>   // 可选：automator 元素通用属性读取
}
```

### 6.5 `MpDebuggerLike`（createMpDriver 第二参数，可选）
wechatide 工具能力句柄（automator 无 console/network/clearCache/refresh API——这些是 IDE 工具）：
```ts
interface MpDebuggerLike {
  consoleGrep?(command: string): Promise<string[]>   // wechatide get_simulator_console（grep 命令，返回命中行）
  networkGrep?(command: string): Promise<string[]>   // wechatide get_simulator_network
  clearCache?(action?: string): Promise<void>        // wechatide debug_clear_cache
  refresh?(): Promise<void>                          // wechatide simulator_refresh
}
```
未注入 → 对应 driver 方法抛错提示「注入 wechatide debugger 句柄」。

**★装配通道（决策 #209）**：CLI `proteus test e2e:mp --debugger <module>`（或 env `PROTEUS_MP_DEBUGGER_MODULE`）——spec 动态 import 适配模块（导出 `default` MpDebuggerLike 或 `createMpDebugger()`）注入 `createDriver({ platform:'mp', mini, debugger })`；示例见 05-e2e-mp-automator.md「debugger 适配装配」。

---

## 7. 边界与扩展

- **console / network 取证**：已入 driver 接口（`consoleLogs`/`networkRequests`）——web 事件收集真实可用；MP 走 wechatide debugger 句柄（注入式，automator 无此 API）。
- **wx API mock / 登录凭据**：已入 driver 接口（`wxApi`/`ticket` 子域）——MP automator 原生实现；web 降级抛错（业务已收口 platformAPI）。
- **App 端**：`createDriver({ platform: 'app', ... })` 第三实现预留（§09）。
- **小游戏**（wechatide automator 画布坐标模式）：与小程序 WXML selector 模式能力差异大，未纳入（后续按需）。
