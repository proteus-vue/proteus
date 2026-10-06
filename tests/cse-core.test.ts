// tests/cse-core.test.ts
// ★★★G-61 B1：**CSE 内核单测**（收集/索引/匹配/五级层叠/继承/计算值）
//
// 【本文件测什么（逐条对应 plan `02-style-ir-contract.md` P3 与 Profile §4.2 七步）】
//   ① 解析：长手展开（margin/padding/inset/gap/border-radius/border/flex/overflow）
//   ② 匹配：类/元素/id/通配 + 后代/子组合 + 结构伪类 + :not + :deep 展开；不支持形态计数（不静默）
//   ③ 层叠：**五级**逐级——importance > @layer（含 important 反转）> specificity > order
//   ④ 长手竞争（本引擎的核心正确性）：`margin: 0` + 后写 `margin-top: 5px` ⇒ top=5 其余 0
//   ⑤ 继承：color/font-size/font-weight/line-height（含**因子 vs 绝对**的经典坑）；text-decoration **不继承**
//   ⑥ 计算值：em（font-size 自身取父 / 其余取自身）· rem · % · vw/vh/rpx · CSS 宽关键字 · currentColor · var()
//   ⑦ IR 映射：ResolvedLength 三态（absolute/ratio/auto）+ 颜色 #rrggbb[aa] + 逐角圆角合并
//   ⑧ trace：逐字段 from（选择器 + 层 + 特异性 + 源序）——`proteus explain` 的载体
//
// ★纪律：本文件的 CSS 串**只用 kebab-case**（CSS 语法；camelCase 属性在浏览器里是"被忽略的非法声明"
//   ——旧折叠通路接受它是 Web 偏差，CSE 按标准拒绝；`computeLength` 等 API 的 prop 参数同为 kebab）。
import { describe, it, expect } from 'vitest'
import { parseStyleSheet, computeTree, computeColor, computeLength, substituteVars, foldCalc, layerContextOf, explainLayerPrecedence } from '@proteus-vue/compiler'
import type { CseNode } from '@proteus-vue/compiler'

/** 造节点树（兄弟序由 computeTree 重算；这里给初值） */
function node(tag: string, classes: string[], children: CseNode[] = [], id?: string): CseNode {
  return { key: id ?? `${tag}.${classes.join('.')}#${Math.random().toString(36).slice(2, 7)}`, tag, classes, id, index: 0, count: 1, children }
}

/** 便捷：解析 + 计算单节点 */
function compute(css: string, n: CseNode, opts?: Parameters<typeof computeTree>[2]) {
  const sheet = parseStyleSheet(css)
  return computeTree([n], sheet, opts)
}

describe('★★★G-61 B1 · CSE 解析（长手展开）', () => {
  it('margin 四值展开 + 长手直写', () => {
    const sheet = parseStyleSheet('.a { margin: 1px 2px 3px 4px }')
    const decls = sheet.rules[0]!.decls
    expect(decls.map((d) => `${d.prop}=${d.value}`)).toEqual(['margin-top=1px', 'margin-right=2px', 'margin-bottom=3px', 'margin-left=4px'])
    expect(decls[0]!.fromShorthand).toBe('margin')
  })

  it('border-radius / border / gap / overflow / flex', () => {
    const s = parseStyleSheet('.a { border-radius: 4px 8px; border: 1px solid #ccc; gap: 8px 12px; overflow: hidden; flex: 1 1 auto }')
    const props = s.rules[0]!.decls.map((d) => d.prop)
    expect(props).toContain('border-top-left-radius')
    expect(props).toContain('border-top-right-radius')
    expect(props).toContain('border-top-width')
    expect(props).toContain('border-left-color')
    expect(props).toContain('row-gap')
    expect(props).toContain('column-gap')
    expect(props).toContain('overflow-x')
    expect(props).toContain('overflow-y')
    expect(props).toContain('flex-basis')
  })

  it('@layer 收集顺序（语句 + 块）', () => {
    const s = parseStyleSheet('@layer base, theme;\n@layer theme { .a { color: red } }\n@layer base { .a { color: blue } }')
    expect(s.layerOrder).toEqual(['base', 'theme'])
    expect(s.rules.find((r) => r.layer === 'theme')).toBeTruthy()
  })

  it('不支持形态计数（@media / 状态伪类）——不静默', () => {
    const s = parseStyleSheet('.a { color: red } @media (min-width: 100px) { .b { color: blue } } .c:hover { color: green }')
    expect(s.rules.length).toBe(1)
    expect(s.skipped.some((x) => x.kind === 'at-rule' && x.detail.includes('@media'))).toBe(true)
    expect(s.skipped.some((x) => x.kind === 'selector' && x.detail.includes(':hover'))).toBe(true)
  })
})

