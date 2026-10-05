// tests/cse-dynamic.test.ts
// ★★★G-61 B2：**动态 `:class` 预计算单测**（Profile §5 逐条 + 判据②「查表 O(1) 有 profile 证据」）
//
// 【覆盖】
//   ① 候选枚举（§5.4）：对象/数组/三元/逻辑 ✅；标识符/模板插值/计算键/展开 ⇒ **E-CSS-004**
//   ② 互斥组（§5.3）：`{ a: v==='x', b: v==='y' }` 与三元链；**只在可证明时**分组
//   ③ 属性维度分解（§5.2）：取值唯一 ⇒ 不进表；受影响 ⇒ 每属性小表（非 2ⁿ）
//   ④ 爆炸保护（§5.4）：表数 >16 / 取值 >8 警告；候选 >32 error
//   ⑤ ★O(1) profile 证据：Proxy 计次——单次 apply 的**数组读次数 == 字段数**（与表大小/规则数无关）
//   ⑥ 回退语义：位图 0（全不活跃）时写回**静态基线**（旧 resolveDynamicClasses 做不到）
//   ⑦ 互斥压缩统计（stats.compressed：before/after）
import { describe, it, expect } from 'vitest'
import { extractFromSfc, enumerateDynamicClassCandidates, buildDynamicClassPlans } from '@proteus-vue/compiler'
import { applyDynamicClassPlan } from '@proteus-vue/slot-runtime'
import type { DynamicClassPlan } from '@proteus-vue/slot-runtime'

const SFC = `<template>
  <view class="card" :class="{ on: a, big: b }"><text class="label">x</text></view>
</template>
<style>
.card { padding: 8px; color: #333333; background-color: #ffffff }
.on { background-color: #ff0000 }
.big { font-size: 20px }
.static-only { letter-spacing: 3px }
</style>`

function planOf(sfc: string, expr?: string): { plan: DynamicClassPlan; diagnostics: Array<{ level: string; code: string }> } {
  const ex = extractFromSfc(sfc)
  const bindings = expr === undefined ? ex.classBindings : { [Object.keys(ex.classBindings)[0] ?? '0']: expr }
  const { plans, diagnostics } = buildDynamicClassPlans(ex.roots, ex.sheet, bindings, { inlineStyles: ex.inlineStyles })
  const key = Object.keys(plans)[0]
  return { plan: key ? plans[key]! : ({ classes: [], tables: {}, stats: { dynamicProps: 0, maxValues: 0, combos: 0 } } as DynamicClassPlan), diagnostics }
}

describe('★★★G-61 B2 · 候选类枚举（§5.4）', () => {
  it('对象 / 数组 / 三元 / 逻辑 / 模板字面量（无插值）均可枚举', () => {
    expect(enumerateDynamicClassCandidates('{ a: x, b: y }')).toMatchObject({ ok: true, classes: ['a', 'b'] })
    expect(enumerateDynamicClassCandidates("['x', { y: cond }]")).toMatchObject({ ok: true, classes: ['x', 'y'] })
    expect(enumerateDynamicClassCandidates("t ? 'p' : 'q'")).toMatchObject({ ok: true, classes: ['p', 'q'] })
    expect(enumerateDynamicClassCandidates("x && 'z'")).toMatchObject({ ok: true, classes: ['z'] })
    expect(enumerateDynamicClassCandidates("`k-${'x'}`")).toMatchObject({ ok: false }) // 模板（有表达式）⇒ 拒绝
    expect(enumerateDynamicClassCandidates('`lit-tpl`')).toMatchObject({ ok: true, classes: ['lit-tpl'] })
  })

  it('不可枚举形态 ⇒ ok=false（调用方报 E-CSS-004——Profile 的 L5 禁止项）', () => {
    for (const bad of ['someVar', 'obj.cls', "getCls()"]) {
      const r = enumerateDynamicClassCandidates(bad)
      expect(r.ok, bad).toBe(false)
      expect(r.reason, bad).toBeTruthy()
    }
    const ex = extractFromSfc(SFC)
    const { diagnostics } = buildDynamicClassPlans(ex.roots, ex.sheet, { '0': 'someRuntimeVar' }, { inlineStyles: ex.inlineStyles })
    expect(diagnostics.some((d) => d.code === 'E-CSS-004' && d.level === 'error')).toBe(true)
  })
})

