// packages/devtools/src/install.ts
// ★一键接入（收口散接线，vue-devtools-plan §7「DevTools 后端作为开发模式注入」的 API 形态）：
//   installProteusDevtools(app, options) —— 一行完成 Web 端全部 devtools 接线：
//   ① TraceBus（getProteusTraceBus 惰性单例——router/api/capability 发射端同源）
//   ② Vue DevTools 插件（Proteus Timeline layer + app-config/style-safety 自定义 Inspector）
//   ③ store 追踪（createStoreTracer）+ 组件树（installComponentTrace）
//   ④ 本地面板浮动挂载（◈ 按钮，八视图）
// 业务侧不再需要手建 devtools-bus.ts / devtools-panel-mount.ts / devtools-panel.css
import type { App } from 'vue'
import { getProteusTraceBus, createStoreTracer } from '@proteus-vue/devtools-runtime'
import type { TraceBus } from '@proteus-vue/devtools-runtime'
import { setupDevtoolsPlugin } from '@vue/devtools-api'
import { installProteusTimeline, installProteusInspectors, PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR } from './vue-devtools'
import { createTraceBusSource } from './source'
import { createTraceBusWsBridge } from './ws-bridge'
import type { TraceBusWsBridge } from './ws-bridge'
import { installComponentTrace } from './component-trace'
import { buildDomTree } from './component-trace'
import type { DomTreeNode } from './component-trace'
import { createDevtoolsPanel } from './panel'
import { setCapabilityTraceBus } from '@proteus-vue/capabilities'
import type { PagesViewData } from './views/pages'

/** style-safety 守卫的结构类型（零硬依赖——@proteus-vue/style-safety 实例直接可传） */
export interface StyleGuardLike {
  records(): Array<{ prop: string; value: unknown; reason: string; ts: number }>
}

/** pinia 实例结构类型（createStoreTracer 消费 + onApplyState 状态恢复） */
export interface PiniaLike {
  use(fn: (ctx: { store: unknown }) => void): unknown
  _s: Map<string, { $patch(state: Record<string, unknown>): void }>
}

/** vite import.meta.hot 结构类型（HMR 事件 → TraceBus；零硬依赖，业务侧传 import.meta.hot） */
export interface HmrLike {
  on(event: string, cb: (...args: unknown[]) => void): (() => void) | void
}

export interface InstallDevtoolsOptions {
  /** pinia 实例（提供 → store 变更追踪：面板 state 视图 + Pinia Inspector 原生） */
  pinia?: PiniaLike
  /** app-config 读取（App Config Inspector 数据源；缺省空对象） */
  getConfig?: () => Record<string, unknown>
  /** app-config 更新（编辑回写双向调试） */
  setConfig?: (patch: Record<string, unknown>) => void
  /** style-safety 守卫（提供 → Style Safety Inspector 拦截记录数据源） */
  styleGuard?: StyleGuardLike
  /** 本地面板 pages 数据（路由表 + 页面栈 → pages/依赖图面板） */
  pages?: PagesViewData
  /** 是否挂载本地面板浮动窗口（缺省 true；仅挂载一次——重复调用复用） */
  mount?: boolean
  /** vite HMR 句柄（传 import.meta.hot）：热更新事件 → TraceBus（timeline 显示 vite:update/full-reload/error 记录） */
  hmr?: HmrLike
  /**
   * 远程查看（移动端/真机场景）：TraceBus → WS（devtoolsRelayPlugin 的 /proteus-source 端点）→
   * 电脑浏览器 panel.html?ws= 下行查看。true = 同源自动（ws://location.host/proteus-source）；
   * 对象形态可指定 path 与 appInfo（默认取 pages 数据）
   */
  remote?: boolean | { path?: string; appInfo?: () => unknown }
  /** 显式 traceBus（缺省 getProteusTraceBus 惰性单例） */
  traceBus?: TraceBus
}

export interface InstalledDevtools {
  /** 业务侧发射端注入用（与 getProteusTraceBus 同实例） */
  traceBus: TraceBus
  /** 卸载：store tracer dispose + 组件树订阅解绑 + 面板移除 */
  destroy(): void
}

let panelMounted = false
let panel: { destroy(): void } | null = null

