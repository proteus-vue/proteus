// packages/render-backend/src/runtime-profiler.ts —— ★★★运行期阶段耗时自采样（CPU Profiler · 决策 #715）
//
// 【它补什么（本仓 2026-10-09 的缺口）】DevTools 面板此前的性能维度只有**帧率/掉帧**（#710）
//   与**掉帧窗口的事件链**（#714）——但"**这次卡/掉帧是运行期哪一段花的**"没有数据：
//   页面 handler（`evalExpr`）、模板重实例化、指令下发（flush/applyOps）**都没有计时**。
//   ⇒ 本模块在这些边界上插桩，把耗时归因到**具体阶段 + 具体 handler**（并带模板源位置）。
//
// 【为什么是"插桩计时"而不是"原生采样 Profiler"（诚实边界）】
//   iOS JSC / QuickJS / Harmony JSVM **都没有可用的统计采样剖析 API**（跨端不可行，也映射不回源码）。
//   而本框架的运行期边界**清晰且低噪声**（handler / 实例化 / flush 三个入口）⇒ **插桩计时**在此处
//   更准确、跨端一致、且能锚回 `.vue:行:列`（#712/#713 的 loc）。⇒ 这是**框架级 CPU 归因**，
//   不是"每个 JS 函数"的采样火焰图（那需要引擎支持，本版不做）。
//
// 【窗口式】`drain()` 读并**清零**（与帧采样器 #710 同形态）——宿主每 tick 取一次 ⇒ 得该窗口的
//   阶段耗时排行。★dev-only：`createScreenRuntime({ profile:true })` 才启用，release 零开销。
//
// 【为什么不引依赖】纯累加器（Map + 计数）⇒ 手写 ~40 行，无第三方（与 sourcemap.ts 同一纪律）。

/** 一条阶段采样（窗口内累加） */
export interface ProfEntry {
  /** 标签（`instantiate` / `flush` / `dispatch` / `handler「h0」`…） */
  label: string
  /** 调用次数 */
  count: number
  /** 累计耗时（ms；窗口内） */
  totalMs: number
  /** 单次最长（ms） */
  maxMs: number
  /** 模板源位置（handler 类才有；1 基，整份 `.vue` 行） */
  loc?: { line: number; column: number }
}

/** 阶段采样出口（宿主/dev server 取走即清——排空式） */
export interface RuntimeProfiler {
  /** 包一层计时：跑 `fn` 并把它耗时累加到 `label`（`loc` 仅首见记录）。 */
  time<T>(label: string, fn: () => T, loc?: { line: number; column: number }): T
  /** 读并**清零**本窗口（按累计耗时降序）。 */
  drain(): ProfEntry[]
}

/** 空实现（未启用 profiling 时用——`time` 直接透传，零开销）。 */
export const NULL_PROFILER: RuntimeProfiler = {
  time: (_label, fn) => fn(),
  drain: () => [],
}

const round1 = (v: number): number => Math.round(v * 10) / 10

/**
 * 建一个阶段采样器。`now()` 优先用 `performance.now()`（亚毫秒），无则回落 `Date.now()`（ms）。
 *   ★诚实边界：`Date.now()` 的毫秒分辨率会把"微秒级 handler"记成 0ms——**不影响找热点**
 *   （热点本就是 ms 级），但别把 0 读成"绝对没花时间"。
 */
export function createRuntimeProfiler(): RuntimeProfiler {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance
  const now = perf && typeof perf.now === 'function' ? () => perf.now!() : () => Date.now()
  const acc = new Map<string, { count: number; totalMs: number; maxMs: number; loc?: { line: number; column: number } }>()
  return {
    time(label, fn, loc) {
      const t0 = now()
      try {
        return fn()
      } finally {
        const ms = now() - t0
        let e = acc.get(label)
        if (!e) { e = { count: 0, totalMs: 0, maxMs: 0 }; acc.set(label, e) }
        e.count += 1
        e.totalMs += ms
        if (ms > e.maxMs) e.maxMs = ms
        if (loc && !e.loc) e.loc = loc
      }
    },
    drain() {
      const out: ProfEntry[] = []
      for (const [label, e] of acc) {
        out.push({ label, count: e.count, totalMs: round1(e.totalMs), maxMs: round1(e.maxMs), ...(e.loc ? { loc: e.loc } : {}) })
      }
      acc.clear()
      out.sort((a, b) => b.totalMs - a.totalMs)
      return out
    },
  }
}
