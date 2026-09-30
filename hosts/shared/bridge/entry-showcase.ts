// hosts/shared/bridge/entry-showcase.ts —— ★★Morpheus 炫技场（真机性能演示）
//
// 【这一场要证明什么（用户要求）】「该演示就是动画引擎炫技的存在，要求酷炫，吸睛，丝滑流畅不掉帧，
//   而且还能考验动画引擎性能，**在其他跨端框架不敢轻易尝试的那种**」。
//
// 【为什么别人不敢试（本仓的差异化就在这里）】
//   · Web/VDOM 框架：800 个节点的逐节点动画 = 800 次样式写入 + 800 次布局失效重算
//     （浏览器每帧要重排/重绘整棵树）⇒ 常见做法是"只动 transform 并限制节点数"；
//   · RN/小程序：每个节点是**原生视图**，800 个视图同屏编舞是内存与桥接的双重灾难；
//   · Flutter：能跑，但走 Dart 层每帧求值（本仓的曲线/物理在 **Rust 内核**，且每帧只跨一次边界）。
//   ⇒ 本场用**真指令**驱动 800 片瓦片做"弹簧波浪 → FLIP 重排 → 螺旋收束"三段编舞，
//     并给出**帧率/掉帧/每帧成本/终值**四类机器读数（判据脚本 check-showcase.py）。
//
// 【零伪造】所有运动都来自 `@proteus-vue/animation` 的**真编译产物**（`compileAnimations` /
//   `presets.*`），逐帧值与内核同一套（`animValue` 是 golden 对拍过的镜像）。
//   本场景不写任何"手搓关键帧"。
//
// 【三段编舞（一段比一段"不敢试"）】
//   A. **弹簧波浪**：800 片各自 spring 从 `fromY` 弹到 0，`delayMs = 列序 × stagger`
//      ⇒ 一条从左上到右下的**斜向波浪**（每片都是真 spring 物理，不是正弦查表）。
//   B. **FLIP 重排**：把网格从 40 列「重排」到 20 列（真实几何变更：先 capture → 改布局 →
//      再 start）⇒ 800 片**同时**归位到新位置。这是"布局动画"的招牌——几何在内核，
//      零跨边界几何查询。
//   C. **螺旋收束**：800 片按 `index` 各自的 `rotate + scale + translate` 收成一个漩涡
//      （每片参数不同 ⇒ 800 条独立指令并发）。
//
// 【为什么这三段能"考验性能"】A 段 800 条独立 spring（物理积分，最贵）；B 段 800 片几何全变
//   （FLIP 补间，跨边界数据最多）；C 段 800 片三属性并发（每帧写层最多：2400 个属性/帧）。
//
// 【产物】两份报告（与其它场景同构）
//   · `showcase.json`        —— 场景读数（段位、指令数、终值抽查、帧率/掉帧/每帧成本）
//   · `showcase-final.png`   —— 收尾截图（宿主截）
import { compileAnimations, presets } from '@proteus-vue/animation'
import type { AnimDecl, CompiledBatch } from '@proteus-vue/animation'
import { animValue } from '@proteus-vue/slot-runtime'

// ★构建标识（由 hosts/ios/bridge/inject-build-id.mjs **编译期替换**——与 entry-bench/entry-selfdraw
//   同一机制；报告据此断言"设备上跑的是本次构建"）
const BUILD_ID = 'e0646e73-220543'

/** 帧内视图参数（建树时定，后续段复用） */
interface ViewGeom {
  w: number
  h: number
  cols: number
  rows: number
  tile: number
  gap: number
  pad: number
}
let geom: ViewGeom = { w: 0, h: 0, cols: 0, rows: 0, tile: 0, gap: 3, pad: 10 }
/** 每片瓦片的中心坐标（螺旋段要用；几何由**内核算出的布局**决定 ⇒ 建树后用 rects 读回） */
let tileCenters: Array<{ x: number; y: number }> = []

/* ────────────────── 宿主桥（与 entry-selfdraw 同一套注入名） ────────────────── */

interface ShowcaseHost {
  mount(treeJson: string): string
  update(treeJson: string): string
  updatePatches(json: string): string
  animStart(json: string): string
  animTick(dtMs: number): string
  animFlip(json: string): string
  animStopAll(): string
  animStartFrameLoop(): string
  animStopFrameLoop(): string
  animFrameStats(): string
  rects(): string
  layerTransformProbe(idsJson: string): string
  snapshot(name: string): string
  report(json: string): void
  nowUs(): string
}
declare const proteusSelfDraw: ShowcaseHost

