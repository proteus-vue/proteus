// website/src/motion/use-motion.ts —— ★★站点动效的**声明式入口**（页面只写声明，不写循环）
//
// 【用法（页面里的形态——与引擎的声明面同构）】
//   ```ts
//   import { useMotion, useScrollMotion, usePointerMotion, MOTION } from '../motion/use-motion'
//
//   // 入场：引擎编译 + 引擎求值 + 单帧源推进
//   const el = ref<HTMLElement>()
//   useMotion(el, [
//     { kind: 'translateY', from: 40, to: 0, durationMs: 700, curve: 'easeOut' },
//     { kind: 'opacity', from: 0, to: 1, durationMs: 700, curve: 'easeOut' },
//   ])
//
//   // 滚动驱动：进度来自元素在视口中的位置（对标真机的 `scroll` 驱动）
//   useScrollMotion(el, [{ kind: 'rotate', from: -8, to: 0, durationMs: 1, drive: 'progress', scroll: { from: 0, to: 1 } }])
//
//   // 指针驱动：进度来自指针在元素内的位置（对标真机的手势 seek）
//   usePointerMotion(el, [{ kind: 'translateX', from: -12, to: 12, durationMs: 1, drive: 'progress' }])
//   ```
//
// 【为什么做成"指令/组合式"而不是逐处手搓】与引擎的哲学一致：**声明是输入，机制是共用的**。
//   页面里有几十处动效，若每处各写一份 rAF + 曲线，就等于把引擎又实现了一遍（本仓纪律：一处实现）。
import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { compileChoreography } from '@proteus-vue/animation'
import type { AnimDecl, StaggerOrder, CurveId } from '@proteus-vue/animation'
import { animValue } from '@proteus-vue/slot-runtime'
import { asElement, compile, countUp, createRunner, settle, motionAllowed, durationOf, type Runner } from './engine-motion'

/** 常用运动的声明短语（页面里的"预设"——与引擎预设库同一精神：常见演出都是一句话） */
export const MOTION = {
  /** 上浮渐显（分节入场的主力形态） */
  riseIn: (dy = 36, ms = 760): AnimDecl[] => [
    { kind: 'translateY', from: dy, to: 0, durationMs: ms, curve: 'easeOut' },
    { kind: 'opacity', from: 0, to: 1, durationMs: ms, curve: 'easeOut' },
  ],
  /** 从右浮入（卡片/表格行） */
  slideInX: (dx = 44, ms = 720): AnimDecl[] => [
    { kind: 'translateX', from: dx, to: 0, durationMs: ms, curve: 'easeOut' },
    { kind: 'opacity', from: 0, to: 1, durationMs: ms, curve: 'easeOut' },
  ],
  /** 回弹强调（数字卡/徽标的"到位"） */
  popIn: (ms = 620): AnimDecl[] => [
    { kind: 'scale', from: 0.86, to: 1, durationMs: ms, curve: 'springApprox' },
    { kind: 'opacity', from: 0, to: 1, durationMs: ms * 0.6, curve: 'easeOut' },
  ],
  /** 自旋到位（图标） */
  spinIn: (deg = -140, ms = 820): AnimDecl[] => [
    { kind: 'rotate', from: deg, to: 0, durationMs: ms, curve: 'springApprox' },
    { kind: 'scale', from: 0.7, to: 1, durationMs: ms, curve: 'easeOut' },
  ],
} as const

interface UseOptions {
  /** 延迟启动（ms） */
  delayMs?: number
  /** 视口内即播（默认 true；false = 立即播） */
  whenVisible?: boolean
  /** 只播一次（默认 true） */
  once?: boolean
  /** 进入视口阈值 */
  threshold?: number
}

/**
 * ★入场/强调动效：元素进入视口 → **引擎编译的声明**开演一次。
 * reduced-motion ⇒ 直接终态；离开视口 ⇒ runner 停（不烧帧）。
 */
