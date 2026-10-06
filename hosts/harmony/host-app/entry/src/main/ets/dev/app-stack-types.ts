// entry/src/main/ets/dev/app-stack-types.ts
// app-stack.ts（移植副本）的三个 type-only 依赖 —— 与上游**逐字段同形**（来源标注见下）：
//   · RouteParams      ← packages/types/src/router-types.ts（`[key: string]: string | number | boolean | undefined`）
//   · RouteTransition  ← packages/contracts/src/route.ts（五枚举）
//   · KeepAliveTier    ← packages/contracts/src/route.ts（none | active | all）
export interface RouteParams {
  [key: string]: string | number | boolean | undefined
}
export type RouteTransition = 'slideUp' | 'slideDown' | 'halfScreen' | 'scaleDown' | 'none'
export type KeepAliveTier = 'none' | 'active' | 'all'
