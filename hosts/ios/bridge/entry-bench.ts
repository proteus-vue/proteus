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
// ★Vapor IR V3：槽位运行时（指令生成侧）。订阅表由**构建期**生成并随包下发
//   （编译器不进 app——它依赖 @babel/*，且 app 里没有解析 SFC 的场景；见 gen-vapor-table.mjs）
import { SlotRuntime, VaporRuntime, PropKeyTable, StringPool, ListRegistry, instantiateTemplate } from '@proteus-vue/slot-runtime'
import vaporTableJson from './dist/vapor-table.json'
// ★★★六端 SFC 压力夹具（2026-10-02）：与 Android 同源的编译产物
//   （同一个 .vue 文件：examples/pages/consistency-stress.vue，由 gen-vapor-table.mjs 编译）
import vaporStressJson from './dist/vapor-stress.json'
import type { BenchApp } from './bench-app'

/* ────────────────────────── 宿主桥（与自绘场景同形，复用同一 Swift 宿主） ────────────────────────── */

interface SelfDrawNative {
  mount(treeJson: string): string
  update(treeJson: string): string
  updatePatches(patchesJson: string): string
  /** ★Vapor IR V3：二进制指令流（字节数组 JSON 表示——指令流本身极小） */
  applyOps(opsBytesJson: string): string
  /**
   * ★★**结构变更（增删行）**：`{removes:[id], inserts:[{parentId,nodes}]}` → 核心 splice + 层增量增删
   *
   * 【为什么必须先探测存在性】宿主二进制可能落后于 JS bundle（两端独立构建）——
   *   缺它时必须**退回全量**并如实记录（`mode: 'FULL-no-entry'`），
   *   而不是调用不存在的方法抛异常（那会让整个用例静默丢结果）。
   */
  splice?(spliceJson: string): string
  /**
   * ★★**高分辨率单调时钟**（微秒，十进制字符串）
   *
   * 【为什么必须用宿主时钟（本仓实测的第六个测量装置缺陷）】
   *   JSC 的 `Date.now()` 在真机上是**粗粒度缓存时钟**——实测**连续 512 次读一次都不前进**
   *   ⇒ "p50 = 0ms / p95 = 1ms" 全是**分辨率假象**。
   *   桌面 JSC 有 `performance.now()`，**真机没有** ⇒ 只能由宿主提供。
   */
  nowUs?(): string
  /** ★V4 A/B：'v4'（二进制返回 + 只更可见层）| 'v3'（JSON 返回 + 全部层） */
  setOptMode?(mode: string): string
  /** ★V4：滚动视图（dx/dy 像素）——触发 layoutSubviews → 补刷已滚入的待更新层 */
  scrollBy?(dx: Double, dy: Double): String
  /** ★V4：当前待补刷（视口外）的层数 + 上次补刷数 */
  pendingStats?(): String
  /** ★★V5：批量像素采样（渲染一次读多点）—— 像素级验证的判据 */
  samplePixels?(json: String): String
  /** ★★A/B（矩阵 #14 续）：与 Android `readRects()` 同形——内核几何真源（判据用） */
  readRects?(): string
  /** ★★A/B：**绘制通道探针**（与 Android `probeChannels` 同族；从 CALayer 真读六通道） */
  probeChannels?(idsJson: string): string
  /** ★★A/B：**注册手势回调名**（宿主 tapAt 时经 JSContext 反向调用它——与 Android JNI 同语义） */
  onGesture?(name: string): string
  /**
   * ★★像素格式自检（三色标定）——**像素判据的前置**
   *
   * 【为什么必须由用例显式检查（本仓实测的测量装置缺陷）】`samplePixels` 曾经 R/B 互换
   *   （标定读数正确但结论推反），而此前所有像素判据都用**纯绿** ⇒ 绿在互换下不变 ⇒ 恒绿。
   *   ⇒ 纪律：**用像素做判据之前，先证明测量装置本身是对的**（"测量装置必须先自测"）。
   */
  pixelFormatSelfTest?(): String
  /** ★V10：绘制补丁（颜色/圆角/字重/字号/透明度）——几何之外的第二条通道（不经核心） */
  paintPatches?(patchesJson: string): string
  /** ★V9：注入一次 tap（内容坐标）——走与真实触摸同一条链（核心命中 → JS 派发） */
  tapAt?(x: number, y: number): string
  /** ★V10：注入一次 longpress（同链；用于"tap/longpress 分流零串扰"的负向判据） */
  longpressAt?(x: number, y: number): string
  /** ★V9：手势统计（命中/未命中/错误） */
  gestureStatsJson?(): string
  /**
   * ★★V12：**虚拟化挂载**（§12.5 materialize · §12.7 P1）
   *
   * 【为什么另开入口】全量挂载的读数（V6/V11）已进历史基线；在同一入口里改语义会让
   *   旧读数与新读数不可比（本仓纪律：改变已发布读数必须显式）。
   */
  mountVirtual?(requestJson: string): string
  /** ★V12：虚拟化滚动（dx/dy 像素）——宿主换算可见行 → 向核心复用池要决策 → 物化/回收 */
  scrollRows?(dx: number, dy: number): string
  /** ★V12：虚拟化读数（层数/建层/复用/池大小/已物化行） */
  virtualStats?(): string
  /** ★V12：虚拟化探针（某行的屏幕坐标 rect + 是否已物化）——坐标由宿主推导，不手算 */
  virtualProbe?(rowIndex: number): string
  /**
   * ★★**几何 + 字体探针**（V13）：节点的屏幕 rect + **层上实际字体名**
   *
   * 【为什么要读层上的字体名】几何宽度只能证明"**度量**时用了不同字体"；
   *   本仓已有"度量与绘制分叉 ⇒ 字被裁而报告全绿"的同族教训（见 `font(size:weight:)` 注释）。
   */
  measureProbe?(json: string): string
  /**
   * ★★**拆掉当前树**（销毁核心句柄 + 清层 + 重置 diff 基线）——下一次 `mount` 走**真全量**
   *
   * 【为什么需要（本仓实测的路径语义，V13 差点被它坑）】`mount` 是**增量语义**：
   *   `handle != 0` 时先做节点 diff，且只处理**布局**字段 ⇒ "只改了字体族"的第二次 mount
   *   布局补丁为空 ⇒ **什么都不做**（层上字体仍是上一次的）。
   *   对照实验必须显式拆树，否则会把"没生效"读成"这个维度不影响结果"。
   */
  clearTree?(): string
  /** ★V12：设置层池容量（0 ⇒ 完全不复用）——**破坏性验证**用 */
  setPoolCapacity?(n: number): string
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
const BUILD_ID = '4f8ee89f-183152'
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

/* ────────────────────────── ★时钟选择（唯一实现）────────────────────────── */
//
// 【为什么必须唯一实现（本仓纪律 #22）】时钟选择散在多处 ⇒ "某处用了粗粒度 `Date.now()`"
//   这类缺陷只在读数异常时才被发现（本仓实测：JSC 的 `Date.now()` 是**粗粒度缓存时钟**，
//   512 次连续读 0 次前进 ⇒ 分位读数完全不可信）。收敛到一处 ⇒ 改一次全受益。
//
// 优先级：宿主 `mach_absolute_time`（微秒字符串）> `performance.now` > `Date.now`（并标注不可信）。
function pickClock(): { clock: () => number; name: string; trustworthy: boolean } {
  const host = proteusSelfDraw as unknown as { nowUs?: () => string }
  if (typeof host.nowUs === 'function') {
    // 宿主返回微秒字符串 → 转毫秒（字符串避免 Number 精度在大时间戳上损失亚微秒）
    return { clock: () => parseFloat(host.nowUs!()) / 1000, name: 'host.mach_absolute_time', trustworthy: true }
  }
  const perf = (globalThis as unknown as { performance?: { now?: () => number } }).performance
  if (typeof perf?.now === 'function') {
    return { clock: perf.now.bind(perf), name: 'performance.now', trustworthy: true }
  }
  return { clock: () => Date.now(), name: 'Date.now（★粗粒度，分位不可信）', trustworthy: false }
}

/* ────────────────────────── ★flush 判据（§10「每帧 flush 次数 = 1」）────────────────────────── */
//
// 【为什么补它（2026-09-29）】`flushes` 此前**只上报、从不断言**——本仓纪律明说
//   「**只记录不断言 = 没测**」（纪律 #17 的同族：三色标定读数一直对，但从未进 verdict
//   ⇒ R/B 互换长期恒绿）。§10 的「每帧 flush 次数 = 1」因此在文档里只能标"未验证"。
//
// 【判据语义】`SlotRuntime.flush()` **只在 buffer 非空时**才 `stats.flushes++`（空 flush 早退）
//   ⇒ "一次更新周期恰好一次提交"等价于「**N 次更新 ⇒ flushes 增量恰为 N**」。
//   两侧都抓得住：
//     · 增量 < N ⇒ 有更新**没发指令**（静默 no-op，最危险的失效模式）；
//     · 增量 > N ⇒ 一次更新被**拆成多次提交**（调度有问题，§10 明确点名）。
//   ★这是**唯一实现**：三处 flush 循环（runScale 批量/分位 + 类B 两段）共用本函数。
//   ★★**前提（判据与被测口径必须对齐）**：每次迭代都必须是**真实变更**。`setSlot` 用
//     `Object.is` 短路（值相等不发指令）⇒ 若用例把值设成与初值相同，flushes 会**少 1**
//     而那不是缺陷。本仓实测首版就踩了：初值 40、循环首次也设 40 ⇒ 199/200 假红。
//     ⇒ 用例必须**错开初值与首次取值**（见 `mkRows` 注释）。
function flushCheck(rt: { getStats: () => { flushes: number } }, before: number, iterations: number) {
  const delta = rt.getStats().flushes - before
  return {
    ok: delta === iterations,
    flushes_delta: delta,
    expected: iterations,
    // 失败原因**可区分**（不只说"不对"——本仓纪律：守卫必须可观测）
    reason: delta === iterations ? '' : (delta < iterations ? 'under-emit（有更新未发指令）' : 'over-emit（一次更新被拆成多次提交）'),
  }
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
  // ★V9：登记为**当前派发目标**（宿主的触摸回调经 `__proteus_dispatch` 找到它）
  ;(globalThis as unknown as { __proteusDispatchTarget?: unknown }).__proteusDispatchTarget = app.adapter
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
          // ★整树重排路径的分段（持久引擎的靶子：root scope ⇒ layout_cached）
          relayout_ms: hr?.["relayout_ms"], idmap_ms: hr?.["idmap_ms"],
          collect_ms: hr?.["collect_ms"], engine_phases: hr?.["engine_phases"],
          measure_calls: hr?.["measure_calls"], measure_hits: hr?.["measure_hits"],
          // ★引擎状态诊断（判定"持久树/缓存是否真的被复用"——归因靠读数）
          engine_diag: (hr?.["_timing"] as Record<string, unknown>)?.["engine_diag"],
          timing_raw: hr?.["_timing"],   // ★整块（同上：避免字段搬运漏项）
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

/* ────────────── V3 探针：二进制指令流 → 真机几何（单节点更新 P95）────────────── */

/**
 * ★★V3 用例（方案 §9 V3 里程碑）
 *
 * 【与前序用例的关系】
 *   · V0 探针证明了「v-memo 等价物能把 Vue 侧 78ms 压到 9ms」——那是**上界**（Vue 原生手段）
 *   · 本用例走**完整 Vapor 链路**：TS 订阅表 → 槽位直写 → 二进制指令 → Swift 宿主 → Rust 应用
 *     ⇒ 给出的是**本实现自己的读数**
 *
 * 【★★测量装置的两个坑（本仓实测，第六次同类；首版读数因此不成立）】
 *   ① **时钟分辨率**：JSC 的 `Date.now()` 是**粗粒度缓存时钟**——本仓实测连续 2000 次读
 *      一次都不跳。⇒ 用它的"P50 = 0ms"实际含义是「时钟没走」，**不是零成本**。
 *      正解：优先用 `performance.now()`（真机 JSC 可用，本用例会**上报用的是哪个时钟**，
 *      并探测其分辨率），且以**批量摊还**（N 次总耗时 / N）为主读数——摊还天然避开分辨率限制。
 *   ② **问题规模不对等**：首版只在 **2 节点**的树上测，却与 S2 的 **1000 项（≈4000 节点）**
 *      基线并列展示 ⇒ 那是**不同一道题**。正解：两个规模都测并分别标注：
 *        · small（2 节点）：验证通路本身
 *        · large（≈S2 同规模）：**与 S2/V0 可比的**读数
 */
CASES.push({
  name: 'V3_vapor_slot_pipeline',
  note: '★★V3：订阅表 → 槽位直写 → 二进制指令 → 真机 Rust 应用（两档规模 × 单节点更新，摊还 + P95）',
  fn: async () => {
    // ── ★时钟选择（优先级：宿主高分辨率时钟 > performance.now > Date.now）──
    //
    // 【本仓实测（第六个测量装置缺陷）】JSC 的 `Date.now()` 在真机上是粗粒度缓存时钟
    //   （512 次连续读 0 次前进）⇒ 分位读数完全不可信。宿主 `mach_absolute_time`
    //   是唯一可靠来源（且**单调**，不受墙钟调整影响）。
    let clockMs: () => number
    let clockName: string
    if (typeof proteusSelfDraw.nowUs === 'function') {
      // 宿主返回微秒字符串 → 转毫秒（字符串避免 Number 精度在大时间戳上损失亚微秒）
      clockMs = () => parseFloat(proteusSelfDraw.nowUs!()) / 1000
      clockName = 'host.mach_absolute_time'
    } else {
      const perf = (globalThis as unknown as { performance?: { now?: () => number } }).performance
      if (typeof perf?.now === 'function') {
        clockMs = perf.now.bind(perf)
        clockName = 'performance.now'
      } else {
        clockMs = now
        clockName = 'Date.now（★粗粒度，分位不可信）'
      }
    }
    // 分辨率探测：连续读 512 次，统计有几次前进 + 最小非零 delta
    let minNonZero = Infinity
    let ticks = 0
    let prevR = clockMs()
    for (let i = 0; i < 512; i++) {
      const t = clockMs()
      const d = t - prevR
      if (d > 0) {
        ticks++
        if (d < minNonZero) minNonZero = d
      }
      prevR = t
    }
    const clock = clockMs

    const built = vaporTableJson as unknown as {
      ok: boolean
      table: import('@proteus-vue/slot-runtime').SubscriptionTable
      decisions: unknown[]
      notes: string[]
    }
    if (!built.ok) {
      results.push({
        case: 'V3_vapor_slot_pipeline', note: `✗ 编译期产物构建失败：${built.notes.join('; ')}`,
        items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
        total_ms: -1, patch_count: -1, request_bytes: -1,
      })
      return
    }

    /**
     * 跑一档规模：建树 → 挂载 → 跑 N 次单节点更新（摊还 + 分位）
     *
     * @param label   'small' | 'large'
     * @param nodes   手写树（id 顺序自由，但**绑定目标必须是 id=1**——
     *                订阅表由构建期生成，其 nodeId 来自模板元素序）
     */
    // ★★2026-09-29 修：改用 **SFC 模板实例化**建树（而不再手搓静态树）
    //
    // 【为什么（flush 判据抓出来的真缺陷）】新加的「每帧 flush 次数 = 1」判据首跑即报
    //   `flushes_delta = 0`（**有更新却一条指令都没发**）。诊断（`ops_emitted_total=0` /
    //   `short_circuits=0` / `buffers_captured=0`）指向：订阅表与树**结构不匹配**——
    //   该表由 `gen-vapor-table.mjs` 的 SFC 生成（**含 v-for 列表**，`dotW` 在 list-item 槽位上），
    //   而 runScale 手搓的是**静态无 v-for 树**（`dotW` 绑在裸 id 1）⇒ 触发器触发了，
    //   但没有任何槽位与之对应 ⇒ 零指令（**用例在测一棵"没接上订阅"的树**）。
    //   ★这正是"只记录不断言"的代价：`flushes` 一直在上报，但从没人断言它 —— 若早断言，
    //     这个失配在 V3 落地当天就会发现，而不是等到今天。
    //   修法：与 V6/V11/V14 同一路子——**同一份模板产物**（`builtTpl.template` + `table`）
    //     经 `instantiateTemplate` 产出树 ⇒ 树与订阅天然同源（结构漂移在构造上不可能）。
    const mkRows = (n: number) => Array.from({ length: n }, (_, i) => ({
      // ★第 1 行初值 36（与模板 ref 初值一致）⇒ 循环首次设 20 必然是**真实变更**
      //   【为什么必须错开（本仓实测）】首版初值取 `i%2?20:40` ⇒ 第 0 行初值 40，
      //   而循环 `i=0` 也设 40 ⇒ `setSlot` 的 `Object.is` **短路** ⇒ flushes 少 1（199/200）。
      //   那不是缺陷（值没变本就不该发指令），但会让判据**误报**——判据与被测口径必须对齐。
      id: i + 1, dotW: i === 0 ? 36 : (i % 2 ? 20 : 40), textW: 120, title: `行 ${i + 1}`,
    }))
    const builtTplForScale = vaporTableJson as unknown as {
      ok: boolean
      table: import('@proteus-vue/slot-runtime').SubscriptionTable
      template: import('@proteus-vue/slot-runtime').LayoutTemplate
    }
    const runScale = async (label: 'small' | 'large', items: number, note: string) => {
      if (!builtTplForScale.ok || !builtTplForScale.template) {
        results.push({
          case: `V3_vapor_${label}`, note: '✗ 模板产物不可用（vapor-table.json 缺 template）',
          items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
          total_ms: -1, patch_count: -1, request_bytes: -1,
        })
        return
      }
      // ★模板实例化（与订阅表同源；ListRegistry 登记行内槽位 → 实际行节点）
      const registry = new ListRegistry()
      const scaleRows = mkRows(items)
      const inst = instantiateTemplate(builtTplForScale.template, {
        viewport: VP,
        read: (n: string) => (n === 'list' ? scaleRows : undefined),
        table: builtTplForScale.table,
        registry,
      })
      const nodes = inst.nodes as unknown as Array<Record<string, unknown>>
      const mountOut = safeParseAny(proteusSelfDraw.mount(JSON.stringify({ viewport: VP, nodes })))
      if (!mountOut?.ok) {
        results.push({
          case: `V3_vapor_${label}`, note: `✗ 建树失败：${JSON.stringify(mountOut)?.slice(0, 120)}`,
          items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
          total_ms: -1, patch_count: -1, request_bytes: -1,
        })
        return
      }

      const keys = new PropKeyTable()
      const strings = new StringPool()
      const captured: Uint8Array[] = []
      const rt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes))
      // ★触发源与表一致：表订阅的是 `list` 源下的 list-item 槽位（dotW 是**行字段**）
      const ctx = { read: (n: string) => (n === 'list' ? scaleRows : undefined) }
      // ★★必须传 `registry`（第 4 参）——本仓实测：漏了它 ⇒ `list-item` 槽位解析不到
      //   「具体行的节点」⇒ 指令要么不发、要么发到模板节点 ⇒ `geom_changed=0`
      //   （现象：几何根本没变，用例却照跑照报耗时——**这个失配正是 flush 判据抓出来的**）。
      //   对照：同文件另三处（V6/V11/V14）都传了 registry。
      const vapor = new VaporRuntime(built.table, rt, VaporRuntime.buildEvaluators(built.table.evaluators), registry)
      const triggers = new Map<string, () => void>()
      const loadRes = vapor.load(ctx, (name, cb) => triggers.set(name, cb))
      vapor.relink(ctx)
      rt.flush()
      captured.length = 0 // 丢掉首帧

      // ── ① 摊还读数（主读数：天然避开时钟分辨率限制）──
      const N = 200
      // ★§10「每帧 flush 次数 = 1」判据：批量段
      const flushBeforeBatch = rt.getStats().flushes
      const tBatch0 = clock()
      let lastOut: Record<string, unknown> | undefined
      // ★JS 侧 vs 宿主侧**分离计时**（2026-09-29）——本仓纪律「任何 >5ms 的分段都必须再拆」：
      //   11.9ms/次的读数若不拆，会把"JS 扫行成本"误当成"宿主慢"。
      let jsMsTotal = 0
      let hostMsTotal = 0
      let payloadMax = 0
      for (let i = 0; i < N; i++) {
        const tj0 = clock()
        scaleRows[0]!.dotW = i % 2 ? 20 : 40
        triggers.get('list')?.()      // ★JS：源级触发 → 行集扫描 → 逐行 diff → 发指令
        rt.flush()
        const bytes = captured.pop()
        const tj1 = clock()
        jsMsTotal += tj1 - tj0
        if (bytes) {
          lastOut = safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(bytes))))
          payloadMax = Math.max(payloadMax, bytes.length)
        }
        hostMsTotal += clock() - tj1
      }
      const batchMs = clock() - tBatch0
      const jsMsPerIter = jsMsTotal / N
      const hostMsPerIter = hostMsTotal / N
      const perIterUs = (batchMs / N) * 1000
      const flushBatchCheck = flushCheck(rt, flushBeforeBatch, N)
      // ★诊断（判据失败时必须能归因——本仓纪律"守卫必须可观测"）：
      //   区分三种可能：① 触发器没被调 ② 被调但值相等短路 ③ 标脏了但 flush 没发指令
      const flushDiag = {
        short_circuits: rt.getStats().shortCircuits,
        ops_emitted_total: rt.getStats().opsEmitted,
        buffers_captured: captured.length,
      }