/* ────────────────── 场景参数（真机可调；判据读回报） ────────────────── */

interface Args {
  /** 瓦片数（默认 800：40×20 网格） */
  tiles?: number
  /** 网格列数（默认 40） */
  cols?: number
  /** 每段时长（ms；默认 900） */
  segmentMs?: number
  /** 波浪行间错峰（ms） */
  staggerMs?: number
  /** 段间停顿（ms） */
  gapMs?: number
}

let COLS = 40
const ROWS = (n: number, c: number): number => Math.ceil(n / c)

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
    // 根：纵向排布所有行（column 流式）
    { id: 1, width: viewW, height: viewH, flexDirection: 'column', gap, padding: { left: pad, top: pad, right: pad, bottom: pad } },
  ]
  let nextId = 2
  const rowIds: number[] = []
  for (let r = 0; r < rows; r++) {
    const rid = nextId++
    rowIds.push(rid)
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
  geom = { w: viewW, h: viewH, cols, rows, tile, gap, pad }
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

/* ────────────────── ② 三段编舞：真编译产物 ────────────────── */

/** 段 A：弹簧波浪（每片 spring 从 `fromY` 弹到 0；delay 按 **行+列** 斜向错峰） */
function segmentWave(n: number, cols: number, staggerMs: number): { anims: unknown[]; decls: number } {
  const all: unknown[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const delay = (row + col) * staggerMs
    const decls: AnimDecl[] = [
      // ★真 spring（不是曲线查表）：stiffness/damping 取自预设库的 `easing.smooth` 家族
      { kind: 'translateY', from: -260, to: 0, spring: presets.easing.smooth, delayMs: delay },
      { kind: 'opacity', from: 0, to: 1, curve: 'easeOut', durationMs: 220, delayMs: delay },
    ]
    const b: CompiledBatch = compileAnimations(decls, { nodeId: 1000 + i })
    all.push(...b.anims)
  }
  return { anims: all, decls: all.length }
}

/**
 * 段 C：螺旋收束（每片各自的 rotate + scale + translate —— 800×4 条并发指令）。
 * ★位移量取自**内核算出的真实布局**（`tileCenters` —— 建树后从 rects 读回），
 *   不是 JS 自己按列宽手算的（否则"几何在内核"这条纪律就破了）。
 */
function segmentSpiral(n: number, viewW: number, viewH: number): { anims: unknown[]; decls: number } {
  // ★构图锚点 = **视口中心**（真机截图实测：这一版漩涡居中且比例合适）。
  //   ★不要再改成"瓦片质心"：FLIP 重排后质心会偏移（实测把漩涡推到右上角、画面几乎全黑）。
  const cx = viewW / 2
  const cy = viewH / 2
  const all: unknown[] = []
  for (let i = 0; i < n; i++) {
    const c = tileCenters[i] ?? { x: cx, y: cy }
    // ★★目标构型：**居中的多臂漩涡**（铺满屏幕、不溢出）
    //   · 角度：3 圈渐开线（i/n × 6π）+ 每片一个小偏移 ⇒ 视觉上连续成臂
    //   · 半径：从内圈 0.06 到外圈 0.46 × min(半宽,半高)（留 4% 边距，**不出屏**）
    //   （此前 0.78 倍系数且在旧几何上算 ⇒ 漩涡偏向一角并大量出屏——真机截图抓出）
    const ang = (i / n) * Math.PI * 6
    // 半径：0.05 → 0.92 × min(半宽,半高)（铺满屏；外圈到 0.92 留 8% 边距不出屏）
    const rMin = Math.min(viewW, viewH) / 2
    const rad = rMin * (0.05 + 0.87 * (i / n))
    const tx = cx + Math.cos(ang) * rad - c.x
    const ty = cy + Math.sin(ang) * rad - c.y
    const decls: AnimDecl[] = [
      { kind: 'translateX', from: 0, to: tx, curve: 'easeInOut', durationMs: 900 },
      { kind: 'translateY', from: 0, to: ty, curve: 'easeInOut', durationMs: 900 },
      { kind: 'rotate', from: 0, to: (i % 2 === 0 ? 1 : -1) * (180 + (i / n) * 540), curve: 'easeInOut', durationMs: 900 },
      { kind: 'scale', from: 1, to: 0.35, curve: 'easeInOut', durationMs: 900 },
    ]
    const b = compileAnimations(decls, { nodeId: 1000 + i })
    all.push(...b.anims)
  }
  return { anims: all, decls: all.length }
}

/* ────────────────── ③ 场景主流程（同步相位 + 异步帧循环） ────────────────── */

interface SegResult {
  name: string
  anims: number
  ms: number
}

const state = {
  args: {} as Required<Args>,
  viewW: 0,
  viewH: 0,
  n: 0,
  segments: [] as SegResult[],
  framesStart: 0,
  sampleIds: [] as number[],
}
const results: Record<string, unknown> = { ok: false }

/** 段 A+B+C 的编排（宿主逐段调用；每段内部启动动画后由帧循环推进） */
export function __proteusShowcaseSegment(which: string): string {
  const t0 = Number(proteusSelfDraw.nowUs()) / 1000
  const { viewW, viewH, n } = state
  const cols = state.args.cols
  let anims: unknown[] = []
  let decls = 0

  if (which === 'wave') {
    const r = segmentWave(n, cols, state.args.staggerMs)
    anims = r.anims
    decls = r.decls
  } else if (which === 'flip') {
    // ★FLIP：capture（内核记 800 片绝对矩形）→ 改布局（列数 40 → 20）→ start（Δ→0 补间）
    const cap = proteusSelfDraw.animFlip(JSON.stringify({ op: 'capture' }))
    results.flip_capture = safeParse(cap)
    // 改布局：把容器改成 20 列（通过 updatePatches 改瓦片宽度 —— 真实几何变更）
    const newCols = Math.max(8, Math.floor(cols / 2))
    const newW = Math.floor((viewW - 20 - 3 * (newCols - 1)) / newCols)
    const patches = []
    for (let i = 0; i < n; i++) patches.push({ id: 1000 + i, style: { width: newW, height: newW } })
    const upd = proteusSelfDraw.updatePatches(JSON.stringify(patches))
    results.flip_patch = safeParse(upd)
    // ★stagger 归零：800 片 × stagger 会变成数秒级长尾（那成了"逐片入场"，不是"整片重排"）
    const st = proteusSelfDraw.animFlip(
      JSON.stringify({ op: 'start', durMs: state.args.segmentMs, curve: 1, staggerMs: 0 }),
    )
    results.flip_start = safeParse(st)
    state.segments.push({ name: 'flip', anims: 0, ms: Number(proteusSelfDraw.nowUs()) / 1000 - t0 })
    return st
  } else if (which === 'spiral') {
    // ★★现读**当前**几何（FLIP 重排之后！）——见 readTileCenters 注释
    tileCenters = readTileCenters(n)
    const r = segmentSpiral(n, viewW, viewH)
    anims = r.anims
    decls = r.decls
  } else {
    return JSON.stringify({ ok: false, error: `未知段：${which}` })
  }

  const out = proteusSelfDraw.animStart(JSON.stringify({ anims }))
  state.segments.push({ name: which, anims: decls, ms: Number(proteusSelfDraw.nowUs()) / 1000 - t0 })
  return out
}

export function __proteusShowcaseRun(argsJson?: string): string {
  const args: Args = argsJson ? JSON.parse(argsJson) : {}
  const a: Required<Args> = {
    tiles: args.tiles ?? 800,
    cols: args.cols ?? 40,
    segmentMs: args.segmentMs ?? 900,
    staggerMs: args.staggerMs ?? 4,
    gapMs: args.gapMs ?? 120,
  }
  state.args = a
  const vp = (globalThis as unknown as { __PROTEUS_VIEWPORT__?: { width: number; height: number } }).__PROTEUS_VIEWPORT__
  state.viewW = Math.round(vp?.width ?? 390)
  state.viewH = Math.round(vp?.height ?? 844)
  state.n = a.tiles
  state.segments = []
  COLS = a.cols

  const t0 = Number(proteusSelfDraw.nowUs()) / 1000
  const tree = buildTree(state.viewW, state.viewH, state.n, a.cols)
  const mountOut = proteusSelfDraw.mount(tree)
  const mountMs = Number(proteusSelfDraw.nowUs()) / 1000 - t0
  const mounted = safeParse(mountOut)

  // ★建树后从**内核几何**读回瓦片中心（螺旋段据此算位移——几何仍出自内核）
  tileCenters = readTileCenters(state.n)

  // 抽查节点（用于判据：终值 + 真实生效）
  state.sampleIds = [1000, 1000 + Math.floor(state.n / 2), 1000 + state.n - 1]

  results.build_id = BUILD_ID
  results.tiles = state.n
  results.cols = a.cols
  results.grid = { cols: geom.cols, rows: geom.rows, tile: geom.tile }
  results.view = { w: state.viewW, h: state.viewH }
  results.mount = mounted
  results.mount_ms = round2(mountMs)
  return JSON.stringify({ ok: (mounted as { ok?: boolean }).ok === true, tiles: state.n, mount_ms: round2(mountMs) })
}

/** 帧循环结束后的收尾（宿主在时长跑满后调用）：读数 + 抽样探针 + 截图 */
export function __proteusShowcaseFinalize(): string {
  const fr = safeParse(proteusSelfDraw.animFrameStats())
  const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify(state.sampleIds)))
  const snap = safeParse(proteusSelfDraw.snapshot('showcase-final'))
  results.frame_stats = fr
  results.probe = probe
  results.snapshot = snap
  results.segments = state.segments
  results.ok = true
  const json = JSON.stringify(results)
  proteusSelfDraw.report(json)
  return json
}

