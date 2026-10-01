// tests/showcase-flip.test.ts —— ★★炫技场 · **第三个节目（维度折叠）**的本机侧判据（CI 可跑）
//
// 【主题（用户："从 3D 和 2D 之间不断转换的主题，综合新增能力做到天花板"）】
//   2D 平面宇宙 ↔ 3D 立体空间的反复穿越；**颜色 = 第三维度的语言**（平面=白纸，立体=色彩涌现）。
//
// 【本测试守什么】9 幕走完 · 三组新能力（任意缓动 / 3D / 循环 / 播放控制）逐幕在场 ·
//   **3D 数值连续性**（每幕 from = 上一幕终态——幕间不跳变）· **颜色链自洽**（同一条叙事）·
//   闭环（谢幕终态 = 开场起点，可循环）· 确定性。
import { describe, it, expect } from 'vitest'
import { createFlipProgram, FLIP_CURVES, FLIP_PALETTE, foldColorOf } from '../hosts/shared/bridge/showcase-flip'
import type { FlipEnv } from '../hosts/shared/bridge/showcase-flip'
import { spanMs } from '../hosts/shared/bridge/showcase-lights'

/** 假环境：20×40 网格（与真机同构） */
function fakeEnv(opts: { tiles?: number; cols?: number } = {}): FlipEnv {
  const tiles = opts.tiles ?? 800
  const cols = opts.cols ?? 20
  const view = { width: 390, height: 844 }
  const ids = Array.from({ length: tiles }, (_, i) => 1000 + i)
  return { ids, cols, view, tilePx: 15, centers: () => ids.map(() => ({ x: 0, y: 0 })), titleId: -1 }
}

function walkAll(env = fakeEnv()) {
  const prog = createFlipProgram(env)
  const plan = prog.plan()
  const acts: ReturnType<typeof prog.next>[] = []
  for (;;) {
    const a = prog.next()
    if (!a) break
    acts.push(a)
  }
  return { acts: acts as NonNullable<(typeof acts)[number]>[], plan, env }
}

/**
 * 幕的 3D 终态（按轴取"最终值"；无指令 = null）。
 *
 * ★必须实现 yoyo 语义（2026-10-01 测试自查抓出的算法错）：`repeat` 偶次 + `alternate`
 *   时**末轮反向**——终态 = `from`（第 2 遍从 `to` 回到 `from`），不是 `to`。
 *   （首版算法直接取 `to` ⇒ 误报"torsion from≠终态"，其实节目单是对的。）
 */
function end3d(
  anims: readonly { kind: number; from: number; to: number; repeat?: number; alternate?: boolean; keyframes?: Array<{ to: number }> }[],
  kind: number,
): number | null {
  const list = anims.filter((a) => a.kind === kind)
  if (list.length === 0) return null
  const a = list[0]!
  if (a.repeat !== undefined && a.repeat > 1 && a.alternate && a.repeat % 2 === 0) {
    return a.from // yoyo 偶次 ⇒ 回到起点
  }
  const last = a.keyframes && a.keyframes.length > 0 ? a.keyframes[a.keyframes.length - 1]!.to : a.to
  return last
}

