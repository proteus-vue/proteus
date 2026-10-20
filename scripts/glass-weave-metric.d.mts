// scripts/glass-weave-metric.d.mts —— 为 TS 侧（tests/）提供 `glass-weave-metric.mjs` 的类型面
//
// 【为什么需要它】`scripts/glass-weave-metric.mjs` 是纯 ESM 脚本（给 CLI 用，不参与 TS 编译），
//   而 `tests/glass-weave-metric.test.ts` 要 import 它的纯函数做判据。
//   TS 在 `allowJs:false` 下对 `.mjs` 给 `TS7016: no declaration file` ⇒ 用本文件补声明
//   （比"把测试改成 any"更严格：参数/返回类型仍然受检）。
//
// ★只声明**测试真正用到的**四个纯函数；CLI 部分（decodePng/参数解析）不在此列——
//   它们涉及 IO，测试不需要，也别让类型面替它们背书。
export function luminance(rgba: Uint8Array, w: number, h: number): Float64Array

export function highPass(lum: Float64Array, w: number, h: number): Float64Array

export interface WeaveRegion {
  x: number
  y: number
  w: number
  h: number
}

export function autocorr(
  res: Float64Array,
  w: number,
  h: number,
  region: WeaveRegion,
  dir: 'h' | 'v' | 'd1' | 'd2',
  maxLag?: number,
): number[]

export function weaveScore(
  res: Float64Array,
  w: number,
  h: number,
  region: WeaveRegion,
  opts?: { maxLag?: number; minLag?: number },
): { score: number; lag: number; dir: string; perDir: Record<string, number[]> }
