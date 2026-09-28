// hosts/ios/bridge/entry-bench.ts
// ★★★**复杂响应式场景 + 逻辑层通信成本随规模的变化**（用户点名：继续测数据响应式复杂案例）
//
// 【为什么要专门测这一组（上一轮数字的局限）】
//   上一轮的读数只有三种简单形态：mount / 列表增删 / 改颜色，且规模 91–217 节点。
//   我在文档里如实标注了边界：「序列化 ≈0ms 是小树结论，大树需重测」。
//   本文件就是补这个边界 —— 而且把「响应式的复杂形态」当成独立变量来测，
//   因为**不同形态的成本结构完全不同**（合并 vs 逐次、细粒度 vs 全量、结构 vs 样式），
//   混在一起测会把最重要的事实平均掉。
//
// 【★★本组用例的设计逻辑（每条都对应一类真实业务形态）】
//   A. 规模扫描（12/50/200/500/1000 项）—— ★边界成本随规模的增长（关键：JSON 序列化曲线）
//   B. 深层嵌套变更（ref 的深响应式，改叶子）—— 细粒度更新：Vue 应只重渲染受影响子树
//   C. computed 链（3 级依赖）—— 依赖传播成本
//   D. 列表重排（keyed diff 最坏情形：reverse）—— diff 复杂度
//   E. 头部插入 / 中部删除 —— 真实列表最常见的两种变更
//   F. 批量合并（一个 tick 内 100 次变更）—— ★Vue 的批处理是否真的合并为 1 次渲染
//   G. 高频连续更新（60 次，模拟逐帧）—— 每次均摊成本
//   H. ★边界编码对比（JSON vs 扁平数值编码）—— 直接支撑「要不要上 JSI/二进制」的决策
//
// 【为什么由宿主逐用例驱动】同上一轮实测结论：JSC 的 `evaluateScript` **不排空微任务**，
//   而 Vue 的更新调度正是微任务 ⇒ 用例之间必须返回主线程（否则响应式永不落地）。
import { h, ref, computed, nextTick, reactive } from '@vue/runtime-core'
import { createAppRenderer } from '@proteus-vue/renderer-app'
import { createSelfDrawAdapter } from '@proteus-vue/renderer-app/adapters/selfdraw'
// ★被测应用工厂 + V0 探针的三种用法：与**桌面自检**共用同一份实现
//   （见 bench-app.ts 顶部说明；桌面自检 tests/v0-probe-mechanism.test.ts）
import { makeApp, VP } from './bench-app'
import type { BenchApp } from './bench-app'

/* ────────────────────────── 宿主桥（与自绘场景同形，复用同一 Swift 宿主） ────────────────────────── */

interface SelfDrawNative {
  mount(treeJson: string): string
  update(treeJson: string): string
  updatePatches(patchesJson: string): string
  snapshot(name: string): string
  report(json: string): void
  done(summaryJson: string): void
}
declare const proteusSelfDraw: SelfDrawNative
/** 快照名（宿主按模式注入，便于区分场景产物） */
const BN = { snapshot: 'bench-final' }

// ★VP 定义在 bench-app.ts（与 V0 探针/应用工厂同处，桌面自检也用它）
// ★构建标识：每次构建写入，用于**确凿判定**设备上跑的是哪份代码
//   （踩坑：靠文件 mtime 判断"报告是否刷新"不可靠——新建目标文件的时间恒为"现在"；
//    且我看不出设备实际执行的是旧 bundle，白跑一轮。有了这个字段就能一眼判定。）
const BUILD_ID = '49c925d2-100302'
const now = (): number => Date.now()
/** 宽松解析（宿主返回可能是字符串或已是对象） */
const safeParseAny = (s: any): any => {
  if (s && typeof s === 'object') return s
  try { return JSON.parse(String(s)) } catch { return undefined }
}

/* ────────────────────────── 用例结果 ────────────────────────── */

interface CaseResult {
  case: string
  note: string
  items: number
  nodes: number
  /** Vue 自身：响应式变更 → 重渲染 → diff/patch → nodeOps */
  vue_ms: number
  /** 适配器：渲染树 → 引擎就绪请求（拍平 + 数值折叠） */
  to_request_ms: number
  /** ★边界成本：请求 → JSON 字符串（跨 JSC↔原生） */
  serialize_ms: number
  /** 宿主侧：文本度量 + Rust 布局 + 建 CALayer 树 */
  host_ms: number
  total_ms: number
  /** 本次操作触发的 nodeOps 次数（patch 工作量的直接读数） */
  patch_count: number
  /** 请求体积（字节）—— 边界成本的自变量 */
  request_bytes: number
  /** 用例自带的额外读数（如「合并了几次渲染」「重排了多少项」） */
  extra?: Record<string, unknown>
}

const results: CaseResult[] = []

/* ────────────────────────── 测量（统一的四段分解） ────────────────────────── */

interface BenchCtx {
  app: BenchApp
  hostKind: 'mount' | 'update'
  /** 记录「变更前后 render 次数」以观测 Vue 的合并行为 */
  label: string
}

async function measure(
  name: string,
  ctx: BenchCtx,
  mutate: () => void,
  note: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const { app } = ctx
  app.adapter.resetStats()
  const r0 = app.renderCount()

  const t0 = now()
  mutate()
  await nextTick()                     // ★等 Vue 的重渲染落地（微任务）
  const tVue = now()

  const req = app.adapter.toRequest(VP)
  const tReq = now()
  const treeJson = JSON.stringify(req)
  const tSer = now()
  const bytes = treeJson.length
  if (ctx.hostKind === 'mount') proteusSelfDraw.mount(treeJson)
  else proteusSelfDraw.update(treeJson)
  const tHost = now()

  results.push({
    case: name,
    note,
    items: req.nodes.length,
    nodes: req.nodes.length,
    vue_ms: tVue - t0,
    to_request_ms: tReq - tVue,
    serialize_ms: tSer - tReq,
    host_ms: tHost - tSer,
    total_ms: tHost - t0,
    patch_count: app.adapter.patchCount(),
    request_bytes: bytes,
    extra: { ...(extra ?? {}), renders: app.renderCount() - r0 },
  })
}

/* ────────────────────────── ★用例集 ────────────────────────── */