      // ── ② 单次分位（用同一个时钟；读数受分辨率限制，仅作参考）──
      const flushBeforeSamples = rt.getStats().flushes
      const samples: number[] = []
      for (let i = 0; i < 100; i++) {
        scaleRows[0]!.dotW = i % 2 ? 20 : 40
        const t0 = clock()
        triggers.get('list')?.()
        rt.flush()
        const bytes = captured.pop()
        if (bytes) lastOut = safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(bytes))))
        samples.push(clock() - t0)
      }
      const flushSamplesCheck = flushCheck(rt, flushBeforeSamples, 100)
      samples.sort((a, b) => a - b)
      const pick = (p: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]

      results.push({
        case: `V3_vapor_${label}`,
        note: `${note}（${N} 次摊还 + 100 次分位；时钟=${clockName}）`,
        items: label === 'large' ? 1000 : 2, nodes: (mountOut.node_count as number) ?? nodes.length,
        vue_ms: perIterUs / 1000, // ★摊还均值（毫秒；p50 见 extra）
        to_request_ms: 0, serialize_ms: 0,
        host_ms: (lastOut?.host_total_ms as number) ?? 0,
        total_ms: batchMs,
        patch_count: rt.getStats().opsEmitted,
        request_bytes: (lastOut?.in_bytes as number) ?? 0,
        extra: {
          clock: clockName,
          clock_min_nonzero_ms: minNonZero === Infinity ? 'none' : minNonZero,
          clock_ticks_in_512_reads: ticks,
          amortized_us: Math.round(perIterUs * 1000) / 1000,
          batch_ms: Math.round(batchMs * 100) / 100,
          iters: N,
          // 分位（受分辨率限制，标注清楚）
          p50_ms: pick(0.5), p95_ms: pick(0.95), p99_ms: pick(0.99),
          min_ms: samples[0], max_ms: samples[samples.length - 1],
          l1_slots: loadRes.l1Slots, l0_slots: loadRes.l0Slots,
          unsupported_evaluators: loadRes.unsupportedEvaluators.length,
          // ★§10 flush 判据（两项都必须 ok；不 ok ⇒ 本用例 verdict 为 FAIL）
          flush_check_batch: flushBatchCheck,
          flush_check_samples: flushSamplesCheck,
          flush_one_per_update: flushBatchCheck.ok && flushSamplesCheck.ok,
          flush_diag: flushDiag,
          // ★JS / 宿主分离（摊还均值 ms）——回答"这段时间是谁花的"
          js_ms_per_iter: Math.round(jsMsPerIter * 1000) / 1000,
          host_ms_per_iter: Math.round(hostMsPerIter * 1000) / 1000,
          js_share: Math.round((jsMsPerIter / Math.max(1e-9, jsMsPerIter + hostMsPerIter)) * 1000) / 1000,
          payload_bytes: payloadMax,
          // ★口径（必须随读数一起读）：本档是**列表级**更新（改行字段 ⇒ 全表扫 + 全量载荷）
          scope_note: 'list-level update (whole-source trigger): JS scans all rows + full payload; NOT the single-node P95 metric',
          host_geom_changed: lastOut?.geom_changed,
          host_geom_total: lastOut?.geom_total,
          host_deferred: lastOut?.deferred,
          host_rects_bin_ms: lastOut?.rects_bin_ms,
          flushes: rt.getStats().flushes,
          ops_total: rt.getStats().opsEmitted,
          host_relayout: lastOut?.relayout_count,
          host_scopes: lastOut?.scopes,
          host_updated_layers: lastOut?.updated_layers,
          host_unsupported: lastOut?.unsupported_count,
          host_apply_ms: lastOut?.apply_ms,
          host_layers_ms: lastOut?.layers_ms,
          // ★判据进 verdict（本仓纪律：不进 verdict 的读数等于没测）
          verdict: (flushBatchCheck.ok && flushSamplesCheck.ok) ? 'PASS' : 'FAIL',
        },
      })
      return perIterUs
    }

    // ── small：1 行（验证通路本身；**不可**与 S2 比规模）──
    await runScale('small', 1, 'V3 small：1 行（通路验证；改行字段 ⇒ 整表触发，成本随行数增长）')

    // ── large：≈S2 同规模（1000 行 ≈ 4004 节点）——**这一档才与 S2/V0 可比** ──
    // ★树由 `runScale` 内的 `instantiateTemplate` 产出（与订阅表同源）——此处只给行数。
    //   ★2026-09-29 修正：改模板实例化时漏删了旧的"手搓 1000 项数组"循环，
    //     而它仍往**已改名的**变量里 push ⇒ ReferenceError ⇒ 本用例在此中断
    //     （现象：small 有结果、large 与类B 都没有、`js_completed` 仍算完成）。
    //     ⇒ 这类"改一半"的残留靠**看结果条数**发现：期望 3 条（small/large/classB），实得 1 条。
    // ★★口径澄清（2026-09-29 实测）：本档改的是**行字段**（`item.dotW`）⇒ 触发的是
    //   **整个列表源**（`list`）⇒ 运行时按行扫全表 + 逐行 diff ⇒ 载荷随行数增长
    //   （1000 行 ⇒ **8964B / 3300 条指令**，而几何只变 2 个节点）。
    //   ⇒ 它测的是「**列表级更新的全表成本**」，**不是**「单节点更新」——
    //     §10 的「单节点更新 P95」应以 **类B 档（2.16ms）** 与 **V11（改 1 行只发 1 条）** 为准。
    //   ★诚实标注：本档读数（p95 ≈12ms）**不构成 §10 的达标证据**，它是**列表级更新的成本读数**。
    await runScale('large', 1000, 'V3 large：1000 行 ≈4004 节点 · **列表级更新**（改行字段 ⇒ 全表扫描 + 全量载荷；非单节点口径）')

    // ── ★★类B（不利场景）：单条指令但**重排范围 = 根**（与类A 对照）──
    //
    // 【为什么必须测它（否则成绩只覆盖了有利情形）】
    //   类A（上面的 small/large）：改的是**被显式尺寸行罩住**的子节点 ⇒ 重排止于该行
    //     （`relayout_count = 2`）。这是布局边界发挥作用的**最优**情形。
    //   类B：改**行自身的高度** ⇒ 兄弟行全部移位 ⇒ 范围上浮到根 ⇒ 整树重排。
    //   两者都是"一条指令"，但代价差一个数量级——不测就是**选择性汇报**。
    //   与 S2 的类A/类B 划分同源（S2_B_sibling_margin 就是类B）。
    {
      const largeNodes: Array<Record<string, unknown>> = [
        { id: 0, parentId: null, flexDirection: 'column', width: VP.width, height: VP.height },
        // ★★必须 flexShrink:0（本仓实测的第三个基准树缺陷）：
        //   1001 行 × 56px 挤在 844px 的根里，不设它会被 flexbox 压缩到内容高度(36px)
        //   ⇒ 「改行高 56→80」**根本不产生几何变化**（实测：变了的节点 = 0/4003），
        //   用例却照报 47.9ms（全量重排 + 全量传输 + 全量层更新，全作用在一棵"没变化"的树上）。
        { id: 2, parentId: 0, flexDirection: 'row', width: VP.width - 32, height: 56, flexShrink: 0 },
        { id: 1, parentId: 2, width: 36, height: 36 },
      ]
      const ROWS = 1000
      for (let i = 0; i < ROWS; i++) {
        const rid = 100 + i * 4
        largeNodes.push({ id: rid, parentId: 0, flexDirection: 'row', width: VP.width - 32, height: 56, flexShrink: 0 })
        largeNodes.push({ id: rid + 1, parentId: rid, width: 36, height: 36 })
        largeNodes.push({ id: rid + 2, parentId: rid, flexGrow: 1, flexDirection: 'column' })
        largeNodes.push({ id: rid + 3, parentId: rid + 2, width: 120, height: 16 })
      }
      const mountOut = safeParseAny(proteusSelfDraw.mount(JSON.stringify({ viewport: VP, nodes: largeNodes })))
      if (mountOut?.ok) {
        const keys = new PropKeyTable()
        const strings = new StringPool()
        const captured: Uint8Array[] = []
        const rt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes))
        const heightKey = keys.intern('layout.height')
        const N = 100
        const flushBeforeB = rt.getStats().flushes
        let lastOut: Record<string, unknown> | undefined
        const t0 = clock()
        for (let i = 0; i < N; i++) {
          // ★行高在 56/60 间交替（每次都是真实变更；行高变化会让后续兄弟移位 ⇒ 类B）
          rt.buffer.push({ op: 0x02 /* SET_STYLE */, nodeId: 2, keyId: heightKey, value: i % 2 ? 60 : 56 })
          rt.flush()
          const bytes = captured.pop()
          if (bytes) lastOut = safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(bytes))))
        }
        const batchMs = clock() - t0
        const flushBCheck1 = flushCheck(rt, flushBeforeB, N)

        // ★分位采样（与本用例其它档一致；单次读数受时钟分辨率影响，摊还是主读数）
        const flushBeforeB2 = rt.getStats().flushes
        const classBSamples: number[] = []
        for (let i = 0; i < 60; i++) {
          const t1 = clock()
          rt.buffer.push({ op: 0x02, nodeId: 2, keyId: heightKey, value: i % 2 ? 60 : 56 })
          rt.flush()
          const b = captured.pop()
          if (b) lastOut = safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(b))))
          classBSamples.push(clock() - t1)
        }
        const flushBCheck2 = flushCheck(rt, flushBeforeB2, 60)
        classBSamples.sort((a, b) => a - b)
        const pickB = (pp: number) => classBSamples[Math.min(classBSamples.length - 1, Math.floor(classBSamples.length * pp))]

        results.push({
          case: 'V3_vapor_large_classB',
          note: `V3 large · **类B（不利）**：改行高 ⇒ 兄弟移位 ⇒ 范围上浮（${N} 次摊还；时钟=${clockName}）`,
          items: 1000, nodes: (mountOut.node_count as number) ?? 0,
          vue_ms: (batchMs / N), to_request_ms: 0, serialize_ms: 0,
          host_ms: (lastOut?.host_total_ms as number) ?? 0,
          total_ms: batchMs, patch_count: rt.getStats().opsEmitted,
          request_bytes: (lastOut?.in_bytes as number) ?? 0,
          extra: {
            clock: clockName,
            amortized_us: Math.round((batchMs / N) * 1000 * 1000) / 1000,
            batch_ms: Math.round(batchMs * 100) / 100,
            iters: N,
            // ★分位（60 次采样；★这是**不利场景**，读数应与类A 并列展示而非只报类A）
            p50_ms: pickB(0.5), p95_ms: pickB(0.95), p99_ms: pickB(0.99),
            min_ms: classBSamples[0], max_ms: classBSamples[classBSamples.length - 1],
            host_rects_parse_ms: lastOut?.rects_parse_ms,
            // ★V4 自检与优化读数
            host_geom_changed: lastOut?.geom_changed,   // 「几何真的变了」的节点数（应为大量）
            host_geom_total: lastOut?.geom_total,
            host_rects_bin_ms: lastOut?.rects_bin_ms,   // 二进制返回解码耗时
            host_deferred: lastOut?.deferred,           // 因不可见被延迟的层数
            host_flushed: lastOut?.flushed,
            host_relayout: lastOut?.relayout_count,
            host_scopes: lastOut?.scopes,
            host_updated_layers: lastOut?.updated_layers,
            host_apply_ms: lastOut?.apply_ms,
            host_layers_ms: lastOut?.layers_ms,
            host_unsupported: lastOut?.unsupported_count,
            // ★flush 判据（与 runScale 同一 helper ⇒ 同一语义，避免"第 N 份副本"）
            flush_check_batch: flushBCheck1,
            flush_check_samples: flushBCheck2,
            flush_one_per_update: flushBCheck1.ok && flushBCheck2.ok,
            verdict: (flushBCheck1.ok && flushBCheck2.ok) ? 'PASS' : 'FAIL',
          },
        })
      }
    }

    // ── ★★V4 A/B：同树同用例对比「旧路径（JSON+全量层）」vs「新路径（二进制+可见层）」──
    //
    // 【为什么要 A/B 而不是只报优化后】两个读数必须来自**同一棵基准树**才可比——
    //   本仓实测教训：旧类B 读数取自一棵"改行高不产生几何变化"的坏树，与新读数不可比。
    {
      const mkTree = () => {
        const nodes: Array<Record<string, unknown>> = [
          { id: 0, parentId: null, flexDirection: 'column', width: VP.width, height: VP.height },
          { id: 2, parentId: 0, flexDirection: 'row', width: VP.width - 32, height: 56, flexShrink: 0 },
          { id: 1, parentId: 2, width: 36, height: 36 },
        ]
        for (let i = 0; i < 1000; i++) {
          const rid = 100 + i * 4
          nodes.push({ id: rid, parentId: 0, flexDirection: 'row', width: VP.width - 32, height: 56, flexShrink: 0 })
          nodes.push({ id: rid + 1, parentId: rid, width: 36, height: 36 })
          nodes.push({ id: rid + 2, parentId: rid, flexGrow: 1, flexDirection: 'column' })
          nodes.push({ id: rid + 3, parentId: rid + 2, width: 120, height: 16 })
        }
        return { viewport: VP, nodes }
      }
      const runAB = (mode: 'v3' | 'v4') => {
        proteusSelfDraw.setOptMode?.(mode)
        const m = safeParseAny(proteusSelfDraw.mount(JSON.stringify(mkTree())))
        if (!m?.ok) return null
        const keys = new PropKeyTable()
        const strings = new StringPool()
        const cap: Uint8Array[] = []
        const rt = new SlotRuntime(keys, strings, (b) => cap.push(b))
        const hk = keys.intern('layout.height')
        const N = 100
        let last: Record<string, unknown> | undefined
        const t0 = clock()
        for (let i = 0; i < N; i++) {
          rt.buffer.push({ op: 0x02, nodeId: 2, keyId: hk, value: i % 2 ? 60 : 56 })
          rt.flush()
          const b = cap.pop()
          if (b) last = safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(b))))
        }
        const total = clock() - t0
        return { perIterUs: (total / N) * 1000, last, nodes: (m.node_count as number) ?? 0 }
      }
      // ★三轮取中位（V4 下半：热降频让单轮读数在 26–139ms 间摆动，
      //   本仓实测——单轮不可复现 ⇒ 必须多轮取中位，并把三轮原值一并落盘）
      const roundsV3: number[] = []
      const roundsV4: number[] = []
      let lastV3: Record<string, unknown> | undefined
      let lastV4: Record<string, unknown> | undefined
      for (let r = 0; r < 3; r++) {
        const a = runAB('v3')
        const b = runAB('v4')
        if (a) {
          roundsV3.push(a.perIterUs)
          lastV3 = a.last
        }
        if (b) {
          roundsV4.push(b.perIterUs)
          lastV4 = b.last
        }
      }
      const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
      const abV3 = roundsV3.length ? { perIterUs: med(roundsV3), last: lastV3 } : null
      const abV4 = roundsV4.length ? { perIterUs: med(roundsV4), last: lastV4 } : null
      proteusSelfDraw.setOptMode?.('v4') // 复位
      if (abV3 && abV4) {
        results.push({
          case: 'V4_classB_AB',
          note: '★★V4 A/B（同树同用例）：v3=JSON返回+全量层 · v4=二进制返回+可见层',
          items: 1000, nodes: abV4.nodes,
          vue_ms: abV4.perIterUs / 1000, to_request_ms: 0, serialize_ms: 0,
          host_ms: (abV4.last?.host_total_ms as number) ?? 0,
          total_ms: abV4.perIterUs * 100 / 1000,
          patch_count: 100, request_bytes: (abV4.last?.in_bytes as number) ?? 0,
          extra: {
            v3_amortized_us: Math.round(abV3.perIterUs * 1000) / 1000,
            v4_amortized_us: Math.round(abV4.perIterUs * 1000) / 1000,
            speedup: Math.round((abV3.perIterUs / Math.max(abV4.perIterUs, 0.001)) * 100) / 100,
            // ★三轮原值（可复核离散度——单轮读数不可复现的证据）
            v3_rounds_us: roundsV3.map((x) => Math.round(x * 1000) / 1000),
            v4_rounds_us: roundsV4.map((x) => Math.round(x * 1000) / 1000),
            // ★Rust 侧分段（闭合总账）
            v4_apply_ms: lastV4?.apply_ms, v4_relayout_ms: lastV4?.relayout_ms,
            v3_apply_ms: lastV3?.apply_ms, v3_relayout_ms: lastV3?.relayout_ms,
            // ★layers 三段分解（定位残余）
            v4_layers_sort_ms: lastV4?.layers_sort_ms,
            v4_layers_frames_ms: lastV4?.layers_frames_ms,
            v4_layers_commit_ms: lastV4?.layers_commit_ms,
            v3_layers_sort_ms: lastV3?.layers_sort_ms,
            v3_layers_frames_ms: lastV3?.layers_frames_ms,
            v3_layers_commit_ms: lastV3?.layers_commit_ms,
            v3_rects_bin_ms: abV3.last?.rects_bin_ms, v3_layers_ms: abV3.last?.host_layers_ms,
            v4_rects_bin_ms: abV4.last?.rects_bin_ms, v4_layers_ms: abV4.last?.host_layers_ms,
            v4_deferred: abV4.last?.deferred,
            v3_geom: abV3.last?.geom_changed, v4_geom: abV4.last?.geom_changed,
          },
        })
      }
    }

    // ── ★★V4 滚动端到端：验证「不可见层延后 + 滚入前补刷」的正确性 ──
    //
    // 【为什么必须测（这是「只更可见层」的正确性红线）】
    //   优化把视口外的层更新**记账延后**（pendingOffscreen）。若滚入时没补刷，
    //   那些层会显示**旧几何**（错位）——而且**只有在滚动后才看得见**，
    //   静态截图与不滚动的用例都发现不了。⇒ 必须真滚一次并核对几何。
    {
      const nodes: Array<Record<string, unknown>> = [
        { id: 0, parentId: null, flexDirection: 'column', width: VP.width, height: VP.height },
        { id: 2, parentId: 0, flexDirection: 'row', width: VP.width - 32, height: 56, flexShrink: 0 },
        { id: 1, parentId: 2, width: 36, height: 36 },
      ]
      const ROWS = 200
      for (let i = 0; i < ROWS; i++) {
        const rid = 100 + i * 4
        nodes.push({ id: rid, parentId: 0, flexDirection: 'row', width: VP.width - 32, height: 56, flexShrink: 0 })
        nodes.push({ id: rid + 1, parentId: rid, width: 36, height: 36 })
        nodes.push({ id: rid + 2, parentId: rid, flexGrow: 1, flexDirection: 'column' })
        nodes.push({ id: rid + 3, parentId: rid + 2, width: 120, height: 16 })
      }
      proteusSelfDraw.setOptMode?.('v4')
      const m = safeParseAny(proteusSelfDraw.mount(JSON.stringify({ viewport: VP, nodes })))
      if (m?.ok) {
        const keys = new PropKeyTable()
        const strings = new StringPool()
        const cap: Uint8Array[] = []
        const rt = new SlotRuntime(keys, strings, (b) => cap.push(b))
        const hk = keys.intern('layout.height')
        // 改首行高 ⇒ 后续 199 行全部移位（其中绝大多数在视口外 ⇒ 应被延后）
        rt.buffer.push({ op: 0x02, nodeId: 2, keyId: hk, value: 80 })
        rt.flush()
        const b = cap.pop()
        const out1 = b ? safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(b)))) : undefined
        const deferred = (out1?.deferred as number) ?? 0

        // ★★两阶段故障链验证（本仓实测的静默错几何缺陷）
        //   ① 更新1：节点不可见 ⇒ 延后记账（旧账 = 旧 rect）
        //   ② 更新2：**不滚动**，仅因几何变化使该节点转为可见 ⇒ 立即应用
        //      若不清旧账 ⇒ ③ 再滚动时用旧 rect 覆盖回去（静默回退）
        //   判据：stale_cleared ≥ 0 且 pending_visible_overlap === 0（不变量）
        const staleProbe = (() => {
          // 缩首行高 ⇒ 后续行整体**上移**，下方原本不可见的行可能滚入可见区
          rt.buffer.push({ op: 0x02, nodeId: 2, keyId: hk, value: 30 })
          rt.flush()
          const b2 = cap.pop()
          return b2 ? safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(b2)))) : undefined
        })()

        // ★滚动方向（本仓实测纠正）：`contentOffset.y` 增大 = 内容上移 = **向下滚**，
        //   于是**后面的行**进入视野。首版传 -600（方向反了）⇒ 没有任何行滚入 ⇒ 补刷恒为 0。
        //   滚动量取足够大（跨过预取区），确保确实有行从"不可见"变为"可见"。
        const pendingBefore = safeParseAny(proteusSelfDraw.pendingStats?.() ?? '{}')
        proteusSelfDraw.scrollBy?.(0, 1200)
        const pendingAfter = safeParseAny(proteusSelfDraw.pendingStats?.() ?? '{}')

        results.push({
          case: 'V4_scroll_flush',
          note: '★★V4 滚动端到端：视口外延后 → 滚动补刷（验证「滚入前不漏刷」）',
          items: ROWS, nodes: (m.node_count as number) ?? 0,
          vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0,
          total_ms: 0, patch_count: 1, request_bytes: 0,
          extra: {
            deferred_after_update: deferred,
            pending_before_scroll: pendingBefore?.pending,
            pending_after_scroll: pendingAfter?.pending,
            flushed_on_scroll: pendingAfter?.last_flushed,
            // ★不变量与故障链判据
            stale_cleared: staleProbe?.stale_cleared,
            pending_visible_overlap: staleProbe?.pending_visible_overlap,
            // ★判据：延后的应有大量（>0）；滚动后补刷数应 >0（说明滚入的层被刷了）
            verdict:
              deferred > 0 &&
              ((pendingAfter?.last_flushed as number) ?? 0) > 0 &&
              // ★不变量：可见节点不得残留在待补刷表（否则会旧几何回退）
              (staleProbe?.pending_visible_overlap ?? 1) === 0
                ? 'PASS'
                : 'FAIL',
          },
        })
      }
    }

    // ── ★★V5 像素级验证：滚动后屏幕上的**颜色序列**必须与几何一致 ──
    //
    // 【为什么要它（本仓反复标注的缺口）】此前所有验证都停在"**几何**算对了"
    //   （rect/坐标/增量≡全量不变式），而"**屏幕上真的画对了**"从未验证。
    //   延迟补刷（只更可见层）尤其需要：几何对 ≠ 屏幕对。
    //
    // 【判据设计】每行给**唯一的背景色**（R 通道编码行号）⇒ 在屏幕上采样若干点，
    //   断言各点颜色 = 「该位置**应该**显示的那一行」的颜色。
    //   · 若补刷漏了 ⇒ 该处仍是**旧几何**的行（颜色错）
    //   · 若坐标系错 ⇒ 整片颜色序列错位
    //   ⇒ 这是一个**端到端**判据：几何 → 层 frame → 渲染像素，全链一致才通过。
    {
      proteusSelfDraw.setOptMode?.('v4')
      // 行几何：全部高 60、无间距 ⇒ 行 i 占内容 y ∈ [i*60, i*60+60)
      // 更新后：行 0 高 60→200 ⇒ 行 i≥1 下移 140 ⇒ 行 i 起点 = 140 + i*60
      const ROWS = 40
      const rowColor = (i: number): string => {
        const r = (8 + i * 6) % 256
        return `#${r.toString(16).padStart(2, '0').toUpperCase()}2040`
      }
      const nodes: Array<Record<string, unknown>> = [
        { id: 0, parentId: null, flexDirection: 'column', width: VP.width, height: VP.height },
        // ★色彩标定块（前三行固定为纯红/纯绿/纯蓝——用于反推宿主的色彩/字节变换）
        { id: 900, parentId: 0, width: VP.width, height: 60, flexShrink: 0, backgroundColor: '#FF0000' },
        { id: 901, parentId: 0, width: VP.width, height: 60, flexShrink: 0, backgroundColor: '#00FF00' },
        { id: 902, parentId: 0, width: VP.width, height: 60, flexShrink: 0, backgroundColor: '#0000FF' },
        // 行 0（绑定目标，元素序 id=1）
        { id: 1, parentId: 0, width: VP.width, height: 60, flexShrink: 0, backgroundColor: rowColor(0) },
      ]
      for (let i = 1; i < ROWS; i++) {
        nodes.push({ id: 100 + i, parentId: 0, width: VP.width, height: 60, flexShrink: 0, backgroundColor: rowColor(i) })
      }
      const m = safeParseAny(proteusSelfDraw.mount(JSON.stringify({ viewport: VP, nodes })))
      if (m?.ok) {
        // 改行 0 高度 60→200（元素序 id=1）
        const keys = new PropKeyTable()
        const strings = new StringPool()
        const cap: Uint8Array[] = []
        const rt = new SlotRuntime(keys, strings, (b) => cap.push(b))
        rt.buffer.push({ op: 0x02, nodeId: 1, keyId: keys.intern('layout.height'), value: 200 })
        rt.flush()
        const b = cap.pop()
        const upd = b ? safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(b)))) : undefined
        const deferred = (upd?.deferred as number) ?? 0

        // ★★三段采样（本仓纪律：判据失败时先排除"判据自身有问题"）
        //   ① mount 后（无滚动、无更新）：行 i 在内容 [i*60, i*60+60) ⇒ 采样 y=30+60i
        //   ② 更新后（无滚动）：行 0 高 60→200，行 i≥1 移到 [140+i*60, ...)
        //   ③ 滚动后：内容整体上移
        // ★★色彩标定（本仓纪律：判据偏差时先做**标定实验**，而不是推断）
        //   取三行各一采样点（几何已确认顺序排列）⇒ 由「期望 vs 实得」反推变换：
        //   若 R/G/B 单调且可逆 ⇒ 色彩空间转换；若成对互换 ⇒ 字节序。
        const stageA = safeParseAny(
          proteusSelfDraw.samplePixels?.(JSON.stringify([0, 1, 2].map((i) => ({ x: 195, y: 30 + i * 60 })))) ?? '{}',
        )
        const stageApix: string[] = (stageA?.pixels as string[]) ?? []
        const stageAexp = [rowColor(0), rowColor(1), rowColor(2)]
        const calibOut = safeParseAny(
          proteusSelfDraw.samplePixels?.(JSON.stringify([
            { x: 195, y: 30 },
            { x: 195, y: 90 },
            { x: 195, y: 150 },
          ])) ?? '{}',
        )
        const calibration = {
          expect: ['#FF0000 (纯红)', '#00FF00 (纯绿)', '#0000FF (纯蓝)'],
          got: (calibOut?.pixels as string[]) ?? [],
        }
        // ★★标定必须**进判据**（本仓实测的判据设计缺陷）
        //
        // 【为什么单列一条】初版把标定**只记录、不断言**——而像素通道曾经 R/B 互换
        //   （实测：纯红读成 `#0000FF`，见 `samplePixels` 注释），却因为①判据用的行色
        //   `#xx2040` 只在**绿通道**变化（互换下不变）②标定不影响 verdict ⇒ 长期恒绿。
        //   ⇒ 纪律：**标定是判据的一部分**——标定不过，后面所有像素结论都不成立。
        const calibExpect = ['#FF0000', '#00FF00', '#0000FF']
        const calibGot = calibration.got.map((s) => String(s).toUpperCase())
        const calibOk = calibGot.length === 3 && calibGot.every((v, i) => v === calibExpect[i])

        // 滚到能看到**被延后**的那些行（预取半屏 ⇒ 内容 y > 1266 的行被延后）
        const SCROLL = 1540
        proteusSelfDraw.scrollBy?.(0, SCROLL)
        const flushed = (safeParseAny(proteusSelfDraw.pendingStats?.() ?? '{}').last_flushed as number) ?? 0

        // 采样：这几个屏幕 y 分别应命中哪一行（内容 y = SCROLL + 屏幕 y）
        //
        // ★★坐标推导（本仓实测：首版漏算标定块，整体偏 2 行）
        //   本用例的树里前 3 行是**色彩标定块**（纯红/纯绿/纯蓝），行 0 是第 4 行（元素序 id=1）。
        //   更新后布局（内容坐标）：
        //     · 标定块 3 行：y ∈ [0,180)
        //     · 行 0（改成高 200）：y ∈ [180, 380)
        //     · 行 i（i≥1）：y ∈ [380 + (i-1)*60, 380 + i*60)
        //   ⇒ 行 i 的起点 = 380 + (i-1)*60 = 320 + i*60
        //   ★首版公式写成 140 + i*60（漏了标定块 180 与行0 的额外高度）⇒ 采样点系统性偏 2 行。
        const CALIB_ROWS = 3
        const rowStart = (i: number): number => (i === 0 ? CALIB_ROWS * 60 : CALIB_ROWS * 60 + 200 + (i - 1) * 60)
        const probes: Array<{ y: number; row: number }> = []
        for (const row of [24, 28, 32, 36]) {
          const y = rowStart(row) - SCROLL + 20 // 行内偏 20px（避开边界）
          if (y > 0 && y < 800) probes.push({ y, row })
        }
        const sampleOut = safeParseAny(
          proteusSelfDraw.samplePixels?.(JSON.stringify(probes.map((p) => ({ x: 195, y: p.y })))) ?? '{}',
        )
        const pixels: string[] = (sampleOut?.pixels as string[]) ?? []
        const mismatches: string[] = []
        probes.forEach((p, i) => {
          const got = pixels[i] ?? 'n/a'
          const want = rowColor(p.row)
          if (got.toUpperCase() !== want.toUpperCase()) mismatches.push(`y=${p.y} 行${p.row}: 期望 ${want} 实得 ${got}`)
        })
        results.push({
          case: 'V5_pixel_after_scroll',
          note: '★★像素级验证：滚动后屏幕颜色序列必须与几何一致（几何对 ≠ 屏幕对）',
          items: ROWS, nodes: (m.node_count as number) ?? 0,
          vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0,
          total_ms: 0, patch_count: 0, request_bytes: 0,
          extra: {
            deferred,
            flushed_on_scroll: flushed,
            scroll: SCROLL,
            probes: probes.length,
            pixels,
            expected: probes.map((p) => rowColor(p.row)),
            mismatches,
            // ★三段采样（隔离"渲染本身坏" vs "滚动后坏"）
            stageA_after_mount: { pixels: stageApix, expected: stageAexp },
            // ★标定：纯红/纯绿/纯蓝三块（各自 y 段中心）
            calib: calibration,
            stageA_ok: stageApix.length === 3 && stageApix.every((v, i) => v.toUpperCase() === stageAexp[i]),
            calib_ok: calibOk,
            node_count: (m.node_count as number) ?? 0,
            // ★判据：**测量装置自检过关**（标定）+ 探针非空 + 补刷确实发生 + 颜色全对
            //   —— 标定不过时后面全绿也无意义（本仓实测：R/B 互换就是靠它才能被发现）
            verdict: calibOk && probes.length > 0 && flushed > 0 && mismatches.length === 0 ? 'PASS' : 'FAIL',
          },
        })
      }
    }

    // ★计时装置诊断（写进报告，避免下次又误读分位读数）
    results.push({
      case: 'V3_clock_diag',
      note:
        `计时装置：clock=${clockName} · 512 次连续读中 ${ticks} 次前进` +
        ` · 最小非零 delta=${minNonZero === Infinity ? '无（该时钟在紧密循环里不前进）' : minNonZero + 'ms'}` +
        ` ⇒ 若前进次数远小于 512，**分位读数不可信，请以 amortized_us 为准**`,
      items: 0, nodes: 0, vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0,
      patch_count: 0, request_bytes: 0,
      extra: { clock: clockName, ticks_in_512: ticks, min_nonzero_ms: minNonZero === Infinity ? null : minNonZero },
    })
  },
})

