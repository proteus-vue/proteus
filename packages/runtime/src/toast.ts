// src/runtime/toast.ts —— ★★★GP4-a（2026-10-03）：**Toast 队列**（替代 uni.showToast 的全局单例语义）
//
// 【这张卡要解决什么（方案 §1 的痛点表）】`uni.showToast` 是**全局单例**：样式固定、类型仅
//   loading/success/none/error、**无法管理顺序**——多个 Toast 连续触发时行为未定义（互相覆盖/
//   只有最后一个显示）。本模块把它换成**有序队列**：FIFO、上限 + 丢弃策略、可自定义位置/色彩
//   语义/时长、可手动关闭、可订阅（宿主渲染）。
//
// 【架构位置（三层分工，别混）】
//   · **本文件（runtime）** = 队列**状态与调度**（纯 TS，零 DOM/零 wx：跨端 + 可单测；
//     时长计时器与出队推进都归这里——★不能放宿主组件里：宿主每页一份（MP），
//     多实例各自计时会**重复推进**（同一秒弹两个））
//   · **宿主组件**（`p-toast-host`）= 渲染与挂载（`<teleport>` → Overlay 层，Overlay 通道归它）
//   · **注入**（plugin-vite 的 page-overlay）= MP 端把宿主注入每个页面（源码零每页引入）
//
// 【★诚实边界（与方案 §1.2-bis 同源）】MP 端宿主是**每页一份实例**（N = 页面栈深度）——
//   但队列状态是**模块级单例**（require 缓存同实例）⇒ "实例 N 份、状态一份"（同 custom-tab-bar）。
//   ⇒ 跨页一致（在 A 页触发的 toast，B 页宿主也渲染同一份 current）。
//
// 【时长语义】`duration` ms；`0` = **常驻**（直到 hideToast/clearToasts；用于"登录失效"等模态
//   前置提示）。计时器归队列：current 被替换/关闭时重置。
//
// 【丢弃策略（防刷屏——任务卡硬要求）】队列**等待区**上限 `maxSize`（默认 10；不含正在显示的那条）：
//   · `drop-oldest`（默认）：丢**排队最久**的那条——最新消息优先（提示类语义的常规取舍）
//   · `drop-newest`：丢弃**新来的**——保护既有顺序（批量导入进度类语义）
//   · `replace`：清空等待区并**立即替换当前**——打断语义（"会话已过期"这类必须立刻可见的提示）
//   ★三种都有 `dropped` 计数（可观测——不信"应该丢了"，看计数与订阅事件）。

/** Toast 色彩语义（对齐 WeUI/组件库既有 type 命名；不代表具体颜色——颜色由宿主 CSS 变量决定） */
export type ToastType = 'info' | 'success' | 'warn' | 'error'

/** 显示位置（Overlay 层内的锚点；三端一致：top 贴顶部安全区下沿 / center 居中 / bottom 贴底部上沿） */
export type ToastPosition = 'top' | 'center' | 'bottom'

/** 入队参数（`uni.showToast` 的超集：多了 type/position/dismissible/id/dedupe 语义） */
export interface ToastOptions {
  /** 提示文本（唯一必填） */
  text: string
  /** 色彩语义（默认 info） */
  type?: ToastType
  /** 位置（默认 center——与 uni.showToast 一致，便于迁移对照） */
  position?: ToastPosition
  /** 显示时长 ms；0 = 常驻（手动关闭）（默认 2000） */
  duration?: number
  /** 是否允许点击提示本体关闭（默认 false——与 uni.showToast 一致；true 时点它即关） */
  dismissible?: boolean
  /**
   * 调用方可指定 id（`hideToast(id)` 按 id 关闭；同 id 已在显示/排队中时**不重复入队**——幂等）。
   * 缺省自动生成（`toast-<n>`）。
   */
  id?: string
}

/** 队列中的一条（规范化后——宿主只读此结构） */
export interface ToastItem {
  id: string
  text: string
  type: ToastType
  position: ToastPosition
  /** 0 = 常驻 */
  duration: number
  dismissible: boolean
  /** 入队序号（单调递增；测试/诊断用，判断"按序显示"） */
  seq: number
}

