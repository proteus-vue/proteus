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
   * ★★★**新屏挂载前重置滚动偏移**（用户抓出「网格流/网格区域打开默认顶部超出状态栏，下滑就正常」）。
   *
   * 【为什么必须】滚动偏移（Android scrollY/scrollX / iOS contentOffset）是**视图属性**、不是树属性
   *   ⇒ 上一屏滚动后挂载新屏时偏移**仍在** ⇒ 新屏内容整体上移（顶部被顶出/压过状态栏）；
   *   一旦用户下滑，偏移被重新钳制 ⇒ "又正常了"（现象迷惑，根因就是跨屏状态泄漏）。
   *   iOS SelfDrawView.resetContentOffset() 注释早写明"建新树时必须调用"——统一运行期补上这一步。
   */
  resetScroll?(): void
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
  /** 诊断（不静默） */
  onNote?: (note: string) => void
}

export interface SuperappRuntime {
  /** 挂载（或重挂载）某屏：实例化 → `host.mount`；并记忆为"当前屏"（手势派发用） */
  mountScreen(name: string): boolean
  /** 派发一次手势：宿主报的内核 id + 冒泡链 → 当前屏实例派发 */
  dispatchGesture(type: string, chain: readonly number[]): { handled: boolean; fired: number[] }
  /** 当前屏名 */
  current(): string
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

  return {
    mountScreen(name: string): boolean {
      if (!rt.has(name)) { note(`[superapp-runtime] 无该屏运行期产物：${name}`); return false }
      const inst = rt.instance(name)
      // ★新屏挂载前重置滚动偏移（跨屏状态泄漏防护——见 SuperappHostPorts.resetScroll 注释）
      if (typeof opts.host.resetScroll === 'function') opts.host.resetScroll()
      opts.host.mount(JSON.stringify({ viewport: inst.content().viewport, nodes: inst.content().nodes }))
      cur = name
      return true
    },
    dispatchGesture: dispatch,
    current: () => cur,
  }
}
