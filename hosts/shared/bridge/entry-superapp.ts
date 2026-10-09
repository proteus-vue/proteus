// hosts/shared/bridge/entry-superapp.ts —— ★★★批次 43：**superapp 真实应用入口**（App 三端）
//
// 【与装置场景的区别（用户 2026-10-05：「不要装置级别了，要真实的独立应用了」）】
//   既有 `entry-app-stack.ts` 是**一次性验收场景**（push/pop 探针、跑完自报读数后退出）。
//   本入口是**真实应用启动路径**：装配 App 导航（路由栈 + 宿主屏端口 + 真实页面内容）→
//   `createRouter(routes, { adapter })`（**与 Web/MP 同形**）→ 进入入口 tab，并**常驻**。
//   对外暴露 `globalThis.__SUPERAPP__`（navigate / switchTab / back / state）供宿主驱动。
//
// 【一份源、多端】routes/screens/tabNames 与各页内容来自**构建期产物**
//   （`app-screen-content.generated.ts`，由 `proteus build --target ios|android|harmony`
//   经 `gen-app-screen-content.mjs` 生成）——与 Web/小程序**同一棵路由树**。
import { createAppNavigation } from '@proteus-vue/render-backend/app-navigation'
import type { AppNavigation } from '@proteus-vue/render-backend/app-navigation'
import { createRouter, type RouterInstance } from '@proteus-vue/router'
import type { RouteRecord } from '@proteus-vue/router/types'
import { APP_SCREEN_CONTENT, APP_SCREEN_REGISTRY, APP_RUNTIME_CONTENT } from './app-screen-content.generated'
import { createSuperappRuntime, TAB_BAR_SPEC } from '@proteus-vue/render-backend'
import type { SuperappRuntime } from '@proteus-vue/render-backend'

type HostInvoke = (method: string, argsJson: string) => string

/**
 * ★诊断/错误累积缓冲（决策 #712）：运行期 note（诊断）与 handler 运行期错误都进这里，
 *   供 `__proteusSuperappDebug()` 读（宿主 dev-watch 取走）。有界（防长跑内存泄漏）。
 */
function pushNote(n: string): void {
  const g = globalThis as unknown as { __SUPERAPP_NOTES__?: string[] }
  const arr = (g.__SUPERAPP_NOTES__ ??= [])
  arr.push(n)
  if (arr.length > 200) arr.shift()
}

interface SuperappHost {
  /** 宿主 `proteusHost.invoke`（screen.* 端口；三端同形） */
  invoke?: HostInvoke
}

interface BootResult {
  ok: boolean
  index: string
  tabs: string[]
  tabLabels: Record<string, string>
  /** 编译到的屏（内容非空） */
  screens: string[]
  depth: number
  current: string
  error?: string
}

interface SuperappApp {
  router: RouterInstance
  nav: AppNavigation
  /** 进入某屏（与 Web/MP 同形：`router.push({name})`；isTab ⇒ 自动 switchTab） */
  navigate(name: string): Promise<void>
  back(): void
  state(): { depth: number; current: string; stack: string[]; tabs: string[]; tabLabels: Record<string, string> }
  /** ★批次 44：启动（进入入口 tab）的 promise——驱动链先 await 它，避免与后续导航重入 */
  booted?: Promise<void>
}

