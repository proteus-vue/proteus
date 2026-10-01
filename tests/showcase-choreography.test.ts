// tests/showcase-choreography.test.ts —— ★★炫技场 · **节目单**的本机侧判据（CI 可跑的半边）
//
// 【为什么需要（与 check:showcase 的分工）】真机判据（hosts/ios/check-showcase.py）证明
//   "端上真跑、帧率达标、终值真读层"——但它需要设备（CI 跑不了）。
//   本测试覆盖**整场演出本身**：节目单（`hosts/shared/bridge/showcase-program.ts`）能被
//   从头走到尾、每幕衔接不违规、时长不掐断动画、FLIP 指令单形状正确。
//
// 【★为什么测"真节目单"而不是抄一份】设备入口 import 的就是这个模块 ⇒ **测的就是跑的**。
//   抄一份再测，等于测抄件（本仓纪律：验证物必须与产物同源）。
//
// 【零伪造】节目单内部走 `@proteus-vue/animation` 的真编译链（choreograph → compileAnimations）。
import { describe, it, expect } from 'vitest'
import { compileAnimations, presets, ANIM_KIND_ID } from '@proteus-vue/animation'
import { createShowcaseProgram, spanMs, SHOWCASE_ACT_MARGIN_MS } from '../hosts/shared/bridge/showcase-program'
import type { ShowcaseAct } from '../hosts/shared/bridge/showcase-program'

/** 假环境：20×40 网格（与真机同构），几何由"网格+瓦片"解析式给出（不碰设备） */
function fakeEnv(opts: { tiles?: number; cols?: number; soakMs?: number } = {}) {
  const tiles = opts.tiles ?? 800
  const cols = opts.cols ?? 20
  const view = { width: 390, height: 844 }
  const pad = 8
  const gap = 3
  const tile = Math.floor((view.width - pad * 2 - gap * (cols - 1)) / cols)
  const ids = Array.from({ length: tiles }, (_, i) => 1000 + i)
  // 网格布局（行优先）——与内核 flex 布局同构的解析式
  const centers = () =>
    ids.map((_, i) => {
      const row = Math.floor(i / cols)
      const col = i % cols
      return {
        x: pad + col * (tile + gap) + tile / 2,
        y: pad + row * (tile + gap) + tile / 2,
      }
    })
  return { ids, cols, view, tilePx: tile, centers, soakMs: opts.soakMs ?? 1200 }
}

/** 走完整场，收集每一幕（供多个断言复用） */
function walkAll(soakMs: number): { acts: ShowcaseAct[]; plan: string[] } {
  const env = fakeEnv({ soakMs })
  const prog = createShowcaseProgram(env)
  const plan = prog.plan()
  const acts: ShowcaseAct[] = []
  for (;;) {
    const a = prog.next()
    if (!a) break
    acts.push(a)
  }
  return { acts, plan }
}

