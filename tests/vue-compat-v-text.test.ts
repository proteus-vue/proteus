// tests/vue-compat-v-text.test.ts
// ★2026-09-08 v-text 对齐：v-text="expr" → 元素内容覆盖为文本插值 {{ expr }}（Vue 语义：覆盖子节点输出文本）。
//   此前被当自定义指令剥离 + 警告（文本内容丢失——真 bug 非语义限制）。
import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml } from '../packages/compiler/src/template'

function t(tpl: string): { wxml: string; warnings: string[] } {
  return transformTemplateToWxml(tpl, { px2rpx: true, rpxRatio: 2, annotateLines: false }) as unknown as { wxml: string; warnings: string[] }
}

describe('v-text → 文本插值对齐', () => {
  it('v-text 覆盖元素内容为 {{ expr }}', () => {
    const r = t('<view v-text="msg">child</view>')
    expect(r.wxml).toMatch(/<view>\{\{ msg \}\}<\/view>/)
    expect(r.warnings.some((w) => /自定义指令/.test(w))).toBe(false)
  })
  it('v-text 保留元素标签（h1 → text + 语义类）', () => {
    const r = t('<h1 v-text="\'title\'">x</h1>')
    expect(r.wxml).toMatch(/<text class="proteus-h1">\{\{ 'title' \}\}<\/text>/)
  })
  it('无 v-text 不覆盖（插值正常）', () => {
    const r = t('<view>{{ msg }}</view>')
    expect(r.wxml).toMatch(/<view>\{\{ msg \}\}<\/view>/)
  })
})
