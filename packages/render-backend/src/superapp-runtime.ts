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
  dispatchGesture(type: string, chain: readonly number[]): { handled: boolean; fired: number[] }
  /** 当前屏名 */
  current(): string
  /** ★跨调用状态导出（`{屏名: 数据}`）——一次性 VM 宿主持有、下次回灌 `seedData` */
  snapshot(): Record<string, Record<string, unknown>>
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
  })
  let cur = ''

  // 注册手势反向回调（宿主在命中时报"内核 id + 冒泡链"）
  if (typeof opts.host.onGesture === 'function') {
    opts.host.onGesture(cbName)
  }
  // 全局回调：宿主 → 本模块 → 当前屏实例。★保持接收者绑定（iOS JSC JSExport 拆离会丢 this）。
  ;(globalThis as unknown as Record<string, unknown>)[cbName] = (
    type: string,
    _kernelId: number,
    chainJson?: string,
  ): string => {
    let chain: number[] = []
    try {
      chain = chainJson ? (JSON.parse(chainJson) as number[]) : []
    } catch {
      note(`[superapp-runtime] 手势链 JSON 解析失败：${String(chainJson).slice(0, 40)}`)
    }
    const r = dispatch(type, chain)
    return JSON.stringify(r)
  }

  function dispatch(type: string, chain: readonly number[]): { handled: boolean; fired: number[] } {
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
      opts.host.mount(JSON.stringify({ viewport: inst.content().viewport, nodes: inst.content().nodes }))
      // 挂载后再设滚动（树已重建；宿主按此值定位）
      if (typeof opts.host.setScroll === 'function') opts.host.setScroll(restore)
      cur = name
      return true
    },
    mountScreenInto(name: string): boolean {
      if (!rt.has(name)) { note(`[superapp-runtime] 无该屏运行期产物：${name}`); return false }
      const inst = rt.instance(name)
      // ★仅重挂（跳过滚动/历史逻辑——一次性 VM 宿主每次都从 content() 取新树；滚动由宿主自己管）
      opts.host.mount(JSON.stringify({ viewport: inst.content().viewport, nodes: inst.content().nodes }))
      cur = name
      return true
    },
    dispatchGesture: dispatch,
    current: () => cur,
    snapshot: () => rt.snapshot(),
  }
}