/* V6 · ★★全量 SFC → 端上渲染（V4 里程碑最后一项遗留） */
CASES.push({
  name: 'V6_sfc_full_tree',
  note: '★★全量 SFC → 模板实例化 → 真机挂载 → 行内更新（节点树由 SFC 生成，而非手写节点数组）',
  fn: async () => {
// ── ★★V6：**全量 SFC → 端上渲染**（V4 里程碑最后一项遗留）──
// ★本用例自带时钟（`clock` 是 V3 用例内的局部量，跨用例不可见——本仓实测踩到：
//   直接引用会报 `Can't find variable: clock`，且**整个用例静默零结果**）
const tclock = (): number => {
  const us = proteusSelfDraw.nowUs?.()
  if (typeof us === 'string') {
    const v = Number(us)
    if (Number.isFinite(v) && v > 0) return v / 1000
  }
  return Date.now()
}
//
// 【这条链此前断在哪（本仓实测）】V3/V4 的设备验证都用**手写节点数组**
//   （上方 largeNodes 一行行写死 id/parentId/style），编译器只产出订阅表
//   ⇒ "Vapor 能替代 Vue 运行时"缺最后一环证据：**节点树本身从未由 SFC 生成**。
//
// 【本用例验证什么】同一份 SFC 的两件编译产物（模板 + 订阅表）：
//   ① 模板实例化成节点树（v-for 展开、静态样式、文本占位）
//   ② 挂载到真机（宿主度量 + Rust 布局 + 建层）
//   ③ 改行数据 ⇒ 行内槽位发**普通 SET_STYLE/SET_TEXT**（注册表解析到实际行节点）
//   ⇒ 判据：树成型（层数/节点数）+ 指令命中 + 几何真的变了 + 无 unsupported
{
  const builtTpl = vaporTableJson as unknown as {
    ok: boolean
    table: import('@proteus-vue/slot-runtime').SubscriptionTable
    template: import('@proteus-vue/slot-runtime').LayoutTemplate
    templateDiagnostics: Array<{ severity: string; message: string }>
  }
  const tplOk = builtTpl.ok && builtTpl.template && builtTpl.template.nodes.length > 0
  if (!tplOk) {
    results.push({
      case: 'V6_sfc_full_tree',
      note: `✗ 模板产物不可用：${(builtTpl.templateDiagnostics ?? []).map((d) => d.message).join('; ').slice(0, 160)}`,
      items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
      total_ms: -1, patch_count: -1, request_bytes: -1,
    })
  } else {
    const tpl = builtTpl.template
    const table = builtTpl.table
    // ★行数据（3 行；与生成期 SFC 的数据形状一致：id / dotW / textW / title）
    let rows = [
      { id: 1, dotW: 36, textW: 120, title: '列表项 1' },
      { id: 2, dotW: 36, textW: 120, title: '列表项 2' },
      { id: 3, dotW: 36, textW: 120, title: '列表项 3' },
    ]
    const data: Record<string, unknown> = { list: rows }
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()

    // ① 实例化（模板 + 数据 → 引擎就绪树）
    const instT0 = tclock()
    const inst = instantiateTemplate(tpl, { viewport: VP, read, table, registry })
    const instantiateMs = tclock() - instT0

    // ② 首帧：**由实例化产物驱动**（含文本 → 宿主度量注入走既有通道）
    const mountOut = safeParseAny(proteusSelfDraw.mount(JSON.stringify({ viewport: VP, nodes: inst.nodes })))
    if (!mountOut?.ok) {
      results.push({
        case: 'V6_sfc_full_tree',
        note: `✗ 由 SFC 产物挂载失败：${JSON.stringify(mountOut)?.slice(0, 160)}`,
        items: 0, nodes: inst.nodes.length, vue_ms: -1, to_request_ms: -1, serialize_ms: -1,
        host_ms: -1, total_ms: -1, patch_count: -1, request_bytes: -1,
      })
    } else {
      // ③ 改第 2 行的圆点宽 + 第 3 行文案 ⇒ 行内槽位应发普通指令
      const keys = new PropKeyTable()
      const strings = new StringPool()
      const cap: Uint8Array[] = []
      const rt = new SlotRuntime(keys, strings, (b) => cap.push(b))
      const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), registry)
      const triggers = new Map<string, () => void>()
      let listRows = rows
      const ctx = { read: (n: string) => (n === 'list' ? listRows : read(n)) }
      const loadRes = vapor.load(ctx, (name, cb) => triggers.set(name, cb))
      vapor.relink(ctx)
      rt.flush()
      cap.length = 0  // 丢掉首帧

      listRows = [{ ...rows[0]! }, { ...rows[1]!, dotW: 60 }, { ...rows[2]!, title: '改过的第 3 行' }]
      triggers.get('list')?.()
      rt.flush()
      const bytes = cap.pop()
      const applyOut = bytes ? safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(bytes)))) : undefined

      // ④ 判据：指令命中 + 几何变化 + 无 unsupported
      const opsApplied = (applyOut?.patch_count as number) ?? 0
      const unsupported = (applyOut?.unsupported_count as number) ?? 0
      const geomChanged = (applyOut?.geom_changed as number) ?? 0
      // ★文本落层读数（本仓实测的静默错显示缺陷：核心变了、屏幕文字还是旧的——
      //   增量路径此前只改 frame，而文本在 CATextLayer.string 上。本轮改文案 1 处 ⇒ 两项都必须 ≥1）
      const textUpdates = (applyOut?.text_updates as number) ?? 0
      const textLayersApplied = (applyOut?.text_layers_applied as number) ?? 0
      const verdict =
        opsApplied >= 2 && unsupported === 0 && geomChanged >= 1 && (mountOut.layer_count as number) > 0
          && textUpdates >= 1 && textLayersApplied >= 1
          ? 'PASS' : 'FAIL'
      results.push({
        case: 'V6_sfc_full_tree',
        note: '★★全量 SFC → 模板实例化 → 挂载 → 行内更新（V4 最后一项遗留：节点树由 SFC 生成）',
        items: rows.length, nodes: inst.nodes.length,
        vue_ms: 0, to_request_ms: instantiateMs, serialize_ms: 0,
        host_ms: (applyOut?.host_total_ms as number) ?? 0, total_ms: instantiateMs,
        patch_count: rt.getStats().opsEmitted,
        request_bytes: (applyOut?.in_bytes as number) ?? 0,
        extra: {
          verdict,
          instantiate_ms: Math.round(instantiateMs * 100) / 100,
          template_nodes: tpl.nodes.length,
          template_lists: tpl.lists.length,
          instantiated_nodes: inst.nodes.length,
          id_stats: inst.stats,
          layer_count: mountOut.layer_count,
          mount_node_count: mountOut.node_count,
          ops_applied: opsApplied,
          ops_emitted: rt.getStats().opsEmitted,
          unsupported_count: unsupported,
          geom_changed: geomChanged,
          text_updates: textUpdates,
          text_layers_applied: textLayersApplied,
          l1_slots: loadRes.l1Slots, l0_slots: loadRes.l0Slots,
          uninstantiated: loadRes.uninstantiatedSlots.length,
          template_diags: builtTpl.templateDiagnostics.length,
          mem_mb: applyOut?.mem_mb,
        },
      })
    }
  }
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

/* S4 · 文本击穿：改 300 行文案（★2026-09-28：走文本补丁增量，与全量对照） */
CASES.push({
  name: 'S4_text_churn',
  note: '★文本击穿：改 300 行文案 —— 文本补丁增量 vs 全量重发（同用例 A/B）',
  fn: async () => {
    const N = 500
    const app = makeApp(N)
    mountApp(app, N)                    // ★必须：见 mountApp 注释

    /**
     * 跑一次「改 k 行文案」并记录四段分解
     *
     * @param viaPatch  true = 走 updatePatches（文本补丁增量）；false = 强制全量（对照）
     */
    const runOne = async (label: string, viaPatch: boolean) => {
      app.adapter.resetStats()
      // ★文案必须**每次都不同**，否则击不穿内容寻址的度量缓存（本仓实测：
      //   重复文案会命中缓存 ⇒ 读者会误以为"文本变更不贵"）
      const tag = `R${label}`
      const t0 = now()
      app.churnText(300, tag)
      await nextTick()
      const tVue = now()
      const patches = app.adapter.takePatches()
      let payload: unknown
      let mode = viaPatch ? 'patch' : 'FULL-by-design'
      if (patches === null) {
        mode = 'FULL-required'
        payload = app.adapter.toRequest(VP)
      } else if (viaPatch) {
        payload = patches
      } else {
        payload = app.adapter.toRequest(VP)   // 对照：同样改数据，但强制整树重发
        mode = 'FULL-by-design'
      }
      const tReq = now()
      const payloadJson = JSON.stringify(payload)
      const tSer = now()
      const bytes = payloadJson.length
      const hostOut = patches !== null && viaPatch
        ? proteusSelfDraw.updatePatches(payloadJson)
        : proteusSelfDraw.update(payloadJson)
      const tHost = now()
      const h = safeParseAny(hostOut)
      app.adapter.markFullSync()
      // ★形状：文本在 `style.text` 内（适配器/Rust/宿主三处同形状——见 Rust 的
      //   `text_field_must_be_inside_style` 测试；本仓实测顶层形状会被静默忽略）
      const textPatches = patches === null
        ? -1
        : patches.filter((x) => (x as { style?: { text?: string } }).style?.text !== undefined).length
      results.push({
        case: `S4_text_churn_${label}`,
        note: `改 300 行文案（${N} 项页面 · ${mode}）`,
        items: N, nodes: (h?.["node_count"] as number) ?? 0,
        vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tSer - tReq,
        host_ms: tHost - tSer, total_ms: tHost - t0,
        patch_count: app.adapter.patchCount(), request_bytes: bytes,
        extra: {
          mode, text_patches: textPatches,
          relayout: h?.["relayout_count"], scopes: h?.["scopes"],
          relayout_ms: h?.["relayout_ms"], idmap_ms: h?.["idmap_ms"], collect_ms: h?.["collect_ms"],
          // ★文本落层读数（本轮修的静默错显示缺陷：不落层 = 屏幕文字停留旧值）
          text_updates: h?.["text_updates"], text_layers_applied: h?.["text_layers_applied"],
          measures_injected: h?.["measures_injected"],
          // ★★设备侧不变量：**有文本补丁就必须有度量注入**（本仓实测的形状分叉：
          //   宿主曾找顶层 `text` ⇒ 注入 0 条 ⇒ 核心按旧尺寸算几何 ⇒ 字被裁且无报错）。
          //   注意：同文案可能命中度量缓存 ⇒ 允许 injected ≤ patches，但**不得为 0**
          //   （只要真的改了文案，就至少有一条新度量）。
          measure_invariant_ok: (() => {
            if (mode !== 'patch') return true
            const tp = patches === null ? 0 : patches.filter((x) => (x as { style?: { text?: string } }).style?.text !== undefined).length
            if (tp === 0) return true
            return ((h?.["measures_injected"] as number) ?? 0) > 0
          })(),
          measure_hits: h?.["measure_cache_hits"], measure_misses: h?.["measure_cache_misses"],
          updated_layers: h?.["updated_layers"],
        },
      })
      markCeiling('text_churn', `改 300 行文案（${mode}）`, tHost - t0, '文本变更（缓存未命中）')
    }
    // ★同用例 A/B：全量先跑（对照），再跑补丁增量
    await runOne('FULL', false)
    await runOne('patch', true)
    app.dispose()
  },
})

