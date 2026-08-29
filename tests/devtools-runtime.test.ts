// tests/devtools-runtime.test.ts
// ★devtools-plan B1：TraceBus（协议/环形缓冲/订阅/零开销门控）+ redact 脱敏 + 采样（error tail）+ traceId
import { describe, it, expect } from 'vitest'
import { createTraceBus, createTraceId, redactValue } from '../packages/devtools-runtime/src'

describe('TraceBus 零开销门控（生产默认关闭）', () => {
  it('enabled=false → emit noop（缓冲不增长、订阅不触发）', () => {
    const bus = createTraceBus()
    let hits = 0
    bus.on(() => hits++)
    bus.emit('router', 'point', 'router.beforeEach', { from: '/a' })
    bus.emit('component', 'point', 'component.render', { tag: 'p-view' })
    expect(bus.buffer.length).toBe(0)
    expect(hits).toBe(0)
    expect(bus.getEnabled()).toBe(false)
  })

  it('setEnabled(true) → emit 入缓冲 + 订阅触发 + 取消订阅生效', () => {
    const bus = createTraceBus()
    bus.setEnabled(true)
    const seen: string[] = []
    const off = bus.on((e) => seen.push(e.name))
    bus.emit('api', 'start', 'api.request', { url: '/x' })
    expect(bus.buffer.length).toBe(1)
    expect(bus.buffer[0].source).toBe('api')
    expect(bus.buffer[0].phase).toBe('start')
    expect(seen).toEqual(['api.request'])
    off()
    bus.emit('api', 'end', 'api.request', { url: '/x' })
    expect(seen.length).toBe(1) // 取消后不再触发
  })
})

describe('环形缓冲（满丢最旧，不抛错）', () => {
  it('超过 bufferSize → 丢弃最旧保留最新', () => {
    const bus = createTraceBus({ enabled: true, bufferSize: 3 })
    bus.emit('store', 'point', 'store.1')
    bus.emit('store', 'point', 'store.2')
    bus.emit('store', 'point', 'store.3')
    bus.emit('store', 'point', 'store.4')
    expect(bus.buffer.map((e) => e.name)).toEqual(['store.2', 'store.3', 'store.4'])
  })
})

describe('flush（面板推送）', () => {
  it('取出并清空缓冲', () => {
    const bus = createTraceBus({ enabled: true })
    bus.emit('compiler', 'point', 'compiler.rule', { rule: 'tag/div-to-view' })
    const batch = bus.flush()
    expect(batch.length).toBe(1)
    expect(bus.buffer.length).toBe(0)
  })
})

describe('redactValue 脱敏（递归 + 大小写不敏感）', () => {
  it('嵌套对象 / 数组 / Map / Set / Date', () => {
    const out = redactValue(
      {
        user: { token: 'abc', name: 'P' },
        list: [{ password: 'x' }, { phone: '138' }],
        map: new Map([['authorization', 'Bearer x'], ['ok', 1]]),
        set: new Set(['token-in-set', 'plain']),
        when: new Date('2024-01-01T00:00:00Z'),
        Token: 'upper',
      },
      ['password', 'token', 'authorization', 'idcard', 'phone'],
    ) as Record<string, unknown>
    expect((out.user as Record<string, unknown>).token).toBe('[REDACTED]')
    expect((out.user as Record<string, unknown>).name).toBe('P')
    expect((out.list as Array<Record<string, unknown>>)[0].password).toBe('[REDACTED]')
    expect(out.when).toBe('2024-01-01T00:00:00.000Z')
    expect(out.Token).toBe('[REDACTED]') // 大小写不敏感
    // Map：键命中脱敏、值递归
    const mapOut = out.map as Array<[string, unknown]>
    expect(mapOut[0][1]).toBe('[REDACTED]')
    expect(mapOut[1][1]).toBe(1)
  })

  it('emit 时 payload 自动脱敏', () => {
    const bus = createTraceBus({ enabled: true })
    bus.emit('api', 'start', 'api.request', { url: '/login', payload: { password: 'secret', email: 'a@b.c' } })
    const e = bus.buffer[0]
    expect((e.payload as Record<string, Record<string, unknown>>).payload.password).toBe('[REDACTED]')
    expect((e.payload as Record<string, Record<string, unknown>>).payload.email).toBe('a@b.c')
  })
})

describe('采样（traceId hash + error tail sampling）', () => {
  it('sampleRate=0 → 普通事件全跳过；error 事件强制入缓冲', () => {
    const bus = createTraceBus({ enabled: true, sampleRate: 0 })
    bus.emit('router', 'point', 'router.push', { to: '/b' }, 'trace-1')
    expect(bus.buffer.length).toBe(0)
    bus.emit('router', 'error', 'router.guard', { to: '/b' }, 'trace-1')
    expect(bus.buffer.length).toBe(1)
    expect(bus.buffer[0].phase).toBe('error')
  })
})

describe('createTraceId', () => {
  it('批量生成唯一（跨源串联用）', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(createTraceId())
    expect(ids.size).toBe(1000)
  })
})
