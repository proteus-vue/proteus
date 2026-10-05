// tests/app-ir-switch.test.ts
// ★★★G-61 后批：**App 端 IR 切换（批次 1 · paint-values）行为固定**
//
// 【本组锁什么（plan §2.2 的"每批必须有 IR 等价判据兜底"）】
//   ① 对齐机制：带 statics 时 CSE 与旧产物**逐节点对齐**（零未对齐）——切换的技术前提
//   ② 覆盖语义：**只改旧通路已声明的字段**（"旧有值 → CSE 值"；不引入继承新增——见 overlay 护栏）
//   ③ 开关：`PROTEUS_APP_IR_SWITCH=off` ⇒ 纯旧通路（**回退通道**可用）；批次名 ⇒ 只覆盖该批白名单
//   ④ 值域护栏：枚举值不在内核封闭集 ⇒ 跳过并记 note（不写坏内核树）
//   ⑤ 永久排除项：`position`/`fontFamily`/`display`（App 适配）**不在任何可切批次**
//
// 【实测基线（superapp，产物入库）】批次 1 覆盖后 superapp 产物**字节不变**（其 color/fontSize
//   与旧通路逐值一致——影子对账 superapp 零差异）⇒ 本测试以"不变"为硬判据（防未来误改）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildLayoutTemplate, extractFromSfc, computeTree, alignTrees, overlayIrValues, SWITCH_BATCHES } from '@proteus-vue/compiler'
import type { AlignNode } from '@proteus-vue/compiler'

const ROOT = path.resolve(__dirname, '..')

/** 与 app-content.ts 同源的 statics 提取（ref 字面量——测试内联副本，见其实现） */
function parseBalanced(src: string, openIdx: number): string | null {
  let depth = 0
  let quote: string | null = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]!
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return src.slice(openIdx + 1, i)
    }
  }
  return null
}
function refLits(s: string): Record<string, unknown> {
  const m = /<script[^>]*>([\s\S]*?)<\/script>/.exec(s)
  if (!m) return {}
  const out: Record<string, unknown> = {}
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*ref\s*(?:<[^>]*>)?\s*\(/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(m[1]!))) {
    const lit = parseBalanced(m[1]!, mm.index + mm[0].length - 1)
    if (!lit?.trim()) continue
    try {
      out[mm[1]!] = new Function(`return (${lit});`)()
    } catch {
      /* 非字面量：跳过 */
    }
  }
  return out
}

/** 旧产物扁平 nodes → AlignNode 树 */
function oldTreeOf(nodes: Array<{ id: number; parentId: number | null; tag?: string }>): AlignNode[] {
  const kidsOf = new Map<number | null, typeof nodes>()
  for (const n of nodes) {
    const pid = n.parentId ?? null
    const arr = kidsOf.get(pid)
    if (arr) arr.push(n)
    else kidsOf.set(pid, [n])
  }
  const conv = (n: (typeof nodes)[number]): AlignNode => ({
    id: n.id,
    tag: n.tag ?? '',
    children: (kidsOf.get(n.id) ?? []).map(conv),
  })
  return (kidsOf.get(null) ?? []).map(conv)
}

const SUPERAPP_PAGES = ['index.vue', 'messages.vue', 'mine.vue', 'verify.vue']