type CaseFn = () => Promise<void>
/** ★初始化诊断（顶层的任何异常都会被记录，不再静默吞掉整个用例组） */
const INIT_DIAG: { errors: string[]; stages: string[] } = { errors: [], stages: [] }

const CASES: Array<{ name: string; note: string; fn: CaseFn }> = []

/* A. 规模扫描 —— 边界成本随规模的增长曲线 */
for (const n of [12, 50, 200, 500, 1000]) {
  CASES.push({
    name: `A_scale_mount_${n}`,
    note: `规模扫描：挂载 ${n} 项（${n * 4 + 3} 节点量级）`,
    fn: async () => {
      const app = makeApp(n)
      // 新建的 app 用 mount 语义；四段照旧
      const t0 = now()
      const req = app.adapter.toRequest(VP)
      const tReq = now()
      const treeJson = JSON.stringify(req)
      const tSer = now()
      proteusSelfDraw.mount(treeJson)
      const tHost = now()
      results.push({
        case: `A_scale_mount_${n}`,
        note: `规模扫描：挂载 ${n} 项`,
        items: n, nodes: req.nodes.length,
        vue_ms: 0,                        // 建 app 的时间已含在上一步（下一条 update 用例补测 Vue 侧）
        to_request_ms: tReq - t0,
        serialize_ms: tSer - tReq,
        host_ms: tHost - tSer,
        total_ms: tHost - t0,
        patch_count: app.adapter.patchCount(),
        request_bytes: treeJson.length,
        extra: { phase: 'mount' },
      })
      // 一次**真实变更**（测该规模下的增量成本）
      //
      // ★本仓实测踩到：初版写 `setCount(n)`（与挂载同值）→ 无变化 → `patch=0`、
      //   请求字节与 mount 完全相同 ⇒ **测的不是「更新的成本」，而是「无变更时的成本」**。
      //   一个「什么都没发生」的用例会得出「更新几乎不花时间」的错误结论。
      //   ⇒ 改为真实增删：n → n+10（列表多 10 项）。
      await measure(`A_scale_update_${n}`, { app, hostKind: 'update', label: 'scale' },
        () => { app.setCount(n + 10) }, `规模 ${n} → ${n + 10}：单次响应式更新（真实增删）`)
    },
  })
}

/* B. 深层嵌套变更（细粒度） */
CASES.push({
  name: 'B_deep_nested',
  note: '深层嵌套：改 ref 内 3 层对象的叶子（观测 Vue 是否只重渲染受影响部分）',
  fn: async () => {
    const app = makeApp(20)
    await measure('B_deep_nested', { app, hostKind: 'update', label: 'deep' },
      () => { app.mutateDeep() }, '改 deep.a.b.c.v（深层 reactive 叶子）')
  },
})

/* C. computed 链（3 级依赖传播） */
CASES.push({
  name: 'C_computed_chain',
  note: 'computed 链：base → mid → top（3 级），改 base',
  fn: async () => {
    const app = makeApp(20)
    await measure('C_computed_chain', { app, hostKind: 'update', label: 'computed' },
      () => { app.setScaleBase(7) }, '改 computed 链根节点（3 级传播）')
  },
})

/* D. 列表重排（keyed diff 最坏情形） */
CASES.push({
  name: 'D_list_reverse_200',
  note: 'keyed diff 最坏情形：200 项整体 reverse',
  fn: async () => {
    const app = makeApp(200)
    await measure('D_list_reverse_200', { app, hostKind: 'update', label: 'reverse' },
      () => { app.reverse() }, '200 项 reverse（keyed diff 最坏情形）')
  },
})

/* E. 头部插入 / 中部删除（真实列表最常见的两种变更） */
CASES.push({
  name: 'E_insert_head_50',
  note: '头部插入 50 项（触发大量节点移位）',
  fn: async () => {
    const app = makeApp(200)
    await measure('E_insert_head_50', { app, hostKind: 'update', label: 'insert' },
      () => {
        const cur = app.items()
        const head = Array.from({ length: 50 }, (_, i) => ({ id: 10000 + i, title: `新 ${i + 1}`, sub: '插入' }))
        app.setItems([...head, ...cur])
      }, '头部插入 50 项到 200 项列表')
  },
})
CASES.push({
  name: 'E_remove_middle_50',
  note: '中部删除 50 项',
  fn: async () => {
    const app = makeApp(200)
    await measure('E_remove_middle_50', { app, hostKind: 'update', label: 'remove' },
      () => {
        const cur = app.items()
        app.setItems([...cur.slice(0, 75), ...cur.slice(125)])
      }, '从中部删除 50 项（200 → 150）')
  },
})

/* F. ★批量合并：一个 tick 内 100 次变更 → Vue 应合并为 1 次渲染 */
CASES.push({
  name: 'F_batch_100_mutations',
  note: '★批量合并：同一 tick 内 100 次变更（Vue 的批处理是否真合并为 1 次渲染）',
  fn: async () => {
    const app = makeApp(200)
    await measure('F_batch_100_mutations', { app, hostKind: 'update', label: 'batch' },
      () => {
        // 100 次同步变更：Vue 应在微任务里合并成**一次**渲染
        for (let i = 0; i < 100; i++) app.setCount(200 + (i % 5))
      }, '同一 tick 内 100 次变更（期望 renders=1）',
      { expect_renders: 1 })
  },
})

/* G. 高频连续更新（60 次，模拟逐帧） */
CASES.push({
  name: 'G_high_freq_60',
  note: '高频连续：60 次逐次更新（每次 await nextTick）——逐帧场景的均摊成本',
  fn: async () => {
    const app = makeApp(200)
    const per: number[] = []
    for (let i = 0; i < 60; i++) {
      const a = now()
      app.setCount(200 + (i % 10))
      await nextTick()
      app.adapter.toRequest(VP)          // 含拍平 + 折叠（不含宿主调用）
      per.push(now() - a)
    }
    const avg = per.reduce((x, y) => x + y, 0) / per.length
    results.push({
      case: 'G_high_freq_60',
      note: '60 次连续更新（每次变更→重渲染→建请求，不含宿主）',
      items: 200, nodes: app.adapter.toRequest(VP).nodes.length,
      vue_ms: Math.round(avg * 1000) / 1000, to_request_ms: 0, serialize_ms: 0, host_ms: 0,
      total_ms: Math.round(per.reduce((x, y) => x + y, 0) * 100) / 100,
      patch_count: app.adapter.patchCount(), request_bytes: 0,
      extra: { iterations: per.length, avg_ms: Math.round(avg * 1000) / 1000, max_ms: Math.max(...per) },
    })
  },
})

