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
import { installProteusTimeline, installProteusInspectors } from './vue-devtools'
import { createTraceBusSource } from './source'
import { installComponentTrace } from './component-trace'
import { createDevtoolsPanel } from './panel'
import { setCapabilityTraceBus } from '@proteus-vue/capabilities'
import type { PagesViewData } from './views/pages'

/** style-safety 守卫的结构类型（零硬依赖——@proteus-vue/style-safety 实例直接可传） */
export interface StyleGuardLike {
  records(): Array<{ prop: string; value: unknown; reason: string; ts: number }>
}

/** pinia 实例结构类型（createStoreTracer 消费） */
export interface PiniaLike {
  use(fn: (ctx: { store: unknown }) => void): unknown
  _s: Map<string, unknown>
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

function mountFloatingPanel(bus: TraceBus, pages: PagesViewData | undefined): void {
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
      })
    }
  })
}

/**
 * 一键接入 Web 端 devtools（开发模式调用；生产 __PROTEUS_DEBUG__=false 时 bus 零开销 + 本地面板守卫挂载无事件）
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

  // ③ 组件树（component.mount/unmount 事件）
  const offComponent = installComponentTrace(app, bus)

  // ④ Vue DevTools 插件：Timeline layer + 自定义 Inspector
  setupDevtoolsPlugin({ id: 'proteus', label: 'Proteus', app }, (devtoolsApi) => {
    installProteusTimeline(devtoolsApi as never, { source: createTraceBusSource(bus) })
    installProteusInspectors(devtoolsApi as never, {
      getConfig: options.getConfig,
      setConfig: options.setConfig,
      getStyleSafetyRecords: options.styleGuard ? () => options.styleGuard?.records() ?? [] : undefined,
    })
  })

  // ⑤ 本地面板浮动挂载
  if (options.mount !== false) mountFloatingPanel(bus, options.pages)

  return {
    traceBus: bus,
    destroy() {
      storeTracer?.dispose()
      offComponent()
    },
  }
}
