// tests/z-index-layer-mapping.test.ts —— ★★★批 A④（2026-10-08 · 决策 #658）：z-index 数值→语义层映射判据
//
// 【本项修的是什么】`:style` 内联裸 z-index 被 LY001 编译期拦（规范 §3.5 立场不变）；
//   但**类样式**里的 z-index 合法且语料在用（superapp 66 处）——**App 三端此前静默丢**
//   （折叠面无该字段 / applier drop / 宿主无 z 序）⇒ Web/MP 正常、App 按声明序画。
//
// 【判据打在三处（各自对应一个会静默出错的设计错误）】
//   ① **区间映射是判据 SSOT**（contracts/layers.ts 的 `zIndexOf`）：1-9 content / 10-99 navigation /
//      100-999 mask / 1000+ popout——与规范 §3.4 区间表逐位对齐；负值/超上限有明确 verdict。
//   ② **折叠面发射**（`parseStaticStyle`）：类样式 z-index 进引擎字段；`auto` 不发射（零行为变化）；
//      非法值诊断 + 跳过（不静默当 0）。
//   ③ **重排语义**（`reorderSiblingsByZ` 经 app-content）：脱离流兄弟按 (z, 声明序) 稳定排序；
//      **在流元素保原序**（布局安全）；未声明 z 视作 0；同 z 保序（CSS 行为）。
//   ★反向（防"判据自己腐化"）：区间边界的开闭必须互斥且无缝（每个整数恰好落一层）。

import { describe, it, expect } from 'vitest'
import { zIndexOf, Z_INDEX_RANGES, Z_INDEX_MAX, LAYER_PRIMITIVES } from '@proteus-vue/contracts'
import { parseStaticStyle } from '@proteus-vue/compiler'
import { reorderSiblingsByZ, type ShellNode } from '../packages/cli/src/app-content'

describe('★批 A④ · ① 区间映射判据 SSOT（zIndexOf）', () => {
  it('规范 §3.4 四区间逐位对齐（1-9 / 10-99 / 100-999 / 1000+）', () => {
    // 下沿
    expect(zIndexOf(1).layer).toBe('layer-content')
    expect(zIndexOf(10).layer).toBe('layer-navigation')
    expect(zIndexOf(100).layer).toBe('layer-mask')
    expect(zIndexOf(1000).layer).toBe('layer-popout')
    // 上沿（区间闭合边界：9 仍是 content，10 已是 navigation）
    expect(zIndexOf(9).layer).toBe('layer-content')
    expect(zIndexOf(99).layer).toBe('layer-navigation')
    expect(zIndexOf(999).layer).toBe('layer-mask')
    expect(zIndexOf(1000).layer).toBe('layer-popout')
  })

  it('0 归 content（CSS 里 z:0 与正 z 同属"定位层序"，非负值）', () => {
    const v = zIndexOf(0)
    expect(v.ok).toBe(true)
    expect(v.layer).toBe('layer-content')
    expect(v.inLayerRank).toBe(0)
  })

  it('负值 = 不支持（CSS 负 z 呈现在容器背景之后——自绘管线无该分层概念）且带迁移指引', () => {
    const v = zIndexOf(-1)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('负 z-index')
    expect(v.hint, '必须给替代做法（本仓纪律：修法要具体）').toBeTruthy()
  })

  it('超上限 = **仍 ok**（排序权重有效）但标 suspicious + 提示（壳骨架 1.5e6 属内部用法）', () => {
    const v = zIndexOf(1_500_000)
    expect(v.ok, '超大值仍然发射（排序权重本身有效——否则壳骨架排序会错）').toBe(true)
    expect(v.suspicious).toBe(true)
    expect(v.reason).toContain('超出')
    expect(zIndexOf(Z_INDEX_MAX + 1).suspicious).toBe(true)
    expect(zIndexOf(Z_INDEX_MAX).suspicious).toBeUndefined()
  })

  it('非有限数 = 不 ok（含 NaN/Infinity——不静默当 0）', () => {
    expect(zIndexOf(Number.NaN).ok).toBe(false)
    expect(zIndexOf(Number.POSITIVE_INFINITY).ok).toBe(false)
  })

  it('非整数四舍五入（CSS 里 z-index 取整）', () => {
    expect(zIndexOf(1.4).layer).toBe('layer-content')
    expect(zIndexOf(1.6).inLayerRank).toBe(1)
    expect(zIndexOf(9.6).layer).toBe('layer-navigation')
  })

  it('层内序 = 区间偏移（区间内保留数值序——Web 行为：同区间 100<1000 时数值大者在上）', () => {
    expect(zIndexOf(1).inLayerRank).toBe(0)
    expect(zIndexOf(9).inLayerRank).toBe(8)
    expect(zIndexOf(10).inLayerRank).toBe(0)
    expect(zIndexOf(1000).inLayerRank).toBe(0)
    expect(zIndexOf(1005).inLayerRank).toBe(5)
  })

  it('★反向护栏：区间开闭互斥且无缝（**正整数**恰好落一层——0 是特例，见下条）', () => {
    for (let n = 1; n <= 3000; n++) {
      const hits = Z_INDEX_RANGES.filter((r) => n >= r.min && (r.maxExclusive === null || n < r.maxExclusive))
      expect(hits.length, `数值 ${n} 必须恰好命中一个区间（实际 ${hits.length}）`).toBe(1)
    }
    // 0 在区间表外（首区间下沿 = 1）——由 zIndexOf 兜底归 content 层内序 0
    const zero = Z_INDEX_RANGES.filter((r) => 0 >= r.min && (r.maxExclusive === null || 0 < r.maxExclusive))
    expect(zero.length, '0 不在任何区间（有意——zIndexOf 单独处理）').toBe(0)
    expect(zIndexOf(0).layer, '但 zIndexOf 判它 content（与 CSS z:0 同档）').toBe('layer-content')
  })

  it('非 content 层给迁移指引（可改用 layer= 属性获得跨端层容器语义）', () => {
    expect(zIndexOf(10).hint).toContain('layer="layer-navigation"')
    expect(zIndexOf(1000).hint).toContain('layer="layer-popout"')
    expect(zIndexOf(1).hint, 'content 层无需指引（它就是常态）').toBeUndefined()
  })

  it('映射出的层名都在封闭集内（不发明新层）', () => {
    for (const r of Z_INDEX_RANGES) {
      expect(LAYER_PRIMITIVES).toContain(r.layer)
    }
  })
})

