# M4 — E2E 真机 (L4)

> 占比 5%，Web Playwright + 小程序真机，慢但最接近真实

## 1. 技术选型

| 端 | 工具 | 说明 |
|----|------|------|
| Web | Playwright | 标准浏览器 E2E |
| 小程序 | `miniprogram-ci` + 微信开发者工具 CLI | 真机/模拟器自动化 |
| App | ❌ 外置 | Appium / Detox，本计划不覆盖 |

## 2. Web E2E

```ts
// e2e/home.spec.ts
import { test, expect } from '@playwright/test'

test('navigate to detail', async ({ page }) => {
  await page.goto('/')
  await page.click('[data-testid="card"]')
  await expect(page).toHaveURL(/\/detail\/\d+/)
})
```

**关键**：Web 端产物是 SPA，`page.goto` 直接可用。

## 3. 小程序真机 E2E（难点）

### 方案 A：miniprogram-ci（推荐）

```ts
import { preview } from 'miniprogram-ci'

// 上传预览版 → 真机扫码 → 自动化脚本操控
const result = await preview({
  projectPath: 'dist/mp',
  appid: 'wx123',
  desc: 'e2e-test',
})
```

### 方案 B：开发者工具自动化（降级）

微信开发者工具 CLI 支持 `--auto` 模式，可跑脚本：
```bash
cli --auto --project dist/mp --test ./e2e/run.js
```

### CI 限制

- GitHub Actions **无微信开发者工具** → 用 `miniprogram-ci` 上传预览 + 外置 Mac runner
- **降级策略**：CI 只跑 Web E2E + 编译快照；小程序 E2E 在**本地或专用 runner** 跑

## 4. E2E 测试约定

- 目录：`e2e/**/*.spec.ts`
- 选择器：优先 `data-testid`（不依赖样式）
- 隔离：每个 spec 独立登录态 + 清理
- 超时：单 case < 30s

## 5. 跨端同一份用例

```ts
// e2e/flows/navigate.ts
export function navigateTest(adapter: TestAdapter) {
  it('opens detail', async () => {
    await adapter.click('[data-testid="card"]')
    await adapter.expectURL(/\/detail/)
  })
}
// web 用 Playwright adapter，mp 用 miniprogram-ci adapter
```

## 6. 验收

- [ ] Web E2E 在 CI 全绿
- [ ] 小程序 E2E 本地/专用 runner 可跑
- [ ] `proteus test:e2e` 一键触发
- [ ] 失败截图 + trace 自动上传