describe('★★★G-61 B2 · 互斥分组（§5.3——只在可证明时）', () => {
  it('同源标识符 + 不同字面量 ⇒ 互斥组', () => {
    const r = enumerateDynamicClassCandidates("{ on: v === 'x', off: v === 'y' }")
    expect(r.mutexGroups).toEqual([[0, 1]])
  })

  it('三元两分支 ⇒ 互斥组（含链式）', () => {
    expect(enumerateDynamicClassCandidates("c ? 'a' : 'b'").mutexGroups).toEqual([[0, 1]])
    expect(enumerateDynamicClassCandidates("c ? 'a' : d ? 'b' : 'e'").mutexGroups).toEqual([[0, 1, 2]])
  })

  it('★同字面量（不可证明互斥）⇒ 不分组（宁可不压，不冒错误压缩）', () => {
    expect(enumerateDynamicClassCandidates("{ a: v === 'x', b: v === 'x' }").mutexGroups).toEqual([])
    expect(enumerateDynamicClassCandidates('{ a: x, b: y }').mutexGroups).toEqual([])
  })
})

describe('★★★G-61 B2 · 属性维度分解（§5.2）与回退语义', () => {
  it('每属性小表（非 2ⁿ）；未受影响字段不进表', () => {
    const { plan } = planOf(SFC)
    // 受影响的字段：backgroundColor（on）、fontSize（big）——padding/color 不受影响
    expect(Object.keys(plan.tables).sort()).toEqual(['backgroundColor', 'fontSize'])
    // 每表只 2 项（单 bit 影响），不是 2²=4 组合枚举
    for (const t of Object.values(plan.tables)) expect(t.values.length).toBe(2)
    expect(plan.stats.combos).toBe(4) // 2^1 + 2^1（Σ 口径）
  })

  it('★回退语义：位图 0 写回静态基线（旧 resolveDynamicClasses 只返回激活贡献）', () => {
    const { plan } = planOf(SFC)
    const out: Record<string, unknown> = {}
    applyDynamicClassPlan({}, plan, out)
    expect(out['backgroundColor']).toBe('#ffffff') // 基线（不是 undefined）
    expect(out['fontSize']).toBe(16)
    applyDynamicClassPlan({ on: true }, plan, out)
    expect(out['backgroundColor']).toBe('#ff0000')
    expect(out['fontSize']).toBe(16)
    applyDynamicClassPlan({}, plan, out) // 再切回：字段必须回到基线
    expect(out['backgroundColor']).toBe('#ffffff')
  })

  it('互斥组压缩进 stats（before/after 可观测）', () => {
    const sfc = `<template><view class="c" :class="s === 'a' ? 'x' : 'y'">t</view></template>
<style>.c { color: #111111 } .x { color: #ff0000 } .y { color: #00ff00 }</style>`
    const { plan } = planOf(sfc)
    expect(plan.mutexGroups).toEqual([[0, 1]])
    const t = plan.tables['color']!
    expect(t.kind).toBe('group')
    expect(t.values.length).toBe(3) // 组内 2 类 +"无活跃"——压缩后 3 项（非 4）
    expect(plan.stats.compressed).toEqual({ before: 4, after: 3 })
  })
})

