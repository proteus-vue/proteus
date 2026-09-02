// packages/gesture/src/use-gesture.ts
// ★G-32 B4 ④ Gesture：useGesture() Hook（G10）+ v-gesture 指令（G1-G7 Web 端）
//   平台接线层：Web Pointer Events → GestureInput → 识别器 → 语义手势事件
//   「事件是 Backend 实现细节」：开发者写 v-gesture:tap="onTap"（声明式约束），不碰 touchstart/bindtap
//   ★MP/原生：识别器映射由各端 Backend 承接（iOS UIGestureRecognizer 等）——本文件是 Web 官方接线
import { createGestureRecognizer } from './recognizers'
import type { GestureEvent, GestureEventHandler, GestureInput, GestureKind, GestureRecognizerConfig } from './recognizers'

export type GestureHandlers = Partial<Record<GestureKind, GestureEventHandler>>

export interface UseGestureOptions {
  config?: GestureRecognizerConfig
  /** 注入目标元素（缺省 bind 时绑定） */
  domEvents?: boolean
}

/** 把 Web Pointer 事件归一为 GestureInput（pointerId/offsetX/clientX） */
function normalizePointer(e: PointerEvent, t: number): GestureInput {
  return {
    kind: e.type === 'pointerdown' ? 'down' : e.type === 'pointerup' ? 'up' : e.type === 'pointercancel' ? 'cancel' : 'move',
    point: {
      x: e.clientX,
      y: e.clientY,
      t,
      id: e.pointerId,
      force: e.pressure !== undefined && e.pressure > 0 ? e.pressure : undefined,
    },
  }
}

/**
 * ★G10 useGesture()：组合手势 Hook——绑定元素 → 识别器 → 语义手势事件回调
 * 用法：
 *   const { bind } = useGesture({ tap: (e) => ..., pan: (e) => ... })
 *   <div ref="el"> —— onMounted(bind(el)) / 或 ref 直接 bind
 */
export function useGesture(handlers: GestureHandlers, options: UseGestureOptions = {}): { bind: (el: HTMLElement | null) => void; unbind: () => void } {
  const recognizer = createGestureRecognizer(handlers, options.config)
  let el: HTMLElement | null = null
  let timer = 0

  function onPointer(e: PointerEvent): void {
    const t = Date.now()
    recognizer.feed(normalizePointer(e, t))
  }

  function bind(target: HTMLElement | null): void {
    if (!target || target === el) return
    unbind()
    el = target
    if (options.domEvents !== false) {
      el.addEventListener('pointerdown', onPointer)
      el.addEventListener('pointermove', onPointer)
      el.addEventListener('pointerup', onPointer)
      el.addEventListener('pointercancel', onPointer)
    }
  }

  function unbind(): void {
    if (!el) return
    el.removeEventListener('pointerdown', onPointer)
    el.removeEventListener('pointermove', onPointer)
    el.removeEventListener('pointerup', onPointer)
    el.removeEventListener('pointercancel', onPointer)
    recognizer.reset()
    clearTimeout(timer)
    el = null
  }

  return { bind, unbind }
}

/** ★G1-G7 v-gesture 指令工厂：v-gesture:tap="onTap" / v-gesture:pan="onPan"（值=回调或 { handler, config }） */
export interface VGestureBindingValue {
  handler?: GestureEventHandler
  config?: GestureRecognizerConfig
}

/** 指令工厂（createApp 前用 app.directive('gesture', createGestureDirective())） */
export function createGestureDirective() {
  const bindings = new WeakMap<HTMLElement, ReturnType<typeof useGesture>>()

  return {
    mounted(el: HTMLElement, binding: { arg?: string; value: GestureEventHandler | VGestureBindingValue }) {
      const kind = (binding.arg ?? 'tap') as GestureKind
      const v = binding.value
      const handler = typeof v === 'function' ? (v as GestureEventHandler) : (v as VGestureBindingValue).handler
      const config = typeof v === 'object' && v !== null ? (v as VGestureBindingValue).config : undefined
      if (!handler) return
      const gesture = useGesture({ [kind]: handler }, { config })
      gesture.bind(el)
      bindings.set(el, gesture)
    },
    unmounted(el: HTMLElement) {
      bindings.get(el)?.unbind()
      bindings.delete(el)
    },
  }
}