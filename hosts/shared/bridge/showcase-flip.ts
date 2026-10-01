// hosts/shared/bridge/showcase-flip.ts —— ★★Morpheus 炫技场 · **第三个节目：维度折叠**
//
// 【这一场是什么（用户："从 3D 和 2D 之间不断转换的主题考虑，综合新增能力做到天花板"）】
//   舞台是一屏 800 张"薄片"（20×40 网格）。整场演出 = **二维平面宇宙与三维立体空间的
//   反复穿越**：拍平（成为地面）→ 立起（成为墙）→ 折叠（手风琴）→ 扭转（鳞片）→
//   砸回平面 → 立起 + 风浪 → 涟漪 → **镜面慢翻（0.3× 慢动作）** → 归位谢幕。
//
//   **颜色 = 第三维度的语言**（本场最核心的设计）：
//     · 平面世界（2D）是**白色纸面**——没有色彩；
//     · 每一次"立起"（进入 3D），色彩**涌现**（色相沿列扫过 = 彩虹被"揭"出来）；
//     · 每次"砸回平面"，色彩**褪回白色**。
//   ⇒ 观众看到的不是"3D 效果演示"，而是"颜色本身证明了第三个维度存在"。
//
// 【哪一句是新能力（本节目 = A/B 批验收的演出面）】
//   · `curveBezier` 三张曲线性格：`elastic` 拍平（一砸即平的脆响）/ `backOut` 立起（回弹）
//     / `anticipate` 砸平与慢翻（蓄力再动）——运动性格在观感上可直接分辨；
//   · `rotateX`/`rotateY` + `perspective`：所有"平面↔立体"的转换本身；
//   · `repeat` + `direction:'alternate'`：折扇的"展开—合上"、扭转的"来回"（yoyo）；
//   · `timeScale`：`slowYaw` 幕 0.3× 慢动作（镜面慢翻 = 全片情绪最高点）· `ripple` 幕 1.6×
//     加速（涟漪更"脆"）。
//
// 【9 幕】
// ```
// plane(拍平·elastic) → lift(立起·backOut) → fan(折扇·yoyo 2 次) → torsion(扭转·yoyo 4 次)
//  → flatten(砸平·anticipate) → spin(立起+风浪+彩虹扫列) → ripple(涟漪·1.6×)
//  → slowYaw(镜面慢翻·0.3×) → finale(归位谢幕·回弹)
// ```
//
// 【闭环（循环演出的数学）】谢幕终态（0°/0°/暗色）= 开场 plane 的起点 ⇒ 独立 APK 可无缝循环。
//
// 【3D 数值连续性（幕间不跳变）】每幕的 `from` = 上一幕该轴的终态（0 → -85 → 0 → …），
//   颜色同理（白 → 彩 → 白 → 彩 → 暗）：由 `check-flip.py` ④ 逐幕探针钉住。
//
// 【诚实边界】本模块不碰宿主：不建树、不发令、不读设备（纯构造，CI 与设备 import 同一份）。

import { compileChoreography } from '@proteus-vue/animation'
import type { CurveName, EngineAnim } from '@proteus-vue/animation'
// ★spanMs 与灯光秀共用同一实现（"一处实现"——不复制第二份算术）
import { spanMs } from './showcase-lights'

/* ────────────────────────── 色板与曲线 ────────────────────────── */

export const FLIP_PALETTE = {
  /** 舞台底色 / 色相链的"无色"态（与灯光秀同一底色，两台演出共用一棵树） */
  off: '#2b2d42',
  /** 平面世界的"白纸"（2D = 无色） */
  white: '#f8fafc',
  /** 谢幕黑场（终态色 = 下一轮的起点色；闭环用） */
  dark: '#101018',
} as const

/**
 * 三张**自定义缓动**（A 批能力，本节目让它们各自承担一种"运动性格"）：
 *   · `backOut`：回弹——"立起"的利落感（冲过再回稳）；
 *   · `anticipate`：预期——"砸平"与"慢翻"的蓄势（先向反方向让一点再动）；
 *   · `elastic`：弹性——"拍平"的一砸即平（衰减振荡，脆响感）。
 */
export const FLIP_CURVES = {
  backOut: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  anticipate: [0.6, -0.28, 0.735, 0.045] as [number, number, number, number],
  elastic: [0.175, 0.885, 0.32, 1.275] as [number, number, number, number],
} as const