describe('★★★G-61 B1 · CSE 匹配', () => {
  it('类 / 元素 / id / 通配 / 复合', () => {
    const css = '.a { color: #111111 } div { color: #222222 } #x { color: #333333 } * { opacity: 0.5 } .a.b { font-weight: 700 }'
    const n = node('div', ['a', 'b'], [], 'x')
    const r = compute(css, n)
    const c = r.byKey[n.key]!.fields
    expect(c['color']).toBe('#333333') // id 特异性最高
    expect(c['opacity']).toBe(0.5)
    expect(c['fontWeight']).toBe(700)
  })

  it('后代 + 子组合 + 结构伪类 + :not + :deep', () => {
    const child = node('span', ['leaf'])
    const mid = node('div', [], [child])
    const root = node('div', ['wrap'], [mid])
    const css = [
      '.wrap span { color: #010101 }',
      '.wrap > div > span { background-color: #020202 }',
      '.leaf:first-child { opacity: 0.3 }',
      '.leaf:not(.x) { letter-spacing: 2px }',
      ':deep(.leaf) { font-weight: 600 }',
    ].join('\n')
    const r = compute(css, root)
    const leaf = r.byKey[child.key]!.fields
    expect(leaf['backgroundColor']).toBe('#020202')
    expect(leaf['opacity']).toBe(0.3)
    expect(leaf['letterSpacing']).toBe(2)
    expect(leaf['fontWeight']).toBe(600)
  })

  it('结构伪类边界：:last-child / :nth-child(2) / :not(:first-child)', () => {
    const kids = [node('div', []), node('div', []), node('div', [])]
    const root = node('div', [], kids)
    const r = compute(
      'div:last-child { opacity: 0.7 }\n:first-child { color: #111111 }\ndiv:nth-child(2) { font-weight: 500 }\n:not(:first-child) { letter-spacing: 1px }',
      root,
    )
    expect(r.byKey[kids[2]!.key]!.fields['opacity']).toBe(0.7)
    expect(r.byKey[kids[0]!.key]!.fields['color']).toBe('#111111')
    expect(r.byKey[kids[1]!.key]!.fields['fontWeight']).toBe(500)
    expect(r.byKey[kids[2]!.key]!.fields['letterSpacing']).toBe(1)
    expect(r.byKey[kids[0]!.key]!.fields['letterSpacing']).toBeUndefined() // :not(:first-child) ⇒ 首元素不命中
  })
})