/** 启动 superapp（真实应用）：装配导航 → 进入入口 tab。返回首屏读数。 */
export function bootSuperapp(host?: SuperappHost): BootResult {
  const g = globalThis as unknown as { proteusHost?: SuperappHost; __SUPERAPP__?: SuperappApp }
  const h = host ?? g.proteusHost
  const reg = APP_SCREEN_REGISTRY as unknown as {
    screens: Record<string, { name: string; path: string }>
    tabNames: string[]
    tabLabels: Record<string, string>
    indexName: string
    routes: RouteRecord[]
  }
  const screenNames = Object.keys(reg.screens)
  const base: Omit<BootResult, 'ok' | 'depth' | 'current' | 'error'> = {
    index: reg.indexName, tabs: reg.tabNames, tabLabels: reg.tabLabels, screens: screenNames,
  }
  if (!h || typeof h.invoke !== 'function') {
    return { ok: false, ...base, depth: 0, current: '', error: '宿主 invoke 通道缺失' }
  }
  try {
    const nav = createAppNavigation({
      // ★保持接收者绑定（iOS JSC JSExport 拆离调用会丢 this ⇒ screen.* 全失败；Android 无此问题）
      invoke: (m, a) => h.invoke!(m, a),
      screens: reg.screens,
      contentOf: (s) => APP_SCREEN_CONTENT[s.name] ?? APP_SCREEN_CONTENT[reg.indexName],
    })
    const router = createRouter(reg.routes, { adapter: nav.adapter })
    const app: SuperappApp = {
      router,
      nav,
      async navigate(name: string) {
        await router.push({ name } as never)
      },
      back() {
        router.back()
      },
      state() {
        return {
          depth: nav.stack.depth,
          current: nav.stack.current()?.name ?? '',
          stack: nav.stack.stack.map((s) => s.name),
          tabs: reg.tabNames,
          tabLabels: reg.tabLabels,
          // ★B2（G1）：tab 栏视觉规格（共享）——宿主读它建原生 tab（不再各写一遍）
          tabSpec: TAB_BAR_SPEC,
          // ★★★逐屏截图装置（2026-10-05 · 拆页后每页需独立截图）：**全部屏名**——
          //   验收项目常无 tab ⇒ 宿主靠它遍历全部屏（iOS drive / Android --es screen / 鸿蒙同源）。
          screens: screenNames,
        }
      },
    }
    g.__SUPERAPP__ = app
    // 启动入口 tab（index 是 isTab ⇒ router.push 内部走 switchTab）——把 promise 存下来，
    //   供驱动链（鸿蒙 one-kick）先 await（否则驱动会与启动导航重入）
    app.booted = app.navigate(reg.indexName)
    return { ok: true, ...base, depth: nav.stack.depth, current: nav.stack.current()?.name ?? '' }
  } catch (e) {
    return { ok: false, ...base, depth: 0, current: '', error: String((e as Error)?.message ?? e) }
  }
}

// ★宿主在 JSContext/QuickJS 里 eval 本 bundle 后：调 `__proteusSuperappBootJson()` 启动（返 JSON 串）。
//   读数接口均返 **JSON 字符串**（宿主 EvalResult 直读）——与既有入口同形。
;(globalThis as unknown as { __proteusSuperappBoot?: (h?: SuperappHost) => BootResult }).__proteusSuperappBoot = bootSuperapp

/** ★宿主调：启动（返 JSON 串） */
;(globalThis as unknown as { __proteusSuperappBootJson?: () => string }).__proteusSuperappBootJson = () =>
  JSON.stringify(bootSuperapp())

/** ★宿主调：当前状态（返 JSON 串） */
;(globalThis as unknown as { __proteusSuperappState?: () => string }).__proteusSuperappState = () => {
  const g = globalThis as unknown as { __SUPERAPP__?: SuperappApp }
  return JSON.stringify(g.__SUPERAPP__ ? g.__SUPERAPP__!.state() : { error: '未启动' })
}

/** ★宿主调：导航（异步；宿主驱动 job 泵后读 state）——返立即回执 */
;(globalThis as unknown as { __proteusSuperappNav?: (name: string) => string }).__proteusSuperappNav = (name: string) => {
  const g = globalThis as unknown as { __SUPERAPP__?: SuperappApp }
  if (!g.__SUPERAPP__) return JSON.stringify({ ok: false, error: '未启动' })
  try {
    void g.__SUPERAPP__!.navigate(name)
    return JSON.stringify({ ok: true, kicked: name })
  } catch (e) {
    return JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })
  }
}

/** ★宿主调：返回（弹栈） */
;(globalThis as unknown as { __proteusSuperappBack?: () => string }).__proteusSuperappBack = () => {
  const g = globalThis as unknown as { __SUPERAPP__?: SuperappApp }
  if (!g.__SUPERAPP__) return JSON.stringify({ ok: false, error: '未启动' })
  g.__SUPERAPP__!.back()
  return JSON.stringify({ ok: true })
}

