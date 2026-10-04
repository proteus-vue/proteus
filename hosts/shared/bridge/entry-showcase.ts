// hosts/shared/bridge/entry-showcase.ts —— ★★Morpheus 炫技场（真机性能演示）· **设备入口**
//
// 【这一场要证明什么（用户要求）】「该演示就是动画引擎炫技的存在，要求酷炫，吸睛，丝滑流畅不掉帧，
//   而且还能考验动画引擎性能，**在其他跨端框架不敢轻易尝试的那种**」
//   ＋「做成**开场语 + 几分钟演出 + 谢幕语**，全部都是这 800 节点编舞完成」。
//
// 【编舞在哪（评审的核心问题：手写相位 还是 声明式编排？）】
//   ★**全部在 `showcase-program.ts`（节目单）——零手写相位循环**：
//   每一幕 = `choreograph.*` 的一句声明（相位序 order + 错峰 staggerMs + 构型预设），
//   编译走引擎同一条链（`compileChoreography → compileAnimations`，同一份校验/线格式）。
//   本文件只做三件事：① 建树（内核算几何）② 逐幕取判决 + 发指令（含 FLIP 三段）③ 收尾报告。
//
// 【零伪造】所有运动都来自 `@proteus-vue/animation` 的**真编译产物**；坐标/姿态现读内核
//   （`rects()`），不是 JS 侧另算一份几何。
//
// 【本入口的机器读数（→ showcase.json，判据 hosts/ios/check-showcase.py）】
//   · `plan`/`acts`（节目单 vs 实际演出——两清单必须逐项一致）
//   · 每幕指令数、发令耗时、幕时长；FLIP 幕的三段回执（capture/patch/start，去掉巨型数组只留摘要）
//   · 终值探针（真读层）+ 帧循环统计（帧数）+ 收尾截图
import { escapes } from '@proteus-vue/animation'
import { createShowcaseProgram } from './showcase-program'
import type { ShowcaseAct, ShowcaseProgram } from './showcase-program'

// ★构建标识（由 hosts/ios/bridge/inject-build-id.mjs **编译期替换**——与 entry-bench/entry-selfdraw
//   同一机制；报告据此断言"设备上跑的是本次构建"）
const BUILD_ID = 'e3e12746-225836'

/** 帧内视图参数（建树时定，后续幕复用） */
interface ViewGeom {
  w: number
  h: number
  cols: number
  rows: number
  tile: number
  gap: number
  pad: number
}

/* ────────────────── 宿主桥（与 entry-selfdraw 同一套注入名） ────────────────── */

interface ShowcaseHost {
  mount(treeJson: string): string
  update(treeJson: string): string
  updatePatches(json: string): string
  animStart(json: string): string
  animTick(dtMs: number): string
  animFlip(json: string): string
  animStopAll(): string
  animFrameStats(): string
  /** 仍在推进的动画条数（0 = 全部结束）——幕切换的权威判据（弹簧时长由物理决定） */
  animActiveCount(): string
  rects(): string
  layerTransformProbe(idsJson: string): string
  snapshot(name: string): string
  report(json: string): void
  nowUs(): string
}
declare const proteusSelfDraw: ShowcaseHost

/* ────────────────── 场景参数（真机可调；判据读回报） ────────────────── */

interface Args {
  /** 瓦片数（默认 800：20×40 网格） */
  tiles?: number
  /** 网格列数（默认 20） */
  cols?: number
  /**
   * 长跑（压力幕）时长 ms——**默认 0 = 不跑**（用户要求"不用为了时长去一直重复"）。
   * > 0 时展开 N 轮"风暴 + 归位"循环（评审点名的泄漏/热节流压力测量，按需开启）
   */
  soakMs?: number
}

/* ────────────────── 状态 ────────────────── */