/* H. ★边界编码对比：JSON vs 扁平数值编码（支撑「要不要 JSI/二进制」的决策） */
CASES.push({
  name: 'H_boundary_encoding',
  note: '★边界成本对比：JSON.stringify vs 扁平数值编码（同一棵树）',
  fn: async () => {
    const app = makeApp(500)
    const req = app.adapter.toRequest(VP)

    const t0 = now()
    const json = JSON.stringify(req)
    const jsonMs = now() - t0

    // 扁平数值编码：节点规格定长字段 → Float64Array；文本单独一张表
    // （这是「二进制 blaster」在 JS 侧的可测近似：不做对象遍历、只写数值）
    const t1 = now()
    const N = req.nodes.length
    const FIELDS = 12
    const buf = new Float64Array(N * FIELDS)
    const texts: string[] = []
    for (let i = 0; i < N; i++) {
      const nd = req.nodes[i]
      const o = i * FIELDS
      buf[o] = nd.id
      buf[o + 1] = nd.parentId ?? -1
      buf[o + 2] = nd.width ?? -1
      buf[o + 3] = nd.height ?? -1
      buf[o + 4] = nd.margin?.top ?? 0
      buf[o + 5] = nd.margin?.bottom ?? 0
      buf[o + 6] = nd.padding?.left ?? 0
      buf[o + 7] = nd.padding?.right ?? 0
      buf[o + 8] = nd.flexGrow ?? 0
      buf[o + 9] = nd.flexShrink ?? 1
      buf[o + 10] = nd.borderRadius ?? 0
      buf[o + 11] = nd.fontSize ?? 0
      if (nd.text) texts.push(`${nd.id}\u0001${nd.text}`)
    }
    const flatMs = now() - t1
    const flatBytes = buf.byteLength + texts.join('\u0001').length
    // 反序列化对照（真实场景要解回结构）
    const t2 = now()
    const back = JSON.parse(json)
    const jsonParseMs = now() - t2

    results.push({
      case: 'H_boundary_encoding',
      note: '边界编码对比（500 项 / 2003 节点）：JSON vs 扁平数值',
      items: 500, nodes: N,
      vue_ms: 0, to_request_ms: 0,
      serialize_ms: jsonMs, host_ms: 0,
      total_ms: jsonMs + flatMs,
      patch_count: 0,
      request_bytes: json.length,
      extra: {
        json_stringify_ms: jsonMs,
        json_parse_ms: jsonParseMs,
        json_bytes: json.length,
        flat_encode_ms: flatMs,
        flat_bytes: flatBytes,
        bytes_ratio: Math.round((json.length / flatBytes) * 100) / 100,
        speed_ratio: flatMs > 0 ? Math.round((jsonMs / flatMs) * 100) / 100 : -1,
        _back: back ? 'parsed-ok' : 'parse-fail',
      },
    })
  },
})

/* I. ★静态样式提升 A/B —— 量化「编译器 static hoisting」在 App 端的价值 */
CASES.push({
  name: 'I_style_hoist_ab',
  note: '★A/B：每次 render 新建 style 对象 vs 提升为模块级常量（编译器 static hoisting 的效果）',
  fn: async () => {
    // A：朴素写法——每次 render 都新建 style 对象字面量（**手写 render 函数的常见形态**）
    const mkNaive = (n: number) => {
      const cnt = ref(n)
      const adapter = createSelfDrawAdapter()
      const renderer = createAppRenderer(adapter)
      const container = adapter.createElement('p-view')
      adapter.root.children.push(container)
      container.parent = adapter.root
      const items = Array.from({ length: n }, (_, i) => ({ id: i, title: `项 ${i}`, sub: 'sub' }))
      let renders = 0
      renderer.createApp({
        render() {
          renders++
          // ★必须**读** cnt 才建立依赖 —— 初版漏了这一步，导致「改 cnt 不触发重渲染」，
          //   于是 patch=0 被误读成「无 patch 流量」（实际是**根本什么都没发生**）。
          void cnt.value
          return h('p-view', { style: { flexDirection: 'column', width: VP.width } },
            items.map((it) => h('p-view', {
              key: it.id,
              // ★每次调用都产生**新对象** —— 引用不同 ⇒ Vue 认为 prop 变了 ⇒ 触发 patchProp
              style: { height: 56, margin: { bottom: 8 }, backgroundColor: '#1b1b21' },
            }, [h('p-text', { style: { fontSize: 16, color: '#fff' } }, it.title)])))
        },
      }).mount(container)
      return { adapter, setN: (v: number) => { cnt.value = v }, renders: () => renders }
    }

    // B：提升写法——样式对象提到**渲染函数之外**（这正是 SFC 编译器 `_hoisted_*` 做的事）
    const mkHoisted = (n: number) => {
      const cnt = ref(n)
      const H_ROW = { height: 56, margin: { bottom: 8 }, backgroundColor: '#1b1b21' }   // ★hoisted
      const H_TEXT = { fontSize: 16, color: '#fff' }                                    // ★hoisted
      const H_COL = { flexDirection: 'column', width: VP.width }                        // ★hoisted
      const adapter = createSelfDrawAdapter()
      const renderer = createAppRenderer(adapter)
      const container = adapter.createElement('p-view')
      adapter.root.children.push(container)
      container.parent = adapter.root
      const items = Array.from({ length: n }, (_, i) => ({ id: i, title: `项 ${i}`, sub: 'sub' }))
      let renders = 0
      renderer.createApp({
        render() {
          renders++
          // cnt 仅用于触发重渲染（内容不变，只测 patch 流量差异）
          void cnt.value
          return h('p-view', { style: H_COL },
            items.map((it) => h('p-view', { key: it.id, style: H_ROW },
              [h('p-text', { style: H_TEXT }, it.title)])))
        },
      }).mount(container)
      return { adapter, setN: (v: number) => { cnt.value = v }, renders: () => renders }
    }

    const N = 100
    const runOne = async (label: string, mk: (n: number) => { adapter: ReturnType<typeof createSelfDrawAdapter>; setN: (v: number) => void; renders: () => number }) => {
      const { adapter, setN, renders } = mk(N)
      // 首次挂载的 patch 流量
      const mountPatches = adapter.patchCount()
      adapter.resetStats()
      const t0 = now()
      setN(N + 1)               // 触发一次重渲染
      await nextTick()
      const vueMs = now() - t0
      const req = adapter.toRequest(VP)
      const t1 = now()
      const json = JSON.stringify(req)
      const serMs = now() - t1
      proteusSelfDraw.update(json)
      const t2 = now()
      results.push({
        case: `I_style_hoist_${label}`,
        note: `${label}：100 项，一次重渲染的 patch 流量`,
        items: N, nodes: req.nodes.length,
        vue_ms: vueMs, to_request_ms: 0, serialize_ms: serMs, host_ms: t2 - t1,
        total_ms: t2 - t0, patch_count: adapter.patchCount(), request_bytes: json.length,
        extra: { mount_patches: mountPatches, variant: label, renders: renders() - 1 },  // -1 = 扣掉首次挂载
      })
    }
    await runOne('naive', mkNaive)      // 每次新建 style
    await runOne('hoisted', mkHoisted)  // 样式提升（编译器做法）
  },
})

