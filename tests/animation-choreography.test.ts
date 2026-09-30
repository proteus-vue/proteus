// tests/animation-choreography.test.ts —— ★★声明式编排层（choreograph）的单测
//
// 【为什么这些断言值钱（Morpheus 的"编排"主张）】编舞此前靠调用方**手写循环**算相位——
//   而这个仓库的立场是：能收敛进引擎的，不留给调用方（手写相位错了不会报错，只是"有点不齐"）。
//   ⇒ 本测试钉住三件事：
//   ① 相位序是**可判定**的（名次、tie-break、同输入同输出）；
//   ② 构型预设的输出**真来自编译链**（同一份校验/线格式；spring 走物理、keyframes 走序列）；
//   ③ 缺 `centers` 这类调用错误**当场抛错**（不许静默退化出错误构图）。
import { describe, it, expect } from 'vitest'
import {
  compileChoreography,
  staggerRanks,
  STAGGER_ORDERS,
  textBitmap,
  choreograph,
  terminalAttitudes,
  ANIM_KIND_ID,
} from '@proteus-vue/animation'
import type { AnimDecl } from '@proteus-vue/animation'

/** 6 片、3 列的规整网格（行 0-1），便于手算名次 */
const N6_COLS3 = 6

describe('Morpheus 编排层 · 相位序（staggerRanks）', () => {
  it('index：名次 = 序号（最朴素）', () => {
    expect(staggerRanks(5, 3, 'index')).toEqual([0, 1, 2, 3, 4])
  })

  it('diagonal：反对角线（row+col）齐动，同线按序号升序 tie-break', () => {
    // 3 列 ⇒ key=row+col：i0=0 · {i1,i3}=1 · {i2,i4}=2 · i5=3
    // 同 key 组内按序号升序 ⇒ i1 先于 i3、i2 先于 i4
    expect(staggerRanks(6, 3, 'diagonal')).toEqual([0, 1, 3, 2, 4, 5])
    // 4 列：i1(0,1) 与 i4(1,0) 同 key=1，i1 先
    const r2 = staggerRanks(8, 4, 'diagonal')
    expect(r2[1]).toBe(1)
    expect(r2[4]).toBe(2)
  })

  it('serpentine：偶数行左→右、奇数行右→左（蛇形）', () => {
    const r = staggerRanks(6, 3, 'serpentine')
    expect(r).toEqual([0, 1, 2, 5, 4, 3])
  })

  it('radialOut：中心先动；radialIn：正好相反（含 tie-break 的精确名次）', () => {
    // 3×3：中心 i4（d=0）· 四边中 {i1,i3,i5,i7}（d=1）· 四角 {i0,i2,i6,i8}（d=√2）
    const out = staggerRanks(9, 3, 'radialOut')
    expect(out).toEqual([5, 1, 6, 2, 0, 3, 7, 4, 8])
    const inn = staggerRanks(9, 3, 'radialIn')
    expect(inn).toEqual([0, 4, 1, 5, 8, 6, 2, 7, 3])
    expect(out[4]).toBe(0) // 正中 ⇒ 最先
    expect(inn[4]).toBe(8) // 正中 ⇒ 最后
    // ★方向关系：两者互为**镜像**（同一距离序、方向相反）——结构性质，不靠逐值枚举
    expect([...out].reverse().map((v) => 8 - v)).toEqual(inn)
  })

  it('alternate：奇偶两班倒（偶 0..、奇 从 ceil(n/2) 起）', () => {
    expect(staggerRanks(6, 3, 'alternate')).toEqual([0, 3, 1, 4, 2, 5])
  })

  it('★封闭集完备：每个 StaggerOrder 都能算出 0..n-1 的一个排列（无遗漏/无重复）', () => {
    for (const order of STAGGER_ORDERS) {
      const r = staggerRanks(13, 5, order)
      expect([...r].sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, i) => i))
    }
  })
})