describe('★批 A④ · ② 折叠面发射（类样式 z-index → 引擎字段）', () => {
  const fold = (css: string): { out: Record<string, unknown>; diags: string[] } => {
    const diags: string[] = []
    const out = parseStaticStyle(css, (msg: string) => diags.push(msg)) as Record<string, unknown>
    return { out, diags }
  }

  it('数值进产物（此前静默丢——本项的核心修复）', () => {
    const { out } = fold('z-index: 2; position: absolute;')
    expect(out.zIndex).toBe(2)
    expect(out.position).toBe('absolute')
  })

  it('声明序无关：z-index 只进字段（排序由构建期重排执行）', () => {
    const a = fold('position: absolute; z-index: 1;')
    const b = fold('z-index: 1; position: absolute;')
    expect(a.out.zIndex).toBe(b.out.zIndex)
  })

  it('`auto` 不发射（零行为变化——与 CSS 同语义：按声明序参与）', () => {
    const { out, diags } = fold('z-index: auto;')
    expect(out.zIndex).toBeUndefined()
    expect(diags, 'auto 是合法值，不应诊断').toEqual([])
  })

  it('负值 ⇒ 诊断 + 跳过（不静默当 0——本仓"不静默近似"纪律）', () => {
    const { out, diags } = fold('z-index: -1;')
    expect(out.zIndex).toBeUndefined()
    expect(diags.some((d) => d.includes('负 z-index'))).toBe(true)
  })

  it('超大值 ⇒ 仍发射 + suspicious 诊断（壳骨架 1.5e6 必须能排对序）', () => {
    const { out, diags } = fold('z-index: 1500000;')
    expect(out.zIndex, '必须发射——否则壳骨架排序错').toBe(1500000)
    expect(diags.some((d) => d.includes('超出'))).toBe(true)
  })

  it('非法值 ⇒ 诊断 + 跳过（非数值）', () => {
    const { out, diags } = fold('z-index: abc;')
    expect(out.zIndex).toBeUndefined()
    expect(diags.length).toBeGreaterThan(0)
  })

  it('非 content 区间给迁移指引诊断（数值可用，但语义层声明跨端更强）', () => {
    const { out, diags } = fold('z-index: 1000;')
    expect(out.zIndex).toBe(1000)
    expect(diags.some((d) => d.includes('layer="layer-popout"'))).toBe(true)
  })
})