/* J. ★★增量路径端到端：改**样式**（不改结构）→ 宿主应走增量而非重建 */
CASES.push({
  name: 'J_incremental_e2e',
  note: '★增量路径端到端：改 n 项中若干项的**样式**（不改结构/文本）→ 观测宿主 incremental / relayout_count',
  fn: async () => {
    for (const n of [50, 200, 500]) {
      const app = makeApp(n)
      // 首帧：全量（create）
      app.adapter.resetStats()
      const req0 = app.adapter.toRequest(VP)
      proteusSelfDraw.mount(JSON.stringify(req0))
      // ★全量已发出 ⇒ 声明"已同步"（否则挂载产生的结构变化会污染下一次 takePatches）
      app.adapter.markFullSync()

      // ★改「样式」——只动 margin（布局字段）但**不增删节点、不改文本**
      //   ⇒ 宿主 diffPatches 应产出非空补丁 → 走 proteus_layout_update（增量）
      app.adapter.resetStats()
      const t0 = now()
      app.setRowMargin(Math.floor(n / 2), 20)    // ★只改**中间一行**（真正的局部变更）
      await nextTick()
      const tVue = now()
      // ★★补丁路径：只发**改动过的节点**的样式（不再遍历整树、不再序列化整树）
      const patches = app.adapter.takePatches()
      const patchesDiag = patches === null ? 'NULL(结构变化)' : `len=${patches.length}`
      const tReq = now()
      let hostOut: string
      let sentBytes: number
      let nodeCount: number
      if (patches === null) {
        const req = app.adapter.toRequest(VP)
        nodeCount = req.nodes.length
        const treeJson = JSON.stringify(req)
        sentBytes = treeJson.length
        hostOut = proteusSelfDraw.update(treeJson)
      } else {
        const pj = JSON.stringify(patches)
        sentBytes = pj.length
        hostOut = proteusSelfDraw.updatePatches(pj)
        nodeCount = n
      }
      const tSer = now()
      const tHost = now()
      const h = safeParseAny(hostOut)
      results.push({
        case: `J_incremental_${n}`,
        note: `规模 ${n}：改 1 行样式（margin）→ 走**补丁**路径`,
        items: n, nodes: nodeCount,
        vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tSer - tReq,
        host_ms: tHost - tSer, total_ms: tHost - t0,
        patch_count: app.adapter.patchCount(), request_bytes: sentBytes,
        extra: {
          host_incremental: h?.["incremental"],
          host_patches: h?.["patch_count"],
          host_relayout: h?.["relayout_count"],
          host_layout_ms: h?.["layout_ms"],
          host_build_layers_ms: h?.["build_layers_ms"],
          // ★宿主侧分段（定位剩余耗时的唯一依据）
          host_timing: h?.["_host_timing"],
          host_changed_rects: h?.["changed_rects"],
          host_updated_layers: h?.["updated_layers"],
          patches_diag: patchesDiag,
          host_parse_ms: h?.["parse_ms"],
          host_in_bytes: h?.["in_bytes"],
          host_total_ms: h?.["host_total_ms"],
          host_measure_hits: h?.["measure_cache_hits"],
          host_measure_misses: h?.["measure_cache_misses"],
        },
      })
    }
  },
})

/* ────────────────────────── ★★★S 组：加压测试（逼出性能天花板）────────────────────────── */

/**
 * S 组的设计原则（与 A–J 组不同的地方）
 *
 * A–J 组是「**验证**」（在已知可行的规模上确认机制正确）；S 组是「**加压**」——
 * 目标是**逐档加到越线**，并给出越线的那一档与当时的构成，而不是"跑通了"。
 *
 * 三个必须区分的变量（本仓在 J 组踩过：把「平级变更」当成「局部变更」测）：
 *   · 变更**位置**：边界内（类A 局部） vs 改自身盒属性（类B 平级，兄弟全动）
 *   · 变更**内容**：样式 vs 文本（文本会**击穿内容寻址的度量缓存**）
 *   · 变更**结构**：只改值 vs 增删节点（后者目前必然全量重建）
 *
 * 帧预算基准：**16.7ms**（60FPS）。越过即记为「越线」。
 */
const FRAME_BUDGET_MS = 16.7

/**
 * ★★挂载一个应用（加压用例的**前置条件**）
 *
 * 【为什么必须显式做（本仓实测踩到的测量缺陷，第四次同类）】
 *   S 组初版每个用例都 `makeApp(n)` 建了新应用，**但没 mount**，
 *   直接 `updatePatches()` —— 而 `updatePatches` 打的是**宿主上仍持有的上一棵树**的句柄。
 *   后果：1000 项 JS 树算出的补丁打到了 **28007 节点的宿主树**上，
 *   读数变成 `relayout=28005`、`changed_rects=28005`，而用例名却写着"改第 500 行圆点"。
 *   ⇒ 数字完全失真，且**看起来像是"增量失效"**。
 *
 * ★纪律（第 N 次验证）：**加压用例必须先把自己那棵树挂上去**，
 *   并断言「本次操作触及的节点数与自己那棵树同量级」——否则读数无意义。
 */
