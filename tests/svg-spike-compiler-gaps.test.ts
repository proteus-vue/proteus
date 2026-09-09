// tests/svg-spike-compiler-gaps.test.ts
// ★2026-09-09 G-62 SVG→Skyline 地基 spike 顺带暴露的两个编译器缺口（已修，此处回归锁）：
//   ① 箭头函数参数类型注解未剥离：`.node((res: any) => {...})` 的 `res: any` 残留 → 产物 Unexpected token ':'
//      （stripTypeSyntax ④ 此前只处理带返回注解的箭头 `(n): void =>`，无返回注解形态漏网）
//   ② ref 赋值多行 RHS 被截断：`s.value = ok\n  ? a\n  : b` 只截首行 → setData({s: ok}) 后悬空三元 = 语法错
//      （RHS 平衡扫描遇换行即停；改为按「换行前最后一个非空白字符是否为续行符号」判定）
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'
import { validateMpJsPlatform } from '../packages/compiler/src/validate'

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

describe('P2 spike 暴露的编译器缺口（回归锁）', () => {
  it('③ computed 表达式内模块级函数裸调用 → this.name(（此前裸调用 ReferenceError）', () => {
    const r = compile('import { computed } from "vue"\nconst n = ref(1)\nfunction double(x: number): number { return x * 2 }\nconst out = computed(() => double(n.value))', '<template><view>{{ out }}</view></template>')
    expect(r.js).toMatch(/setData\(\{ out: this\.double\(this\.data\.n\)/)
    expect(r.js).not.toMatch(/setData\(\{ out: double\(/)
  })

  it('③ 方法体内模块函数改写不回归（methodNames 通道）', () => {
    const r = compile('function helper(x: string): string { return x + "!" }\nfunction go() { return helper("a") }', '<template><view>x</view></template>')
    expect(r.js).toMatch(/return this\.helper\("a"\)/)
  })

  it('③ computed 内非方法调用不受影响（Math/内置保持裸调用）', () => {
    const r = compile('const n = ref(1)\nconst out = computed(() => Math.max(n.value, 0))', '<template><view>{{ out }}</view></template>')
    expect(r.js).toMatch(/Math\.max\(this\.data\.n, 0\)/)
  })
})

describe('canvas 探测 v2 暴露的编译器缺口（回归锁）', () => {
  it('④ 嵌套 function 表达式参数类型注解剥离（方法体内回调）', () => {
    const r = compile('function go() { const h = function (r: unknown) { void r }; void h }')
    expect(r.js).not.toMatch(/function \([^)]*:\s*\w+\)/)
    expect(r.js).toMatch(/function \(r\)/)
  })

  it('④ 具名 function 声明的参数 + 返回类型注解剥离（嵌套）', () => {
    const r = compile('function go() { function inner(r: unknown): string { return String(r) } void inner }')
    expect(r.js).not.toMatch(/function inner\([^)]*:\s*\w+\)/)
    expect(r.js).toMatch(/function inner\s*\(r\)/)
    expect(r.js).not.toMatch(/\)\s*:\s*string\s*\{/)
  })

  it('④ 箭头函数参数注解剥离不回归', () => {
    const r = compile('function go() { [1].forEach((x: number) => { void x }) }')
    expect(r.js).not.toMatch(/\(x: number\)/)
  })
})

describe('canvas 调研探针暴露的缺口（回归锁）', () => {
  it('⑤ 普通 function 回调内方法调用 → self.name() + 注入 var self = this', () => {
    const r = compile(
      'import { onMounted } from "vue"\nfunction doWork(): void {}\nonMounted(() => { setTimeout(function () { doWork() }, 100) })',
      '<template><view>x</view></template>',
    )
    // 回调内不能是 this.（普通 function 的 this 非页面实例）
    expect(r.js).toMatch(/setTimeout\(function \(\) \{ self\.doWork\(\) \}/)
    expect(r.js).not.toMatch(/setTimeout\(function \(\) \{ this\.doWork\(\) \}/)
    expect(r.js).toMatch(/var self = this/)
  })

  it('⑤ 箭头回调保持 this.（词法 this 正确）', () => {
    const r = compile(
      'import { onMounted } from "vue"\nfunction doWork(): void {}\nonMounted(() => { setTimeout(() => { doWork() }, 100) })',
      '<template><view>x</view></template>',
    )
    expect(r.js).toMatch(/setTimeout\(\(\) => \{ this\.doWork\(\) \}/)
    expect(r.js).not.toMatch(/self\.doWork\(\)/)
  })

  it('⑤ 方法体顶层调用保持 this.（既有行为不回归）', () => {
    const r = compile('function a(): void {}\nfunction b(): void { a() }', '<template><view>x</view></template>')
    expect(r.js).toMatch(/this\.a\(\)/)
    expect(r.js).not.toMatch(/self\.a\(\)/)
  })
})

describe('真机预览暴露的 ES2021 语法缺口（回归锁）', () => {
  it('⑥ 数字分隔符 3600_000 → 转译为 3600000（小程序 babel 不解析）', () => {
    const r = compile('const delay = 3600_000\nconst hex = 0x1_2', '<template><view>{{ delay }}</view></template>')
    expect(r.js).toMatch(/3600000/)
    expect(r.js).not.toMatch(/\d_\d/)
  })

  it('⑥ 数字分隔符门禁（validateMpJsPlatform 残留即红）', () => {
    expect(validateMpJsPlatform('const a = 3600_000').ok).toBe(false)
    expect(validateMpJsPlatform('const a = 3600000').ok).toBe(true)
    expect(validateMpJsPlatform('const a_b = 1').ok).toBe(true) // 标识符不误报
    expect(validateMpJsPlatform("const s = '1_000'").ok).toBe(true) // 字符串不误报
  })

  it('⑥ BigInt 不崩溃（编译期求值转字符串——小程序无 BigInt）', () => {
    expect(() => compile('const big = 123n', '<template><view>x</view></template>')).not.toThrow()
  })
})
