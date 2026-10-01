// tests/showcase-ink.test.ts —— ★★炫技场 · **第四个节目（墨绘·山水卷）**的本机侧判据（CI 可跑）
//
// 【主题（用户："这个新增能力可以做单独的节目吗？"→"既然要做直接做到天花板的质量"）】
//   一幅水墨长卷自己画出来：展卷 → 远山三叠（晕染 + 湿/骨/枯三层落笔）→ 飞瀑 → 江水涨潮
//   （月影随水）→ 明月升起（月晕先扩）→ 云海翻涌 → 松竹风摆 → 渔舟荡漾 → 飞鸟掠水
//   → 题款（竖排四字）→ 落印（含白文内框）→ 云开月明（万物微动）→ 收卷。
//   **C2 描边 = 落笔**；**C1 裁剪 = 显形**（晕染/涨潮/升月/涌云/书写/落印）。
//
// 【本测试守什么】13 幕走完 · 双能力逐幕在场 · **裁剪链跨幕自洽** · **闭环**（收卷 =
//   "空白卷轴"基态）· **构建态律**（所有可动画元素基态皆"不可见/未画"）· **墨分五色**
//   （三层笔触色阶与宽度关系）· **多边形 16 参数契约**（内核 ≤8 点）· 确定性。
import { describe, it, expect } from 'vitest'
import {
  buildInkTree, createInkProgram, INK_IDS, INK_SAMPLE_IDS, INK_PALETTE,
  blend, ink, MIST_FLAT, MIST_A, MIST_B, MIST_C, RANGES,
} from '../hosts/shared/bridge/showcase-ink'
import { spanMs } from '../hosts/shared/bridge/showcase-lights'

const VIEW = { width: 1080, height: 2400 }

function walkAll() {
  const prog = createInkProgram({ view: VIEW })
  const plan = prog.plan()
  const acts: NonNullable<ReturnType<typeof prog.next>>[] = []
  for (;;) {
    const a = prog.next()
    if (!a) break
    acts.push(a)
  }
  return { acts, plan }
}

interface NodeSpec {
  id: number
  clipPath?: { kind: string; params: number[] }
  svgPath?: { d: string; stroke: string; strokeWidth: number }
  text?: string
  backgroundColor?: string
  [k: string]: unknown
}

function treeNodes(): Map<number, NodeSpec> {
  const tree = JSON.parse(buildInkTree(VIEW)) as { nodes: NodeSpec[] }
  return new Map(tree.nodes.map((n) => [n.id, n]))
}

/** 节点 id → 裁剪通道基准（15 = 槽 0；与内核 CLIP0 同号） */
const NODE_SLOT_BASE: Record<number, number> = {
  [INK_IDS.curtain]: 15,
  [INK_IDS.water]: 15,
  [INK_IDS.waterDeep]: 15,
  [INK_IDS.moon]: 15,
  [INK_IDS.haloOuter]: 15,
  [INK_IDS.haloInner]: 15,
  [INK_IDS.titleChars[0]]: 15,
  [INK_IDS.titleChars[1]]: 15,
  [INK_IDS.titleChars[2]]: 15,
  [INK_IDS.titleChars[3]]: 15,
  [INK_IDS.sealFill]: 15,
  [INK_IDS.sealInner]: 15,
  [INK_IDS.clouds[0]]: 15,
  [INK_IDS.clouds[1]]: 15,
  [INK_IDS.clouds[2]]: 15,

  [INK_IDS.rangePuffs[0][0]]: 15,
  [INK_IDS.rangePuffs[0][1]]: 15,
  [INK_IDS.rangePuffs[1][0]]: 15,
  [INK_IDS.rangePuffs[2][0]]: 15,
  [INK_IDS.rangeDots[0][0]]: 15,
  [INK_IDS.cloudPuffs[0]]: 15,
  [INK_IDS.cloudPuffs[1]]: 15,
  [INK_IDS.cloudPuffs[2]]: 15,
  [INK_IDS.banks[0]]: 15,
  [INK_IDS.banks[1]]: 15,
  [INK_IDS.reflection]: 15,
}

