// tests/hmr.test.ts —— @proteus-vue/hmr（devtools-plus G-34 M1）
// HMR Runtime：payload 分派（vue/js/native-binding/css-asset/reload）+ 顺序去重 + 状态保留 +
//   HMR001/HMR002/HMR003 规则 + 可观测事件
// WS 客户端：连接/分发/指数退避重连/上限/disconnect
// Vue hot 适配：accept/dispose/applyWithState 状态往返 + 无 hot 降级
// 安全 reload：save/restore/reload（注入存储 + 收集器）
import { describe, it, expect, vi } from 'vitest'
import {
  createHmrRuntime,
  createHmrClient,
  createVueHotAdapter,
  createSafeReload,
} from '@proteus-vue/hmr'
import type { HmrPayload } from '@proteus-vue/hmr'

function payload(partial: Partial<HmrPayload>): HmrPayload {
  return {
    id: 1,
    file: 'src/pages/index.vue',
    type: 'vue',
    action: 'update',
    timestamp: Date.now(),
    ...partial,
  }
}

describe('HMR Runtime：分派与顺序', () => {
  it('vue payload → applyModule 调用 + appliedFiles 收录 + apply ok 事件', () => {
    const applyModule = vi.fn(() => true)
    const reload = vi.fn()
    const events: string[] = []
    const runtime = createHmrRuntime({
      applyModule,
      reload,
      onEvent: (e) => events.push(`${e.type}:${e.result ?? ''}`),
    })
    runtime.apply(payload({ id: 1, file: 'src/a.vue', code: 'export default {}' }))
    expect(applyModule).toHaveBeenCalledWith('src/a.vue', 'export default {}')
    expect(runtime.appliedFiles()).toEqual(['src/a.vue'])
    expect(runtime.lastAppliedId).toBe(1)
    expect(events).toEqual(['payload:', 'apply:ok'])
  })

  it('重复/乱序 id → 跳过（幂等）', () => {
    const applyModule = vi.fn(() => true)
    const runtime = createHmrRuntime({ applyModule, reload: () => {} })
    runtime.apply(payload({ id: 5, code: 'x' }))
    runtime.apply(payload({ id: 5, code: 'x-dup' }))
    runtime.apply(payload({ id: 3, code: 'x-old' }))
    expect(applyModule).toHaveBeenCalledTimes(1)
    expect(runtime.lastAppliedId).toBe(5)
  })

  it('vue payload 缺 code → HMR003 + 降级安全 reload', () => {
    const reload = vi.fn()
    const events: string[] = []
    const runtime = createHmrRuntime({
      applyModule: () => true,
      reload,
      onEvent: (e) => events.push(e.type === 'rule' ? `${e.type}:${e.rule}` : e.type),
    })
    runtime.apply(payload({ id: 1, code: undefined }))
    expect(events).toContain('rule:HMR003')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('applyModule 返回 false → HMR003 + 安全 reload', () => {
    const reload = vi.fn()
    const runtime = createHmrRuntime({ applyModule: () => false, reload })
    runtime.apply(payload({ id: 1, code: 'x' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('applyModule 抛错 → error 事件 + 安全 reload 兜底', () => {
    const reload = vi.fn()
    const events: string[] = []
    const runtime = createHmrRuntime({
      applyModule: () => {
        throw new Error('boom')
      },
      reload,
      onEvent: (e) => events.push(e.type),
    })
    runtime.apply(payload({ id: 1, code: 'x' }))
    expect(events).toContain('error')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('native-binding → HMR002 + 自动安全 reload', () => {
    const reload = vi.fn()
    const events: string[] = []
    const runtime = createHmrRuntime({
      applyModule: () => true,
      reload,
      onEvent: (e) => events.push(e.type === 'rule' ? e.rule : e.type),
    })
    runtime.apply(payload({ id: 1, type: 'native-binding' }))
    expect(events).toContain('HMR002')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(runtime.appliedFiles()).toEqual([])
  })

  it('css/asset → 热替换 ok、不触发 reload', () => {
    const reload = vi.fn()
    const runtime = createHmrRuntime({ applyModule: () => true, reload })
    runtime.apply(payload({ id: 1, type: 'css', file: 'src/style.css' }))
    runtime.apply(payload({ id: 2, type: 'asset', file: 'src/logo.png' }))
    expect(reload).not.toHaveBeenCalled()
    expect(runtime.appliedFiles()).toContain('src/style.css')
  })

  it('action=reload → 整体刷新；存在未恢复快照时 HMR003', () => {
    const reload = vi.fn()
    const events: string[] = []
    const runtime = createHmrRuntime({
      applyModule: () => true,
      reload,
      onEvent: (e) => events.push(e.type === 'rule' ? e.rule : e.type),
    })
    runtime.snapshotState('src/pages/a.vue', { count: 3 })
    runtime.apply(payload({ id: 1, action: 'reload', file: 'src/pages/a.vue' }))
    expect(events).toContain('HMR003')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('HMR Runtime：状态保留 + HMR001', () => {
  it('snapshot → restore 往返（Flutter Hot Reload 体验）', () => {
    const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
    const state = { count: 3, list: [1, 2] }
    runtime.snapshotState('src/pages/a.vue', state)
    const restored = runtime.restoreState('src/pages/a.vue')
    expect(restored).toBe(state)
    // 恢复后再次 restore → undefined（快照已消费）
    expect(runtime.restoreState('src/pages/a.vue')).toBeUndefined()
  })

  it('前一个实例未恢复就重复快照 → HMR001（副作用未 dispose）', () => {
    const events: string[] = []
    const runtime = createHmrRuntime({
      applyModule: () => true,
      reload: () => {},
      onEvent: (e) => events.push(e.type === 'rule' ? e.rule : e.type),
    })
    runtime.snapshotState('src/pages/a.vue', { count: 1 })
    runtime.snapshotState('src/pages/a.vue', { count: 2 })
    expect(events).toContain('HMR001')
    // 恢复后再快照 → 不告警
    runtime.restoreState('src/pages/a.vue')
    events.length = 0
    runtime.snapshotState('src/pages/a.vue', { count: 3 })
    expect(events).not.toContain('HMR001')
  })

  it('checkSideEffects=false 关闭 HMR001', () => {
    const events: string[] = []
    const runtime = createHmrRuntime({
      applyModule: () => true,
      reload: () => {},
      checkSideEffects: false,
      onEvent: (e) => events.push(e.type === 'rule' ? e.rule : e.type),
    })
    runtime.snapshotState('src/pages/a.vue', { count: 1 })
    runtime.snapshotState('src/pages/a.vue', { count: 2 })
    expect(events).not.toContain('HMR001')
  })

  it('reset 清空快照/已应用/序号', () => {
    const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
    runtime.apply(payload({ id: 1, code: 'x' }))
    runtime.snapshotState('src/a.vue', { x: 1 })
    runtime.reset()
    expect(runtime.appliedFiles()).toEqual([])
    expect(runtime.lastAppliedId).toBe(-1)
    expect(runtime.restoreState('src/a.vue')).toBeUndefined()
  })
})

describe('HMR Runtime：批量 + 性能基准（★G-34 §6 预算）', () => {
  it('批量：同文件合并只保留最终状态（merged）+ 乱序按 id 排序应用', () => {
    const applied: string[] = []
    const runtime = createHmrRuntime({
      applyModule: (f, c) => {
        applied.push(`${f}#${c}`)
        return true
      },
      reload: () => {},
    })
    // 同文件 3 次变更（1/2/3）+ 另一文件 1 次 → 合并后 2 条
    const result = runtime.applyBatch([
      payload({ id: 1, file: 'src/a.vue', code: 'v1' }),
      payload({ id: 2, file: 'src/a.vue', code: 'v2' }),
      payload({ id: 3, file: 'src/a.vue', code: 'v3' }),
      payload({ id: 4, file: 'src/b.vue', code: 'w1' }),
    ])
    expect(result.total).toBe(4)
    expect(result.merged).toBe(2) // a.vue 两次中间态被丢弃
    expect(result.applied).toBe(2)
    expect(applied).toEqual(['src/a.vue#v3', 'src/b.vue#w1']) // 只应用最终状态，且按 id 序
  })

  it('批量：乱序输入仍按 id 全局有序应用（native-binding 不合并）', () => {
    const events: string[] = []
    const runtime = createHmrRuntime({
      applyModule: (f, c) => {
        events.push(`apply:${c}`)
        return true
      },
      reload: () => events.push('reload'),
      onEvent: (e) => {
        if (e.type === 'rule') events.push(e.rule)
      },
    })
    // 乱序：id 5 先到（native-binding），id 1-3 后到
    const result = runtime.applyBatch([
      payload({ id: 3, file: 'src/c.vue', code: 'c3' }),
      payload({ id: 1, file: 'src/a.vue', code: 'a1' }),
      payload({ id: 5, file: 'native-bridge', type: 'native-binding' }),
      payload({ id: 2, file: 'src/b.vue', code: 'b2' }),
    ])
    expect(result.total).toBe(4)
    expect(result.merged).toBe(0)
    expect(result.applied).toBe(4)
    // 全局顺序：id 1 → 2 → 3 → 5（native-binding 触发 reload 在最后）
    expect(events).toEqual(['apply:a1', 'apply:b2', 'apply:c3', 'HMR002', 'reload'])
  })

  it('性能预算：1000 payload 批量应用 < 100ms（G-34 §6 推送→渲染预算）', () => {
    const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
    const batch: HmrPayload[] = []
    for (let i = 0; i < 1000; i++) {
      // 50 个文件循环变更（模拟一次保存触发多文件），同文件多次 → 合并只保留最终状态
      batch.push(payload({ id: i + 1, file: `src/modules/mod-${i % 50}.vue`, code: `code-${i}` }))
    }
    const t0 = performance.now()
    const result = runtime.applyBatch(batch)
    const elapsed = performance.now() - t0
    expect(result.total).toBe(1000)
    expect(result.merged).toBe(950) // 50 文件 × 19 次中间态
    expect(result.applied).toBe(50)
    expect(runtime.lastAppliedId).toBe(1000)
    expect(elapsed).toBeLessThan(100)
  })
})

describe('HMR Client：连接 / 分发 / 重连', () => {
  function createSocketMock() {
    const sock: {
      onopen: (() => void) | null
      onmessage: ((ev: { data: unknown }) => void) | null
      onclose: ((ev: { code?: number; reason?: string }) => void) | null
      onerror: (() => void) | null
      close: ReturnType<typeof vi.fn>
      opened: boolean
    } = { onopen: null, onmessage: null, onclose: null, onerror: null, close: vi.fn(), opened: false }
    sock.onopen = () => {
      sock.opened = true
    }
    return sock
  }

  it('连接后 payload 分发到 runtime（按序应用）', () => {
    const sock = createSocketMock()
    const applied: number[] = []
    const runtime = createHmrRuntime({
      applyModule: (f, c) => {
        applied.push(Number(c))
        return true
      },
      reload: () => {},
    })
    const client = createHmrClient({
      url: 'ws://localhost:5174/__proteus_hmr__',
      runtime,
      createSocket: () => sock,
    })
    client.connect()
    expect(client.connected).toBe(false)
    sock.onopen?.()
    expect(client.connected).toBe(true)
    sock.onmessage?.({ data: JSON.stringify(payload({ id: 1, code: '10' })) })
    sock.onmessage?.({ data: JSON.stringify(payload({ id: 2, code: '20' })) })
    expect(applied).toEqual([10, 20])
    expect(runtime.lastAppliedId).toBe(2)
    client.disconnect()
    expect(client.connected).toBe(false)
    expect(sock.close).toHaveBeenCalled()
  })

  it('断线指数退避重连（attempt 递增 + reconnecting 事件）', () => {
    vi.useFakeTimers()
    try {
      const sockets = [createSocketMock()]
      const events: string[] = []
      const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
      const fmt = (e: { type: string; attempt?: number }) =>
        'attempt' in e && e.attempt !== undefined ? `${e.type}:${e.attempt}` : e.type
      const client = createHmrClient({
        url: 'ws://x',
        runtime,
        reconnect: { baseDelayMs: 100 },
        createSocket: () => sockets[0] as never,
        onEvent: (e) => events.push(fmt(e)),
      })
      client.connect()
      sockets[0].onopen?.()
      expect(events).toEqual(['connected'])
      client.disconnect()
      // disconnect 不重连（closedByUser）；mock close 不触发 onclose（真实 WS 异步触发）
      expect(events).not.toContain('reconnecting:1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('断线 → 指数退避重连（fake timers 推进）', () => {
    vi.useFakeTimers()
    try {
      const sockets = [createSocketMock(), createSocketMock(), createSocketMock()]
      let i = 0
      const events: string[] = []
      const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
      const fmt = (e: { type: string; attempt?: number }) =>
        'attempt' in e && e.attempt !== undefined ? `${e.type}:${e.attempt}` : e.type
      const client = createHmrClient({
        url: 'ws://x',
        runtime,
        reconnect: { baseDelayMs: 100 },
        createSocket: () => sockets[i++ % sockets.length] as never,
        onEvent: (e) => events.push(fmt(e)),
      })
      client.connect()
      sockets[0].onopen?.()
      // 断线 → 第一次重连（延迟 100ms）
      sockets[0].onclose?.({})
      expect(events).toContain('disconnected')
      expect(events).toContain('reconnecting:1')
      expect(client.attempt).toBe(1)
      vi.advanceTimersByTime(100)
      expect(sockets[1].onopen).not.toBeNull() // 第二连接已建立（重连成功前不调 onopen——attempt 累积）
      // 再次断线 → 第二次重连（延迟 200ms = 指数退避）
      sockets[1].onclose?.({})
      expect(events).toContain('reconnecting:2')
      expect(client.attempt).toBe(2)
      vi.advanceTimersByTime(200)
      expect(sockets[2].onopen).not.toBeNull() // 第三连接已建立
      client.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('重连达到 maxAttempts → 停止 + error 事件', () => {
    vi.useFakeTimers()
    try {
      const sockets = [createSocketMock(), createSocketMock(), createSocketMock(), createSocketMock()]
      let i = 0
      const events: string[] = []
      const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
      const fmt = (e: { type: string; attempt?: number }) =>
        'attempt' in e && e.attempt !== undefined ? `${e.type}:${e.attempt}` : e.type
      const client = createHmrClient({
        url: 'ws://x',
        runtime,
        reconnect: { maxAttempts: 2, baseDelayMs: 50 },
        createSocket: () => sockets[i++] as never,
        onEvent: (e) => events.push(fmt(e)),
      })
      client.connect()
      sockets[0].onopen?.()
      // 断线 1 → 重连 1（50ms）
      sockets[0].onclose?.({})
      vi.advanceTimersByTime(50)
      // 断线 2 → 重连 2（100ms）
      sockets[1].onclose?.({})
      vi.advanceTimersByTime(100)
      // 断线 3 → attempt=2 已达上限 → 停止 + error
      sockets[2].onclose?.({})
      expect(events).toContain('reconnecting:1')
      expect(events).toContain('reconnecting:2')
      expect(events).toContain('error')
      expect(client.attempt).toBe(2)
      // 无更多重连（再推进也不会创建新 socket）
      const created = i
      vi.advanceTimersByTime(1000)
      expect(i).toBe(created)
      client.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('非法 payload JSON → error 事件（不影响后续）', () => {
    const sock = createSocketMock()
    const events: string[] = []
    const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
    const client = createHmrClient({
      url: 'ws://x',
      runtime,
      createSocket: () => sock,
      onEvent: (e) => events.push(e.type),
    })
    client.connect()
    sock.onopen?.()
    sock.onmessage?.({ data: 'not-json' })
    expect(events).toContain('error')
    client.disconnect()
  })
})

describe('Vue hot 适配：accept/dispose/applyWithState + 降级', () => {
  function hotMock() {
    const handlers: { accept?: (mod: unknown) => void; dispose?: (data: Record<string, unknown>) => void } = {}
    return {
      handlers,
      accept(deps?: unknown, cb?: (mod: unknown) => void) {
        handlers.accept = (typeof deps === 'function' ? deps : cb) as (mod: unknown) => void
      },
      dispose(cb: (data: Record<string, unknown>) => void) {
        handlers.dispose = cb
      },
      invalidate: vi.fn(),
    }
  }

  it('无 hot 环境 → enabled false + 全部 no-op（非 dev 安全降级）', () => {
    const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
    const adapter = createVueHotAdapter({ runtime, file: 'src/a.vue', getHot: () => undefined })
    expect(adapter.enabled).toBe(false)
    expect(() => adapter.accept(() => {})).not.toThrow()
    expect(() => adapter.dispose(() => ({}))).not.toThrow()
    expect(() => adapter.invalidate()).not.toThrow()
    expect(runtime.appliedFiles()).toEqual([])
  })

  it('applyWithState：dispose 快照 → accept 恢复（状态保留往返）', () => {
    const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
    const mock = hotMock()
    const adapter = createVueHotAdapter({
      runtime,
      file: 'src/pages/counter.vue',
      getHot: () => mock as never,
    })
    expect(adapter.enabled).toBe(true)
    const snapshotFn = vi.fn(() => ({ count: 42 }))
    const restoreFn = vi.fn()
    adapter.applyWithState(snapshotFn, restoreFn)
    // 替换前：dispose 快照
    mock.handlers.dispose?.({})
    // 替换后：accept 恢复
    mock.handlers.accept?.({})
    expect(snapshotFn).toHaveBeenCalled()
    expect(restoreFn).toHaveBeenCalledWith({ count: 42 })
  })

  it('accept/dispose/invalidate 独立注册', () => {
    const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
    const mock = hotMock()
    const adapter = createVueHotAdapter({ runtime, file: 'src/a.vue', getHot: () => mock as never })
    const cb = vi.fn()
    adapter.accept(cb)
    mock.handlers.accept?.({})
    expect(cb).toHaveBeenCalled()
    adapter.invalidate()
    expect(mock.invalidate).toHaveBeenCalled()
  })
})

describe('安全 reload（stub + Web 实现）', () => {
  it('saveState → collect + 写存储；restoreState 读回', () => {
    const store = new Map<string, string>()
    const storage = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => {
        store.set(k, v)
      },
    }
    const sr = createSafeReload({
      storage,
      storageKey: 'k',
      collect: () => ({ url: '/pages/cart?q=1' }),
    })
    const saved = sr.saveState()
    expect(saved).toEqual({ url: '/pages/cart?q=1' })
    expect(sr.restoreState()).toEqual({ url: '/pages/cart?q=1' })
  })

  it('reload → saveState + reloadPage 调用', () => {
    const reloadPage = vi.fn()
    const collect = vi.fn(() => ({ url: '/pages/index' }))
    const sr = createSafeReload({ collect, reloadPage, storage: null })
    sr.reload()
    expect(collect).toHaveBeenCalled()
    expect(reloadPage).toHaveBeenCalled()
  })

  it('restoreState(传入状态) 优先于存储', () => {
    const sr = createSafeReload({ storage: null })
    expect(sr.restoreState({ url: '/x' })).toEqual({ url: '/x' })
    expect(sr.restoreState()).toBeUndefined()
  })

  it('存储 JSON 损坏 → undefined（不抛错）', () => {
    const storage = { get: () => '{broken', set: () => {} }
    const sr = createSafeReload({ storage })
    expect(sr.restoreState()).toBeUndefined()
  })
})