function mountApp(app: BenchApp, n: number): void {
  const req = app.adapter.toRequest(VP)
  proteusSelfDraw.mount(JSON.stringify(req))
  app.adapter.markFullSync()      // 全量已发出 ⇒ 声明同步（否则结构标志污染后续 takePatches）
  void n
}

/** ★每个用例的**自身耗时**（由用例内部打点，不依赖宿主的泵节奏） */
const caseTimings: Record<string, number> = {}

/**
 * ★★**已执行的用例数**（与「结果条数」严格区分）
 *
 * 【为什么必须分开（本仓实测踩到，且被误导了好几轮）】初版用 `results.length` 当"已完成用例数"，
 *   但**一个用例可以产出多条结果**（`I_style_hoist_ab` 2 条、`J_incremental_e2e` 3 条）
 *   ⇒ A–J 的 15 个注册用例产出 **23 条结果**，而 `CASES.length` 恰好也是 **23**（15 + 8 个 S 组）
 *   ⇒ 驱动看到 `completed(23) == total_cases(23)` 就**判定全部完成并退出**
 *   ⇒ **S 组 8 个用例从未执行**。
 * ★两个 23 撞车让现象看起来像"S 组注册失败"，我因此查了 bundle / cases() / BUILD_ID 好几轮——
 *   全都是对的。**计数器语义错位比代码错误更难查**：它不报错，只是提前收工。
 * ⇒ 纪律：**进度计数器必须与它计的对象同粒度**（用例数 ≠ 结果条数）。
 */
let executedCases = 0

/** 记录「越线」的档位（加压测试的产出） */
const ceiling: Array<{ dim: string; level: string; ms: number; note: string }> = []

function markCeiling(dim: string, level: string, ms: number, note: string): void {
  if (ms > FRAME_BUDGET_MS) ceiling.push({ dim, level, ms: Math.round(ms * 100) / 100, note })
}

