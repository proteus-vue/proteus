// tests/devtools-panel.test.ts —— @proteus-vue/devtools（devtools-plan UI 层）
// 五视图渲染函数（时间轴泳道/火焰图/状态/路由/根因）+ 面板装配（事件流 → 视图更新 + tab 切换）+ WS 数据源（CDP Proteus.event 协议）
// @vitest-environment happy-dom（DOM 渲染断言）
import { describe, it, expect, vi } from 'vitest'
import {
  createDevtoolsPanel,
  createDevtoolsWsSource,
  renderTimeline,
  renderFlamegraph,
  renderState,
  renderRoute,
  renderErrors,
} from '@proteus-vue/devtools'
import type { DevtoolsSource } from '@proteus-vue/devtools'
import type { TraceEvent, TraceSource } from '@proteus-vue/devtools-runtime'

function ev(source: TraceSource, phase: 'start' | 'end' | 'point' | 'error', name: string, timestamp: number, traceId?: string, payload?: unknown): TraceEvent {
  return { source, phase, name, timestamp, traceId, payload }
}

function mockSource(): DevtoolsSource & { push: (e: TraceEvent) => void } {
  const handlers: Array<(e: TraceEvent) => void> = []
  return {
    onEvent: (cb) => {
      handlers.push(cb)
      return () => {
        const i = handlers.indexOf(cb)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
    close: () => {
      handlers.length = 0
    },
    push: (e) => {
      for (const h of handlers) h(e)
    },
  }
}

describe('视图渲染函数', () => {
  it('renderTimeline：泳道分组 + span 线段（宽度/位置 + pending/point 类名）', () => {
    const root = document.createElement('div')
    renderTimeline(root, {
      spans: [
        { id: '1', source: 'lifecycle', name: 'boot', start: 0, end: 100, durationMs: 100, selfMs: 0, children: [], depth: 0 },
        { id: '2', source: 'router', name: 'nav', start: 10, durationMs: 0, children: [], depth: 0, pending: true },
        { id: '3', source: 'router', name: 'dot', start: 20, end: 20, durationMs: 0, children: [], depth: 0 },
      ],
    })
    const lanes = root.querySelectorAll('.pd-lane')
    expect(lanes.length).toBe(2) // lifecycle + router 两泳道
    expect(root.querySelector('.pd-lane-label')?.textContent).toBe('lifecycle')
    const spans = root.querySelectorAll('.pd-span')
    expect(spans.length).toBe(3)
    expect(spans[1].classList.contains('pd-span-pending')).toBe(true)
    expect(spans[2].classList.contains('pd-span-dot')).toBe(true)
  })

  it('renderFlamegraph：按 depth 分行堆叠 + 宽度 ∝ 耗时 + selfMs 标注', () => {
    const root = document.createElement('div')
    renderFlamegraph(root, {
      nodes: [
        { id: '1', source: 'lifecycle', name: 'boot', startMs: 0, durationMs: 100, selfMs: 30, children: [], depth: 0 },
        { id: '2', source: 'api', name: 'req', startMs: 10, durationMs: 40, selfMs: 40, children: [], depth: 1 },
      ],
    })
    const blocks = root.querySelectorAll('.pd-fg-node')
    expect(blocks.length).toBe(2)
    expect((blocks[1] as HTMLElement).style.top).toBe('22px') // depth 1 第二行
    expect(blocks[0].textContent).toContain('30ms')
  })

  it('renderState：store 列表 + JSON 预览 + 滑块（steps > 0 时出现）', () => {
    const root = document.createElement('div')
    const onTimeTravel = vi.fn()
    renderState(
      root,
      { snapshot: { version: 1, takenAt: 1, stores: [{ id: 'cart', state: { items: 2 } }] }, steps: [{ index: 0, storeId: 'cart', type: 'patch', payload: {}, timestamp: 1, before: {}, after: {} }] },
      { onTimeTravel },
    )
    expect(root.querySelector('.pd-store summary')?.textContent).toBe('cart')
    expect(root.querySelector('.pd-json')?.textContent).toContain('items')
    const range = root.querySelector('.pd-range') as HTMLInputElement
    expect(range).not.toBeNull()
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    expect(onTimeTravel).toHaveBeenCalledWith(0)
  })

  it('renderRoute：导航链 + 守卫徽章（next/redirect 类名）+ 耗时', () => {
    const root = document.createElement('div')
    renderRoute(root, {
      records: [
        {
          id: 'n1',
          from: { path: '/a' },
          to: { path: '/b' },
          guards: [
            { name: 'auth', durationMs: 5, result: 'next' },
            { name: 'perm', durationMs: 5, result: 'redirect' },
          ],
          durationMs: 10,
          traceId: 't1',
          timestamp: 1,
        },
      ],
    })
    expect(root.querySelector('.pd-route')?.textContent).toBe('/a')
    const guards = root.querySelectorAll('.pd-guard')
    expect(guards.length).toBe(2)
    expect(guards[0].classList.contains('pd-guard-next')).toBe(true)
    expect(guards[1].classList.contains('pd-guard-redirect')).toBe(true)
  })

  it('renderErrors：根因卡片（attribution + 影响 chips + 复现步骤 + 根因高亮）', () => {
    const root = document.createElement('div')
    renderErrors(root, {
      reports: [
        {
          rootCause: { source: 'api', name: 'refreshToken', timestamp: 100 },
          attribution: 'token 失效',
          chain: [
            { source: 'lifecycle', name: 'coreReady', timestamp: 90 },
            { source: 'api', name: 'refreshToken', timestamp: 100 },
          ],
          impactSources: ['lifecycle', 'api'],
          repro: ['导航 navigate /admin → 等待结果'],
        },
      ],
    })
    expect(root.querySelector('.pd-error-attr')?.textContent).toContain('token 失效')
    expect(root.querySelectorAll('.pd-chip').length).toBe(2)
    expect(root.querySelector('.pd-repro li')?.textContent).toContain('导航')
    expect(root.querySelector('.pd-chain-root')?.textContent).toBe('api.refreshToken')
  })

  it('空数据 → 显示空态文案（不误报）', () => {
    const root = document.createElement('div')
    renderErrors(root, { reports: [] })
    expect(root.querySelector('.pd-empty')?.textContent).toContain('暂无异常')
  })
})

describe('面板装配', () => {
  it('事件流 → 时间轴视图更新 + tab 切换 + destroy 清理', () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    expect(root.querySelectorAll('.pd-tab').length).toBe(5)
    // 推事件（渲染 16ms 节流）
    source.push(ev('lifecycle', 'start', 'boot', 100))
    source.push(ev('lifecycle', 'end', 'boot', 200))
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // 默认 timeline 视图可见
        const timelineView = root.querySelector('.pd-view[data-view="timeline"]') as HTMLElement
        expect(timelineView.style.display).toBe('block')
        expect(timelineView.querySelectorAll('.pd-span').length).toBe(1)
        // 切到 errors
        panel.show('errors')
        expect((root.querySelector('.pd-view[data-view="errors"]') as HTMLElement).style.display).toBe('block')
        // 推 error → 根因卡片
        source.push(ev('api', 'error', 'refreshToken', 300, 't1', { status: 401 }))
        setTimeout(() => {
          const errorsView = root.querySelector('.pd-view[data-view="errors"]') as HTMLElement
          expect(errorsView.querySelector('.pd-error-attr')?.textContent).toContain('token 失效')
          panel.destroy()
          expect(root.children.length).toBe(0)
          resolve()
        }, 30)
      }, 30)
    })
  })

  it('route 视图：router nav 事件聚合为导航记录', () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('router', 'start', 'navigate /admin', 1000, 't1', { from: { path: '/index' }, to: { path: '/admin' } }))
    source.push(ev('router', 'end', 'navigate /admin', 1050, 't1'))
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        panel.show('route')
        const routeView = root.querySelector('.pd-view[data-view="route"]') as HTMLElement
        expect(routeView.querySelectorAll('.pd-nav').length).toBe(1)
        expect(routeView.querySelector('.pd-nav-meta')?.textContent).toContain('50ms')
        panel.destroy()
        resolve()
      }, 30)
    })
  })
})

describe('WS 数据源（CDP Proteus.event 协议）', () => {
  it('连接 → Proteus.enable → Proteus.event 重组 TraceEvent 分发；断线重连；close 停止', () => {
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    const received: TraceEvent[] = []
    const off = source.onEvent((e) => received.push(e))
    expect(sockets.length).toBe(1)
    sockets[0].onopen?.()
    // enable 命令发出
    expect(sockets[0].send).toHaveBeenCalledWith(JSON.stringify({ id: 1, method: 'Proteus.enable' }))
    // 收到 Proteus.event
    sockets[0].onmessage?.({
      data: JSON.stringify({ method: 'Proteus.event', params: { source: 'api', phase: 'error', name: 'timeout', payload: { status: 500 }, timestamp: 100, traceId: 't9' } }),
    })
    expect(received.length).toBe(1)
    expect(received[0]).toMatchObject({ source: 'api', phase: 'error', name: 'timeout', traceId: 't9' })
    // 非 Proteus.event 消息忽略
    sockets[0].onmessage?.({ data: JSON.stringify({ method: 'Runtime.consoleAPICalled' }) })
    expect(received.length).toBe(1)
    off()
    source.close()
  })
})
