# 跨端用例编写（06 铁律 + 共享用例模式）

## 06 铁律

1. **跨端用例只碰逻辑/状态/语义**——禁止直接写 `div`/`view` 字面量（两端 DOM 结构不同）。
2. **状态跨端完全共用**（`stateOf`），**DOM 各自断言**（元素级断言属于各端测试，不下沉共享用例）。
3. selector 选**两端一致的稳定标记**：原生标签（`button`）、`data-testid`（web 铁律）、语义类名。
   ⚠ MP 端 scoped class 会被哈希化（`.tapped-count` → `.tapped-count-data-v-xxx`）——跨端 selector 不要依赖 scoped class。

## 共享用例模式（E2E 层）

同一份用例代码 → web/mp 双端跑（`tests/e2e-driver-shared.ts` 形态）：

```ts
// tests/e2e-driver-shared.ts
import { expect } from 'vitest'
import type { TestDriver } from '@proteus-vue/test-core/driver'

export async function runSharedSmoke(driver: TestDriver, opts: {
  route: string               // web 绝对 URL（goto 需要）；mp '/pages/index'（reLaunch）
  tapSelector: string         // 跨端按钮 selector（两端原生 button 标签）
  shotPath: string
  elementOps?: boolean        // MP 模拟器未激活时 $ 挂起 → false 走稳通道
  screenshotOps?: boolean     // MP 当前 IDE screenshot 挂起 → false 跳过
  closeAtEnd?: boolean        // 调用方还有专属断言 → false（close=disconnect 后调用挂起）
}): Promise<void> {
  await driver.reLaunch(opts.route)
  await driver.waitFor(800)   // MP reLaunch 后页面渲染等待
  if (opts.elementOps !== false) {
    const btn = driver.element(opts.tapSelector)
    await btn.waitFor({ timeout: 15_000 })
    expect(await btn.text()).toContain('tap')  // 跨端语义断言（两端 button 文本一致）
    await btn.tap()
    await driver.waitFor(500)
  }
  // ★稳通道断言（B5 真机验证）：currentPage/systemInfo
  expect((await driver.currentPage()).path).toContain('pages/index')
  expect((await driver.systemInfo()).platform).toBeTruthy()
  if (opts.screenshotOps !== false) expect(await driver.screenshot(opts.shotPath)).toBeTruthy()
  if (opts.closeAtEnd !== false) await driver.close()
}
```

Web spec 装配：`createDriver({ platform: 'web', page })`（Playwright Chromium + preview 产物）；MP spec 装配：`createDriver({ platform: 'mp', mini })`（automator launch/connect 由 CLI 装配）。

## MP 稳通道（B5 真机经验）

模拟器未激活时 automator **页面级 DOM API 挂起**（`page.$`/`getElement`/`screenshot`）→ 断言走最稳通道：
`reLaunch` / `currentPage` / `systemInfo` / `evaluate`（运行时内读 `getCurrentPages()[n].data`）。

```ts
const count = await mini.evaluate(() => {
  const pages = getCurrentPages()
  return pages[pages.length - 1].data.count
}) // ★必须传函数（automator toString 序列化）
```

## 组件层跨端（L3）

`mountComponent(sfc, { platform })` + `stateOf`/`textOf` 状态断言双端共用；`tap` 统一事件分发。
★web 渲染更新在微任务队列——状态变更后文本断言先 `await host.vm.$nextTick()`。
