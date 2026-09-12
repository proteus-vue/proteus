// tests/render-gate.test.ts
// ★页面渲染门禁（assertPageRendered）单测（2026-09-13）：
//   背景：E2E 此前只断言路由/data/文本，**漏了「元素视觉可见」** → p-button 因缺 css 塌陷/不可见，门禁全绿却人眼可见故障。
//   本测试用**假 driver**（注入可控渲染度量）验证门禁逻辑：合格通过 / 空白页 / 零尺寸元素 / console 错误 都必须被判定。
import { describe, it, expect } from 'vitest'
import { assertPageRendered, collectRenderMetrics } from '@proteus-vue/test-core'
import type { TestDriver } from '@proteus-vue/test-core/driver'

/** 假 driver：evaluate 返回注入的度量；consoleLogs 返回注入的错误 */
function fakeDriver(metrics: unknown, errors: string[] = []): TestDriver {
  return {
    evaluate: async () => metrics,
    consoleLogs: async () => errors.map((text) => ({ text, level: 'error' as const })),
  } as unknown as TestDriver
}
const healthy = { hasText: true, textLen: 42, keyTotal: 5, keyVisible: 5, invisibleSamples: [], lowContrastSamples: [] }

describe('★页面渲染门禁 assertPageRendered', () => {
  it('健康页面（有文本 + 关键元素可见 + 无错误）→ 通过', async () => {
    const m = await assertPageRendered(fakeDriver(healthy), { keySelector: 'button', minVisible: 1 })
    expect(m.keyVisible).toBe(5)
  })

  it('★空白页面（无可见文本）→ 拒绝（人眼可见故障必须被门禁抓到）', async () => {
    await expect(assertPageRendered(fakeDriver({ ...healthy, hasText: false, textLen: 0 }))).rejects.toThrow(/疑似空白/)
  })

  it('★元素存在但不可见（0 尺寸 / display:none——p-button 缺样式场景）→ 拒绝', async () => {
    const invisible = { hasText: true, textLen: 42, keyTotal: 3, keyVisible: 0, invisibleSamples: [{ text: '点击我', w: 0, h: 0, display: 'none', visibility: 'visible' }], lowContrastSamples: [] }
    await expect(assertPageRendered(fakeDriver(invisible), { keySelector: 'button', minVisible: 1 })).rejects.toThrow(/可见数不足/)
  })

  it('★关键元素可见数不足 minVisible → 拒绝', async () => {
    const few = { hasText: true, textLen: 42, keyTotal: 3, keyVisible: 1, invisibleSamples: [], lowContrastSamples: [] }
    await expect(assertPageRendered(fakeDriver(few), { keySelector: 'button', minVisible: 3 })).rejects.toThrow(/可见数不足/)
  })

  it('★存在 console error → 拒绝（渲染期报错）', async () => {
    await expect(assertPageRendered(fakeDriver(healthy, ['Uncaught TypeError: x is undefined']), { assertNoErrors: true })).rejects.toThrow(/console 错误/)
  })

  // ★2026-09-13 强化：minVisible=1 抓不住「按钮都不见了」——元素**整体消失**或**大部分不可见**必须红
  it('★元素整体消失（keyTotal=0，页面还想有 10 个按钮）→ 拒绝（minVisible=1 抓不住此类）', async () => {
    const gone = { hasText: true, textLen: 42, keyTotal: 0, keyVisible: 0, invisibleSamples: [], lowContrastSamples: [] }
    await expect(assertPageRendered(fakeDriver(gone), { keySelector: 'button', minVisible: 1, expectedCount: 10 })).rejects.toThrow(/总数不足/)
  })

  it('★元素总数低于预期 expectedCount（部分消失）→ 拒绝', async () => {
    const partial = { hasText: true, textLen: 42, keyTotal: 6, keyVisible: 6, invisibleSamples: [], lowContrastSamples: [] }
    await expect(assertPageRendered(fakeDriver(partial), { keySelector: 'button', expectedCount: 10 })).rejects.toThrow(/总数不足/)
  })

  it('★大部分元素不可见（可见占比 < minVisibleRatio）→ 拒绝', async () => {
    const mostlyHidden = { hasText: true, textLen: 42, keyTotal: 10, keyVisible: 3, invisibleSamples: [{ text: 'x', w: 0, h: 0, display: 'none', visibility: 'visible' }], lowContrastSamples: [] }
    await expect(assertPageRendered(fakeDriver(mostlyHidden), { keySelector: 'button', minVisibleRatio: 0.9 })).rejects.toThrow(/可见占比不足/)
  })

  it('健康页面（10/10 可见 + console 无错误）→ 通过（严格模式）', async () => {
    const all = { hasText: true, textLen: 42, keyTotal: 10, keyVisible: 10, invisibleSamples: [], lowContrastSamples: [] }
    const r = await assertPageRendered(fakeDriver(all), { keySelector: 'button', minVisibleRatio: 1, expectedCount: 10 })
    expect(r.visibleRatio).toBe(1)
  })

  it('★低对比度（白底白字——尺寸非零，size/display 断言抓不住）→ minContrast 时拒绝', async () => {
    const whiteOnWhite = { hasText: true, textLen: 42, keyTotal: 10, keyVisible: 10, invisibleSamples: [], lowContrastSamples: [{ text: '点击我', color: 'rgb(255, 255, 255)', bg: 'rgb(248, 248, 248)', ratio: 1.03 }] }
    await expect(assertPageRendered(fakeDriver(whiteOnWhite), { keySelector: 'button', minContrast: 1.5 })).rejects.toThrow(/低对比度/)
  })

  it('不传 minContrast → 不检对比度（缺省关闭，避免误伤浅色设计）', async () => {
    const whiteOnWhite = { hasText: true, textLen: 42, keyTotal: 10, keyVisible: 10, invisibleSamples: [], lowContrastSamples: [{ text: 'x', color: 'rgb(255,255,255)', bg: 'rgb(248,248,248)', ratio: 1.03 }] }
    const r = await assertPageRendered(fakeDriver(whiteOnWhite), { keySelector: 'button' })
    expect(r.keyVisible).toBe(10)
  })

  it('MP 端度量（textLen=-1 无文本通道；keyVisible 由 selectorQuery 得出）→ 只看元素可见性', async () => {
    const mp = { hasText: true, textLen: -1, keyTotal: 4, keyVisible: 4, invisibleSamples: [], lowContrastSamples: [] }
    const r = await assertPageRendered(fakeDriver(mp), { keySelector: 'button' })
    expect(r.keyVisible).toBe(4) // textLen<0 时跳过空白判定（MP 无 body 文本）
  })
})
