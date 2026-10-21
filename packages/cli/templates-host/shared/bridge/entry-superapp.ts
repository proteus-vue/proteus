// packages/cli/templates-host/shared/bridge/entry-superapp.ts —— ★★★AUTO-SYNCED 运行时桥源（决策 #666）
//
// 本文件是 **hosts/shared/bridge/entry-superapp.ts 的逐字节副本**（sentinel 之下）。
// 随 CLI 包发布 ⇒ 外部用户**无框架 checkout** 也能 `proteus build --target <app端> --package`。
// ★改逻辑请改**真源**，再跑 `node scripts/sync-host-bridge.mjs`；门禁 `--check` 防两副本漂移。
//
// 依赖（esbuild 打包时经 npm 解析，见 app-bundle.ts）：@proteus-vue/render-backend(+app-navigation)、@proteus-vue/router(+types)。
// ===== AUTO-SYNCED BODY BELOW — 勿手改（真源 hosts/shared/bridge/entry-superapp.ts；跑 node scripts/sync-host-bridge.mjs 同步） =====
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
import { appFetchLimitProbe, appStreamProbe, appSaveProbe, appUploadProbe, appCancelProbe, appUseFetchProbe, appRedirectProbe, appCacheProbe } from './entry-superapp-probes'
export { appFetchLimitProbe, appStreamProbe, appSaveProbe, appUploadProbe, appCancelProbe, appUseFetchProbe, appRedirectProbe, appCacheProbe } from './entry-superapp-probes'
// ★★★#1150：RFC 5861 扩展指令探针**单列**（entry-superapp-probes.ts 已到 file-size 上限；
//   缓存基础 #1149 与缓存扩展 #1150 是两次独立交付，边界清晰）
import { appStaleProbe } from './entry-superapp-probes-stale'
export { appStaleProbe } from './entry-superapp-probes-stale'
// ★★★#1151：缓存持久层（L2）探针**单列**（两阶段跨进程；与基础的缓存探针职责不同）
import { appPersistProbe } from './entry-superapp-probes-persist'
export { appPersistProbe } from './entry-superapp-probes-persist'
// ★★★#1153：TLS pinning 探针**单列**（需要自签 HTTPS 服务 + 两套证书，装置形态与前几批不同）
import { appTlsProbe } from './entry-superapp-probes-tls'
export { appTlsProbe } from './entry-superapp-probes-tls'
// ★★★#1155：传输层事实取证探针（HTTP/2 与连接复用**是否已在工作**——决定 P1 要不要引 OkHttp）
import { appTransportProbe } from './entry-superapp-probes-transport'
export { appTransportProbe } from './entry-superapp-probes-transport'

import type { AppNavigation } from '@proteus-vue/render-backend/app-navigation'
import { createRouter, type RouterInstance } from '@proteus-vue/router'
import type { RouteRecord } from '@proteus-vue/router/types'
import { APP_SCREEN_CONTENT, APP_SCREEN_REGISTRY, APP_RUNTIME_CONTENT } from './app-screen-content.generated'
import { createSuperappRuntime, TAB_BAR_SPEC } from '@proteus-vue/render-backend'
// ★★★决策 #1081：元素索引 + 元素查询探针（`useElement` 选择器通路）
import { resolveElement, resolveAllElements, elementRegistryStats, firstScreenElementId, selectorSupport } from '@proteus-vue/render-backend'
// ★与 entry-host-runtime.ts 同款：包内**相对路径**引用源（tsconfig.json 是 JSONC，加 paths 会撞校验；
//   而相对路径让 bundler 与类型检查解析到同一份源，零配置改动）
import { installElementResolver } from '../../../packages/api/src/capability-app-element'
import { createCapabilityHooks } from '../../../packages/api/src/capability'   // ★#1094 按屏能力实例
import { createCapabilityResourceRegistry } from '../../../packages/api/src/capability-resources'   // ★#1094 边界资源账本
// ★★★决策 #1086：交叉观察依赖注入（与 useElement 同一解析器 + 同一文档序）
import { installIntersectionDeps, evaluateIntersections, createAppIntersection } from '../../../packages/api/src/capability-app-intersection'
// ★★★决策 #1083：录屏/截屏能力探针（真机判据直接调真实桥，不经 capability.ts 全量入口）
import { createAppCaptureCapabilities } from '../../../packages/api/src/capability-app-capture'
import { createAppWebSocket } from '../../../packages/api/src/capability-websocket'   // ★#1093 WS 探针
import { createAppTransfer } from '../../../packages/api/src/capability-transfer'   // ★#1095 传输探针
import type { SuperappRuntime } from '@proteus-vue/render-backend'

// ★★★（决策 #715）**必须引用裸标识符 `__DEV__`**——esbuild 的 `define` 只替换**裸标识符**，
//   `globalThis.__DEV__`（属性访问）**不会被替换** ⇒ 运行时读到 `undefined`（本仓实测：
//   CPU Profiler 的 `profile:true` 因写成 `globalThis.__DEV__` 而**永不生效**，prof 恒空）。
//   声明为 ambient（构建期 esbuild `define` 注入真值；TS 侧只做类型）。所有打 entry-superapp 的
//   bundler（CLI `app-bundle.ts` / `hosts/android/bridge/build-batch.mjs` / `build-app-stack.mjs`）
//   **都已 define `__DEV__`** ⇒ 裸引用在各构建路径下都成立。
declare const __DEV__: boolean

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

/**
 * ★★★决策 #1094：**按屏的能力实例 + 资源账本**（G-43 边界资源治理接进真实 superapp 链）。
 *
 * 【为什么按屏而不是全局】G-43.1「边界资源归属某个 Owner」——一个屏就是一个 Owner。
 *   全局一个账本会让"离开 A 屏"释放掉 B 屏的资源。
 * 【为什么在这里而不是容器】真实 superapp 走 `createSuperappRuntime` 这条链，
 *   容器（StackContainer 等）**不在生产路径上**；把治理挂到容器上等于没接。
 */