describe('★批 A④ · ③ 层叠序重排（reorderSiblingsByZ —— 布局安全的绘制序）', () => {
  const n = (id: number, parentId: number | null, extra: Partial<ShellNode> = {}): ShellNode => ({ id, parentId, ...extra })
  const ids = (arr: ShellNode[]): number[] => arr.map((x) => x.id)

  it('脱离流兄弟按 (z, 声明序) 稳定排序（核心语义）', () => {
    const out = reorderSiblingsByZ([
      n(0, null),
      n(2, 0, { position: 'absolute', zIndex: 2 }),
      n(1, 0, { position: 'absolute', zIndex: 1 }),
    ])
    expect(ids(out.slice(1)), 'z:1 在 z:2 之前').toEqual([1, 2])
  })

  it('同 z 保声明序（CSS 同层行为——稳定排序）', () => {
    const out = reorderSiblingsByZ([
      n(0, null),
      n(1, 0, { position: 'absolute', zIndex: 5 }),
      n(2, 0, { position: 'absolute', zIndex: 5 }),
      n(3, 0, { position: 'absolute', zIndex: 5 }),
    ])
    expect(ids(out.slice(1))).toEqual([1, 2, 3])
  })

  it('未声明 z 视作 0（排在正 z 之前——与 CSS auto 同档）', () => {
    const out = reorderSiblingsByZ([
      n(0, null),
      n(1, 0, { position: 'absolute', zIndex: 3 }),
      n(2, 0, { position: 'absolute' }),
    ])
    expect(ids(out.slice(1))).toEqual([2, 1])
  })

  it('★布局安全：在流元素一律保原序（重排它们会改布局流序——非 z 语义）', () => {
    const out = reorderSiblingsByZ([
      n(0, null),
      n(1, 0, { position: 'relative', zIndex: 99 }),
      n(2, 0, { position: 'relative', zIndex: 1 }),
      n(3, 0, {}),
    ])
    expect(ids(out.slice(1)), '在流元素不因 z 重排').toEqual([1, 2, 3])
  })

  it('两相位：在流在前、脱离流在后（CSS 2.1 附录 E 与内核 paint_order 同步）', () => {
    const out = reorderSiblingsByZ([
      n(0, null),
      n(1, 0, { position: 'absolute', zIndex: 1 }),
      n(2, 0, { position: 'relative' }),
      n(3, 0, {}),
    ])
    expect(ids(out.slice(1)), '在流（2,3）在前、absolute（1）在后').toEqual([2, 3, 1])
  })

  it('只重排同父（跨容器不生效——stacking context 语义）', () => {
    const out = reorderSiblingsByZ([
      n(0, null),
      n(1, 0, { position: 'absolute', zIndex: 1 }),
      n(2, 1, { position: 'absolute', zIndex: 9 }),
      n(3, 1, { position: 'absolute', zIndex: 1 }),
    ])
    // 顶层：1（无 z）→ 无其它；1 的子：3(z:1) 在 2(z:9) 之前
    expect(ids(out)).toEqual([0, 1, 3, 2])
  })

  it('在流元素带 z-index ⇒ 诊断（v1 无法表达——不静默假装生效）', () => {
    const diags: string[] = []
    reorderSiblingsByZ([n(0, null), n(1, 0, { position: 'relative', zIndex: 5 })], diags)
    expect(diags.length).toBe(1)
    expect(diags[0]).toContain('在流')
    expect(diags[0]).toContain('z-index: 5')
  })

  it('全部节点保留（不掉节点——含孤儿防御）', () => {
    const input = [n(0, null), n(1, 0, { position: 'absolute', zIndex: 1 }), n(9, 999, { position: 'absolute' })]
    const out = reorderSiblingsByZ(input)
    expect(out.length).toBe(3)
    expect(new Set(ids(out)).size).toBe(3)
  })

  it('id/parentId 不被改写（只动序，不动结构——内核按 parentId 建树）', () => {
    const out = reorderSiblingsByZ([
      n(0, null),
      n(1, 0, { position: 'absolute', zIndex: 2 }),
      n(2, 0, { position: 'absolute', zIndex: 1 }),
    ])
    expect(out.every((x) => x.id === (x as { id: number }).id)).toBe(true)
    expect(out.find((x) => x.id === 2)?.parentId).toBe(0)
  })
})