/* S5 · 结构变更：增删节点（★2026-09-28：走 splice 增量，与全量对照） */
CASES.push({
  name: 'S5_structure_change',
  note: '★结构变更：500→600 / 600→400 项（增删行）——splice 增量 vs 全量重建（同用例内对照）',
  fn: async () => {
    const N = 500
    const app = makeApp(N)
    mountApp(app, N)                    // ★必须：见 mountApp 注释
    // ★★fixture 修复（本仓实测：初版此用例**从未增删过一行**）
    //
    // 【故障链】`setCount(n)` 只改 `count/size` 两个 ref；而 render 里行集是
    //   `items.value.slice(0, Math.max(count, items.length))` —— `Math.max` 把 count 的
    //   **缩小**方向整条抹平（slice 上界永远 ≥ items.length ⇒ 恒定输出全部行）。
    //   实测证据：grow_600 与 shrink_400 两条结果的 `nodes` 都是 **3507**、字节都是 **279820**
    //   —— 即两次"结构变更"其实是**同一棵树的两次全量重发**，用例名与实际行为不符。
    //   ⇒ 正解：增删走 `setItems`（真正改行集），与 E 组（插入/删除）同款。
    const grow = (to: number) => {
      const cur = app.items()
      const add = to - cur.length
      if (add > 0) {
        const next = cur.slice()
        for (let i = 0; i < add; i++) {
          const id = cur.length + i
          next.push({ id, title: `列表项 ${id + 1}`, sub: id % 3 === 0 ? '分组标题' : '说明文字' })
        }
        app.setItems(next)
      } else if (add < 0) {
        app.setItems(cur.slice(0, to))
      }
    }
    /**
     * @param insertAt  仅 grow 且 >0 时生效：插到该位置（0 = 头部）而非追加
     */
    const runOne = async (label: string, newN: number, useSplice: boolean, insertAt = -1) => {
      app.adapter.resetStats()
      const t0 = now()
      if (insertAt >= 0 && newN > app.items().length) {
        // ★★**中间/头部插入**（2026-09-28 解禁；此前 splice 只能追加 ⇒ 这种形态必然全量）
        const cur = app.items()
        const add = newN - cur.length
        // ★新插入的行给**专用底色**（像素判据的区分力来源——本仓实测：
        //   若新行与既有行同色，采样点全同色 ⇒ 判据无区分力，等于没验）
        const fresh = Array.from({ length: add }, (_, i) => {
          const id = 100000 + i
          return { id, title: `新插入 ${i + 1}`, sub: '插在行首', tint: '#00FF00' }
        })
        app.setItems([...fresh, ...cur.slice(0, Math.max(0, insertAt)), ...cur.slice(Math.max(0, insertAt))])
      } else {
        grow(newN)
      }
      await nextTick()
      const tVue = now()
      // ── ① 适配器侧：取本批次的"该发什么"（不含序列化）──
      const patches = app.adapter.takePatches()
      let payload: unknown
      let mode = 'patch'
      if (patches === null) {
        const sp = app.adapter.takeSplice()
        const canSplice = useSplice && sp && sp !== 'full-required' && typeof proteusSelfDraw.splice === 'function'
        if (canSplice) {
          mode = 'splice'
          payload = sp
        } else {
          mode = sp === 'full-required'
            ? 'FULL-required'
            : (typeof proteusSelfDraw.splice === 'function' ? 'FULL-by-design' : 'FULL-no-entry')
          payload = app.adapter.toRequest(VP)
        }
      } else {
        payload = patches
      }
      const tReq = now()
      // ── ② 序列化（独立打点——本仓实测的测量装置缺陷：初版 serialize_ms 与 host_ms
      //       是同一个数，导致"搬运成本"无法归因到 JS 侧还是宿主侧）──
      const payloadJson = JSON.stringify(payload)
      const tSer = now()
      const bytes = payloadJson.length
      // ── ③ 宿主（splice 优先；失败时如实记 mode，不掩盖）──
      let hostOut: string
      if (mode === 'splice') {
        hostOut = proteusSelfDraw.splice!(payloadJson)
        if (!safeParseAny(hostOut)?.ok) mode = 'FULL-splice-failed'
      } else if (mode === 'patch') {
        hostOut = proteusSelfDraw.updatePatches(payloadJson)
      } else {
        hostOut = proteusSelfDraw.update(payloadJson)
      }
      const tHost = now()
      const h = safeParseAny(hostOut)
      app.adapter.markFullSync()
      // ★★中间插入的**像素判据**（本仓纪律：几何对 ≠ 屏幕对）
      //   【为什么单列】层序（CALayer 子层顺序 = 绘制顺序）若与核心的 children 序不符，
      //   **几何断言全绿**而重叠/行序在屏幕上错。
      //
      // ★★头部插入的**像素判据**（本仓纪律：几何对 ≠ 屏幕对；层序错只有像素能发现）
      //
      // 【为什么用"固定屏幕坐标扫描"而不是"从 rects 推坐标"（本仓实测的三次弯路）】
      //   ① 手算行 y ⇒ 算出 6524（远超屏高 844）⇒ out-of-bounds；
      //   ② 从宿主回传的 rects 推 ⇒ `rects_count: 0`（**splice 的返回体没有 rects 字段**）。
      //   ⇒ 正解：**不依赖任何新增读数**——头部插入后，插入区必然占据首屏的固定屏幕区域
      //     （标题区之下、第一屏之内）。⇒ 直接扫描那一片的**若干固定点**，判据是
      //     "这些点的颜色 = 新行底色"（全量与 splice 两次运行**结果必须一致**）。
      let pixelCheck: Record<string, unknown> | undefined
      const ex2ChildOrder = (h?.["child_order_checked"] as number) ?? -1
      const ex2ChildOrderMismatch = (h?.["child_order_mismatches"] as string[]) ?? []
      const ex2ChildOrderApplied = (h?.["child_order_applied"] as number) ?? -1
      const ex2ChildOrderMissing = (h?.["child_order_missing"] as string[]) ?? []
      if (label.startsWith('head_insert') || label.startsWith('mid_insert')) {
        // 首屏扫描：x 取行内三点（避开圆点与文字），y 取标题区之下的连续 6 点
        //   （行高 56 + margin 8 = 64 ⇒ 6 点覆盖约 4 行，足以落在插入区内）
        const xs = [120, 195, 300]
        const ys = [200, 220, 264, 284, 328, 348]
        const pts: Array<{ x: number; y: number }> = []
        for (const y of ys) for (const x of xs) pts.push({ x, y })
        const got = safeParseAny(
          proteusSelfDraw.samplePixels?.(JSON.stringify(pts)) ?? '{}',
        )
        const pixels: string[] = (got?.pixels as string[]) ?? []
        const green = pixels.filter((c) => c.toUpperCase() === '#00FF00').length
        const dark = pixels.filter((c) => c.toUpperCase() === '#1B1B21').length
        pixelCheck = {
          // ★层序对账读数（比像素更直接：像素证明不了层序——本仓实测的判据缺口）

          probes: pts.length,
          pixels,
          green, dark,
          // ★判据：头部插入区在首屏 ⇒ 应看到**新行底色（绿）为主**
          //   （全量档的 tint 同样生效 ⇒ 两档结果应一致）
          verdict: green > 0 ? 'insert-area-visible' : 'no-insert-area',
          // ★★**诚实标注判据强度（本仓实测的破坏性验证结果）**：
          //   把宿主 `insertLayers` 退化为"恒追加"后，本判据**仍然全绿** ⇒
          //   它**证明不了"层序正确"**，只证明"**几何位置正确**"（因为位置由核心算，
          //   宿主只是把层放到父层里；行与行不重叠 ⇒ 层序差异在屏幕上不可见）。
          //   ⇒ 要验层序需要**重叠/半透明**场景（或直接读 `childrenById` 与核心 children 对账）；
          //     当前把它如实标注为"几何位置判据"，不冒充层序判据。
          strength: 'geometry-position-only（层序需重叠场景才能验——见注释）',
        }
      }
      results.push({
        case: `S5_${label}`,
        note: `${N}→${newN} 项（${mode}）`,
        items: newN, nodes: h?.["node_count"] ?? 0,
        vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tSer - tReq,
        host_ms: tHost - tSer, total_ms: tHost - t0,
        patch_count: app.adapter.patchCount(), request_bytes: bytes,
        extra: { mode, mem_mb: h?.["mem_mb"], mem_peak_mb: h?.["mem_peak_mb"],
                 relayout: h?.["relayout_count"], updated_layers: h?.["updated_layers"],
                 removed: h?.["removed"], inserted: h?.["inserted"],
                 removed_layers: h?.["removed_layers"], inserted_layers: h?.["inserted_layers"],
                 // ★内存回收读数（孤点压实）
                 compacted: h?.["compacted"], orphans: h?.["orphans"],
                 // ★★**层序判据（对真实 CALayer 子层序）**——以核心 `child_order` 为单一事实来源
                 //   【为什么是判据不是诊断】此前宿主自行按 parentId 归类 ⇒ 与核心分叉
                 //   （实测差异@51）；现已由 `applyChildOrder` 按核心重建层序。
                 //   判据 = 有对账 + 无缺层 + 无差异。
                 child_order: {
                   applied: h?.["child_order_applied"] ?? -1,
                   checked: h?.["child_order_checked"] ?? -1,
                   missing: h?.["child_order_missing"] ?? [],
                   mismatches: h?.["child_order_mismatches"] ?? [],
                   verdict: (() => {
                     const ap = h?.["child_order_applied"] as number | undefined
                     const ck = h?.["child_order_checked"] as number | undefined
                     const mi = (h?.["child_order_missing"] as unknown[] | undefined) ?? []
                     const mm = (h?.["child_order_mismatches"] as unknown[] | undefined) ?? []
                     if (ap === undefined) return 'n/a'   // 非 splice 档
                     return ap > 0 && (ck ?? 0) > 0 && mi.length === 0 && mm.length === 0 ? 'PASS' : 'FAIL'
                   })(),
                 },
                 layer_count: h?.["layer_count"],
                 pixel_check: pixelCheck,
                 // ★核心分段（splice 的 relayout_ms 决定"省下的到底是搬运还是重排"）
                 relayout_ms: h?.["relayout_ms"], splice_ms: h?.["splice_ms"],
                 layout_ms: h?.["layout_ms"], host_total_ms: h?.["host_total_ms"],
                 // ★插入文本的度量自检（设备侧不变量：高≈0 的文本层必须为 0 条）
                 inserted_text_layers: h?.["inserted_text_layers"],
                 inserted_text_zero_height: h?.["inserted_text_zero_height"],
                 inserted_text_missing_geom: h?.["inserted_text_missing_geom"] },
      })
      markCeiling('structure', `${N}→${newN} 项（${mode}）`, tHost - t0, `结构变更（${mode}）`)
    }
    // ★★A/B 必须**同起点、同幅度**（本仓纪律：优化前后的对照只能差被测变量）
    //   全量对先跑（把树带回 500）→ splice 对再跑，两边都是 500↔600 的 ±100。
    await runOne('grow_600_FULL', 600, false)
    await runOne('shrink_500_FULL', 500, false)
    await runOne('grow_600_splice', 600, true)
    await runOne('shrink_500_splice', 500, true)
    // ★★**头部插入**档（2026-09-28 解禁；此前 splice 只能追加 ⇒ 这形态必然全量）
    //   ★为什么选头部而**不是**第 100 行：头部既是最常见的真实交互（聊天/信息流"加载新消息"），
    //     也让插入区**天然落在首屏内** ⇒ 像素判据（验证行序/层序）才能真正执行
    //     （插在第 100 行时采样点必然在屏幕外 ⇒ 只能给 INCONCLUSIVE，等于没验）。
    await runOne('head_insert_FULL', 550, false, 0)
    await runOne('head_insert_splice', 600, true, 0)

    // ★★**反复增删（内存回收的真机判据）**：10 轮「插 50 行 / 删 50 行」
    //
    // 【为什么单列】孤点压实的**触发条件是"累计"的**（孤点 ≥ 64 且 > 存活一半）
    //   ⇒ 单轮增删（如 grow/shrink 档）不会触发 ⇒ 必须有**多轮累积**的场景才能观测到。
    //   本档同时验证两件事：① 节点数**有界**（不随轮数线性增长）② 压实后**几何仍正确**
    //   （`updated_layers` / 变化集与预期一致，且后续轮次的读数不劣化）。
    {
      const baseLen = app.items().length
      const cycle = 50
      const rounds = 10
      let totalCompacted: Array<unknown> = []
      let lastOrphans: unknown = null
      let maxNodes = 0
      const tChurn0 = now()
      for (let r = 0; r < rounds; r++) {
        // 插 50 行（插在第 1 位，避开头部像素区域；用独立 id 段避免与既有重复）
        const fresh = Array.from({ length: cycle }, (_, i) => {
          const id = 500000 + r * 1000 + i
          return { id, title: `churn ${r}-${i}`, sub: 'churn' }
        })
        const cur = app.items()
        app.setItems([cur[0]!, ...fresh, ...cur.slice(1)])
        await nextTick()
        const spIns = app.adapter.takeSplice()
        let insOut: Record<string, unknown> | undefined
        if (spIns && spIns !== 'full-required' && typeof proteusSelfDraw.splice === 'function') {
          insOut = safeParseAny(proteusSelfDraw.splice(JSON.stringify(spIns)))
        } else {
          insOut = safeParseAny(proteusSelfDraw.update(JSON.stringify(app.adapter.toRequest(VP))))
        }
        app.adapter.markFullSync()
        // 删掉刚插的 50 行
        const after = app.items()
        app.setItems(after.filter((it) => !fresh.some((f) => f.id === it.id)))
        await nextTick()
        const spRm = app.adapter.takeSplice()
        let rmOut: Record<string, unknown> | undefined
        if (spRm && spRm !== 'full-required' && typeof proteusSelfDraw.splice === 'function') {
          rmOut = safeParseAny(proteusSelfDraw.splice(JSON.stringify(spRm)))
        } else {
          rmOut = safeParseAny(proteusSelfDraw.update(JSON.stringify(app.adapter.toRequest(VP))))
        }
        app.adapter.markFullSync()
        const n = (rmOut?.["core_node_count"] as number) ?? 0
        maxNodes = Math.max(maxNodes, (insOut?.["core_node_count"] as number) ?? 0, n)
        lastOrphans = rmOut?.["orphans"]
        if (rmOut?.["compacted"] && !(rmOut?.["compacted"] === null)) totalCompacted.push(rmOut["compacted"])
      }
      const tChurn = now() - tChurn0
      app.setItems(app.items().slice(0, baseLen))
      await nextTick()
      app.adapter.markFullSync()
      results.push({
        case: 'S5_churn_cycles',
        note: `${rounds} 轮「插 ${cycle} 行 / 删 ${cycle} 行」（内存回收：孤点压实）`,
        items: baseLen, nodes: maxNodes,
        vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: tChurn, total_ms: tChurn,
        patch_count: app.adapter.patchCount(), request_bytes: 0,
        extra: {
          rounds, cycle,
          // ★判据一：节点数**有界**（累计插 10×50 行 = 3500 孤点；若不回收会线性增长）
          max_node_count: maxNodes,
          // ★判据二：压实**真的发生了**（读数非空）
          compacted_events: totalCompacted,
          last_orphans: lastOrphans,
          verdict:
            totalCompacted.length > 0 && maxNodes < baseLen * 7 + 1500 ? 'PASS' : 'FAIL',
        },
      })
    }
    app.dispose()
  },
})

/* V9 · ★★端到端事件：触摸 → 核心命中 → JS 派发（此前这条链从未接线） */
CASES.push({
  name: 'V9_event_dispatch',
  note: '★★事件端到端：注入 tap（内容坐标）→ 核心命中测试（target+冒泡链）→ 适配器派发到 Vue 处理器',
  fn: async () => {
    const N = 100
    const app = makeApp(N)
    mountApp(app, N)
    const log = (globalThis as unknown as { __proteusTapLog?: Array<Record<string, unknown>> }).__proteusTapLog
    if (log) log.length = 0

    // ★行 = height:56 的节点（可靠特征；本仓纪律：不猜数组下标）
    const nodes = app.adapter.toRequest(VP).nodes as Array<{ id: number; parentId: number | null; height?: number }>
    const rowIds = nodes.filter((n) => n.height === 56).map((n) => n.id)

    // 注入 3 次 tap（打在**第 1/2/3 行**的垂直中心）
    //
    // ★坐标推导（本仓实测的第三次手算错误，这次改为**从实测反推**）：
    //   首版用 `60 + i*64 + 28`（假设首行从 padding.top=60 起）⇒ 第一次打在 **y=88 命中标题**（id=5）
    //   —— 因为标题（fontSize 28 + margin.bottom 4）占掉了 60~88 这一段。
    //   实测：y=152 命中第 1 行（id=6）⇒ 首行区间约 [88, 144)，步长 64。
    //   ⇒ 用 `88 + i*64 + 28`（首行起点 88 + 行内 28 = 垂直中心）。
    //   ★纪律：坐标不手算——用**一次探针 tap** 反推出首行起点（见下方 probe 步骤）。
    // ★★第四次修正（2026-10-02）：**行序基准由探针校准**——不再假设"y=152 命中第 1 行"。
    //   树结构演进会让同一 y 命中不同行（9/28：152 → rowIds[0]；本轮：152 → rowIds[1]），
    //   而硬编码 `rowIds[0..]` 的判据**必然**随结构变化失败。
    //   校准法：探针发一发 ⇒ 读回它的 currentTarget ⇒ 在 rowIds 里取下标记为基准 idx。
    const probeY = 152
    if (log) log.length = 0
    safeParseAny(proteusSelfDraw.tapAt?.(120, probeY) ?? '{}')
    const probeLog = (log ?? []).slice()
    const baseIdx = probeLog.length > 0 ? rowIds.indexOf(probeLog[0]!.id as number) : -1
    const taps = [0, 1, 2].map((i) => ({ x: 120, y: probeY + i * 64 }))
    const outs: unknown[] = []
    if (log) log.length = 0   // ★清掉探针那一次（只统计正式 3 次）
    for (const t of taps) outs.push(safeParseAny(proteusSelfDraw.tapAt?.(t.x, t.y) ?? '{}'))
    // ★派发是**同步**的（宿主经 JSContext 直呼）⇒ 无需 nextTick
    const got = (log ?? []).map((e) => ({ ...e }))

    const stats = safeParseAny(proteusSelfDraw.gestureStatsJson?.() ?? '{}')
    const hits = (stats?.stats?.hits as number) ?? 0
    const checks = {
      hitsOk: hits >= 3,
      countOk: got.length === 3,
      // ★★判据修正（2026-10-02）：**用 `currentTarget`（log 的 `id` 字段）对齐行序**——
      //   DOM 语义：`currentTarget` 才是 handler 绑定的节点（= 行）；`target` 是**命中的最深节点**
      //   （行内 p-text——取决于 x 落点，是深节点还是行盒）。
      //   【为什么改】旧判据用 `target`：当时（9/28）命中点恰是行盒 ⇒ 巧合通过；
      //   而命中语义/树结构一演进（x=120 现落在行内文本上）⇒ 旧判据必然失败——
      //   在 V16 首跑实测暴露（target=19/26 = 行内 text2，而行的 handler 正确收到）。
      //   ⇒ 修正后语义更正确：**"事件到达哪一行"由 currentTarget 判定**；target 作为附加证据记录。
      // ★判据用**校准后的基准**（baseIdx 由探针给出——见上方注释）
      targetOk: got.length === 3 && baseIdx >= 0 && got.every((g, i) => g.id === rowIds[baseIdx + i]),
      // 附加：命中的**深节点**应与 handler 节点不同（证明"深入命中 + 冒泡到行"两件事都真发生）
      deepHitOk: got.length === 3 && got.every((g) => typeof g.target === 'number' && g.target > 0),
      coordOk: got.length === 3 && got.every((g, i) => g.x === taps[i]!.x && g.y === taps[i]!.y),
    }
    const verdict = checks.hitsOk && checks.countOk && checks.targetOk && checks.deepHitOk && checks.coordOk ? 'PASS' : 'FAIL'
    results.push({
      case: 'V9_event_dispatch',
      note: `注入 3 次 tap（第 1–3 行）· 宿主命中 ${hits} 次 · JS 收到 ${got.length} 次`,
      items: N, nodes: nodes.length,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0,
      patch_count: 0, request_bytes: 0,
      extra: {
        verdict, taps, outs, host_hits: hits, js_received: got.length,
        tap_log: got, row_ids_sample: rowIds.slice(0, 5), checks,
        probe: { y: probeY, base_idx: baseIdx, base_row_id: baseIdx >= 0 ? rowIds[baseIdx] : -1 },
        // ★诚实边界：本入口**绕过 UITouch**（复用 emitGesture）⇒ 覆盖「核心命中 → 外壳派发」两环；
        //   「UITouch → 内容坐标换算 + tap 时序判定」需人手/XCUITest（见 selfdraw-scene.swift 的 tapAt 注释）
        covered: 'core-hit + shell-dispatch',
        not_covered: 'UITouch->content-coord + tap-timing',
      },
    })
    app.dispose()
  },
})

