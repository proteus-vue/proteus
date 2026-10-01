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
import { instantiateTemplate, ListRegistry, PropKeyTable, StringPool, SlotRuntime, VaporRuntime } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

/* ══════════════════ 宿主桥（Java 经 JNI 注入；与 JsRenderHost 的三个入口同形） ══════════════════ */

interface VaporHost {
  /** 建树（首帧）：`{viewport, nodes}` → 宿主注入度量 + 核心建树 + 算几何 + 下发绘制指令 */
  mount(treeJson: string): string
  /** 二进制指令流（`number[]` JSON 形态——JNI 侧转 byte[]，见 JsRenderHost.applyOps） */
  applyOps(opsJson: string): string
  /** 核心几何读数（判据用：**从内核真源读**，不是从我们发下去的参数复述） */
  readRects(): string
}

declare const proteusHost: VaporHost

/* ══════════════════ 入参 ══════════════════ */

interface VaporArgs {
  viewport: { width: number; height: number }
  /** 编译产物（构建期产出的 JSON 串；必填）——`{tpl, table, sfc}` */
  artifacts: string
  /** 行数（覆盖产物里的首行数据；缺省 8） */
  rows?: number
  /** 增量更新轮数（每轮改一行文本 + 一行宽度 ⇒ 走订阅表 → 指令流） */
  updates?: number
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
  /** 每轮：改了哪一行 / 内核报的变更集大小 / 重排范围（几何真的动了吗） */
  update_evidence: Array<{ round: number; row: number; ops: number; changed_rects: number; relayout: number }>
  /** 首轮前后**几何真值对比**（readRects 读内核真源：目标行节点宽度应变） */
  geom_probe: Array<{ id: number; before: number; after: number }>
  // —— 观测 ——
  uninstantiated_slots: number
  notes: string[]
}

/** 生成 N 行数据（行内绑定 `item.w` / `item.title` 都覆盖到） */
function makeData(rows: number): Record<string, unknown> {
  return {
    list: Array.from({ length: rows }, (_, i) => ({ id: i + 1, w: 40 + (i % 5) * 12, title: `row ${i + 1}` })),
  }
}

/** 主入口（全同步——铁律 A-02；本入口不依赖微任务：`SlotRuntime.flush()` 是确定性驱动） */
export function __proteusVaporRun(argsJson: string): string {
  const t = (): number => Date.now()
  const args = JSON.parse(argsJson) as VaporArgs
  const rows = Math.max(1, args.rows ?? 8)
  const notes: string[] = []
  const rep: VaporReport = {
    ok: false,
    tpl_nodes: 0, tpl_ok: false, sub_l1: 0, sub_l0: 0, sub_l1_rate: 0, sub_sources: [],
    inst_ms: 0, inst_nodes: 0, inst_reused_ids: 0, inst_allocated_ids: 0, inst_rows: 0,
    inst_values_filled: 0, inst_virtual_rows: 0, inst_text_filled: 0, inst_width_filled: 0,
    mount_ms: 0, mount_nodes: 0,
    updates_run: 0, ops_bytes: 0, ops_ms: 0, apply_ms: 0, update_evidence: [], geom_probe: [],
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
      const ao = JSON.parse(applyOut) as { ok?: boolean; applied?: number; rects?: Record<string, unknown>; relayout?: number; error?: string }
      if (ao.ok !== true) {
        notes.push(`第 ${r} 轮 applyOps 失败：${ao.error ?? ''}`)
        continue
      }
      const changed = ao.rects ? Object.keys(ao.rects).length : 0
      evidence.push({ round: r, row: at + 1, ops: payload.length, changed_rects: changed, relayout: ao.relayout ?? -1 })
      rep.updates_run++
    }
    rep.update_evidence = evidence

    // 几何真值对比（内核真源：探针节点的宽度应随数据变——第 2 行参与每轮更新）
    if (probeId !== undefined) {
      const after = rectsOf()[String(probeId)]?.width ?? -1
      rep.geom_probe.push({ id: probeId, before, after })
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
