// packages/slot-runtime/src/dispatch.ts
// ★★P2-3（2026-10-03）：**手势派发语义**（含事件修饰符）——各宿主共用的唯一实现
//
// 【这一层补的是什么（本仓核实的缺口）】编译期 `compileEvents` 产出的 `events`（节点 → 事件 → handler）
//   此前只有 **Android 桥内联的一份** 派发逻辑（`dispatchChainA`）：沿内核给的冒泡链逐跳查找并执行
//   handler，**不支持任何事件修饰符**（`.stop` / `.self` / `.once` 一律编译期诊断拒绝）。
//   ⇒ 两个问题：
//     ① 语义缺口：`@click.stop` 这类**模板里真实存在**的写法要么被拒绝（用户被迫改写），
//        要么在"允许但忽略"的实现下**静默多派发**（点了按钮把祖先的 handler 也跑了）；
//     ② 分叉风险：派发语义写在各端桥里 ⇒ iOS / Harmony 各自再写一份必然漂移
//        （本仓纪律：同一语义只允许一处实现）。
//   ⇒ 本模块把「链序 + 修饰符 + 一次性状态」收敛成**纯数据 + 纯函数**：
//     契约（EventBinding）定义在消费端（与 table.ts / layout-template.ts 同一处置），
//     各端宿主只注入"怎么跑 handler"，派发顺序与修饰符语义由本模块决定。
//
// 【修饰符语义（我们的模型：宿主合成手势 + 内核冒泡链，无 DOM 事件对象）】
//   · `.stop`  —— 本跳 handler 跑完后**终止冒泡**（不再跑祖先 handler）。与 DOM `stopPropagation` 等价。
//   · `.self`  —— 只有**命中节点就是本节点**时才跑（DOM `target === currentTarget` 的等价）。
//   · `.once`  —— 同一绑定只跑一次（状态由调用方持有，见 DispatchState；页面重挂载 ⇒ 新状态）。
//   · `.prevent` / `.passive` / `.capture` —— **无对应语义**（自绘 UI 无浏览器默认动作、
//     无捕获阶段），编译期产诊断并**忽略修饰符本身**（不阻碍 handler 执行）——见 compiler 侧注释。
//
// 【★诚实边界】本模块只决定"跑哪些 handler、按什么顺序、何时停"；
//   它**不**知道手势的来源（真实触摸 / 注入），也**不**做命中测试（那是内核的 `hitTest`）。

/** 一条事件绑定（编译产物 `events` 的元素；契约定义在消费端——编译器 import） */
export interface EventBinding {
  /** 目标节点 id（模板序；与订阅表 nodeId 同源） */
  nodeId: number
  /** 语义事件名（本版：tap / longpress） */
  event: string
  /** handler 名（指向动作表） */
  handler: string
  /** `.stop`：本跳跑完后终止冒泡 */
  stop?: boolean
  /** `.self`：仅当命中节点 === 本节点时才跑 */
  self?: boolean
  /** `.once`：同一绑定只跑一次（需调用方持有 DispatchState） */
  once?: boolean
}

/**
 * 派发状态（`.once` 的"已跑过"集合）
 *
 * 【为什么由调用方持有而不是模块内全局】状态的生命周期与**页面/组件实例**绑定：
 *   重新挂载页面 = 新的 `.once` 语义（官方 Vue 同：组件重建后 `.once` 重新生效）。
 *   模块级全局会让"重挂载后第一次点击"被**静默吞掉**（本仓最忌的静默失效）。
 */
export interface DispatchState {
  /** 已执行过的绑定键（`nodeId:event:handler`） */
  readonly onceFired: Set<string>
}

/** 新建派发状态（每个页面/树实例一个） */
export function createDispatchState(): DispatchState {
  return { onceFired: new Set<string>() }
}

export interface DispatchResult {
  /** 实际跑过 handler 的节点 id（按执行顺序） */
  fired: number[]
  /** 第一个跑起来的 handler 名（无 ⇒ 空串；供判据/对账） */
  handler: string
  /** 是否被 `.stop` 终止（true ⇒ 链上更浅的节点不再派发） */
  stopped: boolean
  /** 因 `.self` 跳过的节点（诊断：区分"没有绑定"与"有绑定但被 .self 挡下"） */
  skippedSelf: number[]
  /** 因 `.once` 已跑过而跳过的节点（同上的可见性理由） */
  skippedOnce: number[]
}

const keyOf = (nodeId: number, event: string, handler: string): string => `${nodeId}:${event}:${handler}`

/** 事件绑定索引（`节点:事件` → 绑定）——建一次、每次手势复用（热路径不重复建 Map） */
export type EventIndex = Map<string, EventBinding>

/**
 * 建索引（**与既有实现逐字一致**：同一 (节点,事件) 出现多条时**后者覆盖前者**）
 *
 * 【为什么单独一步】派发在**热路径**上（每次手势都要查），逐次重建 Map 是白付成本；
 *   而绑定表在页面生命周期内不变 ⇒ 建一次即可（本仓既有实现就是先建后派发，保持同一形态）。
 */
export function indexEventBindings(bindings: readonly EventBinding[]): EventIndex {
  const byNodeEvent: EventIndex = new Map()
  for (const b of bindings) byNodeEvent.set(`${b.nodeId}:${b.event}`, b)
  return byNodeEvent
}

/**
 * 沿**冒泡链**派发一次手势。
 *
 * @param chain  冒泡链（内核 `bubble_chain` 语义：**自深到浅**，chain[0] = 命中节点）
 * @param event  语义事件名（宿主上报的类型；如 tap / longpress）
 * @param index  `indexEventBindings(events)` 的产物
 * @param state  `.once` 状态（调用方持有，见 DispatchState）
 * @param run    执行 handler（返回 false = 没跑成/不存在 ⇒ 不计入 fired）
 *
 * ★查找口径与既有实现**逐字一致**（含 `:tap` 兜底）：先查 `节点:事件`，
 *   再退到 `节点:tap`——宿主上报的类型可能是 `longpress` 而绑定只在 tap 上，
 *   这一兜底维持既有行为（改动它属行为变更，不在本批范围）。
 */
export function dispatchGesture(
  chain: readonly number[],
  event: string,
  index: EventIndex,
  state: DispatchState,
  run: (handler: string) => boolean,
): DispatchResult {
  const fired: number[] = []
  const skippedSelf: number[] = []
  const skippedOnce: number[] = []
  let handler = ''
  let stopped = false
  const hit = chain.length > 0 ? chain[0]! : -1

  for (const id of chain) {
    const b = index.get(`${id}:${event}`) ?? index.get(`${id}:tap`)
    if (!b) continue
    // `.self`：命中节点不是本节点 ⇒ 跳过（DOM `target === currentTarget` 等价）
    if (b.self && id !== hit) {
      skippedSelf.push(id)
      continue
    }
    // `.once`：已跑过 ⇒ 跳过
    const onceKey = keyOf(id, b.event, b.handler)
    if (b.once && state.onceFired.has(onceKey)) {
      skippedOnce.push(id)
      continue
    }
    if (!run(b.handler)) continue
    if (b.once) state.onceFired.add(onceKey)
    fired.push(id)
    if (!handler) handler = b.handler
    // `.stop`：跑完后终止冒泡（注意顺序——**先跑本跳再停**）
    if (b.stop) {
      stopped = true
      break
    }
  }
  return { fired, handler, stopped, skippedSelf, skippedOnce }
}