function mountFloatingPanel(
  bus: TraceBus,
  pages: PagesViewData | undefined,
  applyState: (stores: Array<{ id: string; state: Record<string, unknown> }>) => void,
  selectComponent: (id: number) => void,
): void {
  if (panelMounted) return
  panelMounted = true
  const btn = document.createElement('button')
  btn.className = 'pd-floating-toggle'
  btn.textContent = '◈'
  btn.title = 'Proteus DevTools'
  const host = document.createElement('div')
  host.className = 'pd-floating-host'
  host.style.display = 'none'
  document.body.appendChild(btn)
  document.body.appendChild(host)
  btn.addEventListener('click', () => {
    if (host.style.display !== 'none') {
      host.style.display = 'none'
      return
    }
    host.style.display = 'block'
    if (!panel) {
      panel = createDevtoolsPanel(host, {
        source: createTraceBusSource(bus),
        pages,
        // ★P0：时间旅行回放 / 导入快照恢复 → 逐 store $patch 写回（结构类型零硬依赖；无 pinia → 仅面板内展示）
        onApplyState: applyState,
        // ★P1：组件视图选中 → 页面元素高亮（scrollIntoView + 描边闪烁）
        onSelectComponent: selectComponent,
      })
    }
  })
}

/**
 * 一键接入 Web 端 devtools（开发模式调用；生产 import.meta.env.DEV=false 且无 PROTEUS_DEBUG=1 时 bus 零开销 + 本地面板守卫挂载无事件）
 * 用法（main.ts，interactive 阶段）：
 *   const devtools = installProteusDevtools(app, { pinia, getConfig, setConfig, styleGuard, pages })
 *   // 发射端同源：createRouter(routes, { traceBus: getProteusTraceBus() }) / createApi({ traceBus: getProteusTraceBus() })
 */
