// tests/desktop-web-primitives.test.ts
// ★#449 G-24 B5 网页原语四件套（官网豁免回收——scroll/cross-window/元素查询/URL 地址栏）：
//   createScrollObserver（rAF 节流滚动观测）/ subscribeWindowMessage（origin 校验 + type 过滤）/
//   scrollToId（锚点定位）/ currentPageOrigin·currentPagePathname·replacePageUrl（location/history 收口）
// 纯逻辑零 DOM（env 注入）——与 network/lifecycle B4 同测试法
import { describe, it, expect, vi } from 'vitest'
import {
  createScrollObserver,
  readPageScroll,
  subscribeWindowMessage,
  scrollToId,
  currentPageOrigin,
  currentPagePathname,
  replacePageUrl,
} from '@proteus-vue/desktop'
import type { ScrollState } from '@proteus-vue/desktop'

describe('#449 p-scroll-observer（滚动观测——rAF 节流 + 进度）', () => {
  function makeEnv(readState: ScrollState) {
    const listeners: Array<() => void> = []
    const rafQueue: Array<() => void> = []
    const cafSpy = vi.fn(() => {
      rafQueue.length = 0 // 真实 caf 语义：取消未跑帧
    })
    return {
      env: {
        on: (fn: () => void) => listeners.push(fn),
        off: (fn: () => void) => {
          const i = listeners.indexOf(fn)
          if (i >= 0) listeners.splice(i, 1)
        },
        raf: (fn: () => void) => {
          rafQueue.push(fn)
          return rafQueue.length
        },
        caf: cafSpy,
        read: () => readState,
      },
      listeners,
      rafQueue,
      cafSpy,
      fire: () => [...listeners].forEach((fn) => fn()),
      flush: () => {
        const q = [...rafQueue]
        rafQueue.length = 0
        q.forEach((fn) => fn())
      },
    }
  }

  it('immediate 首帧回调 + 状态携带进度', () => {
    const onChange = vi.fn()
    const h = makeEnv({ y: 240, viewport: 800, docHeight: 2400, max: 1600, progress: 0.15 })
    createScrollObserver({ onChange, immediate: true }, h.env)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ y: 240, progress: 0.15 }))
  })

  it('滚动事件按帧合并（帧内多事件 → 一次回调）；destroy 后不再回调', () => {
    const onChange = vi.fn()
    const h = makeEnv({ y: 0, viewport: 800, docHeight: 1600, max: 800, progress: 0 })
    const obs = createScrollObserver({ onChange }, h.env)
    h.fire()
    h.fire() // 帧内第二个事件：pending 合并
    expect(onChange).not.toHaveBeenCalled()
    h.flush()
    expect(onChange).toHaveBeenCalledTimes(1)
    obs.destroy()
    h.fire()
    h.flush()
    expect(onChange).toHaveBeenCalledTimes(1) // destroy 后不再回调
  })

  it('destroy 时帧待执行（pending）→ caf 取消未跑帧', () => {
    const onChange = vi.fn()
    const h = makeEnv({ y: 10, viewport: 800, docHeight: 1600, max: 800, progress: 0 })
    const obs = createScrollObserver({ onChange }, h.env)
    h.fire() // pending（帧未 flush）
    obs.destroy()
    expect(h.cafSpy).toHaveBeenCalled()
    h.flush()
    expect(onChange).not.toHaveBeenCalled() // 取消后未跑帧不回调
  })

  it('进度计算：max=0 → 0；y=max → 1', () => {
    expect(readPageScroll()).toEqual({ y: 0, viewport: 0, docHeight: 0, max: 0, progress: 0 }) // 无 DOM 诚实零态
  })
})

