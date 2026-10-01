// hosts/shared/bridge/showcase-lights.ts —— ★★Morpheus 炫技场 · **第二个节目：舞台灯光秀**
//
// 【这一场是什么（用户原话，2026-10-01 三轮打磨后的最终语义）】
//   「我理解的灯光秀是**舞台上 800 个彩灯**，灯光秀都是通过**彩灯的亮灯和灭灯**完成，
//     **黑色的背景** 800 个灯，正常**灯灭也是能看到灯的**，不是元素消失。
//     全程都是灯亮灯灭的才对，就算是文字展示也是通过灯亮灯灭完成的。灯光秀可以参考现实世界的灯光秀表演设计」。
//
// ⇒ 本节目按**实体灯阵**建模（不是"像素编舞"）：
//   · 800 颗灯**一颗不动**（零位移/零缩放/零旋转——判据机器断言 non_color_anims === 0）；
//   · 每颗灯永远可见：灭 = 暗盘（`LIGHTS_PALETTE.off`，在黑舞台清晰可辨），亮 = 霓虹色；
//   · **整场演出 = 100% 颜色通道指令**（kind 5..8）——这也正好把刚收口的颜色能力考到极限。
//
// 【节目设计（15 幕，参考现实灯光秀/LED 矩阵屏的经典节目）】
//   standby 待机 → ignite 点火 → marquee 跑马灯 → rainbow 彩虹流 → pulse 呼吸 → aurora 极光
//   → scanline 光幕扫描 → fan 旋转光扇 → checker 棋盘翻转 → sparkle 星火 → matrix「800」
//   → matrix「LIGHTS」灯阵点字 → blackout 熄灯 → finale 全场亮灯 → curtain 谢幕熄灯（可循环）
//
// 【机器不变量（与第一节目同一套纪律）】
//   ① 幕时长 = `spanMs(anims) + holdMs` **推导**；② **颜色链**显式（见下）——CI 断言；
//   ③ **灯阵固定**：任何一幕都不得产出非颜色指令（CI + 真机判据双层断言）。
//
// 【诚实边界】本模块不碰宿主：不建树、不发令、不读设备（纯构造，CI 与设备 import 同一份）。

import { choreograph, compileAnimations, compileChoreography, textBitmap } from '@proteus-vue/animation'
import type { ChoreoAttitude, ChoreoPoint, EngineAnim } from '@proteus-vue/animation'

/* ────────────────────────── 色板（舞台霓虹） ────────────────────────── */

/**
 * 舞台色板：**黑舞台 + 实体彩灯**。
 *
 * 【`off` 的语义（本节目的核心）】灭灯不是"隐身"——是**暗色盘**：
 *   `off` 与 `stage` 的对比度保证"灯灭也能看到灯"（判据断言两者各通道差 ≥ 0x18）。
 */
export const LIGHTS_PALETTE = {
  /** 舞台底色（近黑——灯光秀的"黑"） */
  stage: '#05060a',
  /** **灭灯态**（暗色盘；在黑舞台上清晰可见） */
  off: '#2b2d42',
  /** 灭灯态的"待机微亮"（暗场呼吸，证明 800 颗灯都在） */
  offHi: '#3c3f5a',
  cyan: '#22d3ee',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  white: '#f8fafc',
} as const

/* ────────────────────────── 类型 ────────────────────────── */

/** 一幕（与第一节目同形；灯光秀无 FLIP 幕） */
export interface LightsAct {
  name: string
  spanMs: number
  holdMs: number
  durationMs: number
  anims: EngineAnim[]
  note: string
  /** 本幕里的颜色通道指令条数（判据：颜色驱动占比——本节目的是 100%） */
  colorAnims: number
}

/** 节目单环境（入口与 CI 各自注入：几何现读函数、网格参数、标题节点） */
export interface LightsEnv {
  /** 灯节点 id（顺序 = 网格顺序：行优先） */
  ids: readonly number[]
  /** 网格列数 */
  cols: number
  /** 视口 */
  view: { width: number; height: number }
  /** 灯珠边长（px） */
  tilePx: number
  /** **现读**内核几何（灯中心）——本节目灯不动，此处仅保留接口兼容（不参与指令） */
  centers: () => readonly ChoreoPoint[]
  /** 标题文本节点 id（**文字色轨道**的落点；`view` 已够不到时可为 -1 = 不参与） */
  titleId: number
}

