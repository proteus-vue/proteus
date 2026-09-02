// packages/gesture/src/recognizers.ts
// ★G-32 B4 ④ Gesture（proteus-semantic-primitives-plus-plan §6）：手势识别器（纯逻辑零依赖——可单测）
//   手势 = 声明式约束（G-32 原则）：平台事件（Web Pointer / MP touch）归一为 GestureInput 喂入，
//   识别器输出语义手势事件（tap/longpress/pan/swipe/pinch/rotate/press）——「事件是 Backend 实现细节」
//   Backend 映射：Web 用 Pointer Events；iOS UIGestureRecognizer / Android GestureDetector / 鸿蒙手势系统后续批次
export interface GesturePoint {
  x: number
  y: number
  /** 时间戳 ms（now() 注入可单测） */
  t: number
  /** 触点 id（多点区分） */
  id: number
  /** 按压力度（press 手势——3D Touch） */
  force?: number
}

export type GestureInputKind = 'down' | 'move' | 'up' | 'cancel'

export interface GestureInput {
  kind: GestureInputKind
  point: GesturePoint
}

/** 语义手势事件（输出——开发者消费的声明式约束结果） */
export type GestureEvent =
  | { type: 'tap'; x: number; y: number; count: number }
  | { type: 'longpress'; x: number; y: number }
  | { type: 'pan-start'; x: number; y: number }
  | { type: 'pan-move'; dx: number; dy: number; x: number; y: number }
  | { type: 'pan-end'; dx: number; dy: number; x: number; y: number }
  | { type: 'swipe'; direction: 'up' | 'down' | 'left' | 'right'; velocity: number }
  | { type: 'pinch-start'; scale: number; center: { x: number; y: number } }
  | { type: 'pinch-change'; scale: number; center: { x: number; y: number } }
  | { type: 'pinch-end'; scale: number }
  | { type: 'rotate-start'; angle: number; center: { x: number; y: number } }
  | { type: 'rotate-change'; angle: number }
  | { type: 'rotate-end'; angle: number }
  | { type: 'press'; force: number }

export type GestureKind = 'tap' | 'longpress' | 'pan' | 'swipe' | 'pinch' | 'rotate' | 'press'

export type GestureEventHandler = (e: GestureEvent) => void

export interface GestureRecognizerConfig {
  /** 移动判定阈值 px（超过则不算 tap） */
  threshold?: number
  /** 长按判定时长 ms */
  longpressDuration?: number
  /** 双击窗口 ms（count=2） */
  dblTapWindow?: number
  /** swipe 速度阈值 px/ms */
  swipeVelocity?: number
  /** pan 轴锁定：x 水平 / y 垂直 / free（默认 free） */
  panAxis?: 'x' | 'y' | 'free'
  /** 时间源（可注入测试） */
  now?: () => number
  /** 定时器注入（长按实时触发；缺省=释放时判定） */
  schedule?: (cb: () => void, ms: number) => number
  /** 取消定时器注入 */
  cancelSchedule?: (id: number) => void
}

const DEFAULTS: Required<Pick<GestureRecognizerConfig, 'threshold' | 'longpressDuration' | 'dblTapWindow' | 'swipeVelocity' | 'panAxis'>> = {
  threshold: 10,
  longpressDuration: 500,
  dblTapWindow: 300,
  swipeVelocity: 0.3,
  panAxis: 'free',
}

interface ActivePointer {
  id: number
  startX: number
  startY: number
  startT: number
  lastX: number
  lastY: number
  lastT: number
  totalDx: number
  totalDy: number
  moved: boolean
}

/**
 * 手势识别器（状态机）：feed(input) → 手势事件回调
 * - 单点：tap（连击 count）/ longpress / pan / swipe / press
 * - 双点：pinch（缩放）/ rotate（旋转）
 * ★纯逻辑：不依赖 DOM/事件——Web Pointer / MP touch / 测试合成输入统一走 GestureInput
 */
