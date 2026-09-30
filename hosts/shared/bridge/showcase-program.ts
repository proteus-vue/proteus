// hosts/shared/bridge/showcase-program.ts —— ★★Morpheus 炫技场 · **节目单**（声明式编排）
//
// 【这一场是什么（用户要求）】「演示结束太快了，做成开场语 + 几分钟演出 + 谢幕语，
//   全部都是这 800 节点编舞完成」＋ 评审意见「那 800 片的相位关系，是手写循环算出来的，
//   还是引擎声明式表达出来的？如果是前者，建议现在就改成后者——这个 demo 的价值会翻倍」。
//
// ⇒ 本模块就是那个回答：**整场演出没有一行手写相位循环**，每一幕都是
//   `choreograph.*` 的一句声明（相位序 + 构型），编译走引擎同一条链。
//
// 【为什么节目单是**独立模块**（而不是写在 entry 里）】
//   CI 侧判据（`tests/showcase-choreography.test.ts`）要验证的正是"这场演出"——
//   若节目单埋在宿主入口里，CI 只能**抄一份**再测抄件（测抄件 = 测不到真货）。
//   ⇒ 节目单独立成模块：设备入口 import 它、CI 测试 import 它，**测的就是跑的**。
//
// 【两类机器不变量（节目单自己维持 + CI 断言 + 运行期兜底）】
//   ① **不被掐断**：每幕的 `durationMs` 由 `spanMs(anims) + 余量` **推导**（不是拍脑袋）——
//      幕切换早于动画结束会让"终态记账"与实际不符（下一幕从错的位置起步 = 跳变）。
//   ② **无跳变衔接**：需要"从当前继续"的幕（settle / 长跑风暴）用 `from = 上一幕终态`
//      显式衔接（内核 `from` 是必填量——见 `constraint/from-is-mandatory`）；
//      只从基线启动的幕（聚字/涟漪/多米诺/风暴首轮）由节目单保证**只在基线之后出场**
//      （`expects: 'baseline'`，违反即当场抛错——不静默跳变）。
//
// 【诚实边界】本模块不碰宿主：FLIP 幕产出的是**宿主指令单**（capture/patch/start 三段），
//   由设备入口执行；CI 侧只能断言指令单的形状（真几何变更由真机判据对账）。

import { choreograph, terminalAttitudes } from '@proteus-vue/animation'
import type { ChoreoAttitude, ChoreoPoint, EngineAnim } from '@proteus-vue/animation'

/* ────────────────────────── 类型 ────────────────────────── */

/** FLIP 幕的宿主指令单（一条 patch = 一个节点的宽高改写） */
export interface FlipPatch {
  id: number
  style: { width: number; height: number }
}

/** 一幕 */
export interface ShowcaseAct {
  name: string
  /** 动画时间跨度（ms）= max(delayMs + durMs)——**名义值**；弹簧实际由物理决定（见下） */
  spanMs: number
  /** 幕尾定型时间（ms；谢幕语用它"停住"供观看/截图；其余幕为 0） */
  holdMs: number
  /** 幕时长 = spanMs + holdMs（见文件头不变量①） */
  durationMs: number
  /** 本幕的引擎指令（空数组 = 本幕走 FLIP 指令单） */
  anims: EngineAnim[]
  /** FLIP 幕的宿主指令单（`animFlip(capture) → updatePatches → animFlip(start)`） */
  flip?: { patches: FlipPatch[]; durMs: number; curve: number; note: string }
  /** 人类可读说明（进报告/文档） */
  note: string
}

/** 节目单环境（入口与 CI 各自注入：几何现读函数、网格参数、长跑时长） */
export interface ShowcaseEnv {
  /** 瓦片节点 id（顺序 = 网格顺序：行优先） */
  ids: readonly number[]
  /** 网格列数 */
  cols: number
  /** 视口 */
  view: { width: number; height: number }
  /** 当前瓦片边长（px；FLIP 幕据此算"缩略/展开"两个状态） */
  tilePx: number
  /** **现读**内核几何（瓦片中心）——重排之后也能算对（不可用建树时的旧值！） */
  centers: () => readonly ChoreoPoint[]
  /** 长跑（压力幕）目标时长（ms） */
  soakMs: number
}

/** 节目单（入口逐幕取用） */
export interface ShowcaseProgram {
  /** 取下一幕（null = 演完了） */
  next(): ShowcaseAct | null
  /** 预演整场（幕名清单；长跑按 soakMs 展开）——报告/判据/文档用 */
  plan(): string[]
  /** 当前姿态记账（诊断用） */
  attitudes(): ChoreoAttitude[]
}

/* ────────────────────────── 常量与工具 ────────────────────────── */

