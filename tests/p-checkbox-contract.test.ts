// tests/p-checkbox-contract.test.ts
// ★p-checkbox 契约回归锁（2026-09-13 SOP v2 批次 1）：
//   ① 官方 4 属性全覆盖（modelValue←checked 归一 / value / disabled / color）；
//   ② 事件载荷 { detail: { value, name } }（name = value 标识，群选可辨）；
//   ③ 自绘小方框（与官方 checkbox 形态一致，两端统一）；
//   ④ 不出现单边异色 border（Skyline S2 陷阱）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'src/components/p-checkbox/index.vue'), 'utf-8')

describe('★p-checkbox 契约', () => {
  it('① 官方属性全覆盖（modelValue/value/disabled/color）+ indeterminate 扩展', () => {
    for (const p of ['modelValue', 'value', 'disabled', 'color', 'indeterminate']) {
      expect(SRC, `应有 ${p} prop`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
  })

  it('② 事件载荷为**裸值**含 value + name（★MP: e.detail = 载荷；包 detail 会双层 → 页面读不到）', () => {
    expect(SRC).toContain("emit('change', { value: next, name: props.value })")
    expect(SRC, '不得再包一层 detail（真机群选失效根因）').not.toContain("emit('change', { detail: {")
    expect(SRC).toContain("emit('update:modelValue', next)")
  })

  it('③ 自绘小方框 + 勾选/半选标记；禁用淡化', () => {
    expect(SRC).toContain('p-checkbox__box')
    expect(SRC).toContain('p-checkbox__check')  // weui 白底绿勾（原 mark→check）
    expect(SRC).toMatch(/\.p-checkbox--disabled\s*\{[^}]*opacity/)
  })

  it('④ 无单边异色 border（Skyline 圆角失效陷阱 S2）', () => {
    const code = SRC.replace(/<!--[\s\S]*?-->/, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/border-(top|right|bottom|left)-color/)
  })
})
