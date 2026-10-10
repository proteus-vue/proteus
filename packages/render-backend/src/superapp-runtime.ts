// packages/render-backend/src/superapp-runtime.ts —— ★★★B1：App 壳**壳级运行期驱动**（2026-10-09）
//
// 【它补什么】`createScreenRuntime`（一屏的运行期）之上，再补**多屏编排**：把「路由导航 + 每屏挂载 +
//   手势派发 + 增量」接到宿主的 `proteusHost.mount/applyOps`。这是 `entry-superapp`（App 壳 JS 入口）
//   的运行期内核——**平台无关**（宿主只提供 mount/applyOps/readRects/onGesture 四个原语）。
//
// 【与 `createAppNavigation` 的关系】路由/栈语义仍归 `createAppNavigation`（共享、已验）；本模块负责
//   **内容**——导航到某屏时，用 `createScreenRuntime` 把该屏**实例化**后交宿主挂载（替代"静态屏内容"）。
//
// 【为什么单列一个模块（而非写在 entry-superapp 里）】entry-superapp 是 IIFE bundle 入口（引 globalThis），
//   不便单测；把内核抽成纯函数 ⇒ 可用 mock host 在 node 侧**端到端**验证（本仓纪律：逻辑尽量可单测）。
import { createScreenRuntime } from './screen-runtime'
import type { ScreenRuntimeArtifact } from './screen-runtime'
import type { ProfEntry } from './runtime-profiler'

/** 宿主原语（App 壳各端 `proteusHost` 的**子集**；平台无关形状） */
export interface SuperappHostPorts {
  /** 建树 + 上屏（内核排版 + 宿主自绘）；返回宿主回执 JSON 串 */
  mount(treeJson: string): string
  /** 应用二进制指令流（`number[]` JSON）——增量更新 */
  applyOps(opsJson: string): string
  /** 注册手势反向回调名（宿主在"语义手势 + 命中节点 + 冒泡链"时回调该全局函数） */
  onGesture?(cbName: string): void
  /**
   * ★★★**每屏滚动进度记忆**（用户：「返回去的页面滚动进度应该保留，前进的页面才重置」——与手机系统 App 一致）。
   *
   * 【为什么需要这对原语（而非单一 resetScroll）】滚动偏移是**视图属性**、不是树属性 —— 跨屏会泄漏。
   *   但**正确语义不是"每次挂载都归零"**：浏览器/系统 App 的返回（pop）**保留**上一页滚动位置，
   *   只有**前进**（push 到新页）才从顶部开始。⇒ 运行期需要"读当前偏移 / 写目标偏移"两个原语，
   *   由运行期用**导航历史栈**判断 前进（重置）vs 返回（恢复）。
   */
  getScroll?(): number
  /** 设置滚动偏移（逻辑像素；前进=0 / 返回=该页上次的值）。 */
  setScroll?(offset: number): void
}

export interface SuperappRuntimeOptions {
  /** 各屏运行期产物（`APP_RUNTIME_CONTENT`） */
  artifacts: Record<string, ScreenRuntimeArtifact>
  /** 宿主原语 */
  host: SuperappHostPorts
  /** 视口（逻辑像素） */
  viewport: { width: number; height: number }
  /** 手势回调全局函数名（缺省 `__proteusRuntimeGesture`） */
  gestureCbName?: string
  /** 导航出口（`$nav('目标')` → 这里；App 壳 = router.push） */
  navigate?: (target: string) => void
  /**
   * ★★★跨调用**状态种子**（鸿蒙一次性 VM）：上次调用 `snapshot()` 的返回，回灌以恢复实例态
   *   （`{屏名: {变量: 值}}`）。宿主持有、每次新建 VM 时回传——见 `ScreenRuntimeOptions.seedData`。
   */
  seedData?: Record<string, Record<string, unknown>>
  /** 诊断（不静默） */
  onNote?: (note: string) => void
  /** ★页面处理器运行期错误出口（决策 #712·source map）——转发给 `createScreenRuntime.onError`。 */
  onError?: (error: string) => void
  /** ★T3 `console.*` 出口——转发给 `createScreenRuntime.onLog`（dev 面板 Console）。 */
  onLog?: (level: 'log' | 'info' | 'warn' | 'error' | 'debug', values: unknown[], line: string) => void
  /** ★★★**运行期阶段耗时自采样**（CPU Profiler · 决策 #715）——dev 构建开启；缺省零开销。 */
  profile?: boolean
}