INIT_DIAG.stages.push('before-S2:' + CASES.length)
try {
/* S2 · ★★变更位置：类A（边界内）vs 类B（平级）—— 这是增量的真实分界线 */
CASES.push({
  name: 'S2_change_locality',
  note: '★★变更位置对照：类A 改行内子节点尺寸（应止于该行） vs 类B 改行 margin（兄弟全动 ⇒ 父级）',
  fn: async () => {
    const N = 1000
    const app = makeApp(N)
    mountApp(app, N)                    // ★必须：否则补丁会打到上一棵树上（见 mountApp 注释）
    const mid = Math.floor(N / 2)

    const runOne = async (label: string, mutate: () => void, note: string) => {
      app.adapter.resetStats()
      const t0 = now()
      mutate()
      await nextTick()
      const tVue = now()
      const patches = app.adapter.takePatches()
      const tReq = now()
      let hostOut: string
      let bytes = 0
      if (patches === null) {
        const r = app.adapter.toRequest(VP)
        const tj = JSON.stringify(r)
        bytes = tj.length
        hostOut = proteusSelfDraw.update(tj)
      } else {
        bytes = JSON.stringify(patches).length
        hostOut = proteusSelfDraw.updatePatches(JSON.stringify(patches))
      }
      const tHost = now()
      const h = safeParseAny(hostOut)
      results.push({
        case: `S2_${label}`,
        note,
        items: N, nodes: h?.["node_count"] ?? 0,
        vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tHost - tReq,
        host_ms: tHost - tReq, total_ms: tHost - t0,
        patch_count: app.adapter.patchCount(), request_bytes: bytes,
        extra: { relayout: h?.["relayout_count"], changed_rects: h?.["changed_rects"],
                 updated_layers: h?.["updated_layers"], mem_mb: h?.["mem_mb"],
                 patches_sent: patches === null ? 'FULL' : patches.length },
      })
      // ★自检（防"打错树"再次静默发生）：relayout 不得超过本用例自己的树规模
      const rl = (h?.["relayout_count"] as number) ?? 0
      const ownTreeNodes = 0   // 见 runOne 内部计数
      void ownTreeNodes
      if (rl > 0x4000) results.push({
        case: 'S2_SELFCHECK_FAIL', note: `relayout=${rl} 超出自有树规模 ⇒ 疑似打到了上一棵树`,
        items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
        total_ms: -1, patch_count: -1, request_bytes: -1,
      })
      markCeiling('locality', label, tHost - t0, note)
    }

    // 类A：改行内子节点（圆点）尺寸 —— 行高显式 ⇒ 行尺寸不变 ⇒ 兄弟不动
    await runOne('A_local_dot', () => app.setDotSize(mid, 20), `类A 局部：改第 ${mid} 行内圆点尺寸`)
    // 类B：改同一行的 margin —— 改变主轴占用 ⇒ 后续兄弟全部移位
    await runOne('B_sibling_margin', () => app.setRowMargin(mid, 20), `类B 平级：改第 ${mid} 行 margin`)
    app.dispose()
  },
})

/* ────────────── V0 探针：Vue 原生手段能否抹平「组件级重渲染」的代价 ────────────── */

/**
 * ★★V0 探针（依据《Vapor for Proteus IR 设计方案》§9 —— 方案自定「**必须先做**」）
 *
 * 【要回答的问题】单节点更新的 79ms 里，有多少是「Vue 为**找出**那一个变化而付出的代价」？
 *   方案 §0.4 的归因是「VNode 创建仍为 O(子树规模)」。本探针用 **Vue 原生手段**测理论上限：
 *   · 若 v-memo 等价物也拉不到 10ms 量级 ⇒ **归因错误，方案须暂停**（方案自己的判读表）
 *   · 若能 ⇒ 编译器方向成立，且「目标线」由实测确定
 *
 * 【为什么用 `withMemo` 而不是 `v-memo` 指令】本基准是**无编译器的手写 render 树**
 *   （这正是问题本身：`entry-bench.ts` 不走 SFC 编译器）。`v-memo` 在编译期展开成的
 *   就是 `withMemo(memo, render, _cache, index)`——**同一实现**，无需为探针引入编译器。
 *
 * 【三种用法（同一棵树、同一操作，只换 Vue 用法）】
 *   · plain 每次整树重建（现状，= S2_A 基线）
 *   · memo  逐行 `withMemo`（依赖数组 = 该行渲染用到的一切）
 *   · comp  逐行独立子组件（组件边界 = props 浅比较构成的更新屏障）
 *
 * 【两个操作场景（分离"补丁"与"遍历"两种成本）】
 *   · dot    改第 500 行圆点 = **单节点更新**（方案 §0.4 的场景）
 *   · header 改标题 margin = **零行变更**（归因"整树重建 + 遍历"本身的固定成本）
 *
 * 【★等价性自检（测量装置必须先被验证）】三种用法必须给出**相同的宿主读数**
 *   （`relayout_count` / `updated_layers`）——否则数字差异可能只来自"树不一样"，
 *   探针结论作废（与 S2_SELFCHECK_FAIL 同款纪律）。
 */
CASES.push({
  name: 'V0_native_ceiling',
  note: '★★V0 探针：1000 项 · 单节点更新 vs 零行变更 —— plain / v-memo等价 / 子组件 三用法对照（决定编译器方案是否成立）',
  fn: async () => {
    const N = 1000
    const mid = Math.floor(N / 2)
    const seen: Record<string, { relayout?: unknown; layers?: unknown }> = {}

    const runOne = async (strat: 'plain' | 'memo' | 'comp', op: 'dot' | 'header') => {
      const app = makeApp(N, strat)
      mountApp(app, N)
      app.adapter.resetStats()
      const rBefore = app.renderCount()
      const rowBefore = app.rowRenderCount()
      const t0 = now()
      if (op === 'dot') app.setDotSize(mid, 20)
      else app.setHeaderMargin(20)
      await nextTick()
      const tVue = now()
      const patches = app.adapter.takePatches()
      const tReq = now()
      let bytes = 0
      let hostOut: string
      if (patches === null) {
        const tj = JSON.stringify(app.adapter.toRequest(VP))
        bytes = tj.length
        hostOut = proteusSelfDraw.update(tj)
      } else {
        bytes = JSON.stringify(patches).length
        hostOut = proteusSelfDraw.updatePatches(JSON.stringify(patches))
      }
      const tHost = now()
      const hr = safeParseAny(hostOut)
      results.push({
        case: `V0_${strat}_${op}`,
        note: op === 'dot'
          ? `V0/${strat}：改第 ${mid} 行圆点（单节点更新）`
          : `V0/${strat}：改标题 margin（零行变更）`,
        items: N, nodes: hr?.["node_count"] ?? 0,
        vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tHost - tReq,
        host_ms: tHost - tReq, total_ms: tHost - t0,
        patch_count: app.adapter.patchCount(), request_bytes: bytes,
        extra: {
          strategy: strat,
          renders: app.renderCount() - rBefore,          // 父组件 render 次数
          row_renders: app.rowRenderCount() - rowBefore, // 行子组件 render 次数（comp 专用；其余恒 0）
          patches_sent: patches === null ? 'FULL' : patches.length,
          relayout: hr?.["relayout_count"], updated_layers: hr?.["updated_layers"],
        },
      })
      seen[`${strat}_${op}`] = { relayout: hr?.["relayout_count"], layers: hr?.["updated_layers"] }
      app.dispose()
    }

    for (const op of ['dot', 'header'] as const) {
      for (const strat of ['plain', 'memo', 'comp'] as const) await runOne(strat, op)
      const ks = (['plain', 'memo', 'comp'] as const).map((s) => seen[`${s}_${op}`])
      const same = ks.every((k) => !!k && k.relayout === ks[0].relayout && k.layers === ks[0].layers)
      if (!same) results.push({
        case: 'V0_SELFCHECK_FAIL',
        note: `V0 等价性自检失败（${op}）：三种用法的宿主读数不一致 ⇒ 数字不可比，探针结论作废`,
        items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
        total_ms: -1, patch_count: -1, request_bytes: -1,
        extra: { seen },
      })
    }
  },
})

/* S3 · 持续更新压力：连续 N 次局部更新，看帧时间分布 */
CASES.push({
  name: 'S3_sustained_burst',
  note: '★持续压力：连续 300 次局部更新（每次 await nextTick）——看 p50/p95/p99 是否越过 16.7ms',
  fn: async () => {
    const N = 500
    const app = makeApp(N)
    mountApp(app, N)                    // ★必须：见 mountApp 注释
    const ITERS = 300
    const samples: number[] = []
    for (let i = 0; i < ITERS; i++) {
      const t0 = now()
      app.setDotSize(i % N, 20 + (i % 8))                  // 局部变更
      await nextTick()
      const patches = app.adapter.takePatches()
      if (patches !== null) proteusSelfDraw.updatePatches(JSON.stringify(patches))
      samples.push(now() - t0)
    }
    samples.sort((a, b) => a - b)
    const pick = (p: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]
    results.push({
      case: 'S3_sustained_burst',
      note: `连续 ${ITERS} 次局部更新（${N} 项页面）`,
      items: N, nodes: 0,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0,
      total_ms: samples.reduce((a, b) => a + b, 0),
      patch_count: 0, request_bytes: 0,
      extra: { iters: ITERS, p50_ms: pick(0.5), p95_ms: pick(0.95), p99_ms: pick(0.99),
               max_ms: samples[samples.length - 1], min_ms: samples[0],
               over_budget: samples.filter((v) => v > FRAME_BUDGET_MS).length },
    })
    markCeiling('frequency', `连续 ${ITERS} 次`, pick(0.95), 'p95 单次更新耗时')
    app.dispose()
  },
})

/* S4 · 文本击穿：改大量文案（内容寻址缓存必然未命中） */
CASES.push({
  name: 'S4_text_churn',
  note: '★文本击穿：改 300 行文案（**击穿内容寻址度量缓存**）——文本度量是平台最贵的一步',
  fn: async () => {
    const N = 500
    const app = makeApp(N)
    mountApp(app, N)                    // ★必须：见 mountApp 注释
    app.adapter.resetStats()
    const t0 = now()
    app.churnText(300, 'R1')                 // 300 行文案变化
    await nextTick()
    const tVue = now()
    const patches = app.adapter.takePatches()
    const tReq = now()
    let hostOut: string
    let bytes = 0
    if (patches === null) {
      const r = app.adapter.toRequest(VP)
      const tj = JSON.stringify(r)
      bytes = tj.length
      hostOut = proteusSelfDraw.update(tj)
    } else {
      bytes = JSON.stringify(patches).length
      hostOut = proteusSelfDraw.updatePatches(JSON.stringify(patches))
    }
    const tHost = now()
    const h = safeParseAny(hostOut)
    results.push({
      case: 'S4_text_churn',
      note: `改 300 行文案（${N} 项页面）`,
      items: N, nodes: 0,
      vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tHost - tReq,
      host_ms: tHost - tReq, total_ms: tHost - t0,
      patch_count: app.adapter.patchCount(), request_bytes: bytes,
      extra: { relayout: h?.["relayout_count"], patches_sent: patches === null ? 'FULL' : patches.length,
               measure_hits: h?.["measure_cache_hits"], measure_misses: h?.["measure_cache_misses"] },
    })
    markCeiling('text_churn', '改 300 行文案', tHost - t0, '文本变更（缓存未命中）')
    app.dispose()
  },
})

/* S5 · 结构变更：增删节点（当前必然全量重建 —— 已知天花板） */
CASES.push({
  name: 'S5_structure_change',
  note: '★结构变更：500→600 / 600→400 项（增删节点）——当前 update 入口只收样式补丁 ⇒ 必然全量',
  fn: async () => {
    const N = 500
    const app = makeApp(N)
    mountApp(app, N)                    // ★必须：见 mountApp 注释
    const runOne = async (label: string, newN: number) => {
      app.adapter.resetStats()
      const t0 = now()
      app.setCount(newN)
      await nextTick()
      const tVue = now()
      const patches = app.adapter.takePatches()
      const tReq = now()
      let hostOut: string
      let bytes = 0
      let mode = 'patch'
      if (patches === null) {
        mode = 'FULL'
        const r = app.adapter.toRequest(VP)
        const tj = JSON.stringify(r)
        bytes = tj.length
        hostOut = proteusSelfDraw.update(tj)
      } else {
        bytes = JSON.stringify(patches).length
        hostOut = proteusSelfDraw.updatePatches(JSON.stringify(patches))
      }
      const tHost = now()
      const h = safeParseAny(hostOut)
      app.adapter.markFullSync()
      results.push({
        case: `S5_${label}`,
        note: `${N}→${newN} 项（${mode === 'FULL' ? '全量重建' : '补丁'}）`,
        items: newN, nodes: h?.["node_count"] ?? 0,
        vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tHost - tReq,
        host_ms: tHost - tReq, total_ms: tHost - t0,
        patch_count: app.adapter.patchCount(), request_bytes: bytes,
        extra: { mode, mem_mb: h?.["mem_mb"], mem_peak_mb: h?.["mem_peak_mb"] },
      })
      markCeiling('structure', `${N}→${newN} 项`, tHost - t0, `结构变更（${mode}）`)
    }
    await runOne('grow_600', 600)
    await runOne('shrink_400', 400)
    app.dispose()
  },
})

/* S6 · 最坏情形：整体重排（keyed diff 全量 + 布局全动） */
CASES.push({
  name: 'S6_worst_reverse',
  note: '★最坏情形：1000 项整体 reverse（keyed diff 全量重排 + 兄弟全部移位）',
  fn: async () => {
    const N = 1000
    const app = makeApp(N)
    mountApp(app, N)                    // ★必须：见 mountApp 注释
    app.adapter.resetStats()
    const t0 = now()
    app.reverse()
    await nextTick()
    const tVue = now()
    const patches = app.adapter.takePatches()
    const tReq = now()
    let hostOut: string
    let bytes = 0
    if (patches === null) {
      const r = app.adapter.toRequest(VP)
      const tj = JSON.stringify(r)
      bytes = tj.length
      hostOut = proteusSelfDraw.update(tj)
    } else {
      bytes = JSON.stringify(patches).length
      hostOut = proteusSelfDraw.updatePatches(JSON.stringify(patches))
    }
    const tHost = now()
    const h = safeParseAny(hostOut)
    results.push({
      case: 'S6_worst_reverse',
      note: `1000 项 reverse（最坏情形）`,
      items: N, nodes: 0,
      vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tHost - tReq,
      host_ms: tHost - tReq, total_ms: tHost - t0,
      patch_count: app.adapter.patchCount(), request_bytes: bytes,
      extra: { relayout: h?.["relayout_count"], patches_sent: patches === null ? 'FULL' : patches.length },
    })
    markCeiling('worst_case', '1000 项 reverse', tHost - t0, '整体重排')
    app.dispose()
  },
})

/* S1 · 规模天花板：挂载 N 项，看时间与内存的走向 */
for (const n of [1000, 2000, 4000]) {
  CASES.push({
    name: `S1_scale_mount_${n}`,
    note: `★规模天花板：挂载 ${n} 项（≈${n * 4 + 3} 节点）——看时间/内存走向`,
    fn: async () => {
      const t0 = now()
      const app = makeApp(n)                 // Vue：createApp + mount + 首帧 patch
      const tVue = now()
      const req = app.adapter.toRequest(VP)  // 适配器：拍平 + 折叠
      const tReq = now()
      const treeJson = JSON.stringify(req)
      const tSer = now()
      const hostOut = proteusSelfDraw.mount(treeJson)   // 宿主：度量 + 核心布局 + 建层
      const tHost = now()
      const h = safeParseAny(hostOut)
      app.adapter.markFullSync()
      const total = tHost - t0
      results.push({
        case: `S1_scale_mount_${n}`,
        note: `规模 ${n} 项挂载（${req.nodes.length} 节点）`,
        items: n, nodes: req.nodes.length,
        vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tSer - tReq,
        host_ms: tHost - tSer, total_ms: total,
        patch_count: app.adapter.patchCount(), request_bytes: treeJson.length,
        extra: { mem_mb: h?.["mem_mb"], mem_peak_mb: h?.["mem_peak_mb"],
                 per_node_us: Math.round((total / req.nodes.length) * 1000) / 1000 * 1000 },
      })
      markCeiling('scale', `${n} 项挂载`, total, '整链挂载耗时（含 Vue）')
      app.dispose()          // ★释放（否则内存累积，后续档位的读数不可归因）
    },
  })
}


} catch (e) { INIT_DIAG.errors.push('S 组注册失败: ' + String((e as Error)?.message ?? e)) }
INIT_DIAG.stages.push('after-S:' + CASES.length)

