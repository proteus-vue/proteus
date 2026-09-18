// tests/test-core-events.test.ts
// ★test-framework B7：跨端统一断言 helper（06-cross-platform-assert.md §统一事件 helper）
// tap 按端分发（Web trigger / MP automator tap）+ 类型守卫；状态/逻辑断言跨端共用，DOM 差异下沉 p-* 映射
import { describe, expect, it, vi } from 'vitest'
import { tap, isWebElement, isMpElement } from '@proteus-vue/test-core'
import type { WebEventTarget, MpEventTarget } from '@proteus-vue/test-core'

describe('tap（06 §统一事件 helper：跨端分发）', () => {
  it('Web wrapper → trigger("click")', async () => {
    const trigger = vi.fn()
    const el: WebEventTarget = { trigger }
    await tap(el)
    expect(trigger).toHaveBeenCalledWith('click')
  })

  it('小程序 automator element → tap()（async）', async () => {
    const tapFn = vi.fn(() => Promise.resolve())
    const el: MpEventTarget = { tap: tapFn }
    await tap(el)
    expect(tapFn).toHaveBeenCalledTimes(1)
  })

  it('统一 helper：同一份业务用例双端复用（06 分层断言：事件触发封装）', async () => {
    const web = { trigger: vi.fn() } as WebEventTarget
    const mp = { tap: vi.fn(() => Promise.resolve()) } as MpEventTarget
    // 同一断言流程跑两端（跨端用例不直写 div/view——06 铁律）
    await tap(web)
    await tap(mp)
    expect(web.trigger).toHaveBeenCalledWith('click')
    expect(mp.tap).toHaveBeenCalled()
  })
})

describe('类型守卫', () => {
  it('isWebElement / isMpElement 按形状判定', () => {
    const web = { trigger: () => undefined } as unknown as { trigger: () => void }
    const mp = { tap: () => Promise.resolve() } as unknown as { tap: () => Promise<void> }
    expect(isWebElement(web as never)).toBe(true)
    expect(isMpElement(web as never)).toBe(false)
    expect(isWebElement(mp as never)).toBe(false)
    expect(isMpElement(mp as never)).toBe(true)
  })
})
