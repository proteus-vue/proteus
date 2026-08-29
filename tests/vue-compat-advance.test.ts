// tests/vue-compat-advance.test.ts
// Vue 能力兼容进阶（docs/vue-compat-advance.md）：
//   Batch 1：作用域插槽编译期警告（反黑盒）
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src'
import { getTransformRule } from '../packages/compiler/src/transforms/registry'

const compile = (src: string, name = 'vca.vue'): { warnings: string[]; wxml: string; js: string } => {
  const r = compileVueSfc(src, { filename: name })
  return { warnings: r.warnings, wxml: r.wxml, js: r.js }
}

describe('Batch 1：作用域插槽警告（反黑盒）', () => {
  it('<slot :item="x"> → 警告（MP 父侧拿不到子数据）', () => {
    const r = compile('<template><slot :item="item" /></template><script setup>const item = ref("x")</script>')
    expect(r.warnings.some((w) => w.includes('作用域插槽'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('props 传子'))).toBe(true)
  })

  it('普通插槽不受影响（无绑定属性 → 零警告）', () => {
    const r = compile('<template><slot /><slot name="title" /></template>')
    expect(r.warnings).toHaveLength(0)
  })

  it('规则 slot/scoped-slot 已登记', () => {
    const rule = getTransformRule('slot/scoped-slot')
    expect(rule).toBeDefined()
    expect(rule!.why).toContain('#117')
  })
})