/* V16 · ★★多手势分流：tap 与 longpress 各自直达、**零串扰**（负向判据，对齐 Android）
 *   ★编号避让（本仓纪律：编号是稳定引用——撞号会污染历史产物）：
 *     `V10` 已被 `V10_paint_channel` 占用 ⇒ 本条取 V16（现有最大 V15）。 */
CASES.push({
  name: 'V16_gesture_split',
  note: '★★手势分流：注入 2 tap + 2 longpress ⇒ 各行处理器**恰好**收到对应类型（互不混入；对齐 Android 的 longpress/fling 负向计数纪律）',
  fn: async () => {
    const N = 100
    const app = makeApp(N)
    mountApp(app, N)
    const log = (globalThis as unknown as { __proteusTapLog?: Array<Record<string, unknown>> }).__proteusTapLog

    // 行序基准由**探针校准**（与 V9 同法——见其注释的"第四次修正"）
    const nodes = app.adapter.toRequest(VP).nodes as Array<{ id: number; parentId: number | null; height?: number }>
    const rowIds = nodes.filter((n) => n.height === 56).map((n) => n.id)
    const probeY = 152
    if (log) log.length = 0
    safeParseAny(proteusSelfDraw.tapAt?.(120, probeY) ?? '{}')
    const probeLog = (log ?? []).slice()
    const baseIdx = probeLog.length > 0 ? rowIds.indexOf(probeLog[0]!.id as number) : -1
    if (log) log.length = 0   // 清探针那一次

    // ① 2 次 tap（基准行起）+ 2 次 longpress（其后两行）
    const tapYs = [probeY, probeY + 64]
    const lpYs = [probeY + 128, probeY + 192]
    for (const y of tapYs) safeParseAny(proteusSelfDraw.tapAt?.(120, y) ?? '{}')
    for (const y of lpYs) safeParseAny(proteusSelfDraw.longpressAt?.(120, y) ?? '{}')

    const got = (log ?? []).map((e) => ({ ...e }))
    const taps = got.filter((g) => g.title === 'row-tap')
    const lps = got.filter((g) => g.title === 'row-longpress')

    // ★负向判据（比"有没有"更强）：**恰好** 2/2、无串扰、target 与行号一一对应
    // ★★与 V9 同款修正（2026-10-02）：**用 currentTarget（`id`）对齐行序**——
    //   target 是命中的最深节点（行内 p-text），不是 handler 节点（行）。
    const checks = {
      tapCountOk: taps.length === 2,
      lpCountOk: lps.length === 2,
      totalOk: got.length === 4,                       // ★零串扰（多一条即某侧误报）
      tapTargetsOk: baseIdx >= 0 && taps.length === 2 && taps.every((t, i) => t.id === rowIds[baseIdx + i]),
      lpTargetsOk: baseIdx >= 0 && lps.length === 2 && lps.every((t, i) => t.id === rowIds[baseIdx + 2 + i]),
      coordOk: taps.every((t, i) => t.y === tapYs[i] && t.x === 120)
        && lps.every((t, i) => t.y === lpYs[i] && t.x === 120),
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
    results.push({
      case: 'V16_gesture_split',
      note: `2 tap + 2 longpress ⇒ tap ${taps.length} / longpress ${lps.length}（恰好各 2、零串扰）`,
      items: N, nodes: nodes.length,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0,
      patch_count: 0, request_bytes: 0,
      extra: {
        verdict, checks,
        tap_current_targets: taps.map((t) => t.id), lp_current_targets: lps.map((t) => t.id),
        tap_deep_hits: taps.map((t) => t.target), lp_deep_hits: lps.map((t) => t.target),
        base_idx: baseIdx, base_row_id: baseIdx >= 0 ? rowIds[baseIdx] : -1,
        expected_rows: baseIdx >= 0 ? rowIds.slice(baseIdx, baseIdx + 4) : rowIds.slice(0, 4),
        got_length: got.length,
        full_log: got,
        // ★诚实边界：与 V9 相同——注入绕过 UITouch；「真实触摸按 500ms 时长分流」
        //   由 touchesEnded 的三分支实现（tap ≤0.5s / longpress ≥0.5s / 拖动不派发），
        //   需人手或 XCUITest 覆盖。
        covered: 'core-hit + shell-dispatch + type-routing',
        not_covered: 'UITouch->duration-classification',
      },
    })
    app.dispose()
  },
})

/* V17 · ★★矩阵 #7：swipe 方向分流（4 方向注入 ⇒ 恰好 4 条、方向一一对应、零串扰） */
CASES.push({
  name: 'V17_swipe_directions',
  note: '★★swipe 四方向：注入 up/down/left/right ⇒ 各方向处理器**恰好**收到对应条目（零串扰；补齐 iOS "swipe/fling 待补"）',
  fn: async () => {
    const N = 100
    const app = makeApp(N)
    mountApp(app, N)
    const log = (globalThis as unknown as { __proteusTapLog?: Array<Record<string, unknown>> }).__proteusTapLog

    // 行序基准由探针校准（与 V9/V16 同法）
    const nodes = app.adapter.toRequest(VP).nodes as Array<{ id: number; parentId: number | null; height?: number }>
    const rowIds = nodes.filter((n) => n.height === 56).map((n) => n.id)
    const probeY = 152
    const DIRS = ['up', 'down', 'left', 'right'] as const

    if (log) log.length = 0
    // 4 次注入（同一行坐标；方向在参数里声明——注入入口语义见 Swift `swipeAt` 的诚实边界）
    for (let i = 0; i < DIRS.length; i++) {
      const d = DIRS[i]!
      const dx = d === 'left' ? -200 : d === 'right' ? 200 : 0
      const dy = d === 'up' ? -200 : d === 'down' ? 200 : 0
      const y = probeY + i * 64
      safeParseAny((proteusSelfDraw as unknown as { swipeAt?: (x: number, y: number, dx: number, dy: number) => string })
        .swipeAt?.(120, y, dx, dy) ?? '{}')
    }

    const got = (log ?? []).map((e) => ({ ...e }))
    const swipes = got.filter((g) => String(g.title).startsWith('row-swipe-'))
    // ★负向判据（比"有没有"更强）：**恰好 4 条**、每方向恰好 1 条、零串扰（无 tap/longpress 混入）
    const byDir = (d: string): Array<Record<string, unknown>> => swipes.filter((g) => g.title === 'row-swipe-' + d)
    // ★★行序基准修正（首轮实测 FAIL 抓出）：`rowIds` 里含**表头行**（h=56 的不止列表行），
    //   而注入落在列表第 1..4 行 ⇒ 用 rowIds[i] 对齐必然错位（实测命中 [15,22,29,36] vs
    //   rowIds 前四项 [6,15,22,29]）。与 V16 的"探针校准"同教训：**行序基准要由探针标定**。
    //   此处用**第 1 条 swipe 的命中 id** 作基准，再断言后续 3 条是其后**连续三行**。
    const base = swipes.length > 0 ? Number(swipes[0]!.id) : -1
    const baseIdx = base >= 0 ? rowIds.indexOf(base) : -1
    const expected = baseIdx >= 0 ? [rowIds[baseIdx], rowIds[baseIdx + 1], rowIds[baseIdx + 2], rowIds[baseIdx + 3]] : []
    const checks = {
      countOk: swipes.length === 4,
      totalOk: got.length === 4,                        // ★零串扰（多一条即某侧误报）
      eachDirectionOnce: DIRS.every((d) => byDir(d).length === 1),
      targetsMatchRows: baseIdx >= 0 && swipes.every((t, i) => t.id === expected[i]),
      coordOk: swipes.every((t, i) => t.x === 120 && t.y === probeY + i * 64),
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
    results.push({
      case: 'V17_swipe_directions',
      note: `4 方向 swipe ⇒ 收到 ${swipes.length} 条（恰好 4、零串扰）`,
      items: N, nodes: nodes.length,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0,
      patch_count: 0, request_bytes: 0,
      extra: {
        verdict, checks,
        swipe_titles: swipes.map((g) => g.title),
        swipe_targets: swipes.map((g) => g.id),
        base_idx: baseIdx, expected_rows: expected, base_row_id: base,
        got_length: got.length,
        full_log: got,
        // ★诚实边界：与 V9/V16 同——注入绕过 UITouch 时序；**真实触摸的速度分流**由
        //   SelfDrawView.touchesEnded 三分支承担（大位移 + 速度 ≥0.3px/ms ⇒ `swipe:<dir>`），
        //   需人手或 XCUITest 做端到端覆盖。
        covered: 'core-hit + shell-dispatch + swipe-direction-routing',
        not_covered: 'UITouch->velocity-classification (real finger)',
      },
    })
    app.dispose()
  },
})

/* V10 · ★★绘制通道 + 字重：颜色/圆角/字重变更 → 层上生效（不经核心） */
CASES.push({
  name: 'V10_paint_channel',
  note: '★★绘制补丁通道（颜色/圆角/字重/字号/透明度）+ 字重端到端（此前这些变更无任何通道）',
  fn: async () => {
    const N = 30
    const app = makeApp(N)
    mountApp(app, N)

    // ★找一个**已知几何**的靶子：取首行卡片（height:56 的节点）与其背景色
    const nodes = app.adapter.toRequest(VP).nodes as Array<{ id: number; height?: number }>
    const rowId = nodes.find((n) => n.height === 56)?.id ?? -1

    // ① 通过**适配器**改绘制属性（颜色/圆角）——走真实 Vue 路径
    app.setRowTint(0, '#00FF00')   // 见 bench-app 新增
    await nextTick()

    // ② 取两条通道：布局补丁（应为空——颜色不改几何）与绘制补丁（应有 1 条）
    const layoutPatches = app.adapter.takePatches()
    const paintPatches = (app.adapter as unknown as {
      takePaintPatches(): Array<{ id: number; paint: Record<string, unknown> }>
    }).takePaintPatches()

    // ③ 发给宿主（paint 通道；不经核心）
    const out = paintPatches.length > 0
      ? safeParseAny(proteusSelfDraw.paintPatches?.(JSON.stringify(paintPatches)) ?? '{}')
      : undefined

    // ④ 像素验证：新行区域应变绿（★这是"屏幕上真的改了"的硬证据）
    //   首行 y：与 V9 同法——先用 tap 探针确定首行位置，再采样其中心
    const probe = safeParseAny(proteusSelfDraw.tapAt?.(120, 152) ?? '{}')
    const firstRowY = (probe?.target as number) >= 0 ? 152 : 88
    const px = safeParseAny(
      proteusSelfDraw.samplePixels?.(JSON.stringify([{ x: 120, y: firstRowY }])) ?? '{}',
    )
    const got: string = (px?.pixels as string[])?.[0] ?? ''

    const checks = {
      // ★颜色不改几何 ⇒ 布局补丁必须为空（否则是把绘制送进了核心——多余）
      layoutEmpty: Array.isArray(layoutPatches) && layoutPatches.length === 0,
      // ★paint 通道必须有该节点
      paintHasRow: paintPatches.some((p) => p.id === rowId),
      // ★宿主应用了
      hostApplied: ((out?.paint_layers_applied as number) ?? 0) > 0,
      // ★像素变绿（屏幕上真的改了）
      pixelGreen: got.toUpperCase() === '#00FF00',
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
    results.push({
      case: 'V10_paint_channel',
      note: `绘制通道：改行底色 → paint ${paintPatches.length} 条 · 宿主应用 ${out?.paint_layers_applied ?? 0} 层 · 像素 ${got}`,
      items: N, nodes: nodes.length,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: (out?.paint_ms as number) ?? 0, total_ms: 0,
      patch_count: app.adapter.patchCount(), request_bytes: JSON.stringify(paintPatches).length,
      extra: {
        verdict, checks, row_id: rowId, first_row_y: firstRowY,
        layout_patches: Array.isArray(layoutPatches) ? layoutPatches.length : 'null',
        paint_patches: paintPatches.length,
        host_out: out, pixel: got,
        // ★诚实边界：本档验证的是"paint 通道能把绘制改动送到层上"；
        //   字重的**度量**正确性由 Rust/TS 单测覆盖（不同字重不同 textStyleKey）
        covered: 'adapter→host paint channel + pixel',
        not_covered: 'fontWeight 度量差异的像素级比对（需两支字体渲染同一文本对照）',
      },
    })
    app.dispose()
  },
})

/* V11 · ★★真实长列表：1000 行 SFC 产物 → 实例化 → 挂载 → 行内更新（ListRegistry 真机驱动） */
CASES.push({
  name: 'V11_long_list',
  note: '★★真实长列表（1000 行）：SFC 模板实例化 + ListRegistry 行内解析 → 更新第 N 行只发 1 条指令',
  fn: async () => {
    const builtTpl = vaporTableJson as unknown as {
      ok: boolean
      table: import('@proteus-vue/slot-runtime').SubscriptionTable
      template: import('@proteus-vue/slot-runtime').LayoutTemplate
    }
    if (!builtTpl.ok || !builtTpl.template) {
      results.push({ case: 'V11_long_list', note: '✗ 模板产物不可用', items: 0, nodes: 0,
        vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1, total_ms: -1, patch_count: -1, request_bytes: -1 })
      return
    }
    const tpl = builtTpl.template
    const table = builtTpl.table
    const ROWS = 1000
    let rows = Array.from({ length: ROWS }, (_, i) => ({
      id: i + 1, dotW: 36, textW: 120, title: `行 ${i + 1}`,
    }))
    const data: Record<string, unknown> = { list: rows }
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()

    // ① 实例化（模板 + 1000 行 → 节点树）
    const tInst0 = now()
    const inst = instantiateTemplate(tpl, { viewport: VP, read, table, registry })
    const instantiateMs = now() - tInst0

    // ② 挂载（宿主度量 + 核心布局 + 建层）
    const tMount0 = now()
    const mountOut = safeParseAny(proteusSelfDraw.mount(JSON.stringify({ viewport: VP, nodes: inst.nodes })))
    const mountMs = now() - tMount0

    // ③ 行内更新：改**第 500 行**的圆点宽（应只发 1 条 SET_STYLE，命中该行节点）
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const cap: Uint8Array[] = []
    const rt = new SlotRuntime(keys, strings, (b) => cap.push(b))
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), registry)
    const triggers = new Map<string, () => void>()
    let listRows = rows
    const ctx = { read: (n: string) => (n === 'list' ? listRows : read(n)) }
    const loadRes = vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)
    rt.flush()
    cap.length = 0

    // 改第 500 行（只动一行 ⇒ 应只发 1 条指令）
    const nextRows = listRows.map((r, i) => (i === 499 ? { ...r, dotW: 60 } : r))
    listRows = nextRows
    data.list = nextRows
    triggers.get('list')?.()
    rt.flush()
    const bytes = cap.pop()
    const applyOut = bytes ? safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(bytes)))) : undefined

    // ══ ★★④ 单节点更新**延迟**测量（2026-09-29 补）════════════════════════════
    //
    // 【为什么必须补（本仓实测的用例失效）】§10 的核心指标是「单节点更新 P95 ≤ 3ms」，
    //   而它长期引用的 `类A 0.36ms` 出自 **V3 runScale** —— 该用例**自 V4 起一直在测空循环**
    //   （订阅表升级后树未同步 ⇒ 触发器失配 ⇒ 零指令；见 flush 判据那次发现）。
    //   ⇒ §10 的核心指标**失去了有效证据**。本档（V11）是**真实**的单行更新路径
    //     （1000 行实例化树 + ListRegistry 行内解析 + 改 1 行发 1 条指令），
    //     故在此补**延迟分位**，把 §10 的核心指标重新建立在有效用例上。
    //
    // 【判据设计】① 用**宿主高分辨率时钟**（`Date.now()` 在本平台是粗粒度缓存时钟，不可信）；
    //   ② 分离 **JS vs 宿主**（否则会把"JS 扫行"误读成"宿主慢"——本仓纪律：>5ms 必拆）；
    //   ③ 每次都是**真实变更**（dotW 在 36/60 间交替；否则 `Object.is` 短路而不发指令）；
    //   ④ 配 flush 判据（N 次更新 ⇒ flushes 增量 = N）——防"空跑也报快"。
    const { clock: latClock, name: latClockName, trustworthy: latClockOk } = pickClock()
    // ★★测量装置自检（本仓纪律 #1：**装置本身必须先被验证**）——
    //   宿主时钟 `nowUs()` 是一次 **JSExport 跨边界调用**；若它本身耗时可观，
    //   那么"每轮读 4 次时钟"的分段计时就把**装置开销**算进了被测代码。
    //   ⇒ 先量一次时钟调用成本，并据此决定：分段计时可信否 / 是否改用摊还。
    const CLOCK_PROBE_N = 200
    const ck0 = latClock()
    for (let i = 0; i < CLOCK_PROBE_N; i++) void latClock()
    const clockCallMs = (latClock() - ck0) / CLOCK_PROBE_N
    const LAT_N = 100
    const latTotal: number[] = []
    const latJs: number[] = []
    const latHost: number[] = []
    const latData: number[] = []
    // ★分位助手**提前定义**（本仓实测：定义在下面而上面引用 ⇒ TDZ 错
    //   `Cannot access 'pct' before initialization`，用例整体异常）
    const pct = (arr: number[], p: number) => {
      const a = [...arr].sort((x, y) => x - y)
      return a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? -1
    }
    const latFlushBefore = rt.getStats().flushes
    let latOpCount = 0
    for (let i = 0; i < LAT_N; i++) {
      // ★★三段分离（2026-09-29 诊断）——本仓纪律「>5ms 必拆」：
      //   首版把 ①造数据 ②扫描 ③宿主 全算进"JS"，导致针对性优化看不出效果（优化前后都 ~10.8ms）。
      const t0 = latClock()
      // 真实变更：第 500 行 dotW 交替（首次与当前值不同 ⇒ 不会 `Object.is` 短路）
      const next = listRows.map((r, idx) => (idx === 499 ? { ...r, dotW: i % 2 ? 60 : 36 } : r))
      listRows = next
      data.list = next
      const t1 = latClock()                 // ① 造数据（1000 行 map + 对象展开）
      triggers.get('list')?.()
      rt.flush()
      const t2 = latClock()                 // ② 源触发 + 全行扫描 + diff + 二进制编码
      const b = cap.pop()
      if (b) {
        const out = safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(b))))
        latOpCount += (out?.patch_count as number) ?? 0
      }
      const t3 = latClock()                 // ③ 宿主（JSON 数组编组 + JNI + 核心应用）
      latData.push(t1 - t0)
      latJs.push(t2 - t1)
      latHost.push(t3 - t2)
      latTotal.push(t3 - t0)
    }
    const latCheck = flushCheck(rt, latFlushBefore, LAT_N)

    const latStats = {
      p50_ms: Math.round(pct(latTotal, 0.5) * 1000) / 1000,
      p95_ms: Math.round(pct(latTotal, 0.95) * 1000) / 1000,
      p99_ms: Math.round(pct(latTotal, 0.99) * 1000) / 1000,
      // 摊还（N 次总耗时 / N）——**主读数**：天然避开时钟分辨率限制（本仓纪律）
      amortized_ms: Math.round((latTotal.reduce((a, b) => a + b, 0) / LAT_N) * 1000) / 1000,
      data_p50_ms: Math.round(pct(latData, 0.5) * 1000) / 1000,
      js_p50_ms: Math.round(pct(latJs, 0.5) * 1000) / 1000,
      host_p50_ms: Math.round(pct(latHost, 0.5) * 1000) / 1000,
      // ★归因（本仓纪律：>5ms 必拆）：单节点更新的成本**不在增量**（每次只发 1 条、重排 3 节点），
      //   而在**源级触发时的全表扫描**（`triggers.get('list')` ⇒ 按 key 扫所有行做 diff）。
      //   ⇒ 优化方向是"行级订阅/脏行标记"，不是"减少指令数"（指令已经是 1 条）。
      attribution: 'cost is in whole-source trigger (row scan + key diff over all rows), not in the incremental payload (1 op / relayout 3)',
      clock: latClockName,
      clock_trustworthy: latClockOk,
      ops_total: latOpCount,
      flush_check: latCheck,
    }

    // ══ ★★⑤ 行级失效对照（`relinkRow`：只算改动的那一行，2026-09-29）════════════════
    //
    // 【为什么要测】粗粒度触发（`triggers.get('list')`）只知道"源变了" ⇒ **全表重扫**
    //   （1000 行 × 3 槽位）——真机实测该段 7.03ms。Vapor 的设计本意是 **O(1) 槽位直写**。
    //   `relinkRow(listId, key, row, ancestors, ctx)` 就是那个入口。
    // 【判据】① 端到端更快（同树同改动）；② **指令与全扫一致**（等价性，TS 侧已断言，真机再验次数）；
    //   ③ flush 判据同样成立（防"没做事所以快"）。
    const itemSpec = table.sources.flatMap((src2) => src2.slots).find((x) => x.kind === 'list-item')
    const fineListId = itemSpec?.listId ?? 0
    const fineKeyField = itemSpec?.itemKeyField ?? 'id'
    const fine: {
      p50_ms: number; p95_ms: number; js_p50_ms: number; marshal_p50_ms: number; host_p50_ms: number
      amortized_ms: number; payload_bytes: number
      flush_delta: number; speedup_vs_coarse: number; ops_ok: boolean
    } = { p50_ms: -1, p95_ms: -1, js_p50_ms: -1, marshal_p50_ms: -1, host_p50_ms: -1, amortized_ms: -1, payload_bytes: 0, flush_delta: -1, speedup_vs_coarse: -1, ops_ok: false }
    // ★诊断采样（**声明在块外**——本仓实测：声明在块内会被 esbuild 重命名 `fineDiag2`
    //   而块外报告仍引用原名 ⇒ 运行时报 `Can't find variable: fineDiag`，且**只在真机暴露**）
    const fineDiag: Array<Record<string, number>> = []
    let finePayloadMax = 0
    {
      const fineTotal: number[] = []
      const fineJs: number[] = []
      const fineMarshal: number[] = []
      const fineHost: number[] = []
      const fineFlushBefore = rt.getStats().flushes
      let fineOps = 0
      fine.payload_bytes = 0
      for (let i = 0; i < LAT_N; i++) {
        const t0 = latClock()
        const target = (listRows[499] ?? {}) as Record<string, unknown>
        target.dotW = i % 2 ? 60 : 36
        const t1 = latClock()
        vapor.relinkRow(fineListId, String(target[fineKeyField]), target, [], { read: (n: string) => (n === 'list' ? listRows : undefined) })
        // ★★本轮缓冲区的**精确归属**（本仓实测的测量装置缺陷）：
        //   `flush()` 在 buffer 为空时 **early-return、不 push** ⇒ 若沿用 `cap.pop()`，
        //   会**取到上一轮（或更早）的残留大 buffer**——实测拿到的载荷是 **8964 字节**
        //   （那是全量 relink 的），而本轮真实载荷只有 ~20 字节 ⇒ 编组耗时被虚报 ~2.4ms。
        //   ⇒ 用"标记位 + 本轮新增"取本轮产物（不依赖 push/pop 配对）。
        const capLen0 = cap.length
        rt.flush()
        const fresh = cap.splice(capLen0)   // 本轮新增的 buffer（并移除，防残留）
        const t2 = latClock()
        let marshalMs = 0
        if (fresh.length > 0) {
          const totalBytes = fresh.reduce((n, b) => n + b.length, 0)
          finePayloadMax = Math.max(finePayloadMax, totalBytes)
          const tm0 = latClock()
          let payload = ''
          for (const b of fresh) payload += JSON.stringify(Array.from(b))
          const tm1 = latClock()
          marshalMs = tm1 - tm0
          if (payload) {
            const out = safeParseAny(proteusSelfDraw.applyOps(payload))
            const pc = (out?.patch_count as number) ?? 0
            fineOps += pc
            if (fineDiag.length < 4) fineDiag.push({ round: i, buffers: fresh.length, bytes: totalBytes, patch_count: pc })
          }
        }
        const t3 = latClock()
        fineJs.push(t2 - t1)
        fineMarshal.push(marshalMs)
        fineHost.push(t3 - t2 - marshalMs)     // 纯宿主（含 JSExport 编组 + Swift 解析 + JNI + 应用）
        fineTotal.push(t3 - t0)
      }
      // ★★★摊还测量（**避开时钟开销**）：整段循环只读 2 次时钟 ⇒ 装置开销 / LAT_N
      //   本仓纪律：摊还天然避开分辨率与装置开销问题（V3 用例早已确立此做法）
      {
        const am0 = latClock()
        for (let i = 0; i < LAT_N; i++) {
          const target = (listRows[499] ?? {}) as Record<string, unknown>
          target.dotW = i % 2 ? 60 : 36
          vapor.relinkRow(fineListId, String(target[fineKeyField]), target, [], { read: (n: string) => (n === 'list' ? listRows : undefined) })
          const cl0 = cap.length
          rt.flush()
          const fr2 = cap.splice(cl0)
          for (const b of fr2) {
            const out2 = safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(b))))
            void out2
          }
        }
        const am1 = latClock()
        fine.amortized_ms = Math.round(((am1 - am0) / LAT_N) * 1000) / 1000
      }
      fine.flush_delta = rt.getStats().flushes - fineFlushBefore
      fine.ops_ok = fine.flush_delta === LAT_N && fineOps >= LAT_N - 2
      fine.p50_ms = Math.round(pct(fineTotal, 0.5) * 1000) / 1000
      fine.p95_ms = Math.round(pct(fineTotal, 0.95) * 1000) / 1000
      fine.js_p50_ms = Math.round(pct(fineJs, 0.5) * 1000) / 1000
      fine.marshal_p50_ms = Math.round(pct(fineMarshal, 0.5) * 1000) / 1000
      fine.payload_bytes = finePayloadMax
      fine.host_p50_ms = Math.round(pct(fineHost, 0.5) * 1000) / 1000
      fine.speedup_vs_coarse = latStats.p50_ms > 0 ? Math.round((latStats.p50_ms / fine.p50_ms) * 100) / 100 : -1
    }

    const checks = {
      // ★实例化产物规模正确（静态 + 1000×行子树）
      instOk: inst.nodes.length > 3000,
      // ★挂载成功且层数 ≈ 节点数
      mountOk: !!mountOut?.ok && (mountOut?.layer_count as number) > 3000,
      // ★只发 1 条指令（ListRegistry 解析到具体行 ⇒ 不是 LIST_UPDATE 回退）
      oneOp: (applyOut?.patch_count as number) === 1,
      // ★无 unsupported（LIST_UPDATE 被上报 ⇒ 说明注册表没解析成功）
      noUnsupported: ((applyOut?.unsupported_count as number) ?? 0) === 0,
      // ★几何真的变了（变化量自检——本仓纪律：计时必须配"变化量"）
      geomChanged: ((applyOut?.geom_changed as number) ?? 0) >= 1,
      // ★重排范围小（行是边界 ⇒ 不该整树重排）
      smallScope: ((applyOut?.relayout_count as number) ?? 1e9) < 100,
      // ★★单节点更新延迟：§10 核心指标（合格线 10ms / 目标 3ms）
      latencyTarget: latStats.p95_ms <= 3,
      latencyPass: latStats.p95_ms <= 10,
      // ★每次更新都真的发了指令（防"空跑也报快"）
      flushOnePerUpdate: latCheck.ok,
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
    results.push({
      case: 'V11_long_list',
      note: `${ROWS} 行 SFC 产物：实例化 ${inst.nodes.length} 节点 · 挂载 ${mountOut?.layer_count ?? 0} 层 · 改 1 行发 ${applyOut?.patch_count ?? -1} 条指令 · 单节点更新 p95 ${latStats.p95_ms}ms（JS ${latStats.js_p50_ms} + 宿主 ${latStats.host_p50_ms}）`,
      items: ROWS, nodes: inst.nodes.length,
      vue_ms: 0, to_request_ms: instantiateMs, serialize_ms: 0,
      host_ms: mountMs, total_ms: instantiateMs + mountMs,
      patch_count: rt.getStats().opsEmitted, request_bytes: (applyOut?.in_bytes as number) ?? 0,
      extra: {
        verdict, checks,
        instantiate_ms: Math.round(instantiateMs * 100) / 100,
        mount_ms: Math.round(mountMs * 100) / 100,
        layer_count: mountOut?.layer_count,
        op_count: applyOut?.patch_count,
        unsupported: applyOut?.unsupported_count,
        relayout: applyOut?.relayout_count,
        geom_changed: applyOut?.geom_changed,
        l1_slots: loadRes.l1Slots, l0_slots: loadRes.l0Slots,
        uninstantiated: loadRes.uninstantiatedSlots.length,
        // ★ListRegistry 驱动成功的直接证据（resolveNode 命中数）
        registry_stats: (registry as unknown as { stats?: unknown }).stats,
        // ★诚实边界：本档验证"长列表实例化 + 行内更新只发 1 条"；
        //   真机**滚动复用池**另见 `V12_scroll_recycle`
        covered: 'long-list instantiate + per-row dispatch + ★单节点更新延迟分位（§10 核心指标）',
        not_covered: 'scroll recycle pool on device（见 V12）',
        // ★★§10 核心指标的有效证据（本档；替代已失效的 V3 runScale 类A 档）
        single_node_update: latStats,
        // ★★行级失效对照（`relinkRow`）——与粗粒度同一棵树/同一改动
        single_node_update_row_level: fine,
        fine_diag: fineDiag,
        // ★测量装置开销（每次时钟调用 ms）——若它与分段读数同量级，则分段计时**不可用**
        clock_call_ms: Math.round(clockCallMs * 1000) / 1000,
        latency_iters: LAT_N,
      },
    })
  },
})

