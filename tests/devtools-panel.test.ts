// tests/devtools-panel.test.ts —— @proteus-vue/devtools（devtools-plan UI 层）
// 五视图渲染函数（时间轴泳道/火焰图/状态/路由/根因）+ 面板装配（事件流 → 视图更新 + tab 切换）+ WS 数据源（CDP Proteus.event 协议）
// ★Vue DevTools 接入：installProteusTimeline（Timeline layer + 事件映射）+ createTraceBusSource（TraceBus 直连源）
// @vitest-environment happy-dom（DOM 渲染断言）
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createDevtoolsPanel,
  createDevtoolsWsSource,
  installProteusTimeline,
  createTraceBusSource,
  renderTimeline,
  renderFlamegraph,
  renderState,
  renderRoute,
  renderErrors,
  createTooltipLayer,
  bindTooltip,
} from '@proteus-vue/devtools'
import type { DevtoolsSource } from '@proteus-vue/devtools'
import { createTraceBus } from '@proteus-vue/devtools-runtime'
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
    // hover 浮层数据（attachTip → data-tip 标记 + 耗时行）
    expect((spans[0] as HTMLElement).dataset.tip).toBeDefined()
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
    expect((blocks[0] as HTMLElement).dataset.tip).toBeDefined()
  })

  it('renderState：store 列表 + inspector key-value 树 + 类型着色 + 滑块（steps > 0 时出现）', () => {
    const root = document.createElement('div')
    const onTimeTravel = vi.fn()
    renderState(
      root,
      { snapshot: { version: 1, takenAt: 1, stores: [{ id: 'cart', state: { items: 2, label: 'x', ok: true } }] }, steps: [{ index: 0, storeId: 'cart', type: 'patch', payload: {}, timestamp: 1, before: {}, after: {} }] },
      { onTimeTravel },
    )
    expect(root.querySelector('.pd-store summary')?.textContent).toBe('cart')
    // key-value 树：键 + 类型着色值
    const kvs = root.querySelectorAll('.pd-kv')
    expect(kvs.length).toBe(4) // (root) + items + label + ok
    expect(root.querySelector('.pd-kv-key')?.textContent).toBe('(root)')
    const itemsRow = Array.from(kvs).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'items')
    expect(itemsRow?.querySelector('.pd-kv-value')?.classList.contains('pd-t-number')).toBe(true)
    const okRow = Array.from(kvs).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'ok')
    expect(okRow?.querySelector('.pd-kv-value')?.classList.contains('pd-t-boolean')).toBe(true)
    const range = root.querySelector('.pd-range') as HTMLInputElement
    expect(range).not.toBeNull()
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    expect(onTimeTravel).toHaveBeenCalledWith(0)
  })

  it('renderState：嵌套对象可折叠（点击展开子键）', () => {
    const root = document.createElement('div')
    renderState(root, {
      snapshot: { version: 1, takenAt: 1, stores: [{ id: 'user', state: { profile: { name: 'p', age: 3 } } }] },
      steps: [],
    })
    const profileRow = Array.from(root.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'profile')
    expect(profileRow?.querySelector('.pd-kv-value')?.textContent).toContain('Object')
    // 展开前子键不可见
    expect(Array.from(root.querySelectorAll('.pd-kv-key')).some((k) => k.textContent === 'name')).toBe(false)
    profileRow?.dispatchEvent(new Event('click'))
    expect(Array.from(root.querySelectorAll('.pd-kv-key')).some((k) => k.textContent === 'name')).toBe(true)
    expect(Array.from(root.querySelectorAll('.pd-kv-key')).some((k) => k.textContent === 'age')).toBe(true)
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
    expect((guards[0] as HTMLElement).dataset.tip).toBeDefined()
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
  it('事件流 → 时间轴视图更新 + 侧栏导航切换 + 连接状态 + destroy 清理', () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    expect(root.querySelectorAll('.pd-nav-item').length).toBe(5)
    expect(root.querySelector('.pd-header-status')?.textContent).toContain('连接中')
    // 推事件（渲染 16ms 节流）
    source.push(ev('lifecycle', 'start', 'boot', 100))
    source.push(ev('lifecycle', 'end', 'boot', 200))
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // 已连接状态（收到事件）
        expect(root.querySelector('.pd-header-status')?.textContent).toContain('已连接')
        expect(root.querySelector('.pd-dot')?.classList.contains('pd-dot-on')).toBe(true)
        // 默认 timeline 视图可见
        const timelineView = root.querySelector('.pd-view[data-view="timeline"]') as HTMLElement
        expect(timelineView.classList.contains('pd-view-active')).toBe(true)
        expect(timelineView.querySelectorAll('.pd-span').length).toBe(1)
        // 切到 errors
        panel.show('errors')
        expect((root.querySelector('.pd-view[data-view="errors"]') as HTMLElement).classList.contains('pd-view-active')).toBe(true)
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

describe('Vue DevTools 接入：Timeline 适配器', () => {
  function mockApi() {
    const calls: Array<{ method: string; options: unknown }> = []
    return {
      calls,
      api: {
        addTimelineLayer: (options: unknown) => calls.push({ method: 'addTimelineLayer', options }),
        addTimelineEvent: (options: unknown) => calls.push({ method: 'addTimelineEvent', options }),
      },
    }
  }

  it('installProteusTimeline：注册 proteus layer + 事件映射（time/title/data/groupId）', () => {
    const { calls, api } = mockApi()
    const source = mockSource()
    const tl = installProteusTimeline(api as never, { source })
    expect(tl.layerId).toBe('proteus')
    // layer 注册
    const layer = calls[0] as { method: string; options: { id: string; label: string } }
    expect(layer.method).toBe('addTimelineLayer')
    expect(layer.options.id).toBe('proteus')
    expect(layer.options.label).toBe('Proteus')
    // 推事件 → TimelineEvent 映射
    source.push(ev('api', 'error', 'refreshToken', 1000, 't1', { status: 401 }))
    const evt = calls[1] as { method: string; options: { layerId: string; event: { time: number; title: string; data: { source: string }; groupId: string } } }
    expect(evt.method).toBe('addTimelineEvent')
    expect(evt.options.layerId).toBe('proteus')
    expect(evt.options.event.time).toBe(1000)
    expect(evt.options.event.title).toBe('api.refreshToken')
    expect(evt.options.event.data.source).toBe('api')
    expect(evt.options.event.groupId).toBe('t1') // 按 traceId 分组
    tl.dispose()
    source.push(ev('api', 'point', 'after-dispose', 2000))
    expect(calls.length).toBe(2) // dispose 后不再推送
  })

  it('无 traceId → groupId 回退为 source', () => {
    const { calls, api } = mockApi()
    const source = mockSource()
    const tl = installProteusTimeline(api as never, { source })
    source.push(ev('router', 'start', 'nav', 500))
    const evt = calls[1] as { options: { event: { groupId: string } } }
    expect(evt.options.event.groupId).toBe('router')
    tl.dispose()
  })

  it('createTraceBusSource：TraceBus 事件 → DevtoolsSource 分发', () => {
    const bus = createTraceBus()
    bus.setEnabled(true)
    const source = createTraceBusSource(bus)
    const received: TraceEvent[] = []
    const off = source.onEvent((e) => received.push(e))
    bus.emit('lifecycle', 'point', 'boot', undefined, 't9')
    expect(received.length).toBe(1)
    expect(received[0]).toMatchObject({ source: 'lifecycle', name: 'boot', traceId: 't9' })
    off()
    bus.emit('lifecycle', 'point', 'boot-2')
    expect(received.length).toBe(1)
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

describe('Tooltip 浮层', () => {
  afterEach(() => {
    document.querySelectorAll('.pd-tooltip').forEach((el) => el.remove())
    vi.useRealTimers()
  })

  it('createTooltipLayer：show 渲染标题 + 详情行 + visible；hide 清空隐藏', () => {
    const layer = createTooltipLayer()
    expect(layer.visible).toBe(false)
    layer.show({ title: 'lifecycle.boot', lines: ['耗时 100ms', '阶段 completed'] }, 10, 10)
    expect(layer.visible).toBe(true)
    const tip = document.querySelector('.pd-tooltip') as HTMLElement
    expect(tip).not.toBeNull()
    expect(tip.querySelector('.pd-tooltip-title')?.textContent).toBe('lifecycle.boot')
    expect(Array.from(tip.querySelectorAll('.pd-tooltip-line')).map((l) => l.textContent)).toEqual(['耗时 100ms', '阶段 completed'])
    layer.hide()
    expect(layer.visible).toBe(false)
    expect(tip.style.display).toBe('none')
  })

  it('createTooltipLayer：视口边缘翻转（右侧放不下 → 左侧定位）', () => {
    const layer = createTooltipLayer()
    layer.show({ title: 't', lines: ['l'] }, window.innerWidth - 10, 10)
    const tip = document.querySelector('.pd-tooltip') as HTMLElement
    expect(parseFloat(tip.style.left)).toBeLessThan(window.innerWidth - 10)
    layer.hide()
  })

  it('bindTooltip：150ms 防抖（快速划过不显示）+ resolve null 不显示 + 解绑后不触发', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const el = document.createElement('div')
    el.dataset.tip = ''
    el.textContent = 'boot'
    root.appendChild(el)
    const nullEl = document.createElement('div')
    nullEl.dataset.tip = ''
    nullEl.textContent = 'skip'
    root.appendChild(nullEl)
    const layer = createTooltipLayer()
    const resolve = vi.fn((t: HTMLElement) => (t.textContent === 'skip' ? null : { title: 'hit', lines: [t.textContent ?? ''] }))
    const unbind = bindTooltip(root, layer, resolve)
    // 快速划过：150ms 内移出 → 不显示
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 }))
    root.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    vi.advanceTimersByTime(200)
    expect(layer.visible).toBe(false)
    // resolve null → 不显示
    nullEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 }))
    vi.advanceTimersByTime(200)
    expect(layer.visible).toBe(false)
    // 稳定 hover 150ms → 显示
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }))
    vi.advanceTimersByTime(150)
    expect(resolve).toHaveBeenCalled()
    expect(layer.visible).toBe(true)
    expect(document.querySelector('.pd-tooltip-title')?.textContent).toBe('hit')
    // 解绑后不再触发
    unbind()
    layer.hide()
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 20, clientY: 20 }))
    vi.advanceTimersByTime(200)
    expect(layer.visible).toBe(false)
    root.remove()
  })

  it('面板：hover timeline span → tooltip 显示事件详情（attachTip 数据贯通）', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('lifecycle', 'start', 'boot', 100))
    source.push(ev('lifecycle', 'end', 'boot', 200))
    vi.advanceTimersByTime(40) // 16ms 节流渲染
    const span = root.querySelector('.pd-span') as HTMLElement
    expect(span).not.toBeNull()
    expect(span.dataset.tip).toBeDefined()
    span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }))
    vi.advanceTimersByTime(200)
    expect(document.querySelector('.pd-tooltip-title')?.textContent).toBe('lifecycle.boot')
    expect(document.querySelector('.pd-tooltip-line')?.textContent).toBe('耗时 100ms')
    panel.destroy()
    root.remove()
  })
})
