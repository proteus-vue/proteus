// tests/route-backtrack.test.ts —— @proteus-vue/devtools-runtime 路由回溯（devtools-plan M5/B5）
// beginNav/guardStart/guardEnd/finishNav 生命周期 + 守卫耗时/结果 + 回溯查询（pathTo/redirects/cancels）+ 环形缓冲 + clear
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouteBacktracker } from '@proteus-vue/devtools-runtime'
import type { RouteBacktracker } from '@proteus-vue/devtools-runtime'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** 可控时钟的导航序列 */
function runNav(b: RouteBacktracker, from: string, to: string, guards: Array<{ name: string; result: 'next' | 'redirect' | 'cancel' | 'error'; ms: number }>): void {
  const navId = b.beginNav({ path: from }, { path: to }, 't-' + to)
  for (const g of guards) {
    b.guardStart(navId, g.name)
    vi.advanceTimersByTime(g.ms)
    b.guardEnd(navId, g.result)
  }
  b.finishNav(navId)
}

describe('路由回溯：导航生命周期 + 守卫', () => {
  it('begin → guardStart/guardEnd（耗时 + 结果）→ finish（总耗时 + traceId）', () => {
    const b = createRouteBacktracker()
    const navId = b.beginNav({ path: '/a' }, { path: '/b', query: { q: '1' } }, 'trace-1')
    b.guardStart(navId, 'beforeEach')
    vi.advanceTimersByTime(12)
    b.guardEnd(navId, 'next')
    b.guardStart(navId, 'beforeEnter')
    vi.advanceTimersByTime(8)
    b.guardEnd(navId, 'next')
    b.finishNav(navId)
    const records = b.records()
    expect(records.length).toBe(1)
    const r = records[0]
    expect(r.from.path).toBe('/a')
    expect(r.to).toEqual({ path: '/b', query: { q: '1' } })
    expect(r.traceId).toBe('trace-1')
    expect(r.durationMs).toBe(20)
    expect(r.guards.length).toBe(2)
    expect(r.guards[0]).toMatchObject({ name: 'beforeEach', durationMs: 12, result: 'next' })
    expect(r.guards[1]).toMatchObject({ name: 'beforeEnter', durationMs: 8, result: 'next' })
  })

  it('守卫耗时瀑布对齐火焰图数据（同 traceId 可比对）', () => {
    const b = createRouteBacktracker()
    runNav(b, '/index', '/cart', [
      { name: 'auth', result: 'next', ms: 30 },
      { name: 'permission', result: 'redirect', ms: 15 },
    ])
    const r = b.records()[0]
    expect(r.guards.map((g) => [g.name, g.durationMs, g.result])).toEqual([
      ['auth', 30, 'next'],
      ['permission', 15, 'redirect'],
    ])
  })

  it('guardEnd 无进行中守卫 → 忽略；未知 navId → 全部忽略', () => {
    const b = createRouteBacktracker()
    const navId = b.beginNav({ path: '/a' }, { path: '/b' })
    b.guardEnd('ghost', 'next')
    b.guardEnd(navId, 'next') // 无 guardStart → 忽略
    b.finishNav(navId)
    const r = b.records()[0]
    expect(r.guards.length).toBe(0)
    b.finishNav('ghost')
    expect(b.records().length).toBe(1)
  })
})

describe('路由回溯：回溯查询', () => {
  it('pathTo 逆推父链（"怎么到这页"）', () => {
    const b = createRouteBacktracker()
    runNav(b, '/index', '/user/login', [{ name: 'auth', result: 'next', ms: 5 }])
    runNav(b, '/user/login', '/user/profile', [{ name: 'auth', result: 'next', ms: 5 }])
    const chain = b.pathTo('/user/profile')
    expect(chain.length).toBe(1)
    expect(chain[0].from.path).toBe('/user/login')
    expect(b.pathTo('/nonexistent').length).toBe(0)
  })

  it('redirects：高亮触发重定向的导航（"为什么重定向了"）', () => {
    const b = createRouteBacktracker()
    runNav(b, '/index', '/admin', [{ name: 'auth', result: 'redirect', ms: 5 }])
    runNav(b, '/index', '/settings', [{ name: 'auth', result: 'next', ms: 5 }])
    const redirs = b.redirects()
    expect(redirs.length).toBe(1)
    expect(redirs[0].to.path).toBe('/admin')
    expect(redirs[0].guards[0].result).toBe('redirect')
  })

  it('cancels：cancel/error 守卫（"为什么没跳转"）', () => {
    const b = createRouteBacktracker()
    runNav(b, '/index', '/pay', [{ name: 'login', result: 'cancel', ms: 5 }])
    runNav(b, '/index', '/share', [{ name: 'share', result: 'error', ms: 5 }])
    runNav(b, '/index', '/ok', [{ name: 'auth', result: 'next', ms: 5 }])
    const cancels = b.cancels()
    expect(cancels.length).toBe(2)
    expect(cancels.map((r) => r.to.path)).toEqual(['/pay', '/share'])
  })

  it('环形缓冲上限（最旧导航被裁剪）', () => {
    const b = createRouteBacktracker({ bufferSize: 3 })
    for (let i = 0; i < 5; i++) {
      runNav(b, '/p' + i, '/p' + (i + 1), [{ name: 'auth', result: 'next', ms: 1 }])
    }
    const records = b.records()
    expect(records.length).toBe(3)
    expect(records[0].from.path).toBe('/p2')
    expect(records[2].to.path).toBe('/p5')
  })

  it('clear 重置', () => {
    const b = createRouteBacktracker()
    runNav(b, '/a', '/b', [{ name: 'auth', result: 'next', ms: 1 }])
    b.clear()
    expect(b.records().length).toBe(0)
    expect(b.redirects().length).toBe(0)
    expect(b.cancels().length).toBe(0)
  })

  it('onEvent 可观测（begin/guard/finish 事件）', () => {
    const events: string[] = []
    const b = createRouteBacktracker({ onEvent: (e) => events.push(e.type + ':' + e.navId) })
    const navId = b.beginNav({ path: '/a' }, { path: '/b' })
    b.guardStart(navId, 'auth')
    b.guardEnd(navId, 'next')
    b.finishNav(navId)
    expect(events).toEqual(['begin:' + navId, 'guard:' + navId, 'finish:' + navId])
  })
})
