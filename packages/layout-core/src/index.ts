// packages/layout-core/src/index.ts
// ★★M1：排版核心（App 端高性能渲染）——渲染 IR → 布局几何求解。
//
// 分层：`@proteus-vue/component-ir`（PNode：归一化样式 + 编译期判定）
//   → **本包**（flex 求解：单次测量 + 脏区域 + 绘制指令流）
//   → 平台绘制层（iOS CALayer / Android Canvas / 鸿蒙 ArkUI——M4+）
//
// ★当前是 **Node 参考实现**（用户已确认的落地顺序）：先在最快反馈环里证明**布局正确性**，
//   M2+ 移植 C++（三端共享）时以本实现为**语义基准**对拍。
//   依据：计划坑位 #9「不要提前优化：先接 Yoga 跑通全链路，布局正确性不达标时谈性能无意义」。
export type {
  Size,
  Rect,
  EdgeValues,
  Constraints,
  LayoutNode,
  LayoutDiagnostic,
  LayoutResult,
} from './types'
export { UNBOUNDED, isUnbounded, tight, loose, ZERO_EDGES, clampSize } from './types'

export { solveLayout, rectOf } from './flex'

// ★M1-3：脏区标记 + 度量缓存（最小重排）
export type { MeasureCache, MeasureCacheEntry } from './dirty'
export {
  createMeasureCache,
  constraintKey,
  attachParents,
  markDirty,
  markDirtyAll,
  relayoutRootOf,
  relayoutScoped,
  isClean,
  resetMeasureCache,
} from './dirty'

// ★M1-4：渲染 IR（PNode）适配 + 平台无关绘制指令流
export type { LengthContext, TextMeasurer, FromPNodeOptions, PaintInfo } from './from-pnode'
export { resolveLength, layoutTreeFromPNode, paintInfoOf } from './from-pnode'
export type { RenderCmd, RenderCmdKind, RenderCmdList, EmitOptions } from './render-cmd'
export { emitRenderCmds, formatRenderCmds } from './render-cmd'