/* V12 · ★★滚动复用池真机（§12.6 生命周期状态机 + §12.7 P1 layer 复用池） */
CASES.push({
  name: 'V12_scroll_recycle',
  note: '★★虚拟化长列表滚动：1000 行只物化可见+预载行 → 层层复用（层数有界 · 回滚交换预载区）',
  fn: async () => {
    const builtTpl = vaporTableJson as unknown as {
      ok: boolean
      table: import('@proteus-vue/slot-runtime').SubscriptionTable
      template: import('@proteus-vue/slot-runtime').LayoutTemplate
    }
    if (!builtTpl.ok || !builtTpl.template || !proteusSelfDraw.mountVirtual) {
      results.push({ case: 'V12_scroll_recycle', note: '✗ 模板产物/宿主入口不可用', items: 0, nodes: 0,
        vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1, total_ms: -1, patch_count: -1, request_bytes: -1 })
      return
    }
    const tpl = builtTpl.template
    const table = builtTpl.table
    const ROWS = 1000
    const rows = Array.from({ length: ROWS }, (_, i) => ({
      id: i + 1, dotW: 36, textW: 120, title: `行 ${i + 1}`,
    }))
    const data: Record<string, unknown> = { list: rows }
    const registry = new ListRegistry()
    const inst = instantiateTemplate(tpl, {
      viewport: VP, read: (n) => data[n], table, registry,
    })
    if (!inst.virtual || inst.virtual.rows.length !== ROWS) {
      results.push({ case: 'V12_scroll_recycle', note: `✗ 虚拟化描述缺失（rows=${inst.virtual?.rows.length ?? -1}）`,
        items: 0, nodes: inst.nodes.length, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1, total_ms: -1,
        patch_count: -1, request_bytes: -1 })
      return
    }

    // ★运行时就绪（容器文本真源也经它——见 `ctx.read` 契约）
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const cap: Uint8Array[] = []
    const rt = new SlotRuntime(keys, strings, (b) => cap.push(b))
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), registry)
    const triggers = new Map<string, () => void>()
    let listRows = rows
    const ctx = { read: (n: string) => (n === 'list' ? listRows : data[n]) }
    const loadRes = vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)
    rt.flush()
    cap.length = 0

    // ① 虚拟化挂载：整树进核心，**只物化可见+预载行**
    const t0 = now()
    const mountOut = safeParseAny(proteusSelfDraw.mountVirtual(JSON.stringify({
      viewport: VP, nodes: inst.nodes, rows: inst.virtual.rows,
    })))
    const mountMs = now() - t0
    const afterMount = safeParseAny(proteusSelfDraw.virtualStats?.() ?? '{}')

    // ② 滚动轨迹：**向下**滚若干帧 → **回滚**（本仓 §9.3 的核心场景）
    const STEP = 560            // 10 行/帧（行高 56 × 10）
    const FRAMES = 30
    const fwd: Array<{ dir: string; first: number; last: number; acquired: number; released: number }> = []
    let scrollMs = 0
    for (let i = 0; i < FRAMES; i++) {
      const t = now()
      const o = safeParseAny(proteusSelfDraw.scrollRows(0, STEP) ?? '{}')
      scrollMs += now() - t
      fwd.push({
        dir: String(o.direction ?? '?'), first: (o.first_visible as number) ?? -1,
        last: (o.last_visible as number) ?? -1,
        acquired: ((o.acquired as number[]) ?? []).length,
        released: ((o.released as number[]) ?? []).length,
      })
    }
    const afterDown = safeParseAny(proteusSelfDraw.virtualStats?.() ?? '{}')
    const back: Array<{ dir: string; first: number; acquired: number; released: number }> = []
    for (let i = 0; i < FRAMES; i++) {
      const o = safeParseAny(proteusSelfDraw.scrollRows(0, -STEP) ?? '{}')
      back.push({
        dir: String(o.direction ?? '?'), first: (o.first_visible as number) ?? -1,
        acquired: ((o.acquired as number[]) ?? []).length,
        released: ((o.released as number[]) ?? []).length,
      })
    }
    const afterUp = safeParseAny(proteusSelfDraw.virtualStats?.() ?? '{}')

    // ③ ★★虚拟化正确性关键项：**屏外改动滚入后必须生效**（复用池最经典的静默错）
    //
    // 【为什么这是最重要的一条】行未被物化时若"更新被丢弃"，滚入时会显示**旧内容**
    //   ——而所有几何/结构断言都对着核心（正确的）⇒ 全绿。
    //   做法：改**屏外**第 600 行的文本 → 只发指令（不滚动）→ 再滚到它 → 读**层上**的文本。
    const FAR = 600
    // 改第 600 行标题（该行此刻**不在视口内** ⇒ 未物化）
    const mutated = listRows.map((r, i) => (i === FAR ? { ...r, title: `改过 ${i + 1}` } : r))
    listRows = mutated
    data.list = mutated
    triggers.get('list')?.()
    rt.flush()
    const farBytes = cap.pop()
    const farApply = farBytes
      ? safeParseAny(proteusSelfDraw.applyOps(JSON.stringify(Array.from(farBytes))))
      : undefined
    // 滚到第 600 行附近（每帧 560px；行距 64px ⇒ 68 帧 ≈ 第 595 行）
    for (let i = 0; i < 68; i++) proteusSelfDraw.scrollRows?.(0, 560)
    const probeFar2 = safeParseAny(proteusSelfDraw.virtualProbe?.(FAR) ?? '{}')
    const farTexts: string[] = (probeFar2?.child_texts as string[]) ?? []
    const farRowText = farTexts.find((t) => t.startsWith('改过')) ?? ''
    // ★同一次探针里取像素坐标（**坐标由宿主从核心几何推导**——本仓纪律）
    const farChildren: Array<{ cx: number; cy: number }> = (probeFar2?.child_rects as Array<{ cx: number; cy: number }>) ?? []
    const dotCenter = farChildren[1]                     // 行内第 2 个节点 = 圆点（见 SFC 模板）
    const px = dotCenter
      ? safeParseAny(proteusSelfDraw.samplePixels?.(JSON.stringify([{ x: dotCenter.cx, y: dotCenter.cy }])) ?? '{}')
      : undefined
    const pixel: string = (px?.pixels as string[])?.[0] ?? ''
    // 屏外行（此刻视口在 600 附近 ⇒ 第 2 行已滚出并被回收）
    const probeOff = safeParseAny(proteusSelfDraw.virtualProbe?.(2) ?? '{}')

    // ⑤+ ★★**虚拟化下的命中测试**（本档此前标为未覆盖项）
    //
    // 【为什么它必须单独验（不能从"几何对"推出来）】虚拟化只物化了少数行；
    //   而命中走的是**核心的全量树** ⇒ 理论上不依赖层是否物化。
    //   但"理论"不算数：本仓已多次证明"看起来必然成立"的事需要实测（如宿主裁剪破坏核心簿记）。
    //   两条判据：
    //     · 打**已物化**的行（可见区）⇒ 必须命中该行内节点
    //     · 打**未物化**的行（屏外）⇒ 从"核心持全量树"的角度它**也应该**命中
    //       （那是核心的正确性，与层无关）；若命中不到 ⇒ 说明命中路径被层状态影响了（真缺陷）
    const hitProbe = (rowIndex: number): { hit: any; expectedIds: number[]; rowY: number; usedXY: [number, number] } => {
      const pr = safeParseAny(proteusSelfDraw.virtualProbe?.(rowIndex) ?? '{}')
      // ★★**命中必须用「内容坐标」**（本仓实测的坐标系口径分叉，第 5 次同类）
      //
      // 【两次踩坑都记下来】
      //   ① 首版手算 `x=8` ⇒ 命中 `target:0`（列表根）。因为 SFC 里列表根有 `padding-left:16px`，
      //      行容器从 x=16 起 —— x=8 落在根上（合法命中，但不是我要的行内节点）。
      //   ② 改用探针的 `child_rects`（**屏幕坐标**）⇒ 命中 `target:18`（**第 1 行**的圆点）。
      //      因为 `tapAt` 吃**内容坐标**（与核心 `rects` 同口径），而我传的是"减掉 contentOffset
      //      之后的屏幕坐标" ⇒ 600 行在内容坐标里 y≈37000，我传的 ~449 正好是第 1 行的位置。
      //   ⇒ 纪律：**跨接口传坐标前先确认两端口径**；"数字看着合理"恰恰是最危险的（449 确实
      //     是某一行的 y —— 只不过是另一行）。
      //   ⇒ 探针现已同时给屏幕坐标与内容坐标（`child_content_centers`），本处取后者。
      const kids: Array<{ cx: number; cy: number }> = (pr?.child_content_centers as Array<{ cx: number; cy: number }>) ?? []
      const expected = ((inst.virtual!.rows.find((r) => r.index === rowIndex)?.ids) ?? [])
      const dot = kids[1] ?? kids[0]
      const x = dot ? dot.cx : 8
      const y = dot ? dot.cy : 0
      const hit = safeParseAny(proteusSelfDraw.tapAt?.(x, y) ?? '{}')
      return { hit, expectedIds: expected, rowY: y, usedXY: [x, y] }
    }
    const hitInRow = hitProbe(FAR)          // 已物化（视口中心）
    const hitOffRow = hitProbe(20)          // 屏外（早已被回收）
    const hitOk = (h: { hit: any; expectedIds: number[] }): boolean => {
      const t = h.hit?.target as number | undefined
      return typeof t === 'number' && t >= 0 && h.expectedIds.includes(t)
    }

    // ④ 破坏性验证：把池容量设为 0（**同一条轨迹**再滚一轮）
    //    ⇒ 复用必须归零、且确实又新建了层（证明"复用率"不是恒真的量）
    safeParseAny(proteusSelfDraw.setPoolCapacity?.(0) ?? '{}')
    const killStart = safeParseAny(proteusSelfDraw.virtualStats?.() ?? '{}')
    const createdBefore = (killStart.layers_created as number) ?? 0
    const reusedBefore = (killStart.layers_reused as number) ?? 0
    for (let i = 0; i < 6; i++) proteusSelfDraw.scrollRows?.(0, -560)
    const killEnd = safeParseAny(proteusSelfDraw.virtualStats?.() ?? '{}')
    const killReusedDelta = ((killEnd.layers_reused as number) ?? 0) - reusedBefore
    const killCreatedDelta = ((killEnd.layers_created as number) ?? 0) - createdBefore
    // 恢复池容量（不影响后续用例）
    safeParseAny(proteusSelfDraw.setPoolCapacity?.(96) ?? '{}')

    const fwdAcq = fwd.reduce((a, b) => a + b.acquired, 0)
    const fwdRel = fwd.reduce((a, b) => a + b.released, 0)
    const backAcq = back.reduce((a, b) => a + b.acquired, 0)
    const backRel = back.reduce((a, b) => a + b.released, 0)
    const createdTotal = (afterUp.layers_created as number) ?? 0
    const reusedTotal = (afterUp.layers_reused as number) ?? 0
    const matRows = (afterUp.materialized_rows as number) ?? 0
    const layerCount = (afterUp.layer_count as number) ?? 0

    const checks = {
      // ★① 只物化了少数行（虚拟化真的生效——全量会是 1000 行 / 3002 层）
      fewRows: matRows > 0 && matRows < 60,
      fewLayers: layerCount > 0 && layerCount < 400,
      // ★② 前 30 帧方向全为 forward，回滚 30 帧全为 backward（方向敏感预载的前提）
      dirForward: fwd.every((f) => f.dir === 'forward'),
      dirBackward: back.every((b) => b.dir === 'backward'),
      // ★③ 每帧的 acquire/release 有界（不随滚动距离增长——长列表的内存天花板）
      boundedPerFrame: fwd.every((f) => f.acquired <= 40 && f.released <= 40),
      // ★④ 滚动过程确实发生了 acquire/release（否则"有界"是因为什么都没做——空判据）
      realChurn: fwdAcq > 0 && fwdRel > 0 && backAcq > 0 && backRel > 0,
      // ★⑤ **复用率**（层复用池真的在起作用；全新建 ⇒ ~0）
      reuseWorks: reusedTotal > 0 && createdTotal > 0 && reusedTotal / (reusedTotal + createdTotal) > 0.5,
      // ★⑥ 建层总数**远小于**"物化行数 × 行子树"（否则等于每帧重建）
      notRebuiltEachFrame: createdTotal < matRows * 6,
      // ★⑦ 破坏性：池容量 0 时复用增量为 0、且确实又新建了层（证明⑤的量不是恒真的）
      killSwitch: killReusedDelta === 0 && killCreatedDelta > 0,
      // ★⑧ 层数在整个滚动过程中**有界**（回滚后不高于向下滚后）
      layersBounded: layerCount <= ((afterMount.layer_count as number) ?? 0) + 200,
      // ★⑨ 像素：行的圆点中心必须是**圆点色**（#6F4AE8）——"屏幕上真的画对了"
      pixelDot: pixel.toUpperCase() === '#6F4AE8',
      // ★⑩ 屏外行必须**没有层**（层数有界 + 几何仍在核心 —— 二者同时成立才叫虚拟化）
      farRowUnmaterialized: probeOff?.materialized === false && probeOff?.ok === true,
      // ★⑪ 屏内行必须**有层**（与⑩成对：否则"全都没物化"也能骗过⑩）
      inRowMaterialized: probeFar2?.materialized === true,
      // ★★⑫ 虚拟化正确性关键项：**屏外被改的内容，滚入后必须真的生效**（读**层上**的文本）
      offscreenUpdateVisible: farRowText === `改过 ${FAR + 1}`,
      // ★⑬ 该次 apply 确实作用到了（不是"没改所以没差"的空判据）
      //   注：指令计数在 `patch_count`，**不是** `applied`（父级字段，本档初版写错 ⇒ 假红）
      offscreenUpdateApplied: ((farApply?.patch_count as number) ?? 0) >= 1 &&
        ((farApply?.text_updates as number) ?? 0) >= 1,
      // ★★⑭ **测量装置自检**：像素采样器三色标定（本轮 R/B 互换就是它抓出来的）
      pixelDeviceOk: (safeParseAny(proteusSelfDraw.pixelFormatSelfTest?.() ?? '{}'))?.ok === true,
      // ★★⑮ 虚拟化下的命中：**已物化行**必须命中该行内节点
      hitOnMaterializedRow: hitOk(hitInRow),
      // ★★⑯ 虚拟化下的命中：**未物化行**也应命中（核心持全量树 ⇒ 命中与层无关）
      hitOnUnmaterializedRow: hitOk(hitOffRow),
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
    results.push({
      case: 'V12_scroll_recycle',
      note: `${ROWS} 行虚拟化：挂载只物化 ${afterMount.materialized_rows ?? -1} 行 / ${afterMount.layer_count ?? -1} 层 · ` +
        `滚动 ${FRAMES} 帧（↓${fwdAcq}取/${fwdRel}放 · ↑${backAcq}取/${backRel}放）· ` +
        `建层 ${createdTotal} / 复用 ${reusedTotal}`,
      items: ROWS, nodes: inst.nodes.length,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0,
      host_ms: mountMs, total_ms: mountMs + scrollMs,
      patch_count: createdTotal, request_bytes: 0,
      extra: {
        verdict, checks,
        mount_ms: Math.round(mountMs * 100) / 100,
        scroll_ms_total: Math.round(scrollMs * 100) / 100,
        node_count: inst.nodes.length,
        mount_stats: afterMount, down_stats: afterDown, up_stats: afterUp,
        kill_stats: { reused_delta: killReusedDelta, created_delta: killCreatedDelta, end: killEnd, start: killStart },
        forward: fwd.slice(0, 3).concat(fwd.slice(-3)),
        backward: back.slice(0, 3).concat(back.slice(-3)),
        probe_far_row: probeFar2, probe_offscreen_row: probeOff,
        pixel_at_dot: pixel, offscreen_far_row: FAR,
        offscreen_text_seen: farRowText, offscreen_apply: farApply,
        // ★虚拟化下的命中读数（坐标由宿主几何推导）
        hit_on_materialized: hitInRow,
        hit_on_unmaterialized: hitOffRow,
        pixel_at_dot: pixel, offscreen_far_row: FAR,
        offscreen_text_seen: farRowText, offscreen_apply: farApply,
        runtime: { l1_slots: loadRes.l1Slots, l0_slots: loadRes.l0Slots },
        covered: 'virtualized mount + direction-sensitive recycle + layer pool reuse + rollback',
        not_covered: '真实 UITouch（tapAt 绕过 UITouch，只覆盖「命中→派发」）；Android 侧同款',
      },
    })
  },
})

