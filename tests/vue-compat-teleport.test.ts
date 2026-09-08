// tests/vue-compat-teleport.test.ts
// ★2026-09-08 <teleport> → <root-portal> 对齐：Skyline 官方 root-portal（子树脱离页面类似 fixed，用于弹窗/弹出层——弹层层叠正解）。
import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml } from '../packages/compiler/src/template'

function t(tpl: string): { wxml: string; warnings: string[] } {
  return transformTemplateToWxml(tpl, { px2rpx: true, rpxRatio: 2, annotateLines: false }) as unknown as { wxml: string; warnings: string[] }
}

describe('<teleport> → <root-portal> 对齐', () => {
  it('teleport → root-portal（子树脱离页面层叠）', () => {
    const r = t('<teleport><view class="overlay">hi</view></teleport>')
    expect(r.wxml).toMatch(/<root-portal>\s*\n<view class="overlay">hi<\/view>\s*\n<\/root-portal>/)
    expect(r.wxml).not.toContain('<teleport')
  })
  it('teleport to= 目标 MP 无对等 → 警告说明忽略 to', () => {
    const r = t('<teleport to="body"><view>hi</view></teleport>')
    expect(r.warnings.some((w) => /teleport.*to/.test(w))).toBe(true)
  })
})
