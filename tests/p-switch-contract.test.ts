// tests/p-switch-contract.test.ts
// ★p-switch 设计契约回归锁（2026-09-13 用户评审 + G-31 铁律）：
//   ① 不沿用官方 `type=switch|checkbox`（平台历史包袱）→ 改为 `shape: round|square`（都是开关）；
//   ② 自绘（原生 <switch> 的方角物理上做不到，且两端视觉无法统一）；
//   ③ 事件与 MP 原生 bind:change 对齐（载荷 { detail: { value } }）；
//   ④ spinner 用「统一色 border 环 + 随子点」（Skyline 下单边异色 border 会使圆角失效）；
//   ⑤ spinner 位于滑块内部**正中**（flex 居中）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'

const ROOT = path.resolve(__dirname, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'packages/components/p-switch/index.vue'), 'utf-8')

describe('★p-switch 设计契约', () => {
  it('① 用 shape（round/square）而非官方 type=switch|checkbox（平台包袱，G-31）', () => {
    expect(SRC, '应有 shape prop').toMatch(/shape:\s*\{\s*type:\s*String/)
    expect(SRC, '不应有 type prop（官方包袱）').not.toMatch(/\btype:\s*\{\s*type:\s*String/)
    // 字面量键（编译期可静态后缀）；禁动态拼接 `p-switch--${shape}`
    expect(SRC).toContain("'p-switch--round': shape === 'round'")
    expect(SRC).toContain("'p-switch--square': shape === 'square'")
    expect(SRC, '禁动态拼接类名（MP 无法后缀）').not.toMatch(/`p-switch--\$\{/)
  })

  it('② 自绘（MP 产物为 view 自绘组件，非原生 switch）', () => {
    const { wxml } = compileVueSfc(SRC, { isComponent: true, filename: 'packages/components/p-switch/index.vue' })
    expect(wxml, '不应含原生 <switch>（方角做不到）').not.toContain('<switch')
    expect(wxml).toContain('bindtap="onToggle"')
    expect(wxml, 'shape 字面量键应进产物').toContain('p-switch--square')
  })

  it('③ 事件载荷为**裸值**（★MP: e.detail = 载荷；包 detail 会双层 → 页面读不到）', () => {
    expect(SRC).toContain("emit('change', { value: next })")
    expect(SRC, '不得再包一层 detail').not.toContain("emit('change', { detail: {")
    expect(SRC).toContain("emit('update:modelValue', next)")
  })

  it('④⑤ spinner：统一色环 + 随子点（非单边异色 border）；位于滑块内 flex 居中', () => {
    // 去注释后判断（注释里会解释这个陷阱，提到属性名不算违规）
    const code = SRC.replace(/<!--[\s\S]*?-->/, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code, '禁用单边异色 border（Skyline 圆角失效）').not.toMatch(/border-(top|right|bottom|left)-color/)
    expect(SRC, '统一色 border 环').toMatch(/\.p-switch__spinner\s*\{[^}]*border:\s*1?\.?\d*px solid/)
    expect(SRC, '随转子元素点').toContain('.p-switch__spinner-dot')
    // spinner 位于 thumb 内部（模板嵌套）
    expect(SRC).toMatch(/p-switch__thumb[\s\S]*?p-switch__spinner/)
    // thumb 为 flex 居中容器
    expect(SRC).toMatch(/\.p-switch__thumb\s*\{[^}]*justify-content:\s*center/)
  })
})
