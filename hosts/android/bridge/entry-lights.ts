// hosts/android/bridge/entry-lights.ts —— ★★Morpheus 炫技场 · 第二个节目（灯光秀）· **Android 设备入口**
//
// 【这一场是什么】800 灯颜色编舞（用户要求：炫丽、吸睛、其他跨端框架不敢轻易尝试；在安卓上做）。
//   节目单在 `hosts/shared/bridge/showcase-lights.ts`（**零手写相位循环**，全部
//   `choreograph.*` 声明式 —— 与第一节目同一套方法论），本文件只做三件事：
//   ① 建树（800 灯 + 标题文字节点；几何完全由内核算）
//   ② 逐幕取判决 + 发令（`proteusHost.animStart`——**帧循环由 Java 宿主拥有**，本文件不碰帧）
//   ③ 收尾报告（与宿主统计合并 → `lights.json`）
//
// 【★与 iOS 的形态差别（如实记录，不假装同构）】
//   · iOS：JSC + `proteusSelfDraw` 桥（宿主 Swift 建层）；本文件：QuickJS + `proteusHost` 桥
//     （宿主 Java 绘制指令）。**同一份节目单**（showcase-lights.ts）在两端都能跑——
//     这是"编译期收敛"的直接结果（声明 → 指令的编译链在 TS 侧，与宿主无关）。
//   · 帧驱动：唯一来源 = Java 宿主 Choreographer（本文件**不注册**任何帧回调——防双驱动 2× 速）。
//
// 【机器读数（→ lights.json；判据 hosts/android/check-lights.py）】
//   · `plan`/宿主 `acts`（节目单 vs 实际演出逐项一致）· escapes 记账
//   · 每幕指令数（含**颜色通道条数**——本节目的卖点）· 发令耗时 · 内核回执
//   · 终值探针（真读宿主 `animColor`/`animTextColor` 表）+ 宿主像素自检（颜色多样性）
import { escapes } from '@proteus-vue/animation'
import { createLightsProgram, LIGHTS_PALETTE } from '../../shared/bridge/showcase-lights'
import type { LightsAct, LightsProgram } from '../../shared/bridge/showcase-lights'
// ★第三个节目（翻牌剧场）：验收 A/B 批新能力（任意缓动 / 3D / 循环 / 播放控制）
import { createFlipProgram } from '../../shared/bridge/showcase-flip'
import type { FlipAct, FlipControl } from '../../shared/bridge/showcase-flip'

/** 两个节目的幕的**公共形状**（entry 只依赖这个——节目单各自扩展） */
type AnyAct = (LightsAct | FlipAct) & {
  control?: FlipControl
  midSample?: boolean
  rotate3dAnims?: number
  curveBezierAnims?: number
  repeatAnims?: number
}

/* ────────────────── 宿主桥（android QuickJS 注入的 `proteusHost`） ────────────────── */

interface LightsHostBridge {
  mount(treeJson: string): string
  animStart(json: string): string
  animStop(json: string): string
  /** ★A3 播放控制（时间因子/暂停）：可选（宿主未实现时跳过——保持向后兼容） */
  animControl?(json: string): string
  rects(): string
  nowUs(): string
  probe(idsJson: string): string
  report(json: string): void
  post(json: string): void
}
declare const proteusHost: LightsHostBridge

/* ────────────────── 场景参数 ────────────────── */

interface Args {
  /** 灯数（默认 800：20×40） */
  tiles?: number
  /** 列数（默认 20） */
  cols?: number
  /** 视口（宿主注入；缺省 1080×2400） */
  viewport?: { width: number; height: number }
  /** ★节目选择（缺省 'lights'）：'flip' = 翻牌剧场（验收 A/B 批新能力） */
  program?: 'lights' | 'flip'
}