/** 3D 折叠的幅度（度）——集中定义，便于调参（**负角 = 向后倒/成为地面**） */
export const FOLD_ANGLES = {
  /** 平躺（成为地面） */
  flat: -85,
  /** 折扇列角 */
  fan: 65,
  /** 扭转幅度（两轴） */
  twistX: 55,
  twistY: 40,
  /** 风浪列角 */
  wind: 75,
  /** 涟漪峰 */
  ripple: 60,
  /** 慢翻半圈（镜面换面） */
  yaw: 180,
} as const

/**
 * **"第三维度"的色相映射**（本场的颜色叙事）：色相沿**列**扫过（与"风浪""揭幕"同向）。
 * 同一函数用于 lift / spin 的 `to` 与 flatten / finale 的 `from` —— 色相链跨幕自洽。
 */
export function foldColorOf(i: number, n: number): string {
  const cols = 20 // 与舞台网格一致（色相按列循环，20 列正好绕满色环）
  const col = i % cols
  return hslToHex((col / cols) * 360, 0.78, 0.58)
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/* ────────────────────────── 类型 ────────────────────────── */

/** 播放控制指令（A3 能力：幕开始前应用到内核） */
export interface FlipControl {
  timeScale?: number
  paused?: boolean
}

/** 一幕（与灯光秀同形 + 能力计数与控制指令） */
export interface FlipAct {
  name: string
  spanMs: number
  holdMs: number
  durationMs: number
  anims: EngineAnim[]
  note: string
  /** 颜色通道指令条数 */
  colorAnims: number
  /** 3D 旋转（rotateX/Y）指令条数——本节目的主角 */
  rotate3dAnims: number
  /** 自定义贝塞尔（curveBezier）指令条数 */
  curveBezierAnims: number
  /** 带循环（repeat）的指令条数 */
  repeatAnims: number
  /** 本幕开始前应用的播放控制（slowYaw / ripple 幕用） */
  control?: FlipControl
  /** 判据的"着色采样帧"标记（宿主在幕进行中采一次颜色多样性） */
  midSample?: boolean
}

/** 节目单环境（与灯光秀同形——入口复用同一份 env 构造） */
export interface FlipEnv {
  ids: readonly number[]
  cols: number
  view: { width: number; height: number }
  /** 牌面尺寸（本节目未用——保留字段与灯光秀同构） */
  tilePx: number
  /** 现读几何（本节目未用——保留） */
  centers: () => readonly { x: number; y: number }[]
  /** 标题节点 id（本节目未用——保留） */
  titleId: number
}

export interface FlipProgram {
  next(): FlipAct | null
  plan(): string[]
}

/* ────────────────────────── 节目单 ────────────────────────── */

interface Step {
  name: string
  note: string
  holdMs?: number
  control?: FlipControl
  midSample?: boolean
  build: () => EngineAnim[]
}

function isColorKind(kind: number): boolean {
  return kind >= 5 && kind <= 12
}

/** 3D 旋转 kind（13=rotateX / 14=rotateY——与内核同号） */
function is3dKind(kind: number): boolean {
  return kind === 13 || kind === 14
}

export function createFlipProgram(env: FlipEnv): FlipProgram {
  const ids = env.ids
  const n = ids.length
  const view = env.view
  const cols = env.cols
  const P = FLIP_PALETTE
  const C = FLIP_CURVES
  const A = FOLD_ANGLES
  const scene = { ids, canvas: { cols, view } }

  const mk = (anims: EngineAnim[]): Omit<FlipAct, 'name' | 'spanMs' | 'holdMs' | 'durationMs' | 'note' | 'control' | 'midSample'> & { anims: EngineAnim[] } => ({
    anims,
    colorAnims: anims.filter((x) => isColorKind(x.kind)).length,
    rotate3dAnims: anims.filter((x) => is3dKind(x.kind)).length,
    curveBezierAnims: anims.filter((x) => x.curveBezier !== undefined).length,
    repeatAnims: anims.filter((x) => x.repeat !== undefined).length,
  })

  const steps: Step[] = []

  // ① 平面宇宙（plane）：从"立正的白墙"被**弹性一拍拍平**成地面（rotateX 0→-85，elastic）
  //    颜色：白（2D 世界无色——上一轮终态是暗，此处"点亮纸面"）
  steps.push({
    name: 'plane',
    note: '平面宇宙：弹性一拍（elastic）把整面墙拍平成地面（rotateX 0→-85）——2D 世界的诞生，纸面点亮',
    build: () =>
      compileChoreography({
        ...scene,
        order: 'diagonal',
        staggerMs: 2,
        make: () => [
          { kind: 'rotateX', from: 0, to: A.flat, durationMs: 520, curveBezier: C.elastic },
          { kind: 'color', from: P.dark, to: P.white, durationMs: 520, curve: 'easeOut' },
        ],
      }),
  })

  // ② 立起（lift）：地面**回弹式**直立成墙（rotateX -85→0，backOut）＋ 色彩涌现（白→列色相）
  //    ★这是全片第一次"2D→3D 穿越"：色彩随立起被"揭"出来（颜色 = 第三维度的证明）
  steps.push({
    name: 'lift',
    note: '立起：地面回弹式直立成墙（rotateX -85→0 · backOut）——色彩随立起涌现（白→色相列扫）＝颜色证明第三维度',
    midSample: true,
    build: () =>
      compileChoreography({
        ...scene,
        order: 'diagonal',
        staggerMs: 2,
        make: (c) => [
          { kind: 'rotateX', from: A.flat, to: 0, durationMs: 560, curveBezier: C.backOut },
          { kind: 'color', from: P.white, to: foldColorOf(c.i, n), durationMs: 560, curve: 'easeInOut' },
        ],
      }),
  })

  // ③ 折扇（fan）：按列交替 ±65°（rotateY），yoyo 两次（展开—合上）——手风琴
  //    列相位（order 'index' + 大 stagger）让折痕像被拉开
  steps.push({
    name: 'fan',
    note: '折扇：按列交替 ±65°（rotateY · yoyo 2 次 = 展开再合上）——手风琴的折痕被拉开',
    build: () =>
      compileChoreography({
        ...scene,
        order: 'index',
        staggerMs: 7,
        make: (c) => [
          {
            kind: 'rotateY',
            from: 0,
            to: c.col % 2 === 0 ? A.fan : -A.fan,
            durationMs: 360,
            repeat: 2,
            direction: 'alternate',
            curve: 'easeInOut',
          },
        ],
      }),
  })

  // ④ 扭转（torsion）：双轴同时摆动（rotateX 55° / rotateY 40°，yoyo 4 次）——"鳞片被风掀动"
  //    两轴相位错开（对角 vs 逆对角）⇒ 每张牌的朝向都不同（3D 空间感最强的一幕）
  steps.push({
    name: 'torsion',
    note: '扭转：双轴鳞片（rotateX 55° ＋ rotateY 40° · yoyo 4 次）——每张牌朝向不同，风掀鳞片',
    build: () =>
      compileChoreography({
        ...scene,
        order: 'diagonal',
        staggerMs: 1.5,
        make: (c) => [
          {
            kind: 'rotateX',
            from: 0,
            to: -A.twistX,
            durationMs: 320,
            repeat: 4,
            direction: 'alternate',
            curve: 'easeInOut',
          },
          {
            kind: 'rotateY',
            from: 0,
            to: c.i % 2 === 0 ? A.twistY : -A.twistY,
            durationMs: 320,
            repeat: 4,
            direction: 'alternate',
            curve: 'easeInOut',
          },
        ],
      }),
  })

  // ⑤ 砸回平面（flatten）：**预期曲线**（先让一点再砸）把墙砸平（rotateX 0→-85）＋ 色彩褪回白
  //    ★颜色 from = 逐牌真实当前色（`foldColorOf` = lift 的 to；fan/torsion 未动颜色 ⇒ 链自洽）
  steps.push({
    name: 'flatten',
    note: '砸回平面：预期曲线（anticipate：先蓄力再砸）把墙砸平（rotateX 0→-85）——色彩褪回白，3D→2D 快切',
    build: () =>
      compileChoreography({
        ...scene,
        order: 'diagonal',
        staggerMs: 2,
        make: (c) => [
          { kind: 'rotateX', from: 0, to: A.flat, durationMs: 480, curveBezier: C.anticipate },
          { kind: 'color', from: foldColorOf(c.i, n), to: P.white, durationMs: 480, curve: 'easeIn' },
        ],
      }),
  })

  // ⑥ 镜墙风浪（spin）：从地面**回弹立起**（rotateX -85→0）＋ 风浪（rotateY 75°，yoyo 2 次）
  //    ＋ **彩虹扫列**（颜色白→列色相，列相位）——"立起时风与彩一起扫过"
  steps.push({
    name: 'spin',
    note: '镜墙风浪：回弹立起（rotateX -85→0）＋ 风浪摆（rotateY 75° · yoyo 2 次）＋ 彩虹扫列（白→色相）——立起时风与彩同扫',
    build: () =>
      compileChoreography({
        ...scene,
        order: 'index',
        staggerMs: 4,
        make: (c) => [
          { kind: 'rotateX', from: A.flat, to: 0, durationMs: 560, curveBezier: C.backOut },
          {
            kind: 'rotateY',
            from: 0,
            to: A.wind,
            durationMs: 380,
            repeat: 2,
            direction: 'alternate',
            curve: 'easeInOut',
          },
          { kind: 'color', from: P.white, to: foldColorOf(c.i, n), durationMs: 520, curve: 'easeInOut' },
        ],
      }),
  })

  // ⑦ 涟漪（ripple）：从中心向外的 rotateX 波（两段 keyframes 回到 0）· **1.6× 加速**（更"脆"）
  steps.push({
    name: 'ripple',
    note: '涟漪：从中心向外的立体波（rotateX 0→-60→0 两段序列）· timeScale 1.6 加速——涟漪更脆',
    control: { timeScale: 1.6 },
    build: () =>
      compileChoreography({
        ...scene,
        order: 'radialOut',
        staggerMs: 2.2,
        make: () => [
          {
            kind: 'rotateX',
            from: 0,
            to: 0,
            durationMs: 800,
            keyframes: [
              { to: -A.ripple, durationMs: 300, curve: 'easeOut' },
              { to: 0, durationMs: 500, curve: 'easeInOut' },
            ],
          },
        ],
      }),
  })

  // ⑧ 镜面慢翻（slowYaw）：**0.3× 慢动作**下整墙绕 Y 轴翻半圈（anticipate 蓄势再翻）
  //    "镜面从正面翻到背面"——全片情绪最高点（慢镜头给"维度交换"一个仪式感）
  steps.push({
    name: 'slowYaw',
    note: '镜面慢翻：整墙绕 Y 翻半圈 0→180°（anticipate 蓄势）· timeScale 0.3 慢动作——正面与背面的维度交换',
    control: { timeScale: 0.3 },
    build: () =>
      compileChoreography({
        ...scene,
        order: 'index',
        staggerMs: 3,
        make: () => [
          { kind: 'rotateY', from: 0, to: A.yaw, durationMs: 900, curveBezier: C.anticipate },
        ],
      }),
  })

  // ⑨ 谢幕（finale）：回弹归位（rotateY 180→0）＋ 色彩沉入黑场（暗）＋ 定格
  //    终态（0°/0°/暗）= 开场 plane 的起点 ⇒ 可无缝循环
  //    ★**必须显式恢复常速**（2026-10-01 真机抓出）：slowYaw 幕把 timeScale 设成 0.3 后，
  //    若无声恢复，后续所有幕（含谢幕与下一轮循环）都在 0.3× 下跑——谢幕 wall=2.85×span
  //    且触发宿主安全上限被强制切幕。**变速幕的收尾必须还原全局状态**（与"解绑必须含清值"同源）。
  steps.push({
    name: 'finale',
    control: { timeScale: 1 },
    note: '谢幕：回弹归位（rotateY 180→0 · backOut）＋ 色彩沉入黑场 · 恢复常速（timeScale 1）——终态 = 开场起点（可循环）',
    holdMs: 1000,
    build: () =>
      compileChoreography({
        ...scene,
        order: 'diagonal',
        staggerMs: 2,
        make: (c) => [
          { kind: 'rotateY', from: A.yaw, to: 0, durationMs: 560, curveBezier: C.backOut },
          { kind: 'color', from: foldColorOf(c.i, n), to: P.dark, durationMs: 560, curve: 'easeIn' },
        ],
      }),
  })

  let index = 0
  return {
    next(): FlipAct | null {
      const s = steps[index]
      if (!s) return null
      index += 1
      const built = mk(s.build())
      const span = spanMs(built.anims)
      const hold = s.holdMs ?? 0
      return {
        name: s.name,
        spanMs: span,
        holdMs: hold,
        durationMs: span + hold,
        anims: built.anims,
        note: s.note,
        colorAnims: built.colorAnims,
        rotate3dAnims: built.rotate3dAnims,
        curveBezierAnims: built.curveBezierAnims,
        repeatAnims: built.repeatAnims,
        ...(s.control ? { control: s.control } : {}),
        ...(s.midSample ? { midSample: true } : {}),
      }
    },
    plan(): string[] {
      return steps.map((s) => s.name)
    },
  }
}
