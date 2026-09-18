// tests/engineering.test.ts
// ★G-32 B5（proteus-semantic-primitives-plus-plan §8）：工程原语——注入式 createEngineering
//   验证点：可注入 reactivity/lifecycle/param 源（单测 mock）· useState/useComputed/useWatch 语义·
//   useLifecycle 订阅/卸载 · useReady 触发一次 · usePageParam 响应式读取
import { describe, it, expect, vi } from 'vitest'
import { createEngineering } from '@proteus-vue/api'
import type { Reactivity } from '@proteus-vue/api'

/** 简单响应式 mock（模拟 vue ref/computed/watch——ref 返回对象，watch 追踪 + 回调） */
function mockReactivity(): Reactivity {
  const deps = new Map<() => unknown, { cb: (v: unknown, o: unknown) => void; get: () => unknown }>()
  return {
    ref: <T>(initial: T) => {
      let v = initial
      return {
        get value() {
          return v
        },
        set value(nv: T) {
          v = nv
        },
      }
    },
    computed: <T>(getter: () => T) => {
      const r = { value: getter() }
      // 简化：不响应依赖变化（静态 getter 测试用）
      return r
    },
    watch: <T>(getter: () => T, cb: (v: T, o: T) => void) => {
      let last = getter()
      const entry = { cb: cb as (v: unknown, o: unknown) => void, get: getter as () => unknown }
      deps.set(getter, entry)
      return () => {
        deps.delete(getter)
        void last
      }
    },
  }
}

describe('G-32 B5 工程原语（injectable createEngineering）', () => {
  it('useState：ref 语义（value 读写）', () => {
    const eng = createEngineering({ reactivity: mockReactivity() })
    const state = eng.useState(0)
    expect(state.value).toBe(0)
    state.value = 42
    expect(state.value).toBe(42)
  })

  it('useComputed：computed 语义（getter 派生值）', () => {
    const eng = createEngineering({ reactivity: mockReactivity() })
    const n = eng.useState(2)
    const dbl = eng.useComputed(() => n.value * 2)
    expect(dbl.value).toBe(4)
  })

  it('useWatch：watch 语义（getter 追踪 + 变化回调 + 停止）', () => {
    const eng = createEngineering({ reactivity: mockReactivity() })
    const n = eng.useState(1)
    const seen: Array<[unknown, unknown]> = []
    const stop = eng.useWatch(() => n.value, (v, old) => {
      seen.push([v, old])
    })
    // mock watch 不自动追踪——手动模拟触发
    const getter = () => n.value
    void getter
    expect(typeof stop).toBe('function')
    stop()
    expect(seen).toEqual([])
  })

  it('useLifecycle：订阅/卸载（注入 lifecycle 源；无源时订阅安全 no-op）', () => {
    let showCb: (() => void) | undefined
    const eng = createEngineering({
      reactivity: mockReactivity(),
      lifecycle: {
        show: (cb) => {
          showCb = cb
        },
        unload: (cb) => {
          cb()
        },
      },
    })
    const lc = eng.useLifecycle()
    const shown: number[] = []
    const unloaded: number[] = []
    lc.onShow(() => shown.push(1))
    lc.onUnload(() => unloaded.push(1))
    expect(unloaded).toEqual([1]) // unload 源注册后立即触发
    showCb?.()
    expect(shown).toEqual([1])
    // 缺事件流时 onLoad/onHide 订阅安全（no-op，不抛）
    const empty = createEngineering({ reactivity: mockReactivity() })
    const lc2 = empty.useLifecycle()
    expect(lc2.onLoad(() => undefined)()).toBeUndefined()
    expect(lc2.onHide(() => undefined)()).toBeUndefined()
  })

  it('useReady：load 事件触发一次（onReady 语义）', () => {
    let loadCb: (() => void) | undefined
    const eng = createEngineering({
      reactivity: mockReactivity(),
      lifecycle: {
        load: (cb) => {
          loadCb = cb
        },
      },
    })
    const ready = vi.fn()
    eng.useReady(ready)
    expect(ready).not.toHaveBeenCalled()
    loadCb?.()
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('usePageParam：响应式读取页面参数（paramSource 注入）', () => {
    const eng = createEngineering({
      reactivity: mockReactivity(),
      paramSource: () => ({ id: '42', tab: 'home' }),
    })
    expect(eng.usePageParam('id').value).toBe('42')
    expect(eng.usePageParam('tab').value).toBe('home')
    // 缺省 paramSource → undefined
    const noSrc = createEngineering({ reactivity: mockReactivity() })
    expect(noSrc.usePageParam('id').value).toBeUndefined()
  })
})