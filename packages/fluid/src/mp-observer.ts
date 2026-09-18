// packages/fluid/src/mp-observer.ts
// ★Skyline 线收口（2026-09-11）：小程序侧尺寸观测原语——补上「MP 无 ResizeObserver」的缺口。
//   背景：createContainerQuery 的默认观察器依赖 ResizeObserver；小程序逻辑层无 RO → 容器查询恒初始态
//   （p-split 恒堆叠 / p-zone 恒 sm）——此前的「静默钉死」。
//   方案：注入式 MP 测量源（组件层用 wx.createSelectorQuery / adapter.measureRect 实现 measure），
//   本原语负责「何时测」：observe 时立即 + 延迟重测（Skyline onReady 首帧尺寸不稳）+ 窗口 resize 重测。
import type { ResizeObserverLike, SizeObserverFactory } from './context'

/** MP 测量源（组件层注入——平台 API 不进本包） */
export interface MpMeasureSource {
  /** 异步测量根节点尺寸（wx.createSelectorQuery().boundingClientRect；失败 resolve null） */
  measure(): Promise<{ width: number; height: number } | null>
  /** 订阅窗口尺寸变化（wx.onWindowResize）；返回取消函数。缺省不订阅 */
  onResize?(cb: () => void): () => void
  /** 额外重测延迟（ms）——Skyline onReady 首帧尺寸不稳，默认 [0, 50, 120] */
  delays?: number[]
}

const DEFAULT_DELAYS = [0, 50, 120]

/**
 * 创建 MP 尺寸观察器工厂（兼容 createContainerQuery 的 createObserver 注入）。
 * 用法（组件层）：
 *   const factory = createMpSizeObserverFactory({ measure: () => adapter.measureRect('.x', scope).then(r => r && { width: r.width, height: r.height }) })
 *   createContainerQuery(null, { createObserver: factory })
 */
export function createMpSizeObserverFactory(source: MpMeasureSource): SizeObserverFactory {
  const delays = source.delays && source.delays.length ? source.delays : DEFAULT_DELAYS
  const timers = typeof setTimeout === 'function' ? setTimeout : null
  const clearTimers = typeof clearTimeout === 'function' ? clearTimeout : null

  return (onSize: (width: number, height: number) => void): ResizeObserverLike => {
    let disposed = false
    const pending: ReturnType<typeof setTimeout>[] = []
    let unsubResize: (() => void) | null = null

    const runMeasure = (): void => {
      if (disposed) return
      source
        .measure()
        .then((r) => {
          if (disposed || !r) return
          if (typeof r.width === 'number' && typeof r.height === 'number') onSize(r.width, r.height)
        })
        .catch(() => {
          /* 测量失败静默（组件保持当前档位）——诚实边界：无测量即无响应式 */
        })
    }

    return {
      observe() {
        if (disposed) return
        // 立即 + 延迟重测（首帧尺寸不稳）
        if (timers) {
          for (const d of delays) {
            if (d <= 0) runMeasure()
            else pending.push(timers(runMeasure, d))
          }
        } else {
          runMeasure()
        }
        // 窗口 resize（旋转/折叠）→ 重测
        if (source.onResize) {
          try {
            unsubResize = source.onResize(runMeasure)
          } catch {
            unsubResize = null
          }
        }
      },
      disconnect() {
        if (disposed) return
        disposed = true
        for (const t of pending) if (clearTimers) clearTimers(t)
        pending.length = 0
        if (unsubResize) {
          try {
            unsubResize()
          } catch {
            /* ignore */
          }
          unsubResize = null
        }
      },
    }
  }
}
