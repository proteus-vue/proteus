// src/runtime/loading.ts —— ★★★GP4-b（2026-10-03）：**Loading 多实例与遮罩范围**
//
// 【这张卡与 GP4-a（Toast）的差别（别把两者当同一个东西）】
//   · **Toast = 队列**（同一时刻只显示一条，其余排队——"临时提示"的语义）
//   · **Loading = 多实例**（同时存在 N 个，各有各的遮罩范围——"进行中任务"的语义：
//     全局网络忙 + 本页表单提交 + 某区域导出，三者可同时为真）
//   ⇒ 故本模块不是队列，而是**以 id 为键的活跃集合**（同 id 再 show = 替换，对齐 `uni.showLoading`）。
//
// 【三种遮罩范围（任务卡必做项 2）——本文件负责前两种，第三种是组件】
//   · `global`（全局）：跨页可见 + **跨页存活**（页面卸载不清理）——"全应用网络忙"
//   · `page`（当前页面）：**只在本页可见**（按 pageKey 过滤）+ **页面卸载自动清理**——防"忘了 hide"泄漏
//   · `region`（指定区域）：由组件 `p-loading-region` **就地**渲染（几何精确，零测量）——
//     ★为什么不做进本服务：区域遮罩要贴合**某个元素的盒子**，而宿主在 root-portal 里（页面级坐标系），
//       要贴合就得测量元素矩形 + 处理滚动/尺寸变化——脆弱且有三端差异。就地包裹则天然精确。
//
// 【交互拦截语义（任务卡必做项 3）】`mask: true`（默认）时遮罩**吞掉点击**（不冒泡到页面）；
//   `dismissible: false`（默认）时点击遮罩**不关闭**（loading 的结束由业务显式 hide——
//   与 `uni.showLoading` 一致：遮罩点击不是结束信号）。要"点遮罩可关"须显式 `dismissible: true`。
//
// 【★诚实边界（与 GP3-b1/GP4-a 同一条 §1.2-bis 边界）】MP 端宿主**每页一份**；本模块状态是
//   **模块级单例**（require 缓存同实例）⇒ "实例 N 份、状态一份"。`global` 跨页可见正是靠这一点，
//   而 `page` 靠 pageKey 过滤把它拉回"只在本页"。

/** 遮罩范围（region 由组件承载，不进入本服务的 API 字面量——见文件头） */
export type LoadingScope = 'global' | 'page'

export interface LoadingOptions {
  /**
   * 实例 id（缺省 `'default'`——对齐 `uni.showLoading` 的"同名替换"语义：
   * 连续 showLoading 不会叠出两个遮罩，后者替换前者）。
   */
  id?: string
  /** 提示文案（缺省空——只显示 spinner） */
  text?: string
  /** 遮罩范围（缺省 `'page'`——更安全的默认：忘了 hide 也不跨页泄漏） */
  scope?: LoadingScope
  /** 是否显示遮罩并拦截交互（缺省 true） */
  mask?: boolean
  /** 点击遮罩是否关闭（缺省 false——见文件头的交互拦截语义） */
  dismissible?: boolean
}

/** 活跃实例（宿主只读此结构） */
export interface LoadingItem {
  id: string
  text: string
  scope: LoadingScope
  mask: boolean
  dismissible: boolean
  /** page 范围的归属页（宿主按此过滤；global 为空串） */
  pageKey: string
  /** 插入序号（单调递增；**渲染顺序 = seq 升序**，后插入的在树上更靠后 ⇒ 层叠更高——树序即 z-order） */
  seq: number
  /** 插入时间（诊断/超时排查用） */
  at: number
}

export interface LoadingEvent {
  kind: 'show' | 'replace' | 'hide' | 'clear'
  id?: string
  /** hide/clear 的归因（诊断：是业务主动关、还是页面卸载清理） */
  reason?: 'manual' | 'page-unload' | 'replaced' | 'clear'
}

export interface LoadingStats {
  /** 累计 show（含替换）次数 */
  shown: number
  /** 累计 hide 次数 */
  hidden: number
  /** 累计被页面卸载清理的条数（"忘了 hide"的可观测面——这个数持续增长说明业务有泄漏习惯） */
  swept: number
}

export type LoadingListener = (items: LoadingItem[], event: LoadingEvent) => void

/** 缺省 id（对齐 uni.showLoading 的同名替换语义） */
const DEFAULT_ID = 'default'

/** 活跃集合（**有序**：seq 升序 = 插入序；渲染顺序即层叠顺序） */
let active: LoadingItem[] = []
let seq = 0
let shown = 0
let hidden = 0
let swept = 0
const listeners = new Set<LoadingListener>()

/** ★取当前页标识（page 范围的归属；无页面上下文时为空串 = 视为 global，不静默丢） */
function currentPageKey(): string {
  try {
    const pages = (getCurrentPages?.() ?? []) as Array<{ route?: string }>
    return pages.length ? (pages[pages.length - 1].route ?? '') : ''
  } catch {
    return ''
  }
}

function snapshot(): LoadingItem[] {
  return active.slice()
}

