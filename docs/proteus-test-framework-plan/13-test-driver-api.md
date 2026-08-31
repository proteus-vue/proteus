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
const driver = createDriver({ platform: 'mp', mini })
```

### `createWebDriver(page: PlaywrightPageLike): TestDriver`
Web 端实现（playwright 适配）。句柄形状见 §6.1。

### `createMpDriver(mini: AutomatorMiniLike): TestDriver`
小程序端实现（automator 适配）。句柄形状见 §6.2。

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
- **mp**：`evaluate('(ms) => new Promise((r) => setTimeout(r, ms))', ms)`。

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

---

## 7. 边界与扩展

- **console / network 取证**（wechatide debugger 域：`get_simulator_console`/`get_simulator_network`）：暂未入 driver 接口，标扩展——Web 走 `page.on('console'/'request')`，MP 走 IDE 缓冲区，能力差异大，后续单独设计。
- **wx API mock**（`automation_wx_api`）：MVP 用 `evaluate` 覆盖（`evaluate('wx.showToast')`），专项 mock 能力标扩展。
- **App 端**：`createDriver({ platform: 'app', ... })` 第三实现预留（§09）。
- **小游戏**（wechatide automator 画布坐标模式）：与小程序 WXML selector 模式能力差异大，未纳入（后续按需）。
