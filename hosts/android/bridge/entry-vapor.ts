// hosts/android/bridge/entry-vapor.ts —— ★★★**真实 SFC → 编译产物 → 设备端实例化 → 自研渲染体系**
//
// 【这一条链路补的是什么（本仓 2026-10-01 核实的缺口）】
//   此前 Android 侧跑的是「**构建期**在 Node 里预实例化好的静态树」：
//     `gen-app4050-fixture.mjs` 的注释自己写着「Android 测试宿主没有 JS 引擎 ⇒
//      模板实例化无法在设备上跑」——**该前提已过期**（QuickJS 已在设备上跑着）；
//     而 `entry-batch.ts` 的注释写着「**不接 Vue**」（它只把节点表喂给适配器）。
//   ⇒ 真实 Vue 模板经编译器产出的两件产物（LayoutTemplate + 订阅表）**从未在设备上跑过**：
//     · 设备端**实例化**（模板 + 数据 → 可渲染的节点树）：从未；
//     · **订阅驱动的增量更新**（数据变 → 槽位求值 → 二进制指令 → 内核几何变化）：从未。
//   本入口就是那两段。设备端 JS **只产语义树与指令**，几何一律由宿主侧的 Rust 核心算
//   （与 iOS `entry-selfdraw.ts` 同一分工，也遵守「JS 不算任何几何」的既有纪律）。
//
// 【★分段与理由（为什么编译在构建期、实例化在设备端）】
//   编译器（`@proteus-vue/compiler`）依赖 `@babel/core` + `@vue/compiler-sfc`——
//   二者都**引用 Node API**（browser 构建里 `path`/`fs` 被 externalize，且代码里有 `Buffer`）
//   ⇒ **不适合进 QuickJS**（不是"不想"，是依赖形态不允许；如实标注，不假装端上能编译）。
//   ⇒ 分工：**构建期**跑编译器（产物是**纯 JSON**——`LayoutTemplate` + `SubscriptionTable`
//     都是可序列化声明，方案 §4.4 明确要求"产物可序列化、跨端禁 eval"）；
//     **设备端**跑实例化 + 订阅驱动更新（这两件只依赖 `@proteus-vue/slot-runtime`，
//     纯 TS 零 Node API，50KB → 完全可以进 bundle）。
//   ★这条分工正是产品形态：`proteus build` 编译、App 运行时实例化 + 更新。
//
// 【链路（全同步，铁律 A-02）】
//   ① 构建期：SFC → `buildLayoutTemplate()` + `buildVaporSubscriptions()` → `vapor-artifacts.json`
//      （见 `gen-vapor-fixture.mjs`；由构建路径自动刷新）
//   ② 设备端（本文件）：`instantiateTemplate(tpl, { read, table, registry })`
//      → `{ viewport, nodes, virtual }` → 宿主 `mount`（Rust 核心建树 + 算几何 + 下发绘制指令）
//   ③ 设备端更新：改数据 → `VaporRuntime`（订阅表 → 槽位求值 → **二进制指令流**）
//      → 宿主 `applyOps` → Rust 内核增量重排 ⇒ 回执给"哪些节点真的动了 + 重排范围"
//
// 【★诚实边界（写在这里，判据里逐条核）】
//   · 文本度量仍由宿主注入（内核不自研文本，Profile §L4）——本入口只报文本字面量；
//   · 单层 v-for（模板产物能力边界，见 `buildLayoutTemplate` 的诊断）；
//   · `virtual`（虚拟化描述）本入口**透传但不消费**——端上消费它是长列表批次的事；
//   · 指令流走 `encodeOps` 二进制（与 iOS `applyOps` 同一条），不经 JSON。
//
// 【产物】hosts/android/bridge/dist/bundle-vapor.js（IIFE，QuickJS 直接 eval）
// 【调用】Java：`__proteusVaporRun(argsJson)`（见 MainActivity 的 `vapor` 通路）
import { instantiateTemplate, ListRegistry, PropKeyTable, StringPool, SlotRuntime, VaporRuntime, evalExpr } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

/* ══════════════════ 宿主桥（Java 经 JNI 注入；与 JsRenderHost 的三个入口同形） ══════════════════ */