/** 节目单（入口逐幕取用） */
export interface LightsProgram {
  next(): LightsAct | null
  plan(): string[]
  attitudes(): ChoreoAttitude[]
}

/* ────────────────────────── 工具 ────────────────────────── */

/** 一批指令的时间跨度 = max(delayMs + durMs) */
export function spanMs(anims: readonly EngineAnim[]): number {
  let m = 0
  for (const a of anims) {
    const end = (a.delayMs ?? 0) + (a.durMs ?? 0)
    if (end > m) m = end
  }
  return m
}

/** 颜色通道 kind 判定（5..8 底色 / 9..12 文字色——契约编号见 types.ts） */
function isColorKind(kind: number): boolean {
  return kind >= 5 && kind <= 12
}

/** 基线姿态（本节目灯不动：永远是基线） */
function baseline(): ChoreoAttitude {
  return { tx: 0, ty: 0, rotate: 0, scale: 1, opacity: 1 }
}

/* ────────────────────────── 节目单 ────────────────────────── */

interface Step {
  name: string
  note: string
  holdMs?: number
  build: () => EngineAnim[]
}

/**
 * 建一场灯光秀（**纯构造**：不执行、不碰设备）。
 *
 * 颜色链（显式、可断言）：
 * ```
 * off → cyan → off → cyan → cyan → cyan → cyan → off → off → off
 *   → {亮:white, 灭:off} → {亮:white, 灭:off} → off → white → off（循环）
 * ```
 */
