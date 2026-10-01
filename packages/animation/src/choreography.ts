// packages/animation/src/choreography.ts
// ★★Morpheus —— **声明式编排层**（choreography）：把"几百个元素谁先动、各自去哪"变成声明
//
// 【它解决什么问题（与既有分层的关系）】
//   · `compileAnimations` 已经能表达"**一个节点**做什么运动"（属性/曲线/时长/延迟）；
//   · `compileTimeline` 表达"同一个节点的多属性**严格同拍**"；
//   · 但"**800 个节点**按相位错峰、协同收束到某个构型"——此前只能靠调用方**手写循环**
//     （`for (i…) { delay = (row+col)*stagger; … }`）。
//   ⇒ 本模块就是那一层：**相位（谁先动）与构型（各自去哪）都由引擎的封闭集推导**，
//     调用方给出的是"意图"（斜向波浪 / 三圈漩涡 / 聚成这个词），不是循环与算术。
//
// 【为什么"手写循环"值得单独立一层（本仓纪律：能收敛的别留给调用方）】
//   ① 手写的相位算术**错了不会报错**——只是"看起来有点不齐"（典型静默缺陷）；
//   ② 相位/构型是**可枚举的封闭集**（'diagonal' / 'radialIn' / …），与曲线、属性同性质；
//   ③ 收敛后"800 片的编舞"变成**一句话**，且与单节点声明走**同一条编译链**（同一份校验、
//      同一份线格式、内核同一套求值）——不新增第二条求值路径。
//
// 【诚实边界】
//   · 本模块**不做**曲线求值/物理积分（那在 Rust 内核，唯一实现）；
//   · 相位不会改变"每帧的指令条数"——它决定的是 `delayMs` 的**分布**；
//   · 构型（placement）输出的是"目标位置"，位移量 = 目标 − **当前**（调用方从内核几何读回，
//     如宿主 `rects()`）——引擎不猜"当前在哪"。

import { compileAnimations } from './compile'
import { easing } from './easing'
import { textBitmap } from './bitmap-font'
import type { AnimDecl, CurveName, EngineAnim, SpringConfig } from './types'

/* ────────────────────────── 相位序（封闭集） ────────────────────────── */

/**
 * ★★**相位序**——决定"谁先动、谁后动"（`delayMs` 的分布）
 *
 * 每个序把 0..n-1 排成一个**名次**（rank）；第 `k` 名的相位延迟 = `k × staggerMs`。
 *
 * | 序 | 视觉 | 典型场景 |
 * |---|---|---|
 * | `index` | 按序号（行优先）依次 | 逐项入场（列表） |
 * | `diagonal` | 左上 → 右下（反对角线齐动） | 波浪扫过 |
 * | `serpentine` | 蛇形（翻转行） | 多米诺掠过 |
 * | `radialOut` | 中心 → 四周 | 涟漪扩散 |
 * | `radialIn` | 四周 → 中心 | 向心汇聚 |
 * | `alternate` | 奇偶交错（两班倒） | 高频闪动/风暴（避免单调） |
 */
export type StaggerOrder = 'index' | 'diagonal' | 'serpentine' | 'radialOut' | 'radialIn' | 'alternate'

/** 全部相位序（供枚举/文档/测试遍历——**新增序必须进这里**） */
export const STAGGER_ORDERS: readonly StaggerOrder[] = [
  'index',
  'diagonal',
  'serpentine',
  'radialOut',
  'radialIn',
  'alternate',
]

/**
 * 把 n 个元素按相位序排名（返回 `rank[i]`，0 = 最先动）
 *
 * ★并列时的次序规定为**序号升序**（tie-break 显式写出——不同 JS 引擎的排序稳定性
 *   不是契约，本仓要求"同输入同输出"，所以不依赖 sort 的稳定性）。
 * ★`radialIn/Out` 的距离用**网格坐标**（col/row）而不是真实像素中心——
 *   相位是"编排"（网格语义），不是几何测量；几何相关的量只在构型（placement）里出现。
 */
export function staggerRanks(n: number, cols: number, order: StaggerOrder = 'index'): number[] {
  const ranks = new Array<number>(n)
  if (n === 0) return ranks
  const c = Math.max(1, cols)
  const rowOf = (i: number): number => Math.floor(i / c)
  const colOf = (i: number): number => i % c
  switch (order) {
    case 'index':
      for (let i = 0; i < n; i++) ranks[i] = i
      return ranks
    case 'diagonal': {
      const keyed = Array.from({ length: n }, (_, i) => ({ i, key: rowOf(i) + colOf(i) }))
      keyed.sort((a, b) => a.key - b.key || a.i - b.i)
      keyed.forEach((e, k) => (ranks[e.i] = k))
      return ranks
    }
    case 'serpentine': {
      const rows = Math.ceil(n / c)
      let k = 0
      for (let r = 0; r < rows; r++) {
        const lo = r * c
        const hi = Math.min(lo + c, n)
        if (r % 2 === 0) {
          for (let i = lo; i < hi; i++) ranks[i] = k++
        } else {
          for (let i = hi - 1; i >= lo; i--) ranks[i] = k++
        }
      }
      return ranks
    }
    case 'radialOut':
    case 'radialIn': {
      const rows = Math.ceil(n / c)
      const cx = (c - 1) / 2
      const cy = (rows - 1) / 2
      const keyed = Array.from({ length: n }, (_, i) => ({
        i,
        key: Math.hypot(colOf(i) - cx, rowOf(i) - cy),
      }))
      // radialOut：近的先动（升序）；radialIn：远的先动（降序）
      keyed.sort((a, b) =>
        order === 'radialOut' ? a.key - b.key || a.i - b.i : b.key - a.key || a.i - b.i,
      )
      keyed.forEach((e, k) => (ranks[e.i] = k))
      return ranks
    }
    case 'alternate': {
      const half = Math.ceil(n / 2)
      let even = 0
      let odd = half
      for (let i = 0; i < n; i++) ranks[i] = i % 2 === 0 ? even++ : odd++
      return ranks
    }
  }
}

/* ────────────────────────── 编排编译 ────────────────────────── */

/** 二维点（视口坐标；用于"当前中心"与"目标构型"） */
export interface ChoreoPoint {
  x: number
  y: number
}