/**
 * 幕切余量（ms）——**0 = 无缝衔接**（用户要求："每一幕没有丝滑衔接，现在是每一幕结束等会儿开始下一幕"）。
 *
 * 【为什么可以是 0（机制取证）】幕时长 = 动画时间跨度 ⇒ **动画完成的那一帧正好触发切幕**
 *   （两者由同一个 dt 累计），下一帧就是下一幕的第一步 ⇒ 视觉上没有定格。
 *   万一有动画没跑完就被切走：内核的**接管语义**（同 (节点,属性) 启动时位置连续 + 速度移交）
 *   兜住 ⇒ 不跳变（见 `route-transition.ts` 与内核 `Anim::start` 的 takeover 分支）。
 *   ★此前是 260ms（"等定型"），代价就是每幕末尾一段可见的静帧。
 */
export const SHOWCASE_ACT_MARGIN_MS = 0

/** 长跑（压力幕）一循环：风暴 + 归位 */
export const SOAK_STORM_MS = 1100
export const SOAK_SETTLE_MS = 600
/** 一循环的**幕时长**（含余量） */
export const SOAK_CYCLE_MS = SOAK_STORM_MS + SOAK_SETTLE_MS + SHOWCASE_ACT_MARGIN_MS * 2

/** 基线姿态（布局位：无位移/无旋转/原尺寸/全不透明） */
export function baselineAttitude(): ChoreoAttitude {
  return { tx: 0, ty: 0, rotate: 0, scale: 1, opacity: 1 }
}

/** 一批指令的时间跨度 = max(delayMs + durMs)——幕时长必须 ≥ 它（不变量①的算术面） */
export function spanMs(anims: readonly EngineAnim[]): number {
  let m = 0
  for (const a of anims) {
    const end = (a.delayMs ?? 0) + (a.durMs ?? 0)
    if (end > m) m = end
  }
  return m
}

/** 姿态是否在基线（数值容差 1e-6——记账值来自编译产物，是精确值） */
function isBaseline(a: ChoreoAttitude | undefined): boolean {
  if (!a) return true
  return (
    Math.abs(a.tx ?? 0) < 1e-6 &&
    Math.abs(a.ty ?? 0) < 1e-6 &&
    Math.abs(a.rotate ?? 0) < 1e-6 &&
    Math.abs((a.scale ?? 1) - 1) < 1e-6 &&
    Math.abs((a.opacity ?? 1) - 1) < 1e-6
  )
}

/** 一步（幕的"配方"；`expects` 是衔接约束，由 build 前检查） */
interface Step {
  name: string
  /** 出场条件：baseline = 只在基线后（从基线起跳）；current = 从当前姿态继续；any = 入场幕（自带 from 设计） */
  expects: 'baseline' | 'current' | 'any'
  /** 本幕结束后是否回到基线（决定记账） */
  endsAtBaseline: boolean
  note: string
  /** 幕尾定型时间（ms；谢幕语用它"停住"供截图；其余幕为 0） */
  holdMs?: number
  build: () => { anims?: EngineAnim[]; flip?: ShowcaseAct['flip'] }
}

/* ────────────────────────── 节目单 ────────────────────────── */

/**
 * 建一场节目（**纯构造**：不执行、不碰设备）。
 *
 * 幕序（开场语 → 演出 → 长跑 → 谢幕语）：
 * ```
 * gather(星尘凝聚) → title(MORPHEUS 开场语) → settle → ripple(涟漪)
 *   → domino(多米诺) → storm(风暴·峰值) → settle
 *   → flip-condense / flip-restore（全量重排 ×2）
 *   → spiral(漩涡) → settle
 *   → soak × N（风暴 + 归位的循环：长跑压力，N 由 soakMs 决定）
 *   → finale(800 TILES 谢幕语 + 定型)
 * ```
 */
