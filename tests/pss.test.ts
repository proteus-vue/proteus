// tests/pss.test.ts
// ★G-43 B5（proteus-ownership-plan batches B5）：PSS 编译器支持（权威 TS 版）
//   验收：① B-03/B-06/B-07/B-08 规则生效（B-07/B-08 本批补全——跨页强引用/循环引用）
//        ② strict 模式下业务不写 drop 也能正确释放（insertScopeDrops）
//        ③ Vue ref(Owned) 被正确拦截（CMP071）
//        + P1~P9 限制（strict 全量 / loose 仅 P1+P2）+ pragma 声明 + runPss 管线
import { describe, it, expect } from 'vitest'
import { resolvePssMode, analyzePss, insertScopeDrops, runPss, analyzeOwnershipSource } from '@proteus-vue/render-backend'

describe('G-43 B5 resolvePssMode 模块级声明', () => {
  it('pragma 声明覆盖缺省（strict/loose/off）+ 未声明回退', () => {
    expect(resolvePssMode('// @proteus-pss: strict\nconst x = 1')).toBe('strict')
    expect(resolvePssMode('// @proteus-pss loose\nconst x = 1')).toBe('loose')
    expect(resolvePssMode('// @proteus-pss: off')).toBe('off')
    expect(resolvePssMode('const x = 1')).toBe('off') // 未声明 → fallback off
    expect(resolvePssMode('const x = 1', 'strict')).toBe('strict')
    // 超出文件头 20 行的声明不生效（pragma 置顶惯例）
    const late = [...Array(25).fill('// pad'), '// @proteus-pss: strict'].join('\n')
    expect(resolvePssMode(late)).toBe('off')
  })
})

describe('G-43 B5 P1~P9 限制检测', () => {
  it('strict 全量：P1 any / P2 动态属性 / P3 delete / P4 eval / P8 with / P9 原型链', () => {
    const src = [
      'function f() {',
      '  const cfg: any = {}',
      "  const v = x as unknown",
      '  obj[key] = 1',
      "  obj['literal'] = 2", // 静态字符串键放行
      '  delete obj.temp',
      '  eval("1+1")',
      '  const fn = new Function("return 1")',
      '  with (scope) {}',
      '  Foo.prototype.bar = () => {}',
      '}',
    ].join('\n')
    const r = analyzePss(src, { mode: 'strict', ownedVars: [] })
    const rules = r.diagnostics.map((d) => d.rule)
    expect(rules).toContain('P1')
    expect(rules).toContain('P2')
    expect(rules).toContain('P3')
    expect(rules).toContain('P4')
    expect(rules).toContain('P8')
    expect(rules).toContain('P9')
    // 全部 error（strict）
    expect(r.diagnostics.every((d) => d.severity === 'error')).toBe(true)
  })

  it('loose 只查 P1+P2 主路径（P3~P9 不报）；off 跳过', () => {
    const src = ['function f() {', '  const cfg: any = {}', '  obj[key] = 1', '  delete obj.temp', '  eval("1")', '}'].join('\n')
    const loose = analyzePss(src, { mode: 'loose', ownedVars: [] })
    const rules = loose.diagnostics.map((d) => d.rule)
    expect(rules).toContain('P1')
    expect(rules).toContain('P2')
    expect(rules).not.toContain('P3')
    expect(rules).not.toContain('P4')

    const off = analyzePss(src, { mode: 'off' })
    expect(off.diagnostics).toHaveLength(0)
  })

  it('P5 Owned 逃逸到全局 / P7 闭包捕获 Owned（ownedVars 驱动）', () => {
    const src = [
      'function f() {',
      '  const buf = pageContext.alloc(8 * MB)',
      '  globalThis.cache = buf',
      '  setTimeout(() => buf.read(), 100)',
      '  window.shared = other', // 非 owned 变量不报
      '}',
    ].join('\n')
    const r = analyzePss(src, { mode: 'strict', ownedVars: ['buf'] })
    const rules = r.diagnostics.map((d) => d.rule)
    expect(rules).toContain('P5')
    expect(rules).toContain('P7')
    // 非 owned 变量的全局赋值不报 P5
    expect(r.diagnostics.filter((d) => d.rule === 'P5')).toHaveLength(1)
  })

  it('CMP071：ref(Owned) 被正确拦截（strict error / loose warning）', () => {
    const src = ['function f() {', '  const buf = pageContext.alloc(8 * MB)', '  const wrapped = ref(buf)', '  const w2 = reactive(other)', '}'].join('\n')
    const strict = analyzePss(src, { mode: 'strict', ownedVars: ['buf'] })
    const cmp = strict.diagnostics.find((d) => d.rule === 'CMP071')
    expect(cmp).toBeDefined()
    expect(cmp?.severity).toBe('error')
    expect(cmp?.message).toContain('useOwned')
    // 非 owned 变量包装不报
    expect(strict.diagnostics.filter((d) => d.rule === 'CMP071')).toHaveLength(1)

    const loose = analyzePss(src, { mode: 'loose', ownedVars: ['buf'] })
    expect(loose.diagnostics.find((d) => d.rule === 'CMP071')?.severity).toBe('warning')
  })
})