/** 编排画布：网格信息 + 视口 + 每片当前几何/姿态 */
export interface ChoreoCanvas {
  /** 网格列数（相位序的网格语义；必填） */
  cols: number
  /** 视口（构型预设用它把"比例"落成像素；必填） */
  view: { width: number; height: number }
  /**
   * 每片**当前中心**（视口坐标；`rects()` 读回的内核几何）。
   * 需要"位移到目标"的构型预设（spiral / text / gather）缺它 ⇒ 抛错（不静默退化）。
   */
  centers?: readonly ChoreoPoint[]
  /**
   * 每片**当前姿态**（变换值）——`settle` 用它作为"从哪收回来"的起点。
   *
   * 【为什么必须有（内核语义取证结论）】内核 FFI 的 `from` 是**必填**、TS 编译侧落 `0`
   *   （`compileOne: d.from ?? 0`）——**"缺省 = 节点当前值"这个说法是不成立的**
   *   （`types.ts` 曾如此注释，2026-09-30 纠正）。⇒ 要"从当前姿态收回基线"，
   *   必须由调用方给出当前值；`settle` 选择**报错**而不是静默从 0 出发（那会瞬移归零）。
   *
   * 数据来源（调用方自选，两者都合法）：
   *   · **记账**：上一幕 compile 产物的 `to` 值（幕时长 ≥ 动画时长时，实际终态 = 目标）；
   *   · **实读**：宿主层探针 / 内核状态导出（有则更稳）。
   */
  attitudes?: readonly ChoreoAttitude[]
}

/** 单片当前姿态（`settle` 的起点；缺省项按"基线"处理：位移/旋转 0、缩放/透明度 1） */
export interface ChoreoAttitude {
  tx?: number
  ty?: number
  rotate?: number
  scale?: number
  opacity?: number
}

/** 单片上下文（`make` 回调参数——**这就是"手写循环"里那些量的声明式替身**） */
export interface ChoreoCtx {
  /** 序号（0 起） */
  i: number
  /** 总数 */
  n: number
  /** 网格行/列 */
  row: number
  col: number
  /** 相位名次（由 `order` 推出） */
  nth: number
  /** 相位延迟 = `nth × staggerMs`（引擎已按此叠加到声明上；此处回显供构型使用） */
  delayMs: number
  /** 当前位置中心 */
  at: ChoreoPoint
}

/** 编排声明：`compileChoreography` 的入参 */
export interface ChoreoSpec {
  /** 参与编排的节点（按此顺序参与相位排名） */
  ids: readonly number[]
  canvas: ChoreoCanvas
  /** 相位序（缺省 `index`） */
  order?: StaggerOrder
  /** 相邻名次的错峰（ms；缺省 0 = 齐动） */
  staggerMs?: number
  /**
   * 每片做什么（返回声明；**不要在这里手写相位 delay**——引擎会把
   * `nth × staggerMs` 叠加到每条声明的 `delayMs` 上，模板自带的 delay 保留）
   */
  make: (c: ChoreoCtx) => readonly AnimDecl[]
}

/**
 * ★★**编译一场编排**（一组节点 → 一整批引擎指令）
 *
 * 与 `compileAnimations` 的关系：逐片复用同一条编译链（**同一份校验/线格式**），
 * 相位延迟由本函数按 `order × staggerMs` 推导后叠加——调用方**不写循环**。
 *
 * @returns 扁平化的整批指令（`{ anims: […] }` 直接可喂 `animStart`）
 * @throws 任一片的声明校验失败（带片号，可定位）
 */
export function compileChoreography(spec: ChoreoSpec): EngineAnim[] {
  const { ids, canvas, make } = spec
  const n = ids.length
  const c = Math.max(1, canvas.cols)
  const ranks = staggerRanks(n, c, spec.order ?? 'index')
  const staggerMs = spec.staggerMs ?? 0
  const out: EngineAnim[] = []
  for (let i = 0; i < n; i++) {
    const nth = ranks[i] ?? i
    const delayMs = nth * staggerMs
    const ctx: ChoreoCtx = {
      i,
      n,
      row: Math.floor(i / c),
      col: i % c,
      nth,
      delayMs,
      at: canvas.centers?.[i] ?? { x: 0, y: 0 },
    }
    const decls = make(ctx).map((d) => ({ ...d, delayMs: (d.delayMs ?? 0) + delayMs }))
    try {
      out.push(...compileAnimations(decls, { nodeId: ids[i]! }).anims)
    } catch (e) {
      // ★片号必须进消息（800 片里"第 517 片声明非法"要能一眼定位——否则等于没报）
      throw new Error(`编排第 ${i} 片（nodeId=${ids[i]}）编译失败：${(e as Error).message}`)
    }
  }
  return out
}

/* ────────────────────────── 终态提取（"从当前继续"的记账半边） ────────────────────────── */

/**
 * ★**从一批指令提取每片的终态姿态**（`settle` 的 `attitudes` 来源之一）
 *
 * 【为什么给引擎而不是留给调用方】"上一幕结束时每片停在什么姿态"是**编排的通用需求**
 *   （任何连续多幕的编排都要它）。让每个调用方各自归并 = 每个调用方各自可能归并错
 *   （漏掉 opacity、忘了 keyframes 的末段）⇒ 收敛到这里一份实现。
 *
 * 【语义】按 `nodeId` 归并：同片同属性取**最后一条**（与内核"同 (节点,属性) 替换"一致）；
 *   `keyframes` 的终值 = 末段 `to`（编译器已保证与声明 `to` 一致）。
 *   未在批里出现的属性按**基线**（位移/旋转 0、缩放/透明度 1）——与 `settle` 的缺省一致。
 *
 * ★诚实边界：这是**记账**（= "本该到达的终值"）。若上一幕被提前打断（幕时长不足），
 *   实际姿态会停在半途 ⇒ 记账值与实际不符。⇒ **调用方要保证幕时长 ≥ 动画时长**
 *   （本仓演示的幕表把这条写成了不变量并有判据查）。
 */
export function terminalAttitudes(
  anims: readonly EngineAnim[],
  ids: readonly number[],
): ChoreoAttitude[] {
  const idx = new Map<number, number>()
  ids.forEach((id, i) => idx.set(id, i))
  const out: ChoreoAttitude[] = ids.map(() => ({}))
  for (const a of anims) {
    const i = idx.get(a.nodeId)
    if (i === undefined) continue
    const at = out[i]!
    // ★各 kind 的终值落到对应字段（kind 编号与 AnimKind 同号——见 types.ts 契约）
    switch (a.kind) {
      case 0:
        at.tx = a.to
        break
      case 1:
        at.ty = a.to
        break
      case 2:
        at.scale = a.to
        break
      case 3:
        at.rotate = a.to
        break
      case 4:
        at.opacity = a.to
        break
    }
  }
  return out
}