describe('★★★G-61 B1 · CSE 五级层叠', () => {
  it('① !important 胜过特异性', () => {
    const n = node('div', ['a', 'b'])
    const r = compute('.a.b { color: #111111 }\n.a { color: #222222 !important }', n)
    expect(r.byKey[n.key]!.fields['color']).toBe('#222222')
  })

  it('② @layer：普通后层胜、important 先层胜（反转）', () => {
    const n1 = node('div', ['a'])
    const r1 = compute('@layer base, theme;\n@layer base { .a { color: #111111 } }\n@layer theme { .a { color: #222222 } }', n1)
    expect(r1.byKey[n1.key]!.fields['color']).toBe('#222222') // theme 后声明 ⇒ 普通胜
    const n2 = node('div', ['a'])
    const r2 = compute('@layer base, theme;\n@layer base { .a { color: #111111 !important } }\n@layer theme { .a { color: #222222 !important } }', n2)
    expect(r2.byKey[n2.key]!.fields['color']).toBe('#111111') // base 先声明 ⇒ important 胜
  })

  it('② 无层声明：普通高于所有层 / important 低于所有层（CSS 规定）', () => {
    const n1 = node('div', ['a'])
    const r1 = compute('@layer base;\n@layer base { .a { color: #111111 } }\n.a { color: #222222 }', n1)
    expect(r1.byKey[n1.key]!.fields['color']).toBe('#222222') // 无层普通胜
    const n2 = node('div', ['a'])
    const r2 = compute('@layer base;\n@layer base { .a { color: #111111 !important } }\n.a { color: #222222 !important }', n2)
    expect(r2.byKey[n2.key]!.fields['color']).toBe('#111111') // 无层 important 最弱
  })

  it('③ 特异性 (id, class, tag) 字典序', () => {
    const n = node('div', ['cn'], [], 'id1')
    const r = compute('div { color: #010101 }\n.cn { color: #020202 }\n#id1 { color: #030303 }', n)
    expect(r.byKey[n.key]!.fields['color']).toBe('#030303')
  })

  it('④ 源序：同特异性后写胜', () => {
    const n = node('div', ['a'])
    const r = compute('.a { color: #111111 }\n.a { color: #222222 }', n)
    expect(r.byKey[n.key]!.fields['color']).toBe('#222222')
  })

  it('★长手竞争（本引擎核心正确性）：margin 与 margin-top 按长手竞争', () => {
    const n1 = node('div', ['a'])
    const r1 = compute('.a { margin: 0; margin-top: 5px }', n1)
    expect(r1.byKey[n1.key]!.fields['marginTop']).toEqual({ kind: 'absolute', dp: 5 })
    expect(r1.byKey[n1.key]!.fields['marginLeft']).toEqual({ kind: 'absolute', dp: 0 })
    const n2 = node('div', ['a'])
    const r2 = compute('.a { margin-top: 5px; margin: 0 }', n2)
    expect(r2.byKey[n2.key]!.fields['marginTop']).toEqual({ kind: 'absolute', dp: 0 })
    const n3 = node('div', ['a', 'b'])
    const r3 = compute('.a { margin: 0 }\n.a.b { margin-top: 5px }', n3)
    expect(r3.byKey[n3.key]!.fields['marginTop']).toEqual({ kind: 'absolute', dp: 5 })
  })

  it('inline style（opts.inlineStyles）胜过选择器普通声明', () => {
    const n = node('div', ['a'])
    const sheet = parseStyleSheet('.a { color: #111111 }')
    const r = computeTree([n], sheet, { inlineStyles: { [n.key]: [{ prop: 'color', value: '#999999' }] } })
    expect(r.byKey[n.key]!.fields['color']).toBe('#999999')
  })
})