/* ═══════════ ★★★批次 44：**驱动链**（one-kick + 宿主泵，鸿蒙 JSVM 专用形态）═══════════
 * 【为什么需要它（鸿蒙实测）】鸿蒙宿主的微任务泵是"**一次 kick + 有界泵 + 读 getter**"形态
 *   （见 `AppStackExecutorProbe`）：**不能**在泵循环里反复调新的导航入口——
 *   跨"启动新导航"的调用会与 V8 微任务排空重入 ⇒ SIGSEGV/HandleScope 溢出（本仓实测）。
 *   ⇒ 本入口把 boot + 逐 tab 切页编成**一条 async 驱动**（`await navigate` 串起来），
 *     宿主只 kick 一次，然后反复读 `__proteusSuperappDriveReadJson()` 直到 `pending=false`。
 *   ★与 Android/iOS 的差别：那边宿主用自己的 job 泵逐条驱动（无此限制）；本入口是鸿蒙的等价解。
 */
export interface SuperappDriveState {
  pending: boolean
  log: Array<{ tap: string; current: string; ok: boolean }>
  state: ReturnType<SuperappApp['state']> | { error: string }
}
;(globalThis as unknown as { __proteusSuperappDrive?: (tabsJson: string) => string }).__proteusSuperappDrive = (
  tabsJson: string,
) => {
  const g = globalThis as unknown as {
    __SUPERAPP__?: SuperappApp
    __SUPERAPP_DRIVE__?: SuperappDriveState
  }
  if (!g.__SUPERAPP__) return JSON.stringify({ ok: false, error: '未启动' })
  let tabs: string[] = []
  try {
    tabs = JSON.parse(tabsJson) as string[]
  } catch {
    tabs = []
  }
  // ★缺省 ⇒ 从应用自己的注册表取（宿主只 kick，不猜；tabs 与 Web/MP 同源）
  if (!Array.isArray(tabs) || tabs.length === 0) tabs = g.__SUPERAPP__!.state().tabs
  const drive: SuperappDriveState = { pending: true, log: [], state: { error: '进行中' } }
  g.__SUPERAPP_DRIVE__ = drive
  const app = g.__SUPERAPP__!
  void (async () => {
    try {
      await (app.booted ?? Promise.resolve())   // 先等启动导航落定（避免与它重入）
      for (const t of tabs) {
        const before = app.state().current
        if (t === before) continue   // ★跳过当前页：鸿蒙上同页重复导航会栈溢出（已实测）
        await app.navigate(t)
        drive.log.push({ tap: t, current: app.state().current, ok: app.state().current === t })
      }
    } catch (e) {
      drive.log.push({ tap: '', current: String((e as Error)?.message ?? e), ok: false })
    } finally {
      drive.pending = false
      drive.state = app.state()
    }
  })()
  return JSON.stringify({ ok: true, kicked: tabs.length })
}

/** ★宿主调（泵循环内）：读驱动状态（纯 getter——不启动新工作，零重入） */
;(globalThis as unknown as { __proteusSuperappDriveReadJson?: () => string })
  .__proteusSuperappDriveReadJson = () => {
    const g = globalThis as unknown as { __SUPERAPP_DRIVE__?: SuperappDriveState }
    return JSON.stringify(g.__SUPERAPP_DRIVE__ ?? { pending: false, log: [], state: { error: '未驱动' } })
  }

/* ═══════════ ★★★B1：**统一运行期渲染入口**（App 壳 = 运行期实例化 + 手势 + 导航）═══════════
 * 【它替代什么】此前 App 壳渲染走**静态屏内容**（宿主读 app-screen-content.json → VaporRenderHost.mount），
 *   无事件/响应式/导航。现在：宿主（`SuperappActivity.renderCurrent`）改为调本函数，由
 *   `createSuperappRuntime`（共享运行期）**实例化当前屏**并交 `proteusHost.mount` 上屏；
 *   手势经 `proteusHost.onGesture` 反向回调 → 共享 `dispatchGesture` 派发 → handler 改数据 → `applyOps`。
 * 【与导航的关系】`$nav('目标')` 动作 → 本入口的 `navigate` → 共享 `router.push`（与 Web/MP 同形）。
 * 【为什么懒创建 runtime】屏实例态（计数/列表）要跨导航保留 ⇒ 只建一次；视口变化（旋转）暂不重建（诚实边界）。
 */