const perScreenCaps = new Map<string, {
  resources: ReturnType<typeof createCapabilityResourceRegistry>
  dispose: () => void
}>()

/**
 * 取（或创建）某屏的能力实例——同一屏重复取复用同一个（订阅不重复登记）。
 *
 * ★导出为 `__proteusScreenCaps(screen)`（见文件底部的中性名挂载）：
 *   这是业务页面**按屏取能力实例**的入口。业务用 `useWebSocket()` 等 hook 时，
 *   应当从它拿 hooks 实例（而不是全局单例），这样离开该屏时资源才会被释放。
 *
 * ★诚实边界：当前 superapp 的 5 个页面**尚未使用任何能力**（grep 零命中），
 *   所以本函数在生产 bundle 里暂时没有调用者——它不伪装成"已经在治理"，
 *   而是**提供了正确的接入点**；页面一旦开始用能力，按此入口取即可自动受治理。
 *   （不存在"悄悄不生效"：`onScreenLeave` 对空表是安全的 no-op。）
 */
function capsForScreen(screen: string) {
  const existing = perScreenCaps.get(screen)
  if (existing) return existing
  const resources = createCapabilityResourceRegistry({ owner: 'screen:' + screen })
  const hooks = createCapabilityHooks(undefined as never, { resources, owner: 'screen:' + screen })
  const entry = { resources, dispose: () => hooks.dispose() }
  perScreenCaps.set(screen, entry)
  return entry
}

;(globalThis as unknown as { __proteusScreenCaps?: (screen: string) => unknown })
  .__proteusScreenCaps = (screen: string) => capsForScreen(screen)

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

/** ★★★B（生成期最终值，决策 #800）：tab 项终态（名字/文案/字形/角标已合并完；宿主只渲染）。 */
interface TabItemFinal { name: string; label: string; glyph?: string; badge?: number }

interface SuperappApp {
  router: RouterInstance
  nav: AppNavigation
  /** 进入某屏（与 Web/MP 同形：`router.push({name})`；isTab ⇒ 自动 switchTab） */
  navigate(name: string): Promise<void>
  back(): void
  state(): { depth: number; current: string; stack: string[]; tabs: string[]; tabLabels: Record<string, string>; tabItems: TabItemFinal[] }
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
    tabItems?: TabItemFinal[]
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
          // ★★★B（决策 #800）：tab 项**最终值**（生成期合并完）——宿主唯一输入（不合并/不兜底）。
          //   兼容：老产物无 tabItems ⇒ 由 tabNames+tabLabels 现场折（同一优先级，行为与前一致）。
          tabItems: reg.tabItems ?? reg.tabNames.map((n) => ({ name: n, label: reg.tabLabels[n] ?? n })),
          // ★B2（G1）：tab 栏**视觉规格**（共享）——宿主读它建原生 tab（不再各写一遍）
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
  /** ★★★"跳变驱动动画"（本批）：`v-animate`/`<Transition>` 触发 ⇒ 宿主 `animStart`（内核动画通道）。
   *  宿主未实现 ⇒ 不传（运行期如实记 note，不静默）。 */
  animStart?(animsJson: string): string
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
        // ★★★决策 #1094：**页面离开 = 边界资源释放点**（G-43 接进真实 superapp 链）。
        //   ★这是"谁来调 dispose()"的答案：不是靠容器（容器不在生产路径上），而是靠真实导航。
        onScreenLeave: (left: string) => {
          const entry = perScreenCaps.get(left)
          if (!entry) return
          perScreenCaps.delete(left)
          try { entry.dispose() } catch (e) { pushNote('[screen-leave] dispose 异常：' + String((e as Error)?.message ?? e)) }
        },
        onError: (e: string) => { pushNote(e); try { console.error(e) } catch { /* 无 console（非 dev）⇒ 仅 notes */ } },
        // ★★★CPU Profiler（决策 #715）：dev 构建开阶段耗时自采样（instantiate/flush/dispatch/handler）。
        //   `__DEV__` 由构建注入（dev bundle 为 true，release 为 false）⇒ release 零开销。
        //   ★★必须用**裸标识符** `__DEV__`（esbuild `define` 只替换裸标识符；`globalThis.__DEV__` 替换不到）。
        ...(__DEV__ ? { profile: true } : {}),
      })
      g.__SUPERAPP_RUNTIME__ = runtime
      // ★★★决策 #1081：元素索引接到能力层（`useElement` 的 selector→nodeId 映射；当前屏为桶）。
      try {
        // ★视口 = 本次渲染的 viewport（与 host.mount 同源，避免参照矩形与元素矩形口径分叉）
        installAppElementResolver(() => runtime!.current(), () => args.viewport)
      } catch { /* 装线失败不影响渲染 */ }
    }
    // ★remount（鸿蒙一次性 VM 判据用）：无条件重挂——拿"反映当前 state"的整树（同屏也重挂）；
    //   否则走 mountScreen（含导航/滚动语义）。两种都返回 snapshot（一次性 VM 宿主持有）。
    const ok = args.remount ? runtime.mountScreenInto(args.name) : runtime.mountScreen(args.name)
    // ★★★宿主回执如实回传（2026-10-08）：`mountScreen` 现在校验 `host.mount` 回执（ok:false ⇒ false）
    //   ——把**宿主原话**一并带上，使"渲染失败"在宿主日志/报告里可见（此前被丢弃 ⇒ 整屏保持旧内容
    //   却报 ok:true，用户看到的是"点返回还是首页"）。
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

/**
 * ★★★**B4-T2b（2026-10-10）：派发一次输入事件**（宿主原生输入控件编辑 → `v-model` 回写）。
 *   `argsJson = {nodeId, value}`；委派 `SuperappRuntime.dispatchInput`（当前屏 `input` 绑定 → 回写 handler）。
 *   ★与 `__proteusSuperappGesture` 同形（宿主→JS 的驱动入口）；三端宿主建控件后调它。
 */