describe('★★★G-61 B1 · CSE 继承', () => {
  it('color / font-size / font-weight 沿树传播', () => {
    const leaf = node('span', [])
    const root = node('div', ['wrap'], [leaf])
    const r = compute('.wrap { color: #123456; font-size: 20px; font-weight: 600 }', root)
    expect(r.byKey[leaf.key]!.fields['color']).toBe('#123456')
    expect(r.byKey[leaf.key]!.fields['fontSize']).toBe(20)
    expect(r.byKey[leaf.key]!.fields['fontWeight']).toBe(600)
    expect(r.byKey[leaf.key]!.trace['color']!.via).toBe('inherited')
  })

  it('★line-height：无单位因子按后代自身 font-size 重算；px 则为绝对继承', () => {
    const a = node('span', [])
    const root = node('div', ['wrap'], [a])
    const r1 = compute('.wrap { font-size: 10px; line-height: 1.5 }', root)
    expect(r1.byKey[a.key]!.fields['lineHeight']).toBe(15) // 10 × 1.5
    const b = node('span', [])
    const root2 = node('div', ['wrap2'], [b])
    const r2 = compute('.wrap2 { font-size: 10px; line-height: 15px }', root2)
    expect(r2.byKey[b.key]!.fields['lineHeight']).toBe(15)
    // 子覆盖 font-size：因子重算（20 × 1.5 = 30）
    const a2 = node('span', ['small'])
    const root3 = node('div', ['wrap'], [a2])
    const r3 = compute('.wrap { font-size: 10px; line-height: 1.5 }\n.small { font-size: 20px }', root3)
    expect(r3.byKey[a2.key]!.fields['lineHeight']).toBe(30)
  })

  it('★text-decoration 不继承（CSS：装饰靠传播画，子元素 computed 无它）', () => {
    const leaf = node('span', [])
    const root = node('div', ['wrap'], [leaf])
    const r = compute('.wrap { text-decoration: underline }', root)
    expect(r.byKey[root.key]!.fields['textDecoration']).toBe('underline')
    expect(r.byKey[leaf.key]!.fields['textDecoration']).toBeUndefined()
  })

  it('显式 inherit 关键字取父值', () => {
    const leaf = node('span', ['in'])
    const root = node('div', ['wrap'], [leaf])
    const r = compute('.wrap { color: #ff0000 }\n.in { color: inherit }', root)
    expect(r.byKey[leaf.key]!.fields['color']).toBe('#ff0000')
  })

  it('visibility 继承传播', () => {
    const leaf = node('span', [])
    const root = node('div', ['wrap'], [leaf])
    const r = compute('.wrap { visibility: hidden }', root)
    expect(r.byKey[leaf.key]!.fields['visibility']).toBe('hidden')
  })
})