describe('Morpheus 编排层 · 编译（compileChoreography）', () => {
  const ids = [10, 11, 12, 13]
  const canvas = { cols: 2, view: { width: 400, height: 800 }, centers: ids.map((_, i) => ({ x: 50 + i * 100, y: 100 })) }

  it('相位延迟 = nth × staggerMs，叠加在模板自带 delay 上（不覆盖）', () => {
    const anims = compileChoreography({
      ids,
      canvas,
      order: 'index',
      staggerMs: 25,
      make: () => [{ kind: 'translateX', from: 0, to: 10, curve: 'linear', durationMs: 100, delayMs: 5 }],
    })
    expect(anims.map((a) => a.delayMs)).toEqual([5, 30, 55, 80])
  })

  it('★编译失败带**片号**（800 片里"第 517 片声明非法"要能定位）', () => {
    expect(() =>
      compileChoreography({
        ids: [1, 2, 3],
        canvas,
        make: (c) => [c.i === 1 ? ({ kind: 'width' as never, to: 5 } as AnimDecl) : { kind: 'opacity', to: 1 }],
      }),
    ).toThrow(/编排第 1 片/)
  })

  it('★缺 centers 的构型预设**当场抛错**（不许静默退化出错误构图）', () => {
    const bare = { cols: 2, view: { width: 400, height: 800 } }
    expect(() => choreograph.spiral({ ids, canvas: bare })).toThrow(/centers/)
    expect(() => choreograph.text({ ids, canvas: bare, text: 'HI' })).toThrow(/centers/)
    expect(() => choreograph.gather({ ids, canvas: bare })).toThrow(/centers/)
  })
})