;(globalThis as unknown as { __proteusSuperappInput?: (argsJson: string) => string })
  .__proteusSuperappInput = (argsJson: string) => {
    const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
    if (!g.__SUPERAPP_RUNTIME__) return JSON.stringify({ ok: false, handled: false, error: '运行期未启动' })
    try {
      const a = JSON.parse(argsJson) as { nodeId: number; value: unknown }
      const r = g.__SUPERAPP_RUNTIME__.dispatchInput(a.nodeId, a.value)
      return JSON.stringify({ ok: true, ...r })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })
    }
  }

/**
 * ★★★**v-pump 推进一帧**（通用原语，本批）：宿主按帧调（`tickJson = {dtMs, rebuild?}`）——当前屏的泵按 hz
 *   累加抽帧、用内建生成器产新值 ⇒ 写数据源 ⇒ 既有 slot-runtime 增量通路。
 *   返回 `{ok, fired, pumps}`（`fired` = 本次触发的源数；`pumps` = 当前屏泵数，宿主据此决定是否续帧）。
 *   ★`rebuild:true`（鸿蒙一次性 VM 等 no-applyOps 宿主传它）：泵值变化后**整树重建**——返回里带
 *   `tree`（重建后的当前屏节点），宿主可直接重画（它们拿不到 O(1) 增量、只能整树重取）。
 */
;(globalThis as unknown as { __proteusSuperappPump?: (tickJson: string) => string })
  .__proteusSuperappPump = (tickJson: string) => {
    const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
    if (!g.__SUPERAPP_RUNTIME__) return JSON.stringify({ ok: false, error: '运行期未启动' })
    try {
      const a = JSON.parse(tickJson || '{}') as { dtMs?: number; rebuild?: boolean }
      const fired = g.__SUPERAPP_RUNTIME__.pumpTick(typeof a.dtMs === 'number' ? a.dtMs : 16.7, a.rebuild === true)
      const pumps = g.__SUPERAPP_RUNTIME__.pumpCount()
      // ★rebuild 模式返回重建后的树（与 `__proteusSuperappTree` 同形）——宿主一次调用拿到"新值 + 新树"。
      const tree = a.rebuild === true ? g.__SUPERAPP_RUNTIME__.currentContent() : null
      return JSON.stringify({ ok: true, fired, pumps, ...(tree ? { current: g.__SUPERAPP_RUNTIME__.current(), tree } : {}) })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })
    }
  }

/**
 * ★★★**喂入触摸指标 → 运行期数据源**（决策 #797 · 通用能力 · 显影器数据通路）。
 *
 * 【它是什么】宿主把**原生测得的触摸指标**（如 `{ lag: 3.2, speed: 0.8 }`——来自官方时间戳采样/
 *   轨迹出口）写进运行期数据源 ⇒ 页面用**普通绑定**（`{{lag}}` / `:style` / `v-animate`）消费
 *   ——**显影器由应用侧声明式画**（#789 裁定：宿主不发明视觉），宿主只提供数据。
 *   ⇒ "把 ms 映射成像素"的全部美学留给页面 CSS（延迟环半径 / 颜色阈值 / 拖尾长度都是页面的事）。
 *
 * 入参：`{source: '<数据源名>', value: <any>}`（缺 source 或运行期未启动 ⇒ `{ok:false}` 如实）。
 * 【为什么走 writeSource 而不是新通道】复用既有「源 → 槽位 → ops → 内核」增量链（O(源级)）；
 *   页面侧对普通绑定的支持是**现成**的（无需新 DSL/新指令）。
 */
;(globalThis as unknown as { __proteusSuperappMetrics?: (json: string) => string })
  .__proteusSuperappMetrics = (json: string) => {
    const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
    if (!g.__SUPERAPP_RUNTIME__) return JSON.stringify({ ok: false, error: '运行期未启动' })
    try {
      const a = JSON.parse(json || '{}') as { source?: string; value?: unknown }
      if (!a.source) return JSON.stringify({ ok: false, error: '缺 source' })
      g.__SUPERAPP_RUNTIME__.writeSource(a.source, a.value)
      return JSON.stringify({ ok: true, source: a.source })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })
    }
  }

/** ★★★**读当前屏泵频率列表**（v-pump）：宿主每次挂载后调一次，据最小间隔起/停自己的帧循环。 */
;(globalThis as unknown as { __proteusSuperappPumpHz?: () => string }).__proteusSuperappPumpHz = () => {
  const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: SuperappRuntime }
  return g.__SUPERAPP_RUNTIME__ ? g.__SUPERAPP_RUNTIME__.pumpHzJson() : '[]'
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

/* ═══════════ ★★★决策 #1081：**元素查询探针**（`useElement` 选择器通路的三端判据入口）═══════════
 * 【它证明什么】`#id` → 引擎 nodeId → **内核矩形**这条链真的通了（不是"桥存在"而是"几何回得来"）。
 *   判据：宿主取 `__proteusHostAppElementRect({selector:"#hero"})` ⇒ `{ok:true,nodeId,source,…}`。
 * 【映射在哪】`element-registry`（render-backend）：Vapor 实例化按屏建桶，Vue 渲染器在 `patchProp` 写桶。
 *   本处只做"解析 + 调宿主 element.rect + 视口坐标归一"——与 `capability-app-element` **同一语义**。
 * 【为什么还要单独暴露一份】superapp bundle 刻意**不打包** 9000 行 `capability.ts`（体积 + IIFE 兼容）
 *   ⇒ 探针必须能直接测这条链，而不依赖整条能力桥被加载。
 */
/**
 * 装配期调用一次：把元素索引 + 交叉观察依赖接到能力层（能力层不反向依赖渲染包）。
 * @param viewport 当前视口（逻辑 px）——交叉观察的参照矩形；拿不到 ⇒ 该轮不评估（不猜）
 */
