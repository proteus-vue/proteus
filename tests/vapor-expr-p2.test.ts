// tests/vapor-expr-p2.test.ts —— ★★P2-6~P2-9（2026-10-03）：v-text / 动态属性 / 纯函数白名单 / 可选链
//
// 【这一批补的是什么】能力清单 P2 段的最后四项语法完整性缺口：
//   · P2-6 v-text（真支持；v-html 仍不支持——富文本通道缺失，**修正清单不实标注**）
//   · P2-7 动态属性名（字符串字面量形态降级为静态；真动态 ⇒ 诊断 + 不建垃圾槽位）
//   · P2-8 白名单内建纯函数（Math.* / String / parseInt…）+ `Math.PI` 编译期内联
//   · P2-9 可选链 `?.` 编译期降级为 cond 程序（+ 依赖分析的幽灵源修正）
//
// 【★本文件锁两个"静默错"形态（本仓最忌）】
//   ① `Math.PI` 此前编成 `mem(root('Math'))` ⇒ 运行时 read('Math')=undefined ⇒ **静默渲染成空**；
//   ② `a?.b` 的属性名 `b` 此前被当**独立源**（幽灵依赖）⇒ 产物里出现对不存在源的订阅。
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { instantiateTemplate, PropKeyTable, StringPool, SlotRuntime, VaporRuntime, decodeOps, OpCode } from '@proteus-vue/slot-runtime'
import type { EvalContext } from '@proteus-vue/slot-runtime'

