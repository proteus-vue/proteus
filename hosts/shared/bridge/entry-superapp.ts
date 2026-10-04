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
        }
      },
    }
    g.__SUPERAPP__ = app
    // 启动入口 tab（index 是 isTab ⇒ router.push 内部走 switchTab）
    void app.navigate(reg.indexName)
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