interface SuperappRuntimeHostShape {
  mount(treeJson: string): string
  applyOps(opsJson: string): string
  onGesture?(cbName: string): void
}
;(globalThis as unknown as { __proteusSuperappRender?: (argsJson: string) => string })
  .__proteusSuperappRender = (argsJson: string) => {
    const g = globalThis as unknown as {
      __SUPERAPP__?: SuperappApp
      __SUPERAPP_RUNTIME__?: SuperappRuntime
      proteusHost?: SuperappRuntimeHostShape
    }
    const app = g.__SUPERAPP__
    if (!app) return JSON.stringify({ ok: false, error: '未启动（先 __proteusSuperappBootJson）' })
    if (!g.proteusHost || typeof g.proteusHost.mount !== 'function') {
      return JSON.stringify({ ok: false, error: '宿主缺少运行期原语（mount/applyOps）——需 SuperappRuntimeHost' })
    }
    let args: { name: string; viewport: { width: number; height: number }; seedData?: Record<string, Record<string, unknown>>; remount?: boolean }
    try {
      args = JSON.parse(argsJson) as typeof args
    } catch (e) {
      return JSON.stringify({ ok: false, error: 'render 入参非法：' + String((e as Error)?.message ?? e) })
    }
    let runtime = g.__SUPERAPP_RUNTIME__
    if (!runtime) {
      // ★$nav → ① 共享 router.push（更新路由栈；与 Web/MP 同形）+ ② **同步挂载目标屏**
      //   （`mountScreen` 直调 `host.mount` ⇒ 视觉即时切换；router 的异步续体由宿主泵驱动）。
      //   ★为什么同步挂载：宿主 eval 是同步的，异步 nav 续体要等宿主泵 ⇒ 先挂上，栈由 push 兜底。
      const navHandler = (t: string) => {
        ;(globalThis as unknown as { __SUPERAPP_NAVLOG__?: string[] }).__SUPERAPP_NAVLOG__ =
          ((globalThis as unknown as { __SUPERAPP_NAVLOG__?: string[] }).__SUPERAPP_NAVLOG__ ?? []).concat(t)
        void app.router.push({ name: t } as never)
        try { g.__SUPERAPP_RUNTIME__!.mountScreen(t) } catch { /* 目标屏无产物 ⇒ 保持当前（诚实） */ }
      }
      runtime = createSuperappRuntime({
        artifacts: APP_RUNTIME_CONTENT as never,
        host: g.proteusHost as never,
        viewport: args.viewport,
        navigate: navHandler,
        // ★★★鸿蒙一次性 VM：上次 `snapshot()` 回灌为态种子（恢复 count 等实例态）——见 screen-runtime.seedData
        ...(args.seedData ? { seedData: args.seedData } : {}),
        // ★★★页面处理器 source map（决策 #712）：运行期 handler 出错 ⇒ 记入 notes（宿主 debug 读数可见）+
        //   走 `console.error`（dev 垫片转发面板 Console·项目通道 error 级）——不再静默吞掉。
        onNote: (n: string) => pushNote(n),
        onError: (e: string) => { pushNote(e); try { console.error(e) } catch { /* 无 console（非 dev）⇒ 仅 notes */ } },
        // ★★★CPU Profiler（决策 #715）：dev 构建开阶段耗时自采样（instantiate/flush/dispatch/handler）。
        //   `__DEV__` 由构建注入（dev bundle 为 true，release 为 false）⇒ release 零开销。
        ...((globalThis as unknown as { __DEV__?: boolean }).__DEV__ ? { profile: true } : {}),
      })
      g.__SUPERAPP_RUNTIME__ = runtime
    }
    // ★remount（鸿蒙一次性 VM 判据用）：无条件重挂——拿"反映当前 state"的整树（同屏也重挂）；
    //   否则走 mountScreen（含导航/滚动语义）。两种都返回 snapshot（一次性 VM 宿主持有）。
    const ok = args.remount ? runtime.mountScreenInto(args.name) : runtime.mountScreen(args.name)
    // ★★★宿主回执如实回传（2026-10-08）：`mountScreen` 现在校验 `host.mount` 回执（ok:false ⇒ false）
    //   ——把**宿主原话**一并带上，使"渲染失败"在宿主日志/报告里可见（此前被丢弃 ⇒ 整屏保持旧内容
    //   却报 ok:true，用户看到的是"点背景还是首页"）。
    return JSON.stringify({ ok, current: runtime.current(), snapshot: runtime.snapshot(), hostReply: runtime.lastHostReply() })
  }