describe('Morpheus 编排层 · 构型预设（真编译产物）', () => {
  const ids = Array.from({ length: 6 }, (_, i) => 1000 + i)
  const canvas = {
    cols: 3,
    view: { width: 390, height: 844 },
    centers: ids.map((_, i) => ({ x: 60 + (i % 3) * 120, y: 120 + Math.floor(i / 3) * 120 })),
  }

  it('wave：spring 物理 + 对角相位（真 delay 分布，不是齐动）', () => {
    const anims = choreograph.wave({ ids, canvas, order: 'diagonal', staggerMs: 4 })
    expect(anims).toHaveLength(12) // 6 片 × 2（translateY + opacity）
    const ys = anims.filter((a) => a.kind === ANIM_KIND_ID.translateY)
    expect(ys.every((a) => a.spring)).toBe(true) // 真物理
    // 对角序：i0(0,0)=0 与 i1(0,1)=1 与 i3(1,0)=1 的延迟应满足 rank×4
    const ranks = staggerRanks(6, 3, 'diagonal')
    ys.forEach((a, i) => expect(a.delayMs).toBe(ranks[i]! * 4))
  })

  it('ripple：同节点 scale+opacity 各一条 keyframes 序列（两段：脉冲与回暖）', () => {
    const anims = choreograph.ripple({ ids, canvas, order: 'radialOut', staggerMs: 10 })
    expect(anims).toHaveLength(12)
    for (const a of anims) {
      expect(a.keyframes).toHaveLength(2)
      expect(a.durMs).toBe(760) // 两段之和（编译器由 keyframes 求和落定）
      expect(a.keyframes!.map((k) => k.durMs)).toEqual([380, 380])
    }
  })

  it('spiral：位移 = 目标 − **当前**（用 centers 里的真实几何）+ 三圈角度分布', () => {
    const anims = choreograph.spiral({ ids, canvas, turns: 3 })
    expect(anims).toHaveLength(24) // 6 × 4
    // 逐片核对：tx = cx + cos(ang)·r − c.x
    ids.forEach((_id, i) => {
      const tx = anims.find((a) => a.nodeId === ids[i] && a.kind === ANIM_KIND_ID.translateX)!
      const ang = (i / 6) * Math.PI * 2 * 3
      const rad = (Math.min(390, 844) / 2) * (0.05 + 0.85 * (i / 6))
      const expect_ = 195 + Math.cos(ang) * rad - canvas.centers[i]!.x
      expect(tx.to).toBeCloseTo(expect_, 6)
      expect(tx.from).toBe(0)
    })
  })

  it('settle：四属性收归基线，起点 = **传入的当前姿态**（不给 ⇒ 抛错，不瞬移归零）', () => {
    // 不给 attitudes ⇒ 当场抛错（内核 from 必填——"缺省=当前值"是错误假设）
    expect(() => choreograph.settle({ ids, canvas })).toThrow(/attitudes/)
    const attitudes = ids.map(() => ({ tx: 120, ty: -80, rotate: 45, scale: 0.35, opacity: 0.8 }))
    const anims = choreograph.settle({ ids, canvas: { ...canvas, attitudes } })
    expect(anims).toHaveLength(30) // 6 × 5（四变换 + 透明度）
    for (const a of anims) {
      // 终点归一
      if (a.kind === ANIM_KIND_ID.scale || a.kind === ANIM_KIND_ID.opacity) expect(a.to).toBe(1)
      else expect(a.to).toBe(0)
    }
    // 起点 = 传入姿态（不是 0——那会瞬移）
    const tx0 = anims.find((a) => a.nodeId === ids[0] && a.kind === ANIM_KIND_ID.translateX)!
    expect(tx0.from).toBe(120)
    const sc0 = anims.find((a) => a.nodeId === ids[0] && a.kind === ANIM_KIND_ID.scale)!
    expect(sc0.from).toBe(0.35)
  })

  it('★terminalAttitudes：从指令批提取终态（settle 的"记账"来源；同片同属性取最后一条）', () => {
    const spiralAnims = choreograph.spiral({ ids, canvas })
    const atts = terminalAttitudes(spiralAnims, ids)
    // 螺旋末态：scale → 0.35、rotate → 非零、tx/ty → 目标位移
    expect(atts).toHaveLength(6)
    for (const a of atts) {
      expect(a.scale).toBe(0.35)
      expect(Math.abs(a.rotate ?? 0)).toBeGreaterThan(100)
    }
    const tx0 = spiralAnims.find((a) => a.nodeId === ids[0] && a.kind === ANIM_KIND_ID.translateX)!
    expect(atts[0]!.tx).toBeCloseTo(tx0.to, 6)
    // 再把"螺旋末态"喂给 settle ⇒ 起点连续（这就是多幕衔接的记账闭环）
    const settleAnims = choreograph.settle({ ids, canvas: { ...canvas, attitudes: atts } })
    const s0 = settleAnims.find((a) => a.nodeId === ids[0] && a.kind === ANIM_KIND_ID.translateX)!
    expect(s0.from).toBeCloseTo(tx0.to, 6)
    expect(s0.to).toBe(0)
  })

  it('domino：rotate/scale 各一条两段序列（倒下→弹回，奇偶反向）', () => {
    const anims = choreograph.domino({ ids, canvas, order: 'serpentine', staggerMs: 6 })
    expect(anims).toHaveLength(12)
    const rotates = anims.filter((a) => a.kind === ANIM_KIND_ID.rotate)
    expect(rotates.every((a) => a.keyframes?.length === 2)).toBe(true)
    // 首片（偶）向正、次片（奇）向负
    expect(rotates[0]!.keyframes![0]!.to).toBeGreaterThan(0)
    expect(rotates[1]!.keyframes![0]!.to).toBeLessThan(0)
  })

  it('★text：亮像素数来自点阵表；亮点元素收敛到字符像素、其余成星尘', () => {
    const bm = textBitmap('HI')
    // H 与 I 的亮像素数：H=2+2+2+5+2+2+2=17？——按字表逐行数：H 行 '#...#'×6 + '#####' = 2×6+5 = 17
    // I = '#####'(5) + '..#..'×5 + '#####'(5) = 15；两字之间 1 列字距 ⇒ 共 17+15 = 32 亮像素
    expect(bm.lit).toHaveLength(32)
    expect(bm.width).toBe(11) // 5 + 1(字距) + 5
    expect(bm.height).toBe(7)
    const ids20 = Array.from({ length: 20 }, (_, i) => 2000 + i)
    const c20 = { cols: 5, view: { width: 390, height: 844 }, centers: ids20.map((_, i) => ({ x: i * 19, y: 40 })) }
    const anims = choreograph.text({ ids: ids20, canvas: c20, order: 'diagonal', text: 'HI' })
    expect(anims).toHaveLength(20 * 4)
    // 前 20 片**全部**成为亮点（亮像素 32 > 元素 20 ⇒ 缺笔画；此断言钉住"按序取前 N"的语义）
    const scales = anims.filter((a) => a.kind === ANIM_KIND_ID.scale)
    expect(scales.every((a) => a.to === 0.42)).toBe(true) // 全亮 ⇒ 全 0.42
  })

  it('text：元素多于亮像素时，其余为星尘（scale/opacity 有界、且非 1）', () => {
    const ids40 = Array.from({ length: 40 }, (_, i) => 3000 + i)
    const c40 = { cols: 8, view: { width: 390, height: 844 }, centers: ids40.map((_, i) => ({ x: i * 9, y: 40 })) }
    const anims = choreograph.text({ ids: ids40, canvas: c40, text: 'HI' })
    const scales = anims.filter((a) => a.kind === ANIM_KIND_ID.scale)
    const star = scales.slice(32)
    expect(star).toHaveLength(8)
    for (const a of star) {
      expect(a.to).toBeGreaterThan(0.1)
      expect(a.to).toBeLessThan(0.4)
    }
    // 确定性：同输入 ⇒ 同输出（星尘不能用 Math.random）
    const again = choreograph.text({ ids: ids40, canvas: c40, text: 'HI' })
    expect(JSON.stringify(again)).toBe(JSON.stringify(anims))
  })

  it('gather：位移起点沿径向外推（spread 倍），spring 物理收敛回原位', () => {
    const anims = choreograph.gather({ ids, canvas, spread: 2 })
    expect(anims).toHaveLength(18) // 6 × 3（tx/ty/opacity）
    const tx = anims.find((a) => a.nodeId === ids[0] && a.kind === ANIM_KIND_ID.translateX)!
    // 片 0 中心 (60,120)，屏心 (195,422) ⇒ from = (60-195)*2 = -270，to = 0
    expect(tx.from).toBeCloseTo(-270, 6)
    expect(tx.to).toBe(0)
    expect(tx.spring).toBeTruthy()
  })

  it('storm：五属性并发（单帧负载最重的构型）+ alternate 相位两班倒', () => {
    const anims = choreograph.storm({ ids, canvas, order: 'alternate', staggerMs: 8 })
    expect(anims).toHaveLength(30) // 6 × 5
    const ranks = staggerRanks(6, 3, 'alternate')
    anims.forEach((a, i) => {
      const piece = Math.floor(i / 5)
      expect(a.delayMs).toBe(ranks[piece]! * 8)
    })
    // 每片五属性齐全
    for (const id of ids) {
      const kinds = anims.filter((a) => a.nodeId === id).map((a) => a.kind).sort()
      expect(kinds).toEqual([
        ANIM_KIND_ID.translateX, ANIM_KIND_ID.translateY, ANIM_KIND_ID.scale, ANIM_KIND_ID.rotate, ANIM_KIND_ID.opacity,
      ].sort())
    }
  })
})

