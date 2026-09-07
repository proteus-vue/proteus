# E2E 真机验证

> **目标**：在真实设备上验证"超级应用"性能与稳定性基线

---

## 9.1 Web 端（Playwright）

```ts
// tests/e2e/playback.spec.ts
import { test, expect } from '@playwright/test'

test('播放全流程不中断', async ({ page }) => {
  await page.goto('/')
  await page.click('[data-testid="track-1"]')
  
  // 验证播放条出现
  await expect(page.locator('player-bar')).toBeVisible()
  
  // 导航到播放页
  await page.goto('/player')
  await expect(page.locator('player-bar')).toBeVisible()  // ← 不消失
  
  // 返回首页
  await page.goBack()
  await expect(page.locator('player-bar')).toBeVisible()  // ← 仍不消失
})
```

## 9.2 小程序端（miniprogram-ci + 真机）

```ts
// tests/e2e/mp-playback.spec.ts
describe('Skyline 真机', () => {
  it('后台音频持续播放', async () => {
    await miniProgram.navigateTo('/player')
    await miniProgram.tap('.play-btn')
    
    // 模拟锁屏/切后台
    await miniProgram.background()
    await sleep(3000)
    
    // 验证音频仍在播放（通过 DevTools trace）
    const trace = await devtools.getTrace()
    expect(trace).toContain('audio.playing')
  })
})
```

**验收点**：
- [ ] CI 矩阵：iOS/Android/Windows/Mac × 基础库版本 × 首屏/支付/播放 10 条核心路径
- [ ] 关键路径 E2E 耗时 < 15min（CI 预算）
- [ ] 失败自动录制 `.proteus-trace.json` 供本地复现

## 9.3 性能基线

| 指标 | 基线 | 工具 |
|------|------|------|
| 首屏 FCP | < 1.5s | Lighthouse / Skyline Trace |
| 长列表滚动 | 60fps | DevTools Performance |
| 内存（万条消息） | < 150MB | 真机 Memory |
| 分包下载 | < 2s (4G) | Network Throttling |
| 冷启动到可交互 | < 3s | Lifecycle trace |

**验收点**：
- [ ] 性能预算进 CI（超标 → 失败）
- [ ] 性能趋势图（每次 PR 对比）

---
