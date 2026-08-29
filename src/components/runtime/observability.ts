// src/components/runtime/observability.ts —— 组件渲染埋点（组件库 B8）
// dev 可开（setObservabilityEnabled(true)），默认 no-op（零开销）；对齐 07-m8-observability.md §1
// ★devtools B2：可选 TraceBus 注入（type-only，运行时零依赖）——component.render 汇入统一事件流
// 与 API trace / Router navTrace 共用 traceId 的完整 Observability Layer 为 v1.0 规划
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构
import type { TraceBus } from '@proteus/devtools-runtime'

export interface ComponentRenderMetric {
  durationMs: number
  itemCount?: number
  strategy?: string
}

let enabled = false
let traceBus: TraceBus | null = null

/** 开启/关闭渲染埋点（开发环境手动开启；采样率可配为后续规划） */
export function setObservabilityEnabled(v: boolean): void {
  enabled = v
}

/** ★devtools B2：注入 TraceBus（component.render 汇入统一事件流；bus 自身 enabled 门控） */
export function setTraceBus(bus: TraceBus | null): void {
  traceBus = bus
}

/** 组件渲染埋点：默认 no-op；开启后输出 [proteus][render] 日志 + 汇入 traceBus（若有） */
export function componentRender(tag: string, metric: ComponentRenderMetric): void {
  if (traceBus) {
    traceBus.emit('component', 'point', 'component.render', {
      tag,
      durationMs: metric.durationMs,
      itemCount: metric.itemCount,
      strategy: metric.strategy,
    })
  }
  if (!enabled) return
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    let msg = '[proteus][render] ' + tag + ' ' + metric.durationMs.toFixed(1) + 'ms'
    if (metric.itemCount !== undefined) msg += ' item=' + metric.itemCount
    if (metric.strategy) msg += ' strategy=' + metric.strategy
    console.log(msg)
  }
}