/** 队列快照（订阅回调 / toastSnapshot() 的载荷——不可变视角） */
export interface ToastSnapshot {
  /** 正在显示的那条（无 = null） */
  current: ToastItem | null
  /** 等待区（FIFO；第一项是下一个要显示的） */
  queue: ToastItem[]
}

/** 订阅事件（`kind` 让调用方能区分"显示/前进/关闭/丢弃/清空"——诊断与测试断言用） */
export interface ToastEvent {
  /** show=开始显示 / queue=入队等待 / dismiss=关闭 / drop=丢弃 / clear=清空 / config=配置变更 */
  kind: 'show' | 'queue' | 'dismiss' | 'drop' | 'clear' | 'config'
  /** 事件涉及的那条（clear 无） */
  id?: string
  /** dismiss/drop 的原因（诊断用；也是"丢弃可观测"的落点） */
  reason?: 'duration' | 'manual' | 'replaced' | 'max-size' | 'clear' | 'swapped'
}

export type ToastDropPolicy = 'drop-oldest' | 'drop-newest' | 'replace'

export interface ToastConfig {
  /** 等待区上限（不含正在显示的那条；默认 10；<1 视为 1） */
  maxSize: number
  policy: ToastDropPolicy
}

export interface ToastStats {
  /** 累计真正显示过的条数（出队开显时 +1） */
  shown: number
  /** 累计被丢弃的条数（等待区满 + replace 清空——**可观测**，防"静默丢"） */
  dropped: number
  /** 累计手动/时长关闭数 */
  dismissed: number
}

export type ToastListener = (snapshot: ToastSnapshot, event: ToastEvent) => void

// ★模块求值探针（排障：模块被求值几次 = 有几个实例；多实例 ⇒ 页面与宿主各持一份队列）
if (typeof globalThis !== 'undefined') {
  const gg = globalThis as unknown as Record<string, unknown>
  gg.__PROTEUS_TOAST_MODULE_EVALS__ = (Number(gg.__PROTEUS_TOAST_MODULE_EVALS__) || 0) + 1
}

const DEFAULT_DURATION = 2000
const DEFAULT_CONFIG: ToastConfig = { maxSize: 10, policy: 'drop-oldest' }

/* ─────────────────────────── 队列状态（模块级单例） ─────────────────────────── */

/** 等待区（FIFO）；当前项在 `current` 里（不进数组——数组语义 = "排队等待"） */
let waiting: ToastItem[] = []
let current: ToastItem | null = null
let config: ToastConfig = { ...DEFAULT_CONFIG }
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0
let shown = 0
let dropped = 0
let dismissed = 0
/** 订阅者（宿主组件 / 测试）；Set 保证同一函数不会重复订阅 */
const listeners = new Set<ToastListener>()
/** ★无宿主告警只发一次（见 showToast 注释——它不是错误，是防"静默不显示"的提示） */
let warnedNoHost = false

const snapshot = (): ToastSnapshot => ({ current, queue: waiting.slice() })