describe('★★★G-61 B2 · 爆炸保护（§5.4）', () => {
  it('表数 > 16 ⇒ warn CSE_DYNCLASS_TABLE_EXPLOSION', () => {
    // 造 17 个不同字段的类（color/背景/各边 margin+padding… 用 margin 简写展开出 4 边）
    const decls = ['color: #ff0000', 'background-color: #00ff00', 'opacity: 0.5', 'font-size: 20px', 'margin: 1px', 'padding: 2px', 'letter-spacing: 1px', 'font-weight: 700', 'border-top-width: 2px', 'border-left-width: 2px', 'border-right-width: 2px', 'border-bottom-width: 2px', 'flex-grow: 2', 'flex-shrink: 0', 'row-gap: 4px', 'column-gap: 5px', 'text-align: center', 'display: flex'].join('; ')
    const sfc = `<template><view class="c" :class="{ big: x }">t</view></template><style>.c { color: #111111 } .big { ${decls} }</style>`
    const { diagnostics } = planOf(sfc)
    expect(diagnostics.some((d) => d.code === 'CSE_DYNCLASS_TABLE_EXPLOSION' && d.level === 'warn')).toBe(true)
  })

  it('单表取值 > 8 ⇒ warn CSE_DYNCLASS_VALUE_EXPLOSION', () => {
    // 10 个动态类都改 color ⇒ 2^10 = 1024 取值
    const cls = Array.from({ length: 10 }, (_, i) => `.c${i} { color: #0000${(10 + i).toString(16)} }`).join('\n')
    const obj = `{ ${Array.from({ length: 10 }, (_, i) => `c${i}: v${i}`).join(', ')} }`
    const sfc = `<template><view class="c" :class="${obj}">t</view></template><style>.c { color: #111111 } ${cls}</style>`
    const { diagnostics } = planOf(sfc)
    expect(diagnostics.some((d) => d.code === 'CSE_DYNCLASS_VALUE_EXPLOSION' && d.level === 'warn')).toBe(true)
  })

  it('候选 > 32 ⇒ error（位图上限）', () => {
    const names = Array.from({ length: 33 }, (_, i) => `k${i}`)
    const sfc = `<template><view class="c" :class="{ ${names.map((n) => `${n}: x`).join(', ')} }">t</view></template><style>.c { color: #111111 }</style>`
    const { diagnostics } = planOf(sfc)
    expect(diagnostics.some((d) => d.code === 'CSE_DYNCLASS_BITMAP_OVERFLOW' && d.level === 'error')).toBe(true)
  })

  it('祖先段含动态类（.on .child）⇒ warn（如实：B2 v1 不覆盖后代影响）', () => {
    const sfc = `<template><view class="c" :class="{ on: x }"><text class="child">t</text></view></template>
<style>.c { color: #111111 } .on { color: #ff0000 } .on .child { letter-spacing: 5px }</style>`
    const { diagnostics } = planOf(sfc)
    expect(diagnostics.some((d) => d.code === 'CSE_DYNCLASS_DESCENDANT_UNSUPPORTED' && d.level === 'warn')).toBe(true)
  })
})

describe('★★★G-61 B2 · 判据② O(1) profile 证据（Proxy 计次）', () => {
  it('★单次 apply 的数组索引次数 == 字段数（与表大小 / 位图位数无关）', () => {
    // 大表场景：8 位影响同一字段 ⇒ 表 2^8 = 256 项；若实现是"扫描/匹配"，读次数会随之增长
    const cls = Array.from({ length: 8 }, (_, i) => `.c${i} { color: #00000${i} }`).join('\n')
    const obj = `{ ${Array.from({ length: 8 }, (_, i) => `c${i}: v${i}`).join(', ')} }`
    const sfc = `<template><view class="c" :class="${obj}">t</view></template><style>.c { color: #111111 } ${cls}</style>`
    const { plan } = planOf(sfc)
    expect(plan.tables['color']!.values.length).toBe(256) // 大表确实建出来了
    // Proxy 计次：包住 values 与 map 观测读取次数
    let reads = 0
    const instrumented: DynamicClassPlan = {
      ...plan,
      tables: Object.fromEntries(
        Object.entries(plan.tables).map(([k, t]) => [
          k,
          {
            ...t,
            values: new Proxy(t.values, {
              get(target, prop, recv) {
                if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++
                return Reflect.get(target, prop, recv)
              },
            }),
          },
        ]),
      ),
    }
    for (const v of [{}, { c0: true }, { c0: true, c3: true }, { c0: true, c3: true, c7: true }]) {
      const before = reads
      const out: Record<string, unknown> = {}
      const applied = applyDynamicClassPlan(v, instrumented, out)
      expect(reads - before, `组合 ${JSON.stringify(v)}：读次数应 == 字段数 ${applied}`).toBe(applied)
      expect(applied).toBe(1) // 本用例只有 color 一个字段
    }
    // 且总读次数 ≤ 组合数 × 字段数（无任何"表内扫描"）
    expect(reads).toBe(4)
  })
})