/* ────────────────────────── 预设所需的小工具 ────────────────────────── */

/** 确定性伪随机（0..1）——"星尘"散布用它：**同输入同画面**（可复现，不是 Math.random） */
function hash01(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

function viewCenter(view: { width: number; height: number }): ChoreoPoint {
  return { x: view.width / 2, y: view.height / 2 }
}

/** 取每片当前中心；缺失 ⇒ 抛错（带"怎么修"的说明——不静默退化） */
function needCenters(canvas: ChoreoCanvas, who: string): readonly ChoreoPoint[] {
  const cs = canvas.centers
  if (!cs || cs.length === 0) {
    throw new Error(
      `${who} 需要 \`canvas.centers\`（每片当前中心）——位移量 = 目标 − 当前，引擎不猜当前在哪。` +
        '请先从内核几何读回（宿主 `rects()`）再传入。',
    )
  }
  return cs
}

/* ────────────────────────── choreograph 预设（"一句话一场编舞"） ────────────────────────── */

/** 编排场景（预设们的公共入参；**一行代码一场戏**的"那行"） */
export interface ChoreoScene {
  ids: readonly number[]
  canvas: ChoreoCanvas
  /** 相位序（缺省 `index`） */
  order?: StaggerOrder
  /** 相邻名次错峰（ms；缺省 0） */
  staggerMs?: number
}

/**
 * ★为什么每个预设只收**一个**配置对象（而不是 `(scene, opts)` 两个袋子）
 *
 * 【这是被自己的测试抓出来的设计缺陷】两袋形态下，把 `spread` 写进 scene 袋会被
 *   **静默忽略**（TS 结构化类型不报错：多出的键只对字面量做多余属性检查，
 *   变量传参就漏）——"传了参数却没生效"正是本仓最忌讳的静默缺陷。
 *   ⇒ 合并为单袋：所有字段平铺，多写/写错位置没有"另一只袋子"可躲。
 */
const specOf =
  (scene: ChoreoScene) =>
  (make: (c: ChoreoCtx) => readonly AnimDecl[]): ChoreoSpec => ({
    ids: scene.ids,
    canvas: scene.canvas,
    order: scene.order,
    staggerMs: scene.staggerMs,
    make,
  })

/**
 * ★★**编排预设库**（与 `presets.*` 同一"预设优先"哲学：一句话，不写循环）
 *
 * ```ts
 * // 800 片按对角相位错峰 4ms 弹回原位（斜向波浪）
 * const anims = presets.choreograph.wave({ ids, canvas, order: 'diagonal', staggerMs: 4 })
 * node.animStart(JSON.stringify({ anims }))
 * ```
 */
export const choreograph = {
  /**
   * **波浪**：每片从 `from` 偏移处弹回布局位（spring 物理），随相位错峰扫过。
   * 方向由 `dir` 决定（`down` = 从上方向下扫；`up` = 从下方向上托）。
   */
  wave(
    scene: ChoreoScene & { dir?: 'down' | 'up'; magnitude?: number; spring?: SpringConfig; fadeMs?: number },
  ): EngineAnim[] {
    const mag = scene.magnitude ?? 260
    const from = scene.dir === 'up' ? mag : -mag
    const spring = scene.spring ?? easing.smooth
    const fadeMs = scene.fadeMs ?? 220
    return compileChoreography(
      specOf(scene)(() => [
        { kind: 'translateY', from, to: 0, spring },
        { kind: 'opacity', from: 0, to: 1, curve: 'easeOut', durationMs: fadeMs },
      ]),
    )
  },

  /**
   * **涟漪**：从中心向外逐圈脉冲——scale（放大回弹）+ opacity（压暗回暖），
   * `radialOut` 相位天然形成"一圈圈推出去"的节奏。
   */
  ripple(
    scene: ChoreoScene & { peak?: number; dip?: number; durationMs?: number },
  ): EngineAnim[] {
    const peak = scene.peak ?? 1.35
    const dip = scene.dip ?? 0.5
    const half = (scene.durationMs ?? 760) / 2
    return compileChoreography(
      specOf(scene)(() => [
        {
          kind: 'scale',
          from: 1,
          to: 1,
          keyframes: [
            { to: peak, durationMs: half, curve: 'easeOut' },
            { to: 1, durationMs: half, curve: 'easeInOut' },
          ],
        },
        {
          kind: 'opacity',
          from: 1,
          to: 1,
          keyframes: [
            { to: dip, durationMs: half, curve: 'easeOut' },
            { to: 1, durationMs: half, curve: 'easeInOut' },
          ],
        },
      ]),
    )
  },

  /**
   * **漩涡**：每片沿渐开线收向视口中心（`turns` 圈），同时旋转 + 缩小。
   * 位移量 = 目标 − **当前**（centers 由调用方从内核几何读回——重排之后也能算对）。
   */
  spiral(
    scene: ChoreoScene & {
      turns?: number
      rMin?: number
      rMax?: number
      toScale?: number
      durationMs?: number
      curve?: CurveName
    },
  ): EngineAnim[] {
    const turns = scene.turns ?? 3
    const rMin = scene.rMin ?? 0.05
    const rMax = scene.rMax ?? 0.9
    const toScale = scene.toScale ?? 0.35
    const durationMs = scene.durationMs ?? 900
    const curve = scene.curve ?? 'easeInOut'
    const view = scene.canvas.view
    const centers = needCenters(scene.canvas, 'choreograph.spiral')
    return compileChoreography(
      specOf(scene)((c) => {
        const center = viewCenter(view)
        const rad0 = Math.min(view.width, view.height) / 2
        const ang = (c.i / Math.max(1, c.n)) * Math.PI * 2 * turns
        const rad = rad0 * (rMin + (rMax - rMin) * (c.i / Math.max(1, c.n)))
        const tx = center.x + Math.cos(ang) * rad - centers[c.i]!.x
        const ty = center.y + Math.sin(ang) * rad - centers[c.i]!.y
        return [
          { kind: 'translateX', from: 0, to: tx, curve, durationMs },
          { kind: 'translateY', from: 0, to: ty, curve, durationMs },
          {
            kind: 'rotate',
            from: 0,
            to: (c.i % 2 === 0 ? 1 : -1) * (180 + (c.i / Math.max(1, c.n)) * 540),
            curve,
            durationMs,
          },
          { kind: 'scale', from: 1, to: toScale, curve, durationMs },
        ]
      }),
    )
  },

  /**
   * **归位**：一切变换回到"布局位"（translate/rotate → 0、scale → 1），按相位错峰。
   * 幕间清理用它——把上一幕留下的姿态收干净。
   *
   * ★起点来自 `canvas.attitudes`（**必须提供**）：内核的 `from` 是必填量，缺省落 0——
   *   若不给当前姿态，"归位"会**瞬移归零**（不是收回去）。传 `attitudes: []`（空数组）
   *   等价于"已在基线"（此时本预设等于无操作，调用方可跳过）。
   */
  settle(
    scene: ChoreoScene & { durationMs?: number; curve?: CurveName; opacity?: boolean },
  ): EngineAnim[] {
    const durationMs = scene.durationMs ?? 700
    const curve = scene.curve ?? 'easeInOut'
    const attitudes = scene.canvas.attitudes
    if (!attitudes) {
      throw new Error(
        'choreograph.settle 需要 `canvas.attitudes`（每片当前姿态）——内核的 `from` 是必填量，' +
          '不给当前姿态会**瞬移归零**而不是收回。请传入上一幕的终态（记账或实读；见 `ChoreoAttitude` 注释）。',
      )
    }
    const withOpacity = scene.opacity ?? true
    return compileChoreography(
      specOf(scene)((c) => {
        const a = attitudes[c.i] ?? {}
        const decls: AnimDecl[] = [
          { kind: 'translateX', from: a.tx ?? 0, to: 0, curve, durationMs },
          { kind: 'translateY', from: a.ty ?? 0, to: 0, curve, durationMs },
          { kind: 'rotate', from: a.rotate ?? 0, to: 0, curve, durationMs },
          { kind: 'scale', from: a.scale ?? 1, to: 1, curve, durationMs },
        ]
        if (withOpacity) {
          decls.push({ kind: 'opacity', from: a.opacity ?? 1, to: 1, curve, durationMs })
        }
        return decls
      }),
    )
  },

  /**
   * **多米诺**：每片"翻过去再弹回"（rotate 用 keyframes 两段；奇偶反向），
   * `serpentine` 相位形成掠过感。
   */
  domino(
    scene: ChoreoScene & { tilt?: number; fallMs?: number; riseMs?: number },
  ): EngineAnim[] {
    const tilt = scene.tilt ?? 26
    const fallMs = scene.fallMs ?? 150
    const riseMs = scene.riseMs ?? 430
    return compileChoreography(
      specOf(scene)((c) => {
        const dir = c.i % 2 === 0 ? 1 : -1
        return [
          {
            kind: 'rotate',
            from: 0,
            to: 0,
            keyframes: [
              { to: dir * tilt, durationMs: fallMs, curve: 'easeIn' },
              { to: 0, durationMs: riseMs, curve: 'springApprox' },
            ],
          },
          {
            kind: 'scale',
            from: 1,
            to: 1,
            keyframes: [
              { to: 0.82, durationMs: fallMs, curve: 'easeIn' },
              { to: 1, durationMs: riseMs, curve: 'springApprox' },
            ],
          },
        ]
      }),
    )
  },

  /**
   * ★★**聚字**：把元素聚成点阵文字（`bitmap-font.ts` 的 5×7 字形；支持 `\n` 多行）。
   *
   * 分工：前 `lit.length` 片各就一个**亮像素**（放大显示）；其余成为**星尘**
   * （确定性散布在文字四周的椭圆环上——同输入同画面）。
   * 元素数 < 亮像素数时按序取前几片（文字会缺笔画——由调用方保证规模，
   * 判据端有"亮像素数 ≤ 元素数"的检查）。
   *
   * ★**点距与点大小**（真机截图两轮打磨的结果）：
   *   · 点距 `gap = min(宽比/矩阵宽, 高比/矩阵高)`——**受限于较紧的一边**；
   *     单行 9 字（53 列）时点距只有 ~6.6px（整屏才 390px）⇒ 想要"字大"要么少字、要么**分两行**；
   *   · 点尺寸给了 `elemPx`（元素原始边长）时**自动**按 `fill×gap` 推导（默认 80% 填充度）——
   *     手填 `pixelScale` 时点会随点距变化忽大忽小（点距 6.6 时 0.42 几乎粘连、
   *     点距 20 时又变成一盘散沙——两轮真机截图都抓到了）。
   */
  text(
    scene: ChoreoScene & {
      text: string
      /** 像素间距占视口宽的比例上限（默认 0.9） */
      widthRatio?: number
      /** 文字高占视口高的比例上限（默认 0.5） */
      heightRatio?: number
      /**
       * 亮点元素缩放（**显式覆盖**；缺省 = 由 `elemPx` 自动推导，
       * 两者都缺省时退化为 0.42）
       */
      pixelScale?: number
      /** 元素原始边长（px）——给了它就可自动推导点大小（推荐） */
      elemPx?: number
      /** 自动点大小对点距的填充度（默认 0.8：点为点距的 80%，留出笔画的空隙） */
      fill?: number
      durationMs?: number
      curve?: CurveName
    },
  ): EngineAnim[] {
    const bm = textBitmap(scene.text)
    if (bm.lit.length === 0) throw new Error(`choreograph.text：文本 "${scene.text}" 没有任何亮像素（字符全在字库外？）`)
    const view = scene.canvas.view
    const centers = needCenters(scene.canvas, 'choreograph.text')
    const widthRatio = scene.widthRatio ?? 0.9
    const heightRatio = scene.heightRatio ?? 0.5
    const durationMs = scene.durationMs ?? 900
    const curve = scene.curve ?? 'easeInOut'
    const gap = Math.min(
      (view.width * widthRatio) / Math.max(1, bm.width),
      (view.height * heightRatio) / Math.max(1, bm.height),
    )
    const fill = scene.fill ?? 0.8
    const pixelScale =
      scene.pixelScale ??
      (scene.elemPx && scene.elemPx > 0
        ? Math.max(0.12, Math.min(1, (fill * gap) / scene.elemPx))
        : 0.42)
    const x0 = (view.width - (bm.width - 1) * gap) / 2
    const y0 = (view.height - (bm.height - 1) * gap) / 2
    const center = viewCenter(view)
    const lit = bm.lit.length
    return compileChoreography(
      specOf(scene)((c) => {
        let target: ChoreoPoint
        let scale: number
        let opacity: number
        if (c.i < lit) {
          const p = bm.lit[c.i]!
          target = { x: x0 + p.x * gap, y: y0 + p.y * gap }
          scale = pixelScale
          opacity = 1
        } else {
          const h1 = hash01(c.i)
          const h2 = hash01(c.i + 977)
          const h3 = hash01(c.i + 1543)
          const ang = h1 * Math.PI * 2
          // ★星尘环收在屏内（真机截图实测：0.52×宽 的外环会让两侧粒子被屏幕裁掉，
          //   看上去像"半个环"）；短半径也留出文字块以外的层次
          const rx = view.width * (0.36 + 0.06 * h2)
          const ry = view.height * (0.26 + 0.05 * h3)
          target = { x: center.x + Math.cos(ang) * rx, y: center.y + Math.sin(ang) * ry }
          scale = Math.max(0.14, pixelScale * (0.42 + 0.3 * h2))
          opacity = 0.14 + 0.26 * h3
        }
        return [
          { kind: 'translateX', from: 0, to: target.x - centers[c.i]!.x, curve, durationMs },
          { kind: 'translateY', from: 0, to: target.y - centers[c.i]!.y, curve, durationMs },
          { kind: 'scale', from: 1, to: scale, curve, durationMs },
          { kind: 'opacity', from: 1, to: opacity, curve, durationMs },
        ]
      }),
    )
  },

  /**
   * **汇聚**：每片沿"屏心 → 自己"的径向外推 `spread` 倍后飞回（开场"星尘凝聚"；
   * `spread` ≥ 2 时起点已在屏外）。spring 物理。
   */
  gather(
    scene: ChoreoScene & { spread?: number; spring?: SpringConfig; fadeMs?: number },
  ): EngineAnim[] {
    const spread = scene.spread ?? 2.6
    const spring = scene.spring ?? easing.smooth
    const fadeMs = scene.fadeMs ?? 260
    const centers = needCenters(scene.canvas, 'choreograph.gather')
    const center = viewCenter(scene.canvas.view)
    return compileChoreography(
      specOf(scene)((c) => [
        { kind: 'translateX', from: (centers[c.i]!.x - center.x) * spread, to: 0, spring },
        { kind: 'translateY', from: (centers[c.i]!.y - center.y) * spread, to: 0, spring },
        { kind: 'opacity', from: 0, to: 1, curve: 'easeOut', durationMs: fadeMs },
      ]),
    )
  },

  /**
   * **风暴**：五属性并发（位移抖动 + 大幅旋转 + 收放 + 呼吸），`alternate` 相位两班倒。
   * 这是单帧负载最重的一幕（800×5 = 4000 条指令并发）——压力上限的代表。
   */
  storm(
    scene: ChoreoScene & { durationMs?: number; spread?: number; shrink?: number },
  ): EngineAnim[] {
    const durationMs = scene.durationMs ?? 900
    const spread = scene.spread ?? 90
    const shrink = scene.shrink ?? 0.45
    return compileChoreography(
      specOf(scene)((c) => {
        const h1 = hash01(c.i * 1.7)
        const h2 = hash01(c.i * 2.3 + 11)
        const h3 = hash01(c.i * 3.1 + 29)
        return [
          { kind: 'translateX', from: 0, to: (h1 - 0.5) * spread, curve: 'easeInOut', durationMs },
          { kind: 'translateY', from: 0, to: (h2 - 0.5) * spread, curve: 'easeInOut', durationMs },
          {
            kind: 'rotate',
            from: 0,
            to: (c.i % 2 === 0 ? 1 : -1) * (360 + h3 * 360),
            curve: 'easeInOut',
            durationMs,
          },
          { kind: 'scale', from: 1, to: shrink + h1 * 0.3, curve: 'easeInOut', durationMs },
          { kind: 'opacity', from: 1, to: 0.72, curve: 'easeInOut', durationMs },
        ]
      }),
    )
  },

  /* ────────────────────────── 颜色编排（2026-10-01 · 灯光秀抽出） ──────────────────────────
   *
   * 【为什么这批是**通用预设**（而不是节目单私有的循环）】它们全部走 `compileChoreography`
   *   的 make 回调——与 wave/ripple 同一形态、同一编译链（同一份校验/线格式）。
   *   灯光秀是第一个消费面，但"颜色 + 相位编排"是通用需求（霓虹标题/状态灯/节奏带），
   *   收敛到本包 = 一份实现（纪律 #22：第 N 份手写相位循环 = 下一个静默缺陷）。
   *   ★颜色声明按通道展开（一次声明 → 4 条标量指令）由 `compileAnimations` 保证。 */

  /**
   * **闪烁**：`from →（峰值闪）→ to` 一次往返，附 scale 脉冲（"灯亮起"的物理感）。
   *
   * 相位错峰由 `order × staggerMs` 决定——`radialOut` = 从中心向外逐个点亮（点火），
   * `serpentine` = 蛇形扫过（斜扫）。
   */
  flash(
    scene: ChoreoScene & {
      from: string
      to: string
      /** 峰值色（缺省 = `#ffffff` 纯白闪） */
      peak?: string
      /** 闪到峰值的时长（缺省 160ms） */
      flashMs?: number
      /** 从峰值落回 to 的时长（缺省 620ms） */
      fallMs?: number
      /** scale 脉冲峰值（缺省 1.18 = 亮起时胀一下；1 = 不要脉冲） */
      pulse?: number
    },
  ): EngineAnim[] {
    const peak = scene.peak ?? '#ffffff'
    const flashMs = scene.flashMs ?? 160
    const fallMs = scene.fallMs ?? 620
    const pulse = scene.pulse ?? 1.18
    const dur = flashMs + fallMs
    return compileChoreography(
      specOf(scene)(() => {
        const decls: AnimDecl[] = [
          {
            kind: 'color',
            from: scene.from,
            to: scene.to,
            durationMs: dur,
            keyframes: [
              { to: peak, durationMs: flashMs, curve: 'easeOut' },
              { to: scene.to, durationMs: fallMs, curve: 'easeInOut' },
            ],
          },
        ]
        if (pulse !== 1) {
          decls.push({
            kind: 'scale',
            from: 1,
            to: 1,
            durationMs: dur,
            keyframes: [
              { to: pulse, durationMs: flashMs, curve: 'easeOut' },
              { to: 1, durationMs: fallMs, curve: 'easeInOut' },
            ],
          })
        }
        return decls
      }),
    )
  },

  /**
   * **色环**：每片走同一个多段色序列（`from → colors… → to`），相位错峰形成流动色带。
   *
   * `staggerMs = 0` 时全场同步（"呼吸"：`colors = [亮, 暗, 亮, 暗]`）；
   * 错峰时是流动的彩虹（灯光秀 rainbow 幕）。
   */
  cycle(
    scene: ChoreoScene & {
      from: string
      to: string
      /** 色序列（每项一段；末项必须 = `to`，否则编译期拒绝——与标量 keyframes 同一契约） */
      colors: readonly string[]
      /** 每段时长（缺省 240ms） */
      segMs?: number
    },
  ): EngineAnim[] {
    const segMs = scene.segMs ?? 240
    return compileChoreography(
      specOf(scene)(() => [
        {
          kind: 'color',
          from: scene.from,
          to: scene.to,
          durationMs: segMs * scene.colors.length,
          keyframes: scene.colors.map((c) => ({ to: c, durationMs: segMs, curve: 'easeInOut' as const })),
        },
      ]),
    )
  },

  /**
   * **极光带**：整行同色、行间错峰（行内 0 相位）——横向光带自上而下流过。
   *
   * 与 `cycle` 的差别：相位**按行**（同一行的灯严格同拍）而不是按片的 `order` 名次——
   * 行内错峰会打散"光带"的横线形态。行色缺省是 青→蓝→紫 三角波（冷色调）。
   */
  aurora(
    scene: ChoreoScene & {
      from: string
      /** 行数（相位空间） */
      rows: number
      /** 行间错峰（ms；缺省 40） */
      rowMs?: number
      /** 单程时长（缺省 900ms） */
      holdMs?: number
      /** 行色（缺省：青→蓝→紫三角波；给回调可自定义） */
      colorAt?: (row: number, rows: number) => string
    },
  ): EngineAnim[] {
    const rowMs = scene.rowMs ?? 40
    const hold = scene.holdMs ?? 900
    const rows = Math.max(1, scene.rows)
    const colorAt = scene.colorAt ?? defaultAuroraColor
    return compileChoreography({
      ids: scene.ids,
      canvas: scene.canvas,
      order: 'index',
      staggerMs: 0,
      make: (c) => {
        // ★本预设的相位是"行"而不是名次 ⇒ delayMs 由 make 直接给出（staggerMs=0 不叠加）
        const d = c.row * rowMs
        const rowColor = colorAt(c.row, rows)
        return [
          {
            kind: 'color',
            from: scene.from,
            to: scene.from,
            durationMs: hold * 2,
            delayMs: d,
            keyframes: [
              { to: rowColor, durationMs: hold, curve: 'easeInOut' },
              { to: scene.from, durationMs: hold, curve: 'easeInOut' },
            ],
          },
        ]
      },
    })
  },

  /**
   * **染色**：纯颜色补间（`from → to`），相位错峰——"全场变某色"的一句话。
   * 聚字/归位幕常与位置预设**同批**使用（各自独立声明，颜色与位置互不干扰）。
   */
  paint(
    scene: ChoreoScene & {
      from: string
      to: string
      durationMs?: number
      curve?: CurveName
    },
  ): EngineAnim[] {
    const durationMs = scene.durationMs ?? 700
    const curve = scene.curve ?? 'easeInOut'
    return compileChoreography(
      specOf(scene)(() => [{ kind: 'color', from: scene.from, to: scene.to, durationMs, curve }]),
    )
  },

  /* ────────────────────────── 灯阵模式（2026-10-01 · 灯光秀重构抽出） ──────────────────────────
   *
   * 【与上面"颜色编排"的本质差别】那批是"每片同一种色变化"（靠 `order` 相位错峰）；
   *   这批是**灯阵语义**：每颗灯的亮/灭/色由它的**位置**（行/列/角度）决定，灯**一颗不动**——
   *   整场演出只是"亮灯和灭灯"（真实灯光秀与 LED 矩阵屏的工作方式，用户语义修正的落点）。
   *   ★所有预设只产出**颜色指令**（kind 5..8），不产出任何位移/缩放/旋转/透明度。
   *   ★仍走 `compileChoreography` 同一编译链（同一份校验/线格式）。 */

  /**
   * ★★**灯阵点字**（"亮灯成字"——LED 矩阵屏的经典节目）：
   *   把 `text`（5×7 点阵）渲染到灯阵上——**亮的灯** = `on` 色，**灭的灯** = `off` 色（暗盘）。
   *   灯位保持不变，全靠亮灭组成文字。
   *
   * 布局：点阵水平居中；`\n` 多行纵向堆叠。每行最多 `floor((cols+1)/6)` 个字（5 列字宽 + 1 列间隔）。
   * `blinks` > 0 时亮灯先闪烁（灭→亮交替）再定格——"霓虹招牌"的观感。
   */
  matrixText(
    scene: ChoreoScene & {
      text: string
      /** 灭灯色（暗盘——调用方传入，包内无色板） */
      off: string
      /** 亮灯色（缺省 `#ffffff`） */
      on?: string
      /**
       * ★★**每颗灯的当前色**（上一幕终态；缺省 = `off`）——**杜绝跳变的关键**。
       *
       * 【为什么必须逐灯给（2026-10-01 真机观感修正）】上一幕结束时灯阵是**混合态**
       *   （例：上一幕灯字的"亮盘白、灭盘暗"）——用统一 `from` 会让本该是暗的灯
       *   在动画起点**跳到 from 色再变**（观感 = "突然闪出来"）。逐灯给 `from` =
       *   每颗灯从**它此刻真实的颜色**出发，随相位波解析成新图案（旧图象溶解、新文字浮现）。
       */
      currentOf?: (i: number) => string
      /** 统一起点色（仅当 `currentOf` 未给时使用；缺省 = `off`） */
      from?: string
      /** 每颗灯的解析时长（缺省 420ms） */
      resolveMs?: number
      /** 相位错峰（缺省 6ms：波形"写"上去——0 = 整屏同闪，观感生硬） */
      staggerMs?: number
      /** 相位序（缺省 `diagonal`） */
      order?: StaggerOrder
    },
  ): EngineAnim[] {
    const on = scene.on ?? '#ffffff'
    const resolveMs = scene.resolveMs ?? 420
    const bm = textBitmap(scene.text)
    const cols = Math.max(1, scene.canvas.cols)
    const rows = Math.max(1, Math.ceil(scene.ids.length / cols))
    const x0 = Math.floor((cols - bm.width) / 2)
    const y0 = Math.floor((rows - bm.height) / 2)
    const cells = new Set<number>()
    for (const pt of bm.lit) cells.add(pt.y * 4096 + pt.x)
    const litOf = (i: number): boolean => {
      const gx = (i % cols) - x0
      const gy = Math.floor(i / cols) - y0
      return gx >= 0 && gy >= 0 && gx < bm.width && gy < bm.height && cells.has(gy * 4096 + gx)
    }
    const cur = (i: number): string => scene.currentOf?.(i) ?? scene.from ?? scene.off
    return compileChoreography({
      ids: scene.ids,
      canvas: scene.canvas,
      // ★相位错峰由 order × staggerMs 推出（compileChoreography 自动叠加 delayMs）——
      //   波形扫过：灯一颗颗（按对角名次）解析成字，而不是整屏同时跳变
      order: scene.order ?? 'diagonal',
      staggerMs: scene.staggerMs ?? 6,
      make: (c) => [
        {
          kind: 'color',
          from: cur(c.i),
          to: litOf(c.i) ? on : scene.off,
          durationMs: resolveMs,
          curve: 'easeInOut',
        },
      ],
    })
  },

  /**
   * ★★**灯阵图案帧**（纯计算，不产出指令）：给定文本与网格，返回**每颗灯的目标色**数组——
   *   亮盘 = `on`、灭盘 = `off`。调用方用它算下一幕的 `currentOf`（逐灯起点色）：
   *   `matrixFrame('800', cols, n, {on, off})` 的终态 = 下一幕（如 `matrixText('LIG\nHTS')`）
   *   `currentOf` 的输入 ⇒ **串幕零跳变**（灯从"它此刻真实的颜色"出发）。
   */
  matrixFrame(
    text: string,
    cols: number,
    n: number,
    colors: { on: string; off: string },
  ): string[] {
    const bm = textBitmap(text)
    const cc = Math.max(1, cols)
    const rows = Math.max(1, Math.ceil(n / cc))
    const x0 = Math.floor((cc - bm.width) / 2)
    const y0 = Math.floor((rows - bm.height) / 2)
    const cells = new Set<number>()
    for (const pt of bm.lit) cells.add(pt.y * 4096 + pt.x)
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const gx = (i % cc) - x0
      const gy = Math.floor(i / cc) - y0
      const lit = gx >= 0 && gy >= 0 && gx < bm.width && gy < bm.height && cells.has(gy * 4096 + gx)
      out.push(lit ? colors.on : colors.off)
    }
    return out
  },

  /**
   * **跑马灯**（边框追逐——灯会实景最常见的节目）：灯阵**外圈**的灯按顺时针次序
   * 逐颗点亮（亮白 → 回落），内部灯保持灭。相位名次 = 沿边框的序号。
   */
  perimeterChase(
    scene: ChoreoScene & {
      off: string
      on?: string
      from?: string
      /** 相邻灯的错峰（缺省 16ms；一圈 ≈ (2(cols+rows)-4) × 此值） */
      staggerMs?: number
      /** 每颗灯亮住的时长（缺省 260ms） */
      holdMs?: number
    },
  ): EngineAnim[] {
    const on = scene.on ?? '#ffffff'
    const staggerMs = scene.staggerMs ?? 16
    const holdMs = scene.holdMs ?? 260
    const from = scene.from ?? scene.off
    const cols = Math.max(1, scene.canvas.cols)
    const rows = Math.max(1, Math.ceil(scene.ids.length / cols))
    const rankOf = (i: number): number => {
      const r = Math.floor(i / cols)
      const c = i % cols
      if (r === 0) return c
      if (c === cols - 1) return cols - 1 + r
      if (r === rows - 1) return cols - 1 + rows - 1 + (cols - 1 - c)
      if (c === 0) return cols - 1 + rows - 1 + cols - 1 + (rows - 1 - r)
      return -1 // 内部
    }
    return compileChoreography(
      specOf(scene)((c) => {
        const rank = rankOf(c.i)
        if (rank < 0) {
          return [{ kind: 'color', from, to: scene.off, durationMs: staggerMs, curve: 'linear' }]
        }
        return [
          {
            kind: 'color',
            from,
            to: scene.off,
            durationMs: rank * staggerMs + holdMs,
            // 等到自己那一棒：先灭着（或保持起点色），轮到时亮白，再回落
            keyframes: [
              { to: scene.off, durationMs: Math.max(1, rank * staggerMs), curve: 'linear' },
              { to: on, durationMs: holdMs, curve: 'easeOut' },
              { to: scene.off, durationMs: 1, curve: 'linear' },
            ],
          },
        ]
      }),
    )
  },

  /**
   * **光扇**（旋转光束——灯会实景的另一招牌）：一束光绕屏心**旋转扫过**，
   * 被扫到的灯亮白、扫过即灭（角度由灯在阵中的位置推出）。
   *
   * 每颗灯的关键帧 = **按"该灯被光束照到的时间区间"归并**（通常 2–4 段，不是 steps 段）——
   * 800 颗灯的总指令仍是每灯 4 条颜色通道（四通道展开）。`steps` × `stepMs` = 转一整圈的时长。
   */
  fan(
    scene: ChoreoScene & {
      off: string
      on?: string
      from?: string
      /** 一圈分成几步（缺省 12 = 每步 30°） */
      steps?: number
      /** 光束角宽（度；缺省 60） */
      widthDeg?: number
      /** 每步时长（缺省 150ms） */
      stepMs?: number
    },
  ): EngineAnim[] {
    const on = scene.on ?? '#ffffff'
    const steps = Math.max(3, scene.steps ?? 12)
    const widthDeg = scene.widthDeg ?? 60
    const stepMs = scene.stepMs ?? 150
    const from = scene.from ?? scene.off
    const cols = Math.max(1, scene.canvas.cols)
    const rows = Math.max(1, Math.ceil(scene.ids.length / cols))
    const angOf = (i: number): number => {
      const r = Math.floor(i / cols)
      const c = i % cols
      const x = c + 0.5 - cols / 2
      const y = r + 0.5 - rows / 2
      // 0..360（0° 指向右侧，顺时针增长——屏幕坐标 y 向下）
      const a = (Math.atan2(y, x) * 180) / Math.PI
      return (a + 360) % 360
    }
    const diff = (a: number, b: number): number => {
      const d = Math.abs(a - b) % 360
      return d > 180 ? 360 - d : d
    }
    return compileChoreography(
      specOf(scene)((c) => {
        const ang = angOf(c.i)
        // 每步的亮灭状态
        const status: boolean[] = []
        for (let k = 0; k < steps; k++) {
          const beam = (k * 360) / steps
          status.push(diff(ang, beam) <= widthDeg / 2)
        }
        // 归并连续同态 → 关键帧（每灯 2–4 段）
        const kf: Array<{ to: string; durationMs: number; curve: CurveName }> = []
        let k = 0
        while (k < steps) {
          const s0 = status[k]!
          let j = k
          while (j < steps && status[j] === s0) j++
          kf.push({ to: s0 ? on : scene.off, durationMs: (j - k) * stepMs, curve: 'linear' })
          k = j
        }
        // 终态回落灭（扫过去就灭）
        if (kf.length === 0 || kf[kf.length - 1]!.to !== scene.off) {
          kf.push({ to: scene.off, durationMs: stepMs, curve: 'linear' })
        }
        const dur = kf.reduce((acc, x) => acc + x.durationMs, 0)
        return [{ kind: 'color', from, to: scene.off, durationMs: dur, keyframes: kf }]
      }),
    )
  },

  /**
   * **棋盘翻转**（矩阵屏经典）：亮灭按 (行+列) 的奇偶交替成棋盘格，整体**翻转 `flips` 次**
   * 后收为全灭。
   */
  checker(
    scene: ChoreoScene & {
      off: string
      on?: string
      from?: string
      /** 翻转段数（缺省 4） */
      flips?: number
      /** 每段时长（缺省 240ms） */
      segMs?: number
    },
  ): EngineAnim[] {
    const on = scene.on ?? '#ffffff'
    const flips = Math.max(1, scene.flips ?? 4)
    const segMs = scene.segMs ?? 240
    const from = scene.from ?? scene.off
    const cols = Math.max(1, scene.canvas.cols)
    return compileChoreography(
      specOf(scene)((c) => {
        const kf: Array<{ to: string; durationMs: number; curve: CurveName }> = []
        for (let k = 0; k < flips; k++) {
          const onPhase = (c.row + c.col + k) % 2 === 0
          kf.push({ to: onPhase ? on : scene.off, durationMs: segMs, curve: 'linear' })
        }
        // 收为全灭（谢幕：灯仍在，暗盘）
        kf.push({ to: scene.off, durationMs: segMs, curve: 'linear' })
        const dur = kf.reduce((acc, x) => acc + x.durationMs, 0)
        return [{ kind: 'color', from, to: scene.off, durationMs: dur, keyframes: kf }]
      }),
    )
  },

  /**
   * **星火**（确定性闪烁）：每颗灯按确定性伪随机走 `segments` 段霓虹色，
   * 最后收灭——"满屏灯在闪"的压力形态（800 灯 × 多段 keyframes）。
   */
  sparkle(
    scene: ChoreoScene & {
      off: string
      /** 霓虹色池（至少 2 个色） */
      palette: readonly string[]
      from?: string
      /** 色段数（缺省 6） */
      segments?: number
      /** 每段时长（缺省 200ms） */
      segMs?: number
    },
  ): EngineAnim[] {
    const palette = scene.palette.length > 0 ? scene.palette : ['#ffffff']
    const segments = Math.max(2, scene.segments ?? 6)
    const segMs = scene.segMs ?? 200
    const from = scene.from ?? scene.off
    return compileChoreography(
      specOf(scene)((c) => {
        const kf: Array<{ to: string; durationMs: number; curve: CurveName }> = []
        for (let k = 0; k < segments; k++) {
          const pick = palette[Math.floor(hash01(c.i * 31.7 + k * 7.3) * palette.length) % palette.length]!
          kf.push({ to: pick, durationMs: segMs, curve: 'linear' })
        }
        kf.push({ to: scene.off, durationMs: segMs, curve: 'linear' })
        const dur = kf.reduce((acc, x) => acc + x.durationMs, 0)
        return [{ kind: 'color', from, to: scene.off, durationMs: dur, keyframes: kf }]
      }),
    )
  },

  /**
   * **扫描光幕**：一条"暗带"先自上而下压过（灯逐行暗下），紧接着"亮带"再自下而上
   * 点亮（灯逐行亮起）——真实舞台常见的"灯光窗帘"。每行整行同拍、行间错峰 `rowMs`。
   */
  rowSweep(
    scene: ChoreoScene & {
      /** 起点/终点的亮色（= 上一幕结束色；扫描后回到它） */
      from: string
      /** 暗带色（暗盘） */
      dim: string
      /** 行间错峰（缺省 30ms） */
      rowMs?: number
      /** 亮带住留（缺省 240ms） */
      holdMs?: number
    },
  ): EngineAnim[] {
    const rowMs = scene.rowMs ?? 30
    const holdMs = scene.holdMs ?? 240
    const cols = Math.max(1, scene.canvas.cols)
    return compileChoreography(
      specOf(scene)((c) => [
        {
          kind: 'color',
          from: scene.from,
          to: scene.from,
          durationMs: c.row * rowMs + holdMs,
          delayMs: 1,
          keyframes: [
            { to: scene.dim, durationMs: Math.max(1, c.row * rowMs), curve: 'linear' },
            { to: scene.from, durationMs: holdMs, curve: 'easeOut' },
          ],
        },
      ]),
    )
  },
} as const

/** 极光带缺省行色：青→蓝→紫三角波（冷色调）——两段线性插值 */
function defaultAuroraColor(row: number, rows: number): string {
  const t = row / Math.max(1, rows - 1)
  const tri = t < 0.5 ? t * 2 : (1 - t) * 2
  const a: [number, number, number] = [0x22, 0xd3, 0xee] // cyan
  const b: [number, number, number] = [0x3b, 0x82, 0xf6] // blue
  const c: [number, number, number] = [0xa8, 0x55, 0xf7] // purple
  const mix = (x: [number, number, number], y: [number, number, number], u: number): string => {
    const f = (p: number, q: number): string => Math.round(p + (q - p) * u).toString(16).padStart(2, '0')
    return `#${f(x[0], y[0])}${f(x[1], y[1])}${f(x[2], y[2])}`
  }
  return tri < 0.5 ? mix(a, b, tri * 2) : mix(b, c, (tri - 0.5) * 2)
}