export interface SuperappRuntime {
  /** 挂载（或重挂载）某屏：实例化 → `host.mount`；并记忆为"当前屏"（手势派发用） */
  mountScreen(name: string): boolean
  /**
   * ★★★**强制挂载**（2026-10-07 · 鸿蒙一次性 VM）：无条件重实例化 + `host.mount`（同屏也重挂）。
   *   一次性 VM 每次交互都是新 VM ⇒ 必须从 `content()` 拿到**反映当前 state** 的整树（不能 like
   *   `mountScreen` 那样"同屏短路"）。也用于"数据变更后重挂"。
   */
  mountScreenInto(name: string): boolean
  /** 派发一次手势：宿主报的内核 id + 冒泡链 → 当前屏实例派发 */
  dispatchGesture(type: string, chain: readonly number[]): {
    handled: boolean
    fired: number[]
    firedHandlers?: Array<{ handler: string; nodeId: number; loc?: { line: number; column: number } }>
  }
  /**
   * ★★★**B4-T2b（2026-10-10）：派发一次输入事件**（宿主原生输入控件编辑 → `v-model` 回写）。
   *   `nodeId` = 内核 id（宿主控件所在节点）；`value` = 编辑值。委派当前屏实例的
   *   `dispatchInputValue`（`packages/render-backend/src/screen-runtime.ts`）。
   *   宿主经全局入口 `__proteusSuperappInput` 调它（见 entry-superapp.ts）。
   */
  dispatchInput(nodeId: number, value: unknown): { handled: boolean; fired: string[] }
  /**
   * ★★★**数据泵推进一帧**（通用原语 `v-pump`，本批）：宿主按帧调（传真实 dtMs）——当前屏的泵按 hz
   *   累加抽帧产新值 ⇒ 写数据源 ⇒ 既有增量通路。返回触发的源数；当前屏无泵 ⇒ 0。
   */
  pumpTick(dtMs: number): number
  /** 当前屏声明的泵数（宿主据此决定是否起周期驱动）。 */
  pumpCount(): number
  /** 当前屏各泵频率列表 JSON（宿主据最小间隔起/停 Choreographer 帧循环；无泵 ⇒ `[]`）。 */
  pumpHzJson(): string
  /** 当前屏名 */
  current(): string
  /** ★DevTools 元素内省（决策 #674）：当前屏**已实例化节点**（Template 实例化产物：id/parentId/tag/style/text）——供面板"元素"树。
   *  ★（决策 #713）`:file` = 当前屏源文件（dev 构建；面板据节点 `loc` 拼 `file:line:col`）。 */
  currentContent(): { viewport?: { width: number; height: number }; nodes: readonly unknown[]; screen?: string; file?: string } | null
  /** ★DevTools 事件 trace（决策 #675）：自上次调用以来发生的手势派发（type/命中 id/冒泡链/handled/fired）——排空式。 */
  devEvents(): ReadonlyArray<{ type: string; id: number; chain: readonly number[]; handled: boolean; fired: readonly number[]; src?: string; time: number }>
  /**
   * ★★★**排空当前屏页面处理器运行期错误**（决策 #712 · source map 生态链）——自上次调用以来的
   *   handler 求值失败（带**模板源位置** `.vue:line:col`）。排空式，供宿主 dev-watch 转发面板 Console。
   */
  handlerErrors(): string[]
  /**
   * ★★★**排空运行期阶段耗时**（CPU Profiler · 决策 #715）——自上次调用以来的各屏阶段采样
   *   （`{屏名: [{label,count,totalMs,maxMs,loc?}]}`，按累计耗时降序）。排空式；未开 profiling ⇒ 空。
   */
  profileStats(): Record<string, ProfEntry[]>
  /** ★跨调用状态导出（`{屏名: 数据}`）——一次性 VM 宿主持有、下次回灌 `seedData` */
  snapshot(): Record<string, Record<string, unknown>>
  /**
   * ★★★**最近一次 `host.mount` 的原始回执**（2026-10-08 · 用户抓出「iOS/鸿蒙背景页导航后仍是首页」）。
   *
   * 【为什么必须暴露（本仓实测的静默失效）】宿主 `mount` 是**有回执的**（`{ok:true,...}` /
   *   `{ok:false,error}`），而运行期此前**丢弃**它、只看"有没有该屏产物" ⇒ 内核建树失败
   *   （`proteus_layout_create` 返回 0）时**整屏保持旧内容却仍报 ok:true** —— 与「hook 静默失效」
   *   同源：**没有回执校验 = 失败不可观测**。宿主持有本值即可在报告里如实落盘失败原因。
   */
  lastHostReply(): string | null
  /**
   * ★★★B5（2026-10-10）：宿主**卸载**某屏（缺省=当前屏）时调用——跑该屏 `onUnmounted` 钩子。
   *   返回跑成的钩子条数。★App 壳当前无"屏卸载"事件（切屏不销毁实例）⇒ 由宿主/dev 显式调用。
   */
  markUnmounted(screenName?: string): number
}