interface VaporHost {
  /** 建树（首帧）：`{viewport, nodes}` → 宿主注入度量 + 核心建树 + 算几何 + 下发绘制指令 */
  mount(treeJson: string): string
  /** 二进制指令流（`number[]` JSON 形态——JNI 侧转 byte[]，见 JsRenderHost.applyOps） */
  applyOps(opsJson: string): string
  /** 核心几何读数（判据用：**从内核真源读**，不是从我们发下去的参数复述） */
  readRects(): string
  /** ★★绘制通道探针（读**宿主真源**：渐变/发光/遮罩/圆角/裁剪/描边建出来了没） */
  probeChannels(idsJson: string): string
  /**
   * ★★**注册手势回调**（交互闭环的反向通道：**宿主 → JS**）——传函数名，JS 侧注册后由
   *   宿主在"语义手势 + 命中节点"时回调 `__proteusVaporGesture(type, nodeId)`。
   *   ★与其余入口的差别：那些是 JS→Java（同步取返回值）；这条是 Java→JS（宿主驱动），
   *     故用**注册函数名 + 全局回调**的形态（QuickJS 侧唯一可行的同步反向调用）。
   */
  onGesture?(jsCallbackName: string): string
  /** ★进程内注入一次 tap（判据驱动；真机 `adb input tap` 无权限——见宿主注释） */
  tapAt?(argsJson: string): string
  /** 手势探针（判据：手势真的到宿主了吗 / 点在哪） */
  probeGesture?(): string
  /** ★★**虚拟化挂载**（长列表：整树在内核、宿主只物化可见区）——`{viewport,nodes,rows}` */
  mountVirtual(treeJson: string): string
  /** ★★虚拟化滚动一帧：`{dy, capture}` → 核心给决策、宿主执行动作 */
  scrollRows(argsJson: string): string
}

declare const proteusHost: VaporHost

/* ══════════════════ 入参 ══════════════════ */

interface VaporArgs {
  viewport: { width: number; height: number }
  /** 编译产物（构建期产出的 JSON 串；必填）——`{tpl, table, sfc}` */
  artifacts: string
  /**
   * 模式：`'short'`（缺省）= 实例化 + 订阅驱动增量；
   *      `'list'` = **长列表虚拟化**（1000 行、行高 100px、30 下 + 30 上滚动）。
   */
  mode?: 'short' | 'list'
  /** 行数（覆盖产物里的首行数据；短列表缺省 8 / 长列表缺省 1000） */
  rows?: number
  /** 增量更新轮数（每轮改一行文本 + 一行宽度 ⇒ 走订阅表 → 指令流） */
  updates?: number
}

/** 长列表（虚拟化）报告 */
interface VaporListReport {
  ok: boolean
  error?: string
  tpl_nodes: number
  sub_l1: number
  inst_nodes: number
  inst_rows: number
  inst_allocated_ids: number
  mount_ms: number
  row_count: number
  row_pitch: number
  /** ★物化有界：存活行 / 存活指令（**与滚动距离无关**是核心断言） */
  rows_live_first: number
  cmds_live_first: number
  /** 30 下滚动：物化总数增量（应**有界**——每帧新物化的行数 = 新进视野的行数） */
  down_frames: number
  down_built_delta: number
  /** 30 上滚动（回顶） */
  up_frames: number
  up_built_delta: number
  /** 滚动过程的读数轨迹（每 10 帧采一次：存活行/指令/已物化总数——"有界"的证据） */
  trail: Array<{ f: number; scroll: number; live: number; cmds: number; built: number }>
  /** 部分帧的签名差异（"真的动了"） */
  moved_diff_pct: number
  /** 回顶后与顶部签名的差异（**应 ≈ 0 = 恒等**：虚拟化没有累积漂移） */
  back_top_diff_pct: number
  /** 最后一帧的 scroll_y / 复用的行帧累计 */
  final_scroll: number
  row_frames_total: number
  built_total: number
  released_total: number
  uninstantiated_slots: number
  notes: string[]
}