export function installProteusDevtools(app: App, options: InstallDevtoolsOptions = {}): InstalledDevtools {
  const bus = options.traceBus ?? getProteusTraceBus()
  // ① capability 发射端（探测/降级事件；未注册能力零事件）
  setCapabilityTraceBus(bus as never)

  // ② store 追踪（pinia 实例提供时）
  let storeTracer: { dispose(): void } | null = null
  if (options.pinia) {
    storeTracer = createStoreTracer(options.pinia as never, bus)
  }

  // ③ 组件树（component.mount/unmount 事件 + 元素 registry——P1 页面高亮）
  const componentTrace = installComponentTrace(app, bus)

  /** ★P1 组件高亮：选中组件 → 滚动到可视区 + 描边闪烁（pd-cmp-highlight 样式，1.5s 消退）+ DOM 树下发（事件流 → 面板详情） */
  function highlightComponent(id: number): void {
    const el = componentTrace.getElement(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('pd-cmp-highlight')
    setTimeout(() => el.classList.remove('pd-cmp-highlight'), 1500)
    // ★P1.5：选中组件 → 渲染元素树摘要经事件流下发（component.inspect）——本地/远程面板同源可见
    const dom = buildDomTree(el)
    bus.emit('component', 'point', 'component.inspect', { id, dom }, 'comp-' + id)
  }

  // ④ Vue DevTools 插件：Timeline layer + 自定义 Inspector
  // ★Router Inspector 动态数据：聚合 router 导航记录（当前路由 + 最近导航历史——完整状态：from/to/耗时/守卫链/traceId）
  interface NavRec {
    from: string
    to: string
    query?: Record<string, string>
    durationMs: number
    timestamp: number
    traceId?: string
    guards: Array<{ name: string; result: 'next' | 'cancel' | 'redirect' | 'error' }>
  }
  const navRecords: NavRec[] = []
  let navCurrent = ''
  let navInflight: { from: string; to: string; query?: Record<string, string>; start: number; traceId?: string; guards: NavRec['guards'] } | null = null
  const offNav = bus.on((e) => {
    if (e.source !== 'router') return
    if (e.phase === 'start' && /nav/i.test(e.name)) {
      const p = (e.payload ?? {}) as { from?: { path?: string }; to?: { path?: string; query?: Record<string, string> } }
      navInflight = { from: p.from?.path ?? '?', to: p.to?.path ?? e.name, query: p.to?.query, start: e.timestamp, traceId: e.traceId, guards: [] }
    } else if (navInflight && e.phase === 'point' && /guard/i.test(e.name)) {
      // 守卫事件（point）→ 附加到进行中导航（对齐 panel 的 guards 徽章逻辑）
      let result: NavRec['guards'][number]['result'] = 'next'
      if (/redirect/i.test(e.name)) result = 'redirect'
      else if (/cancel/i.test(e.name)) result = 'cancel'
      else if (/error/i.test(e.name)) result = 'error'
      navInflight.guards.push({ name: e.name, result })
    } else if (e.phase === 'end' && /nav/i.test(e.name) && navInflight) {
      const rec: NavRec = {
        from: navInflight.from,
        to: navInflight.to,
        query: navInflight.query,
        durationMs: Math.max(0, e.timestamp - navInflight.start),
        timestamp: e.timestamp,
        traceId: e.traceId ?? navInflight.traceId,
        guards: navInflight.guards,
      }
      navRecords.push(rec)
      navCurrent = rec.to
      if (navRecords.length > 50) navRecords.shift()
      navInflight = null
    }
  })
  // ★descriptor.logo 必须设置（Vue DevTools 8.2.1 导航图标只渲染 descriptor.logo，
  //   未传 → 三个自定义 Inspector 全默认图标；占位值触发 img error → fallback 字典图标，详见 vue-devtools.ts）
  setupDevtoolsPlugin({ ...PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR, app }, (devtoolsApi) => {
    installProteusTimeline(devtoolsApi as never, { source: createTraceBusSource(bus) })
    installProteusInspectors(devtoolsApi as never, {
      getConfig: options.getConfig,
      setConfig: options.setConfig,
      getStyleSafetyRecords: options.styleGuard ? () => options.styleGuard?.records() ?? [] : undefined,
      pages: options.pages as never,
      getRouterState: () => ({ currentRoute: navCurrent || undefined, records: [...navRecords] }),
    })
  })

  // ⑤ 本地面板浮动挂载
  if (options.mount !== false) {
    mountFloatingPanel(
      bus,
      options.pages,
      (stores) => {
        if (!options.pinia) return
        for (const s of stores) {
          const store = options.pinia._s.get(s.id)
          store?.$patch?.(s.state)
        }
      },
      highlightComponent,
    )
  }

  // ⑥ 远程查看桥（移动端/真机：事件流上行 WS → 电脑端 panel.html 下行）
  let remoteBridge: TraceBusWsBridge | null = null
  if (options.remote) {
    const remoteOpts = typeof options.remote === 'object' ? options.remote : null
    const path = remoteOpts !== null && remoteOpts.path ? remoteOpts.path : '/proteus-source'
    const protocol = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${typeof location !== 'undefined' ? location.host : 'localhost'}${path}`
    remoteBridge = createTraceBusWsBridge(bus, {
      url,
      appInfo: remoteOpts !== null && remoteOpts.appInfo ? remoteOpts.appInfo : () => options.pages,
    })
  }

  // ⑦ HMR 事件源（vite 热更新 → TraceBus：timeline 显示热更新记录；业务侧传 import.meta.hot）
  // ★事件名用 vite client 实际派发的 custom 事件（vite:beforeUpdate/vite:beforeFullReload/vite:error——vite:update 不存在）
  let offHmr: (() => void) | null = null
  if (options.hmr) {
    const offs: Array<(() => void) | null> = []
    offs.push(options.hmr.on('vite:beforeUpdate', () => bus.emit('hmr', 'point', 'vite:update')) ?? null)
    offs.push(options.hmr.on('vite:beforeFullReload', () => bus.emit('hmr', 'point', 'vite:full-reload')) ?? null)
    offs.push(
      options.hmr.on('vite:error', (err) =>
        bus.emit('hmr', 'error', 'vite:error', { message: err instanceof Error ? err.message : String(err) }),
      ) ?? null,
    )
    offHmr = () => {
      for (const f of offs) f?.()
    }
  }

  return {
    traceBus: bus,
    destroy() {
      storeTracer?.dispose()
      componentTrace.dispose()
      offNav()
      remoteBridge?.close()
      offHmr?.()
    },
  }
}