describe('Morpheus 炫技场 · 第三个节目（维度折叠）', () => {
  it('整场能走完：9 幕名序齐全（plane … finale）', () => {
    const { acts, plan } = walkAll()
    expect(acts.map((a) => a.name)).toEqual(plan)
    expect(plan).toEqual(['plane', 'lift', 'fan', 'torsion', 'flatten', 'spin', 'ripple', 'slowYaw', 'finale'])
  })

  it('★不变量：幕时长 = 指令跨度 + hold（纯推导）', () => {
    const { acts } = walkAll()
    for (const a of acts) {
      expect(a.durationMs).toBeCloseTo(spanMs(a.anims) + a.holdMs, 6)
      expect(a.spanMs).toBeCloseTo(spanMs(a.anims), 6)
    }
    expect(acts.at(-1)!.holdMs).toBeGreaterThan(0)
  })

  it('★★3D 数值连续性（幕间不跳变）：每幕 rotateX/rotateY 的 from = 上一幕终态', () => {
    const { acts } = walkAll()
    // 轴状态（初始 = 立正 0/0——与闭环一致）
    let curX = 0
    let curY = 0
    for (const act of acts) {
      for (const [kind, name, cur] of [
        [13, 'rotateX', () => curX],
        [14, 'rotateY', () => curY],
      ] as const) {
        const list = act.anims.filter((a) => a.kind === kind)
        if (list.length === 0) continue
        for (const a of list) {
          expect(a.from, `幕「${act.name}」${name} 的 from=${a.from} ≠ 当前 ${cur()}`).toBe(cur())
        }
      }
      // 更新状态为本幕终态
      const ex = end3d(act.anims, 13)
      const ey = end3d(act.anims, 14)
      if (ex !== null) curX = ex
      if (ey !== null) curY = ey
    }
  })

  it('★★颜色链（"第三维度"叙事）：暗→白→彩→(保持)→白→彩→(保持)→暗 逐幕自洽', () => {
    const { acts } = walkAll()
    const byName = new Map(acts.map((a) => [a.name, a]))
    const firstLamp = 1000
    const R = (hex: string): number => parseInt(hex.slice(1, 3), 16) // 取 R 通道比对
    const g = (a: (typeof acts)[number], i: number): number | null => {
      const list = a.anims.filter((x) => x.kind === 5 && x.nodeId === 1000 + i)
      return list.length > 0 ? (list[0]!.from as number) : null
    }
    // plane: dark → white
    const plane = byName.get('plane')!
    expect(g(plane, 0)).toBe(R(FLIP_PALETTE.dark))
    // plane 的颜色终值 = white（解开叙事起点）
    const planeColorEnd = plane.anims.filter((x) => x.kind === 5).find((x) => x.nodeId === firstLamp)!
    expect(planeColorEnd.to).toBe(R(FLIP_PALETTE.white))
    // lift: white → foldColorOf(i)
    const lift = byName.get('lift')!
    expect(g(lift, 0)).toBe(R(FLIP_PALETTE.white))
    expect(g(lift, 3)).toBe(R(FLIP_PALETTE.white))
    // flatten: foldColorOf(i) → white
    const flatten = byName.get('flatten')!
    expect(g(flatten, 5)).toBe(R(foldColorOf(5, 800)))
    // spin: white → foldColorOf(i)
    const spin = byName.get('spin')!
    expect(g(spin, 7)).toBe(R(FLIP_PALETTE.white))
    // finale: foldColorOf(i) → dark
    const finale = byName.get('finale')!
    expect(g(finale, 9)).toBe(R(foldColorOf(9, 800)))
    // fan / torsion / ripple / slowYaw 不发颜色指令（颜色保持——链由其余幕自洽）
    for (const nm of ['fan', 'torsion', 'ripple', 'slowYaw']) {
      expect(byName.get(nm)!.colorAnims, `幕「${nm}」不应发颜色指令（保持上一幕色）`).toBe(0)
    }
  })

  it('★★能力覆盖 · 3D：全部 9 幕都有 rotateX/rotateY；关键终值符合"维度"设计', () => {
    const { acts } = walkAll()
    const with3d = acts.filter((a) => a.rotate3dAnims > 0)
    expect(with3d.length, '每幕都要有 3D 指令').toBe(9)
    const byName = new Map(acts.map((a) => [a.name, a]))
    expect(end3d(byName.get('plane')!.anims, 13)).toBe(-85) // 拍平成地面
    expect(end3d(byName.get('lift')!.anims, 13)).toBe(0) // 立起成墙
    expect(end3d(byName.get('flatten')!.anims, 13)).toBe(-85) // 再砸平
    expect(end3d(byName.get('spin')!.anims, 13)).toBe(0) // 立起
    expect(end3d(byName.get('slowYaw')!.anims, 14)).toBe(180) // 慢翻半圈
    expect(end3d(byName.get('finale')!.anims, 14)).toBe(0) // 归位
  })

  it('★★能力覆盖 · 任意缓动：elastic/backOut/anticipate 三张曲线各承担一种"运动性格"', () => {
    const { acts } = walkAll()
    const byName = new Map(acts.map((a) => [a.name, a]))
    const eq = (x: unknown, y: readonly number[]): boolean => JSON.stringify(x) === JSON.stringify(y)
    const has = (nm: string, c: readonly number[]): boolean =>
      byName.get(nm)!.anims.some((a) => eq(a.curveBezier, c))
    expect(has('plane', FLIP_CURVES.elastic), 'plane 用弹性（一拍即平）').toBe(true)
    expect(has('lift', FLIP_CURVES.backOut), 'lift 用回弹（立起）').toBe(true)
    expect(has('flatten', FLIP_CURVES.anticipate), 'flatten 用预期（蓄力再砸）').toBe(true)
    expect(has('slowYaw', FLIP_CURVES.anticipate), 'slowYaw 用预期（蓄势再翻）').toBe(true)
    const total = acts.reduce((s, a) => s + a.curveBezierAnims, 0)
    expect(total).toBeGreaterThan(800)
  })

  it('★★能力覆盖 · 循环往复：fan（yoyo 2）/ torsion（双轴 yoyo 4）/ spin（rotateY yoyo 2）', () => {
    const { acts } = walkAll()
    const byName = new Map(acts.map((a) => [a.name, a]))
    const fan = byName.get('fan')!
    expect(fan.repeatAnims).toBe(800)
    expect(fan.anims.every((x) => x.repeat === 2 && x.alternate === true)).toBe(true)
    const tor = byName.get('torsion')!
    expect(tor.repeatAnims).toBe(1600) // 双轴各 800
    expect(tor.anims.filter((x) => x.kind === 13).every((x) => x.repeat === 4 && x.alternate === true)).toBe(true)
    const spin = byName.get('spin')!
    expect(spin.anims.filter((x) => x.kind === 14).every((x) => x.repeat === 2 && x.alternate === true)).toBe(true)
  })

  it('★★能力覆盖 · 播放控制：ripple 1.6× · slowYaw 0.3× · finale 恢复 1×（显式链）', () => {
    const { acts } = walkAll()
    const ctl = acts.filter((a) => a.control).map((a) => [a.name, a.control])
    // ★finale 必须显式恢复常速（真机抓出：变速幕不还原 ⇒ 谢幕/下一轮都在慢动作里跑）
    expect(ctl).toEqual([
      ['ripple', { timeScale: 1.6 }],
      ['slowYaw', { timeScale: 0.3 }],
      ['finale', { timeScale: 1 }],
    ])
  })

  it('★★闭环：谢幕终态（0°/0°/暗）= 开场 plane 的起点（独立 APK 可无缝循环）', () => {
    const { acts } = walkAll()
    const plane = acts.find((a) => a.name === 'plane')!
    const finale = acts.at(-1)!
    // 3D：finale 归位 0 → plane 从 0 起（拍平）
    expect(end3d(finale.anims, 14)).toBe(0)
    expect(plane.anims.find((a) => a.kind === 13)!.from).toBe(0)
    // 颜色：finale 沉入暗 → plane 从暗起（点亮纸面）
    expect(plane.anims.find((a) => a.kind === 5)!.from).toBe(parseInt(FLIP_PALETTE.dark.slice(1, 3), 16))
  })

  it('★确定性：同输入两次构造逐条一致；总名义时长在合理区间（含慢动作幕）', () => {
    const a = walkAll()
    const b = walkAll()
    for (let i = 0; i < a.acts.length; i++) {
      expect(a.acts[i]!.anims.length).toBe(b.acts[i]!.anims.length)
      const A = a.acts[i]!.anims
      const B = b.acts[i]!.anims
      for (const k of [0, Math.floor(A.length / 2), A.length - 1]) {
        expect(A[k]).toEqual(B[k])
      }
    }
    const total = a.acts.reduce((s, x) => s + x.durationMs, 0)
    expect(total).toBeGreaterThan(6_000)
    expect(total).toBeLessThan(30_000)
  })
})