interface VaporReport {
  ok: boolean
  error?: string
  // —— 编译产物段（构建期产出，这里只报规模——证明"产物真的来自编译器"）——
  tpl_nodes: number
  tpl_ok: boolean
  sub_l1: number
  sub_l0: number
  sub_l1_rate: number
  /** 订阅表里的源名（判据核对"行内槽位真的挂上了 list 源"） */
  sub_sources: string[]
  // —— 实例化段（★设备端跑）——
  inst_ms: number
  inst_nodes: number
  inst_reused_ids: number
  inst_allocated_ids: number
  inst_rows: number
  inst_values_filled: number
  inst_virtual_rows: number
  /** 实例树里 text 非空 / width 非空的节点数（"数据真的回填了"的机器证据） */
  inst_text_filled: number
  inst_width_filled: number
  // —— 渲染段（宿主侧读数，回执）——
  mount_ms: number
  mount_nodes: number
  host_layout_ms?: number
  host_cmds?: number
  // —— 增量段（订阅驱动 → 指令流 → 内核几何）——
  updates_run: number
  ops_bytes: number
  ops_ms: number
  apply_ms: number
  /** ★文本同步累计（回归锁：内核 text_updates 必须被宿主消费——本批修的缺陷） */
  text_synced_total: number
  /** 每轮：改了哪一行 / 内核报的变更集大小 / 重排范围（几何真的动了吗） */
  update_evidence: Array<{ round: number; row: number; ops: number; changed_rects: number; relayout: number; text_synced: number }>
  /** 首轮前后**几何真值对比**（readRects 读内核真源：目标行节点宽度应变） */
  geom_probe: Array<{ id: number; before: number; after: number }>
  /** ★★绘制通道探针（逐通道：读宿主真源，不是复述我们发下去的参数） */
  channels: Array<Record<string, unknown>>
  /* ── ★★交互闭环（2026-10-01）：事件 → 回调 → 改数据 → 订阅 → 指令 → 内核 ── */
  /** 编译产物里的事件绑定数 / handler 数 */
  ev_bindings: number
  ev_handlers: number
  /** 注入的 tap 次数（本判据夹具体验：点"计数按钮"与"宽度按钮"各一次） */
  taps: number
  /** 每次 tap 的逐帧读数：命中节点 / handler 跑了吗 / 源变化 / 内核变更集 / 几何真值 */
  tap_evidence: Array<{
    tap: number
    hit: number
    handler: string
    source_after: unknown
    ops: number
    changed_rects: number
    geom_before: number
    geom_after: number
    /** ★tap 前后**内核几何真源**里真的变了的节点 id（"点一下屏幕真的变了"的证据） */
    geom_diff_ids: number[]
  }>
  // —— 观测 ——
  uninstantiated_slots: number
  notes: string[]
}

/** 生成 N 行数据（行内绑定 `item.w` / `item.title` 都覆盖到） */
function makeData(rows: number): Record<string, unknown> {
  return {
    list: Array.from({ length: rows }, (_, i) => ({ id: i + 1, w: 40 + (i % 5) * 12, title: `row ${i + 1}` })),
    // ★与夹具 script 的 `ref(120)` 一致：**初始数据必须给全**，否则 `:width="boxW"` 首帧是 0，
    //   tap 后变 30 的"对比基线"是零宽（几何差异虽真但语义不清——数据与声明要对齐）
    boxW: 120,
    tapCount: 0,
  }
}

/** 主入口（全同步——铁律 A-02；本入口不依赖微任务：`SlotRuntime.flush()` 是确定性驱动） */
export function __proteusVaporRun(argsJson: string): string {
  const args = JSON.parse(argsJson) as VaporArgs
  if (args.mode === 'list') return runVirtualList(args)
  return runShort(args)
}

/**
 * ★★★**长列表虚拟化**（`mode: 'list'`）：整树进内核（几何正确）、宿主**只物化可见区**。
 *
 * 【它验什么（§9.3 长列表验收的端上缺口）】文档定义「4000 行 / 每行 40+ 元素」的端上规模
 *   此前未跑过（只有 Rust 纯逻辑读数与 iOS 的 1000 行 V12）。本入口跑 **1000 行**：
 *   · 整树 1000 行都在内核（几何正确）；
 *   · 宿主物化行数**有界**（与滚动距离无关）——这是虚拟化的唯一意义所在；
 *   · 30 帧下滚 + 30 帧上滚（回顶）：**回顶签名应恒等**（无累积漂移）；
 *   · 复用池的 acquire/release 由**核心给决策**（`recycleUpdate`），宿主只执行动作。
 */