const state = {
  args: { tiles: 800, cols: 20, soakMs: 0 } as Required<Args>,
  geom: { w: 0, h: 0, cols: 0, rows: 0, tile: 0, gap: 3, pad: 8 } as ViewGeom,
  n: 0,
  ids: [] as number[],
  program: null as ShowcaseProgram | null,
  plan: [] as string[],
  acts: [] as Array<{ name: string; anims: number; issue_ms: number; span_ms: number; hold_ms: number; duration_ms: number; note: string; flip?: boolean }>,
  sampleIds: [] as number[],
}
const results: Record<string, unknown> = { ok: false }

/* ────────────────── ① 建树：瓦片网格（Rust 算几何） ────────────────── */

/**
 * 造请求树：**行容器 + 瓦片**（★内核没有 flex-wrap ⇒ 用显式行容器实现网格）。
 * 几何完全由内核算（行高/瓦片宽都是声明式约束，不是 JS 算好的绝对坐标）。
 */
function buildTree(viewW: number, viewH: number, n: number, cols: number): string {
  const pad = 8
  const gap = 3
  const rows = Math.ceil(n / cols)
  const tile = Math.floor((viewW - pad * 2 - gap * (cols - 1)) / cols)
  const nodes: Array<Record<string, unknown>> = [
    // 根：纵向排布所有行，**整块居中**（用户反馈"800 个节点在屏幕左上角排布"）
    // ★用 flex 居中（justifyContent=主轴纵向 / alignItems=交叉轴横向）而不是手算 padding——
    //   声明式，且 FLIP 改瓦片宽高后**仍然居中**（手算 padding 会在重排后失准）
    {
      id: 1,
      width: viewW,
      height: viewH,
      flexDirection: 'column',
      gap,
      justifyContent: 'center',
      alignItems: 'center',
      padding: { left: pad, top: pad, right: pad, bottom: pad },
    },
  ]
  let nextId = 2
  const rowIds: number[] = []
  for (let r = 0; r < rows; r++) {
    const rid = nextId++
    rowIds.push(rid)
    // 行宽度不设 ⇒ 由根的 `alignItems: center` 收缩为内容宽并居中（行内瓦片左起排布）
    nodes.push({ id: rid, parentId: 1, flexDirection: 'row', gap, height: tile, flexShrink: 0 })
  }
  // 调色板（紫 → 青 → 橙 的横向渐变：波浪扫过时有明确的方向感）
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1)
    nodes.push({
      id: 1000 + i,
      parentId: rowIds[Math.floor(i / cols)],
      width: tile,
      height: tile,
      flexShrink: 0,
      borderRadius: 4,
      backgroundColor: hslToHex(258 - t * 200, 0.72, 0.55),
    })
  }
  state.geom = { w: viewW, h: viewH, cols, rows, tile, gap, pad }
  return JSON.stringify({ viewport: { width: viewW, height: viewH }, nodes })
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

/* ────────────────── ② 几何现读（编排的唯一几何来源） ────────────────── */

/**
 * 读**内核几何**（`rects`）→ 瓦片中心。
 * ★为什么必须现读：构型（聚字/漩涡/凝聚）的位移 = 目标 − **当前**位置，而 FLIP 重排后
 *   位置会变 ⇒ 用建树时的旧几何会让整幅构图偏向一侧（真机实测抓出的构图缺陷）。
 * ★拿不到 ⇒ 抛错（节目单因此报错退出——**不静默退化**成错误构图）。
 */
function readTileCenters(): Array<{ x: number; y: number }> {
  const raw = proteusSelfDraw.rects()
  const o = JSON.parse(raw) as { ok?: boolean; rects?: Record<string, { x: number; y: number; width: number; height: number }> }
  if (o?.ok !== true || !o.rects) {
    throw new Error(`读内核几何失败（rects 返回 ${raw.slice(0, 120)}）——构型幕无法计算位移`)
  }
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < state.n; i++) {
    const r = o.rects[String(1000 + i)]
    if (!r) throw new Error(`内核几何缺瓦片 ${1000 + i}（(${i + 1}/${state.n})）`)
    out.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  }
  return out
}