export function createLightsProgram(env: LightsEnv): LightsProgram {
  const ids = env.ids
  const n = ids.length
  const view = env.view
  const cols = env.cols
  const rows = Math.ceil(n / cols)
  const P = LIGHTS_PALETTE
  const scene = { ids, canvas: { cols, view } }
  const atts: ChoreoAttitude[] = Array.from({ length: n }, () => baseline())

  const steps: Step[] = []

  // ① 待机：全场暗盘轻微呼吸（"800 颗灯都在"——黑舞台上的暗盘网格）
  steps.push({
    name: 'standby',
    note: '待机：全场灭灯——800 颗暗盘在黑舞台上清晰可见（"灯灭也能看到灯"）',
    build: () =>
      choreograph.cycle({
        ...scene,
        order: 'index',
        staggerMs: 0,
        from: P.off,
        to: P.off,
        colors: [P.offHi, P.off],
        segMs: 620,
      }),
  })

  // ② 点火：从中心向外逐颗点亮（白闪 → 落青）
  steps.push({
    name: 'ignite',
    note: '点火：灯从中心向外逐颗亮起（闪白 → 落青）——"亮灯"',
    build: () =>
      choreograph.flash({
        ...scene,
        order: 'radialOut',
        staggerMs: 2.2,
        from: P.off,
        to: P.cyan,
        peak: P.white,
        flashMs: 140,
        fallMs: 520,
        pulse: 1, // ★不脉冲（灯不动——只亮灭）
      }),
  })

  // ③ 跑马灯：外圈灯沿边框逐颗亮起（灯会实景最常见的节目）
  steps.push({
    name: 'marquee',
    note: '跑马灯：外圈灯沿边框顺时针逐颗亮起再回落（内部灯保持灭）——"边框追逐"',
    build: () =>
      choreograph.perimeterChase({
        ...scene,
        from: P.cyan,
        off: P.off,
        on: P.white,
        staggerMs: 16,
        holdMs: 260,
      }),
  })

  // ④ 彩虹流：色相波沿对角扫过（多段 keyframes 的流动色带）
  steps.push({
    name: 'rainbow',
    note: '彩虹流：每颗灯 6 段色相循环（蓝→粉→紫→粉→蓝→青）斜向相位——流动色带',
    build: () =>
      choreograph.cycle({
        ...scene,
        order: 'diagonal',
        staggerMs: 1.8,
        from: P.off,
        to: P.cyan,
        colors: [P.blue, P.pink, P.purple, P.pink, P.blue, P.cyan],
        segMs: 220,
      }),
  })

  // ⑤ 呼吸：全场同步（青↔粉⇄紫）；标题文字色同拍呼吸（底色/文字色双轨并行）
  const pulseAnims = (): EngineAnim[] => {
    const base = choreograph.cycle({
      ...scene,
      order: 'index',
      staggerMs: 0,
      from: P.cyan,
      to: P.cyan,
      colors: [P.pink, P.purple, P.pink, P.cyan],
      segMs: 420,
    })
    if (env.titleId < 0) return base
    return base.concat(
      compileAnimations(
        [
          {
            kind: 'textColor',
            from: P.cyan,
            to: P.cyan,
            durationMs: 1680,
            keyframes: [
              { to: P.white, durationMs: 420, curve: 'easeIn' },
              { to: P.cyan, durationMs: 420, curve: 'easeOut' },
              { to: P.white, durationMs: 420, curve: 'easeIn' },
              { to: P.cyan, durationMs: 420, curve: 'easeOut' },
            ],
          },
        ],
        { nodeId: env.titleId },
      ).anims,
    )
  }
  steps.push({
    name: 'pulse',
    note: '呼吸：全场同步（青↔粉↔紫）；标题「PROTEUS」文字色同拍呼吸——底色/文字色双轨并行',
    build: pulseAnims,
  })

  // ⑥ 极光：整行同色、行间错峰——冷色光带自上而下流过
  steps.push({
    name: 'aurora',
    note: '极光：整行同色、行间错峰 40ms——青→蓝→紫的冷色光带自上而下流过',
    build: () =>
      choreograph.aurora({
        ...scene,
        rows,
        from: P.cyan,
        rowMs: 40,
        holdMs: 900,
      }),
  })

  // ⑦ 光幕扫描：暗带压下 + 亮带扫回（"灯光窗帘"）
  steps.push({
    name: 'scanline',
    note: '光幕扫描：暗带自上而下压过、亮带随即扫回（整行同拍、行间 30ms）——"灯光窗帘"',
    build: () =>
      choreograph.rowSweep({
        ...scene,
        from: P.cyan,
        dim: P.off,
        rowMs: 30,
        holdMs: 240,
      }),
  })

  // ⑧ 旋转光扇：一束光绕屏心旋转扫过（被扫到即亮、扫过即灭）
  steps.push({
    name: 'fan',
    note: '旋转光扇：60° 光束绕屏心旋转一周（12 步 × 150ms）——被照到的灯亮白、扫过即灭',
    build: () =>
      choreograph.fan({
        ...scene,
        from: P.cyan,
        off: P.off,
        on: P.white,
        steps: 12,
        widthDeg: 60,
        stepMs: 150,
      }),
  })

  // ⑨ 棋盘翻转：亮灭按 (行+列) 奇偶成格、整体翻转后收灭
  steps.push({
    name: 'checker',
    note: '棋盘翻转：灯按 (行+列) 奇偶亮灭成棋盘格，整体翻转 5 次后收为全灭',
    build: () =>
      choreograph.checker({
        ...scene,
        from: P.off,
        off: P.off,
        on: P.purple,
        flips: 5,
        segMs: 240,
      }),
  })

  // ⑩ 星火：满屏灯确定性闪烁（多段霓虹 keyframes 的压力形态）
  steps.push({
    name: 'sparkle',
    note: '星火：800 颗灯按确定性伪随机闪烁霓虹色（6 段/灯）——满屏灯在闪',
    build: () =>
      choreograph.sparkle({
        ...scene,
        from: P.off,
        off: P.off,
        palette: [P.cyan, P.pink, P.blue, P.white],
        segments: 6,
        segMs: 200,
      }),
  })

  // ⑪ 灯阵点字「800」：亮灯成字（灭灯仍是暗盘）——**波形写上去**（对角错峰解析）
  //   ★上一幕（星火）终态 = 全场灭 ⇒ from=off 逐灯成立；灯一颗颗（按对角名次）亮起成字
  steps.push({
    name: 'matrix800',
    note: '灯阵点字：亮灯按对角波形**逐颗写**成「800」（灭灯仍是暗盘）——文字完全靠亮灭完成',
    build: () =>
      choreograph.matrixText({
        ...scene,
        text: '800',
        off: P.off,
        on: P.white,
        from: P.off,
        resolveMs: 420,
        staggerMs: 5, // 800 灯对角名次跨 ~60 级 ⇒ 波形扫过约 300ms（"写"的观感）
        order: 'diagonal',
      }),
  })

  // ⑫ 灯阵点字「LIGHTS」（两行堆叠：LIG / HTS）——**旧图案随波溶解、新文字随波浮现**
  //   ★逐灯 currentOf = 上一幕（「800」）的真实终态（亮盘白/灭盘暗）⇒ 串幕零跳变；
  //     统一 from 会让本该暗的灯先跳白再变（观感 = "突然闪出来"——真机观感修正）。
  steps.push({
    name: 'matrixLIGHTS',
    note: '灯阵点字：旧图案随对角波**溶解**、新文字「LIG/HTS」（= LIGHTS）随之浮现——逐灯从真实当前色出发',
    build: () => {
      const prevFrame = choreograph.matrixFrame('800', cols, n, { on: P.white, off: P.off })
      return choreograph.matrixText({
        ...scene,
        text: 'LIG\nHTS',
        off: P.off,
        on: P.white,
        currentOf: (i) => prevFrame[i] ?? P.off,
        resolveMs: 480,
        staggerMs: 5,
        order: 'diagonal',
      })
    },
  })

  // ⑬ 熄灯：从中心向外逐圈熄灭——**逐灯从真实当前色出发**
  //   ★上一幕终态是混合态（亮盘白/灭盘暗）⇒ 统一 from=white 会让暗盘先跳白再灭
  //     （同"文字闪出"同源的跳变）；逐灯 currentOf = 「LIGHTS」帧 ⇒ 亮盘平滑暗下、暗盘保持
  steps.push({
    name: 'blackout',
    note: '熄灯：亮盘从中心向外逐圈暗下（暗盘保持不动）——"灭灯"，灯一颗不消失',
    build: () => {
      const litFrame = choreograph.matrixFrame('LIG\nHTS', cols, n, { on: P.white, off: P.off })
      return compileChoreography({
        ids,
        canvas: { cols, view },
        order: 'index',
        staggerMs: 0.35,
        make: (c) => [
          {
            kind: 'color',
            from: litFrame[c.i] ?? P.off,
            to: P.off,
            durationMs: 460,
            curve: 'easeIn',
          },
        ],
      })
    },
  })

  // ⑭ 全场亮灯（谢幕高潮）：从中心向外逐圈亮白
  steps.push({
    name: 'finale',
    note: '全场亮灯：从中心向外逐圈亮起（暗盘 → 白）——谢幕高潮',
    build: () =>
      choreograph.flash({
        ...scene,
        order: 'radialOut',
        staggerMs: 2,
        from: P.off,
        to: P.white,
        peak: P.pink,
        flashMs: 160,
        fallMs: 560,
        pulse: 1,
      }),
  })

  // ⑮ 谢幕熄灯：全灭（回到起点画面——可无缝循环）
  steps.push({
    name: 'curtain',
    note: '谢幕熄灯：全场熄灭（白 → 暗盘）——回到全灭但全可见，可无缝循环',
    build: () =>
      choreograph.paint({
        ...scene,
        order: 'index',
        staggerMs: 0.4,
        from: P.white,
        to: P.off,
        durationMs: 800,
        curve: 'easeInOut',
      }),
  })

  /* ── 逐幕取用（记账 + 幕时长推导） ── */
  let index = 0
  return {
    next(): LightsAct | null {
      const s = steps[index]
      if (!s) return null
      index += 1
      const anims = s.build()
      const span = spanMs(anims)
      const hold = s.holdMs ?? 0
      // 本节目灯不动：姿态永远基线（记账接口保留，与节目一同构）
      const colorAnims = anims.filter((a) => isColorKind(a.kind)).length
      return { name: s.name, spanMs: span, holdMs: hold, durationMs: span + hold, anims, note: s.note, colorAnims }
    },
    plan(): string[] {
      return steps.map((s) => s.name)
    },
    attitudes(): ChoreoAttitude[] {
      return atts
    },
  }
}

/** 灯阵点字的亮灯数（供 CI/判据做"文字真的有笔画"的算术断言） */
export function matrixLitCount(text: string): number {
  return textBitmap(text).lit.length
}