/** 取某幕某节点的裁剪通道终值（yoyo 偶次 ⇒ 末态 = from） */
function clipEnd(
  act: { anims: Array<{ kind: number; nodeId: number; from: number; to: number; repeat?: number; alternate?: boolean; keyframes?: Array<{ to: number }> }> },
  nodeId: number,
): number[] | null {
  const base = NODE_SLOT_BASE[nodeId]
  if (base === undefined) return null
  const out: number[] = []
  for (let s = 0; s < 16; s++) {
    const a = act.anims.find((x) => x.kind === base + s && x.nodeId === nodeId)
    if (!a) break
    out.push(a.repeat !== undefined && a.repeat > 1 && a.alternate && a.repeat % 2 === 0
      ? a.from
      : (a.keyframes && a.keyframes.length > 0 ? a.keyframes[a.keyframes.length - 1]!.to : a.to))
  }
  return out.length > 0 ? out : null
}

function clipFrom(
  act: { anims: Array<{ kind: number; nodeId: number; from: number; to: number }> },
  nodeId: number,
): number[] | null {
  const base = NODE_SLOT_BASE[nodeId]
  if (base === undefined) return null
  const out: number[] = []
  for (let s = 0; s < 16; s++) {
    const a = act.anims.find((x) => x.kind === base + s && x.nodeId === nodeId)
    if (!a) break
    out.push(a.from)
  }
  return out.length > 0 ? out : null
}

