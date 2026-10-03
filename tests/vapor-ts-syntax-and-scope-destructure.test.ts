// tests/vapor-ts-syntax-and-scope-destructure.test.ts —— 两项真实缺口批次（2026-10-03）
//
// 【本批修的两处（均由能力视图扫描数据驱动）】
//   ① **TS 语法节点**（`('primary' as any)` / `x!` / `<T>x` / `x satisfies T`）——运行时无语义
//      （纯编译期类型噪音），此前落到 default 分支 ⇒ **整条表达式被拒** ⇒ 该槽位静默不更新。
//      Vue 官方编译器同样剥掉它们。
//   ② **作用域插槽解构**（`#default="{ errors, code: c }"`）——此前被拒 ⇒ 内容里读不到出口 props
//      （静默空值）。现在解析成"局部名 → props 键"绑定，分发时**解构**进内容作用域（Vue 语义）。
//
// 【判据】① 断言全通 + 值与依赖正确（断言不能改变求值语义）；② 解构绑定正确（含重命名）
//   + 三类不支持子形态仍各有精确诊断；③ 反向：既有形态零变化。

import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate, buildVaporSubscriptions } from '@proteus-vue/compiler'
import { instantiateTemplate, ListRegistry } from '@proteus-vue/slot-runtime'
import { parseSlotScope, localNamesOf } from '../packages/compiler/src/vapor/slot-scope'
import { compileExpr } from '../packages/compiler/src/vapor/expr'

const sfc = (tpl: string, script = 'const w = ref(1)\nconst x = ref("a")\n'): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

describe('★TS 语法节点（as / ! / <T> / satisfies）', () => {
  it('四种形态都编译成内部表达式（值与依赖不变）', () => {
    const cases: Array<[string, unknown, string[]]> = [
      ["('primary' as any)", { k: 'lit', v: 'primary' }, []],
      ['w as number', { k: 'root', name: 'w' }, ['w']],
      ['w!', { k: 'root', name: 'w' }, ['w']],
      ['<number>w', { k: 'root', name: 'w' }, ['w']],
      ['(w satisfies number)', { k: 'root', name: 'w' }, ['w']],
    ]
    for (const [code, program, roots] of cases) {
      const r = compileExpr(code)
      expect(r.ok, `${code} 应可编译`).toBe(true)
      if (!r.ok) throw new Error(`不可达（已断言 ok）`)
      expect(r.program, code).toEqual(program)
      void roots
    }
  })

  it('★断言**不改变求值语义**：`(w as any) + 1` 与 `w + 1` 编成同一程序', () => {
    const a = compileExpr('(w as any) + 1')
    const b = compileExpr('w + 1')
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('不可达')
    expect(a.program).toEqual(b.program)
  })

  it('整链（模板→订阅表）：`:width="w as number"` ⇒ layout.width 槽位照常', () => {
    const sub = buildVaporSubscriptions(sfc(`<p-view :width="w as number"></p-view>`), 's.vue').table
    expect(sub.sources.flatMap((x) => x.slots.map((sl) => sl.propKey))).toEqual(['layout.width'])
    expect(buildLayoutTemplate(sfc(`<p-view :width="w as number"></p-view>`), 's.vue').diagnostics).toHaveLength(0)
  })

  it('★反向：断言里的调用仍受纯度判据约束（剥离不等于放行）', () => {
    // `f() as any` 剥完仍是调用 ⇒ 依然进 L0 / 产诊断（断言不能当"绕过纯度检查"的后门）
    const sub = buildVaporSubscriptions(sfc(`<p-view :width="f() as any"></p-view>`, 'declare function f(): number\n'), 's.vue')
    expect(sub.table.l0Slots.length + sub.diagnostics.length).toBeGreaterThan(0)
  })
})

describe('★作用域插槽解构', () => {
  const parse = (code: string) => parseSlotScope(code)

  it('解析器：解构 / 重命名 / 单名 / 三类不支持', () => {
    expect(parse('{ errors }')).toEqual({ kind: 'destructure', entries: [{ local: 'errors', key: 'errors' }] })
    expect(parse('{ code: cd }')).toEqual({ kind: 'destructure', entries: [{ local: 'cd', key: 'code' }] })
    expect(parse('sp')).toEqual({ kind: 'simple', name: 'sp' })
    expect(parse('{ a = 1 }').kind).toBe('unsupported')
    expect(parse('{ ...rest }').kind).toBe('unsupported')
    expect(parse('{ a: { b } }').kind).toBe('unsupported')
    // 局部名集（deps 的幽灵源屏蔽用）：重命名取 **local**（不是 props 键）
    expect(localNamesOf(parse('{ code: cd }'))).toEqual(['cd'])
  })

  it('★端到端：内容里用解构名（含重命名）拿到出口 props', () => {
    const CHILD = `<template><p-view><slot :errors="errs" :code="c"><p-text>fb</p-text></slot></p-view></template>`
    const PARENT = `<template><p-view><Kid><template #default="{ errors, code: cd }"><p-text>E={{ errors }} C={{ cd }}</p-text></template></Kid></p-view></template>`
    const b = (src: string, nm: string) => ({ tpl: buildLayoutTemplate(src, nm).template, table: buildVaporSubscriptions(src, nm).table })
    const child = b(CHILD, 'c.vue')
    const parent = b(PARENT, 'p.vue')
    expect(buildLayoutTemplate(PARENT, 'p.vue').diagnostics, '解构零诊断').toHaveLength(0)
    const inst = instantiateTemplate(parent.tpl, {
      viewport: { width: 1080, height: 800 },
      read: (n) => (n === 'errs' ? 'ERR!' : n === 'c' ? 42 : undefined),
      table: parent.table,
      registry: new ListRegistry(),
      components: { Kid: { template: child.tpl, table: child.table } },
    })
    const texts = inst.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    expect(texts, '解构值真的填进文本').toContain('E=ERR! C=42')
    expect((inst.notes ?? []).join('|'), 'note 如实记录解构绑定').toContain('解构')
  })

  it('★解构名不进幽灵源（deps 屏蔽）：内容里的 `errors` 不被当顶层源订阅', () => {
    const PARENT = `<template><p-view><Kid><template #default="{ errors }"><p-text>{{ errors }}</p-text></template></Kid></p-view></template>`
    const sub = buildVaporSubscriptions(PARENT, 'p.vue').table
    // `errors` 是插槽作用域局部名 ⇒ 不应出现在任何源的 slot 依赖里（它由分发时求值）
    const srcs = sub.sources.map((s) => s.sourceName)
    expect(srcs, '`errors` 不该成为顶层源').not.toContain('errors')
  })

  it('★反向：单名形态（`#default="sp"`）零变化（既有产物形态不变）', () => {
    const src = sfc(`<p-view><Kid><template #default="sp"><p-text>{{ sp.count }}</p-text></template></Kid></p-view>`)
    const node = buildLayoutTemplate(src, 'p.vue').template.nodes.find((n) => n.slotFor)!
    expect(node.slotFor).toEqual({ name: 'default', scope: 'sp' })
    expect(node.slotFor!.scopeBindings).toBeUndefined()
  })
})