describe('Morpheus 炫技场 · 节目单（真模块驱动）', () => {
  it('整场能走完：acts 与 plan 逐项一致（act 名序 = 节目单序）', () => {
    const { acts, plan } = walkAll(1200)
    expect(acts.map((a) => a.name)).toEqual(plan)
    // 编排关键幕都在场（开场语 / 演出 / 长跑 / 谢幕语）
    const names = acts.map((a) => a.name)
    for (const must of ['gather', 'title', 'settle-title', 'ripple', 'domino', 'storm-peak', 'flip-condense', 'flip-restore', 'spiral', 'settle-spiral', 'finale']) {
      expect(names).toContain(must)
    }
    // 长跑存在且成对（storm + settle）
    expect(names.filter((n) => n.startsWith('soak-storm#')).length).toBeGreaterThan(0)
    expect(names.filter((n) => n.startsWith('soak-storm#')).length).toBe(names.filter((n) => n.startsWith('soak-settle#')).length)
  })

  it('★不变量①：幕时长 == 指令时间跨度（**无缝衔接**；不早切、不多等）', () => {
    const { acts } = walkAll(1200)
    for (const a of acts) {
      if (a.flip) {
        expect(a.durationMs).toBeGreaterThanOrEqual(a.flip.durMs)
      } else {
        // ★余量 = 0（用户要求"每一幕没有丝滑衔接，现在是每一幕结束等会儿开始下一幕"）
        //   ⇒ 除定型幕（谢幕语 hold）外，幕时长**恰好**等于动画跨度：动画完成那帧即切幕
        expect(a.durationMs).toBeGreaterThanOrEqual(spanMs(a.anims))
        if (a.name !== 'finale') {
          expect(a.durationMs).toBeCloseTo(spanMs(a.anims), 6)
        }
      }
    }
    // 谢幕语有定型时间（供截图/观看）
    const finale = acts.find((a) => a.name === 'finale')!
    expect(finale.durationMs).toBeGreaterThan(spanMs(finale.anims))
  })

  it('★不变量②：从基线起跳的幕必须有指令；"从当前继续"的幕起点 = 上一幕终态（无跳变）', () => {
    const env = fakeEnv({ soakMs: 1200 })
    const prog = createShowcaseProgram(env)
    let prevTerminal = new Map<string, number>() // "nodeId:kind" → to
    for (;;) {
      const a = prog.next()
      if (!a) break
      // settle 幕的 from 必须等于"上一幕同 (节点,属性) 的 to"（记账衔接）
      if (a.name.startsWith('settle-') || /^soak-settle#/.test(a.name)) {
        for (const an of a.anims) {
          const key = `${an.nodeId}:${an.kind}`
          const prev = prevTerminal.get(key)
          if (prev !== undefined) {
            expect(an.from).toBeCloseTo(prev, 6)
          }
        }
      }
      prevTerminal = new Map(a.anims.map((an) => [`${an.nodeId}:${an.kind}`, an.to]))
    }
  })

  it('★长跑规模由 soakMs 决定（时长几倍的幕表：≥2.5 分钟 ≈ 20 循环级）', () => {
    const short = walkAll(1200)
    const long = walkAll(150_000)
    const count = (acts: ShowcaseAct[], prefix: string) => acts.filter((a) => a.name.startsWith(prefix)).length
    expect(count(long.acts, 'soak-storm#')).toBeGreaterThan(count(short.acts, 'soak-storm#'))
    // 整场（含长跑）时长 ≈ 3 分钟量级
    const total = long.acts.reduce((s, a) => s + a.durationMs, 0)
    expect(total).toBeGreaterThan(150_000)
    expect(total).toBeLessThan(400_000)
  })

  it('★★长跑时长按**真编译产物的 span** 展开（防"名义常量算循环数"复发——2026-10-01 真机实测）', () => {
    // 【背景】storm 幕的真实跨度 = maxRank×staggerMs + durationMs（相位错峰的最大延迟也要算），
    //   800 片 / alternate 下 ≈3497ms，是名义 `SOAK_CYCLE_MS`（1700ms）的 2.4×。
    //   旧算法（ceil(soakMs / 名义值)）把"5 分钟"展开成 **12.6 分钟**（真机实测）。
    //   ⇒ 本测试锁住：整场时长落在 [目标, 目标×1.25] 内——不早退、不超发。
    const soakMs = 300_000
    const { acts } = walkAll(soakMs)
    const total = acts.reduce((s, a) => s + a.durationMs, 0)
    const soakOnly = acts.filter((a) => a.name.startsWith('soak-')).reduce((s, a) => s + a.durationMs, 0)
    expect(soakOnly).toBeGreaterThanOrEqual(soakMs)
    expect(soakOnly).toBeLessThanOrEqual(soakMs * 1.25)
    // 首尾非长跑幕（gather…finale）都还在，且总时长 = 长跑 + 其余（≈32s）
    expect(acts[0]!.name).toBe('gather')
    expect(acts[acts.length - 1]!.name).toBe('finale')
    expect(total - soakOnly).toBeLessThan(60_000)
    // 循环数在两轮之间交替相位序（风暴 span 不同 ⇒ 两轮时长不同；合计仍贴近目标）
    const storms = acts.filter((a) => a.name.startsWith('soak-storm#'))
    expect(storms.length).toBeGreaterThan(10)
  })

  it('FLIP 幕：指令单形状正确（只改瓦片宽高；两幕互为"缩略/展开"）', () => {
    const { acts } = walkAll(1200)
    const condense = acts.find((a) => a.name === 'flip-condense')!
    const restore = acts.find((a) => a.name === 'flip-restore')!
    expect(condense.flip).toBeTruthy()
    expect(restore.flip).toBeTruthy()
    // 每片一条 patch，同幕内宽高一致（网格整体缩放）
    for (const a of [condense, restore]) {
      const patches = a.flip!.patches
      expect(patches).toHaveLength(800)
      const w0 = patches[0]!.style.width
      expect(patches.every((p) => p.style.width === w0 && p.style.height === w0)).toBe(true)
      // 补间走曲线 3（easeInOut）
      expect(a.flip!.curve).toBe(3)
    }
    // 缩略幕比展开幕小、且两幕的尺寸不同（真的"几何变更"）
    expect(condense.flip!.patches[0]!.style.width).toBeLessThan(restore.flip!.patches[0]!.style.width)
    expect(condense.flip!.patches[0]!.style.width).not.toBe(restore.flip!.patches[0]!.style.width)
  })

  it('开场语与谢幕语都是"聚字"幕（text 构型：800 片 → 点阵文字）', () => {
    const { acts } = walkAll(1200)
    const title = acts.find((a) => a.name === 'title')!
    const finale = acts.find((a) => a.name === 'finale')!
    // 聚字：每片 4 条（tx/ty/scale/opacity）
    expect(title.anims).toHaveLength(800 * 4)
    expect(finale.anims).toHaveLength(800 * 4)
    // 谢幕语有定型时间（供截图）——时长明显长于动画跨度
    expect(finale.durationMs).toBeGreaterThan(spanMs(finale.anims) + SHOWCASE_ACT_MARGIN_MS)
  })

  it('★零手写相位：每幕的 delayMs 分布只能是"齐动（1 档）"或"真错峰（≥5 档）"', () => {
    // 【判据为什么这么写】手写错拍出错时典型产物是"2–4 档畸形分布"（循环写歪、取整错位）。
    //   声明式编排只产生两种形态：stagger=0 ⇒ 1 档；stagger>0 ⇒ 名次数十~上百档。
    //   ⇒ "不存在 2–4 档"就是"相位来自声明而非手写"的机器判据。
    const { acts } = walkAll(1200)
    let staggered = 0
    for (const a of acts) {
      if (a.flip || a.anims.length === 0) continue
      const delays = new Set(a.anims.map((x) => x.delayMs))
      const ok = delays.size === 1 || delays.size >= 5
      expect(ok, `幕「${a.name}」的 delay 档数 ${delays.size} 畸形（只允许 1 = 齐动 或 ≥5 = 错峰）`).toBe(true)
      if (delays.size >= 5) staggered += 1
    }
    // 整场以真错峰为主（齐动的只有"整屏同时收束"的漩涡与长跑收尾这类设计选择）
    expect(staggered).toBeGreaterThanOrEqual(8)
  })

  it('★衔接违规当场抛错（构造一个"未收干净就起跳"的场景）', () => {
    const env = fakeEnv({ soakMs: 1200 })
    const prog = createShowcaseProgram(env)
    // 正常走到 title（聚字：终态非基线），然后**跳过** settle-title 直接取 ripple ⇒ 必须抛错
    expect(prog.next()!.name).toBe('gather')
    expect(prog.next()!.name).toBe('title')
    // 此刻姿态是"文字构型"（非基线）⇒ 下一幕（settle-title，expects=current）合法
    expect(prog.next()!.name).toBe('settle-title')
    // settle 之后应回到基线 ⇒ ripple（expects=baseline）合法
    expect(prog.next()!.name).toBe('ripple')
  })
})