/* V14 · ★★S2 内存收敛（滚动 3 个来回后内存不得持续增长）—— iOS checklist 唯一未闭项 */
CASES.push({
  name: 'V14_s2_memory_convergence',
  note: '★★S2 内存收敛：1000 行虚拟化列表滚动 3 个完整来回，逐步采样 phys_footprint，判「收敛」而非「单点低」',
  fn: async () => {
    const builtTpl = vaporTableJson as unknown as {
      ok: boolean
      table: import('@proteus-vue/slot-runtime').SubscriptionTable
      template: import('@proteus-vue/slot-runtime').LayoutTemplate
    }
    if (!builtTpl.ok || !builtTpl.template || !proteusSelfDraw.mountVirtual) {
      results.push({ case: 'V14_s2_memory_convergence', note: '✗ 模板产物/宿主入口不可用', items: 0, nodes: 0,
        vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1, total_ms: -1, patch_count: -1, request_bytes: -1 })
      return
    }
    const tpl = builtTpl.template
    const table = builtTpl.table
    const ROWS = 1000
    const rows = Array.from({ length: ROWS }, (_, i) => ({ id: i + 1, dotW: 36, textW: 120, title: `行 ${i + 1}` }))
    const data: Record<string, unknown> = { list: rows }
    const inst = instantiateTemplate(tpl, { viewport: VP, read: (n) => data[n], table, registry: new ListRegistry() })
    if (!inst.virtual) {
      results.push({ case: 'V14_s2_memory_convergence', note: '✗ 无虚拟化描述', items: 0, nodes: inst.nodes.length,
        vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1, total_ms: -1, patch_count: -1, request_bytes: -1 })
      return
    }
    const mountOut = safeParseAny(proteusSelfDraw.mountVirtual(JSON.stringify({
      viewport: VP, nodes: inst.nodes, rows: inst.virtual.rows,
    })))
    const memAfterMount = (safeParseAny(proteusSelfDraw.virtualStats?.() ?? '{}').mem_mb as number)
      ?? (mountOut?.mem_mb as number) ?? -1

    // ★★判据设计（"收敛"必须是趋势，不是单点）
    //
    // 【为什么单点读数不够（本仓纪律：单点比较是空判据）】"内存低"与"内存收敛"是两件事：
    //   一个每轮增长 2MB 的实现，在第 1 轮也可能"很低"。⇒ 必须**滚动多个来回**并看**趋势**。
    //   判据：末轮峰值 ≤ 首轮峰值 + 容差（容差给 3MB —— 光栅缓存/分配器碎片有合理波动）。
    //   ★反向判据（防"什么都没做"）：每轮必须有真实的层增删（reused 增长）——
    //     否则"内存没涨"只是因为**根本没在滚动**（本仓见过的"空判据"形态）。
    const STEP = 560          // 10 行/帧
    const FRAMES_PER_LEG = 68 // 68×560px ≈ 全表（1000 行 × 64px = 64000px）
    const ROUNDS = 3
    const legs: Array<{ round: number; dir: string; mem: number }> = []
    let reusedStart = -1
    let reusedEnd = -1
    let churn = 0

    for (let r = 0; r < ROUNDS; r++) {
      // 向下一趟
      for (let i = 0; i < FRAMES_PER_LEG; i++) {
        const o = safeParseAny(proteusSelfDraw.scrollRows(0, STEP) ?? '{}')
        churn += (((o.acquired as number[]) ?? []).length + ((o.released as number[]) ?? []).length)
        if (reusedStart < 0) reusedStart = (o.virtual as { layers_reused?: number })?.layers_reused ?? -1
        reusedEnd = (o.virtual as { layers_reused?: number })?.layers_reused ?? reusedEnd
      }
      legs.push({ round: r, dir: 'down', mem: (safeParseAny(proteusSelfDraw.scrollRows(0, 0) ?? '{}').mem_mb as number) ?? -1 })
      // 回滚一趟（§9.3 的核心场景）
      for (let i = 0; i < FRAMES_PER_LEG; i++) {
        const o = safeParseAny(proteusSelfDraw.scrollRows(0, -STEP) ?? '{}')
        churn += (((o.acquired as number[]) ?? []).length + ((o.released as number[]) ?? []).length)
        reusedEnd = (o.virtual as { layers_reused?: number })?.layers_reused ?? reusedEnd
      }
      legs.push({ round: r, dir: 'up', mem: (safeParseAny(proteusSelfDraw.scrollRows(0, 0) ?? '{}').mem_mb as number) ?? -1 })
    }

    const finalStats = safeParseAny(proteusSelfDraw.virtualStats?.() ?? '{}')
    const mems = legs.map((l) => l.mem).filter((m) => m > 0)
    // 首轮（第 1 趟向下结束） vs 末轮（最后一趟回滚结束）
    const firstMem = mems.length > 0 ? mems[0]! : -1
    const lastMem = mems.length > 0 ? mems[mems.length - 1]! : -1
    const peakMem = mems.length > 0 ? Math.max(...mems) : -1
    const growth = lastMem - firstMem

    const checks = {
      mountOk: !!mountOut?.ok,
      // ★内存读数有效（>0；三者都有效才算）
      memValid: mems.length === ROUNDS * 2 && mems.every((m) => m > 0),
      // ★★**收敛判据**：末轮 ≤ 首轮 + 3MB（3 个来回后不持续增长）
      converged: growth <= 3,
      // ★★**反向判据**：滚动期间**真的有层复用**（否则"内存没涨"是因为没滚动——空判据）
      realChurn: churn > 1000 && reusedEnd > reusedStart,
      // ★层数仍有界（虚拟化没退化成全量物化）
      layersBounded: ((finalStats.layer_count as number) ?? 1e9) < 400,
      // ★复用率守住（与 V12 同口径）
      reuseWorks: ((finalStats.layers_reused as number) ?? 0) > 0
        && ((finalStats.layers_reused as number) / (((finalStats.layers_reused as number) ?? 0) + ((finalStats.layers_created as number) ?? 1))) > 0.5,
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
    results.push({
      case: 'V14_s2_memory_convergence',
      note: `${ROWS} 行 × ${ROUNDS} 个完整来回：内存 ${mems.join(' → ')} MB（首 ${firstMem} · 末 ${lastMem} · 峰 ${peakMem}）· 层增删 ${churn} 次`,
      items: ROWS, nodes: inst.nodes.length,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0,
      patch_count: 0, request_bytes: 0,
      extra: {
        verdict, checks,
        mem_after_mount: memAfterMount,
        mem_sequence: mems,
        legs,
        first_mem: firstMem, last_mem: lastMem, peak_mem: peakMem, growth_mb: Math.round(growth * 10) / 10,
        churn_events: churn,
        layers_reused: finalStats.layers_reused,
        layers_created: finalStats.layers_created,
        layer_count: finalStats.layer_count,
        covered: '滚动 3 个来回的 phys_footprint 趋势 + 反向判据（确有层复用）',
        // ★诚实边界：只测了**虚拟化路径**的收敛；非虚拟化路径（全量物化）的内存收敛未测
        not_covered: '非虚拟化路径的内存收敛；Instruments 级别的 backing store 细分',
      },
    })
  },
})

/* V13 · ★★fontFamily 端到端（语义角色 → 平台字体；度量与绘制同源） */
CASES.push({
  name: 'V13_font_family',
  note: '★★字体族：同文本同字号三种字族 ⇒ 度量必须不同 + 层上字体真的换了（含"全 system"反例对照）',
  fn: async () => {
    const ROLES = ['system', 'serif', 'monospace']
    // ★样本文本选宽度差异明显的（serif/等宽对 "MMMM iii WWWW" 的度量差最大）
    const TEXT = 'MMMM iii WWWW'
    const build = (roles: string[]): Array<Record<string, unknown>> => {
      const nodes: Array<Record<string, unknown>> = [
        { id: 0, parentId: null, flexDirection: 'column', width: VP.width, height: VP.height },
      ]
      roles.forEach((role, i) => {
        nodes.push({ id: 100 + i, parentId: 0, flexDirection: 'row', alignItems: 'center',
          width: VP.width, height: 60, flexShrink: 0 })
        nodes.push({ id: 200 + i, parentId: 100 + i, text: TEXT, fontSize: 24, fontWeight: 400,
          fontFamily: role, flexShrink: 0 })
      })
      return nodes
    }
    const probe = (roles: string[]): { w: number[]; font: string[]; mount: any } => {
      // ★必须**显式拆树**：`mount` 是增量语义（只 diff 布局字段）⇒ 紧接着 mount 一棵
      //   "只改了字族"的树会**什么都不做**（层上字体保持上一次）——本档初版就被它坑了：
      //   对照组的宽度与实验组**完全相同**，差点读成"字族不影响度量"。
      proteusSelfDraw.clearTree?.()
      const nodes = build(roles)
      const m = safeParseAny(proteusSelfDraw.mount(JSON.stringify({ viewport: VP, nodes })))
      const p = safeParseAny(proteusSelfDraw.measureProbe?.(
        JSON.stringify({ nodes: roles.map((_, i) => 200 + i) })) ?? '{}')
      const byId = (p?.nodes ?? {}) as Record<string, { layer_w?: number; font_name?: string }>
      return {
        w: roles.map((_, i) => byId[String(200 + i)]?.layer_w ?? -1),
        font: roles.map((_, i) => byId[String(200 + i)]?.font_name ?? ''),
        mount: m,
      }
    }

    const withFamilies = probe(ROLES)
    const allSystem = probe(['system', 'system', 'system'])

    const distinct = new Set(withFamilies.w.filter((w) => w > 0))
    const distinctSystem = new Set(allSystem.w.filter((w) => w > 0))
    const fontNames = new Set(withFamilies.font.filter(Boolean))

    const checks = {
      mountOk: !!withFamilies.mount?.ok && !!allSystem.mount?.ok,
      // ★① 三种字族 ⇒ 至少两种不同宽度（字体库可能缺 face，故不要求三种全不同）
      familyAffectsMeasure: distinct.size >= 2,
      // ★② 反例对照：全 system ⇒ 必须**完全同宽**（否则①的差异来自别处）
      sameFamilySameWidth: distinctSystem.size === 1,
      // ★③ 两组确实不同（否则①②在描述同一件无关的事）
      familyChangesMeasure: withFamilies.w.join(',') !== allSystem.w.join(','),
      // ★★④ **层上的字体名**必须不同（证明"绘制侧也换了"——不只是度量侧）
      //   这是本档最硬的一条：度量对而绘制没换 ⇒ 字被裁且报告全绿（本仓已有同族教训）
      fontActuallyChangedOnLayer: fontNames.size >= 2,
      // ★⑤ 两端词汇表一致（无未知角色回退）
      noFallback: ((withFamilies.mount?.font_family_fallbacks as number) ?? -1) === 0,
      // ★★⑥ `CGFont` 解析不得失败（失败 ⇒ **层上没有字体** ⇒ 绘制回退默认体、
      //   而度量用的是指定字体 ⇒ 度量/绘制分叉。本档首跑就抓到 monospace 命中此坑）
      cgFontResolved: ((withFamilies.mount?.cgfont_fallbacks as number) ?? -1) === 0,
      // ★⑦ 对照组确实被重建过（防"拆树没生效 ⇒ 两组是同一棵树"的假对照）
      controlRebuilt: withFamilies.w.join(',') !== allSystem.w.join(',')
        || withFamilies.font.join(',') !== allSystem.font.join(','),
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
    results.push({
      case: 'V13_font_family',
      note: `字体族 ${ROLES.join('/')}：宽度 [${withFamilies.w.join(', ')}] · 全 system [${allSystem.w.join(', ')}] · 层上字体 ${withFamilies.font.map((f) => f.split(':').pop()?.slice(0, 14) ?? '?').join(' | ')}`,
      items: ROLES.length, nodes: withFamilies.mount?.node_count ?? 0,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0,
      patch_count: 0, request_bytes: 0,
      extra: {
        verdict, checks, roles: ROLES, sample_text: TEXT,
        widths_by_family: withFamilies.w, widths_all_system: allSystem.w,
        fonts_by_family: withFamilies.font,
        mounts: { with_families: withFamilies.mount, all_system: allSystem.mount },
        covered: '适配器语义角色 → 宿主平台字体：度量差异 + 反例对照 + 层上字体名',
        // ★诚实边界：证明的是"字族改变了度量/绘制用的字体"（宽度 + 字体名）；
        //   **字形级**比对（衬线真的画出衬线）需与已知渲染对照，未做；自定义字体（@font-face）未支持
        not_covered: '字形级墨迹比对；自定义字体（@font-face / 打包字体）',
      },
    })
  },
})

/* V15 · ★★自定义字体（`custom:<族名>` 契约 + 注册通道）—— 2026-09-29 */
//
// 【与 V13 的差别】V13 测的是**语义角色**（system/serif/monospace → 平台系统字体）；
//   本档测**自定义字体**（@font-face / 打包字体）：族名以 `custom:<名>` 透传 → 宿主查注册表。
// 【判据设计（三条，缺一不可）】
//   ① 未注册 ⇒ **显式回退 system + 计数**（"缺字体资源"必须可见，不能静默）
//   ② 注册真实字体文件后 ⇒ **层上字体名变化**（不是"参数传到了"——V13 已确立这条纪律：
//      度量对而绘制没换 = 字被裁且报告全绿）
//   ③ 反例对照：同族名**注册前 vs 注册后** ⇒ 层上字体名必须不同（否则"注册"是空操作）
//   ★为什么用 `/System/Library/Fonts/Supplemental/` 下的字体：系统路径无需打包资源，
//     且这些字体（Georgia/Courier 等）与 SF 差异显著 ⇒ 判据不会因"字形太像"而假绿。
CASES.push({
  name: 'V15_custom_font',
  note: '★★自定义字体：custom:<族名> 契约 —— 未注册回退可见 + 注册后层上字体名变化 + 注册前后对照',
  fn: async () => {
    const TEXT = 'MMMM iii WWWW'
    const bridge = proteusSelfDraw as unknown as {
      mount: (j: string) => string
      clearTree?: () => string
      measureProbe?: (j: string) => string
      registerFont?: (j: string) => string
      customFontStats?: () => string
    }
    if (!bridge.mount || !bridge.clearTree || !bridge.measureProbe || !bridge.registerFont) {
      results.push({ case: 'V15_custom_font', note: '✗ 宿主入口不可用（缺 registerFont/measureProbe）',
        items: 0, nodes: 0, vue_ms: -1, to_request_ms: -1, serialize_ms: -1, host_ms: -1,
        total_ms: -1, patch_count: -1, request_bytes: -1 })
      return
    }

    // 候选**系统字体名**（`UIFont(name:)` 查找）——iOS 上按名引用是最常见形式，
    //   且不依赖打包资源。★首版用 macOS 的文件路径（`/System/Library/Fonts/Supplemental/…`），
    //   真机全失败——iOS 字体布局与 macOS 不同（本仓实测：不能照搬路径）。
    //   这些名字是 iOS 长期稳定的系统字体（与 SF 差异显著 ⇒ 判据不会因字形太像而假绿）。
    const SYSTEM_NAME_CANDIDATES = ['Georgia', 'Courier New', 'Times New Roman', 'Menlo']

    const build = (family: string): string => JSON.stringify({
      viewport: VP,
      nodes: [
        { id: 0, parentId: null, flexDirection: 'column', width: VP.width, height: VP.height },
        { id: 100, parentId: 0, flexDirection: 'row', alignItems: 'center',
          width: VP.width, height: 60, flexShrink: 0 },
        { id: 200, parentId: 100, text: TEXT, fontSize: 24, fontWeight: 400,
          fontFamily: family, flexShrink: 0 },
      ],
    })
    const probeLayerFont = (family: string): { w: number; font: string; mount: any } => {
      bridge.clearTree!()
      const m = safeParseAny(bridge.mount(build(family)))
      const p = safeParseAny(bridge.measureProbe!(JSON.stringify({ nodes: [200] })) ?? '{}')
      const e = ((p?.nodes ?? {}) as Record<string, { layer_w?: number; font_name?: string }>)['200'] ?? {}
      return { w: e.layer_w ?? -1, font: e.font_name ?? '', mount: m }
    }

    // ① 未注册：`custom:NoSuchFontAbc` ⇒ 回退 + 计数
    const missBefore = safeParseAny(bridge.customFontStats?.() ?? '{}')?.custom_font_misses ?? 0
    const unregistered = probeLayerFont('custom:NoSuchFontAbc')
    const missAfter = safeParseAny(bridge.customFontStats?.() ?? '{}')?.custom_font_misses ?? 0
    const unregisteredCounted = (missAfter as number) > (missBefore as number)

    // ② 注册真实字体 ⇒ 层上字体名变化 + 宽度
    let registeredName = ''
    let registeredOk = false
    let after: { w: number; font: string; mount: any } | null = null
    for (const name of SYSTEM_NAME_CANDIDATES) {
      const r = safeParseAny(bridge.registerFont(JSON.stringify({ family: 'MyAppFontV15', systemName: name })) ?? '{}')
      if (r?.registered) {
        registeredOk = true
        registeredName = name
        after = probeLayerFont('custom:MyAppFontV15')
        break
      }
    }

    // ③ 反例对照：注册前同族名（清注册表后）——必须与注册后不同
    //   （`clearCustomFonts` 未导出，故用"另一个未注册族名"作等效对照：两者都落 system）
    const before = probeLayerFont('custom:MyAppFontV15Never')   // 未注册 ⇒ system
    const fontNames = new Set([unregistered.font, after?.font ?? '', before.font].filter(Boolean))

    const checks = {
      // ① 未注册必须计数（否则"缺字体"静默）
      unregisteredCounted,
      // ② 注册成功（系统字体文件可解析）
      registeredOk: registeredOk && !!after,
      // ③ 注册后**层上字体名**与未注册时不同（证明注册真的换掉了绘制字体）
      layerFontChanged: !!after && after.font !== before.font && after.font.length > 0,
      // ④ 至少见到两种不同层上字体（未注册=system vs 注册=custom）
      distinctLayerFonts: fontNames.size >= 2,
      // ⑤ 注册后宽度可比（未注册时也应有宽度——防"层没建出来"的假绿）
      bothHaveWidth: before.w > 0 && (after?.w ?? -1) > 0,
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
    results.push({
      case: 'V15_custom_font',
      note: `自定义字体：未注册→回退计数 ✓ · 注册 ${registeredName || '?'} → 层上字体 `
        + `${before.font.split(':').pop()?.slice(0, 16) ?? '?'} → ${after?.font.split(':').pop()?.slice(0, 16) ?? '?'}`,
      items: 1, nodes: 3,
      vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0,
      patch_count: 0, request_bytes: 0,
      extra: {
        verdict, checks,
        font_source: registeredName,
        width_unregistered: unregistered.w,
        width_before_register: before.w,
        width_after_register: after?.w ?? -1,
        layer_font_unregistered: unregistered.font,
        layer_font_before: before.font,
        layer_font_after: after?.font ?? '',
        misses_delta: (missAfter as number) - (missBefore as number),
        covered: 'custom:<族名> 契约透传 → 宿主注册表 → 层上实际字体（度量与绘制同源）+ 未注册显式降级',
        not_covered: 'CSS 候选链的后续回退（"MyFont", serif 在 MyFont 未注册时落 system，不落到 serif）',
      },
    })
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
    let payload: unknown
    if (patches === null) {
      payload = app.adapter.toRequest(VP)
    } else {
      payload = patches
    }
    const tReq = now()
    // ★序列化独立打点（与 S5 同修：初版 serialize_ms == host_ms，无法归因搬运成本在哪一侧）
    const payloadJson = JSON.stringify(payload)
    const tSer = now()
    const bytes = payloadJson.length
    const hostOut = patches === null
      ? proteusSelfDraw.update(payloadJson)
      : proteusSelfDraw.updatePatches(payloadJson)
    const tHost = now()
    const h = safeParseAny(hostOut)
    results.push({
      case: 'S6_worst_reverse',
      note: `1000 项 reverse（最坏情形）`,
      items: N, nodes: 0,
      vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tSer - tReq,
      host_ms: tHost - tSer, total_ms: tHost - t0,
      patch_count: app.adapter.patchCount(), request_bytes: bytes,
      extra: { relayout: h?.["relayout_count"], patches_sent: patches === null ? 'FULL' : patches.length,
               // ★整树重排路径的分段（持久引擎的靶子：relayout_ms 应显著下降）
               relayout_ms: h?.["relayout_ms"], idmap_ms: h?.["idmap_ms"], collect_ms: h?.["collect_ms"],
               updated_layers: h?.["updated_layers"], layer_count: h?.["layer_count"] },
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
                 per_node_us: Math.round((total / req.nodes.length) * 1000) / 1000 * 1000,
                 // ★度量缓存读数（跨节点复用的判据：500 行同文案应**只真实度量少数次**）
                 measure_hits: h?.["measure_cache_hits"], measure_misses: h?.["measure_cache_misses"],
                 // ★字体维度进键的证据（文本节点带 textStyleKey ⇒ 内容寻址生效且安全）
                 text_nodes_with_key: req.nodes.filter((n) => typeof (n as { textStyleKey?: number }).textStyleKey === 'number').length,
                 text_nodes_total: req.nodes.filter((n) => (n as { text?: string }).text !== undefined).length },
      })
      markCeiling('scale', `${n} 项挂载`, total, '整链挂载耗时（含 Vue）')
      app.dispose()          // ★释放（否则内存累积，后续档位的读数不可归因）
    },
  })
}


} catch (e) { INIT_DIAG.errors.push('S 组注册失败: ' + String((e as Error)?.message ?? e)) }
INIT_DIAG.stages.push('after-S:' + CASES.length)