export function installAppElementResolver(
  currentScreen: () => string,
  viewport?: () => { width: number; height: number } | null,
): void {
  installElementResolver({
    resolve: (selector) => {
      const screen = currentScreen()
      const hit = resolveElement(selector, screen || undefined)
      return hit ? { nodeId: hit.nodeId, source: hit.source } : null
    },
    // ★与 resolve **同源**（同一份解析器）——"支持性检查"与"查询"不会走两套规则（决策 #1082）
    support: (selector) => selectorSupport(selector),
    currentScreen,
  })
  // ★★★决策 #1086：交叉观察依赖——`resolve` / `resolveAll` 走**同一份**解析器，
  //   所以 `useIntersection` 与 `useElement` 对同一选择器必命中同一批节点（不会两套规则漂移）。
  installIntersectionDeps({
    viewport: () => (viewport ? viewport() : null),
    resolve: (selector) => {
      const screen = currentScreen()
      const hit = resolveElement(selector, screen || undefined)
      return hit ? { nodeId: hit.nodeId, source: hit.source } : null
    },
    resolveAll: (selector) => {
      const screen = currentScreen()
      return resolveAllElements(selector, screen || undefined).map((h) => ({ nodeId: h.nodeId, source: h.source }))
    },
  })
}

/**
 * ★★★**仅解析选择器**（不取几何）——`selector → 引擎 nodeId`，供**宿主自己取几何**的场景用。
 *
 * 【为什么需要它（鸿蒙一次性 VM 的必然形态）】鸿蒙的 `hostAppRender` 期间**内核树还没建**
 *   （树是 ArkTS 在这之后调 `appScreenCommands` 才建的）⇒ 此时 `element.rect` 必然回「尚未建树」。
 *   而 selector→nodeId 的解析**只能在 JS 侧做**（索引在这里，宿主不认识 `#foo`）。
 *   ⇒ 拆成两段：JS 解析出 nodeId（本函数）→ 宿主建树后用**自己的**几何读法取矩形
 *     （鸿蒙 = `appScreenNodeRect`，已是内核真源）。Android/iOS 树的建立与 mount 同步，仍走一次到位的 `element.rect`。
 */
export function appElementResolve(argsJson: string): string {
  const g = globalThis as unknown as { __SUPERAPP_RUNTIME__?: { current(): string } }
  let sel = ''
  try {
    const a = JSON.parse(argsJson || '{}') as { selector?: string }
    sel = typeof a.selector === 'string' ? a.selector : ''
  } catch { return JSON.stringify({ ok: false, error: '入参非法' }) }
  const screen = g.__SUPERAPP_RUNTIME__ ? g.__SUPERAPP_RUNTIME__.current() : ''
  // ★selector 缺省 ⇒ 当前屏的第一个元素 id（跨页探针不硬编码某页的 id）
  if (!sel) { const first = firstScreenElementId(screen); if (first) sel = '#' + first }
  const sup = selectorSupport(sel)
  if (!sup.ok) return JSON.stringify({ ok: false, error: 'unsupported', reason: sup.reason, selector: sel, screen })
  const hit = resolveElement(sel, screen || undefined)
  if (!hit) return JSON.stringify({ ok: false, error: 'not-found', selector: sel, screen })
  return JSON.stringify({ ok: true, selector: sel, nodeId: hit.nodeId, source: hit.source, screen })
}
/** 解析 + 取几何（探针/宿主调；返回 JSON 串——与壳的字符串回执契约同形）。 */
export function appElementRect(argsJson: string): string {
  const g = globalThis as unknown as { proteusHost?: { invoke?: (m: string, a: string) => string }; __SUPERAPP_RUNTIME__?: { current(): string } }
  let sel = ''
  let explicitId = -1
  try {
    const a = JSON.parse(argsJson || '{}') as { selector?: string; nodeId?: number }
    sel = typeof a.selector === 'string' ? a.selector : ''
    // 直接给 nodeId（诊断/对照用）：跳过索引，验"宿主几何腿"本身
    if (typeof a.nodeId === 'number' && a.nodeId >= 0) explicitId = a.nodeId
  } catch { return JSON.stringify({ ok: false, error: '入参非法' }) }
  const screen = g.__SUPERAPP_RUNTIME__ ? g.__SUPERAPP_RUNTIME__.current() : ''
  // ★selector 缺省 ⇒ 当前屏的**第一个元素 id**（跨页探针/诊断用，避免硬编码某页的 id——iOS 驱动会切屏）
  if (!sel && explicitId < 0) { const first = firstScreenElementId(screen); if (first) sel = '#' + first }
  let nodeId = explicitId
  let source = explicitId >= 0 ? 'explicit' : ''
  if (explicitId < 0) {
    const sup = selectorSupport(sel)
    if (!sup.ok) return JSON.stringify({ ok: false, error: 'unsupported', reason: sup.reason, selector: sel, screen })
    const hit = resolveElement(sel, screen || undefined)
    if (!hit) {
      return JSON.stringify({ ok: false, error: 'not-found', selector: sel, screen, registry: elementRegistryStats() })
    }
    nodeId = hit.nodeId
    source = hit.source
  }
  const host = g.proteusHost
  if (!host || typeof host.invoke !== 'function') return JSON.stringify({ ok: false, error: '宿主缺 invoke' })
  try {
    const raw = host.invoke('element.rect', JSON.stringify({ nodeId }))
    const o = JSON.parse(raw) as { ok?: boolean; data?: { x: number; y: number; width: number; height: number; scrollY?: number }; reason?: string }
    if (!o || o.ok !== true) return JSON.stringify({ ok: false, error: o?.reason ?? 'element.rect 失败', nodeId, source })
    const d = o.data ?? (o as unknown as { x: number; y: number; width: number; height: number; scrollY?: number })
    const x = Number((d as { x?: number }).x ?? 0)
    const y = Number((d as { y?: number }).y ?? 0)
    const w = Number((d as { width?: number }).width ?? 0)
    const h = Number((d as { height?: number }).height ?? 0)
    const sy = Number((d as { scrollY?: number }).scrollY ?? 0)
    // ★Web `getBoundingClientRect()` 语义：视口坐标（内容坐标 − 滚动偏移）
    return JSON.stringify({
      ok: true, selector: sel, nodeId, source, screen,
      left: x, top: y - sy, right: x + w, bottom: y - sy + h, width: w, height: h, scrollY: sy,
    })
  } catch (e) {
    return JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })
  }
}