describe('★★★G-61 B1 · CSE 计算值', () => {
  it('em：font-size 自身按父；其余按自身（CSS 规则）', () => {
    const leaf = node('span', ['in'])
    const root = node('div', ['wrap'], [leaf])
    const r = compute('.wrap { font-size: 20px }\n.in { font-size: 1.5em; margin-top: 2em }', root)
    expect(r.byKey[leaf.key]!.fields['fontSize']).toBe(30) // 1.5 × 父 20
    expect(r.byKey[leaf.key]!.fields['marginTop']).toEqual({ kind: 'absolute', dp: 60 }) // 2 × 自身 30
  })

  it('rem / vw / vh / rpx', () => {
    const n = node('div', ['a'])
    const r = compute('.a { margin-top: 2rem; margin-left: 10vw; margin-right: 10vh; margin-bottom: 75rpx }', n, {
      viewport: { width: 390, height: 844 },
      rootFontSize: 16,
    })
    expect(r.byKey[n.key]!.fields['marginTop']).toEqual({ kind: 'absolute', dp: 32 })
    expect(r.byKey[n.key]!.fields['marginLeft']).toEqual({ kind: 'absolute', dp: 39 })
    expect(r.byKey[n.key]!.fields['marginRight']).toEqual({ kind: 'absolute', dp: 84.4 })
    expect(r.byKey[n.key]!.fields['marginBottom']).toEqual({ kind: 'absolute', dp: 39 })
  })

  it('%：width → ratio(parentWidth)；font-size 的 % 可绝对化；padding % 基准 = 父宽', () => {
    const n = node('div', ['a'])
    const r = compute('.a { width: 50%; padding-left: 10%; font-size: 120% }', n)
    expect(r.byKey[n.key]!.fields['width']).toEqual({ kind: 'ratio', ratio: 0.5, base: 'parentWidth' })
    expect(r.byKey[n.key]!.fields['paddingLeft']).toEqual({ kind: 'ratio', ratio: 0.1, base: 'parentWidth' })
    expect(r.byKey[n.key]!.fields['fontSize']).toBe(16 * 1.2)
  })

  it('颜色归一：hex3/hex8/rgb/rgba/hsl/命名色/transparent', () => {
    expect(computeColor('#abc')).toBe('#aabbcc')
    expect(computeColor('#11223344')).toBe('#11223344')
    expect(computeColor('rgb(255, 0, 0)')).toBe('#ff0000')
    expect(computeColor('rgba(255, 0, 0, 0.5)')).toBe('#ff000080')
    expect(computeColor('hsl(120, 100%, 50%)')).toBe('#00ff00')
    expect(computeColor('red')).toBe('#ff0000')
    expect(computeColor('transparent')).toBe('#00000000')
  })

  it('currentColor → 自身 color 求值', () => {
    const n = node('div', ['a'])
    const r = compute('.a { color: #123456; border-top-color: currentColor }', n)
    expect(r.byKey[n.key]!.fields['borderTopColor']).toBe('#123456')
  })

  it('var()：定义 + fallback；未定义无 fallback ⇒ 诊断', () => {
    const n = node('div', ['a'])
    const r = compute(':root, .a { --brand: #ff0000 }\n.a { color: var(--brand); margin-top: var(--m, 4px); margin-left: var(--nope) }', n)
    expect(r.byKey[n.key]!.fields['color']).toBe('#ff0000')
    expect(r.byKey[n.key]!.fields['marginTop']).toEqual({ kind: 'absolute', dp: 4 })
    expect(r.diagnostics.some((d) => d.code === 'CSE_VALUE_INVALID' && d.message.includes('margin-left'))).toBe(true)
  })

  it('CSS 宽关键字：unset（可继承 ⇒ 继承；不可继承 ⇒ initial）', () => {
    const leaf = node('span', ['in'])
    const root = node('div', ['wrap'], [leaf])
    const r = compute('.wrap { color: #ff0000; opacity: 0.5 }\n.in { color: unset; opacity: initial }', root)
    expect(r.byKey[leaf.key]!.fields['color']).toBe('#ff0000')
    expect(r.byKey[leaf.key]!.fields['opacity']).toBe(1)
  })

  it('★★★calc() 完整算术（2026-10-08 · css:next）：`+ - * /` 与括号 + env(safe-area) fallback——与 App 折叠面同口径（共享 calc-fold.ts）', () => {
    expect(foldCalc('calc(8px * 0.6)')).toBe('4.8px')
    expect(foldCalc('calc(2 * 8px)')).toBe('16px')
    expect(foldCalc('calc(100px / 4)')).toBe('25px')
    expect(foldCalc('calc((10px + 5px) * 2)')).toBe('30px')
    expect(foldCalc('calc(136px + env(safe-area-inset-bottom, 0px))')).toBe('136px')
    expect(foldCalc('calc(100% - 20px)')).toBeNull()   // 含 % ⇒ 不可折
    const n = node('div', ['a'])
    const r = compute('.a { width: calc(8px * 0.6) }', n)
    expect(r.byKey[n.key]!.fields['width']).toEqual({ kind: 'absolute', dp: 4.8 })
  })
  it('calc 单层常量化；不支持的 calc ⇒ 诊断', () => {
    expect(foldCalc('calc(10px + 5px)')).toBe('15px')
    expect(foldCalc('calc(100% - 20px)')).toBeNull()
    const n = node('div', ['a'])
    const r = compute('.a { margin-top: calc(10px + 5px); margin-left: calc(100% - 20px) }', n)
    expect(r.byKey[n.key]!.fields['marginTop']).toEqual({ kind: 'absolute', dp: 15 })
    expect(r.diagnostics.some((d) => d.code === 'CSE_VALUE_UNSUPPORTED')).toBe(true)
  })

  it('★★★min()/max()/clamp() 常量化（2026-10-08 · css:next P0）——全参数绝对化 ⇒ 折 px；含相对单位 ⇒ 诊断（不静默丢）', () => {
    const n = node('div', ['a'])
    const r = compute(
      '.a { width: clamp(100px, 150px, 200px); min-height: min(80px, 120px); padding-top: max(4px, 8px) }',
      n,
    )
    const f = r.byKey[n.key]!.fields
    expect(f['width']).toEqual({ kind: 'absolute', dp: 150 })   // clamp(100,150,200) = 150
    expect(f['minHeight']).toEqual({ kind: 'absolute', dp: 80 })  // min(80,120) = 80
    expect(f['paddingTop']).toEqual({ kind: 'absolute', dp: 8 }) // max(4,8) = 8
    // 嵌套 calc / 嵌套 min 亦可折
    const r2 = compute('.a { width: min(calc(10px + 5px), 40px) }', node('div', ['a']))
    expect(Object.values(r2.byKey)[0]!.fields['width']).toEqual({ kind: 'absolute', dp: 15 })
    // 含相对单位（% / vw）⇒ UNSUPPORTED（诚实不猜——与浏览器 used-value 不同阶段）
    const r3 = compute('.a { width: clamp(64px, 22%, 132px) }', n)
    expect(r3.diagnostics.some((d) => d.code === 'CSE_VALUE_UNSUPPORTED')).toBe(true)
  })
  it('var 替换函数独立语义（含 fallback 与嵌套）', () => {
    const vars = new Map([['--a', '#fff'], ['--b', 'var(--a)']])
    expect(substituteVars('var(--a)', vars)).toBe('#fff')
    expect(substituteVars('var(--b)', vars)).toBe('#fff')
    expect(substituteVars('var(--x, 3px)', vars)).toBe('3px')
    expect(substituteVars('var(--x)', vars)).toBeNull()
  })

  it('computeLength：pt 按 CSS 4/3（与旧通路的 1:1 已知差异——登记在案）', () => {
    const ctx = { fontSize: 16, parentFontSize: 16, rootFontSize: 16, viewport: { width: 390, height: 844 } }
    expect(computeLength('margin-top', '12pt', ctx)).toEqual({ px: 16 })
    expect(computeLength('width', '50%', ctx)).toEqual({ ratio: 0.5, base: 'parentWidth' })
    expect(computeLength('width', 'auto', ctx)).toEqual({ keyword: 'auto' })
  })
})

