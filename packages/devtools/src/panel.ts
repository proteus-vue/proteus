// packages/devtools/src/panel.ts
// DevTools 面板装配（devtools-plan UI 层）：tab 布局 + 数据层收集器 + 五视图渲染
//   Timeline / Flamegraph / Errors 直接喂数据层收集器；Route 用轻量适配（router nav 事件 → NavRecord）；
//   State 展示 store 事件聚合快照 + 步骤列表（跨进程只读展示，timeTravel 命令经回调下发）
// ★铁律 1：UI 只消费事件流（TraceBus 唯一入口），不直接碰运行时
import {
  createTimelineCollector,
  createFlamegraphCollector,
  createErrorDiagnoser,
} from '@proteus-vue/devtools-runtime'
import type { TraceEvent, NavRecord } from '@proteus-vue/devtools-runtime'
import type { DevtoolsSource } from './source'
import { renderTimeline } from './views/timeline'
import { renderFlamegraph } from './views/flamegraph'
import { renderState } from './views/state'
import { renderRoute } from './views/route'
import { renderErrors } from './views/errors'

export interface DevtoolsPanelOptions {
  source: DevtoolsSource
  /** 时间旅行命令下发（缺省 no-op——业务侧适配器接入后生效） */
  onTimeTravel?: (index: number) => void
}

export interface DevtoolsPanel {
  destroy(): void
  /** 切换视图（'timeline' | 'flamegraph' | 'state' | 'route' | 'errors'） */
  show(view: string): void
}

const VIEWS = ['timeline', 'flamegraph', 'state', 'route', 'errors'] as const

const VIEW_ICONS: Record<string, string> = {
  timeline: '⊞',
  flamegraph: '▤',
  state: '☰',
  route: '⇄',
  errors: '✕',
}

