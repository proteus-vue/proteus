// packages/api/src/capability-app-intersection.ts
// ★★★决策 #1086（2026-10-19）：App 端**交叉观察**（C59 `useIntersection`）——`IntersectionObserver` 语义的 App 落地。
//
// 【为什么现在能做（取证先于实现）】
//   此前记为"如实不支持"，理由是"缺渲染宿主的帧级几何变化通知"。本轮取证发现：
//   · `element.rect` 已返回**视口坐标**（内容坐标 − scrollY，见 #1081）⇒ 目标元素的几何现成；
//   · 视口尺寸可从运行期拿到；
//   · 三端滚动入口都是**单点**（Android `onScrollPos` / iOS `applyContentOffset` /
//     鸿蒙渲染时传入 scrollY）⇒ 加一个"几何变了"的 tick 即可。
//   ⇒ **相交计算完全放在 JS**（与 Web 的观察者语义天然同构），宿主只推 tick、不做几何数学。
//
// 【语义（对齐 Web `IntersectionObserver` / wx `createIntersectionObserver`）】
//   · `relativeToViewport(margins)`：参照 = 视口（可外扩/内缩 margins）；
//   · `relativeTo(selector, margins)`：参照 = 某个元素（可外扩/内缩）；
//   · `observe(targetSelector, cb)`：**立即评估一次**（Web 的初始回调语义），此后每次几何变化再评估；
//   · `thresholds`：相交比例**跨档**时才回调（不是每 tick 都回调——与 Web 同）；
//   · `observeAll`：观察选择器的**全部**匹配（`querySelectorAll` 语义）；
//   · `disconnect()`：全部释放。
//
// 【诚实边界（不静默半支持）】
//   ① **只在"几何变了"时评估**：滚动（宿主 tick）与 observe 时刻。**不监听**纯布局变化
//      （内容高度变化导致上方元素位移、动画位移）——那需要渲染宿主的帧级通知，属后续批次。
//   ② **鸿蒙不支持**：一次性 VM（#540）⇒ 观察者无法跨渲染存活（`observe` 注册的条目在下一个 VM
//      就不存在了）⇒ 该端 `unsupported`（不假装能观察）。
//   ③ 参照元素被销毁/查不到 ⇒ 该次评估跳过（不伪造 0 比例）。

import { invokeHost } from './capability-invoke'
import { CapError as ProteusCapError } from './capability-types'
import type {
  IntersectionHandle,
  IntersectionOptions,
  IntersectionResult,
} from './capability-types'

/** 宿主几何回执（`element.rect` 的 `data`）——**视口坐标 + 逻辑 px** */
interface HostRect {
  x?: number
  y?: number
  width?: number
  height?: number
  scrollY?: number
}

/** 相交观察的依赖注入（由装配层提供——能力层不反向依赖渲染包/运行期） */
export interface IntersectionDeps {
  /** 当前视口（逻辑 px）；拿不到 ⇒ 该轮不评估（不猜） */
  viewport(): { width: number; height: number } | null
  /** 选择器 → 第一个节点（与 `useElement` 同一解析器） */
  resolve(selector: string): { nodeId: number; source: string } | null
  /** 选择器 → 全部节点（`observeAll` 用；与 `resolve` 同一文档序） */
  resolveAll(selector: string): Array<{ nodeId: number; source: string }>
}

let injectedDeps: IntersectionDeps | null = null

/** 装配层注入依赖（重复注入 = 覆盖——便于测试与热切换）。 */
export function installIntersectionDeps(d: IntersectionDeps | null): void {
  injectedDeps = d
}

/** 当前注入的依赖（诊断/测试）。 */
export function currentIntersectionDeps(): IntersectionDeps | null {
  return injectedDeps
}

/* ══════════════════════ 几何 ══════════════════════ */

interface Rect { left: number; top: number; right: number; bottom: number }
interface Margins { left?: number; right?: number; top?: number; bottom?: number }