const state = {
  args: { tiles: 800, cols: 20 } as Required<Omit<Args, 'viewport' | 'program'>>,
  view: { width: 1080, height: 2400 },
  ids: [] as number[],
  titleId: 2000,
  /** ★节目选择（'lights' = 灯光秀 / 'flip' = 翻牌剧场；2026-10-01） */
  programKind: 'lights' as 'lights' | 'flip',
  program: null as LightsProgram | null,
  programAny: null as { next(): AnyAct | null; plan(): string[] } | null,
  /** 翻牌剧场的能力计数（灯光秀为 0） */
  rotate3dAnims: 0,
  curveBezierAnims: 0,
  repeatAnims: 0,
  /** 执行过的播放控制序列（判据对账用） */
  controls: [] as Array<{ act: string; control: FlipControl }>,
  plan: [] as string[],
  acts: [] as Array<Record<string, unknown>>,
  sampleIds: [] as number[],
  /** 全场 opacity 动画的最小 `to`（判据断言灯永不隐形：应为 0 条） */
  opacityMinTo: 1,
  opacityAnims: 0,
  colorAnims: 0,
  /** ★全场非颜色指令数（判据断言"全程只有亮灭"：必须 = 0） */
  nonColorAnims: 0,
}
const results: Record<string, unknown> = { ok: false }

/* ────────────────── ① 建树 ────────────────── */

/** 造请求树：行容器 + 800 灯珠 + 标题文字节点（**几何全靠内核**，JS 只给语义） */
function buildTree(viewW: number, viewH: number, n: number, cols: number): string {
  const pad = 8
  const gap = 3
  const rows = Math.ceil(n / cols)
  const tile = Math.floor((viewW - pad * 2 - gap * (cols - 1)) / cols)
  const nodes: Array<Record<string, unknown>> = [
    // 根：纵向排布所有行、整块居中（与第一节目同一布局策略）
    // ★★根**必须带深色底**（2026-10-01 录屏取证）：灯珠间有 3px 缝隙，露出的却是
    //   Activity 白底 ⇒ 灯珠是白时"整屏白"、是紫时缝隙反白发灰（LED 粒子感全失）。
    //   深底（#0b0b14）让**每一颗灯都像在发光**——这是灯光秀的基本视觉前提。
    {
      id: 1,
      width: viewW,
      height: viewH,
      flexDirection: 'column',
      gap,
      justifyContent: 'center',
      alignItems: 'center',
      padding: { left: pad, top: pad, right: pad, bottom: pad },
      backgroundColor: LIGHTS_PALETTE.stage,
    },
  ]
  let nextId = 2
  const rowIds: number[] = []
  for (let r = 0; r < rows; r++) {
    const rid = nextId++
    rowIds.push(rid)
    nodes.push({ id: rid, parentId: 1, flexDirection: 'row', gap, height: tile, flexShrink: 0 })
  }
  // ★800 颗**实体灯**（用户语义修正，2026-10-01）：底色 = **灭灯暗盘** `off`——
  //   它是颜色动画的起点与复位目标（内核要求），更是"灯灭也能看到灯"的**树级声明**：
  //   `off` 与舞台底色 `stage` 是两个不同色（off 明显更亮）⇒ 全灭时 800 颗暗盘清晰可辨。
  //   ★圆灯：radius ≈ tile×0.45（接近半圆）——"彩灯"是圆盘，不是方块。
  const lampRadius = Math.max(2, Math.floor(tile * 0.45))
  for (let i = 0; i < n; i++) {
    nodes.push({
      id: 1000 + i,
      parentId: rowIds[Math.floor(i / cols)],
      width: tile,
      height: tile,
      flexShrink: 0,
      borderRadius: lampRadius,
      backgroundColor: LIGHTS_PALETTE.off,
      // ★★透视距离（B 批 3D · "维度折叠"节目）：落在卡片自身样式（CSS perspective 语义）。
      //   1100 是舞台尺度的甜点值（太小 = 畸变过度，太大 = 立体感消失）。
      //   ★灯光秀不用 3D ⇒ 对它是无害的静态字段（同一棵树、两个节目）。
      perspective: 1100,
    })
  }
  // ★标题文字节点（**文字色轨道**的落点）：绝对定位在顶部，基色 = 青（与节目单的链一致）
  //   ★左边界按**估算宽**居中（QuickJS 无 text 度量；大写字母宽 ≈ 0.64em——视觉近似值。
  //     首版 left=0 让标题贴在屏幕左缘（录屏取证），居中后才是"抬头标签"的观感）。
  const titleFont = Math.round(viewW * 0.088)
  const titleText = 'PROTEUS'
  const estW = Math.round(titleText.length * titleFont * 0.64)
  nodes.push({
    id: 2000,
    parentId: 1,
    position: 'absolute',
    left: Math.max(0, Math.round((viewW - estW) / 2)),
    top: Math.round(viewH * 0.075),
    width: estW + Math.round(titleFont * 0.5),
    height: Math.round(titleFont * 1.35),
    text: titleText,
    color: '#22d3ee',
    fontSize: titleFont,
  })
  return JSON.stringify({ viewport: { width: viewW, height: viewH }, nodes })
}

