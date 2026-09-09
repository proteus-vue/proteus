// tests/svg-spike-compiler-gaps.test.ts
// ★2026-09-09 G-62 SVG→Skyline 地基 spike 顺带暴露的两个编译器缺口（已修，此处回归锁）：
//   ① 箭头函数参数类型注解未剥离：`.node((res: any) => {...})` 的 `res: any` 残留 → 产物 Unexpected token ':'
//      （stripTypeSyntax ④ 此前只处理带返回注解的箭头 `(n): void =>`，无返回注解形态漏网）
//   ② ref 赋值多行 RHS 被截断：`s.value = ok\n  ? a\n  : b` 只截首行 → setData({s: ok}) 后悬空三元 = 语法错
//      （RHS 平衡扫描遇换行即停；改为按「换行前最后一个非空白字符是否为续行符号」判定）
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'

const compile = (script: string, template = '<template><view>x</view></template>') =>
  compileVueSfc(`<script setup lang="ts">\n${script}\n</script>\n${template}`, { filename: 't.vue' }) as any

describe('SVG spike 暴露的编译器缺口（回归锁）', () => {
  it('① 箭头函数参数类型注解剥离（无返回注解形态）', () => {
    // 单参 / 双参 / 回调内对象参——产物零 `(x: T) =>` 残留
    const r1 = compile('function f() { [1].forEach((x: number) => { void x }) }')
    expect(r1.js).not.toMatch(/\(x: number\)/)
    const r2 = compile('function f() { const g = (a: string, b: number) => a + b; void g }')
    expect(r2.js).not.toMatch(/\(a: string, b: number\)/)
    const r3 = compile('function f() { q.select("#a").node((res: any) => { void res }) }')
    expect(r3.js).not.toMatch(/\(res: any\)/)
    expect(r3.js).toMatch(/\(res\) =>/)
  })

  it('② ref 赋值多行三元 RHS 完整保留（不被换行截断）', () => {
    const r = compile('const s = ref("")\nfunction f() { const ok = true; s.value = ok\n  ? "yes"\n  : "no" }', '<template><view>{{ s }}</view></template>')
    // 三元完整进 setData（含 ? : 两分支）
    expect(r.js).toMatch(/setData\(\{ s: ok[\s\S]*\? "yes"[\s\S]*: "no"/)
  })

  it('② 多行对象 / 多行链式 RHS 完整保留', () => {
    const r1 = compile('const o = ref({})\nfunction f() { o.value = {\n  a: 1,\n  b: 2,\n} }', '<template><view>{{ o }}</view></template>')
    expect(r1.js).toMatch(/setData\(\{ o: \{[\s\S]*a: 1[\s\S]*b: 2/)
    const r2 = compile('const s = ref("")\nfunction f() { s.value = "a"\n  .toUpperCase() }', '<template><view>{{ s }}</view></template>')
    expect(r2.js).toMatch(/setData\(\{ s: "a"[\s\S]*\.toUpperCase\(\)/)
  })

  it('② 续行判定不误吞后续独立语句（if / this 调用 / 新赋值）', () => {
    const r1 = compile('const n = ref(0)\nfunction f() { n.value = 1\n  if (n.value) { console.log("x") } }', '<template><view>{{ n }}</view></template>')
    expect(r1.js).toMatch(/setData\(\{ n: 1 \}\)/)
    expect(r1.js).toMatch(/if \(this\.data\.n\)/)
    const r2 = compile('const n = ref(0)\nfunction f() { n.value = 1\n  this.other() }\nfunction other() {}', '<template><view>{{ n }}</view></template>')
    expect(r2.js).toMatch(/setData\(\{ n: 1 \}\)/)
    expect(r2.js).toMatch(/this\.other\(\)/)
  })

  it('② 单行 RHS 形态不回归（既有产物形态锁定）', () => {
    const r = compile('const s = ref("")\nfunction f() { s.value = "x" }', '<template><view>{{ s }}</view></template>')
    expect(r.js).toMatch(/setData\(\{ s: "x" \}\)/)
  })
})