const sfc = (script: string, tpl: string): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`
const SCRIPT = `const a = ref(1)\nconst b = ref(2)\nconst obj = ref({ x: 5, y: { z: 7 } })\nconst nothing = ref(null)\n`
const data: Record<string, unknown> = { a: 1, b: 2, obj: { x: 5, y: { z: 7 } }, nothing: null, phases: ['a', 'b'], s: '  x  ' }
const read = (n: string): unknown => data[n]

/** 跑一次「编译 → 实例化 → 首帧文本 + 改源 → 指令文本」全链（复用真机同款链路） */
function runText(tpl: string, script = SCRIPT): { first: string; updated: string[] } {
  const src = sfc(script, tpl)
  const tplR = buildLayoutTemplate(src, 'p.vue').template
  const { table } = buildVaporSubscriptions(src, 'p.vue')
  const inst = instantiateTemplate(tplR, { viewport: { width: 100, height: 100 }, read, table })
  const first = String((inst.nodes[0] as { text?: string }).text ?? '')
  const d: Record<string, unknown> = { ...data }
  const keys = new PropKeyTable(); const strings = new StringPool()
  const captured: Uint8Array[] = []
  const rt = new SlotRuntime(keys, strings, (bx) => captured.push(bx))
  const ctx: EvalContext = { read: (n) => d[n] }
  const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators))
  const triggers = new Map<string, () => void>()
  vapor.load(ctx, (n, cb) => triggers.set(n, cb))
  vapor.relink(ctx); rt.flush()
  captured.length = 0
  d.a = 100
  Object.assign(data, { a: 100 }) // 首帧探针与更新用同一份（保持简单）
  for (const [, cb] of triggers) cb()
  vapor.relink(ctx); rt.flush()
  const updated: string[] = []
  for (const bx of captured) {
    const dec = decodeOps(bx)
    for (const op of dec.ops) {
      if (op.op === OpCode.SET_TEXT) updated.push(String(dec.strings.valueOf((op as { textRef: number }).textRef)))
    }
  }
  Object.assign(data, { a: 1 })
  return { first, updated }
}

describe('★★P2-8 白名单内建纯函数 + 全局常量内联', () => {
  it('① 白名单调用可编译为 call 程序，且**进 L1**（C1 静态保证，不是人工担保）', () => {
    const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-text>{{ Math.round(a * 1.4) }}</p-text>`), 'p.vue')
    expect(r.diagnostics, '不应有诊断').toHaveLength(0)
    expect(r.table.stats.l1, '白名单调用应进 L1').toBe(1)
    const ev = r.table.evaluators[0]!
    expect(ev.form).toBe('program')
    expect(r.decisions[0]!.reason, 'explain 应写明"内建白名单"而非"人工担保"').toContain('内建白名单')
    expect(r.decisions[0]!.mark, '静态可证 ⇒ 不标 forced(⚠)').not.toBe('⚠')
  })

  it('② 白名单外调用 ⇒ 拒绝 + 诊断（含修法与白名单指引）', () => {
    // ★`a.toFixed(2)` 现在**是**白名单方法（P2-8 续）⇒ 用真正非纯的形态测拒绝：
    //   `arr.sort()`（**变异**）、`Math.random`（不纯）、`JSON.stringify`（产出任意对象）
    for (const code of ['arr.sort()', 'Math.random()', 'JSON.stringify(a)', 'fn(a)', 's.replace(/x/, "y")']) {
      const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-text>{{ ${code} }}</p-text>`), 'p.vue')
      const msg = r.diagnostics.map((d) => d.message).join(' | ')
      expect(msg, `${code} 必须诊断`).toContain('白名单外')
      expect(msg, '修法要指向白名单').toContain('PURE_CALLS')
    }
  })

  it('★★③ `Math.PI` 编译期**内联为字面量**（此前静默渲染成空）', () => {
    const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-text>{{ Math.PI }}</p-text>`), 'p.vue')
    const prog = r.table.evaluators[0]!
    expect(prog.form).toBe('program')
    expect(JSON.stringify(prog.program)).toContain('3.14159')
    const out = runText(`<p-text>{{ Math.PI }}</p-text>`)
    expect(out.first, '首帧必须是 π（不是空串）').toMatch(/^3\.14/)
  })

  it('★④ 已知全局的非白名单成员（`Math.foo`）⇒ 诊断（不静默 undefined）', () => {
    const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-text>{{ Math.foo }}</p-text>`), 'p.vue')
    expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain('不支持访问内置全局')
  })

  it('★★④b **纯方法**（P2-8 续）：`arr.join(" → ")` 可用（真实项目 showcase 的用法）', () => {
    const script = `const phases = ref(['a', 'b'])\nconst s = ref('  x  ')\n`
    const r1 = runText(`<p-text>{{ phases.join(" → ") || "（暂无）" }}</p-text>`, script)
    expect(r1.first, 'join 真的执行了').toBe('a → b')
    const r2 = runText(`<p-text>{{ s.trim() }}</p-text>`, script)
    expect(r2.first, 'trim 真的执行了').toBe('x')
    // 变异方法仍拒绝（sort 会改数组 ⇒ 不是纯）
    const bad = buildVaporSubscriptions(sfc(script, `<p-text>{{ phases.sort() }}</p-text>`), 'p.vue')
    expect(bad.diagnostics.map((d) => d.message).join(' | ')).toContain('白名单外')
  })

  it('★⑤ 运行时：call 节点真的执行（首帧 + 更新都算对）', () => {
    const r = runText(`<p-text>{{ Math.max(a, b) }}</p-text>`)
    expect(r.first, '首帧 max(1,2)=2').toBe('2')
    expect(r.updated, 'a 改成 100 ⇒ max(100,2)=100').toEqual(['100'])
  })
})

describe('★★P2-9 可选链降级 + 依赖分析修正', () => {
  it('① `obj?.x` / `arr?.[0]` 编译为 cond 程序（可求值、进 L1）', () => {
    for (const code of ['obj?.x', 'obj?.y?.z', 'obj?.["x"]']) {
      const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-text>{{ ${code} }}</p-text>`), 'p.vue')
      expect(r.diagnostics, `${code} 不应有诊断`).toHaveLength(0)
      expect(r.table.evaluators[0]!.form, `${code} 应编成程序`).toBe('program')
      expect(r.table.stats.l1).toBe(1)
    }
  })

  it('★★② 语义等价：空值时返回 undefined（不是抛错、不是错值）；有值时正常取', () => {
    expect(runText(`<p-text>{{ obj?.x }}</p-text>`).first, 'obj.x = 5').toBe('5')
    expect(runText(`<p-text>{{ nothing?.x }}</p-text>`).first, 'null?.x ⇒ 空串（undefined 渲染为空）').toBe('')
    expect(runText(`<p-text>{{ obj?.y?.z }}</p-text>`).first, '链式 7').toBe('7')
    expect(runText(`<p-text>{{ obj?.missing?.deep }}</p-text>`).first, '中途缺失 ⇒ 空串（不抛错）').toBe('')
  })

  it('★★③ 依赖分析：属性名**不得**成为幽灵源（`a?.b` 的 roots 只有 a）', () => {
    const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-text v-text="a?.b"></p-text>`), 'p.vue')
    const names = r.table.sources.map((s) => s.sourceName)
    expect(names, '必须订阅 a').toContain('a')
    expect(names, '属性名 b 不得成为源（幽灵依赖）').not.toContain('b')
  })

  it('★④ 反向：真正的裸标识符仍算依赖（不因修可选链而漏订）', () => {
    const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-text>{{ a + b }}</p-text>`), 'p.vue')
    expect(r.table.sources.map((s) => s.sourceName).sort()).toEqual(['a', 'b'])
  })
})

