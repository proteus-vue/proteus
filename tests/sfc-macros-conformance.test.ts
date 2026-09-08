// tests/sfc-macros-conformance.test.ts
// ★★2026-09-08 架构定调：宏语义权威源 = @vue/compiler-sfc compileScript（不手造）。本测试做**一致性门测**：
//   对代表性真实组件，断言「手写 extractProps 产出的 properties」与「compileScript 权威 propNames/emits」一致
//   （差集为空）——若手写宏实现与官方标准漂移，即"地基不牢"，本测试红。这也为未来把手写宏迁移到权威源提供基准。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractSfcMacros } from '../packages/compiler/src/sfc-macros'
import { compileVueSfc } from '../packages/compiler/src/index'

const opts = { px2rpx: true, rpxRatio: 2 }
// ★代表性真实组件（对象形式 defineProps + 数组 defineEmits + 泛型形式各覆盖）
const CASES: Array<[string, string]> = [
  ['p-button', 'src/components/p-button/index.vue'],
  ['p-list-view', 'src/components/p-list-view/index.vue'],
  ['p-drawer', 'src/components/p-drawer/index.vue'],
]

function compiledProps(file: string): Record<string, string> {
  const src = readFileSync(file, 'utf8')
  const c = compileVueSfc(src, { filename: file, ...opts, isComponent: true })
  const propsBlock = c.js.match(/properties:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? ''
  // name → type（微信 properties type 字段——手写 extractProps 的类型映射）
  return Object.fromEntries([...propsBlock.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{\s*type:\s*(\w+)/g)].map((m) => [m[1], m[2]]))
}

describe('手写宏实现 × compileScript 权威源一致性（地基对齐门测）', () => {
  it.each(CASES)('%s：手写 extractProps 产物 ⊆ compileScript 权威 propNames（差集为空）', (_label, file) => {
    const src = readFileSync(file, 'utf8')
    const authoritative = extractSfcMacros(src, file)
    expect(authoritative.ok).toBe(true)
    const authProps = [...authoritative.propNames]
    const compiled = compiledProps(file)
    // 编译 properties 应覆盖全部权威 prop 名（可多出框架注入字段如 rootClass，但不得少）
    const missing = authProps.filter((p) => !(p in compiled))
    expect(missing, `手写 extractProps 漏了权威 prop：${missing.join(', ')}`).toEqual([])
  })

  it.each(CASES)('%s：手写 extractProps 的 type 映射与 compileScript 权威 propsMeta.type 一致', (_label, file) => {
    const src = readFileSync(file, 'utf8')
    const authoritative = extractSfcMacros(src, file)
    const compiled = compiledProps(file)
    for (const [name, meta] of Object.entries(authoritative.propsMeta)) {
      expect(compiled[name], `${name} 应被编译为 properties`).toBeTruthy()
      expect(compiled[name], `${name} type 应=${meta.type}`).toBe(meta.type)
    }
  })

  it('p-button：权威 emits 含 click（compileScript 数组 emits）', () => {
    const src = readFileSync('src/components/p-button/index.vue', 'utf8')
    const authoritative = extractSfcMacros(src, 'p-button.vue')
    expect(authoritative.emits).toContain('click')
  })

  it('p-input：权威 emits 含 input/confirm/focus/blur（手写 emit 实现的地基校准源）', () => {
    const src = readFileSync('src/components/p-input/index.vue', 'utf8')
    const authoritative = extractSfcMacros(src, 'p-input.vue')
    for (const e of ['input', 'confirm', 'focus', 'blur']) expect(authoritative.emits, `emit ${e}`).toContain(e)
  })
})