function notify(event: ToastEvent): void {
  const snap = snapshot()
  // ★最近一次事件落痕（真机可观测：读"上一条为什么消失/现在显示什么"——排障第一手证据）
  if (typeof globalThis !== 'undefined') {
    const gg = globalThis as unknown as Record<string, unknown>
    gg.__PROTEUS_TOAST_LAST_EVENT__ = {
      kind: event.kind,
      id: event.id ?? null,
      reason: event.reason ?? null,
      current: snap.current ? snap.current.text : null,
      queue: snap.queue.length,
      at: Date.now(),
    }
  }
  for (const fn of [...listeners]) {
    // 单个订阅者抛错不影响其他订阅者与队列推进（宿主渲染失败不该拖垮逻辑层）
    try {
      fn(snap, event)
    } catch {
      /* 订阅者异常吞掉（不静默逻辑：宿主侧渲染错误有自己的诊断通道） */
    }
  }
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/** 让一条成为"正在显示"（启动计时；duration=0 不启） */
function activate(item: ToastItem, reason: ToastEvent['reason']): void {
  current = item
  shown++
  clearTimer()
  if (item.duration > 0) {
    timer = setTimeout(() => {
      timer = null
      dismissCurrent('duration')
    }, item.duration)
  }
  notify({ kind: 'show', id: item.id, reason })
}

/** 关闭当前（可选原因）并让等待区下一条上位 */
function dismissCurrent(reason: ToastEvent['reason']): void {
  if (!current) return
  const id = current.id
  clearTimer()
  current = null
  dismissed++
  const next = waiting.shift() ?? null
  notify({ kind: 'dismiss', id, reason })
  if (next) activate(next, 'swapped')
}

function normalize(opts: ToastOptions): ToastItem {
  if (!opts || typeof opts.text !== 'string') {
    // fail-closed：无文本的 toast 无意义（静默不显示才是最坏结果）——直接抛出，调用点立即可见
    throw new Error('[proteus/toast] showToast 需要 text（提示文本）')
  }
  const n = ++seq
  return {
    id: opts.id && opts.id.length > 0 ? opts.id : `toast-${n}`,
    text: opts.text,
    type: opts.type ?? 'info',
    position: opts.position ?? 'center',
    duration: opts.duration === undefined ? DEFAULT_DURATION : Math.max(0, opts.duration),
    dismissible: opts.dismissible === true,
    seq: n,
  }
}

/** 同 id 是否已在显示/排队中（幂等判据） */
function findById(id: string): ToastItem | null {
  if (current && current.id === id) return current
  return waiting.find((t) => t.id === id) ?? null
}

/* ─────────────────────────── 公开 API ─────────────────────────── */

/**
 * 显示一条 Toast（入队；无正在显示则立即显示）。
 *
 * 【顺序保证】已有正在显示 ⇒ 进等待区（FIFO）——**绝不抢占**（除非 policy='replace'）。
 * 【幂等】同 `id` 已在显示/排队 ⇒ 不重复入队（防"响应了两次请求弹两条"）。
 * 【无宿主提示（防静默不显示）】当前无任何宿主订阅时给**一次** console 提示——
 *   · MP 端宿主由构建期注入（检测到本 API 用法才注入，见 plugin-vite 的 page-overlay）；
 *     页面 `onLoad` 早期触发可能早于宿主就绪（宿主就绪时会补显示当前值）——**这条提示可忽略**
 *   · Web 端需要在 App.vue 挂一次 `<p-toast-host />`——**这条提示就是提醒你补它**
 *
 * @returns 该条的 id（交给 `hideToast(id)` 用）
 */
export function showToast(opts: ToastOptions): string {
  const item = normalize(opts)
  if (findById(item.id)) return item.id // 幂等：同 id 不重复入队
  __checkHostPresence()

  if (!current) {
    activate(item, 'swapped')
    return item.id
  }
  const full = waiting.length >= config.maxSize
  if (full && config.policy === 'drop-newest') {
    // 丢弃**新来的**（保护既有顺序——批量进度类语义）
    dropped++
    notify({ kind: 'drop', id: item.id, reason: 'max-size' })
    return item.id
  }
  if (full && config.policy === 'replace') {
    // 清空等待区 + **打断当前**（"必须立刻可见"的语义：会话过期/致命错误）
    const cleared = waiting.length
    waiting = []
    const interrupted = current
    dropped += cleared + (interrupted ? 1 : 0)
    dismissed += interrupted ? 1 : 0
    clearTimer()
    current = null
    if (interrupted) notify({ kind: 'dismiss', id: interrupted.id, reason: 'replaced' })
    activate(item, 'replaced')
    return item.id
  }
  if (full) {
    // drop-oldest（默认）：丢排队最久的那条，给新消息让位
    const victim = waiting.shift()
    dropped++
    if (victim) notify({ kind: 'drop', id: victim.id, reason: 'max-size' })
  }
  waiting.push(item)
  notify({ kind: 'queue', id: item.id })
  return item.id
}

/**
 * 关闭 Toast。
 * · 传 id：若它是当前项 ⇒ 关闭并前进；若在等待区 ⇒ 仅移除（可见结果：这条永远不会显示）
 * · 不传：关闭当前项（等价"手动关闭"）
 */
export function hideToast(id?: string): void {
  if (!current) {
    if (id) {
      const before = waiting.length
      waiting = waiting.filter((t) => t.id !== id)
      if (waiting.length !== before) notify({ kind: 'dismiss', id, reason: 'manual' })
    }
    return
  }
  if (!id || current.id === id) {
    dismissCurrent('manual')
    return
  }
  const before = waiting.length
  waiting = waiting.filter((t) => t.id !== id)
  if (waiting.length !== before) notify({ kind: 'dismiss', id, reason: 'manual' })
}

/** 清空一切（当前 + 等待区）——"导航离开/登出"等场景的收口 */
export function clearToasts(): void {
  clearTimer()
  const ids = [current?.id, ...waiting.map((t) => t.id)].filter(Boolean) as string[]
  if (ids.length === 0) return
  current = null
  waiting = []
  notify({ kind: 'clear' })
  // 逐条补 dismiss 事件（订阅方按 id 清理动画态用；clear 事件本身只表"整体清空"）
  for (const id of ids) notify({ kind: 'dismiss', id, reason: 'clear' })
}

/** 配置（部分字段；maxSize < 1 归 1——"等待区至少能放一条"） */
export function configureToast(partial: Partial<ToastConfig>): void {
  config = {
    maxSize: partial.maxSize === undefined ? config.maxSize : Math.max(1, Math.floor(partial.maxSize)),
    policy: partial.policy ?? config.policy,
  }
  notify({ kind: 'config' })
}

/** 只读快照（宿主首帧/测试断言用） */
export function toastSnapshot(): ToastSnapshot {
  return snapshot()
}

/** 统计（丢弃可观测：`dropped` 是"队列防刷屏真的生效过"的证据） */
export function toastStats(): ToastStats {
  return { shown, dropped, dismissed }
}

/** 订阅队列变化（宿主组件用；返回退订函数） */
export function subscribeToast(fn: ToastListener): () => void {
  // ★诊断落痕（模块实例身份与订阅者数）：若页面与宿主 require 到**不同实例**，两侧计数会分叉。
  //   ★★首版这里写成 `listeners.size + 1`（**加了再报**）——读数恒定 ⇒ 排障时误以为"订阅没增长"，
  //     实际是我把计数器写错了一位（测量装置缺陷被当成产品缺陷查了两轮）。
  //     ⇒ 现改为**如实计数**（add 之后读 size）。
  listeners.add(fn)
  // ★落痕（**真机可观测性**，不是测试专用）：宿主数量与订阅数不一致时 = 注入/生命周期异常。
  //   ▶ 本轮排障正是靠它与 `__PROTEUS_TOAST_MODULE_EVALS__` 判定"页面与宿主是不是同一份队列模块"。
  const g = (typeof globalThis !== 'undefined' ? globalThis : {}) as Record<string, unknown>
  g.__PROTEUS_TOAST_SUBSCRIBERS__ = listeners.size
  return () => {
    listeners.delete(fn)
  }
}

/** 当前配置（测试/诊断） */
export function toastConfig(): ToastConfig {
  return { ...config }
}

/**
 * ★测试/收尾专用：重置全部状态（含统计与"已告警"标记、退订所有订阅者）。
 * 【为什么必须有】模块级单例在**测试进程**里跨用例存活——没有它，用例相互污染
 *   （上一条的计时器会在下一条用例里触发）。生产代码不应调用。
 */
export function __resetToastForTest(): void {
  clearTimer()
  waiting = []
  current = null
  config = { ...DEFAULT_CONFIG }
  seq = 0
  shown = 0
  dropped = 0
  dismissed = 0
  warnedNoHost = false
  listeners.clear()
}

/** ★内部：无宿主提示（供 showToast 用；导出仅为可测性——外部不应直接调用） */
export function __checkHostPresence(): void {
  if (warnedNoHost || listeners.size > 0) return
  warnedNoHost = true
  console.warn(
    '[proteus/toast] showToast() 时暂无宿主订阅：MP 端宿主由构建期注入（检测到 toast API 用法才注入——' +
      '若提示始终不显示，请显式在任一页面写 <p-toast-host />）；Web 端请在 App.vue 挂一次 <p-toast-host />。' +
      '（页面 onLoad 早期触发早于宿主就绪——宿主就绪时会补显示当前值，此提示可忽略）',
  )
}