describe('★★★G-61 后批 · App IR 切换（批次 1）行为固定', () => {
  it('① 对齐：带 statics 时四页 + App.vue 逐节点对齐（零未对齐）', () => {
    for (const rel of [...SUPERAPP_PAGES.map((p) => `superapp/pages/${p}`), 'superapp/App.vue']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8')
      const statics = refLits(src)
      const tpl = buildLayoutTemplate(src, rel, undefined, undefined, statics).template
      const ex = extractFromSfc(src, { statics })
      const aligned = alignTrees(oldTreeOf(tpl.nodes), ex.roots as never)
      expect(aligned.reason, `${rel} 对齐失败：${aligned.reason}`).toBeUndefined()
      expect(aligned.unaligned, `${rel} 有未对齐节点`).toBe(0)
      // 对齐数 = 旧树（去合成叶）节点数
      const oldCount = tpl.nodes.filter((n) => n.tag !== 'p-text').length
      expect(aligned.pairs.length, `${rel} 对齐数`).toBe(oldCount)
    }
  })

  it('② 覆盖语义：superapp 页在批次 1 下**零改动**（其 paint 值与旧通路一致）', () => {
    const rel = 'superapp/pages/mine.vue'
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8')
    const statics = refLits(src)
    const tpl = buildLayoutTemplate(src, rel, undefined, undefined, statics).template
    const ex = extractFromSfc(src, { statics })
    const computed = computeTree(ex.roots, ex.sheet, { inlineStyles: ex.inlineStyles })
    const byId = new Map(tpl.nodes.map((n) => [n.id, n]))
    const before = JSON.stringify(tpl.nodes.map((n) => n.style))
    const r = overlayIrValues(
      oldTreeOf(tpl.nodes),
      (id) => byId.get(id as number)!.style as Record<string, unknown>,
      ex.roots,
      computed.byKey as never,
      { fields: SWITCH_BATCHES['paint-values']! },
    )
    expect(r.reason, `覆盖被拒：${r.reason}`).toBeUndefined()
    expect(JSON.stringify(tpl.nodes.map((n) => n.style)), 'superapp 应零改动').toBe(before)
  })

  it('③ 覆盖生效：examples 的 rpx 单位 fontSize 被修正（×1.04——CSE 视口比例语义）', () => {
    const rel = 'examples/pages/docs-engine-demo.vue'
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8')
    const tpl = buildLayoutTemplate(src, rel).template
    const ex = extractFromSfc(src)
    const computed = computeTree(ex.roots, ex.sheet, { inlineStyles: ex.inlineStyles })
    const byId = new Map(tpl.nodes.map((n) => [n.id, n]))
    const r = overlayIrValues(
      oldTreeOf(tpl.nodes),
      (id) => byId.get(id as number)!.style as Record<string, unknown>,
      ex.roots,
      computed.byKey as never,
      { fields: SWITCH_BATCHES['paint-values']! },
    )
    expect(r.applied, '应有 font-size 修正被应用').toBeGreaterThan(0)
    // 抽样：某些节点 fontSize 变成 20.8 这类（旧 20 × 1.04）
    const fs2 = tpl.nodes.map((n) => n.style?.fontSize).filter((v) => typeof v === 'number')
    expect(fs2.some((v) => !Number.isInteger(v)), '应出现 ×1.04 后的非整数值').toBe(true)
  })

  it('④ 回退通道：白名单为空（off）⇒ 零改动（纯旧通路）', () => {
    const rel = 'examples/pages/docs-engine-demo.vue'
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8')
    const tpl = buildLayoutTemplate(src, rel).template
    const ex = extractFromSfc(src)
    const computed = computeTree(ex.roots, ex.sheet, { inlineStyles: ex.inlineStyles })
    const byId = new Map(tpl.nodes.map((n) => [n.id, n]))
    const before = JSON.stringify(tpl.nodes.map((n) => n.style))
    const r = overlayIrValues(oldTreeOf(tpl.nodes), (id) => byId.get(id as number)!.style as Record<string, unknown>, ex.roots, computed.byKey as never, { fields: [] })
    expect(r.applied).toBe(0)
    expect(JSON.stringify(tpl.nodes.map((n) => n.style))).toBe(before)
  })

  it('⑤ 值域护栏：不在内核封闭集的枚举值被跳过（记 note，不写坏树）', () => {
    const rel = 'examples/pages/docs-engine-demo.vue'
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8')
    const tpl = buildLayoutTemplate(src, rel).template
    const ex = extractFromSfc(src)
    const computed = computeTree(ex.roots, ex.sheet, { inlineStyles: ex.inlineStyles })
    const byId = new Map(tpl.nodes.map((n) => [n.id, n]))
    // 人为把某节点的 CSE 值改成不在封闭集（模拟）
    const firstKey = Object.keys(computed.byKey)[0]!
    computed.byKey[firstKey]!.fields['display'] = 'inline-block' // 内核只认 flex/grid/none
    const r = overlayIrValues(oldTreeOf(tpl.nodes), (id) => byId.get(id as number)!.style as Record<string, unknown>, ex.roots, computed.byKey as never, {
      fields: ['display'],
      enumValues: { display: ['flex', 'grid', 'none'] },
    })
    // 若该节点原本有 display 且值不同 ⇒ 应被记为 skipped（不进 applied）
    const skipped = r.ops.filter((o) => o.skipped)
    expect(skipped.length, '应至少有一条被护栏拦下').toBeGreaterThan(0)
    for (const s of skipped) expect(s.to, '被拦的值不应写入').not.toBe(byId.get(s.nodeId)!.style?.[s.field])
  })

  it('⑥ 永久排除项：position / fontFamily / display 不在任何可切批次', () => {
    const allSwitchable = Object.entries(SWITCH_BATCHES)
      .filter(([name]) => name !== 'app-adaptation-excluded')
      .flatMap(([, fields]) => fields)
    for (const f of ['position', 'fontFamily', 'display']) {
      expect(allSwitchable, `${f} 是 App 适配项——不应出现在可切批次`).not.toContain(f)
    }
  })
})
