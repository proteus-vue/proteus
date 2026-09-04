// packages/desktop/src/cursor-glow.ts
// ★G-24 B5（proteus-semantic-primitives-plan 续批）：指针跟随光晕——桌面交互语义「环境光随指针」
//   语义：光晕层（主紫 + 副青双光斑）以 lerp 插值跟随指针——AI 科技感的指针环境反馈；
//   降级链：prefers-reduced-motion → 不启用；触屏（pointer:coarse）→ 不启用；MP 逻辑层无 DOM → 不启用
//   分层：纯逻辑（本模块，可单测）+ thin 指令（directives.ts v-p-cursor-glow）

export interface CursorGlowOptions {
  /** 光晕主径（px） */
  size?: number
  /** 主色（建议 rgba 含透明度） */
  color?: string
  /** 副色光斑 */
  accent?: string
  /** 跟随插值系数（0-1；小 = 拖尾感强，1 = 立即贴合） */
  lerp?: number
  /** 不透明度 */
  opacity?: number
}

export interface CursorGlowHandle {
  destroy(): void
}

/** 默认值（Proteus design-tokens：brand 紫 / brand2 青） */
export const CURSOR_GLOW_DEFAULTS = {
  size: 460,
  color: 'rgba(124, 92, 255, 0.14)',
  accent: 'rgba(0, 224, 198, 0.10)',
  lerp: 0.12,
  opacity: 1,
} as const

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 是否精确指针环境（mouse/pen——触屏不启用；无 matchMedia 环境 = 非 Web，禁用） */
export function hasFinePointer(): boolean {
  if (typeof matchMedia !== 'function') return false
  return matchMedia('(pointer: fine)').matches
}

/**
 * 创建指针跟随光晕层（fixed 全屏，pointer-events:none；z-index 0——内容层之上、背景之上无遮挡）
 * 返回 null = 环境不支持（reduced-motion / 触屏 / 无 DOM）——调用方静默不启用
 */
export function createCursorGlow(host: HTMLElement, options: CursorGlowOptions = {}): CursorGlowHandle | null {
  if (typeof document === 'undefined' || !document.documentElement) return null
  if (prefersReducedMotion()) return null
  if (!hasFinePointer()) return null

  const o = { ...CURSOR_GLOW_DEFAULTS, ...options }
  const size = o.size
  const half = size / 2
  const accSize = Math.round(size * 0.6)
  const accHalf = accSize / 2

  const el = document.createElement('div')
  el.className = 'p-cursor-glow'
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0;transition:opacity 0.5s ease;will-change:transform;'
  // 主光斑（紫）+ 副光斑（青，错位）——双 radial-gradient
  el.innerHTML =
    `<div style="position:absolute;width:${size}px;height:${size}px;left:${-half}px;top:${-half}px;border-radius:50%;` +
    `background:radial-gradient(circle, ${o.color}, transparent 62%);"></div>` +
    `<div style="position:absolute;width:${accSize}px;height:${accSize}px;left:${-accHalf + Math.round(size * 0.16)}px;top:${-accHalf + Math.round(size * 0.12)}px;border-radius:50%;` +
    `background:radial-gradient(circle, ${o.accent}, transparent 68%);"></div>`
  document.body.appendChild(el)

  // 指针状态（目标位置）+ 当前位置（lerp 插值）
  let tx = window.innerWidth / 2
  let ty = window.innerHeight / 2
  let cx = tx
  let cy = ty
  let shown = false
  let raf = 0
  let running = false

  function onMove(e: PointerEvent): void {
    tx = e.clientX
    ty = e.clientY
    if (!shown) {
      shown = true
      cx = tx
      cy = ty
      el.style.opacity = String(o.opacity)
    }
    ensureLoop()
  }
  function onLeave(): void {
    el.style.opacity = '0'
  }
  function onEnter(): void {
    if (shown) el.style.opacity = String(o.opacity)
  }

  function frame(): void {
    cx += (tx - cx) * o.lerp
    cy += (ty - cy) * o.lerp
    el.style.transform = `translate3d(${Math.round(cx)}px, ${Math.round(cy)}px, 0)`
    if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) raf = requestAnimationFrame(frame)
    else raf = 0
  }
  function ensureLoop(): void {
    if (!raf) raf = requestAnimationFrame(frame)
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  document.documentElement.addEventListener('pointerenter', onEnter)

  return {
    destroy(): void {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      document.documentElement.removeEventListener('pointerenter', onEnter)
      el.remove()
    },
  }
}
