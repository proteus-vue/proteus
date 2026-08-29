// tests/vue-compat-advance.test.ts
// Vue 能力兼容进阶（docs/vue-compat-advance.md）：
//   Batch 1：作用域插槽编译期警告（反黑盒）
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src'
import { getTransformRule } from '../packages/compiler/src/transforms/registry'

const compile = (src: string, name = 'vca.vue'): { warnings: string[]; wxml: string; js: string; wxss: string } => {
  const r = compileVueSfc(src, { filename: name })
  return { warnings: r.warnings, wxml: r.wxml, js: r.js, wxss: r.wxss }
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

describe('Batch 2：<transition> 装饰式动画（运行时等价，进入动画）', () => {
  it('子元素注入动画 class + wx:if 保留 + 不再警告', () => {
    const r = compile('<template><transition name="fade"><view v-if="on">X</view></transition></template><script setup>const on = ref(true)</script>')
    expect(r.warnings.some((w) => w.includes('<transition>'))).toBe(false) // 不再 no-peer 警告
    expect(r.wxml).toContain('class="proteus-transition-fade"')
    expect(r.wxml).toContain('wx:if="{{on}}"') // v-if 保留（显隐 + 重建自动播动画）
    expect(r.wxml).not.toContain('<transition') // 装饰式：过渡标签不输出
  })

  it('wxss 注入进入动画 keyframes', () => {
    const r = compile('<template><transition name="slide-up"><view v-if="on">X</view></transition></template><script setup>const on = ref(true)</script>')
    expect(r.wxss).toContain('proteus-transition-slide-up')
    expect(r.wxss).toContain('@keyframes proteus-slide-up-in')
  })

  it('transition-group/teleport 保留警告', () => {
    const r = compile('<template><transition-group name="fade"><view v-for="i in l" :key="i">{{ i }}</view></transition-group></template><script setup>const l = ref([1,2])</script>')
    expect(r.warnings.some((w) => w.includes('<transition-group>'))).toBe(true)
  })

  it('规则 transition/component 与 transition/animation-wxss 已登记', () => {
    expect(getTransformRule('transition/component')).toBeDefined()
    expect(getTransformRule('transition/animation-wxss')).toBeDefined()
  })
})