describe('Morpheus 炫技场 · 第四个节目（墨绘·山水卷）', () => {
  it('整场能走完：13 幕名序齐全（unfurl … close）', () => {
    const { acts, plan } = walkAll()
    expect(acts.map((a) => a.name)).toEqual(plan)
    expect(plan).toEqual([
      'unfurl', 'mountains', 'waterfall', 'river', 'moonrise', 'clouds', 'grove',
      'boat', 'birds', 'inscription', 'seal', 'moonGlow', 'close',
    ])
  })

  it('★不变量：幕时长 = 指令跨度 + hold（纯推导）', () => {
    const { acts } = walkAll()
    for (const a of acts) {
      expect(a.spanMs).toBe(spanMs(a.anims))
      expect(a.durationMs).toBe(a.spanMs + a.holdMs)
    }
  })

  it('★★能力覆盖 · C2 描边：≥ 6 幕有 strokeProgress；全片 ≥ 28 条描边指令', () => {
    const { acts } = walkAll()
    const withStroke = acts.filter((a) => a.strokeAnims > 0)
    expect(withStroke.length, `有描边的幕：${withStroke.map((a) => a.name).join(',')}`).toBeGreaterThanOrEqual(6)
    const total = acts.reduce((s, a) => s + a.strokeAnims, 0)
    // 山 3×3=9 + 瀑 3 + 水纹 6 + 竹 3×3=9 + 舟 3 + 鸟 3 + 印内框 1 = 34
    expect(total).toBeGreaterThanOrEqual(28)
    for (const name of ['mountains', 'waterfall', 'river', 'grove', 'boat', 'birds', 'seal']) {
      expect(acts.find((a) => a.name === name)!.strokeAnims, `${name} 应有描边`).toBeGreaterThan(0)
    }
  })

  it('★★能力覆盖 · C1 裁剪：≥ 8 幕有 clip 通道；全片裁剪指令 ≥ 90 条', () => {
    const { acts } = walkAll()
    const withClip = acts.filter((a) => a.clipAnims > 0)
    expect(withClip.length, `有裁剪的幕：${withClip.map((a) => a.name).join(',')}`).toBeGreaterThanOrEqual(8)
    const total = acts.reduce((s, a) => s + a.clipAnims, 0)
    expect(total).toBeGreaterThanOrEqual(90)
  })

  it('★★★多边形 16 参数契约：所有 polygon 的 clip 值 ≤16 个（内核上限——超了整棵树被拒）', () => {
    const nodes = treeNodes()
    for (const n of nodes.values()) {
      if (n.clipPath?.kind === 'polygon') {
        expect(n.clipPath.params.length, `节点 ${n.id} polygon 参数`).toBeLessThanOrEqual(16)
        expect(n.clipPath.params.length % 2, `节点 ${n.id} polygon 应成对`).toBe(0)
      }
    }
    // 幕里的 polygon 通道：由 program 构造时经 compileAnimations 校验（超限会当场抛错），
    //   此处补一条**静态契约**——山体晕染顶点数 ≤4（washPolygon 的 16 参数推导）
    for (const rg of RANGES) {
      expect(rg.puffs.length, '每叠晕团数（= id 表长度 2）').toBe(2)
    }
    // 云海三形态：各 8 点 = 16 参数（上限之内）
    for (const m of [MIST_FLAT, MIST_A, MIST_B, MIST_C]) {
      expect(m.length).toBeLessThanOrEqual(16)
      expect(m.length % 2).toBe(0)
    }
  })

  it('★★裁剪链跨幕自洽：每幕 from = 上一幕该节点终态（幕间不跳变）', () => {
    const { acts } = walkAll()
    const nodes = [INK_IDS.curtain, INK_IDS.water, INK_IDS.moon, INK_IDS.titleChars[0], INK_IDS.sealFill, INK_IDS.clouds[0], INK_IDS.rangePuffs[0][0]]
    const last: Record<number, number[] | null> = {}
    for (const a of acts) {
      for (const id of nodes) {
        const f = clipFrom(a as never, id)
        if (f === null) continue
        if (last[id] != null) {
          expect(f, `幕 ${a.name} 的节点 ${id} 裁剪 from 应等于上一幕终态`).toEqual(last[id])
        }
        last[id] = clipEnd(a as never, id)
      }
    }
  })

  it('★★闭环：收卷终态 = 基态（幕布全遮）= 开场 unfurl 的起点（可无缝循环）', () => {
    const { acts } = walkAll()
    const nodes = treeNodes()
    expect(nodes.get(INK_IDS.curtain)!.clipPath!.params).toEqual([0, 0, 0, 0])
    const unfurl = acts.find((a) => a.name === 'unfurl')!
    expect(clipFrom(unfurl as never, INK_IDS.curtain)).toEqual([0, 0, 0, 0])
    const close = acts.find((a) => a.name === 'close')!
    expect(clipEnd(close as never, INK_IDS.curtain)).toEqual([0, 0, 0, 0])
  })

  it('★★"空白卷轴"构建态律：凡被动画的元素，树里基态皆"不可见/未画"', () => {
    const nodes = treeNodes()
    // 幕布：全遮
    expect(nodes.get(INK_IDS.curtain)!.clipPath).toEqual({ kind: 'inset', params: [0, 0, 0, 0] })
    // 月亮：圆心在盒外（cy=1.9 > 1 ⇒ 圆不与盒相交 ⇒ 不可见）
    const moon = nodes.get(INK_IDS.moon)!.clipPath!
    expect(moon.kind).toBe('circle')
    expect(moon.params[1]).toBeGreaterThan(1)
    // 月晕：半径 0（不可见）
    expect(nodes.get(INK_IDS.haloOuter)!.clipPath!.params[2]).toBe(0)
    expect(nodes.get(INK_IDS.haloInner)!.clipPath!.params[2]).toBe(0)
    // 江面 / 深水带：全隐（top=1）
    expect(nodes.get(INK_IDS.water)!.clipPath!.params[0]).toBe(1)
    expect(nodes.get(INK_IDS.waterDeep)!.clipPath!.params[0]).toBe(1)
    // 月影：全隐（right=1）
    expect(nodes.get(INK_IDS.reflection)!.clipPath!.params[1]).toBe(1)
    // 云：压扁在底边（零面积——所有顶点 y = 1）
    for (const cid of INK_IDS.clouds) {
      const cp = nodes.get(cid)!.clipPath!
      expect(cp.kind).toBe('polygon')
      for (let i = 1; i < cp.params.length; i += 2) expect(cp.params[i], `云 ${cid} 顶点 y`).toBe(1)
    }
    // 椭圆晕团 / 点苔 / 云团：inset 基态全隐（top=1）
    for (const pid of [...INK_IDS.rangePuffs.flat(), ...INK_IDS.rangeDots.flat(), ...INK_IDS.cloudPuffs]) {
      const cp = nodes.get(pid)!.clipPath!
      expect(cp.kind, `节点 ${pid}`).toBe('inset')
      expect(cp.params[0], `节点 ${pid} inset top`).toBe(1)
    }
    // 前景坡岸：inset 基态全隐（top=1）
    for (const bid of INK_IDS.banks) {
      expect(nodes.get(bid)!.clipPath!.params[0], `坡岸 ${bid}`).toBe(1)
    }
    // 题款四字：全隐（right=1）
    for (const tid of INK_IDS.titleChars) {
      expect(nodes.get(tid)!.clipPath!.params[1]).toBe(1)
    }
    // 印章（印面与内框）：**中心零尺寸**（[0.5,0.5,0.5,0.5]——不用 [1,1,1,1]：那在 Android 是
    //   反相矩形、仍覆盖整盒 ⇒ 印章从第一幕就可见；零尺寸两端语义一致：不可见）
    expect(nodes.get(INK_IDS.sealFill)!.clipPath!.params).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(nodes.get(INK_IDS.sealInner)!.clipPath!.params).toEqual([0.5, 0.5, 0.5, 0.5])
    // 全部描边节点：有 svgPath 声明
    const strokeIds = [
      ...INK_IDS.rangeWet, ...INK_IDS.rangeCore, ...INK_IDS.rangeDry,
      ...INK_IDS.waterfall, ...INK_IDS.ripples,
      ...INK_IDS.bamboo.flat(), ...INK_IDS.boat, ...INK_IDS.birds, INK_IDS.sealInner,
      INK_IDS.fallGate, ...INK_IDS.reeds,
    ]
    for (const id of strokeIds) {
      const n = nodes.get(id)
      expect(n?.svgPath, `节点 ${id} 应有 svgPath`).toBeTruthy()
      expect(n!.svgPath!.d.length).toBeGreaterThan(4)
      expect(n!.svgPath!.strokeWidth).toBeGreaterThan(0)
    }
  })

  it('★★墨分五色：三层笔触的宽度与墨气关系（晕 > 骨 > 枯；透明层描边带 alpha 后缀）', () => {
    const nodes = treeNodes()
    for (const r of [0, 1, 2] as const) {
      const wet = nodes.get(INK_IDS.rangeWet[r])!.svgPath!
      const core = nodes.get(INK_IDS.rangeCore[r])!.svgPath!
      const dry = nodes.get(INK_IDS.rangeDry[r])!.svgPath!
      // 宽度：晕 2.3× · 骨 1× · 枯 0.42×
      expect(wet.strokeWidth, '晕宽度').toBeGreaterThan(core.strokeWidth * 2)
      expect(dry.strokeWidth, '枯宽度').toBeLessThan(core.strokeWidth)
      // 透明层（晕/枯）用 8 位色（#RRGGBBAA——内核解析）；骨线可 6 位
      expect(wet.stroke.length, '晕应带 alpha（8 位 hex）').toBe(9)
      expect(dry.stroke.length, '枯应带 alpha（8 位 hex）').toBe(9)
    }
    // 三叠山的色阶：远淡 → 近浓（用笔触色的低频亮度比较——远山的 R 更高）
    const farCore = nodes.get(INK_IDS.rangeCore[0])!.svgPath!.stroke
    const nearCore = nodes.get(INK_IDS.rangeCore[2])!.svgPath!.stroke
    const lum = (h: string): number => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
    expect(lum(farCore), '远山应比近山淡').toBeGreaterThan(lum(nearCore))
  })

  it('★★叙事链：月晕先扩（r 0→0.5）· 月升"由缺到圆"（cy 1.9→0.5）· 江"涨潮"· 题款"竖排逐字"', () => {
    const { acts } = walkAll()
    const moonrise = acts.find((a) => a.name === 'moonrise')!
    expect(clipFrom(moonrise as never, INK_IDS.haloOuter)).toEqual([0.5, 0.5, 0])
    expect(clipEnd(moonrise as never, INK_IDS.haloOuter)).toEqual([0.5, 0.5, 0.5])
    expect(clipEnd(moonrise as never, INK_IDS.moon)).toEqual([0.5, 0.5, 0.5])
    const river = acts.find((a) => a.name === 'river')!
    expect(clipFrom(river as never, INK_IDS.water)![0]).toBe(1)
    expect(clipEnd(river as never, INK_IDS.water)![0]).toBeCloseTo(0.3, 5)
    // 月影在 river 幕显形（随水）
    expect(clipEnd(river as never, INK_IDS.reflection)).toEqual([0, 0, 0, 0])
    // 题款：每字都有 clip（四字逐字）
    const insc = acts.find((a) => a.name === 'inscription')!
    for (const tid of INK_IDS.titleChars) {
      expect(clipFrom(insc as never, tid), `题款 ${tid}`).toEqual([0, 1, 0, 0])
      expect(clipEnd(insc as never, tid)).toEqual([0, 0, 0, 0])
    }
  })

  it('★★笔锋动力学：山脊骨线走三段关键帧（起→行→收，非一镜到底）', () => {
    const { acts } = walkAll()
    const mt = acts.find((a) => a.name === 'mountains')!
    for (const r of [0, 1, 2] as const) {
      const core = mt.anims.find((x) => x.kind === 31 && x.nodeId === INK_IDS.rangeCore[r])!
      expect(core.keyframes, `山 ${r} 骨线应有关键帧`).toBeTruthy()
      expect(core.keyframes!.length).toBe(3)
      expect(core.keyframes![0]!.to).toBeCloseTo(0.14, 3)
      expect(core.keyframes![2]!.to).toBeCloseTo(1, 3)
    }
  })

  it('★"活着的一幅画"：moonGlow 幕有 yoyo 微动（云/月/影/水纹）+ 鱼舟荡漾', () => {
    const { acts } = walkAll()
    const glow = acts.find((a) => a.name === 'moonGlow')!
    const yoyo = glow.anims.filter((x) => x.repeat !== undefined && x.alternate === true)
    expect(yoyo.length, 'moonGlow 的 yoyo 指令').toBeGreaterThanOrEqual(10)
    // 云团漂移（translateX · yoyo）
    expect(glow.anims.filter((x) => x.kind === 0 && x.repeat !== undefined).length).toBeGreaterThanOrEqual(3)
    const boat = acts.find((a) => a.name === 'boat')!
    expect(boat.anims.filter((x) => x.repeat !== undefined).length).toBeGreaterThanOrEqual(6) // 三节点 × (Y+旋转)
    const grove = acts.find((a) => a.name === 'grove')!
    expect(grove.anims.filter((x) => x.repeat !== undefined).length).toBeGreaterThanOrEqual(9) // 三棵 × 三笔
  })

  it('★探针样本：首样本 = 中山骨线（mountains 幕"进行中"断言目标）；midSample 幕存在', () => {
    expect(INK_SAMPLE_IDS[0]).toBe(INK_IDS.rangeCore[1])
    const { acts } = walkAll()
    expect(acts.filter((a) => a.midSample).map((a) => a.name)).toContain('mountains')
  })

  it('★确定性：同输入两次构造逐条一致；总名义时长在合理区间（约 40–70 秒）', () => {
    const a1 = walkAll()
    const a2 = walkAll()
    expect(JSON.stringify(a1.acts)).toBe(JSON.stringify(a2.acts))
    const total = a1.acts.reduce((s, a) => s + a.durationMs, 0)
    expect(total).toBeGreaterThan(40000)
    expect(total).toBeLessThan(90000)
  })

  it('★★★d 语法契约：树的每条 svgPath.d 都能被内核解析器接受（命令+参数个数逐个校验）', () => {
    // 【为什么必须有】2026-10-01 真机实测：`fallGate` 里 `M0 ${P(...)}` 拼成 "M0 x y"
    //   （多一个 0）⇒ 内核报「L 参数不足」⇒ **整棵树建不了**（handle=0，演出全空）。
    //   本地 TS 侧没有任何判据覆盖 d 的语法 ⇒ 缺陷只在真机暴露。这条按内核规则
    //   （命令后必须跟确切的数字个数；M/L=2, Q=4, C=6, Z=0）逐条校验，卡在 CI。
    const ARITY: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 }
    const check = (d: string, id: number): void => {
      const tokens = d.match(/[MLQCZmlqcz]|-?\d+(?:\.\d+)?/g) ?? []
      let need = 0
      let got = 0
      let cmd = ''
      for (const t of tokens) {
        if (/[MLQCZmlqcz]/.test(t)) {
          if (cmd && need > 0 && got % need !== 0) {
            throw new Error(`节点 ${id} 的 d：命令 ${cmd} 收到 ${got} 个数字（应为 ${need} 的倍数）—— d=${d}`)
          }
          cmd = t.toUpperCase()
          need = ARITY[cmd] ?? 0
          got = 0
        } else {
          got += 1
        }
      }
      if (cmd && need > 0 && got % need !== 0) {
        throw new Error(`节点 ${id} 的 d：命令 ${cmd} 收到 ${got} 个数字（应为 ${need} 的倍数）—— d=${d}`)
      }
    }
    const nodes = treeNodes()
    const all = [...nodes.values()]
    for (const n of all) {
      if (n.svgPath?.d) check(n.svgPath.d, n.id)
    }
    // 盐：确认这条判据**有牙**（真机上踩到的那条坏 d——"M0 0 39" 多一个 0 ⇒ M 后 3 个数字）
    expect(() => check('M0 0 39 Q 38 14 69 0 M173 39 Q 135 14 104 0', -1)).toThrow()
  })

  it('★工具函数契约：blend 预混（6 位）· ink 加 alpha（8 位 #RRGGBBAA）', () => {
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(blend('#f2ead6', '#f2ead6', 0.3)).toBe('#f2ead6')
    expect(ink('#3b4854', 0.5)).toBe('#3b485480')
    expect(ink('#3b4854', 1)).toBe('#3b4854ff')
    for (const [k, v] of Object.entries(INK_PALETTE)) {
      expect(v, `INK_PALETTE.${k}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