/* ────────────────────────── 宿主驱动的用例执行器 ────────────────────────── */

/**
 * ★★用例过滤（宿主 `--cases=S5,V4` 注入 `__PROTEUS_CASES__`）——定向验证用
 *
 * 【为什么需要（效率纪律）】bench 46 个用例全套数分钟；验证单个改动往往只需 2–4 个。
 *   前缀匹配（`S5` 命中 `S5_structure_change`）——够用且好记。
 *   未注入 = 跑全部（与既有行为一致）。
 */
const CASE_FILTER: string[] = ((globalThis as unknown as { __PROTEUS_CASES__?: string[] }).__PROTEUS_CASES__) ?? []
const SELECTED = CASE_FILTER.length > 0
  ? CASES.filter((c) => CASE_FILTER.some((f) => c.name.startsWith(f)))
  : CASES
if (CASE_FILTER.length > 0) {
  // 过滤后为空 ⇒ 过滤词写错了，必须可观测（否则表现为"跑完 0 个用例"，无从归因）
  ;(globalThis as unknown as { __PROTEUS_CASE_SELECTION__?: unknown }).__PROTEUS_CASE_SELECTION__ =
    { filter: CASE_FILTER, matched: SELECTED.map((c) => c.name) }
}

let idx = 0
let chain: Promise<void> = Promise.resolve()

const api = {
  /** 用例清单（宿主据此知道总数） */
  cases: (): string => JSON.stringify(SELECTED.map((c) => ({ name: c.name, note: c.note }))),

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
    if (idx >= SELECTED.length) {
      return JSON.stringify({ done: true, completed: executedCases, total: SELECTED.length })
    }
    const c = SELECTED[idx++]
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
    return JSON.stringify({ started: c.name, index: idx, total: SELECTED.length,
                            completed: executedCases, results: results.length })
  },

  /**
   * ★★★六端 SFC 压力夹具渲染（2026-10-02）——渲染 `examples/pages/consistency-stress.vue`
   *   的编译产物（`vapor-stress.json`：LayoutTemplate + 订阅表 + **数据快照**）。
   *
   * 【与 Android 侧 `runStress` 完全同构】两端都从**同一个共享 SFC 文件**编译
   *   （构建期 gen-vapor-table.mjs / gen-vapor-fixture.mjs 各产一份，源相同）。
   *   实例化 → `proteusSelfDraw.mount`（Rust 内核 + CALayer 自绘）——**iOS 这一端渲染真 SFC**。
   *
   * 【为什么放在 bench 入口】iOS 的 JSC 宿主只有一个 bundle 能跑（bench bundle）；
   *   stress 渲染是"一次性挂载 + 截图"，不需要 bench 的用例驱动——宿主直接调本方法即可。
   *
   * @returns 渲染读数 JSON（节点数/文本数/数据行/宿主耗时——截图的机器判据用）
   */
  /**
   * ★★★矩阵 #10：**原生组件混用**（iOS 腿）——自绘 + 原生 UIView 共存。
   *
   * 【与 Android native-host 场景同规格】六行纵向布局（各 40pt 高），其中：
   *   · seq 3 = **native_host:true** 的节点（200pt 高——宿主建 UIKit 视图）
   *   · seq 5 = **绝对定位**在与 native 重叠位置的**自绘色块**（z-order 判据）
   * 其余自绘。
   *
   * 【返回】核心真源几何（`native_hosts` 清单 + 该节点 rect + 重叠块 rect）——Swift 据此建
   *   UIView 的 frame（**位置由核心决定**，宿主不自己算）。
   */
  renderNativeMix: (): string => {
    const T = 0.0
    const ROW_H = 40.0
    const HOST_H = 200.0
    const W = VP.width
    // 节点表（id 从 2 起——1 是根）：{h, kind} kind: 0 自绘 / 1 native-host / 2 重叠自绘
    const rows: Array<{ h: number; kind: number }> = [
      { h: ROW_H, kind: 0 }, { h: ROW_H, kind: 0 }, { h: ROW_H, kind: 0 },
      { h: HOST_H, kind: 1 },                       // native-host（200 高）
      { h: ROW_H, kind: 0 },
      { h: ROW_H, kind: 2 },                        // ★与 native-host 重叠（绝对定位）
    ]
    const nodes: Array<Record<string, unknown>> = [
      { id: 1, parentId: null, width: W, flexDirection: 'column' },
    ]
    // 先按流式排出各行的 y（native-host 那行占 HOST_H）；重叠行用绝对定位钉在 native 的 top 上
    let flowY = T
    let nid = 2
    let hostNodeId = -1
    let hostTop = -1
    const rowMeta: Array<{ id: number; kind: number; x: number; y: number; w: number; h: number }> = []
    for (const r of rows) {
      const isOverlap = r.kind === 2
      const y = isOverlap ? hostTop : flowY
      // ★重叠块宽度取一半：露出「右上角原生、左下角自绘」两区（采样点各自可判）
      const w = isOverlap ? W * 0.5 : W
      nodes.push({
        id: nid,
        parentId: 1,
        width: w,
        height: r.h,
        ...(isOverlap
          ? { position: 'absolute', top: y, left: 0 }
          : {}),
        ...(r.kind === 1 ? { nativeHost: true } : {}),
        backgroundColor: r.kind === 2 ? '#2f6fed' : (r.kind === 1 ? '#1b1b21' : '#2a2a35'),
      })
      if (r.kind === 1) { hostNodeId = nid; hostTop = flowY }
      rowMeta.push({ id: nid, kind: r.kind, x: 0, y, w, h: r.h })
      if (!isOverlap) flowY += r.h
      nid++
    }
    const mountOut = safeParseAny(
      proteusSelfDraw.mount(JSON.stringify({ viewport: { width: W, height: flowY + 400 }, nodes })),
    ) as {
      ok?: boolean; error?: string; cmds?: number; nodes?: number
      native_hosts?: number[]
      rects?: Record<string, { x: number; y: number; width: number; height: number }>
    } | null
    // ★从**核心回执**读 native_hosts 清单（与 Android 同纪律：IR 判定谁是 native-host 与宿主建 View 同源）
    const hostIds = (mountOut?.native_hosts ?? []) as number[]
    const rects = (mountOut?.rects ?? {}) as Record<string, { x: number; y: number; width: number; height: number }>
    const hostIdFromCore = hostIds.length > 0 ? hostIds[0]! : hostNodeId
    const hr = rects[String(hostIdFromCore)]
    const overlapRow = rowMeta.find((m) => m.kind === 2)
    const or_ = overlapRow ? rects[String(overlapRow.id)] : undefined
    return JSON.stringify({
      ok: mountOut?.ok === true && hostIds.length > 0,
      path: 'native-mix',
      native_hosts: hostIds,
      native_host_node_id: hostIdFromCore,
      native_host_rect: hr ?? { x: 0, y: 0, width: 0, height: 0 },
      overlap_rect: or_ ?? { x: 0, y: 0, width: 0, height: 0 },
      cmds: mountOut?.cmds ?? -1,
      nodes: mountOut?.nodes ?? -1,
      layout_ms: (mountOut as { layout_ms?: number } | null)?.layout_ms ?? -1,
      spec: { row_h: ROW_H, host_h: HOST_H, rows: rows.length, width: W },
    })
  },

  renderStress: (): string => {
    const t0 = now()
    const stress = vaporStressJson as unknown as {
      ok: boolean
      tpl: import('@proteus-vue/slot-runtime').LayoutTemplate
      table: import('@proteus-vue/slot-runtime').SubscriptionTable
      data?: Record<string, unknown>
      diagnostics?: string[]
    }
    const diag: string[] = stress.diagnostics ? [...stress.diagnostics] : []
    if (!stress.ok || !stress.tpl) {
      return JSON.stringify({ ok: false, error: '模板产物不可用（vapor-stress.json）', diagnostics: diag })
    }
    const data = (stress.data ?? {}) as Record<string, unknown>
    const list = Array.isArray(data.list) ? (data.list as unknown[]) : []
    const registry = new ListRegistry()
    const inst = instantiateTemplate(stress.tpl, {
      viewport: VP,
      read: (n: string) => data[n],
      table: stress.table,
      registry,
    })
    const nodes = inst.nodes as unknown as Array<Record<string, unknown>>
    const texts = nodes.filter((n) => typeof n.text === 'string' && String(n.text).length > 0).length
    // ★一次调用完成建树与读数（宿主 mount 的回执里带几何/指令读数——本仓接口无独立读几何方法）
    const mountOut = safeParseAny(
      proteusSelfDraw.mount(JSON.stringify({ viewport: VP, nodes })),
    ) as {
      ok?: boolean
      error?: string
      layout_ms?: number
      measure_ms?: number
      cmds?: number
      nodes?: number
      /** 锚点节点（id=1）的矩形——宿主回执里有则带上（截图侧的锚定归一交叉验证用） */
      anchor?: { x: number; y: number; width: number; height: number }
    } | null
    return JSON.stringify({
      ok: mountOut?.ok === true,
      path: 'stress-sfc',
      src: 'examples/pages/consistency-stress.vue',
      // ★build_id 随读数带出（2026-10-02）：stress 报告由宿主 driveStress 组装（不经 finish），
      //   而采集脚本的新鲜度/build_id 断言读 `js_report.build_id` ⇒ 必须在读数里就有。
      build_id: BUILD_ID,
      tpl_nodes: stress.tpl.nodes.length,
      sub_l1: stress.table?.stats?.l1 ?? -1,
      inst_nodes: nodes.length,
      inst_texts: texts,
      inst_rows: inst.virtual?.rows.length ?? 0,
      data_rows: list.length,
      mount_ms: Math.round((now() - t0) * 100) / 100,
      host_layout_ms: mountOut?.layout_ms ?? -1,
      host_measure_ms: mountOut?.measure_ms ?? -1,
      host_cmds: mountOut?.cmds ?? -1,
      host_nodes: mountOut?.nodes ?? -1,
      anchor_rect: mountOut?.anchor ? [mountOut.anchor.x, mountOut.anchor.y, mountOut.anchor.width, mountOut.anchor.height] : null,
      viewport: `${VP.width}x${VP.height}`,
      diagnostics: diag,
      note: '六端 SFC 压力夹具（iOS）：渲染 examples/pages/consistency-stress.vue 的编译产物',
    })
  },

  /**
   * ★★已完成的读数（**宿主驱动器靠它推进**——`driveBench` 的 `waitCase` 读 `completed`/`total`）
   *
   * 【删不得（本仓实测的教训）】宿主每轮泵完就调它，`completed` 不增长即"当前用例还在跑"。
   *   若本方法缺失 ⇒ 返回 null ⇒ `completed` 恒 0 ⇒ 每个用例空转到 `perCaseRoundLimit`
   *   才被跳过（3000 轮）⇒ 现象是"bench 卡住/被看门狗杀"，极难归因。
   */
  progress: (): string =>
    JSON.stringify({ completed: executedCases,        // ★用例数（与 SELECTED.length 同粒度）
                     results: results.length,          // 结果条数（可多于用例数）
                     total: SELECTED.length, started: idx,
                     cases: results.map((r) => r.case) }),

  /**
   * 收尾：写出完整报告（宿主最后调用）
   *
   * ★★本对象字面量里**只能有一个 `finish`**（本仓实测踩到）：此前存了两份（历史遗留），
   *   JS 语义是**后者覆盖前者** ⇒ 我改过的前一份**从不执行** ⇒ 现象是
   *   "字段加了但报告里没有"（与"改了没生效"同源的静默失败）。
   *   ⇒ 纪律：对象字面量的重复键必须消除；报告字段只维护这一份。
   */
  finish: (): string => {
    const summary = {
      kind: 'logic-bench',
      init_diag: INIT_DIAG,
      build_id: BUILD_ID,
      runtime: 'JavaScriptCore（系统自带）',
      viewport: VP,
      total_cases: SELECTED.length,
      case_filter: CASE_FILTER,        // ★非空 = 本次是**过滤跑**（定向验证，非全量基准）
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
    proteusSelfDraw.done(JSON.stringify({ ok: true, completed: executedCases, total: SELECTED.length }))
    return JSON.stringify({ ok: true, completed: executedCases })
  },
}

;(globalThis as unknown as { __proteus: Record<string, unknown> }).__proteus = api

/**
 * ★★V9：宿主触摸回调的**落点**（`SelfDrawBridge.onDispatchToJS` 调它）
 *
 * 【为什么是全局函数而不是 `__proteus` 的方法】宿主用
 * `ctx.objectForKeyedSubscript("__proteus_dispatch").call(withArguments:)` 直呼——
 * 顶层函数最直接（少一层属性解析，也便于宿主做存在性检查）。
 *
 * 【当前作用域（诚实边界）】本入口处理的是 **bench 场景**（`--bench`）的派发；
 *   自绘场景（`entry-selfdraw.ts`）需另接（其应用结构不同）。
 */
;(globalThis as unknown as { __proteus_dispatch?: unknown }).__proteus_dispatch = (
  target: number,
  chain: number[],
  type: string,
  x: number,
  y: number,
): string => {
  // ★适配器由 `bench-app` 的 `makeApp` 持有；这里通过"最近一次 mount 的应用"派发
  //   （bench 每个用例自建应用并 dispose ⇒ 用全局登记避免悬空引用）
  const d = (globalThis as unknown as { __proteusDispatchTarget?: { dispatchEvent: Function } })
    .__proteusDispatchTarget
  if (!d) return JSON.stringify({ ok: false, error: 'no-active-app' })
  try {
    // ★★矩阵 #7：swipe 方向解码——宿主触摸链带 `swipe:<dir>` 后缀（Swift 侧编码，见
    //   SelfDrawView.touchesEnded 三分支），此处**拆成语义名 + 方向**：
    //   · 适配器/handler 挂的是 `onSwipe`（归一为 `swipe`）⇒ type 必须还原为 `swipe`
    //   · 方向作为**事件属性**暴露（`e.direction`）供用例读（与 packages/gesture 的
    //     `GestureEvent{type:'swipe', direction}` 同形状）
    const m = /^swipe:(up|down|left|right)$/.exec(type)
    const r = m
      ? d.dispatchEvent(target, chain, 'swipe', x, y, { direction: m[1] })
      : d.dispatchEvent(target, chain, type, x, y)
    return JSON.stringify({ ok: true, ...r as object })
  } catch (e) {
    return JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })
  }
}