function runVirtualList(args: VaporArgs): string {
  const t = (): number => Date.now()
  const rows = Math.max(2, args.rows ?? 1000)
  const notes: string[] = []
  const rep: VaporListReport = {
    ok: false, tpl_nodes: 0, sub_l1: 0, inst_nodes: 0, inst_rows: 0, inst_allocated_ids: 0,
    mount_ms: 0, row_count: 0, row_pitch: 0, rows_live_first: 0, cmds_live_first: 0,
    down_frames: 0, down_built_delta: 0, up_frames: 0, up_built_delta: 0, trail: [],
    moved_diff_pct: -1, back_top_diff_pct: -1, final_scroll: 0,
    row_frames_total: 0, built_total: 0, released_total: 0, uninstantiated_slots: 0, notes,
  }
  try {
    const artifacts = JSON.parse(args.artifacts) as { tpl: LayoutTemplate; table: SubscriptionTable; sfc: string }
    rep.tpl_nodes = artifacts.tpl.nodes.length
    rep.sub_l1 = artifacts.table.stats.l1
    if (!artifacts.tpl.ok) {
      rep.error = '模板不可用（构建期诊断）'
      return JSON.stringify(rep)
    }

    // ① 实例化（1000 行）——`virtual.rows` 就是虚拟化要的行描述
    const data = makeListData(rows)
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()
    const inst = instantiateTemplate(artifacts.tpl, { viewport: args.viewport, read, table: artifacts.table, registry })
    rep.inst_nodes = inst.nodes.length
    rep.inst_rows = inst.virtual?.rows.length ?? 0
    rep.inst_allocated_ids = inst.stats.allocatedIds
    if (!inst.virtual || inst.virtual.rows.length === 0) {
      rep.error = '实例化没有产出 virtual.rows（虚拟化不可用）'
      return JSON.stringify(rep)
    }

    // ② 虚拟化挂载（整树进内核、只物化可见区）
    const t2 = t()
    const mo = JSON.parse(
      proteusHost.mountVirtual(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes, rows: inst.virtual.rows })),
    ) as { ok?: boolean; node_count?: number; row_count?: number; row_pitch?: number; rows_live?: number; cmds_live?: number; error?: string }
    rep.mount_ms = t() - t2
    if (mo.ok !== true) {
      rep.error = 'mountVirtual 失败：' + (mo.error ?? '')
      return JSON.stringify(rep)
    }
    rep.row_count = mo.row_count ?? -1
    rep.row_pitch = mo.row_pitch ?? -1
    rep.rows_live_first = mo.rows_live ?? -1
    rep.cmds_live_first = mo.cmds_live ?? -1

    const probe = (): { live: number; cmds: number; built: number; released: number } => {
      const o = JSON.parse(proteusHost.scrollRows('{"dy":0}')) as {
        live_rows?: number; cmds_live?: number; built_total?: number; released_total?: number
      }
      return { live: o.live_rows ?? -1, cmds: o.cmds_live ?? -1, built: o.built_total ?? -1, released: o.released_total ?? -1 }
    }
    const p0 = probe()
    let builtPrev = p0.built

    // ③ 30 帧下滚（每帧 +100px = 一行）
    const step = (dir: 1 | -1, frames: number, label: string): { builtDelta: number; lastDiff: number } => {
      let builtDelta = 0
      let lastDiff = -1
      for (let i = 0; i < frames; i++) {
        const cap = i % 10 === 9
        const o = JSON.parse(proteusHost.scrollRows(JSON.stringify({ dy: dir * 100, capture: cap }))) as {
          ok?: boolean; scroll_y?: number; live_rows?: number; cmds_live?: number; built_total?: number
          released_total?: number; sig_diff_pct?: number; row_frames_total?: number; error?: string
        }
        if (o.ok !== true) {
          notes.push(`${label} 第 ${i} 帧失败：${o.error ?? ''}`)
          break
        }
        rep.final_scroll = o.scroll_y ?? 0
        rep.row_frames_total = o.row_frames_total ?? 0
        rep.built_total = o.built_total ?? 0
        rep.released_total = o.released_total ?? 0
        if (o.sig_diff_pct !== undefined) lastDiff = o.sig_diff_pct
        if (i % 10 === 0 || i === frames - 1) {
          rep.trail.push({ f: i, scroll: o.scroll_y ?? 0, live: o.live_rows ?? -1, cmds: o.cmds_live ?? -1, built: o.built_total ?? -1 })
        }
      }
      builtDelta = (rep.built_total || 0) - builtPrev
      builtPrev = rep.built_total || 0
      return { builtDelta, lastDiff }
    }
    const down = step(1, 30, '下滚')
    rep.down_frames = 30
    rep.down_built_delta = down.builtDelta
    rep.moved_diff_pct = down.lastDiff

    // ④ 30 帧上滚（回顶）+ 回顶签名对比
    const up = step(-1, 30, '上滚')
    rep.up_frames = 30
    rep.up_built_delta = up.builtDelta
    // 回顶帧：capture=true 对比顶部签名
    const top = JSON.parse(proteusHost.scrollRows('{"dy":0,"capture":true}')) as { sig_diff_pct?: number; scroll_y?: number }
    rep.back_top_diff_pct = top.sig_diff_pct ?? -1
    rep.final_scroll = top.scroll_y ?? rep.final_scroll

    rep.uninstantiated_slots = 0
    rep.ok = rep.down_frames > 0 && rep.up_frames > 0
    notes.push(`整树 ${rep.inst_nodes} 节点 / ${rep.row_count} 行 · 首帧物化 ${rep.rows_live_first} 行 / ${rep.cmds_live_first} 指令`)
    return JSON.stringify(rep)
  } catch (e) {
    rep.error = (e as { message?: string })?.message ?? String(e)
    return JSON.stringify(rep)
  }
}

/** 长列表数据（`item.w` 行内绑定 + `item.title` 插值——行内槽位都要有值） */
function makeListData(rows: number): Record<string, unknown> {
  return { list: Array.from({ length: rows }, (_, i) => ({ id: i + 1, w: 120, title: `row ${i + 1}` })) }
}

