# M4 · Web E2E（Playwright）

## 目标
在真实浏览器里跑关键用户路径：播放、支付、登录、搜索等。

## 配置

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/web',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'proteus dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
```

## 用例结构

```ts
import { test, expect } from '@playwright/test'

test('播放一首歌不中断', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('play').click()
  await expect(page.getByTestId('player-bar')).toBeVisible()
  await page.goto('/search')
  await expect(page.getByTestId('player-bar')).toBeVisible()  // 切页不中断
})
```

## 关键路径（对齐 Blueprint §06）

| 路径 | 验证的层 |
|---|---|
| 播放流程 | Component + Lifecycle + Pinia + API + Platform |
| 支付闭环 | Router + API + Security + i18n |
| 登录态恢复 | Lifecycle + Pinia + Storage |

## DevTools 联动
E2E 失败时自动导出 DevTools 录制（TraceBus dump）：
```
test-results/play-fail.json  → 拖入 DevTools 复现
```

## 统一 driver 适配（决策 #205）

```ts
import { createDriver } from '@proteus-vue/test-core/driver'

// ★注入 playwright Page → TestDriver（能力域：navigate/element/evaluate/screenshot/currentPage/systemInfo）
const driver = createDriver({ platform: 'web', page })
await driver.reLaunch('/pages/index')
const btn = driver.element('[data-testid="play"]')
await btn.waitFor()
await btn.tap()
await driver.screenshot('/tmp/play.png')
```

- 关键路径仍以 `data-testid` 定位（铁律）；driver 元素 = Playwright locator（惰性重查当前 DOM）
- `longPress` web 无原生长按 → mousedown + 延时 + mouseup 近似模拟
- 同一份用例代码经 `createDriver({ platform: 'web' })` / `({ platform: 'mp' })` 双端复用（§06）

## 铁律
- Web E2E **只跑真实浏览器**，禁止 happy-dom 冒充
- 关键路径必须带 `data-testid`，禁止靠文本定位

---