describe('G-43 B5 insertScopeDrops 作用域自动 drop', () => {
  it('未处置 Owned 在函数闭合前插入 drop()；已处置（drop/transferTo）不插', () => {
    const src = [
      'function handler() {',
      '  const buf = pageContext.alloc(8 * MB)',
      '  const tmp = pageContext.alloc(1024)',
      '  const moved = pageContext.alloc(2048)',
      '  buf.read()',
      '  moved.transferTo("other")',
      '  console.log(tmp)',
      '}',
      '',
      'function done() {',
      '  const ok = pageContext.alloc(1)',
      '  ok.drop()',
      '}',
    ].join('\n')
    const r = insertScopeDrops(src)
    expect(r.insertions.map((i) => i.varName).sort()).toEqual(['buf', 'tmp'])
    // 插入位置：闭合 '}'（原第 8 行）前两行 —— 插入后 lines[7]/[8] 为 drop 语句，lines[9] = '}'
    const lines = r.code.split('\n')
    expect(lines[7]).toContain('buf.drop()')
    expect(lines[8]).toContain('tmp.drop()')
    expect(lines[9]).toBe('}')
    // done 无插入（已处置）
    expect(r.insertions.every((i) => i.varName !== 'ok' && i.varName !== 'moved')).toBe(true)
    // 代码仍可读（原行保留）
    expect(r.code).toContain('buf.read()')
  })

  it('嵌套作用域：内层函数 own 闭合在内层；顶层（模块级）声明不插', () => {
    const src = [
      'function outer() {',
      '  const inner = () => {',
      '    const a = pageContext.alloc(1)',
      '  }',
      '  const b = pageContext.alloc(2)',
      '}',
      'const moduleLevel = pageContext.alloc(4)',
    ].join('\n')
    const r = insertScopeDrops(src)
    const byVar = new Map(r.insertions.map((i) => [i.varName, i.line]))
    expect(byVar.get('a')).toBe(4) // 内层箭头函数闭合（第 4 行）前
    expect(byVar.get('b')).toBe(6) // outer 闭合（第 6 行）前
    expect(byVar.has('moduleLevel')).toBe(false) // 模块级不自动 drop
  })
})

describe('G-43 B5 B-07/B-08 规则补全（borrow-checker 扩展）', () => {
  it('B-07 跨页面强引用：Owned 写入跨页容器（赋值 + store.set 形态）', () => {
    const src1 = ['function f() {', '  const buf = pageContext.alloc(8 * MB)', '  globalCache.data = buf', '}'].join('\n')
    const r1 = analyzeOwnershipSource(src1, { mode: 'strict' })
    expect(r1.diagnostics.some((d) => d.rule === 'B-07')).toBe(true)
    expect(r1.blocksBuild).toBe(true)

    const src2 = ['function f() {', '  const buf = pageContext.alloc(8 * MB)', "  store.set('data', buf)", '}'].join('\n')
    const r2 = analyzeOwnershipSource(src2, { mode: 'strict' })
    expect(r2.diagnostics.some((d) => d.rule === 'B-07' && d.message.includes('存入跨页容器'))).toBe(true)
  })

  it('B-08 循环引用：互指环 warning（不阻断构建）+ 无环不报', () => {
    const src = [
      'function f() {',
      '  const a = {}',
      '  const b = {}',
      '  a.next = b',
      '  b.prev = a',
      '}',
    ].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    const b08 = r.diagnostics.filter((d) => d.rule === 'B-08')
    expect(b08.length).toBeGreaterThanOrEqual(1)
    expect(b08.every((d) => d.severity === 'warning'))
    expect(r.blocksBuild).toBe(false) // warning 不阻断

    const clean = analyzeOwnershipSource('function f() {\n  const a = {}\n  const c = {}\n  a.next = c\n}', { mode: 'strict' })
    expect(clean.diagnostics.some((d) => d.rule === 'B-08')).toBe(false)
  })
})

describe('G-43 B5 runPss 管线组合', () => {
  it('strict：B 规则 + P 限制一次跑齐 + 自动 drop 插入 + blocksBuild', () => {
    const src = [
      '// @proteus-pss: strict',
      'function handler() {',
      '  const buf = pageContext.alloc(8 * MB)',
      '  const view = buf.borrow()',
      '  globalCache.data = buf', // B-07 error
      '  setTimeout(() => view.get(), 100)', // B-03 borrow 闭包捕获逃逸
      '  const cfg: any = 1', // P1 error
      '}',
    ].join('\n')
    const r = runPss(src)
    expect(r.mode).toBe('strict')
    const rules = r.diagnostics.map((d) => ('rule' in d ? d.rule : ''))
    expect(rules).toContain('B-03') // borrow 闭包捕获逃逸
    expect(rules).toContain('B-07')
    expect(rules).toContain('P1')
    expect(rules).toContain('B-06') // buf 未处置（warning）
    expect(r.blocksBuild).toBe(true) // strict + error
    // autoDrop：buf 未处置 → 插入
    expect(r.insertions.map((i) => i.varName)).toEqual(['buf'])
    expect(r.code).toContain('buf.drop()')
  })

  it('pragma 覆盖全局缺省：文件声明 loose → 不阻断；off → 零诊断', () => {
    const src = ['// @proteus-pss: loose', 'function f() {', '  const buf = pageContext.alloc(1)', '  delete obj.x', '}'].join('\n')
    const r = runPss(src, { mode: 'strict' }) // 全局 strict，文件声明 loose 覆盖
    expect(r.mode).toBe('loose')
    expect(r.blocksBuild).toBe(false) // loose 不阻断
    expect(r.diagnostics.map((d) => d.rule)).not.toContain('P3') // loose 不查 P3

    const off = runPss('const x = 1', { mode: 'off' })
    expect(off.diagnostics).toHaveLength(0)
    expect(off.code).toBe('const x = 1')
  })
})