/* ────────────────── ② 几何现读（编排的唯一几何来源） ────────────────── */

function readLampCenters(): Array<{ x: number; y: number }> {
  const raw = proteusHost.rects()
  const o = JSON.parse(raw) as { ok?: boolean; rects?: Record<string, { x: number; y: number; width: number; height: number }> }
  if (o?.ok !== true || !o.rects) {
    throw new Error(`读内核几何失败（rects 返回 ${raw.slice(0, 120)}）——构型幕无法计算位移`)
  }
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < state.ids.length; i++) {
    const r = o.rects[String(1000 + i)]
    if (!r) throw new Error(`内核几何缺灯珠 ${1000 + i}（(${i + 1}/${state.ids.length})）`)
    out.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  }
  return out
}

/* ────────────────── ③ 场景主流程 ────────────────── */

export function __proteusLightsRun(argsJson?: string): string {
  const args: Args = argsJson ? JSON.parse(argsJson) : {}
  const a: Required<Omit<Args, 'viewport' | 'program'>> = { tiles: args.tiles ?? 800, cols: args.cols ?? 20 }
  state.args = a
  state.programKind = args.program === 'flip' ? 'flip' : 'lights'
  const vp = args.viewport ?? { width: 1080, height: 2400 }
  state.view = { width: Math.round(vp.width), height: Math.round(vp.height) }
  state.ids = Array.from({ length: a.tiles }, (_, i) => 1000 + i)
  state.acts = []

  const t0 = Number(proteusHost.nowUs()) / 1000
  const tree = buildTree(state.view.width, state.view.height, a.tiles, a.cols)
  const mountOut = proteusHost.mount(tree)
  const mountMs = Number(proteusHost.nowUs()) / 1000 - t0
  const mounted = safeParse(mountOut)
  if ((mounted as { ok?: boolean }).ok !== true) {
    return JSON.stringify({ ok: false, error: '建树失败', detail: mounted })
  }

  // ★按节目名建节目单（两个节目共用同一棵树：灯珠就是牌）
  const envCommon = {
    ids: state.ids,
    cols: a.cols,
    view: state.view,
    tilePx: Math.floor((state.view.width - 16 - 3 * (a.cols - 1)) / a.cols),
    centers: readLampCenters,
    titleId: state.titleId,
  }
  if (state.programKind === 'flip') {
    const fp = createFlipProgram(envCommon)
    state.programAny = fp as unknown as { next(): AnyAct | null; plan(): string[] }
    state.program = null
  } else {
    state.program = createLightsProgram(envCommon)
    state.programAny = state.program as unknown as { next(): AnyAct | null; plan(): string[] }
  }
  state.plan = state.programAny.plan()
  state.sampleIds = [1000, 1000 + Math.floor(a.tiles / 2), 1000 + a.tiles - 1, state.titleId]

  results.program = state.programKind
  results.tiles = a.tiles
  results.cols = a.cols
  results.view = state.view
  results.mount = mounted
  results.mount_ms = round2(mountMs)
  results.plan = state.plan
  results.started_at_ms = Date.now()
  return JSON.stringify({ ok: true, tiles: a.tiles, mount_ms: round2(mountMs), plan: state.plan })
}