export function createDevtoolsPanel(root: HTMLElement, options: DevtoolsPanelOptions): DevtoolsPanel {
  const { source, onTimeTravel } = options

  // ★布局骨架（Vue DevTools 质感）：顶栏 + 侧栏导航 + 内容区
  root.classList.add('pd-panel')
  root.replaceChildren()

  const header = document.createElement('div')
  header.className = 'pd-header'
  const title = document.createElement('div')
  title.className = 'pd-header-title'
  title.textContent = 'Proteus DevTools'
  header.appendChild(title)
  const status = document.createElement('div')
  status.className = 'pd-header-status'
  const dot = document.createElement('span')
  dot.className = 'pd-dot'
  const statusText = document.createElement('span')
  statusText.textContent = '连接中'
  status.appendChild(dot)
  status.appendChild(statusText)
  header.appendChild(status)
  root.appendChild(header)

  const bodyRow = document.createElement('div')
  bodyRow.className = 'pd-body-row'
  const sidebar = document.createElement('div')
  sidebar.className = 'pd-sidebar'
  const content = document.createElement('div')
  content.className = 'pd-content'
  bodyRow.appendChild(sidebar)
  bodyRow.appendChild(content)
  root.appendChild(bodyRow)

  const views = new Map<string, HTMLElement>()
  const containers = new Map<string, HTMLElement>()
  for (const v of VIEWS) {
    const item = document.createElement('div')
    item.className = 'pd-nav-item'
    item.dataset.view = v
    const icon = document.createElement('span')
    icon.className = 'pd-nav-icon'
    icon.textContent = VIEW_ICONS[v]
    const label = document.createElement('span')
    label.textContent = v
    item.appendChild(icon)
    item.appendChild(label)
    sidebar.appendChild(item)
    const container = document.createElement('div')
    container.className = 'pd-view'
    container.dataset.view = v
    views.set(v, container)
    containers.set(v, container)
    content.appendChild(container)
  }
  function show(view: string): void {
    for (const [k, el] of views) el.classList.toggle('pd-view-active', k === view)
    for (const el of Array.from(sidebar.children)) el.classList.toggle('pd-nav-active', (el as HTMLElement).dataset.view === view)
  }
  sidebar.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('.pd-nav-item') as HTMLElement | null
    if (t?.dataset.view) show(t.dataset.view)
  })

  // 数据层收集器
  const timeline = createTimelineCollector()
  const flame = createFlamegraphCollector()
  const errors = createErrorDiagnoser()
  /** Route 轻量适配：router nav 事件 → NavRecord */
  const navs: NavRecord[] = []
  const inflightNav = new Map<string, { record: NavRecord; endTs?: number }>()
  /** State 聚合：store 事件快照（按 storeId 最新） */
  const storeSnapshots = new Map<string, Record<string, unknown>>()
  const storeSteps: Array<{ index: number; storeId: string; payload: unknown; timestamp: number }> = []
  let stepSeq = 0

  function handleEvent(e: TraceEvent): void {
    timeline.ingest(e)
    flame.ingest(e)
    errors.ingest(e)
    // Route 适配
    if (e.source === 'router') {
      if (e.phase === 'start' && /nav/i.test(e.name)) {
        const p = (e.payload ?? {}) as { from?: { path?: string }; to?: { path?: string } }
        const id = e.traceId ?? e.name + '-' + e.timestamp
        inflightNav.set(id, {
          record: {
            id,
            from: { path: p.from?.path ?? '?' },
            to: { path: p.to?.path ?? e.name },
            guards: [],
            durationMs: 0,
            traceId: e.traceId,
            timestamp: e.timestamp,
          },
        })
      } else if (e.phase === 'end' && /nav/i.test(e.name)) {
        const id = e.traceId ?? e.name + '-' + e.timestamp
        const nav = inflightNav.get(id)
        if (nav) {
          nav.record.durationMs = Math.max(0, e.timestamp - nav.record.timestamp)
          navs.push(nav.record)
          inflightNav.delete(id)
          if (navs.length > 500) navs.shift()
        }
      } else if (/guard/i.test(e.name)) {
        // ★守卫事件（point/error）→ 附加到最近开始的进行中导航（守卫徽章）
        let target: { record: NavRecord } | null = null
        let targetTs = -Infinity
        for (const nav of inflightNav.values()) {
          if (nav.record.timestamp > targetTs) {
            target = nav
            targetTs = nav.record.timestamp
          }
        }
        if (target) {
          let result: 'next' | 'redirect' | 'cancel' | 'error' = 'next'
          if (/redirect/i.test(e.name)) result = 'redirect'
          else if (/cancel/i.test(e.name)) result = 'cancel'
          else if (/error/i.test(e.name)) result = 'error'
          target.record.guards.push({ name: e.name, durationMs: 0, result })
        }
      }
    }
    // State 聚合
    if (e.source === 'store') {
      if (e.phase === 'point' || e.phase === 'end') {
        const p = e.payload as Record<string, unknown> | undefined
        if (p && typeof p === 'object' && typeof p.id === 'string') {
          storeSnapshots.set(p.id, p)
        }
      }
      if (e.phase === 'point' && e.payload && typeof e.payload === 'object') {
        storeSteps.push({ index: stepSeq++, storeId: String((e.payload as { id?: string }).id ?? '?'), payload: e.payload, timestamp: e.timestamp })
        if (storeSteps.length > 1000) storeSteps.shift()
      }
    }
  }

  function rerender(): void {
    renderTimeline(containers.get('timeline') as HTMLElement, { spans: timeline.spans() })
    renderFlamegraph(containers.get('flamegraph') as HTMLElement, { nodes: flame.nodes() })
    renderErrors(containers.get('errors') as HTMLElement, { reports: errors.diagnose() })
    renderRoute(containers.get('route') as HTMLElement, { records: navs })
    renderState(
      containers.get('state') as HTMLElement,
      {
        snapshot: { version: 1, takenAt: Date.now(), stores: Array.from(storeSnapshots.entries()).map((kv) => ({ id: kv[0], state: kv[1] })) },
        steps: storeSteps.map((s) => ({ index: s.index, storeId: s.storeId, type: 'mutation', payload: s.payload, timestamp: s.timestamp, before: {}, after: {} })),
      },
      { onTimeTravel },
    )
  }

  // 渲染节流（事件高频 → 16ms 帧窗口）
  let renderTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleRender(): void {
    if (renderTimer) return
    renderTimer = setTimeout(() => {
      renderTimer = null
      rerender()
    }, 16)
  }
  let statusConnected = false
  const off = source.onEvent((e: TraceEvent) => {
    handleEvent(e)
    scheduleRender()
    // ★连接状态：收到首个事件 → 已连接
    if (!statusConnected) {
      statusConnected = true
      dot.classList.add('pd-dot-on')
      statusText.textContent = '已连接'
    }
  })

  // 火焰图录制控制（工具按钮）
  const fgControls = document.createElement('div')
  fgControls.className = 'pd-fg-controls'
  const recBtn = document.createElement('button')
  recBtn.className = 'pd-btn'
  recBtn.textContent = '开始录制'
  recBtn.addEventListener('click', () => {
    if (flame.recording) {
      flame.stop()
      recBtn.textContent = '开始录制'
    } else {
      flame.start()
      recBtn.textContent = '停止录制'
    }
    rerender()
  })
  fgControls.appendChild(recBtn)
  ;(containers.get('flamegraph') as HTMLElement).insertBefore(fgControls, (containers.get('flamegraph') as HTMLElement).firstChild)

  show('timeline')
  rerender()

  return {
    destroy() {
      off()
      source.close()
      if (renderTimer) clearTimeout(renderTimer)
      root.replaceChildren()
    },
    show,
  }
}
