// tests/cli-sourcemap.test.ts —— ★★★source map 消费者（决策 #711，零依赖 VLQ 解码）
//   判据：① 用**真 esbuild** 产出的 map 做**往返**（生成位置 → 源位置）；② 内联 map 抽取；
//   ③ 栈整段映射（bundle 帧 → 源文件帧）。★用真 esbuild 而非手搓 map（避免"测的是自造数据"）。
import { describe, it, expect } from 'vitest'
import { transform } from 'esbuild'
import { parseMappings, originalPositionFor, inlineMapOf, mapStack, locationInFrame, type RawSourceMap } from '../packages/cli/src/sourcemap'

describe('★source map 消费者（决策 #711）', () => {
  it('① 真 esbuild map：生成位置 → 源位置（往返）', async () => {
    const src = 'export const uniqueMarkerXYZ = 123\n'
    const r = await transform(src, { sourcemap: true, loader: 'ts', format: 'esm' })
    const map = JSON.parse(r.map) as RawSourceMap
    expect(map.mappings, 'map 非空').toBeTruthy()
    // 在生成码里找标记名的位置（1 基行列）
    const lines = r.code.split('\n')
    let ln = 0, col = 0
    for (let i = 0; i < lines.length; i++) { const c = lines[i]!.indexOf('uniqueMarkerXYZ'); if (c >= 0) { ln = i + 1; col = c + 1; break } }
    expect(ln, '生成码含标记').toBeGreaterThan(0)
    const o = originalPositionFor(map, ln, col)
    expect(o, '映射命中').toBeTruthy()
    expect(o!.line, '映回源第 1 行').toBe(1)
  })

  it('② 内联 map 抽取 + parseMappings 逐行还原绝对列', async () => {
    const r = await transform('export const A = 1\nexport const B = 2\n', { sourcemap: 'inline', loader: 'ts', format: 'esm' })
    const map = inlineMapOf(r.code)
    expect(map, '抽出内联 map').toBeTruthy()
    const rows = parseMappings(map!)
    expect(rows.length, '行组数 ≥ 2').toBeGreaterThanOrEqual(2)
    // 首段 genCol 恒从 0 起（相对编码还原后）
    expect(rows[0]![0]!.genCol).toBe(0)
  })

  it('③ 栈整段映射：bundle 帧 → 源文件帧（非 bundle 帧原样保留）', async () => {
    const r = await transform('export function boom() { throw new Error("x") }\n', { sourcemap: 'inline', loader: 'ts', format: 'esm' })
    const map = inlineMapOf(r.code)!
    // 造一个含 bundle 文件名 + 行号的假栈（行号取生成码第 1 行）
    const stack = 'Error: x\n    at boom (bundle-superapp.js:1:20)\n    at native (unknown)'
    const out = mapStack(map, stack)
    expect(out, 'bundle 帧被映射（不再指 bundle-superapp.js）').not.toContain('bundle-superapp.js:1:20')
    expect(out, '非 bundle 帧原样保留').toContain('at native (unknown)')
  })

  it('locationInFrame 抽 1 基行列；非法 ⇒ null', () => {
    expect(locationInFrame('at f (bundle-superapp.js:12:34)')).toEqual({ line: 12, column: 34 })
    expect(locationInFrame('no location here')).toBeNull()
  })
})