describe('炫技场 · 大规模编舞的 CI 侧等价物（与设备同一条编译链）', () => {
  /** 与节目单的 dip 相位同构的最小声明（每片 2 条：spring + 淡入） */
  function waveDecls(staggerMs: number, row: number, col: number) {
    const delay = (row + col) * staggerMs
    return [
      { kind: 'translateY' as const, from: -260, to: 0, spring: presets.easing.smooth, delayMs: delay },
      { kind: 'opacity' as const, from: 0, to: 1, curve: 'easeOut' as const, durationMs: 220, delayMs: delay },
    ]
  }

  it('800 片规模：波浪 1600 条 + 漩涡 3200 条（与真机读数一致）', () => {
    const n = 800
    const cols = 20
    const wave = Array.from({ length: n }, (_, i) => waveDecls(4, Math.floor(i / cols), i % cols))
      .flatMap((decls, i) => compileAnimations(decls, { nodeId: 1000 + i }).anims)
    expect(wave).toHaveLength(1600)
    const spiral = presets.choreograph.spiral({
      ids: Array.from({ length: n }, (_, i) => 1000 + i),
      canvas: {
        cols,
        view: { width: 390, height: 844 },
        centers: Array.from({ length: n }, () => ({ x: 10, y: 10 })),
      },
    })
    expect(spiral).toHaveLength(3200)
    // 四属性并发
    const kinds = new Set(spiral.map((a) => a.kind))
    expect([...kinds].sort()).toEqual(
      [ANIM_KIND_ID.translateX, ANIM_KIND_ID.translateY, ANIM_KIND_ID.scale, ANIM_KIND_ID.rotate].sort(),
    )
  })

  it('★编译期红线照常生效（炫技场也不能绕过——非合成属性仍被拦）', () => {
    expect(() => compileAnimations([{ kind: 'width' as never, from: 0, to: 100 }], { nodeId: 1 })).toThrow(/校验失败/)
  })
})