function notify(event: LoadingEvent): void {
  const items = snapshot()
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as unknown as Record<string, unknown>
    // ★真机可观测性（同 GP4-a 的做法）：最近一次事件的完整投影——排障第一手证据
    g.__PROTEUS_LOADING_LAST_EVENT__ = {
      kind: event.kind,
      id: event.id ?? null,
      reason: event.reason ?? null,
      count: items.length,
      ids: items.map((i) => i.id),
      at: Date.now(),
    }
  }
  for (const fn of [...listeners]) {
    // 单个订阅者抛错不影响其他订阅者与状态推进（宿主渲染失败不该拖垮逻辑层）
    try {
      fn(items, event)
    } catch {
      /* 订阅者异常吞掉（宿主侧渲染错误有自己的诊断通道） */
    }
  }
}

/* ─────────────────────────── 公开 API ─────────────────────────── */

/**
 * 显示一个 Loading（同 id 再调 ⇒ **替换**，不叠加——对齐 `uni.showLoading`）。
 *
 * @returns 该实例 id（交给 `hideLoading(id)` 用）
 */
export function showLoading(opts: LoadingOptions = {}): string {
  const id = opts.id && opts.id.length > 0 ? opts.id : DEFAULT_ID
  const scope: LoadingScope = opts.scope === 'global' ? 'global' : 'page'
  const item: LoadingItem = {
    id,
    text: opts.text ?? '',
    scope,
    mask: opts.mask !== false,
    dismissible: opts.dismissible === true,
    // page 范围绑定当前页（global 不带页键 ⇒ 所有宿主都渲染）
    pageKey: scope === 'page' ? currentPageKey() : '',
    seq: ++seq,
    at: Date.now(),
  }
  const idx = active.findIndex((i) => i.id === id)
  const replaced = idx >= 0
  if (replaced) {
    // ★替换时**保留原位置**（不跳到最上层）：同 id 反复刷新文案不该改变层叠顺序
    item.seq = active[idx]!.seq
    active = active.map((i) => (i.id === id ? item : i))
  } else {
    active = [...active, item]
  }
  shown++
  notify({ kind: replaced ? 'replace' : 'show', id, ...(replaced ? { reason: 'replaced' as const } : {}) })
  return id
}

/**
 * 关闭 Loading。
 * · 传 id ⇒ 关该实例；· 不传 ⇒ 关 `'default'`（对齐 `uni.hideLoading`）
 * @returns 是否真的关掉了一个（false = 本来就不存在——**不静默**：调用方可据此诊断）
 */
export function hideLoading(id: string = DEFAULT_ID): boolean {
  const exists = active.some((i) => i.id === id)
  if (!exists) return false
  active = active.filter((i) => i.id !== id)
  hidden++
  notify({ kind: 'hide', id, reason: 'manual' })
  return true
}

/** 批量清理（缺省清**全部**；可按 scope / pageKey 过滤——页面卸载清理走此口） */
export function clearLoadings(filter?: { scope?: LoadingScope; pageKey?: string }): number {
  const before = active.length
  const keep = active.filter((i) => {
    if (!filter) return false // 清全部
    if (filter.scope !== undefined && i.scope !== filter.scope) return true
    if (filter.pageKey !== undefined && i.pageKey !== filter.pageKey) return true
    return false
  })
  const removed = before - keep.length
  if (removed === 0) return 0
  active = keep
  // 归因区分：按 pageKey 过滤的清理 = 页面卸载清扫（可观测"业务泄漏习惯"）
  const reason = filter?.pageKey !== undefined ? 'page-unload' : 'clear'
  if (reason === 'page-unload') swept += removed
  else hidden += removed
  notify({ kind: 'clear', reason })
  return removed
}

/** 只读快照（宿主首帧/测试断言用；**顺序即层叠顺序**） */
export function loadingSnapshot(): LoadingItem[] {
  return snapshot()
}

/** 统计（`swept` = 被页面卸载清理的条数——业务"忘了 hide"的可观测指标） */
export function loadingStats(): LoadingStats {
  return { shown, hidden, swept }
}

/** 订阅（宿主组件用；返回退订函数） */
export function subscribeLoading(fn: LoadingListener): () => void {
  listeners.add(fn)
  const trace = (): void => {
    if (typeof globalThis !== 'undefined') {
      const g = globalThis as unknown as Record<string, unknown>
      g.__PROTEUS_LOADING_SUBSCRIBERS__ = listeners.size
    }
  }
  trace()
  return () => {
    listeners.delete(fn)
    // ★退订也要更新落痕（GP4-a 的教训：只在 add 侧写 ⇒ 读数**恒定**，
    //   排障时误判"订阅没增长/没退出"——测量装置缺陷被当成产品缺陷查了两轮）
    trace()
  }
}

/** ★宿主卸载时调用：清理**本页**的 page 级实例（global 不动——它本来就跨页存活） */
export function sweepPageLoadings(pageKey: string): number {
  if (!pageKey) return 0
  return clearLoadings({ scope: 'page', pageKey })
}

/**
 * ★测试/收尾专用：重置全部状态（含统计、订阅者、"最后事件"落痕）。
 * 【为什么必须有】模块级单例在测试进程里跨用例存活——没有它，用例相互污染。
 */
export function __resetLoadingForTest(): void {
  active = []
  seq = 0
  shown = 0
  hidden = 0
  swept = 0
  listeners.clear()
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as unknown as Record<string, unknown>
    delete g.__PROTEUS_LOADING_LAST_EVENT__
    delete g.__PROTEUS_LOADING_SUBSCRIBERS__
  }
}