/* ────────────────────────── 宿主驱动的用例执行器 ────────────────────────── */

let idx = 0
let chain: Promise<void> = Promise.resolve()

const api = {
  /** 用例清单（宿主据此知道总数） */
  cases: (): string => JSON.stringify(CASES.map((c) => ({ name: c.name, note: c.note }))),

  /**
   * ★★**一次性启动整条用例链**（宿主只负责泵微任务，不再逐用例干预）
   *
   * 【为什么改（本仓实测的教训）】初版由宿主逐用例 `step()` 并「等 completed 增长」——
   *   而一旦某个用例抛异常被 `.catch()` 吞掉，`completed` 就**永不增长**
   *   ⇒ 宿主无限等待 ⇒ **JS 侧空转 88 秒** ⇒ 被 iOS 看门狗杀掉（现象：白屏几秒后退出）。
   *   ⇒ 正解：链条由 JS 自己串（`chain = chain.then(...)` 已经天然串行），
   *     宿主只需「反复让出主线程让微任务排空」，直到 `done()` 被调用。
   *   ★这也消除了「打印时序」与「执行时序」两套计时可能不一致的问题。
   */
  step: (): string => {
    if (idx >= CASES.length) {
      return JSON.stringify({ done: true, completed: executedCases, total: CASES.length })
    }
    const c = CASES[idx++]
    chain = chain.then(async () => {
      // ★★用例自己打时间戳（**根治计时窗口重叠**）
      //
      // 【为什么必须由用例自己打（本仓实测的两次失败尝试）】
      //   尝试 1：宿主泵固定 4 轮 → 需要 300 次 await 的用例只拿到 4 轮 ⇒ 窗口跨越后续用例。
      //   尝试 2：宿主按 `completed` 变化条件等待 → 但 `completed` 的增长发生在**微任务**里，
      //     宿主下一次 evaluateScript 时它**早就涨完了** ⇒ 判定"已完成"时其实还有别的用例在跑。
      //   ⇒ 根治：**把计时放进用例自身**（同一段微任务链，天然串行，不可能重叠）。
      //     宿主只负责「按节奏泵」，不再承担计时职责。
      const caseT0 = now()
      const rBefore = results.length
      try {
        await c.fn()
      } catch (e) {
        results.push({
          case: c.name, note: `✗ 用例异常：${String((e as { message?: string })?.message ?? e)}`,
          items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
          total_ms: -1, patch_count: -1, request_bytes: -1,
        })
      }
      // ★用例自身耗时（与 fn 内部的分段读数并列，互为校验）
      caseTimings[c.name] = Math.round((now() - caseT0) * 100) / 100
      void rBefore
      executedCases += 1          // ★用例数（与结果条数严格区分）
    })
    return JSON.stringify({ started: c.name, index: idx, total: CASES.length,
                            completed: executedCases, results: results.length })
  },

  /** 收尾：写报告（由宿主在所有用例完成后调用） */
  finish: (): string => {
    {
      const summary = {
        kind: 'logic-bench',
        build_id: BUILD_ID,
        init_diag: INIT_DIAG,
        runtime: 'JavaScriptCore（系统自带）',
        viewport: VP,
        total_cases: CASES.length,
        completed: executedCases,
        result_count: results.length,
        cases: results,
        ceiling,
        frame_budget_ms: FRAME_BUDGET_MS,
        case_timings_ms: caseTimings,
        notes: [
          '★四段分解：vue / 适配器 / 序列化 / 宿主',
          '★★加压测试：逐档增加到越过 16.7ms 帧预算，记录越线档位（ceiling）',
          '★变更位置区分：类A 边界内（应止于该行） vs 类B 平级（兄弟全动 ⇒ 父级）',
          '★用例自身打点（case_timings_ms），不依赖宿主泵节奏 ⇒ 计时窗口不重叠',
        ],
      }
      const json = JSON.stringify(summary)
      proteusSelfDraw.report(json)
      proteusSelfDraw.done(JSON.stringify({ ok: true, completed: executedCases, total: CASES.length }))
    }
    return JSON.stringify({ ok: true, completed: executedCases, total: CASES.length })
  },

  /** 已完成的读数（宿主每轮读它） */
  progress: (): string =>
    JSON.stringify({ completed: executedCases,        // ★用例数（与 CASES.length 同粒度）
                     results: results.length,          // 结果条数（可多于用例数）
                     total: CASES.length, started: idx,
                     cases: results.map((r) => r.case) }),

  /** 收尾：写出完整报告（宿主最后调用） */
  finish: (): string => {
    const summary = {
      kind: 'logic-bench',
      init_diag: INIT_DIAG,
      build_id: BUILD_ID,
      runtime: 'JavaScriptCore（系统自带）',
      viewport: VP,
      total_cases: CASES.length,
      completed: executedCases,        // ★已执行**用例**数
      result_count: results.length,    // 结果条数（诊断用：> completed 说明有用例产出多条）
      cases: results,
      // ★★加压测试的产出：**越线的档位**（哪一维、哪一档、多少 ms）
      ceiling,
      frame_budget_ms: FRAME_BUDGET_MS,
      case_timings_ms: caseTimings,
      notes: [
        '★四段分解：vue（响应式→重渲染→diff/patch）/ 适配器（拍平+折叠）/ 序列化（JSON，即跨界成本）/ 宿主（度量+布局+建层）',
        '★★必须逐用例由宿主驱动：JSC 的 evaluateScript 不排空微任务，而 Vue 更新调度正是微任务',
        '★A 组是规模扫描（12→1000 项），用于回答「边界成本随规模如何增长」',
        '★F 组验证 Vue 的批处理：同 tick 100 次变更应合并为 1 次渲染（extra.renders）',
        '★H 组对比 JSON 与扁平数值编码，直接支撑「是否值得上 JSI/二进制通道」的决策',
      ],
    }
    const json = JSON.stringify(summary)
    proteusSelfDraw.report(json)
    proteusSelfDraw.done(JSON.stringify({ ok: true, completed: results.length, total: CASES.length }))
    return JSON.stringify({ ok: true, completed: results.length })
  },
}

;(globalThis as unknown as { __proteus: Record<string, unknown> }).__proteus = api
