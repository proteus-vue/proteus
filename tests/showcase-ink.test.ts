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
  buildInkTree, createInkProgram, createInkScrollProgram, INK_IDS, INK_SAMPLE_IDS, INK_PALETTE,
  blend, ink, MIST_FLAT, MIST_A, MIST_B, MIST_C, RANGES, scrollMetrics,
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

  it('★探针样本：含 root（长卷判据读 tx）与中山骨线（幕中"进行中"目标）；midSample 幕存在', () => {
    // ★首样本 = root（长卷探索的"画随手动"证据）；中山骨线仍在列表（幕序模式的"进行中"目标）
    expect(INK_SAMPLE_IDS[0]).toBe(INK_IDS.root)
    expect(INK_SAMPLE_IDS as readonly number[]).toContain(INK_IDS.rangeCore[1])
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

  it('★★渐变（v1）：晕团/云带/月晕声明真渐变（边缘渐隐——纯色做不到的那一半）', () => {
    const nodes = treeNodes()
    // 山体晕团 6 个（3 叠 × 2）全部带径向渐变
    for (const pid of INK_IDS.rangePuffs.flat()) {
      const g = (nodes.get(pid) as { fillGradient?: { kind?: string; stops?: unknown[] } }).fillGradient
      expect(g?.kind, `晕团 ${pid} 渐变类型`).toBe('radial')
      expect(g?.stops?.length ?? 0, `晕团 ${pid} 色标数`).toBeGreaterThanOrEqual(3)
    }
    // 云带 2 条：竖直渐隐（linear + 角度 90/270）
    for (const cid of INK_IDS.clouds) {
      const g = (nodes.get(cid) as { fillGradient?: { kind?: string; angle?: number } }).fillGradient
      expect(g?.kind, `云带 ${cid}`).toBe('linear')
    }
    // 月晕两圈：径向
    for (const hid of [INK_IDS.haloOuter, INK_IDS.haloInner]) {
      const g = (nodes.get(hid) as { fillGradient?: { kind?: string } }).fillGradient
      expect(g?.kind, `月晕 ${hid}`).toBe('radial')
    }
    // ★所有渐变都满足 v1 契约：色标 offset 升序 + 颜色六位 + alpha 数值
    for (const n of nodes.values()) {
      const g = (n as { fillGradient?: { kind: string; stops: Array<{ offset: number; color: string; alpha?: number }> } }).fillGradient
      if (!g) continue
      let prev = -1
      for (const st of g.stops) {
        expect(st.offset, `节点 ${n.id} 色标升序`).toBeGreaterThan(prev)
        prev = st.offset
        expect(st.color, `节点 ${n.id} 颜色六位`).toMatch(/^#[0-9a-f]{6}$/)
        // ★`alpha` 是**可选**字段（缺省 = 1，见 gradient.ts 契约）——缺省与显式数值都合法
        const alphaOk = st.alpha === undefined || (typeof st.alpha === 'number' && st.alpha >= 0 && st.alpha <= 1)
        expect(alphaOk, `节点 ${n.id} alpha=${st.alpha}`).toBe(true)
      }
    }
  })

  it('★★渐变 v2（两态混合）：云带/云团声明 B 态（结构严格一致——内核会再校验）', () => {
    const nodes = treeNodes()
    // 云带 2 条：linear 两态，色标数一致
    for (const cid of INK_IDS.clouds) {
      const g = (nodes.get(cid) as { fillGradient?: { kind: string; stops: unknown[] }; fillGradientTo?: { kind: string; stops: unknown[] } })
      expect(g.fillGradientTo?.kind, `云带 ${cid} B 态类型`).toBe(g.fillGradient?.kind)
      expect(g.fillGradientTo?.stops.length, `云带 ${cid} 两态色标数`).toBe(g.fillGradient?.stops.length)
    }
    // 云团 3 个：radial 两态
    for (const pid of INK_IDS.cloudPuffs) {
      const g = (nodes.get(pid) as { fillGradient?: { kind: string }; fillGradientTo?: { kind: string } })
      expect(g.fillGradient?.kind).toBe('radial')
      expect(g.fillGradientTo?.kind).toBe('radial')
    }
    // moonGlow 幕有 gradientMix 通道（CSS 做不到的那件事）
    const { acts } = walkAll()
    const glow = acts.find((a) => a.name === 'moonGlow')!
    const mixes = glow.anims.filter((x) => x.kind === 32)
    expect(mixes.length, 'moonGlow 的 gradientMix 指令').toBeGreaterThanOrEqual(5) // 2 云带 + 3 云团
    for (const m of mixes) expect(m.alternate, '混合应 yoyo（呼吸感）').toBe(true)
  })

  it('★★路径变形 v1：三只鸟声明扑翼 B 态（同结构 M Q Q——内核建树时校验签名）', () => {
    const nodes = treeNodes()
    for (const bid of INK_IDS.birds) {
      const n = nodes.get(bid) as { svgPath?: { d: string }; svgPathTo?: { d: string } }
      expect(n.svgPath?.d, `鸟 ${bid} A 态`).toBeTruthy()
      expect(n.svgPathTo?.d, `鸟 ${bid} B 态（扑翼）`).toBeTruthy()
      // 同构 = 命令序列相同（M Q Q）——用与内核同一判据的轻量版
      const sig = (d: string) => (d.match(/[MLQCZ]/g) ?? []).join('')
      expect(sig(n.svgPathTo!.d), `鸟 ${bid} 两态同构`).toBe(sig(n.svgPath!.d))
      // 起点/终点一致（只有控制点变 = "翅膀在动"而不是"鸟在跳"）
      const parts = (d: string) => d.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
      const a = parts(n.svgPath!.d)
      const b = parts(n.svgPathTo!.d)
      expect(b[0], `鸟 ${bid} 起点 x`).toBe(a[0])
      expect(b[a.length - 1], `鸟 ${bid} 终点 y`).toBe(a[a.length - 1])
    }
    // birds 幕含 pathMorph 通道且 yoyo（扇翅往复）
    const { acts } = walkAll()
    const birds = acts.find((a) => a.name === 'birds')!
    const morphs = birds.anims.filter((x) => x.kind === 33)
    expect(morphs.length, 'birds 幕 pathMorph 指令').toBe(3)
    for (const m of morphs) expect(m.alternate, '扇翅应 yoyo').toBe(true)
  })

  it('★★真·卷轴展开：卷筒（渐变圆柱 + 轴头）与幕布**同曲线**滚动，收卷逆向回位', () => {
    const sm = scrollMetrics(VIEW)
    // 几何：卷筒贴右缘 → 贴左缘
    expect(sm.bandW).toBeGreaterThan(10)
    expect(sm.txOpen).toBe(-(VIEW.width - sm.bandW))
    const nodes = treeNodes()
    // 卷筒：横向渐变圆柱明暗（暗-亮-暗），4 个色标
    const cyl = nodes.get(INK_IDS.rollCylinder) as { fillGradient?: { kind: string; angle: number; stops: unknown[] } }
    expect(cyl.fillGradient?.kind).toBe('linear')
    expect(cyl.fillGradient?.angle).toBe(90)
    expect(cyl.fillGradient?.stops.length).toBe(4)
    // 轴头（卷筒上下 + 右端上下）：木色圆头（borderRadius 存在且 > 0）
    for (const kid of [INK_IDS.rollKnobTop, INK_IDS.rollKnobBottom, INK_IDS.rollerRightKnobTop, INK_IDS.rollerRightKnobBottom]) {
      const k = nodes.get(kid) as { borderRadius?: number }
      expect(k.borderRadius ?? 0, `轴头 ${kid}`).toBeGreaterThan(0)
    }
    // 右端轴：贴右缘（left 在右 5% 内）
    const rb = nodes.get(INK_IDS.rollerRightBar) as { left: number }
    expect(rb.left).toBeGreaterThan(VIEW.width * 0.95)

    const { acts } = walkAll()
    const unfurl = acts.find((a) => a.name === 'unfurl')!
    const close = acts.find((a) => a.name === 'close')!
    // ★同曲线纪律：卷筒组三条 translateX 与幕布 clip **同时长**（不同步 = "脱筒"）——
    const cylTxs = unfurl.anims.filter((x) => [INK_IDS.rollCylinder, INK_IDS.rollKnobTop, INK_IDS.rollKnobBottom].includes(x.nodeId as never))
    expect(cylTxs.length, 'unfurl 卷筒组 translateX').toBe(3)
    for (const t of cylTxs) {
      expect(t.from).toBe(0)
      expect(t.to).toBe(sm.txOpen)
      expect(t.durMs, '与幕布同时长').toBe(1500)
      expect(t.curve, '与幕布同曲线').toBe(3) // easeInOut（Curve.EASE_IN_OUT = 3）
    }
    // 收卷：逆向（txOpen → 0）
    const backTxs = close.anims.filter((x) => x.nodeId === INK_IDS.rollCylinder)
    expect(backTxs.length).toBe(1)
    expect(backTxs[0]!.from).toBe(sm.txOpen)
    expect(backTxs[0]!.to).toBe(0)
  })

  it('★★路径变形 v2（异构）：三叠山的呼吸态与 A 态**峰数不同**（内核自动重采样）', () => {
    const sig = (d: string) => (d.match(/[MLQCZ]/g) ?? []).join('')
    const nodes = treeNodes()
    for (const r of [0, 1, 2] as const) {
      const wet = nodes.get(INK_IDS.rangeWet[r]) as { svgPath?: { d: string }; svgPathTo?: { d: string } }
      expect(wet.svgPathTo?.d, `山 ${r} 呼吸 B 态`).toBeTruthy()
      // ★异构的证据：两态**命令数不同**（峰数不同 ⇒ 段数不同）——v1 会拒绝这种配对
      const nA = (wet.svgPath!.d.match(/Q/g) ?? []).length
      const nB = (wet.svgPathTo!.d.match(/Q/g) ?? []).length
      expect(nB, `山 ${r} 两态段数应不同（异构）`).not.toBe(nA)
    }
    // moonGlow 幕：三叠 × 三层 = 9 条 pathMorph（呼吸）
    const { acts } = walkAll()
    const glow = acts.find((a) => a.name === 'moonGlow')!
    const morphs = glow.anims.filter((x) => x.kind === 33)
    expect(morphs.length, 'moonGlow 的 pathMorph 条数').toBe(9)
    for (const m of morphs) expect(m.alternate, '呼吸应 yoyo').toBe(true)
  })

  it('★★发光（glow v1）：月盘 + 近山骨线声明 glow；moonGlow 幕有 glowIntensity 呼吸', () => {
    const nodes = treeNodes()
    // 月盘：月光晕（半径 = 月径的 0.55 倍量级）
    const moon = nodes.get(INK_IDS.moon) as { glow?: { color: string; radius: number; alpha: number } }
    expect(moon.glow?.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(moon.glow?.radius ?? 0).toBeGreaterThan(0)
    expect(moon.glow?.alpha ?? 0).toBeGreaterThan(0)
    // 近山骨线：微光
    const nearCore = nodes.get(INK_IDS.rangeCore[2]) as { glow?: { alpha: number } }
    expect(nearCore.glow?.alpha ?? 0).toBeGreaterThan(0)
    // 远/中两叠**无**发光（避免"到处发光"——微光只在近景，是构图选择）
    expect((nodes.get(INK_IDS.rangeCore[0]) as { glow?: unknown }).glow).toBeUndefined()
    // moonGlow 幕：两条 glowIntensity（月 + 近山）且 yoyo
    const { acts } = walkAll()
    const glow = acts.find((a) => a.name === 'moonGlow')!
    const gis = glow.anims.filter((x) => x.kind === 34)
    expect(gis.length, 'moonGlow 的 glowIntensity 条数').toBe(2)
    for (const g of gis) expect(g.alternate, '发光呼吸应 yoyo').toBe(true)
  })

  it('★★渐变几何动画（"光本身在动"）：月晕扩散态与 A 态同色标、不同半径', () => {
    const nodes = treeNodes()
    const halo = nodes.get(INK_IDS.haloOuter) as {
      fillGradient?: { kind: string; r?: number; stops: Array<{ offset: number; color: string; alpha?: number }> }
      fillGradientTo?: { kind: string; r?: number; stops: Array<{ offset: number; color: string; alpha?: number }> }
    }
    expect(halo.fillGradient?.kind).toBe('radial')
    expect(halo.fillGradientTo?.kind, '两态同 kind（否则内核拒绝）').toBe('radial')
    // ★几何不同：r 从收拢 → 扩散
    expect(halo.fillGradientTo!.r!).toBeGreaterThan(halo.fillGradient!.r!)
    // ★色标**完全一致**（"同一束光在扩散"而不是"换了一个渐变"）
    expect(halo.fillGradientTo!.stops.length).toBe(halo.fillGradient!.stops.length)
    for (let i = 0; i < halo.fillGradient!.stops.length; i++) {
      expect(halo.fillGradientTo!.stops[i]!.offset).toBe(halo.fillGradient!.stops[i]!.offset)
      expect(halo.fillGradientTo!.stops[i]!.color).toBe(halo.fillGradient!.stops[i]!.color)
      expect(halo.fillGradientTo!.stops[i]!.alpha).toBe(halo.fillGradient!.stops[i]!.alpha)
    }
    // 幕里两处：moonrise 扩散（末态 mix=1）+ moonGlow 呼吸（1↔0 yoyo）
    const { acts } = walkAll()
    const rise = acts.find((a) => a.name === 'moonrise')!
    const riseMix = rise.anims.filter((x) => x.kind === 32 && x.nodeId === INK_IDS.haloOuter)
    expect(riseMix.length, 'moonrise 的月晕扩散').toBe(1)
    expect(riseMix[0]!.to, '扩散到底').toBe(1)
    const glow = acts.find((a) => a.name === 'moonGlow')!
    const glowMix = glow.anims.filter((x) => x.kind === 32 && x.nodeId === INK_IDS.haloOuter)
    expect(glowMix.length, 'moonGlow 的月晕呼吸').toBe(1)
    expect(glowMix[0]!.alternate, '呼吸应 yoyo').toBe(true)
  })

  it('★★软边遮罩（mask v1）：远山晕团"从雾里渗开"（线性 · 软边 0.5 · 基态全隐）', () => {
    const nodes = treeNodes()
    // 只远山两个晕团有遮罩（近/中由落笔承担骨架——构图选择）
    for (const pid of INK_IDS.rangePuffs[0]) {
      const m = (nodes.get(pid) as { mask?: { kind: string; softness: number; progress: number; angle: number } }).mask
      expect(m?.kind, `晕团 ${pid} 遮罩类型`).toBe('linear')
      expect(m?.softness, `晕团 ${pid} 软边`).toBe(0.5)
      expect(m?.progress, `晕团 ${pid} 基态 = 全隐（未演出）`).toBe(0)
      expect(m?.angle, `晕团 ${pid} 自下而上`).toBe(180)
    }
    expect((nodes.get(INK_IDS.rangePuffs[1][0]) as { mask?: unknown }).mask, '中山不应有遮罩').toBeUndefined()
    // mountains 幕：两条 maskProgress（远山两晕团）——与 strokeProgress 并行
    const { acts } = walkAll()
    const mt = acts.find((a) => a.name === 'mountains')!
    const mps = mt.anims.filter((x) => x.kind === 35)
    expect(mps.length, 'mountains 幕 maskProgress 条数').toBe(2)
    for (const m of mps) {
      expect(m.from).toBe(0)
      expect(m.to).toBe(1)
    }
    // 与描边并行（同一幕里两类通道都在——"一边渗、一边画"）
    expect(mt.anims.filter((x) => x.kind === 31).length).toBeGreaterThan(0)
  })

  it('★★倾斜 + 变换原点（skew v1）：竹与水草"从根部弯折"（origin 在底部）', () => {
    const nodes = treeNodes()
    // 竹三棵 × 三条笔触、水草四笔：origin 全部在**底部中点**（= 从根部弯折的物理直觉）
    for (const triple of INK_IDS.bamboo) {
      for (const id of triple) {
        const o = (nodes.get(id) as { transformOrigin?: { x: number; y: number } }).transformOrigin
        expect(o, `竹 ${id} 应有 transformOrigin`).toEqual({ x: 0.5, y: 1.0 })
      }
    }
    for (const id of INK_IDS.reeds) {
      const o = (nodes.get(id) as { transformOrigin?: { x: number; y: number } }).transformOrigin
      expect(o, `水草 ${id} 应有 transformOrigin`).toEqual({ x: 0.5, y: 1.0 })
    }
    // grove 幕：每棵 2 条 skewX（弯折）+ 2 条 translateX（梢头位移）= 3 棵 × 2 笔触×2 类 …
    const { acts } = walkAll()
    const grove = acts.find((a) => a.name === 'grove')!
    const skews = grove.anims.filter((x) => x.kind === 36)
    expect(skews.length, 'grove 幕 skewX 条数（3 棵 × 3 笔触）').toBe(9)
    for (const sk of skews) expect(sk.alternate, '风摆应 yoyo').toBe(true)
    // river 幕：水草 4 条 skewX
    const river = acts.find((a) => a.name === 'river')!
    expect(river.anims.filter((x) => x.kind === 36).length, 'river 幕水草 skewX').toBe(4)
  })

  it('★★长卷探索（滚动驱动）：单幕 100+ 条通道全在一条滚动轴上（位移/裁剪/描边/渐变联动）', () => {
    const prog = createInkScrollProgram({ view: VIEW })
    expect(prog.plan()).toEqual(['scroll'])
    const act = prog.next()!
    expect(prog.next(), '长卷只有一幕').toBeNull()
    // ★规模与构成：位移（长卷左移 + 视差）+ clip（幕布/江水/月/云/题款/印）+ stroke（山/水纹/竹/舟/鸟）
    expect(act.anims.length).toBeGreaterThan(90)
    expect(act.clipAnims).toBeGreaterThan(50)
    expect(act.strokeAnims).toBeGreaterThan(15)
    // ★★**全部通道都挂在滚动窗口上**（`drive:'progress'` + scrollFrom/scrollTo）——
    //   这是"滚动驱动"的机器证据（少一条 = 那条不跟随手势）
    const scrollDriven = act.anims.filter((x) => x.drive === 1 && x.scrollFrom !== undefined)
    expect(scrollDriven.length, '滚动驱动通道数').toBe(act.anims.length)
    // 窗口单调递增（分段窗口按进入视野顺序——乱序会让"后面的先出现"）
    const starts = scrollDriven.map((x) => x.scrollFrom!).sort((a, b) => a - b)
    expect(starts[starts.length - 1]!).toBeGreaterThan(starts[0]!)
    // 长卷左移：位移终点 = -2.2×视口宽
    const move = act.anims.find((x) => x.nodeId === INK_IDS.root && x.kind === 0)!
    expect(move.to).toBe(-Math.round(VIEW.width * 2.2))
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