/**
 * 创建 App 壳运行期驱动。
 *
 * 用法（entry-superapp，宿主 eval bundle 后）：
 * ```ts
 * const rt = createSuperappRuntime({ artifacts: APP_RUNTIME_CONTENT, host: proteusHost, viewport, navigate })
 * rt.mountScreen('index')                 // 首屏
 * globalThis.__proteusRuntimeGesture = (type, id, chainJson) => rt.dispatchGesture(type, JSON.parse(chainJson))
 * // 导航后：rt.mountScreen(router.current().name)
 * ```
 */
export function createSuperappRuntime(opts: SuperappRuntimeOptions): SuperappRuntime {
  const note = opts.onNote ?? (() => {})
  const cbName = opts.gestureCbName ?? '__proteusRuntimeGesture'
  const rt = createScreenRuntime({
    artifacts: opts.artifacts,
    applyOps: (ops) => { opts.host.applyOps(ops) },
    viewport: opts.viewport,
    ...(opts.navigate ? { navigate: opts.navigate } : {}),
    ...(opts.seedData ? { seedData: opts.seedData } : {}),
    onNote: note,
    ...(opts.onError ? { onError: opts.onError } : {}),
    ...(opts.onLog ? { onLog: opts.onLog } : {}),
    ...(opts.profile ? { profile: true } : {}),   // ★CPU Profiler（决策 #715）
  })
  let cur = ''
  // ★最近一次宿主 mount 回执（见 lastHostReply 注释——失败必须可观测，不得静默）
  let lastHostReply: string | null = null
  // ★DevTools 事件 trace（决策 #675）：记录每次手势派发（排空式——宿主/dev server 取走即清）。
  //   ★`src`（决策 #712·source map）：本次派发**首个** handler 的模板源位置（`page.vue:line:col`）——
  //     面板 Events 把"点了→跑了哪个 handler"锚回**模板哪一行**（调试生态链的数据支撑）。
  const devEvents: Array<{ type: string; id: number; chain: readonly number[]; handled: boolean; fired: readonly number[]; src?: string; time: number }> = []

  // 注册手势反向回调（宿主在命中时报"内核 id + 冒泡链"）
  if (typeof opts.host.onGesture === 'function') {
    opts.host.onGesture(cbName)
  }
  // 全局回调：宿主 → 本模块 → 当前屏实例。★保持接收者绑定（iOS JSC JSExport 拆离会丢 this）。
  ;(globalThis as unknown as Record<string, unknown>)[cbName] = (
    type: string,
    kernelId: number,
    chainJson?: string,
  ): string => {
    let chain: number[] = []
    try {
      chain = chainJson ? (JSON.parse(chainJson) as number[]) : []
    } catch {
      note(`[superapp-runtime] 手势链 JSON 解析失败：${String(chainJson).slice(0, 40)}`)
    }
    const r = dispatch(type, chain)
    // ★trace + 记录命中 id（宿主据此把"被点节点"与面板元素树对齐）
    const srcLoc = r.firedHandlers?.find((h) => h.loc)?.loc
    devEvents.push({
      type, id: kernelId, chain, handled: r.handled, fired: r.fired, time: Date.now(),
      ...(srcLoc ? { src: `${cur}.vue:${srcLoc.line}:${srcLoc.column}` } : {}),
    })
    if (devEvents.length > 200) devEvents.shift()
    // ★把**屏幕名**一并带回宿主的派发结果（决策 #712）：iOS 壳在 native 回调里直接读返回 JSON 提取
    //   `firedHandlers[*].loc`（不额外引一条"壳→JS 读 devEvents"通路）⇒ 缺屏名则拼不出 `page.vue:line:col`。
    return JSON.stringify({ ...r, screen: cur })
  }

  /** 解析宿主 mount 回执：`{ok:false,…}` ⇒ 失败（其余/非 JSON ⇒ 放行，保持旧宿主兼容）。 */
  function hostOk(reply: string): boolean {
    try {
      const o = JSON.parse(reply) as { ok?: boolean }
      return o?.ok !== false
    } catch {
      return true
    }
  }

  function dispatch(type: string, chain: readonly number[]): {
    handled: boolean
    fired: number[]
    firedHandlers?: Array<{ handler: string; nodeId: number; loc?: { line: number; column: number } }>
  } {
    if (!cur) return { handled: false, fired: [] }
    return rt.instance(cur).dispatch(type, chain)
  }

  // ★★★导航历史 + 每屏滚动进度（用于判断"前进（重置）/ 返回（恢复）"——见 getScroll/setScroll 注释）。
  const scrollByScreen = new Map<string, number>()
  const history: string[] = []
  let curIdx = -1

  return {
    mountScreen(name: string): boolean {
      if (!rt.has(name)) { note(`[superapp-runtime] 无该屏运行期产物：${name}`); return false }
      if (name === cur) return true   // 同屏重渲（如数据更新）——不动滚动

      // 离开当前屏前：记住它的滚动进度（返回时恢复）
      if (cur && typeof opts.host.getScroll === 'function') {
        scrollByScreen.set(cur, opts.host.getScroll())
      }
      // 判断方向：目标在历史里且在当前之前 ⇒ **返回（pop）**；否则 ⇒ **前进（push）**。
      const existing = history.indexOf(name)
      let restore = 0
      if (existing >= 0 && existing < curIdx) {
        history.length = existing + 1      // 截断"前进目标"的残留
        curIdx = existing
        restore = scrollByScreen.get(name) ?? 0   // ★返回：恢复到该页上次的滚动进度
      } else {
        history.length = curIdx + 1
        history.push(name)
        curIdx = history.length - 1
        scrollByScreen.set(name, 0)        // 新页从顶部
        restore = 0                        // ★前进：重置
      }
      const inst = rt.instance(name)
      const reply = opts.host.mount(JSON.stringify({ viewport: inst.content().viewport, nodes: inst.content().nodes }))
      lastHostReply = reply
      // ★★宿主回执校验（见 lastHostReply 注释）：`ok:false` ⇒ **不上屏成功**，如实回报失败
      //   （旧行为：丢弃回执恒返 true ⇒ 内核建树失败时屏幕保持旧内容而报告仍是 ok:true）。
      if (!hostOk(reply)) {
        note(`[superapp-runtime] 宿主 mount 失败：${String(reply).slice(0, 200)}`)
        return false
      }
      // 挂载后再设滚动（树已重建；宿主按此值定位）
      if (typeof opts.host.setScroll === 'function') opts.host.setScroll(restore)
      cur = name
      // ★★★v-pump：把该屏泵频率报给宿主（起/停周期驱动）——仅带 hz，不带数据（数据在 JS 侧产出）。
      // ★★★B5（2026-10-10）：**首帧 mount 成功后**跑该屏的 mounted 钩子（@vue:mounted + onMounted）。
      //   一次性（`markMounted` 幂等）——切回不重跑（与 Vue「mounted 只在挂载时一次」语义一致）。
      try { rt.instance(name).markMounted() } catch (e) { note(`[superapp-runtime] mounted 钩子异常：${String((e as Error)?.message ?? e)}`) }
      return true
    },
    mountScreenInto(name: string): boolean {
      if (!rt.has(name)) { note(`[superapp-runtime] 无该屏运行期产物：${name}`); return false }
      const inst = rt.instance(name)
      // ★仅重挂（跳过滚动/历史逻辑——一次性 VM 宿主每次都从 content() 取新树；滚动由宿主自己管）
      const reply = opts.host.mount(JSON.stringify({ viewport: inst.content().viewport, nodes: inst.content().nodes }))
      lastHostReply = reply
      if (!hostOk(reply)) {
        note(`[superapp-runtime] 宿主 mount（重挂）失败：${String(reply).slice(0, 200)}`)
        return false
      }
      cur = name
      // ★B5：重挂也视作"挂载"（一次性 VM 宿主每次从 content() 取新树）——但 `markMounted` 幂等，
      //   仅首次真跑（与切屏同：mounted 只在首次挂载跑一次）。
      try { rt.instance(name).markMounted() } catch (e) { note(`[superapp-runtime] mounted 钩子异常：${String((e as Error)?.message ?? e)}`) }
      return true
    },
    dispatchGesture: dispatch,
    pumpTick(dtMs: number): number {
      // ★v-pump：委派当前屏实例（泵表在屏产物里）；无屏/无泵 ⇒ 0。
      if (!cur) return 0
      try {
        return rt.instance(cur).pumpTick(dtMs)
      } catch (e) {
        note(`[superapp-runtime] pumpTick 异常：${String((e as Error)?.message ?? e)}`)
        return 0
      }
    },
    pumpCount(): number {
      if (!cur) return 0
      try {
        return rt.instance(cur).pumpCount()
      } catch {
        return 0
      }
    },
    pumpHzJson(): string {
      if (!cur) return '[]'
      try {
        return JSON.stringify(rt.instance(cur).pumpHzList())
      } catch {
        return '[]'
      }
    },
    dispatchInput(nodeId: number, value: unknown) {
      // ★B4-T2b：委派当前屏实例（输入事件不冒泡、直接按 nodeId 查 input 绑定 → 跑 v-model 回写）。
      if (!cur) return { handled: false, fired: [] }
      try {
        return rt.instance(cur).dispatchInputValue(nodeId, value)
      } catch (e) {
        note(`[superapp-runtime] dispatchInput 异常：${String((e as Error)?.message ?? e)}`)
        return { handled: false, fired: [] }
      }
    },
    current: () => cur,
    // ★DevTools 元素内省（决策 #674）：当前屏已实例化节点（避免暴露整个 rt/instance 给桥）。
    currentContent: () => {
      if (!cur) return null
      try {
        const c = rt.instance(cur).content() as { viewport?: { width: number; height: number }; nodes: readonly unknown[] }
        // ★（决策 #713）带屏名 + 源文件 —— 面板据节点 `loc` 拼 `file:line:col`
        const file = (opts.artifacts[cur] as { file?: string } | undefined)?.file
        return { ...c, screen: cur, ...(file ? { file } : {}) }
      } catch { return null }
    },
    // ★排空式：返回自上次调用以来的手势 trace，并清空（宿主每次轮询取走）。
    devEvents: () => { const out = devEvents.slice(); devEvents.length = 0; return out },
    // ★排空式：当前屏页面处理器运行期错误（带模板源位置）——宿主 dev-watch 转发面板 Console。
    handlerErrors: () => (cur ? rt.instance(cur).handlerErrors() : []),
    // ★排空式：运行期阶段耗时（CPU Profiler · 决策 #715）——宿主 dev-watch 取走随 /ping?perf= 上报。
    profileStats: () => rt.profileStats(),
    snapshot: () => rt.snapshot(),
    lastHostReply: () => lastHostReply,
    // ★★★B5（2026-10-10）：宿主**卸载**某屏（缺省当前屏）时调用——跑该屏 `onUnmounted` 钩子。
    markUnmounted: (screenName?: string) => {
      const n = screenName ?? cur
      if (!n || !rt.has(n)) return 0
      try { return rt.instance(n).markUnmounted() } catch (e) { note(`[superapp-runtime] onUnmounted 异常：${String((e as Error)?.message ?? e)}`); return 0 }
    },
  }
}
