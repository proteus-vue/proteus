// tests/consistency-interaction.test.ts
// ★L2.5（离散交互）+ L2.6（连续交互不变量）—— 单测
//
// 【本档要证明的判别力（每条都打在"会失败的那一点"上）】
//   L2.5：① 两端都动 + 结果态一致 ⇒ 过；② 任一端**没动**（"点了没反应"）⇒ 必红；
//         ③ 结果态不一致 ⇒ 必红。
//   L2.6：① 整体滚动（同量平移）⇒ **全过**（这是"禁止比绝对坐标"的机器证明——
//           同样的两份快照，若按绝对值比会报一堆差异，按不变量比则全绿）；
//         ② 某节点单独偏移（间距被破坏）⇒ `gaps`/`translation` 必红；
//         ③ 某节点尺寸改变 ⇒ `sizes` 必红；④ 子序调换 ⇒ `order` 必红；
//         ⑤ 结构缺失/多出 ⇒ `structure` 必红；⑥ 包含关系变化 ⇒ `containment` 必红。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareDiscreteInteraction, verifyInvariants, maxGeomMove, resolveTolerance,
} from '@proteus-vue/consistency'
import type { GeometrySnapshot, GeometryNode } from '@proteus-vue/consistency'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tol = resolveTolerance(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/consistency-tolerance.json'), 'utf-8')))

/* ── 夹具：root(400×600) > [A(200×60), B(200×100), C(200×40)]（列向，间距 8） ── */
type Mut = {
  shift?: { x?: number; y?: number }          // 整体平移
  nodeShift?: Record<string, { x?: number; y?: number }> // 单节点平移
  nodeSize?: Record<string, { w?: number; h?: number }> // 单节点尺寸
  drop?: string                                // 删除节点
  swapKids?: boolean                           // 交换 B/C 的 y（改变可视序）
  growParent?: boolean                         // 根的高度改变（包含关系变化）
}
function snap(mut: Mut = {}): GeometrySnapshot {
  const s = mut.shift ?? {}
  const kids: GeometryNode[] = [
    { nodeId: 'a', path: '0', x: 12, y: 12, w: 200, h: 60, depth: 1, semanticKey: 'p-box', children: [] },
    { nodeId: 'b', path: '1', x: 12, y: 80, w: 200, h: 100, depth: 1, semanticKey: 'p-box', children: [] },
    { nodeId: 'c', path: '2', x: 12, y: 188, w: 200, h: 40, depth: 1, semanticKey: 'p-box', children: [] },
  ].filter((n) => n.path !== mut.drop)
  for (const k of kids) {
    // ★整体平移必须应用到**每个节点**（含子级）——首版只平移了根 ⇒ ⑤ 自测当场红
    //   （这正是不变量判据的判别力：连我写错的夹具都被它抓住）
    k.x += s.x ?? 0
    k.y += s.y ?? 0
    const ns = mut.nodeShift?.[k.path]
    const nz = mut.nodeSize?.[k.path]
    if (ns) {
      k.x += ns.x ?? 0
      k.y += ns.y ?? 0
    }
    if (nz) {
      k.w += nz.w ?? 0
      k.h += nz.h ?? 0
    }
  }
  if (mut.swapKids) {
    const b = kids.find((k) => k.path === '1')!
    const c = kids.find((k) => k.path === '2')!
    const t = b.y
    b.y = c.y
    c.y = t
  }
  return {
    format: 'proteus-geometry-snapshot', version: 1, end: 'web',
    viewport: { width: 400, height: 600 },
    root: {
      nodeId: 'root', path: '', x: 0 + (s.x ?? 0), y: 0 + (s.y ?? 0),
      w: 400, h: 600 + (mut.growParent ? 40 : 0), depth: 0,
      semanticKey: 'p-view', children: kids,
    },
  }
}

describe('L2.5 · 离散交互（事件 → 结果态几何）', () => {
  const before = snap()
  const after = snap({ nodeSize: { '0': { w: 60 } } }) // 交互：A 的宽 +60（如"展开"）

  it('① 两端都动且结果态一致 ⇒ 通过', () => {
    const r = compareDiscreteInteraction(before, after, before, after, { tolerance: tol })
    expect(r.ok).toBe(true)
    expect(r.aMoved).toBe(60)
    expect(r.bMoved).toBe(60)
    expect(r.problems).toEqual([])
  })

  it('② 任一端"点了没反应" ⇒ 必红（最常见静默缺陷）', () => {
    const dead = compareDiscreteInteraction(before, after, before, before, { tolerance: tol })
    expect(dead.ok).toBe(false)
    expect(dead.problems.join()).toMatch(/B 端交互\*\*没有引起任何几何变化/)
    const deadA = compareDiscreteInteraction(before, before, before, after, { tolerance: tol })
    expect(deadA.ok).toBe(false)
    expect(deadA.problems.join()).toMatch(/A 端交互/)
  })

  it('③ 结果态不一致 ⇒ 必红（交互语义不同）', () => {
    const diffAfter = snap({ nodeSize: { '0': { w: 90 } } }) // B 端交互结果不同（+90 ≠ +60）
    const r = compareDiscreteInteraction(before, after, before, diffAfter, { tolerance: tol })
    expect(r.ok).toBe(false)
    expect(r.result.ok).toBe(false)
    expect(r.result.diffs.some((d) => d.path === '0' && d.property === 'w')).toBe(true)
  })

  it('④ maxGeomMove：结构变化计为"动了"（∞），同结构按逐节点最大位移', () => {
    expect(maxGeomMove(before, snap({ shift: { y: 200 } }))).toBe(200)
    expect(maxGeomMove(before, snap({ drop: '2' }))).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('L2.6 · 连续交互不变量（禁止绝对坐标）', () => {
  it('⑤ ★整体滚动（全部同量平移）⇒ 不变量全过——"比绝对坐标必然失败、比不变量全过"的机器证明', () => {
    const before = snap()
    const after = snap({ shift: { y: -200 } }) // 向上滚 200px
    const r = verifyInvariants(before, after, { tolerance: tol })
    expect(r.ok, JSON.stringify(r.checks)).toBe(true)
    expect(r.checks.every((c) => c.ok)).toBe(true)
    expect(r.translation.y, '识别出整体平移量').toBeCloseTo(200, 1)
    // ★对照：若按"绝对坐标"比（align:none 的几何比对），必然一堆差异 —— 这正是 §10.2 禁止的做法
    const naive = (() => {
      // 模拟"比绝对坐标"：直接比 y
      const A = before.root.children.map((c) => c.y)
      const B = after.root.children.map((c) => c.y)
      return A.some((v, i) => Math.abs(v - B[i]!) > 0.01)
    })()
    expect(naive, '绝对坐标比对会失败（证明确实需要不变量口径）').toBe(true)
  })

  it('⑥ 某节点单独偏移（间距被破坏）⇒ translation 必红', () => {
    const r = verifyInvariants(snap(), snap({ nodeShift: { '1': { y: 7 } } }), { tolerance: tol })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'translation')!.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'gaps')!.ok, '相邻间距也随之变化').toBe(false)
  })

  it('⑦ 某节点尺寸改变 ⇒ sizes 必红（间距可能仍对——两判据互补）', () => {
    const r = verifyInvariants(snap(), snap({ nodeSize: { '1': { h: 5 } } }), { tolerance: tol })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'sizes')!.ok).toBe(false)
  })

  it('⑧ 子序调换（可视顺序变化）⇒ order 必红', () => {
    const r = verifyInvariants(snap(), snap({ swapKids: true }), { tolerance: tol })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'order')!.ok).toBe(false)
  })

  it('⑨ 结构缺失/多出 ⇒ structure 必红；包含关系变化 ⇒ containment 必红', () => {
    const miss = verifyInvariants(snap(), snap({ drop: '1' }), { tolerance: tol })
    expect(miss.ok).toBe(false)
    expect(miss.checks.find((c) => c.id === 'structure')!.ok).toBe(false)

    const cont = verifyInvariants(snap(), snap({ growParent: true }), { tolerance: tol })
    expect(cont.ok).toBe(false)
    expect(cont.checks.find((c) => c.id === 'containment')!.ok, '子级相对父盒的溢出量变了').toBe(false)
  })

  it('⑩ checks 可裁剪（只判需要的项——供不同消费方复用）', () => {
    const r = verifyInvariants(snap(), snap({ nodeSize: { '1': { h: 5 } } }), { tolerance: tol, checks: ['structure', 'gaps'] })
    expect(r.checks.map((c) => c.id)).toEqual(['structure', 'gaps'])
    expect(r.ok, '只判 structure/gaps 时尺寸变化不影响结论').toBe(true)
  })
})