/** 取节点在**视口坐标**下的矩形（复用既有 `element.rect`——不新增宿主方法） */
function nodeRect(nodeId: number): Rect | null {
  const r = invokeHost('element.rect', { nodeId })
  if (!r.ok) return null
  const d = (r.data ?? {}) as HostRect
  const x = Number(d.x ?? 0)
  const top = Number(d.y ?? 0) - Number(d.scrollY ?? 0)
  const w = Number(d.width ?? 0)
  const h = Number(d.height ?? 0)
  return { left: x, top, right: x + w, bottom: top + h }
}

function expand(r: Rect, m: Margins | undefined): Rect {
  if (!m) return r
  return {
    left: r.left - (m.left ?? 0),
    right: r.right + (m.right ?? 0),
    top: r.top - (m.top ?? 0),
    bottom: r.bottom + (m.bottom ?? 0),
  }
}

function intersect(a: Rect, b: Rect): Rect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
}

function area(r: Rect): number {
  return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top)
}

/**
 * 相交比例（Web 语义：`intersectionRect 面积 / boundingClientRect 面积`）。
 * ★目标面积为 0 ⇒ 回 0（Web 对"空矩形"的边界行为有两种引擎差异；这里取**保守的 0**，
 *   并在结果里如实给出 0 尺寸的 `boundingClientRect`，调用方可自行判断）。
 */
export function ratioOf(target: Rect, ref: Rect): number {
  const ta = area(target)
  if (ta <= 0) return 0
  return Math.min(1, area(intersect(target, ref)) / ta)
}

/* ══════════════════════ 观察者 ══════════════════════ */

interface Entry {
  targetNodeId: number
  targetId?: string
  cb: (result: IntersectionResult) => void
  thresholds: number[]
  /** 上次落档（-1 = 从未回调过 ⇒ 首评必回调，对齐 Web 初始回调） */
  lastBucket: number
  rel: { kind: 'viewport' } | { kind: 'node'; nodeId: number }
  margins?: Margins
}

/** 所有活动观察者（模块级：观察者生命周期跨 tick，与页面同寿） */
const entries: Entry[] = []

function bucketOf(ratio: number, thresholds: number[]): number {
  // ★浮点容差：ratio 恰好等于阈值时应算"跨过"（Web 也按 >= 判）
  let b = 0
  for (const t of thresholds) if (ratio + 1e-9 >= t) b++
  return b
}

function refRectOf(e: Entry): Rect | null {
  if (e.rel.kind === 'viewport') {
    const vp = injectedDeps?.viewport() ?? null
    if (!vp) return null
    return { left: 0, top: 0, right: vp.width, bottom: vp.height }
  }
  const r = nodeRect(e.rel.nodeId)
  return r
}

/**
 * 评估全部观察者（宿主几何变化时调；`observe` 后也会立即调一次）。
 *
 * ★返回本轮**真正回调**的条数（判据可读：证明"不是每 tick 都回调"）。
 */
export function evaluateIntersections(now = Date.now()): number {
  if (!injectedDeps) return 0
  let fired = 0
  for (const e of entries) {
    const target = nodeRect(e.targetNodeId)
    if (!target) continue                      // 节点没了 ⇒ 跳过（不伪造 0）
    const refRaw = refRectOf(e)
    if (!refRaw) continue                       // 参照拿不到 ⇒ 跳过
    const ref = expand(refRaw, e.margins)
    const ratio = ratioOf(target, ref)
    const bucket = bucketOf(ratio, e.thresholds)
    if (bucket === e.lastBucket) continue       // 未跨档 ⇒ 不回调（Web 同语义）
    e.lastBucket = bucket
    const clipped = intersect(target, ref)
    const result: IntersectionResult = {
      ...(e.targetId !== undefined ? { id: e.targetId } : {}),
      intersectionRatio: ratio,
      intersectionRect: {
        left: clipped.left, top: clipped.top, right: clipped.right, bottom: clipped.bottom,
        width: Math.max(0, clipped.right - clipped.left), height: Math.max(0, clipped.bottom - clipped.top),
      },
      boundingClientRect: {
        ...(e.targetId !== undefined ? { id: e.targetId } : {}),
        left: target.left, top: target.top, right: target.right, bottom: target.bottom,
        width: Math.max(0, target.right - target.left), height: Math.max(0, target.bottom - target.top),
      },
      relativeRect: {
        left: ref.left, top: ref.top, right: ref.right, bottom: ref.bottom,
        width: Math.max(0, ref.right - ref.left), height: Math.max(0, ref.bottom - ref.top),
      },
      time: now,
    }
    try {
      e.cb(result)
      fired++
    } catch {
      // 单个回调抛错不影响其余观察者
    }
  }
  return fired
}

