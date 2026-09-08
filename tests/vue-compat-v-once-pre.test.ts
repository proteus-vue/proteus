// tests/vue-compat-v-once-pre.test.ts
// ★2026-09-08 v-once/v-pre 诚实对齐：纯静态内容剥离无警告（语义等价）；含 {{ }} 插值 → 诚实警告（MP 无惰性/raw 模式）。
import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml } from '../packages/compiler/src/template'

function t(tpl: string): { wxml: string; warnings: string[] } {
  return transformTemplateToWxml(tpl, { px2rpx: true, rpxRatio: 2, annotateLines: false }) as unknown as { wxml: string; warnings: string[] }
}

describe('v-once / v-pre 诚实对齐', () => {
  it('v-once 纯静态内容 → 剥离无警告', () => {
    const r = t('<view v-once>hello</view>')
    expect(r.warnings).toEqual([])
    expect(r.wxml).toContain('<view>hello</view>')
  })
  it('v-once 含插值 → 诚实警告', () => {
    const r = t('<view v-once>{{ n }}</view>')
    expect(r.warnings.some((w) => /v-once.*插值/.test(w))).toBe(true)
  })
  it('v-pre 纯静态内容 → 剥离无警告', () => {
    const r = t('<view v-pre>hello</view>')
    expect(r.warnings).toEqual([])
    expect(r.wxml).toContain('<view>hello</view>')
  })
  it('v-pre 含插值 → 诚实警告（WXML 无 raw 模式）', () => {
    const r = t('<view v-pre>{{ n }}</view>')
    expect(r.warnings.some((w) => /v-pre.*插值/.test(w))).toBe(true)
  })
})