;(globalThis as unknown as { __proteusSuperappElementRect?: (a: string) => string })
  .__proteusSuperappElementRect = (a: string) => appElementRect(a)

/**
 * ★★★决策 #1083：**录屏/截屏能力探针**（真机判据入口）。
 *
 * 【为什么两段（同步入口 + 异步填充）】宿主经 napi/JSExport 调全局函数时只认**同步返回**，
 *   而 `useScreenCapture` 的方法返回 Promise ⇒ 入口立即回占位，结果填到
 *   `__proteusCaptureProbeResult`，判据在**下一轮**读（宿主侧读报告时已就绪）。
 * 【返回】recording/pip: 真值 | unsupported | failed（**unsupported 与 false 必须分得开**）·
 *   channel: 壳推接收器是否装配 · raw: 宿主原始回执（诊断用，定位"桥没接"还是"宿主没实现"）。
 */
export function appCaptureProbe(): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = {}
  try {
    // ★先建能力（建的过程才装壳推通道）——再读 channel（首版顺序反了，恒 false）
    const api = createAppCaptureCapabilities().getScreenCapture()
    out['channel'] = typeof g['__proteusHostCapture'] === 'function'
    // ★原始回执：直接问宿主，定位"字节腿没转 / 宿主没实现 / provider 未注入"
    try { out['raw'] = typeof (g as any).proteusHost?.invoke === 'function' ? (g as any).proteusHost.invoke('device.capture', '{}') : 'no-invoke' } catch (e) { out['raw'] = 'throw: ' + String((e as Error)?.message ?? e) }
    void Promise.all([api.getRecordingState(), api.isPictureInPictureActive()])
      .then(([rec, pip]) => {
        out['recording'] = rec.ok ? rec.data : (rec.error.code === 'screen-capture.unsupported' ? 'unsupported' : 'failed')
        out['pip'] = pip.ok ? pip.data : (pip.error.code === 'screen-capture.unsupported' ? 'unsupported' : 'failed')
        out['done'] = true
        g['__proteusCaptureProbeResult'] = JSON.stringify(out)
      })
      .catch((e) => { out['done'] = true; out['error'] = String((e as Error)?.message ?? e); g['__proteusCaptureProbeResult'] = JSON.stringify(out) })
  } catch (e) {
    out['error'] = String((e as Error)?.message ?? e)
  }
  return JSON.stringify(out)   // 立即回（done 缺失 = 结果还在算）
}
/**
 * ★★★决策 #1093：**WebSocket 端到端探针**（宿主经中性名 `__proteusHostAppWsProbe` 调）。
 *
 * 【为什么需要这个钩子】bundle 默认不导出 hook 工厂 ⇒ 宿主没法直接调 `useWebSocket`。
 *   本钩子走**真实桥**（`createAppWebSocket` —— 与 `useWebSocket` 内部同一个 connectWebSocket），
 *   因此它验的是「桥 + 宿主腿」整条链，不是绕过桥的假通路。
 *
 * 【两段式】与 `appCaptureProbe` 同款：宿主同步调用只认当场返回 ⇒ 立即回占位，
 *   结果填到 `__proteusHostWsProbeResult`，判据读该全局（宿主在 stop 后等待它出现）。
 *
 * 【参数】`url`（如 `ws://127.0.0.1:8787`）。
 */
export function appWsProbe(url: string): string {
  const g = globalThis as Record<string, unknown>
  const state: Record<string, unknown> = {
    phase: 'opening', echo: undefined, binary: undefined, big_len: 0, close_code: undefined, error: undefined,
  }
  g['__wsProbeState'] = state
  g['__wsProbeQueue'] = [] as Array<Record<string, unknown>>
  g['__proteusHostWsProbeResult'] = ''
  try {
    const connect = createAppWebSocket()
    connect(url).then(
      (ws) => {
        g['__wsProbeWs'] = ws
        const push = (e: string, p: unknown): void => {
          ;(g['__wsProbeQueue'] as Array<Record<string, unknown>>).push({ e, p })
        }
        // ★open 的补感知在桥里已实现（happened 缓存）⇒ 这里晚订阅也能拿到
        ws.on('open', (p) => push('open', p))
        ws.on('message', (p) => push('message', p))
        ws.on('close', (p) => push('close', p))
        ws.on('error', (p) => push('error', p))
        state['phase'] = 'connected'
      },
      (e: { code?: string, message?: string }) => {
        state['error'] = String(e?.code ?? '') + ' ' + String(e?.message ?? e)
        state['phase'] = 'failed'
      },
    )
  } catch (e) {
    state['error'] = String((e as Error)?.message ?? e)
    state['phase'] = 'failed'
  }
  return JSON.stringify({ phase: state['phase'], queued: true })
}

/**
 * ★#1093：探针驱动器（宿主每轮调用一次；**同步**推进状态机）。
 * 返回 done:true 时结果已写入 __proteusHostWsProbeResult。
 */
