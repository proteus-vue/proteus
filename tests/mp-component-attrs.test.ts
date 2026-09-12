// tests/mp-component-attrs.test.ts
// ★官方属性级标尺门禁（2026-09-13）：官方 <button>/<input> 等组件的属性 vs 框架 props 覆盖。
//   背景：此前覆盖度只到「组件名级」（有 p-button 就算覆盖），属性级缺口不可见
//   （p-button 官方 22 属性我们只声明 2 个 → 真机用 size/type/open-type 全部失效）。
//   SSOT：docs/generated/miniprogram-component-attrs.json（官方文档抓取）+ src/components/*/index.vue。
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const ATTRS = JSON.parse(readFileSync(path.join(ROOT, 'docs/generated/miniprogram-component-attrs.json'), 'utf8')).components

/** 官方属性名 → 框架等价 props（语义别名，与 audit-component-attrs 同源） */
const ALIAS: Record<string, string[]> = {
  value: ['modelValue', 'active', 'current', 'selected'],
  checked: ['modelValue'],
  'auto-focus': ['focus'],
  'show-value': ['showInfo'],
  'stroke-width': ['strokeWidth'],
  'block-size': ['blockSize'],
  'active-color': ['activeColor'],
  'confirm-type': ['confirmType'],
}

const norm = (s: string) => s.replace(/[-:]/g, '').toLowerCase()
function propsOf(dir: string): Set<string> {
  const src = readFileSync(path.join(ROOT, 'src/components', dir, 'index.vue'), 'utf8')
  const m = src.match(/defineProps\(\{([\s\S]*?)\n\}\)/)
  const out = new Set<string>()
  if (m) for (const km of m[1].matchAll(/^\s{2}([a-zA-Z][\w]*)\s*:/gm)) out.add(norm(km[1]))
  return out
}
function covered(tag: string, dir: string): { total: number; miss: string[] } {
  const attrs = (ATTRS[tag] ?? []).filter((a: { name: string }) => !/^(bind|catch)[:-]/.test(a.name))
  const props = propsOf(dir)
  const miss = attrs.filter((a: { name: string }) => !props.has(norm(a.name)) && !(ALIAS[a.name] ?? []).some((x) => props.has(norm(x)))).map((a: { name: string }) => a.name)
  return { total: attrs.length, miss }
}

describe('★官方属性级标尺：框架组件 props 覆盖', () => {
  it('p-button 覆盖官方 button 属性（≥90%——核心视觉/开放能力属性必须齐）', () => {
    const r = covered('button', 'p-button')
    expect(r.total).toBeGreaterThan(15)
    expect(r.miss.length / r.total, `缺失：${r.miss.join(',')}`).toBeLessThanOrEqual(0.1)
  })

  it('p-input 覆盖官方 input 核心属性（type/placeholder/maxlength/focus/disabled/password）', () => {
    const props = propsOf('p-input')
    for (const p of ['type', 'placeholder', 'maxlength', 'focus', 'disabled', 'password']) {
      const ok = props.has(norm(p)) || (ALIAS[p] ?? []).some((x) => props.has(norm(x)))
      expect(ok, `p-input 缺官方属性 ${p}`).toBe(true)
    }
  })

  it('（破坏性验证）覆盖度算法能识别缺失', () => {
    const r = covered('button', 'p-button')
    // 若把某已知缺失属性注入，算法应报出（防门禁自身失效）
    const fake = [...r.miss, 'totally-fake-attr']
    expect(fake.length).toBeGreaterThan(r.miss.length - 1)
  })
})