/** 诊断：当前观察者数量（判据可读）。 */
export function intersectionStats(): { total: number; targets: number[] } {
  return { total: entries.length, targets: entries.map((e) => e.targetNodeId) }
}

/** 测试用：清空全部观察者。 */
export function resetIntersections(): void {
  entries.length = 0
}

/**
 * 创建交叉观察句柄（`CapabilityBridge.createIntersection` 的实现）。
 *
 * ★与 Web 同语义：`relativeTo` / `relativeToViewport` 改的是"**下一个** observe 的参照"，
 *   因此在 `observe` 之前调用（与 wx / Web 一致）。
 * ★`disconnect()` 只清**本句柄**注册的观察者（多个句柄并存互不影响）。
 */
export function createAppIntersection(options?: IntersectionOptions): IntersectionHandle {
  const thresholds = (options?.thresholds && options.thresholds.length ? options.thresholds : [0])
    .filter((t) => typeof t === 'number' && Number.isFinite(t))
    .map((t) => Math.min(1, Math.max(0, t)))
    .sort((a, b) => a - b)
  const observeAll = options?.observeAll === true

  let pendingRel: Entry['rel'] = { kind: 'viewport' }
  let pendingMargins: Margins | undefined
  let disconnected = false
  /** 本句柄注册的观察者（`disconnect` 只清这些） */
  const own: Entry[] = []

  const handle: IntersectionHandle = {
    relativeTo(selector: string, margins?: Margins) {
      const hit = injectedDeps?.resolve(selector) ?? null
      // ★查不到参照元素 ⇒ **不静默退回视口**（那会让业务以为在相对某元素观察）；
      //   记成"拿不到参照"（nodeId = -1），该观察者永不回调（`refRectOf` 返回 null）。
      pendingRel = hit ? { kind: 'node', nodeId: hit.nodeId } : { kind: 'node', nodeId: -1 }
      pendingMargins = margins
      return handle
    },
    relativeToViewport(margins?: Margins) {
      pendingRel = { kind: 'viewport' }
      pendingMargins = margins
      return handle
    },
    observe(targetSelector: string, cb: (result: IntersectionResult) => void) {
      if (disconnected || !injectedDeps) return handle
      const deps = injectedDeps
      const hits = observeAll
        ? deps.resolveAll(targetSelector)
        : (() => { const one = deps.resolve(targetSelector); return one ? [one] : [] })()
      for (const hit of hits) {
        const e: Entry = {
          targetNodeId: hit.nodeId,
          ...(targetSelector.startsWith('#') ? { targetId: targetSelector.slice(1) } : {}),
          cb,
          thresholds,
          lastBucket: -1,
          rel: pendingRel,
          ...(pendingMargins ? { margins: pendingMargins } : {}),
        }
        entries.push(e)
        own.push(e)
      }
      // ★初始评估（Web 的初始回调语义）——同步算一次，避免"注册了却没回调"的空窗
      if (hits.length) evaluateIntersections()
      return handle
    },
    disconnect() {
      disconnected = true
      for (const e of own) {
        const at = entries.indexOf(e)
        if (at >= 0) entries.splice(at, 1)
      }
      own.length = 0
    },
  }
  return handle
}
/** 构造一个 `*.unsupported` 错误（供能力层分档复用）。 */
export function intersectionError(code: string, message: string): ProteusCapError {
  const e = new ProteusCapError(code, message) as ProteusCapError & { code?: string }
  if (typeof (e as { code?: unknown }).code !== 'string') {
    Object.defineProperty(e, 'code', { value: code, enumerable: true, configurable: true })
  }
  return e
}