export function createShowcaseProgram(env: ShowcaseEnv): ShowcaseProgram {
  const ids = env.ids
  const n = ids.length
  const view = env.view
  const cols = env.cols
  let atts: ChoreoAttitude[] = Array.from({ length: n }, () => baselineAttitude())

  const cLive = (): { cols: number; view: { width: number; height: number }; centers: ChoreoPoint[] } => ({
    cols,
    view,
    centers: [...env.centers()],
  })
  const cSettle = (): { cols: number; view: { width: number; height: number }; attitudes: ChoreoAttitude[] } => ({
    cols,
    view,
    attitudes: atts,
  })

  const steps: Step[] = []

  // ① 开场 · 星尘凝聚（入场幕：from 是"屏外径向"设计值，不依赖上一幕）
  steps.push({
    name: 'gather',
    expects: 'any',
    endsAtBaseline: true,
    note: '星尘凝聚：800 片从屏外径向飞回布局位（spring 物理）',
    build: () => ({
      anims: choreograph.gather({
        ids,
        canvas: cLive(),
        order: 'radialOut',
        staggerMs: 1.2,
        spread: 2.4,
        fadeMs: 420,
      }),
    }),
  })

  // ② 开场语：聚字 MORPHEUS（从基线起跳——中心/缩放都设计为基线出发）
  steps.push({
    name: 'title',
    expects: 'baseline',
    endsAtBaseline: false,
    note: '开场语：整屏元素聚成点阵文字 MORPHEUS',
    build: () => ({
      anims: choreograph.text({
        ids,
        canvas: cLive(),
        order: 'diagonal',
        staggerMs: 2,
        text: 'MORPHEUS',
        // ★点大小自适应（elemPx = 瓦片边长）：手填常量会随点距变化忽大忽小（见 choreograph.text 注释）
        elemPx: env.tilePx,
        durationMs: 1100,
      }),
    }),
  })

  // ③ 从文字姿态收回网格（from = 上一幕终态；这就是"记账衔接"）
  steps.push({
    name: 'settle-title',
    expects: 'current',
    endsAtBaseline: true,
    note: '收网格：从文字构型收归布局位（起点 = 上一幕终态，无跳变）',
    build: () => ({ anims: choreograph.settle({ ids, canvas: cSettle(), order: 'radialIn', staggerMs: 1.5, durationMs: 700 }) }),
  })

  // ④ 涟漪（基线 ↔ 基线：keyframes 两段回到原值）
  steps.push({
    name: 'ripple',
    expects: 'baseline',
    endsAtBaseline: true,
    note: '涟漪：从中心向外逐圈脉冲（scale/opacity 两段序列）',
    build: () => ({
      anims: choreograph.ripple({ ids, canvas: { cols, view }, order: 'radialOut', staggerMs: 8, durationMs: 1000 }),
    }),
  })

  // ⑤ 多米诺（基线 ↔ 基线）
  steps.push({
    name: 'domino',
    expects: 'baseline',
    endsAtBaseline: true,
    note: '多米诺：翻转再弹回（奇偶反向，蛇形掠过）',
    build: () => ({
      anims: choreograph.domino({ ids, canvas: { cols, view }, order: 'serpentine', staggerMs: 5 }),
    }),
  })

  // ⑥ 风暴 · 峰值（五属性并发；基线 → 混沌姿态）
  steps.push({
    name: 'storm-peak',
    expects: 'baseline',
    endsAtBaseline: false,
    note: '风暴：五属性并发（800×5 = 4000 条指令）——单帧负载峰值',
    build: () => ({
      anims: choreograph.storm({ ids, canvas: { cols, view }, order: 'alternate', staggerMs: 4, durationMs: 1100 }),
    }),
  })

  // ⑦ 收风（from = 风暴终态；radialOut 错峰 = 从中心向外一层层收回）
  steps.push({
    name: 'settle-storm',
    expects: 'current',
    endsAtBaseline: true,
    note: '收风：从风暴姿态收归布局位（径向错峰收回）',
    build: () => ({ anims: choreograph.settle({ ids, canvas: cSettle(), order: 'radialOut', staggerMs: 1.5, durationMs: 700 }) }),
  })

  // ⑧⑨ FLIP：全量重排 ×2（800 片几何全变——"布局动画 worst case"，评审点名单列的一项）
  const flip = (name: string, toTilePx: number, note: string): Step => ({
    name,
    expects: 'baseline',
    endsAtBaseline: true,
    note,
    build: () => ({
      flip: {
        // ★只改瓦片宽高（行容器不动）：宽高全变 ⇒ 全量重排（800 片 rects 全变）
        patches: ids.map((id) => ({ id, style: { width: toTilePx, height: toTilePx } })),
        durMs: 900,
        // 3 = easeInOut（与内核 Curve 编号同号，见 types.ts 契约）
        curve: 3,
        note,
      },
    }),
  })
  steps.push(
    flip('flip-condense', Math.max(6, Math.round(env.tilePx * 0.6)), '全量重排①：整个网格缩略（840 个节点几何全变，内核重排）'),
  )
  steps.push(flip('flip-restore', env.tilePx, '全量重排②：网格展开回原尺寸（再一轮全量重排）'))

  // ⑩ 漩涡（基线 → 漩涡姿态）
  steps.push({
    name: 'spiral',
    expects: 'baseline',
    endsAtBaseline: false,
    note: '漩涡：沿渐开线收向屏心（四属性并发，构图锚点=视口中心）',
    build: () => ({
      anims: choreograph.spiral({ ids, canvas: cLive(), order: 'index', staggerMs: 0, turns: 3, toScale: 0.35, durationMs: 900 }),
    }),
  })

  // ⑪ 从漩涡收回（from = 漩涡终态）
  steps.push({
    name: 'settle-spiral',
    expects: 'current',
    endsAtBaseline: true,
    note: '收漩涡：从漩涡姿态收归布局位',
    build: () => ({ anims: choreograph.settle({ ids, canvas: cSettle(), order: 'index', staggerMs: 0.6, durationMs: 800 }) }),
  })

  // ⑫ 长跑（**默认不跑**；`soakMs > 0` 才展开）——评审点名的"泄漏/热节流"压力测量，
  //    用户明确要求"不用为了时长去一直重复" ⇒ 默认演出一遍到底，压力测量按需开启：
  //    `PROTEUS_SHOWCASE_SOAK_MS=300000 bash hosts/ios/run-selfdraw.sh --showcase`
  const soakCycles = env.soakMs > 0 ? Math.max(1, Math.ceil(env.soakMs / SOAK_CYCLE_MS)) : 0
  for (let k = 0; k < soakCycles; k++) {
    steps.push({
      name: `soak-storm#${k + 1}`,
      expects: 'baseline',
      endsAtBaseline: false,
      note: `长跑 ${k + 1}/${soakCycles}：风暴（五属性并发）`,
      build: () => ({
        // 奇偶轮换相位序：视觉有变化，同时让"相位序"这条路径在长跑里也被反复走
        anims: choreograph.storm({
          ids,
          canvas: { cols, view },
          order: k % 2 === 0 ? 'alternate' : 'diagonal',
          staggerMs: 3,
          durationMs: SOAK_STORM_MS,
        }),
      }),
    })
    steps.push({
      name: `soak-settle#${k + 1}`,
      expects: 'current',
      endsAtBaseline: true,
      note: `长跑 ${k + 1}/${soakCycles}：归位（幕间清理）`,
      build: () => ({ anims: choreograph.settle({ ids, canvas: cSettle(), durationMs: SOAK_SETTLE_MS }) }),
    })
  }

  // ⑬ 谢幕语：聚字 800 TILES + 定型（时长含 hold，供截图）
  steps.push({
    name: 'finale',
    expects: 'baseline',
    endsAtBaseline: false,
    note: '谢幕语：整屏元素聚成 800 TILES（本场的机器读数）',
    build: () => ({
      anims: choreograph.text({
        ids,
        canvas: cLive(),
        order: 'diagonal',
        staggerMs: 1.5,
        // ★两行 ⇒ 列数减半（29 列 vs 53 列）⇒ 点距翻倍（~12px vs ~6.6px）⇒ 字**大一倍**（真机截图抓出）
        text: '800\nTILES',
        elemPx: env.tilePx,
        durationMs: 1200,
      }),
    }),
  })
  steps[steps.length - 1]!.holdMs = 1400

  /* ── 逐幕取用（运行期兜底断言：衔接不变量违反即抛错，不静默跳变） ── */
  let index = 0
  return {
    next(): ShowcaseAct | null {
      const s = steps[index]
      if (!s) return null
      index += 1
      if (s.expects === 'baseline' && !atts.every((a) => isBaseline(a))) {
        throw new Error(
          `节目单衔接违规：幕「${s.name}」要求从**基线**起跳，但当前姿态不是基线` +
            '（上一幕的终态未收干净 ⇒ 会跳变；请检查幕序与 settle 的衔接）',
        )
      }
      const built = s.build()
      const anims = built.anims ?? []
      const flipSpec = built.flip
      const span = spanMs(anims)
      // ★不变量①：幕时长由时间跨度**推导**（flip 幕以补间时长计；谢幕语再加定型时间）
      const hold = s.holdMs ?? 0
      const durationMs = flipSpec
        ? flipSpec.durMs + SHOWCASE_ACT_MARGIN_MS * 2 + hold
        : span + SHOWCASE_ACT_MARGIN_MS + hold
      // 记账：本幕终态（FLIP 幕不改姿态；其余 = 指令末值；回基线的幕直接记账为基线）
      if (flipSpec || s.endsAtBaseline) {
        atts = Array.from({ length: n }, () => baselineAttitude())
      } else {
        atts = terminalAttitudes(anims, ids)
      }
      const spanOut = flipSpec ? flipSpec.durMs : span
      return {
        name: s.name,
        spanMs: spanOut,
        holdMs: hold,
        durationMs: spanOut + hold,
        anims,
        ...(flipSpec ? { flip: flipSpec } : {}),
        note: s.note,
      }
    },
    plan(): string[] {
      return steps.map((s) => s.name)
    },
    attitudes(): ChoreoAttitude[] {
      return atts
    },
  }
}
