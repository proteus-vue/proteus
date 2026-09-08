// tests/vue-compat-teleport.test.ts
// ★2026-09-08 <teleport> 诚实对齐：无 root-portal 层叠语义——解壳内联子元素（内容渲染）+ 诚实警告（不静默）。
import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml } from '../packages/compiler/src/template'

function t(tpl: string): { wxml: string; warnings: string[] } {
  return transformTemplateToWxml(tpl, { px2rpx: true, rpxRatio: 2, annotateLines: false }) as unknown as { wxml: string; warnings: string[] }
}

describe('<teleport> 诚实对齐（解壳内联）', () => {
  it('teleport → 解壳内联子元素（内容渲染）', () => {
    const r = t('<teleport to="body"><view>hi</view></teleport>')
    expect(r.wxml).toContain('<view>hi</view>')
    expect(r.wxml).not.toContain('<teleport')
  })
  it('teleport → 诚实警告（无 root-portal 层叠语义）', () => {
    const r = t('<teleport><view>hi</view></teleport>')
    expect(r.warnings.some((w) => /teleport.*root-portal/.test(w))).toBe(true)
  })
})