/* ────────────────── ③ 场景主流程 ────────────────── */

export function __proteusShowcaseRun(argsJson?: string): string {
  const args: Args = argsJson ? JSON.parse(argsJson) : {}
  const a: Required<Args> = {
    tiles: args.tiles ?? 800,
    cols: args.cols ?? 20,
    soakMs: args.soakMs ?? 0,
  }
  state.args = a
  const vp = (globalThis as unknown as { __PROTEUS_VIEWPORT__?: { width: number; height: number } }).__PROTEUS_VIEWPORT__
  const viewW = Math.round(vp?.width ?? 390)
  const viewH = Math.round(vp?.height ?? 844)
  state.n = a.tiles
  state.ids = Array.from({ length: a.tiles }, (_, i) => 1000 + i)
  state.acts = []

  const t0 = Number(proteusSelfDraw.nowUs()) / 1000
  const tree = buildTree(viewW, viewH, a.tiles, a.cols)
  const mountOut = proteusSelfDraw.mount(tree)
  const mountMs = Number(proteusSelfDraw.nowUs()) / 1000 - t0
  const mounted = safeParse(mountOut)
  if ((mounted as { ok?: boolean }).ok !== true) {
    return JSON.stringify({ ok: false, error: '建树失败', detail: mounted })
  }

  // 节目单（环境：几何现读函数 + 网格参数 + 长跑时长）
  state.program = createShowcaseProgram({
    ids: state.ids,
    cols: a.cols,
    view: { width: viewW, height: viewH },
    tilePx: state.geom.tile,
    centers: readTileCenters,
    soakMs: a.soakMs,
  })
  state.plan = state.program.plan()

  // 抽查节点（判据用：终值 + 真实生效）
  state.sampleIds = [1000, 1000 + Math.floor(a.tiles / 2), 1000 + a.tiles - 1]

  results.build_id = BUILD_ID
  results.tiles = a.tiles
  results.cols = a.cols
  results.grid = { cols: state.geom.cols, rows: state.geom.rows, tile: state.geom.tile }
  results.view = { w: viewW, h: viewH }
  results.mount = mounted
  results.mount_ms = round2(mountMs)
  results.plan = state.plan
  // ★循环数**从节目单数**（2026-10-01 修正：不再用名义常量 `SOAK_CYCLE_MS` 反推——
  //   storm 的真实跨度 = maxRank×stagger + duration，是名义值的 2.4×，旧算法会把
  //   "5 分钟"展开成 12.6 分钟；节目单自己按真编译产物展开，这里数它就是权威值）。
  const soakCycles = state.plan.filter((n) => n.startsWith('soak-storm#')).length
  results.soak = { ms: a.soakMs, cycles: soakCycles }
  return JSON.stringify({ ok: true, tiles: a.tiles, mount_ms: round2(mountMs), acts: state.plan.length })
}

/**
 * 取下一幕并**发令**（宿主在幕边界调用）。
 * FLIP 幕 = 三条宿主指令（capture → updatePatches → start），其余幕 = 一批 animStart。
 */