/** ★宿主调：读运行期**全量状态快照**（`{屏名:{变量:值}}`）——一次性 VM 宿主持有、下次回灌 `seedData`。 */
;(globalThis as unknown as { __proteusSuperappSnapshot?: () => string }).__proteusSuperappSnapshot = () => {
  const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
  return JSON.stringify(g.__SUPERAPP_RUNTIME__ ? g.__SUPERAPP_RUNTIME__.snapshot() : {})
}

/** ★宿主调：读运行期**当前屏名**（`mountScreen` 记忆——一次性 VM 里用于校正"渲染的是哪页"）。 */
;(globalThis as unknown as { __proteusSuperappRuntimeCurrent?: () => string }).__proteusSuperappRuntimeCurrent = () => {
  const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
  return g.__SUPERAPP_RUNTIME__ ? g.__SUPERAPP_RUNTIME__.current() : ''
}

/** ★宿主调（可选）：派发一次语义手势（宿主也可走 onGesture 反向回调；此入口供探针/驱动）。 */
;(globalThis as unknown as { __proteusSuperappGesture?: (argsJson: string) => string })
  .__proteusSuperappGesture = (argsJson: string) => {
    const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
    if (!g.__SUPERAPP_RUNTIME__) return JSON.stringify({ ok: false, handled: false, error: '运行期未启动' })
    try {
      const a = JSON.parse(argsJson) as { type: string; chain: number[] }
      const r = g.__SUPERAPP_RUNTIME__.dispatchGesture(a.type, a.chain ?? [])
      return JSON.stringify({ ok: true, ...r })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })
    }
  }

/** ★B1 判据用：读运行期调试读数（当前屏 / nav 日志 / notes）。 */
;(globalThis as unknown as { __proteusSuperappDebug?: () => string }).__proteusSuperappDebug = () => {
  const g = globalThis as unknown as {
    __SUPERAPP_RUNTIME__?: SuperappRuntime
    __SUPERAPP_NAVLOG__?: string[]
    __SUPERAPP_NOTES__?: string[]
  }
  return JSON.stringify({
    current: g.__SUPERAPP_RUNTIME__?.current() ?? '',
    navlog: g.__SUPERAPP_NAVLOG__ ?? [],
    notes: g.__SUPERAPP_NOTES__ ?? [],
  })
}

/** ★DevTools 元素内省（决策 #674）：当前屏**已实例化节点**（Template 实例化产物）的 JSON。
 *  `{viewport, nodes:[{id,parentId,tag,style?,text?}]}`——供 dev 面板"元素"树（宿主读它推给 dev server）。
 *  ★诚实边界：是**模板实例化树**（结构/样式/文本），**不含**内核 box/几何读数。 */
;(globalThis as unknown as { __proteusSuperappTree?: () => string }).__proteusSuperappTree = () => {
  const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
  const c = g.__SUPERAPP_RUNTIME__?.currentContent()
  return JSON.stringify(c ?? { nodes: [] })
}

/** ★DevTools 事件 trace（决策 #675）：自上次调用以来的手势派发（排空式）。宿主轮询取走 → POST /trace。 */
;(globalThis as unknown as { __proteusSuperappEvents?: () => string }).__proteusSuperappEvents = () => {
  const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
  return JSON.stringify(g.__SUPERAPP_RUNTIME__?.devEvents() ?? [])
}

/** ★★★CPU Profiler（决策 #715）：自上次调用以来的**运行期阶段耗时**（排空式）——宿主轮询取走
 *  随 `/ping?perf=` 上报（`perf.profile`）。形状 `{屏名: [{label,count,totalMs,maxMs,loc?}]}`。 */
;(globalThis as unknown as { __proteusSuperappProfile?: () => string }).__proteusSuperappProfile = () => {
  const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
  return JSON.stringify(g.__SUPERAPP_RUNTIME__?.profileStats() ?? {})
}