describe('Morpheus 编排层 · 点阵字体（bitmap-font）', () => {
  it('未知字符按空格处理（不抛错）；小写转大写', () => {
    const a = textBitmap('a~')
    const b = textBitmap('A ')
    expect(a.lit.length).toBe(b.lit.length)
    expect(a.text).toBe('A~')
  })

  it('空格无亮像素；"-" 只有中间一行', () => {
    expect(textBitmap(' ').lit).toHaveLength(0)
    const dash = textBitmap('-')
    expect(dash.lit.every((p) => p.y === 3)).toBe(true)
    expect(dash.lit).toHaveLength(5)
  })

  it('★多行（`\\n`）：高度 = 行数×7 + 行间距；宽度 = 最长行；短行**在块内居中**', () => {
    const one = textBitmap('TILES')
    const two = textBitmap('800\nTILES')
    // 宽度：最长行还是 TILES（29 列）——两行不比单行宽
    expect(two.width).toBe(one.width)
    expect(one.width).toBe(4 * 6 + 5) // 5 字符 → (5-1)*6+5 = 29
    // 高度：两行 = 7 + 1(行隙) + 7 = 15
    expect(two.height).toBe(15)
    // ★"800"行在块内居中：(29 - 17) / 2 = 6 列偏移（左空 6 列、右空 6 列）
    const line1 = two.lit.filter((p) => p.y < 7)
    expect(Math.min(...line1.map((p) => p.x))).toBeGreaterThanOrEqual(6)
    expect(Math.max(...line1.map((p) => p.x))).toBeLessThanOrEqual(29 - 7)
    // 第二行的 y 从 8 起（7 + 行隙 1）
    const line2 = two.lit.filter((p) => p.y >= 8)
    expect(line2.length).toBeGreaterThan(0)
    expect(Math.min(...line2.map((p) => p.y))).toBe(8)
  })

  it('字形表内每个字符都是 7 行 × 5 列（数据自检——手写表最容易在这出错）', () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -!?'
    for (const ch of chars) {
      const bm = textBitmap(ch)
      const ys = new Set(bm.lit.map((p) => p.y))
      for (const y of ys) expect(y).toBeLessThan(7)
      for (const p of bm.lit) expect(p.x).toBeLessThan(5)
    }
  })
})