/** 取下一幕并发令（宿主在幕边界调用；返回 done=true = 演完） */
export function __proteusLightsNext(): string {
  const program = state.programAny
  if (!program) return JSON.stringify({ ok: false, error: '节目单未初始化（先调 __proteusLightsRun）' })
  const t0 = Number(proteusHost.nowUs()) / 1000
  let act: AnyAct | null = null
  try {
    act = program.next()
  } catch (e) {
    return JSON.stringify({ ok: false, error: `节目单取幕失败：${(e as Error).message}` })
  }
  if (!act) return JSON.stringify({ ok: true, done: true })

  // ★★播放控制（A3）：幕开始前应用（慢动作/疾速/恢复常速）——
  //   判据据此对账"ctl 序列"+"wall/span 比值"。
  if (act.control) {
    // ★宿主未实现 animControl 时不静默扮演——如实记录，判据会因此判红
    if (typeof proteusHost.animControl === 'function') {
      proteusHost.animControl(JSON.stringify(act.control))
    } else {
      results.control_unsupported = true
    }
    state.controls.push({ act: act.name, control: act.control })
  }

  // ★记账（"全程只有亮灭"的机器证据，2026-10-01 用户语义修正）：
  //   非颜色指令（kind 0..4：位移/缩放/旋转/透明度）= 0 才是灯阵语义。
  for (const a of act.anims) {
    if (a.kind < 5) {
      state.nonColorAnims++
      if (a.kind === 4) {
        state.opacityAnims++
        if (a.to < state.opacityMinTo) state.opacityMinTo = a.to
      }
    }
  }
  state.colorAnims += act.colorAnims
  // ★翻牌剧场的能力计数（灯光秀无这些字段 ⇒ 0）
  state.rotate3dAnims += act.rotate3dAnims ?? 0
  state.curveBezierAnims += act.curveBezierAnims ?? 0
  state.repeatAnims += act.repeatAnims ?? 0

  const out = safeParse(proteusHost.animStart(JSON.stringify({ anims: act.anims }))) as { ok?: boolean; started?: number }
  if (out.ok !== true) {
    return JSON.stringify({ ok: false, error: `幕「${act.name}」发令失败`, detail: out })
  }
  const issueMs = Number(proteusHost.nowUs()) / 1000 - t0

  // ★★逃生口记账（与第一节目同一装置）：本幕编译产物条数进全局注册表 ⇒
  //   「逃生口率」每轮真机断言（判定见 check-lights.py ⑥）。
  escapes.noteDeclarative(act.anims.length)
  state.acts.push({
    name: act.name,
    anims: act.anims.length,
    color_anims: act.colorAnims,
    rotate3d_anims: act.rotate3dAnims ?? 0,
    curve_bezier_anims: act.curveBezierAnims ?? 0,
    repeat_anims: act.repeatAnims ?? 0,
    mid_sample: act.midSample === true,
    issue_ms: round2(issueMs),
    span_ms: round2(act.spanMs),
    hold_ms: round2(act.holdMs),
    duration_ms: round2(act.durationMs),
    note: act.note,
  })
  return JSON.stringify({
    ok: true,
    name: act.name,
    spanMs: act.spanMs,
    holdMs: act.holdMs,
    durationMs: act.durationMs,
    anims: act.anims.length,
    color_anims: act.colorAnims,
    rotate3d_anims: act.rotate3dAnims ?? 0,
    curve_bezier_anims: act.curveBezierAnims ?? 0,
    repeat_anims: act.repeatAnims ?? 0,
    mid_sample: act.midSample === true,
    control: act.control ?? null,
    issue_ms: round2(issueMs),
    note: act.note,
  })
}

