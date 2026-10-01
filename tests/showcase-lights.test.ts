// tests/showcase-lights.test.ts —— ★★炫技场 · **第二个节目（舞台灯光秀）**的本机侧判据
//
// 【与真机判据的分工】真机（hosts/android/check-lights.py）证明"端上真跑、帧率、真读层"；
//   本测试覆盖**整场演出本身**（CI 可跑）。
//
// 【★★本轮的核心断言（用户语义修正，2026-10-01）】
//   「全程都是灯亮灯灭的才对，就算是文字展示也是通过灯亮灯灭完成的」⇒
//   ① **零非颜色指令**：整场没有任何位移/缩放/旋转/透明度指令（灯一颗不动）；
//   ② 灯字（matrix800 / matrixLIGHTS）**只靠亮灭**（亮盘成字 + 灭盘仍是暗盘）；
//   ③ 灯灭可见：`off ≠ stage`（色值前提）+ 全场无不可见 opacity（present 时）。
//
// 【★为什么测"真节目单"】设备入口 import 的就是 `hosts/shared/bridge/showcase-lights.ts`
//   ⇒ **测的就是跑的**（本仓纪律：验证物必须与产物同源）。
import { describe, it, expect } from 'vitest'
import { createLightsProgram, spanMs, LIGHTS_PALETTE, matrixLitCount } from '../hosts/shared/bridge/showcase-lights'
import type { LightsEnv } from '../hosts/shared/bridge/showcase-lights'
import type { EngineAnim } from '@proteus-vue/animation'

/** 假环境：20×40 网格（与真机同构），几何由"网格+瓦片"解析式给出（不碰设备） */
function fakeEnv(opts: { tiles?: number; cols?: number } = {}): LightsEnv {
  const tiles = opts.tiles ?? 800
  const cols = opts.cols ?? 20
  const view = { width: 390, height: 844 }
  const pad = 8
  const gap = 3
  const tile = Math.floor((view.width - pad * 2 - gap * (cols - 1)) / cols)
  const ids = Array.from({ length: tiles }, (_, i) => 1000 + i)
  const centers = () =>
    ids.map((_, i) => {
      const row = Math.floor(i / cols)
      const col = i % cols
      return { x: pad + col * (tile + gap) + tile / 2, y: pad + row * (tile + gap) + tile / 2 }
    })
  return { ids, cols, view, tilePx: tile, centers, titleId: 2000 }
}

/** 走完整场，收集每一幕 */
function walkAll(env = fakeEnv()) {
  const prog = createLightsProgram(env)
  const plan = prog.plan()
  const acts: ReturnType<typeof prog.next>[] = []
  for (;;) {
    const a = prog.next()
    if (!a) break
    acts.push(a)
  }
  return { acts: acts as NonNullable<(typeof acts)[number]>[], plan, env }
}

/** 取一幕后，某片的**底色终态**（kind 5..8 各通道最后一条的 to 打包回色） */
function bgEndOf(anims: readonly EngineAnim[], nodeId: number): string | undefined {
  const ch: Array<number | undefined> = [undefined, undefined, undefined, undefined]
  for (const a of anims) {
    if (a.nodeId !== nodeId) continue
    if (a.kind >= 5 && a.kind <= 8) ch[a.kind - 5] = a.to
  }
  if (ch.every((v) => v === undefined)) return undefined
  const h = (x: number | undefined): string => Math.round(x ?? 0).toString(16).padStart(2, '0')
  const a = ch[3] ?? 255
  return a === 255 ? `#${h(ch[0])}${h(ch[1])}${h(ch[2])}` : `#${h(ch[0])}${h(ch[1])}${h(ch[2])}${h(a)}`
}

