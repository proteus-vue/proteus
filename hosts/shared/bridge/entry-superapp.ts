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
import { APP_SCREEN_CONTENT, APP_SCREEN_REGISTRY } from './app-screen-content.generated'

type HostInvoke = (method: string, argsJson: string) => string

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