/** 停掉全部动画并复位（段间清理——本仓纪律：不假设上一步留下的还能用） */
export function __proteusShowcaseReset(): string {
  return proteusSelfDraw.animStopAll()
}

/** 启动/停止帧循环（宿主侧 CADisplayLink） */
export function __proteusShowcaseFrameLoop(on: string): string {
  return on === 'on' ? proteusSelfDraw.animStartFrameLoop() : proteusSelfDraw.animStopFrameLoop()
}

/* ────────────────── 工具 ────────────────── */

/**
 * 读**内核几何**（`rects`）→ 瓦片中心。
 * ★为什么必须现读（炫技场实测抓出的构图缺陷）：螺旋段的位移 = 目标 − **当前**位置，
 *   而 FLIP 重排后位置全变了（列数减半、瓦片变宽）⇒ 用建树时的旧几何 ⇒ 整幅漩涡**偏向一侧**。
 * ★拿不到就返回空数组（调用方退化为不位移，而不是用错误的旧值算出偏构图）。
 */
function readTileCenters(n: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  try {
    const raw = proteusSelfDraw.rects()
    const o = JSON.parse(raw) as { ok?: boolean; rects?: Record<string, { x: number; y: number; width: number; height: number }> }
    if (o?.ok !== true || !o.rects) return out
    for (let i = 0; i < n; i++) {
      const r = o.rects[String(1000 + i)]
      if (!r) return out
      out.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
    }
  } catch {
    /* 读失败 ⇒ 空数组（调用方退化） */
  }
  return out
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
;(globalThis as unknown as { __proteusShowcaseRun: typeof __proteusShowcaseRun }).__proteusShowcaseRun = __proteusShowcaseRun
;(globalThis as unknown as { __proteusShowcaseSegment: typeof __proteusShowcaseSegment }).__proteusShowcaseSegment = __proteusShowcaseSegment
;(globalThis as unknown as { __proteusShowcaseFinalize: typeof __proteusShowcaseFinalize }).__proteusShowcaseFinalize = __proteusShowcaseFinalize
;(globalThis as unknown as { __proteusShowcaseReset: typeof __proteusShowcaseReset }).__proteusShowcaseReset = __proteusShowcaseReset
;(globalThis as unknown as { __proteusShowcaseFrameLoop: typeof __proteusShowcaseFrameLoop }).__proteusShowcaseFrameLoop = __proteusShowcaseFrameLoop
// ★逐帧推进（宿主帧循环里调；与 entry-selfdraw 的 animTick 同源——但这里由**宿主**驱动而非脚本）
;(globalThis as unknown as { __proteusShowcaseTick: (dtMs: number) => string }).__proteusShowcaseTick = (
  dtMs: number,
): string => proteusSelfDraw.animTick(dtMs)