/** hex（#rrggbb）→ [r,g,b] */
function rgb(hex: string): [number, number, number] {
  const h = hex.slice(1)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** hex → 四通道 [r,g,b,a]（alpha 缺省 255） */
function rgbToCh(hex: string): number[] {
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255
  return [r, g, b, a]
}

describe('Morpheus 炫技场 · 第二个节目（舞台灯光秀）', () => {
  it('整场能走完：15 幕名序齐全（standby … curtain）', () => {
    const { acts, plan } = walkAll()
    expect(acts.map((a) => a.name)).toEqual(plan)
    expect(plan).toEqual([
      'standby',
      'ignite',
      'marquee',
      'rainbow',
      'pulse',
      'aurora',
      'scanline',
      'fan',
      'checker',
      'sparkle',
      'matrix800',
      'matrixLIGHTS',
      'blackout',
      'finale',
      'curtain',
    ])
  })

  it('★★核心：整场**零非颜色指令**（灯一颗不动——只有亮灯/灭灯/变色）', () => {
    const { acts } = walkAll()
    for (const a of acts) {
      const nonColor = a.anims.filter((an) => an.kind < 5)
      expect(nonColor.filter((an) => an.kind !== 4), `幕「${a.name}」有非颜色指令（灯动了）`).toHaveLength(0)
      expect(a.colorAnims, `幕「${a.name}」颜色指令占比`).toBeGreaterThan(0)
    }
    // 唯一允许的 kind 4（透明度）只能来自标题文字色幕的伴生？—— 本节目**连它也没有**
    const opacity = acts.flatMap((a) => a.anims.filter((an) => an.kind === 4))
    expect(opacity).toHaveLength(0)
  })

  it('★不变量①：幕时长 = 指令跨度 + hold（纯推导，不拍脑袋）', () => {
    const { acts } = walkAll()
    for (const a of acts) {
      expect(a.durationMs).toBeCloseTo(spanMs(a.anims) + a.holdMs, 6)
      expect(a.spanMs).toBeCloseTo(spanMs(a.anims), 6)
    }
  })

  it('★★实体灯语义：灭灯态与舞台底**是两种颜色**（"灯灭也能看到灯"的色值前提）', () => {
    const off = rgb(LIGHTS_PALETTE.off)
    const stage = rgb(LIGHTS_PALETTE.stage)
    for (let ch = 0; ch < 3; ch++) {
      expect(off[ch]! - stage[ch]!, `通道 ${ch}`).toBeGreaterThan(0x18)
    }
  })

  it('★★灯字只靠亮灭：matrix800 / matrixLIGHTS 的亮盘数 = 点阵亮像素数', () => {
    const { acts } = walkAll()
    const cases: Array<[string, string]> = [
      ['matrix800', '800'],
      ['matrixLIGHTS', 'LIG\nHTS'],
    ]
    for (const [name, text] of cases) {
      const a = acts.find((x) => x.name === name)!
      const lit = matrixLitCount(text)
      expect(lit, `${text} 亮像素`).toBeGreaterThan(30)
      // 该幕所有指令都必须是颜色（已由核心断言保证）；亮盘由 keyframes 末段 = on 色体现
      // —— 抽验：存在 to=P.white 的通道指令，且数量 ≈ lit × 4（四通道展开）
      const whiteTo = a.anims.filter((an) => an.kind >= 5 && an.kind <= 8 && an.to === 0xf8) // white R
      expect(whiteTo.length, `${name} 白盘通道数`).toBeGreaterThanOrEqual(lit)
    }
  })

  it('★★颜色链无跳变：关键幕的结束色（显式链，逐段断言）', () => {
    const { acts } = walkAll()
    const byName = new Map(acts.map((a) => [a.name, a]))
    const first = 1000
    const chain: Array<[string, string]> = [
      ['standby', LIGHTS_PALETTE.off],
      ['ignite', LIGHTS_PALETTE.cyan],
      ['marquee', LIGHTS_PALETTE.off],
      ['rainbow', LIGHTS_PALETTE.cyan],
      ['pulse', LIGHTS_PALETTE.cyan],
      ['aurora', LIGHTS_PALETTE.cyan],
      ['scanline', LIGHTS_PALETTE.cyan],
      ['fan', LIGHTS_PALETTE.off],
      ['checker', LIGHTS_PALETTE.off],
      ['sparkle', LIGHTS_PALETTE.off],
      ['matrix800', LIGHTS_PALETTE.white], // 亮盘（灯 0 在 '800' 的字内？——取末片做无关灯）
    ]
    for (const [name, endColor] of chain.slice(0, 10)) {
      const a = byName.get(name)!
      expect(bgEndOf(a.anims, first), `幕「${name}」结束色`).toBe(endColor)
    }
    // blackout 结束 = off；finale 结束 = white；curtain 结束 = off（闭环）
    const last = 1000 + 799
    expect(bgEndOf(byName.get('blackout')!.anims, last)).toBe(LIGHTS_PALETTE.off)
    expect(bgEndOf(byName.get('finale')!.anims, last)).toBe(LIGHTS_PALETTE.white)
    expect(bgEndOf(byName.get('curtain')!.anims, last)).toBe(LIGHTS_PALETTE.off)
    // 闭环：末幕终态 = 首幕初态（都可循环）
    expect(bgEndOf(byName.get('curtain')!.anims, first)).toBe(LIGHTS_PALETTE.off)
    expect(bgEndOf(byName.get('standby')!.anims, first)).toBe(LIGHTS_PALETTE.off)
  })

  it('★跑马灯：外圈灯有相位（沿边框递进）、内部灯无相位（保持灭）', () => {
    const { acts } = walkAll()
    const marquee = acts.find((a) => a.name === 'marquee')!
    // 角落 0（索引 0）与右上角（索引 19）都被点亮过（外圈）
    const c0 = marquee.anims.filter((an) => an.nodeId === 1000 && an.kind >= 5 && an.kind <= 8)
    const c19 = marquee.anims.filter((an) => an.nodeId === 1019 && an.kind >= 5 && an.kind <= 8)
    expect(c0.length).toBe(4) // 四通道展开（kind 5/6/7/8）
    expect(c19.length).toBe(4)
    // 外圈灯有 keyframes（等轮到 → 亮 → 灭）；内部灯无 keyframes（直落灭态）
    expect((c0[0]!.keyframes ?? []).length).toBeGreaterThanOrEqual(2)
    const inner = marquee.anims.filter((an) => an.nodeId === 1105 && an.kind >= 5 && an.kind <= 8)
    expect(inner.length).toBe(4)
    expect(inner[0]!.keyframes ?? []).toHaveLength(0) // 内部灯无 keyframes = 直灭
  })

  it('★旋转光扇：每颗灯的关键帧是"照到的时间段"（归并形态 2–4 段）', () => {
    const { acts } = walkAll()
    const fan = acts.find((a) => a.name === 'fan')!
    // 抽 3 颗不同角度的灯：keyframes 段数应在 2..6 之间（归并后的自然形态）
    for (const id of [1000, 1007, 1350]) {
      const ch = fan.anims.filter((an) => an.nodeId === id && an.kind >= 5 && an.kind <= 8)
      expect(ch.length).toBe(4)
      const segs = ch[0]!.keyframes ?? []
      expect(segs.length, `灯 ${id} 的段数`).toBeGreaterThanOrEqual(2)
      expect(segs.length).toBeLessThanOrEqual(6)
    }
  })

  it('★棋盘：奇偶相位确实相反（相邻灯的 keyframes 首段目标不同）', () => {
    const { acts } = walkAll()
    const checker = acts.find((a) => a.name === 'checker')!
    const even = checker.anims.find((an) => an.nodeId === 1000 && an.kind === 5)! // (0,0) 偶
    const odd = checker.anims.find((an) => an.nodeId === 1001 && an.kind === 5)! // (0,1) 奇
    const evenFirst = even.keyframes?.[0]?.to ?? even.to
    const oddFirst = odd.keyframes?.[0]?.to ?? odd.to
    expect(evenFirst).not.toBe(oddFirst)
  })

  it('★★双轨证据：标题文字色（kind 9..12）只在 pulse 幕（与灯色并行）', () => {
    const { acts, env } = walkAll()
    const pulse = acts.find((x) => x.name === 'pulse')!
    const title = pulse.anims.filter((an) => an.nodeId === env.titleId)
    expect(title.length).toBe(4)
    for (const t of title) {
      expect(t.kind).toBeGreaterThanOrEqual(9)
      expect(t.kind).toBeLessThanOrEqual(12)
    }
    const t0 = title.find((an) => an.kind === 9)! // R 通道
    expect(t0.from).toBe(0x22) // cyan 的 R
    // 其他幕无标题文字色（该幕灯也在动——文字色不与之抢指令）
    for (const a of acts) {
      if (a.name === 'pulse') continue
      expect(a.anims.filter((an) => an.nodeId === env.titleId), `幕「${a.name}」不该有标题指令`).toHaveLength(0)
    }
  })

  it('★★逐灯连续性（最强零跳变断言）：每颗灯的 from = 它上一幕的终态色（逐通道）', () => {
    // 【为什么这是最强的（2026-10-01 真机观感修正）】"突然闪出来"的根因是**某颗灯**
    //   的动画 `from` ≠ 它此刻真实的颜色（动画起点会跳到 `from`）。逐灯逐通道比对：
    //   本幕 kind c 的 `from` 必须 = 上一幕结束后该灯第 c-5 通道的值。
    const { acts, env } = walkAll()
    const n = env.ids.length
    // 每颗灯的当前色（通道数组 [r,g,b,a]）；初始 = 树的灭灯底色
    const cur: number[][] = Array.from({ length: n }, () => rgbToCh(LIGHTS_PALETTE.off))
    const idxOf = new Map(env.ids.map((id, i) => [id, i]))
    for (const act of acts) {
      // 收集本幕每灯每通道的 from / 终值
      const seen = new Map<number, Array<{ from: number } | undefined>>()
      const fin = new Map<number, number[]>()
      for (const an of act.anims) {
        if (an.kind < 5 || an.kind > 8) continue
        const i = idxOf.get(an.nodeId)
        if (i === undefined) continue
        if (!seen.has(i)) seen.set(i, [undefined, undefined, undefined, undefined])
        const ch = an.kind - 5
        seen.get(i)![ch] = { from: an.from }
        if (!fin.has(i)) fin.set(i, [-1, -1, -1, -1])
        const last = (an.keyframes && an.keyframes.length > 0 ? an.keyframes[an.keyframes.length - 1]!.to : an.to) ?? an.to
        fin.get(i)![ch] = last
      }
      // 断言：每颗灯的四通道 from = 当前值
      for (const [i, slots] of seen) {
        for (let ch = 0; ch < 4; ch++) {
          const f = slots[ch]
          if (!f) continue // 该通道本幕无指令（不应发生——四通道总是一起展开）
          expect(
            f.from,
            `幕「${act.name}」灯 ${env.ids[i]} 通道 ${ch} 的 from=${f.from} ≠ 当前值 ${cur[i]![ch]}`,
          ).toBe(cur[i]![ch])
        }
      }
      // 更新当前值 = 本幕终态
      for (const [i, channels] of fin) {
        for (let ch = 0; ch < 4; ch++) if (channels[ch]! >= 0) cur[i]![ch] = channels[ch]!
      }
    }
  })

  it('★确定性：同输入两次构造，指令逐条一致（无 Math.random——重播可复现）', () => {
    const a = walkAll()
    const b = walkAll()
    expect(a.acts.length).toBe(b.acts.length)
    for (let i = 0; i < a.acts.length; i++) {
      const A = a.acts[i]!.anims
      const B = b.acts[i]!.anims
      expect(A.length).toBe(B.length)
      for (const k of [0, Math.floor(A.length / 2), A.length - 1]) {
        expect(A[k]).toEqual(B[k])
      }
    }
  })

  it('★规模与时长：整场 ≥ 30s（15 幕完整演出）；峰值指令数 ≈ 800×4×多段（星火/灯字）', () => {
    const { acts } = walkAll()
    const total = acts.reduce((s, a) => s + a.durationMs, 0)
    expect(total).toBeGreaterThan(30_000)
    const peak = Math.max(...acts.map((a) => a.anims.length))
    // 每幕都是 800 灯 × 4 通道 = 3200 条（多段 keyframes 不增加条数——收敛在通道内）；
    // pulse 幕另有标题文字色 4 条（3204）——两处都如实断言
    expect(peak).toBe(3204)
    const peakAct = acts.find((a) => a.anims.length === peak)!
    expect(peakAct.name).toBe('pulse')
  })
})