export function appWsProbeDrive(): string {
  const g = globalThis as Record<string, unknown>
  const st = g['__wsProbeState'] as Record<string, unknown> | undefined
  if (!st) return JSON.stringify({ done: true, phase: 'no-state' })
  const q = (g['__wsProbeQueue'] as Array<Record<string, unknown>> | undefined) ?? []
  const ws = g['__wsProbeWs'] as {
    send: (d: string | ArrayBuffer) => void
    close: (c?: number, r?: string) => void
  } | undefined
  const finish = (ok: boolean): string => {
    st['ok'] = ok
    st['done'] = true
    const payload = JSON.stringify({
      ok,
      connect_ok: !!ws,
      open_ok: st['open_ok'],
      echo: st['echo'],
      echo_ok: st['echo_ok'],
      binary: st['binary'],
      binary_ok: st['binary_ok'],
      big_len: st['big_len'],
      big_ok: st['big_ok'],
      close_code: st['close_code'],
      close_ok: st['close_ok'],
      error: st['error'],
    })
    g['__proteusHostWsProbeResult'] = payload
    return JSON.stringify({ done: true, phase: st['phase'], ok })
  }
  // 消费队列（每条只消费一次）
  while (q.length) {
    const evt = q.shift() as Record<string, unknown>
    const kind = String(evt['e'])
    const p = evt['p'] as Record<string, unknown> | undefined
    if (kind === 'open') { st['open_ok'] = true; st['phase'] = 'open' }
    else if (kind === 'error') { st['error'] = String(p?.['message'] ?? 'unknown'); st['phase'] = 'failed' }
    else if (kind === 'close') { st['close_code'] = p?.['code']; st['close_ok'] = true; st['phase'] = 'closed' }
    else if (kind === 'message') {
      const data = p?.['data']
      // ★等待态必须与"已发送"态并列判断（真机抓出的状态机 bug）：
      //   发送后 phase 是 'echo-sent'，而这里原来只认 'open' ⇒ 回包被丢弃、状态机卡死。
      if (st['phase'] === 'open' || st['phase'] === 'echo-sent') {
        st['echo'] = data
        st['echo_ok'] = data === 'ping-proteus'
        st['phase'] = 'echoed'
      } else if (st['phase'] === 'echoed' || st['phase'] === 'binary-sent') {
        const arr = Array.isArray(data) ? (data as number[]) : null
        st['binary'] = arr
        st['binary_ok'] = !!arr && arr.length === 4 && arr[0] === 1 && arr[1] === 2 && arr[2] === 3 && arr[3] === 255
        st['phase'] = 'binary'
      } else if (st['phase'] === 'binary' || st['phase'] === 'big-sent') {
        st['big_len'] = typeof data === 'string' ? data.length : 0
        st['big_ok'] = st['big_len'] === 300
        st['phase'] = 'big'
      }
    }
  }
  // 状态机推进（发出下一步）
  if (!ws) {
    if (st['phase'] === 'failed') return finish(false)
    return JSON.stringify({ done: false, phase: st['phase'] })
  }
  try {
    if (st['phase'] === 'open') { ws.send('ping-proteus'); st['phase'] = 'echo-sent' }
    else if (st['phase'] === 'echoed') { ws.send(new Uint8Array([1, 2, 3, 255]).buffer); st['phase'] = 'binary-sent' }
    else if (st['phase'] === 'binary') { ws.send('x'.repeat(300)); st['phase'] = 'big-sent' }
    else if (st['phase'] === 'big') { ws.close(1000, 'probe-done'); st['phase'] = 'closing' }
    else if (st['phase'] === 'closed') {
      return finish(!!(st['open_ok'] && st['echo_ok'] && st['binary_ok'] && st['big_ok'] && st['close_ok']))
    }
  } catch (e) {
    st['error'] = String((e as Error)?.message ?? e)
    return finish(false)
  }
  return JSON.stringify({ done: false, phase: st['phase'] })
}
/**
 * ★★★决策 #1095：**上传/下载端到端探针**（宿主经中性名 `__proteusHostAppTransferProbe` 调）。
 *
 * 【为什么需要钩子】bundle 不导出 hook 工厂 ⇒ 宿主没法直接调 useUpload/useDownload。
 *   本钩子走**真实桥**（createAppTransfer —— 与 hook 内部同一实现）。
 *
 * 【两段式】同步入口回占位；结果填 `__proteusHostTransferProbeResult`（与 ws/capture 同款）。
 *   ★用 `.then` 链而不用 async/await + setTimeout：bundle 环境**没有定时器宿主**（#1093 实测）。
 *
 * 【判据链】下载 4KB 落盘 → 用上传腿把该文件发回服务端 → 服务端逐字节摘要
 *   （first=0 / last=255 / sum）⇒ 证明"收到的就是你发的"。
 *
 * @param base 本地服务基址（如 `http://192.168.1.5:8788`）
 */
export function appTransferProbe(base: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = {}
  g['__proteusHostTransferProbeResult'] = ''
  const t = createAppTransfer()
  let downloadedPath = ''
  t.download(base + '/download?size=4096', { responseType: 'path' }).then(
    (r) => {
      out['download_ok'] = true
      out['download_status'] = (r as { status?: number }).status
      downloadedPath = (r as { path?: string }).path ?? ''
      out['download_path'] = downloadedPath
      return t.upload({ url: base + '/upload', filePath: downloadedPath, name: 'file', formData: { tag: 'probe' } })
    },
  ).then(
    (r) => {
      out['upload_ok'] = true
      out['upload_status'] = (r as { status?: number }).status
      const d = (r as { data?: unknown }).data
      const reply = typeof d === 'string' ? JSON.parse(d) : d
      out['upload_reply'] = reply
      const o = (reply ?? {}) as { bytes?: number, first?: number, last?: number, fields?: Record<string, string> }
      out['roundtrip_ok'] = o.bytes === 4096 && o.first === 0 && o.last === 255 && o.fields?.['tag'] === 'probe'
      out['ok'] = out['download_ok'] === true && out['upload_ok'] === true && out['roundtrip_ok'] === true
      g['__proteusHostTransferProbeResult'] = JSON.stringify(out)
    },
    (e) => {
      // ★失败也要落结果（否则宿主只能看到"超时"，无法归因）
      if (out['download_ok'] !== true) out['download_error'] = String((e as { code?: string })?.code ?? (e as Error)?.message ?? e)
      else if (out['upload_ok'] !== true) out['upload_error'] = String((e as { code?: string })?.code ?? (e as Error)?.message ?? e)
      out['ok'] = false
      g['__proteusHostTransferProbeResult'] = JSON.stringify(out)
    },
  )
  return JSON.stringify({ phase: 'started', queued: true })
}