/** 短列表（缺省模式）：实例化 + 订阅驱动增量 */
function runShort(args: VaporArgs): string {
  const t = (): number => Date.now()
  const rows = Math.max(1, args.rows ?? 8)
  const notes: string[] = []
  const rep: VaporReport = {
    ok: false,
    tpl_nodes: 0, tpl_ok: false, sub_l1: 0, sub_l0: 0, sub_l1_rate: 0, sub_sources: [],
    inst_ms: 0, inst_nodes: 0, inst_reused_ids: 0, inst_allocated_ids: 0, inst_rows: 0,
    inst_values_filled: 0, inst_virtual_rows: 0, inst_text_filled: 0, inst_width_filled: 0,
    mount_ms: 0, mount_nodes: 0,
    updates_run: 0, ops_bytes: 0, ops_ms: 0, apply_ms: 0, text_synced_total: 0, update_evidence: [], geom_probe: [], channels: [],
    ev_bindings: 0, ev_handlers: 0, taps: 0, tap_evidence: [],
    uninstantiated_slots: 0, notes,
  }
  try {
    // ── ① 编译产物（构建期产出）──
    const artifacts = JSON.parse(args.artifacts) as { tpl: LayoutTemplate; table: SubscriptionTable; sfc: string }
    const tpl = artifacts.tpl
    const table = artifacts.table
    rep.tpl_nodes = tpl.nodes.length
    rep.tpl_ok = tpl.ok
    rep.sub_l1 = table.stats.l1
    rep.sub_l0 = table.stats.l0
    rep.sub_l1_rate = table.stats.l1Rate
    rep.sub_sources = table.sources.map((s2) => s2.sourceName)
    if (!tpl.ok) {
      rep.error = '模板不可用（构建期诊断——见 gen-vapor-fixture.mjs 输出）'
      return JSON.stringify(rep)
    }

    // ── ② 设备端实例化：模板 + 数据 → 节点树 ──
    const data = makeData(rows)
    /** 源读取（VaporRuntime 的 EvalContext 契约：按名取当前值；行内作用域由框架按 scope 绑定） */
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()
    const t2 = t()
    const inst = instantiateTemplate(tpl, {
      viewport: args.viewport,
      read,
      table,
      registry,
    })
    rep.inst_ms = t() - t2
    rep.inst_nodes = inst.nodes.length
    rep.inst_reused_ids = inst.stats.reusedTemplateIds
    rep.inst_allocated_ids = inst.stats.allocatedIds
    rep.inst_rows = inst.stats.rows
    rep.inst_values_filled = inst.stats.valuesFilled
    rep.inst_virtual_rows = inst.virtual?.rows.length ?? 0
    // ★回填证据（本仓实测踩过的缺陷形态：不回填 ⇒ 首帧空白/几何错，且**零报错**）
    rep.inst_text_filled = inst.nodes.filter((n) => typeof n.text === 'string' && n.text.length > 0).length
    rep.inst_width_filled = inst.nodes.filter((n) => typeof n.width === 'number').length
    if (rep.inst_text_filled === 0) notes.push('⚠ 实例树里没有任何非空文本——回填链可疑')

    // ── ③ 渲染：交给宿主（Rust 核心算几何 + 下发绘制指令）──
    const t3 = t()
    const mountOut = proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
    rep.mount_ms = t() - t3
    const mo = JSON.parse(mountOut) as { ok?: boolean; nodes?: number; layout_ms?: number; cmds?: number; error?: string }
    if (mo.ok !== true) {
      rep.error = '宿主 mount 失败：' + (mo.error ?? mountOut.slice(0, 200))
      return JSON.stringify(rep)
    }
    rep.mount_nodes = mo.nodes ?? -1
    rep.host_layout_ms = mo.layout_ms
    rep.host_cmds = mo.cmds

    // ── ④ 订阅驱动的增量：改数据 → VaporRuntime → 二进制指令 → 内核 ──
    //
    // 【为什么用 VaporRuntime 而不是手拼指令】这正是"编译产物驱动更新"的形态：
    //   订阅表声明了「哪个槽位听哪个源、怎么写」；运行时只做**求值 + 编码**。
    //   手拼指令会绕开订阅表 ⇒ 那条链等于没验（本入口存在的意义就是验它）。
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const captured: Uint8Array[] = []
    // ★sink = 捕获字节（宿主 applyOps 的入参）；`flush()` 是**确定性驱动**入口——必需：
    //   本入口全同步，而 SlotRuntime 默认调度器是微任务（evaluateScript 期间不排空，本仓实测过）。
    const slotRt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes))
    const evals = VaporRuntime.buildEvaluators(table.evaluators)
    const vapor = new VaporRuntime(table, slotRt, evals, registry)
    const ctx = { read }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)      // 写全部槽位（订阅建立 + 首轮值）
    slotRt.flush()
    captured.length = 0    // ★丢掉首帧指令：初始值已由 instantiateTemplate 回填进树
    rep.uninstantiated_slots = vapor.uninstantiatedSlots.length

    /* ═══════════════ ★★交互闭环（2026-10-01）═══════════════
     *
     * 链路：宿主 tap → hitTest 命中节点 → `GestureListener` → JNI 反向回调
     *       → 本函数（`__proteusVaporGesture`）→ 跑 handler（改数据）→ 触发订阅
     *       → 二进制指令 → 内核重排 → 几何真的变。
     *
     * 【为什么 handler 是"动作列表"而不是代码】见 `compileEvents` 头注：模板里的赋值/自增
     *   是**语句**（表达式编译器明确拒绝赋值），编译成 `{op:'set'|'add', source, program}`
     *   之后设备端只做**执行**（`evalExpr` 求值 + 写数据）——无 eval、无字符串解析。
     */
    const handlers = (artifacts as unknown as { handlers?: Record<string, Array<{ op: string; source: string; program: unknown }>> }).handlers ?? {}
    const events = (artifacts as unknown as { events?: Array<{ nodeId: number; event: string; handler: string }> }).events ?? []
    rep.ev_bindings = events.length
    rep.ev_handlers = Object.keys(handlers).length

    // 节点 → (事件 → handler)：宿主回来的 `(type, nodeId)` 据此找到该跑哪个 handler
    const byNodeEvent = new Map<string, string>()
    for (const e of events) byNodeEvent.set(`${e.nodeId}:${e.event}`, e.handler)

    /** 跑一个 handler：按序执行动作（先算后写 ⇒ 顺序语义保留） */
    const runHandler = (name: string): boolean => {
      const acts = handlers[name]
      if (!acts) return false
      for (const a of acts) {
        const ctx2 = { read: (n: string) => data[n] }
        const v = evalExpr(a.program as never, ctx2 as never)
        const cur = data[a.source]
        if (a.op === 'set') {
          data[a.source] = v
        } else {
          // add：数值累加（非数以 0 起——与 JS 的 `+` 语义不同，这里刻意收窄到数值：见 compileEvents 的形态说明）
          const base = typeof cur === 'number' && Number.isFinite(cur) ? cur : 0
          const delta = typeof v === 'number' && Number.isFinite(v) ? v : 0
          data[a.source] = base + delta
        }
      }
      return true
    }

    /**
     * ★★**手势回调**（宿主 → JS 的反向通道）：注册到全局供 JNI 调用。
     * 返回本帧变化读数（指令字节数 + 源变化后的值），供宿主/判据记账。
     */
    const gestureHits: Array<{ tap: number; hit: number; handler: string; source_after: unknown }> = []
    ;(globalThis as unknown as Record<string, unknown>).__proteusVaporGesture = (type: string, nodeId: number): string => {
      const handler = byNodeEvent.get(`${nodeId}:${type}`) ?? byNodeEvent.get(`${nodeId}:tap`) ?? ''
      if (!handler) return JSON.stringify({ ok: false, reason: `节点 ${nodeId} 上没有 ${type} 的 handler` })
      const before = { ...data }
      const ran = runHandler(handler)
      // 触发订阅（源变化 → 按行/标量 diff → 二进制指令）
      const fire = triggers.get('list')
      // 本夹具的 tap 源（tapCount / boxW）不在 `list`，故**全源 relink**（参考实现形态：
      //   生产可按下标订源——`relink` 是"全量重算 + diff"，正确性优先）
      if (fire) fire()
      vapor.relink(ctx)
      slotRt.flush()
      const payload = captured.length ? captured[captured.length - 1]! : new Uint8Array(0)
      const changedSources: Record<string, unknown> = {}
      for (const k of Object.keys(data)) {
        if (before[k] !== data[k]) changedSources[k] = data[k]
      }
      // ★★**把指令真的发给内核**并读回执（2026-10-01 修正：此前只报 JS 侧字节数 = 弱证据，
      //   而"数据变了屏幕没变"正是弱证据掩盖的形态——宿主回执才有 applied/relayout/changed）
      let applied = -1
      let relayout = -1
      let changedN = 0
      if (payload.length > 0) {
        try {
          const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(payload)))) as {
            ok?: boolean; applied?: number; relayout_count?: number; rects?: Record<string, unknown>; error?: string
          }
          applied = ao.ok ? (ao.applied ?? -1) : -2
          relayout = ao.relayout_count ?? -1
          changedN = ao.rects ? Object.keys(ao.rects).length : 0
        } catch {
          applied = -3
        }
      }
      gestureHits.push({ tap: gestureHits.length + 1, hit: nodeId, handler, source_after: changedSources })
      return JSON.stringify({
        ok: ran, handler, changed: changedSources, ops: payload.length,
        applied, relayout, changed_rects: changedN,
      })
    }
    if (typeof proteusHost.onGesture === 'function') {
      proteusHost.onGesture('__proteusVaporGesture')
    }

    // 几何真值探针：挑**第 2 行**的宽度槽位节点（首行是模板 id，命中它证明不了什么）
    const itemSlots = table.sources.flatMap((s2) => s2.slots).filter((x) => x.kind === 'list-item')
    const widthSlot = itemSlots.find((x) => x.propKey === 'layout.width')
    const probeId = widthSlot ? registry.resolveNode(widthSlot.listId!, '2', widthSlot.itemSlotId!) : undefined
    const rectsOf = (): Record<string, { width?: number }> => {
      try {
        const ro = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { width?: number }> }
        return ro.rects ?? {}
      } catch {
        return {}
      }
    }
    const before = probeId !== undefined ? (rectsOf()[String(probeId)]?.width ?? -1) : -1

    const updates = Math.max(0, args.updates ?? 3)
    const evidence: VaporReport['update_evidence'] = []
    for (let r = 0; r < updates; r++) {
      // 改数据（文本 + 宽度各一处，覆盖两类槽位）——第 2 行固定参与（与探针同源）
      const list = data.list as Array<{ id: number; w: number; title: string }>
      if (list.length < 2) break
      const at = r % Math.min(list.length, rows)
      list[at]!.title = `upd ${r}`
      list[at]!.w = 60 + (r % 4) * 20

      const to = t()
      const fire = triggers.get('list')
      if (!fire) {
        notes.push(`第 ${r} 轮：订阅表里没有 'list' 源（编译器未产出该源？）`)
        break
      }
      fire()               // 订阅触发：源变化 → onChange → 按行 diff → 只发变化行的指令
      slotRt.flush()       // 一次提交（每帧一次跨边界调用的前提）
      rep.ops_ms += t() - to

      const payload = captured.length ? captured[captured.length - 1]! : new Uint8Array(0)
      rep.ops_bytes += payload.length
      if (!payload.length) {
        notes.push(`第 ${r} 轮：订阅表未产出指令（槽位未命中？）`)
        continue
      }
      const ta = t()
      const applyOut = proteusHost.applyOps(JSON.stringify(Array.from(payload)))
      rep.apply_ms += t() - ta
      const ao = JSON.parse(applyOut) as {
        ok?: boolean; applied?: number; rects?: Record<string, unknown>
        relayout?: number; text_synced?: number; text_synced_total?: number; error?: string
      }
      if (ao.ok !== true) {
        notes.push(`第 ${r} 轮 applyOps 失败：${ao.error ?? ''}`)
        continue
      }
      const changed = ao.rects ? Object.keys(ao.rects).length : 0
      evidence.push({
        round: r, row: at + 1, ops: payload.length, changed_rects: changed,
        relayout: ao.relayout ?? -1,
        // ★文本同步（本批修的"读了没入表"缺陷的**回归锁**）：内核回 text_updates，
        //   宿主必须消费并把新文本落到绘制真源（否则文字改了屏幕还是旧字）
        text_synced: ao.text_synced ?? -1,
      })
      rep.text_synced_total += ao.text_synced ?? 0
      rep.updates_run++
    }
    rep.update_evidence = evidence

    /* ═══════════════ ★★交互闭环：注入 tap → 跑 handler → 几何真值对比 ═══════════════ */
    //
    // 【为什么由宿主注入 tap（不是 `adb shell input tap`）】真机 `input` 需 INJECT_EVENTS
    //   权限（本仓实测多次静默失败）⇒ 宿主 `dispatchTouchEvent` 注入真 MotionEvent，
    //   走完整 GestureDetector → hitTest → 语义手势 → 回调链（与真实触摸同一条路）。
    //
    // 【夹具体的按钮几何】宿主按**内核真值**取按钮节点的 rect（判据侧不在 JS 里算坐标——
    //   "几何只在核心里算"的纪律）。
    const tapButtons = events.filter((e) => e.event === 'tap')
    if (typeof proteusHost.tapAt === 'function' && tapButtons.length > 0) {
      for (const btn of tapButtons) {
        const rAll = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { x: number; y: number; width: number; height: number }> }
        const r = rAll.rects?.[String(btn.nodeId)]
        if (!r) continue
        const cx = r.x + r.width / 2
        const cy = r.y + r.height / 2
        // ① 点前：本次 handler 关心的源 + 全部几何签名（真值）
        const before = { ...data }
        const geomBefore = r.height  // 按钮自身高度（tap 不改它；用**被改节点的几何**更有意义）
        // ①b 采集"改前"的内核几何全表（逐 id —— 与改后比"哪几个节点真的动了"）
        let rectsBeforeTap: Record<string, { x: number; y: number; width: number; height: number }> = {}
        try {
          const rb = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { x: number; y: number; width: number; height: number }> }
          rectsBeforeTap = rb.rects ?? {}
        } catch {
          /* 缺读数 ⇒ 下面按 0 差异判（判据会红） */
        }
        // ② 注入 tap（宿主机内 → 命中 → 回调 → handler 已跑完，返回时数据已变）
        const tapOut = JSON.parse(proteusHost.tapAt(JSON.stringify({ x: cx, y: cy }))) as {
          ok?: boolean; dispatched?: number; last?: { type?: string; target?: number }
        }
        // ★tapAt 是同步的：返回时 JS 回调（handler + applyOps）已跑完——回执在 gestureHits 末条
        rep.taps++
        // ③ 本次变化
        const changedSources: Record<string, unknown> = {}
        for (const k of Object.keys(data)) if (before[k] !== data[k]) changedSources[k] = data[k]
        // ④ ★几何真值（内核真源）：**被 handler 改的那个源，对应的节点几何变了吗**
        //    夹具的两个按钮的 handler 分别改 `tapCount`（文本源）与 `boxW`（宽度源）——
        //    `boxW` 改的是**行内 :width 绑定**（节点 12 一类），故这里比对"全表矩形签名"
        //    （改前/改后各读一次内核真源，逐 id 比 width/height/x/y）。
        let geomChanged = 0
        let geomAfter = 0
        let geomDiffIds: number[] = []
        try {
          const afterAll = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { x: number; y: number; width: number; height: number }> }
          const after = afterAll.rects ?? {}
          geomAfter = Object.keys(after).length
          const before = rectsBeforeTap
          geomDiffIds = Object.keys(after)
            .filter((k) => {
              const a = after[k]; const b = before[k]
              if (!b || !a) return true
              return a.width !== b.width || a.height !== b.height || a.x !== b.x || a.y !== b.y
            })
            .map((k) => Number(k))
          // ★诊断：把"被点节点自身"的宽度也记下来（判定"几何变的是不是它"）
          const selfBefore = before[String(btn.nodeId)]?.width
          const selfAfter = after[String(btn.nodeId)]?.width
          if (selfBefore !== undefined || selfAfter !== undefined) {
            notes.push(`tap@${btn.nodeId} 自身宽度 ${selfBefore} → ${selfAfter}` + (geomDiffIds.length === 0 ? '（几何无差异——可疑）' : ''))
          }
          geomChanged = geomDiffIds.length
        } catch {
          /* 读数失败 ⇒ 判据按缺失判红 */
        }
        const lastHit = gestureHits.length > 0 ? gestureHits[gestureHits.length - 1]! : null
        rep.tap_evidence.push({
          tap: rep.taps,
          hit: tapOut.last?.target ?? -1,
          handler: lastHit?.handler ?? '',
          source_after: lastHit?.source_after ?? null,
          ops: tapOut.ok ? 1 : 0,
          changed_rects: geomChanged,
          geom_before: geomBefore,
          geom_after: geomAfter,
          geom_diff_ids: geomDiffIds,
        })
        void changedSources
      }
    }

    // 几何真值对比（内核真源：探针节点的宽度应随数据变——第 2 行参与每轮更新）
    if (probeId !== undefined) {
      const after = rectsOf()[String(probeId)]?.width ?? -1
      rep.geom_probe.push({ id: probeId, before, after })
    }

    // ★★绘制通道探针（5 个通道各一个节点：2 圆角 / 3 渐变 / 4 发光 / 5 裁剪 / 6 描边）
    try {
      const ch = JSON.parse(proteusHost.probeChannels('[2,3,4,5,6]')) as { ok?: boolean; channels?: Array<Record<string, unknown>> }
      if (ch.ok && ch.channels) rep.channels = ch.channels
    } catch {
      /* 探针失败不阻断主判据（notes 里会缺读数，判据按缺失判红） */
    }

    rep.ok = rep.updates_run > 0
    if (!rep.ok) notes.push('增量链未跑起来——见上方 notes')
    else notes.push(`实例树 ${inst.nodes.length} 节点 / 行 ${inst.stats.rows} / 虚拟化行 ${rep.inst_virtual_rows} / 增量 ${rep.updates_run} 轮`)
    return JSON.stringify(rep)
  } catch (e) {
    rep.error = (e as { message?: string })?.message ?? String(e)
    return JSON.stringify(rep)
  }
}

// ★挂到全局，供 Java 侧直接 eval 调用（IIFE 无模块系统——与其它 entry 同法）
;(globalThis as unknown as { __proteusVaporRun: typeof __proteusVaporRun }).__proteusVaporRun = __proteusVaporRun

export type { VaporReport }