describe('#449 跨窗消息原语（origin 校验 + type 过滤）', () => {
  it('同源（缺省当前 origin）+ 命中 type → 回调；异源/非白名单 type 忽略', () => {
    const onMessage = vi.fn()
    const calls: Array<(e: { origin?: string | null; data?: unknown }) => void> = []
    const sub = subscribeWindowMessage(
      {
        types: ['proteus-spirit-morph'],
        onMessage,
        origin: 'https://app.example.com',
      },
      { on: (fn) => calls.push(fn), off: () => {}, currentOrigin: () => 'https://app.example.com' },
    )
    calls[0]!({ origin: 'https://evil.example', data: { type: 'proteus-spirit-morph' } }) // 异源忽略
    calls[0]!({ origin: 'https://app.example.com', data: { type: 'other' } }) // type 白名单外忽略
    calls[0]!({ origin: 'https://app.example.com', data: { type: 'proteus-spirit-morph', name: '本体', theme: 't' } })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith({ type: 'proteus-spirit-morph', data: { type: 'proteus-spirit-morph', name: '本体', theme: 't' }, origin: 'https://app.example.com' })
    sub.destroy()
  })

  it('origin 缺省 → 回落 currentOrigin（同源默认）', () => {
    const onMessage = vi.fn()
    const calls: Array<(e: { origin?: string | null; data?: unknown }) => void> = []
    subscribeWindowMessage({ onMessage }, { on: (fn) => calls.push(fn), off: () => {}, currentOrigin: () => 'https://x.dev' })
    calls[0]!({ origin: 'https://x.dev', data: 'hi' })
    calls[0]!({ origin: null, data: 'x' })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith({ type: undefined, data: 'hi', origin: 'https://x.dev' })
  })

  it('显式 origin:null → 接受任意来源', () => {
    const onMessage = vi.fn()
    const calls: Array<(e: { origin?: string | null; data?: unknown }) => void> = []
    subscribeWindowMessage({ origin: null, onMessage }, { on: (fn) => calls.push(fn), off: () => {} })
    calls[0]!({ origin: 'https://whoever.dev', data: {} })
    expect(onMessage).toHaveBeenCalledTimes(1)
  })
})

describe('#449 锚点定位（scrollToId——元素查询收口）', () => {
  it('找到 → 调度滚动（延时 60ms）返回 true', () => {
    vi.useFakeTimers()
    try {
      const el = { scrollIntoView: vi.fn() }
      const delay = (fn: () => void) => setTimeout(fn, 60)
      const ok = scrollToId('intro', { behavior: 'smooth', delayMs: 60 }, { getElementById: (id) => (id === 'intro' ? (el as never) : null), setTimeout: delay })
      expect(ok).toBe(true)
      expect(el.scrollIntoView).not.toHaveBeenCalled() // 延时中
      vi.advanceTimersByTime(60)
      expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('未找到 → false（不抛错）', () => {
    const ok = scrollToId('nope', {}, { getElementById: () => null })
    expect(ok).toBe(false)
  })

  it('无 delayMs → 同步滚动', () => {
    const el = { scrollIntoView: vi.fn() }
    const ok = scrollToId('a', {}, { getElementById: () => el as never })
    expect(ok).toBe(true)
    expect(el.scrollIntoView).toHaveBeenCalled()
  })
})

describe('#449 页面 URL 读写（location/history 收口）', () => {
  it('currentPageOrigin/Pathname：env 优先，回落全局（无 location → 空）', () => {
    expect(currentPageOrigin({ location: { origin: 'https://a.com' } })).toBe('https://a.com')
    expect(currentPagePathname({ location: { pathname: '/docs/10-config' } })).toBe('/docs/10-config')
    // 无 location 环境 → 空串（SSR/单测安全）
    expect(currentPageOrigin()).toBe('')
    expect(currentPagePathname()).toBe('')
  })

  it('replacePageUrl：env.replaceState 调用恰一次（null + 空串 + url）', () => {
    const replaceState = vi.fn()
    replacePageUrl('https://a.com/playground?src=abc', { history: { replaceState } })
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://a.com/playground?src=abc')
  })

  it('无 history 环境 → 静默不抛', () => {
    expect(() => replacePageUrl('https://a.com/x')).not.toThrow()
  })
})