/** 元素索引读数（判据：证明索引里真有条目，而不是"查询恒 not-found"）。 */
/**
 * ★★★决策 #1086：**交叉观察的几何变化 tick**（宿主调）。
 *
 * 【谁调】三端在**滚动**（及视口尺寸变化）后各调一次：
 *   · Android：`ProteusHostView.setScrollPosListener`（已有钩子，接线即可）
 *   · iOS：`applyContentOffset` 之后
 *   · 鸿蒙：不支持（一次性 VM，观察者无法跨渲染存活）
 * 【为什么宿主只报"变了"】相交比例 = 目标矩形 ∩ 参照矩形 / 目标面积——两边都是**视口坐标**，
 *   而 `element.rect` 已把内容坐标减掉 scrollY（#1081）。⇒ 计算全在 JS 一处，三端不会各算一套。
 * 【返回】本轮**跨阈值真正回调**的条数（0 = 未跨档，属正常：Web 语义就是只在跨档时回调）。
 */
/**
 * ★★★决策 #1086：**交叉观察探针**（真机判据入口）。
 *   `{selector, thresholds?}` → 注册一个观察者，每次回调把 `Math.round(ratio*100)` 推进全局数组。
 *   ★与 `useIntersection` **同一实现**（`createAppIntersection`），不另造一套。
 */
;(globalThis as unknown as { __proteusSuperappIntersection?: (a: string, cb: (r: { intersectionRatio: number }) => void) => string })
  .__proteusSuperappIntersection = (argsJson, cb) => {
    try {
      const a = JSON.parse(argsJson || '{}') as { selector?: string; thresholds?: number[] }
      const h = createAppIntersection({ thresholds: a.thresholds })
      h.relativeToViewport().observe(a.selector ?? '', (r) => cb(r))
      return '{"ok":true}'
    } catch (e) {
      return JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })
    }
  }

;(globalThis as unknown as { __proteusSuperappIntersectionTick?: () => number })
  .__proteusSuperappIntersectionTick = () => {
    try { return evaluateIntersections() } catch { return 0 }
  }

;(globalThis as unknown as { __proteusSuperappElementRegistry?: () => string })
  .__proteusSuperappElementRegistry = () => JSON.stringify(elementRegistryStats())

/* ═══════════ ★★★中性协议别名（2026-10-09）：runtime 侧调用入口 ═══════════
 * 【为什么有它】鸿蒙 runtime HAR 的**应用运行期驱动**（`host_app_runtime_impl.h`）按**中性名**调用
 *   全局——因为 runtime 是"换一个 App 不用改"的单元（分层门禁 `check-host-layering` 明令 runtime 目录
 *   不得出现 `superapp` 专名）。⇒ 把 `__proteusSuperapp*` **同一实现**逐一同义暴露为 `__proteusHostApp*`
 *   （**不是第二份逻辑**：同一函数引用；装置仍用 superapp 名，runtime 用中性名）。
 * 【消费方】`proteus_host.cpp`（HAR 桥导出的 hostAppBoot/Drive/Render）只调中性名；别名必须与真身
 *   同处一个 JS 上下文（同一份 bundle）——故在此声明。 */
const __HOSTAPP = globalThis as unknown as Record<string, unknown>
__HOSTAPP.__proteusHostAppBootJson = __HOSTAPP.__proteusSuperappBootJson
__HOSTAPP.__proteusHostAppState = __HOSTAPP.__proteusSuperappState
__HOSTAPP.__proteusHostAppDrive = __HOSTAPP.__proteusSuperappDrive
__HOSTAPP.__proteusHostAppDriveReadJson = __HOSTAPP.__proteusSuperappDriveReadJson
__HOSTAPP.__proteusHostAppRender = __HOSTAPP.__proteusSuperappRender
__HOSTAPP.__proteusHostAppSnapshot = __HOSTAPP.__proteusSuperappSnapshot
__HOSTAPP.__proteusHostAppRuntimeCurrent = __HOSTAPP.__proteusSuperappRuntimeCurrent
__HOSTAPP.__proteusHostAppGesture = __HOSTAPP.__proteusSuperappGesture
// ★★★v-pump（本批）：runtime 侧**泵驱动**按中性名调（iOS `SuperappRuntimeHost.pullPumps` /
//   鸿蒙 `hostAppPump`）——与上面其它别名同法：同一实现，两个名字。
__HOSTAPP.__proteusHostAppPump = __HOSTAPP.__proteusSuperappPump
__HOSTAPP.__proteusHostAppPumpHz = __HOSTAPP.__proteusSuperappPumpHz
// ★★★"跳变驱动动画"（本批）：iOS/鸿蒙宿主做完动画帧循环后用中性别名读"在飞动画数"（停判据真源）。
__HOSTAPP.__proteusHostAppAnimActive = (): string => {
  const g = globalThis as unknown as { proteusHost?: { animActive?: () => string } }
  try { return g.proteusHost?.animActive ? g.proteusHost.animActive() : '{"active":-1}' } catch { return '{"active":-1}' }
}
// ★dev 元素树（决策 #732）：含 `file`/`screen`（面板据节点 loc 拼 file:line:col → 跳编辑器）——
//   鸿蒙壳取它作 `/tree` body（比 mount 捕获树多 `file` 字段）。
__HOSTAPP.__proteusHostAppTree = __HOSTAPP.__proteusSuperappTree
// ★★★决策 #1081：元素查询（中性名——三端宿主/判据按此名调）
__HOSTAPP.__proteusHostAppElementRect = __HOSTAPP.__proteusSuperappElementRect
// ★#1086：交叉观察探针（中性名）
__HOSTAPP.__proteusHostAppIntersection = __HOSTAPP.__proteusSuperappIntersection
// ★★★决策 #1083：录屏/截屏能力探针（中性名——三端判据按此名调）
;(globalThis as unknown as { __proteusSuperappCapture?: () => string })
  .__proteusSuperappCapture = () => appCaptureProbe()