export function __proteusShowcaseNext(): string {
  const program = state.program
  if (!program) return JSON.stringify({ ok: false, error: '节目单未初始化（先调 __proteusShowcaseRun）' })
  const t0 = Number(proteusSelfDraw.nowUs()) / 1000
  let act: ShowcaseAct | null = null
  try {
    act = program.next()
  } catch (e) {
    return JSON.stringify({ ok: false, error: `节目单取幕失败：${(e as Error).message}` })
  }
  if (!act) return JSON.stringify({ ok: true, done: true })

  if (act.flip) {
    // ★FLIP 三段：capture（内核记当前绝对矩形）→ 改几何（全量重排）→ start（Δ→0 补间）
    const cap = safeParse(proteusSelfDraw.animFlip(JSON.stringify({ op: 'capture' })))
    const upd = safeParse(proteusSelfDraw.updatePatches(JSON.stringify(act.flip.patches)))
    const st = safeParse(proteusSelfDraw.animFlip(
      JSON.stringify({ op: 'start', durMs: act.flip.durMs, curve: act.flip.curve, staggerMs: 0 }),
    ))
    // ★回执进报告：`start` 的 updates 有几百项（会撑爆报告）⇒ 只留摘要
    results[`flip_${act.name}`] = {
      note: act.flip.note,
      capture: cap,
      patch: upd,
      start: summarizeFlipStart(st),
    }
  } else {
    const out = safeParse(proteusSelfDraw.animStart(JSON.stringify({ anims: act.anims })))
    if ((out as { ok?: boolean }).ok !== true) {
      return JSON.stringify({ ok: false, error: `幕「${act.name}」发令失败`, detail: out })
    }
  }

  const issueMs = Number(proteusSelfDraw.nowUs()) / 1000 - t0
  // ★★逃生口记账（2026-10-01）：把本幕**编译产物条数**记入全局注册表——
  //   这正是 `compileAnimations(..., { escapes })` 在编译期会做的记账（每声明 1 条动画，1:1；
  //   `compileChoreography` 内部逐片调它）。炫技场是**首个真实消费面**：登记数进报告 ⇒
  //   「逃生口率」从"装置就绪、待采数"变成**每轮真机断言**（判据 check-showcase.py ⑥）。
  //   ★FLIP 幕的补间由内核 `flip_start` 内生（不经 compileAnimations）⇒ 不进分母（声明式为 0）。
  escapes.noteDeclarative(act.anims.length)
  state.acts.push({
    name: act.name,
    anims: act.anims.length,
    issue_ms: round2(issueMs),
    span_ms: round2(act.spanMs),
    hold_ms: round2(act.holdMs),
    duration_ms: round2(act.durationMs),
    note: act.note,
    ...(act.flip ? { flip: true } : {}),
  })
  return JSON.stringify({
    ok: true,
    name: act.name,
    spanMs: act.spanMs,
    holdMs: act.holdMs,
    durationMs: act.durationMs,
    anims: act.anims.length,
    issue_ms: round2(issueMs),
    note: act.note,
  })
}

/** FLIP start 回执摘要（`updates` 只留条数——几千项数组不进报告） */
function summarizeFlipStart(st: unknown): unknown {
  const o = st as { ok?: boolean; animated?: number; maxDeltaPx?: number; updates?: unknown[] } | null
  if (!o || typeof o !== 'object') return st
  const { updates, ...rest } = o
  return { ...rest, updates_len: Array.isArray(updates) ? updates.length : 0 }
}

/** 帧循环结束后的收尾（宿主在演完后调用）：读数 + 抽样探针 + 截图 */
export function __proteusShowcaseFinalize(): string {
  const fr = safeParse(proteusSelfDraw.animFrameStats())
  const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify(state.sampleIds)))
  const snap = safeParse(proteusSelfDraw.snapshot('showcase-final'))
  results.frame_stats = fr
  results.probe = probe
  results.snapshot = snap
  results.acts = state.acts
  results.acts_complete = state.acts.length === state.plan.length
    && state.acts.every((a, i) => a.name === state.plan[i])
  // ★★逃生口率（真实消费面的首个采集点，2026-10-01）：整场是 31200 条声明式指令
  //   （12 幕 × 每幕 compileAnimations 产物）＋ 0 条逃生口登记 ⇒ 率 = 0%，
  //   由判据（check-showcase.py ⑥）对目标 5% 做机器判定——把「装置就绪、待采数」
  //   落成「已采数」。★这只是**本演示**的用量，不等于全业务面（诚实标注）。
  results.escapes = escapes.summary()
  results.ok = true
  const json = JSON.stringify(results)
  proteusSelfDraw.report(json)
  return json
}