export function createGestureRecognizer(
  handlers: Partial<Record<GestureKind, GestureEventHandler>>,
  config: GestureRecognizerConfig = {},
): { feed(input: GestureInput): void; reset(): void } {
  const cfg = { ...DEFAULTS, ...config }
  const now = cfg.now ?? (() => Date.now())
  const pointers = new Map<number, ActivePointer>()
  let lastTap: { t: number; x: number; y: number } | null = null
  let longpressTimer: number | null = null
  // 双点状态
  let pinchStart: { dist: number; angle: number } | null = null
  let panState: { startX: number; startY: number } | null = null

  function emit(kind: GestureKind, e: GestureEvent): void {
    handlers[kind]?.(e)
  }

  function clearLongpressTimer(): void {
    if (longpressTimer !== null) {
      cfg.cancelSchedule?.(longpressTimer)
      longpressTimer = null
    }
  }

  function scheduleLongpress(p: ActivePointer): void {
    clearLongpressTimer()
    if (!cfg.schedule) return
    longpressTimer = cfg.schedule(() => {
      // 未移动超阈值 → 判定长按
      if (!p.moved) emit('longpress', { type: 'longpress', x: p.startX, y: p.startY })
    }, cfg.longpressDuration)
  }

  function distance(a: ActivePointer, b: ActivePointer): number {
    return Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY)
  }

  function angle(a: ActivePointer, b: ActivePointer): number {
    return (Math.atan2(b.lastY - a.lastY, b.lastX - a.lastX) * 180) / Math.PI
  }

  function center(a: ActivePointer, b: ActivePointer): { x: number; y: number } {
    return { x: (a.lastX + b.lastX) / 2, y: (a.lastY + b.lastY) / 2 }
  }

  function feed(input: GestureInput): void {
    const { kind, point } = input
    const t = point.t ?? now()

    if (kind === 'down') {
      if (pointers.size === 0) {
        // 首触点：单点手势起点
        const p: ActivePointer = { id: point.id, startX: point.x, startY: point.y, startT: t, lastX: point.x, lastY: point.y, lastT: t, totalDx: 0, totalDy: 0, moved: false }
        pointers.set(point.id, p)
        scheduleLongpress(p)
        panState = { startX: point.x, startY: point.y }
        emit('pan', { type: 'pan-start', x: point.x, y: point.y })
      } else {
        // 第二触点：进入 pinch/rotate 模式，清 single 手势状态
        const p: ActivePointer = { id: point.id, startX: point.x, startY: point.y, startT: t, lastX: point.x, lastY: point.y, lastT: t, totalDx: 0, totalDy: 0, moved: false }
        pointers.set(point.id, p)
        clearLongpressTimer()
        const ids = [...pointers.keys()]
        const a = pointers.get(ids[0]) as ActivePointer
        const b = pointers.get(ids[1]) as ActivePointer
        const dist = distance(a, b)
        pinchStart = { dist, angle: angle(a, b) }
        emit('pinch', { type: 'pinch-start', scale: 1, center: center(a, b) })
        emit('rotate', { type: 'rotate-start', angle: (pinchStart as { angle: number }).angle, center: center(a, b) })
      }
      return
    }

    if (kind === 'move') {
      const p = pointers.get(point.id)
      if (!p) return
      const dx = point.x - p.lastX
      const dy = point.y - p.lastY
      p.lastX = point.x
      p.lastY = point.y
      p.lastT = t
      p.totalDx += dx
      p.totalDy += dy
      if (Math.hypot(point.x - p.startX, point.y - p.startY) > cfg.threshold) {
        p.moved = true
        clearLongpressTimer()
        // 双点：pinch/rotate
        if (pointers.size === 2) {
          const ids = [...pointers.keys()]
          const a = pointers.get(ids[0]) as ActivePointer
          const b = pointers.get(ids[1]) as ActivePointer
          if (pinchStart) {
            const dist = distance(a, b)
            const scale = dist / pinchStart.dist
            const ang = angle(a, b)
            emit('pinch', { type: 'pinch-change', scale, center: center(a, b) })
            emit('rotate', { type: 'rotate-change', angle: ang - (pinchStart as { angle: number }).angle })
          }
        } else if (panState) {
          // 单点 pan（轴锁定）
          let outDx = p.totalDx
          let outDy = p.totalDy
          if (cfg.panAxis === 'x') outDy = 0
          if (cfg.panAxis === 'y') outDx = 0
          emit('pan', { type: 'pan-move', dx: outDx, dy: outDy, x: point.x, y: point.y })
        }
      }
      return
    }

    // up / cancel
    const p = pointers.get(point.id)
    if (!p) return
    // 双点模式收尾：任一手指抬起 → pinch/rotate end（先于 size 变更判定）
    if (pinchStart) {
      emit('pinch', { type: 'pinch-end', scale: 1 })
      emit('rotate', { type: 'rotate-end', angle: 0 })
      pinchStart = null
    }
    if (pointers.size === 1) {
      if (p.moved && panState) {
        emit('pan', { type: 'pan-end', dx: p.totalDx, dy: p.totalDy, x: point.x, y: point.y })
        // swipe：快速滑出判定
        const dt = (t - p.startT) || 1
        const vx = Math.abs(p.totalDx) / dt
        const vy = Math.abs(p.totalDy) / dt
        if (Math.max(vx, vy) > cfg.swipeVelocity && p.moved) {
          const horizontal = vx > vy
          const direction = horizontal ? (p.totalDx > 0 ? 'right' : 'left') : p.totalDy > 0 ? 'down' : 'up'
          emit('swipe', { type: 'swipe', direction, velocity: Math.max(vx, vy) })
        }
      } else if (kind === 'up') {
        // tap 判定（未移动超阈值）
        const held = t - p.startT
        if (held >= cfg.longpressDuration && !p.moved) {
          emit('longpress', { type: 'longpress', x: p.startX, y: p.startY })
        } else if (!p.moved) {
          // 连击计数
          let count = 1
          if (lastTap && t - lastTap.t <= cfg.dblTapWindow && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) <= cfg.threshold * 2) {
            count = 2
            lastTap = null
          } else {
            lastTap = { t, x: point.x, y: point.y }
          }
          emit('tap', { type: 'tap', x: point.x, y: point.y, count })
          if (point.force !== undefined) emit('press', { type: 'press', force: point.force })
        }
      }
    }
    clearLongpressTimer()
    pointers.delete(point.id)
    if (pointers.size === 0) panState = null
  }

  return {
    feed,
    reset() {
      pointers.clear()
      panState = null
      pinchStart = null
      lastTap = null
      clearLongpressTimer()
    },
  }
}