__HOSTAPP.__proteusHostAppCapture = __HOSTAPP.__proteusSuperappCapture
// ★#1082：仅解析（鸿蒙：宿主建树后自己取几何；三端 selector→nodeId 仍只有 JS 一份实现）
;(globalThis as unknown as { __proteusSuperappElementResolve?: (a: string) => string })
  .__proteusSuperappElementResolve = (a: string) => appElementResolve(a)
__HOSTAPP.__proteusHostAppElementResolve = __HOSTAPP.__proteusSuperappElementResolve
__HOSTAPP.__proteusHostAppElementRegistry = __HOSTAPP.__proteusSuperappElementRegistry
// ★★★决策 #1093：WebSocket 端到端探针（宿主按中性名调；结果填 __proteusHostWsProbeResult）
;(globalThis as unknown as { __proteusHostAppWsProbe?: (u: string) => string })
  .__proteusHostAppWsProbe = (u: string) => appWsProbe(u)
;(globalThis as unknown as { __proteusHostAppTransferProbe?: (b: string) => string })
  .__proteusHostAppTransferProbe = (b: string) => appTransferProbe(b)
// ★★★#1119：download 流式落盘探针（宿主按中性名调；结果填 __proteusHostSaveProbeResult）
;(globalThis as unknown as { __proteusHostAppSaveProbe?: (b: string, m?: number) => string })
  .__proteusHostAppSaveProbe = (b: string, m?: number) => appSaveProbe(b, m)
// ★★★#1120：流式上传探针（宿主按中性名调；结果填 __proteusHostUploadProbeResult）
;(globalThis as unknown as { __proteusHostAppUploadProbe?: (b: string, m?: number) => string })
  .__proteusHostAppUploadProbe = (b: string, m?: number) => appUploadProbe(b, m)
// ★★★#1121：取消通道探针（宿主按中性名调；结果填 __proteusHostCancelProbeResult）
;(globalThis as unknown as {
  __proteusHostAppCancelProbe?: (b: string, c?: number, s?: number, d?: number) => string
}).__proteusHostAppCancelProbe = (b: string, c?: number, s?: number, d?: number) => appCancelProbe(b, c, s, d)
// ★★★#1122：**走 useFetch 门面**的探针（验证门面真的透传 S3 字段）
;(globalThis as unknown as {
  __proteusHostAppUseFetchProbe?: (b: string, c?: number, s?: number, d?: number) => string
}).__proteusHostAppUseFetchProbe = (b: string, c?: number, s?: number, d?: number) => appUseFetchProbe(b, c, s, d)
// ★★★#1134：重定向拦截探针（宿主按中性名调；结果填 __proteusHostRedirectProbeResult）
;(globalThis as unknown as {
  __proteusHostAppRedirectProbe?: (b: string, x: string, m?: number) => string
}).__proteusHostAppRedirectProbe = (b: string, x: string, m?: number) => appRedirectProbe(b, x, m)
// ★★★决策 #1115：响应体上限探针（宿主按中性名调；结果填 __proteusHostFetchLimitProbeResult）
;(globalThis as unknown as { __proteusHostAppFetchLimitProbe?: (b: string, m?: number) => string })
  .__proteusHostAppFetchLimitProbe = (b: string, m?: number) => appFetchLimitProbe(b, m)
;(globalThis as unknown as { __proteusHostAppWsProbeDrive?: () => string })
  .__proteusHostAppWsProbeDrive = () => appWsProbeDrive()
// ★★★#1118：流式通道探针（宿主按中性名调；结果填 __proteusHostStreamProbeResult）
;(globalThis as unknown as {
  __proteusHostAppStreamProbe?: (b: string, c?: number, s?: number, d?: number, w?: number) => string
}).__proteusHostAppStreamProbe = (b: string, c?: number, s?: number, d?: number, w?: number) => appStreamProbe(b, c, s, d, w)
// ★★★#1149：HTTP 条件请求缓存探针（宿主按中性名调；结果填 __proteusHostCacheProbeResult）
;(globalThis as unknown as {
  __proteusHostAppCacheProbe?: (b: string) => string
}).__proteusHostAppCacheProbe = (b: string) => appCacheProbe(b)
// ★★★#1150：RFC 5861 扩展指令探针（SWR / SIE；结果填 __proteusHostStaleProbeResult）
;(globalThis as unknown as {
  __proteusHostAppStaleProbe?: (b: string) => string
}).__proteusHostAppStaleProbe = (b: string) => appStaleProbe(b)
// ★★★#1151：缓存持久层探针（两阶段：write/read；结果填 __proteusHostPersistProbeResult）
;(globalThis as unknown as {
  __proteusHostAppPersistProbe?: (b: string, p: string) => string
}).__proteusHostAppPersistProbe = (b: string, p: string) => appPersistProbe(b, p)
// ★★★#1153：TLS pinning 探针（结果填 __proteusHostTlsProbeResult）
;(globalThis as unknown as {
  __proteusHostAppTlsProbe?: (a: string, b: string, pa: string, pb: string) => string
}).__proteusHostAppTlsProbe = (a: string, b: string, pa: string, pb: string) => appTlsProbe(a, b, pa, pb)
// ★★★#1155：传输层事实取证探针（结果填 __proteusHostTransportProbeResult）
;(globalThis as unknown as {
  __proteusHostAppTransportProbe?: (b: string, p: string, r?: number, pb?: string) => string
}).__proteusHostAppTransportProbe = (b: string, p: string, r?: number, pb?: string) => appTransportProbe(b, p, r, pb)