describe('★★P2-6 v-text（真支持）/ v-html（诚实拒绝）', () => {
  it('① v-text 与插值同槽位：首帧有值、更新走 SET_TEXT', () => {
    const r = runText(`<p-text v-text="a + 1"></p-text>`)
    expect(r.first).toBe('2')
    expect(r.updated).toEqual(['101'])
    const t = buildLayoutTemplate(sfc(SCRIPT, `<p-text v-text="a"></p-text>`), 'p.vue')
    expect(t.diagnostics, 'v-text 已支持 ⇒ 零诊断').toHaveLength(0)
  })

  it('② v-text 与子元素并存 ⇒ 诊断（Vue 语义：v-text 覆盖子节点）', () => {
    const t = buildLayoutTemplate(sfc(SCRIPT, `<p-view v-text="a"><p-text>x</p-text></p-view>`), 'p.vue')
    expect(t.diagnostics.map((d) => d.message).join(' | ')).toContain('覆盖')
  })

  it('★★③ v-html **仍不支持**——且诊断必须说清原因（富文本通道缺失）', () => {
    const t = buildLayoutTemplate(sfc(SCRIPT, `<p-view v-html="a"></p-view>`), 'p.vue')
    const msg = t.diagnostics.map((d) => d.message).join(' | ')
    expect(msg, 'v-html 必须诊断').toContain('v-html 未支持')
    expect(msg, '★诊断要指出真实原因（内核单串、宿主单次 drawText）').toContain('富文本通道')
  })
})

describe('★★P2-7 动态属性名', () => {
  it('① 字符串字面量形态 `:[\'width\']` ⇒ 降级为静态名（可用、零诊断）', () => {
    const t = buildLayoutTemplate(sfc(SCRIPT, `<p-view :['width']="a" style="height: 5px"></p-view>`), 'p.vue')
    expect(t.diagnostics, '字符串字面量键名可静态判定 ⇒ 不应诊断').toHaveLength(0)
    const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-view :['width']="a" style="height: 5px"></p-view>`), 'p.vue')
    const slots = r.table.sources.flatMap((s) => s.slots)
    expect(slots.map((x) => x.propKey), '应归一为 layout.width').toEqual(['layout.width'])
  })

  it('★★② 真动态 `:[k]` ⇒ 诊断 + **不建槽位**（此前建垃圾键 `attr.k`）', () => {
    const r = buildVaporSubscriptions(sfc(SCRIPT, `<p-view :[k]="a" style="height: 5px"></p-view>`), 'p.vue')
    expect(
      r.diagnostics.some((d) => d.message.includes('动态属性名')),
      '真动态必须诊断',
    ).toBe(true)
    expect(r.table.sources.flatMap((s) => s.slots), '不得建槽位（垃圾键永不生效）').toHaveLength(0)
    const t = buildLayoutTemplate(sfc(SCRIPT, `<p-view :[k]="a" style="height: 5px"></p-view>`), 'p.vue')
    expect(t.diagnostics.map((d) => d.message).join(' | '), '模板侧同样诊断').toContain('动态属性名')
  })
})