export function useMotion(target: Ref<HTMLElement | undefined | null>, decls: readonly AnimDecl[], opts: UseOptions = {}): void {
  const { delayMs = 0, whenVisible = true, once = true, threshold = 0.12 } = opts
  let runner: Runner | null = null
  let io: IntersectionObserver | null = null
  let pending: number | undefined

  const start = (): void => {
    const el = asElement(target.value)
    if (!el) return
    const anims = compile(decls, 1)
    const slots = new Map<number, HTMLElement>([[1, el as HTMLElement]])
    if (!motionAllowed()) {
      settle(anims, slots)
      return
    }
    pending = delayMs > 0 ? (setTimeout(() => {
      pending = undefined
      runner = createRunner(anims, slots)
      runner.play()
    }, delayMs) as unknown as number) : undefined
    if (!pending) {
      runner = createRunner(anims, slots)
      runner.play()
    }
  }

  onMounted(() => {
    const el = asElement(target.value)
    if (!el) return
    if (!whenVisible || typeof IntersectionObserver !== 'function') {
      start()
      return
    }
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            start()
            if (once) io?.disconnect()
          } else if (!once) {
            runner?.stop()
          }
        }
      },
      { threshold, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
  })
  onUnmounted(() => {
    io?.disconnect()
    if (pending !== undefined) clearTimeout(pending)
    runner?.stop()
  })
}

/**
 * ★滚动驱动：**进度来自元素在视口中的位置**（顶部进入 → 1 背后，底部进入 → 0），
 * 与真机的 `seek_scroll` 同构——宿主给位置、引擎给值，全程无需业务数学。
 */
export function useScrollMotion(
  target: Ref<HTMLElement | undefined | null>,
  decls: readonly AnimDecl[],
  opts?: { loop?: boolean },
): void {
  let runner: Runner | null = null
  let seen = false

  onMounted(() => {
    const el = asElement(target.value) as HTMLElement | null
    if (!el || !motionAllowed()) return
    const anims = compile(decls, 1)
    const slots = new Map<number, HTMLElement>([[1, el]])
    const total = durationOf(anims, 1)
    const progress = (): number => {
      const r = el.getBoundingClientRect()
      const vh = globalThis.innerHeight || 800
      // 0 = 元素刚要从底部进入；1 = 元素顶部越过视口顶部
      const p = (vh - r.top) / (vh + r.height)
      return Math.max(0, Math.min(1, p))
    }
    if (!seen) {
      runner = createRunner(anims, slots, { durationMs: total, seekSource: progress, loop: opts?.loop ?? true })
      runner.seek(progress())
      runner.play()
      seen = true
    }
  })
  onUnmounted(() => runner?.stop())
}

/**
 * ★指针驱动：**进度来自指针在元素内的横向位置**（0 = 左缘，1 = 右缘）——
 * 对标真机的"手势 seek"（手指到哪、画面到哪）。指针离开 ⇒ 平滑回到中位（一条声明）。
 */
export function usePointerMotion(
  target: Ref<HTMLElement | undefined | null>,
  decls: readonly AnimDecl[],
  opts?: { fallback?: number },
): void {
  const fallback = opts?.fallback ?? 0.5
  let runner: Runner | null = null
  let targetP = fallback
  let curP = fallback
  let raf = 0
  let el: HTMLElement | null = null
  let cleanup: (() => void) | null = null

  const write = (): void => {
    if (!runner || !el) return
    const r = el.getBoundingClientRect()
    if (!r.width) return
    runner.seek(targetP)
    // 指针离开后回中位（缓动收敛——不引入第二套曲线：用引擎值 + 线性插值收敛）
    if (Math.abs(curP - targetP) > 1e-4) {
      curP += (targetP - curP) * 0.12
      raf = requestAnimationFrame(write)
    } else {
      raf = 0
    }
  }

  onMounted(() => {
    el = asElement(target.value) as HTMLElement | null
    if (!el || !motionAllowed()) return
    const anims = compile(decls, 1)
    const slots = new Map<number, HTMLElement>([[1, el]])
    runner = createRunner(anims, slots, { durationMs: 1 })
    const host = el
    const onMove = (ev: PointerEvent): void => {
      const r = host.getBoundingClientRect()
      targetP = r.width > 0 ? Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) : fallback
      if (!raf) raf = requestAnimationFrame(write)
    }
    const onLeave = (): void => {
      targetP = fallback
      if (!raf) raf = requestAnimationFrame(write)
    }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    cleanup = (): void => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
    }
  })
  onUnmounted(() => {
    cleanup?.()
    cleanup = null
    if (raf) cancelAnimationFrame(raf)
    runner?.stop()
  })
}

/** 元素 + 一组声明 ⇒ 手动控制（用于"按钮触发一次演示"这类形态） */
export function motionController(target: Ref<HTMLElement | undefined | null>, decls: readonly AnimDecl[]): { play: () => void; stop: () => void } {
  let runner: Runner | null = null
  const make = (): Runner | null => {
    const el = target.value
    if (!el) return null
    return createRunner(compile(decls, 1), new Map<number, HTMLElement>([[1, el]]))
  }
  watch(target, () => {
    runner = null
  })
  return {
    play: (): void => {
      runner = runner ?? make()
      runner?.seek(0)
      runner?.play()
    },
    stop: (): void => runner?.stop(),
  }
}

