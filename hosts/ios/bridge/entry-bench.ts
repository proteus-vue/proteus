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

/* ────────────────────────── 宿主桥（与自绘场景同形，复用同一 Swift 宿主） ────────────────────────── */

interface SelfDrawNative {
  mount(treeJson: string): string
  update(treeJson: string): string
  snapshot(name: string): string
  report(json: string): void
  done(summaryJson: string): void
}
declare const proteusSelfDraw: SelfDrawNative
/** 快照名（宿主按模式注入，便于区分场景产物） */
const BN = { snapshot: 'bench-final' }

const VP = (globalThis as unknown as { __PROTEUS_VIEWPORT__?: { width: number; height: number } })
  .__PROTEUS_VIEWPORT__ ?? { width: 390, height: 844 }
const now = (): number => Date.now()

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

/* ────────────────────────── 应用工厂（规模可参数化） ────────────────────────── */

interface BenchApp {
  adapter: ReturnType<typeof createSelfDrawAdapter>
  setCount: (n: number) => void
  reverse: () => void
  setItems: (items: { id: number; title: string; sub: string }[]) => void
  mutateDeep: () => void
  setScaleBase: (n: number) => void
  renderCount: () => number
  items: () => { id: number; title: string; sub: string }[]
}

/**
 * 构建被测应用（规模参数化）。
 *
 * ★同时支持「列表项」与「深层嵌套 + computed 链」两种数据形态：
 *   前者用于规模扫描与 diff 类用例；后者用于 B/C 两条响应式形态用例。
 */
function makeApp(initial: number): BenchApp {
  const n = ref(initial)
  const accent = ref('#6f4ae8')
  // ★深响应式：ref 包裹对象 → Vue 会深度 reactive 化（改叶子应只影响用到它的那部分）
  const deep = reactive({ a: { b: { c: { v: 1 } } } })
  // ★computed 链（3 级）：base → mid → top，渲染只读 top
  const scaleBase = ref(1)
  const scaleMid = computed(() => scaleBase.value * 2)
  const scaleTop = computed(() => scaleMid.value + 100)
  // ★列表数据（keyed diff 用）：独立数组，支持 reverse / 结构变更
  const items0: { id: number; title: string; sub: string }[] = []
  for (let i = 0; i < initial; i++) items0.push({ id: i, title: `列表项 ${i + 1}`, sub: i % 3 === 0 ? '分组标题' : '说明文字' })
  const items = ref(items0)
  let renders = 0

  const adapter = createSelfDrawAdapter()
  const renderer = createAppRenderer(adapter)
  const container = adapter.createElement('p-view')
  adapter.root.children.push(container)
  container.parent = adapter.root

  const size = ref(initial)          // 外部直接驱动规模（避免每次改 items 清空）

  const App = {
    name: 'BenchApp',
    render() {
      renders++
      const count = n.value
      const c = accent.value
      const rows = items.value.slice(0, Math.max(count, items.value.length)).map((it) =>
        h('p-view', {
          key: it.id,
          style: {
            flexDirection: 'row', alignItems: 'center',
            height: 56, flexShrink: 0, margin: { bottom: 8 }, padding: { left: 16, right: 16 },
            backgroundColor: '#1b1b21', borderRadius: 12,
          },
        }, [
          h('p-view', { style: { width: 36, height: 36, backgroundColor: c, borderRadius: 18 } }),
          h('p-view', { style: { flexGrow: 1, margin: { left: 12 } } }, [
            h('p-text', { style: { fontSize: 16, color: '#ffffff' } }, it.title),
            h('p-text', { style: { fontSize: 13, color: '#9aa3b2' } }, it.sub),
          ]),
          // ★深层 + computed 的消费点：只在「第一行」引用，便于观测细粒度更新
          ...(it.id === items.value[0]?.id
            ? [h('p-text', { style: { fontSize: 11, color: '#666' } }, `d${deep.a.b.c.v}/s${scaleTop.value}`)]
            : []),
        ]),
      )
      return h('p-view', {
        style: {
          flexDirection: 'column', width: VP.width, height: VP.height,
          backgroundColor: '#101020', padding: { top: 60, left: 16, right: 16 },
        },
      }, [
        h('p-text', { style: { fontSize: 24, color: '#ffffff', margin: { bottom: 12 } } }, `bench ${size.value}`),
        ...rows,
      ])
    },
  }
  renderer.createApp(App).mount(container)

  return {
    adapter,
    setCount: (v) => { n.value = v; size.value = v },
    reverse: () => { items.value = [...items.value].reverse() },
    setItems: (v) => { items.value = v },
    mutateDeep: () => { deep.a.b.c.v = deep.a.b.c.v + 1 },
    setScaleBase: (v) => { scaleBase.value = v },
    renderCount: () => renders,
    items: () => items.value,
  }
}

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

/* ────────────────────────── 宿主驱动的用例执行器 ────────────────────────── */

let idx = 0
let chain: Promise<void> = Promise.resolve()

const api = {
  /** 用例清单（宿主据此知道总数） */
  cases: (): string => JSON.stringify(CASES.map((c) => ({ name: c.name, note: c.note }))),

  /**
   * 启动下一个用例（**同步返回**；实际工作挂在微任务链上）。
   * 宿主随后让出主线程 → 微任务排空 → 用例完成。
   */
  step: (): string => {
    if (idx >= CASES.length) return JSON.stringify({ done: true, total: CASES.length, completed: results.length })
    const c = CASES[idx++]
    chain = chain.then(async () => {
      try {
        await c.fn()
      } catch (e) {
        results.push({
          case: c.name, note: `✗ 用例异常：${String((e as { message?: string })?.message ?? e)}`,
          items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
          total_ms: -1, patch_count: -1, request_bytes: -1,
        })
      }
    })
    return JSON.stringify({ started: c.name, index: idx, total: CASES.length })
  },

  /** 已完成的读数（宿主每轮读它） */
  progress: (): string =>
    JSON.stringify({ completed: results.length, total: CASES.length, running: idx, cases: results.map((r) => r.case) }),

  /** 收尾：写出完整报告（宿主最后调用） */
  finish: (): string => {
    const summary = {
      kind: 'logic-bench',
      runtime: 'JavaScriptCore（系统自带）',
      viewport: VP,
      total_cases: CASES.length,
      completed: results.length,
      cases: results,
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