describe('★★★G-61 B1 · CSE 字段映射与 trace', () => {
  it('ResolvedLength 三态 + 颜色 + 枚举落 IR 字段名', () => {
    const n = node('div', ['a'])
    const r = compute('.a { width: 320px; height: 40%; margin-top: auto; color: #112233; display: flex; opacity: 0.8 }', n)
    const f = r.byKey[n.key]!.fields
    expect(f['width']).toEqual({ kind: 'absolute', dp: 320 })
    expect(f['height']).toEqual({ kind: 'ratio', ratio: 0.4, base: 'parentHeight' })
    expect(f['marginTop']).toEqual({ kind: 'auto' })
    expect(f['color']).toBe('#112233')
    expect(f['display']).toBe('flex')
    expect(f['opacity']).toBe(0.8)
  })

  it('逐角圆角合并（等值 ⇒ 统一半径；部分非零 ⇒ 统一 + 掩码；四角各异 ⇒ unmapped）', () => {
    const n1 = node('div', ['a'])
    const r1 = compute('.a { border-radius: 12px }', n1)
    expect(r1.byKey[n1.key]!.fields['borderRadius']).toBe(12)
    expect(r1.byKey[n1.key]!.fields['borderRadiusCorners']).toBeUndefined()
    const n2 = node('div', ['b'])
    const r2 = compute('.b { border-radius: 12px 12px 0 0 }', n2)
    expect(r2.byKey[n2.key]!.fields['borderRadius']).toBe(12)
    expect(r2.byKey[n2.key]!.fields['borderRadiusCorners']).toEqual({ topLeft: true, topRight: true, bottomRight: false, bottomLeft: false })
    const n3 = node('div', ['c'])
    const r3 = compute('.c { border-radius: 50% }', n3)
    expect(r3.byKey[n3.key]!.fields['borderRadiusPct']).toBe(0.5)
    const n4 = node('div', ['d'])
    const r4 = compute('.d { border-radius: 4px 8px 12px 16px }', n4)
    expect(r4.byKey[n4.key]!.fields['borderRadius']).toBeUndefined()
    expect(r4.byKey[n4.key]!.unmapped.length).toBeGreaterThan(0)
  })

  it('★★★overflow-x 项：逐轴字段 + Web 归一回放（x==y 附发 overflow）', () => {
    // 两侧同值 ⇒ 逐轴字段 + 附发统一 overflow（引擎面语义兼容；零 churn）
    const n1 = node('div', ['a'])
    const r1 = compute('.a { overflow: hidden }', n1)
    expect(r1.byKey[n1.key]!.fields['overflow']).toBe('hidden')
    expect(r1.byKey[n1.key]!.fields['overflowX']).toBe('hidden')
    expect(r1.byKey[n1.key]!.fields['overflowY']).toBe('hidden')
    // x≠y ⇒ 逐轴字段（无 unmapped——已实现）；不再发统一 overflow
    const n2 = node('div', ['b'])
    const r2 = compute('.b { overflow-x: hidden; overflow-y: auto }', n2)
    expect(r2.byKey[n2.key]!.fields['overflow']).toBeUndefined()
    expect(r2.byKey[n2.key]!.fields['overflowX']).toBe('hidden')
    expect(r2.byKey[n2.key]!.fields['overflowY']).toBe('auto')
    expect(r2.byKey[n2.key]!.unmapped.some((u) => u.prop.startsWith('overflow'))).toBe(false)
    // ★Web 归一回放（真 Chromium 实测）：单轴 hidden ⇒ 另一轴 visible→auto
    const n3 = node('div', ['c'])
    const r3 = compute('.c { overflow-x: hidden }', n3)
    expect(r3.byKey[n3.key]!.fields['overflowX']).toBe('hidden')
    expect(r3.byKey[n3.key]!.fields['overflowY']).toBe('auto')
    // \`clip\` 无内核对应 ⇒ 如实记 unmapped（不静默取近似值）
    const n4 = node('div', ['d'])
    const r4 = compute('.d { overflow-x: clip; overflow-y: hidden }', n4)
    expect(r4.byKey[n4.key]!.unmapped.some((u) => u.prop.startsWith('overflow'))).toBe(true)
  })

  it('trace：逐字段可溯源（选择器 + 层 + 特异性 + 源序 + 简写来源）', () => {
    const n = node('div', ['a'])
    const r = compute('@layer ui;\n@layer ui { .a { margin: 0 } }\n.a { margin-top: 5px !important }', n)
    const t = r.byKey[n.key]!.trace['marginTop']!
    expect(t.from!.selector).toBe('.a')
    expect(t.from!.important).toBe(true)
    const tLeft = r.byKey[n.key]!.trace['marginLeft']!
    expect(tLeft.from!.layer).toBe('ui')
    expect(tLeft.from!.fromShorthand).toBe('margin')
  })

  it('explainLayerPrecedence：important 反转可读断言', () => {
    const ctx = layerContextOf(['base', 'theme'])
    expect(explainLayerPrecedence(ctx, ['base', 'theme', null], false)).toEqual([null, 'theme', 'base'])
    expect(explainLayerPrecedence(ctx, ['base', 'theme', null], true)).toEqual(['base', 'theme', null])
  })
})