/* ═══════════════════════ 编排（引擎编排编译器 → 一组 DOM 元素） ═══════════════════════ */

export interface ChoreoOptions {
  /** 相位序（引擎的 `StaggerOrder`——index / diagonal / serpentine / radialOut…） */
  order?: StaggerOrder
  /** 相邻名次错峰（ms） */
  staggerMs?: number
  /** 列数（diagonal / serpentine 的网格几何） */
  cols?: number
  /** 视口内才播（默认 true；离开视口暂停——不烧帧） */
  whenVisible?: boolean
  /** 循环播放（环境动效；单轮时长内取模） */
  loop?: boolean
  /** 每帧回调（探针用） */
  onFrame?: (tMs: number) => void
}

/**
 * ★★**编排**：一组元素 + 一个 `make(i, n) → 声明` 的函数 ⇒ **引擎编排编译器**（`compileChoreography`）
 * 产出整批指令，一个 runner 落到全部元素。
 *
 * 这就是真机炫技场用的同一条链路（`presets.choreograph.wave/ripple/spiral` 内部也是它）：
 * 相位排名、错峰、校验、线格式全在引擎包里，页面只给"每片做什么"。
 */
export function useChoreography(
  container: Ref<HTMLElement | undefined | null>,
  selector: string,
  make: (ctx: { i: number; n: number; row: number; col: number; nth: number }) => readonly AnimDecl[],
  opts: ChoreoOptions = {},
): { replay: () => void; stop: () => void } {
  const { order = 'index', staggerMs = 0, cols = 0, whenVisible = true, loop = false, onFrame } = opts
  let runner: Runner | null = null
  let io: IntersectionObserver | null = null
  let els: HTMLElement[] = []
  let anims: ReturnType<typeof compileChoreography> = []

  const build = (): void => {
    const root = asElement(container.value) as HTMLElement | null
    if (!root) return
    els = Array.from(root.querySelectorAll<HTMLElement>(selector))
    if (!els.length) return
    const ids = els.map((_, i) => i + 1)
    const width = root.clientWidth || 800
    const height = root.clientHeight || 400
    const c = Math.max(1, cols || Math.min(els.length, Math.max(1, Math.round(Math.sqrt(els.length)))) )
    anims = compileChoreography({
      ids,
      canvas: { cols: c, view: { width, height } },
      order,
      staggerMs,
      make: (ctx) => [...make(ctx)],
    })
  }

  const run = (): void => {
    if (!anims.length) build()
    const slots = new Map<number, HTMLElement>()
    els.forEach((el, i) => slots.set(i + 1, el))
    if (!motionAllowed()) {
      settle(anims, slots)
      return
    }
    runner = createRunner(anims, slots, {
      loop,
      durationMs: durationOf(anims, 900),
      onFrame: onFrame ? (t) => onFrame(t) : undefined,
    })
    runner.play()
  }

  onMounted(() => {
    const root = asElement(container.value)
    if (!root) return
    if (!whenVisible || typeof IntersectionObserver !== 'function') {
      run()
      return
    }
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) run()
          else runner?.stop()
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -5% 0px' },
    )
    io.observe(root)
  })
  onUnmounted(() => {
    io?.disconnect()
    runner?.stop()
  })

  return {
    replay: (): void => {
      runner?.stop()
      run()
    },
    stop: (): void => runner?.stop(),
  }
}

/**
 * ★**数字生长**（组合式版）：面向 setup 期的 `Ref<HTMLElement>`——内部是 `countUp` 纯函数
 * （挂载后拿到节点的形态直接用 `countUp`，见 engine-motion.ts）。
 */
export function useCountUp(
  target: Ref<HTMLElement | undefined | null>,
  to: number,
  opts: { durationMs?: number; decimals?: number; prefix?: string; suffix?: string; curve?: CurveId; whenVisible?: boolean } = {},
): void {
  const { whenVisible = true, ...rest } = opts
  const start = (): void => {
    const el = asElement(target.value) as HTMLElement | null
    if (el) countUp(el, to, rest)
  }
  let io: IntersectionObserver | null = null
  onMounted(() => {
    const el = asElement(target.value)
    if (!el) return
    if (!whenVisible || typeof IntersectionObserver !== 'function') {
      start()
      return
    }
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            start()
            io?.disconnect()
          }
        }
      },
      { threshold: 0.3 },
    )
    io.observe(el)
  })
  onUnmounted(() => io?.disconnect())
}