/**
 * ★★**动画还在动吗**（0 = 全部结束）——从宿主桥透传内核答案（幕切换的权威判据）。
 * ★为什么不在这里按 `spanMs` 推算：弹簧的结束时刻由**物理**决定（`settle_eps` 内静止），
 *   名义 `durMs` 只是采样窗口 ⇒ 推算会早切（姿态没到位）或多等（可见停顿）。
 */
export function __proteusShowcaseActive(): string {
  return proteusSelfDraw.animActiveCount()
}

/** ★定格截图（宿主在指定幕边界调用；命名权在宿主侧静态量——见 showcase-scene.swift 注释） */
export function __proteusShowcaseSnap(name: string): string {
  return proteusSelfDraw.snapshot(name)
}

/** 停掉全部动画并复位（幕间清理——本仓纪律：不假设上一步留下的还能用） */
export function __proteusShowcaseReset(): string {
  return proteusSelfDraw.animStopAll()
}

/**
 * ★★**重播**（demo 模式：从桌面点开时循环演出——"随时点开给团队看"）。
 *
 * 语义：停掉全部动画（`animStopAll` 会**清视觉值** ⇒ 回到基线，见内核 `stop_all` 注释）
 * → 重建节目单（上一轮的幕索引已耗尽）→ 返回新的幕数。
 * ★为什么必须清值：谢幕语结束时全屏是"文字构型"（非基线），不清就重播会从错乱姿态开始。
 */
export function __proteusShowcaseRestart(): string {
  const stop = safeParse(proteusSelfDraw.animStopAll())
  state.acts = []
  state.program = createShowcaseProgram({
    ids: state.ids,
    cols: state.args.cols,
    view: { width: state.geom.w, height: state.geom.h },
    tilePx: state.geom.tile,
    centers: readTileCenters,
    soakMs: state.args.soakMs,
  })
  state.plan = state.program.plan()
  results.plan = state.plan
  return JSON.stringify({ ok: true, stop, acts: state.plan.length })
}

/* ────────────────── 工具 ────────────────── */

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
;(globalThis as unknown as { __proteusShowcaseRun: typeof __proteusShowcaseRun }).__proteusShowcaseRun = __proteusShowcaseRun
;(globalThis as unknown as { __proteusShowcaseNext: typeof __proteusShowcaseNext }).__proteusShowcaseNext = __proteusShowcaseNext
;(globalThis as unknown as { __proteusShowcaseFinalize: typeof __proteusShowcaseFinalize }).__proteusShowcaseFinalize = __proteusShowcaseFinalize
;(globalThis as unknown as { __proteusShowcaseSnap: typeof __proteusShowcaseSnap }).__proteusShowcaseSnap = __proteusShowcaseSnap
;(globalThis as unknown as { __proteusShowcaseRestart: typeof __proteusShowcaseRestart }).__proteusShowcaseRestart = __proteusShowcaseRestart
;(globalThis as unknown as { __proteusShowcaseActive: typeof __proteusShowcaseActive }).__proteusShowcaseActive = __proteusShowcaseActive
;(globalThis as unknown as { __proteusShowcaseReset: typeof __proteusShowcaseReset }).__proteusShowcaseReset = __proteusShowcaseReset
// ★`__proteusShowcaseFrameLoop` 已**删除**（2026-10-01）：它启动的 view 自带 CADisplayLink
//   与宿主自己的帧循环构成**双驱动** ⇒ 动画以 2× 实速播放（真机录屏取证）。
//   帧驱动唯一来源 = 宿主的 CADisplayLink（见 showcase-scene.swift ⑥ 处注释）——勿再加回。
// ★逐帧推进（宿主帧循环里调；与 entry-selfdraw 的 animTick 同源——但这里由**宿主**驱动而非脚本）
//   回执含 `active`（内核仍在推进的动画条数）——宿主据此记录每幕动画的真正结束时刻。
;(globalThis as unknown as { __proteusShowcaseTick: (dtMs: number) => string }).__proteusShowcaseTick = (
  dtMs: number,
): string => proteusSelfDraw.animTick(dtMs)