/** 收尾：合并宿主统计 → 写报告（`lights.json`） */
export function __proteusLightsFinalize(hostStatsJson?: string): string {
  const stats = hostStatsJson ? safeParse(hostStatsJson) : {}
  const probe = safeParse(proteusHost.probe(JSON.stringify(state.sampleIds)))
  results.host = stats
  results.probe = probe
  results.acts = state.acts
  // ★容忍字符串形态（宿主侧 org.json 对未知类型的字符串化——已修，但报告读端保持宽容：
  //   判据脚本读的是同一份 JSON，双保险；2026-10-01 首跑即因此炸过 finalize）
  const rawActs = (stats as { acts?: unknown }).acts
  const hostActs: string[] = Array.isArray(rawActs)
    ? rawActs.map((r) => (r as { name: string }).name)
    : typeof rawActs === 'string'
      ? (((safeParse(rawActs) as Array<{ name: string }>) ?? []).map((r) => r.name) as string[])
      : []
  results.acts_complete =
    state.acts.length === state.plan.length && state.acts.every((a, i) => a.name === state.plan[i])
  results.acts_host_match =
    hostActs.length === state.plan.length && hostActs.every((n, i) => n === state.plan[i])
  results.escapes = escapes.summary()
  results.opacity_anims = state.opacityAnims
  results.opacity_min_to = Math.round(state.opacityMinTo * 1000) / 1000
  results.color_anims_total = state.colorAnims
  results.non_color_anims = state.nonColorAnims
  results.rotate3d_anims_total = state.rotate3dAnims
  results.curve_bezier_anims_total = state.curveBezierAnims
  results.repeat_anims_total = state.repeatAnims
  results.controls = state.controls
  results.ok = true
  const json = JSON.stringify(results)
  proteusHost.report(json)
  return json
}

/** 停全部动画（诊断用；正常演出不需要——幕与幕之间靠颜色链无缝衔接） */
export function __proteusLightsStop(): string {
  return proteusHost.animStop(JSON.stringify({ all: true }))
}

/**
 * ★★**重播**（独立 APK 的循环演出用）：停全部动画（清值 ⇒ 回**树里的灭灯底色**）
 * → 重建节目单（上一轮的幕索引已耗尽）→ 返回幕数。
 * ★为什么必须清值：谢幕熄灯幕已把灯收回/熄灭，但保险起见 stop 一次
 *   （与节目一的 `__proteusShowcaseRestart` 同一纪律）。
 */
export function __proteusLightsRestart(): string {
  const stop = safeParse(proteusHost.animStop(JSON.stringify({ all: true })))
  state.acts = []
  state.opacityMinTo = 1
  state.opacityAnims = 0
  state.colorAnims = 0
  state.nonColorAnims = 0
  const envCommon = {
    ids: state.ids,
    cols: state.args.cols,
    view: state.view,
    tilePx: Math.floor((state.view.width - 16 - 3 * (state.args.cols - 1)) / state.args.cols),
    centers: readLampCenters,
    titleId: state.titleId,
  }
  if (state.programKind === 'flip') {
    state.programAny = createFlipProgram(envCommon) as unknown as { next(): AnyAct | null; plan(): string[] }
    state.program = null
  } else {
    state.program = createLightsProgram(envCommon)
    state.programAny = state.program as unknown as { next(): AnyAct | null; plan(): string[] }
  }
  state.controls = []
  state.plan = state.programAny.plan()
  results.plan = state.plan
  return JSON.stringify({ ok: true, stop, acts: state.plan.length })
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return { raw: s }
  }
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// 挂全局（IIFE 无模块系统——与其它 entry 同法）
;(globalThis as unknown as { __proteusLightsRun: typeof __proteusLightsRun }).__proteusLightsRun = __proteusLightsRun
;(globalThis as unknown as { __proteusLightsNext: typeof __proteusLightsNext }).__proteusLightsNext = __proteusLightsNext
;(globalThis as unknown as { __proteusLightsFinalize: typeof __proteusLightsFinalize }).__proteusLightsFinalize = __proteusLightsFinalize
;(globalThis as unknown as { __proteusLightsStop: typeof __proteusLightsStop }).__proteusLightsStop = __proteusLightsStop
;(globalThis as unknown as { __proteusLightsRestart: typeof __proteusLightsRestart }).__proteusLightsRestart =
  __proteusLightsRestart