describe('Morpheus 编排层 · 聚字的点距与点大小（真机截图两轮打磨）', () => {
  const ids = Array.from({ length: 60 }, (_, i) => 4000 + i)
  const canvas = {
    cols: 10,
    view: { width: 390, height: 844 },
    centers: ids.map((_, i) => ({ x: 20 + (i % 10) * 35, y: 200 + Math.floor(i / 10) * 35 })),
  }

  it('★多行把字做大：同长度文本分两行 ⇒ 点距翻倍（`800\\nTILES` vs `800 TILES`）', () => {
    // 用"**终点坐标**的最小正步长"反推点距（位移 = 终点 − 中心，而每片中心不同 ⇒ 位移本身没有网格规律）
    const step = (anims: ReturnType<typeof choreograph.text>) => {
      const xs = [...new Set(ids.map((id, i) => {
        const tx = anims.find((a) => a.nodeId === id && a.kind === ANIM_KIND_ID.translateX)!.to
        return Math.round((tx + canvas.centers[i]!.x) * 1000) / 1000
      }))].sort((p, q) => p - q)
      const diffs = xs.slice(1).map((v, i) => v - xs[i]!).filter((v) => v > 0.5)
      return Math.min(...diffs)
    }
    // 两行：最长行 = TILES（29 列）⇒ gap = 390×0.9/29 ≈ 12.1
    const two = choreograph.text({ ids, canvas, text: '800\nTILES', elemPx: 15 })
    // 单行：53 列 ⇒ gap = 390×0.9/53 ≈ 6.6
    const one = choreograph.text({ ids, canvas, text: '800 TILES', elemPx: 15 })
    const s2 = step(two)
    const s1 = step(one)
    expect(s2 / s1).toBeGreaterThan(1.6)
    expect(s2 / s1).toBeLessThan(2.1)
  })

  it('★点大小自适应：给 `elemPx` ⇒ 点 ≈ 点距的 80%（不手填常量）', () => {
    const anims = choreograph.text({ ids, canvas, text: '800\nTILES', elemPx: 15 })
    const scale = anims.find((a) => a.kind === ANIM_KIND_ID.scale)!.to
    // gap ≈ 12.1 ⇒ scale ≈ 0.8×12.1/15 ≈ 0.645
    expect(scale).toBeGreaterThan(0.5)
    expect(scale).toBeLessThan(0.75)
    // 不给 elemPx ⇒ 退化为常量 0.42（兼容旧行为）
    const dflt = choreograph.text({ ids, canvas, text: 'HI' })
    expect(dflt.find((a) => a.kind === ANIM_KIND_ID.scale)!.to).toBe(0.42)
  })

  it('★星尘环收在屏内（0.36–0.42 × 宽 ⇒ 两侧不被裁）', () => {
    // 60 片、'800\nTILES' 亮像素数 > 60？——先确认：亮像素 TILES(29列×?)…直接取实际
    const bm = textBitmap('800\nTILES')
    const many = Array.from({ length: bm.lit.length + 40 }, (_, i) => 5000 + i)
    const c = { cols: 10, view: canvas.view, centers: many.map(() => ({ x: 30, y: 300 })) }
    const anims = choreograph.text({ ids: many, canvas: c, text: '800\nTILES', elemPx: 15 })
    // 星尘 = 索引 ≥ lit.length 的片；它们的终点（质心 + 位移）必须在屏内
    const dustStart = bm.lit.length
    for (let i = dustStart; i < many.length; i++) {
      const tx = anims.find((a) => a.nodeId === many[i] && a.kind === ANIM_KIND_ID.translateX)!.to
      const ty = anims.find((a) => a.nodeId === many[i] && a.kind === ANIM_KIND_ID.translateY)!.to
      const x = 30 + tx
      const y = 300 + ty
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(canvas.view.width)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(canvas.view.height)
    }
  })
})
