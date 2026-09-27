// hosts/ios/bridge/entry-selfdraw.ts
// ★★★**标准 Vue 应用 → 自绘管线**（用户点名要验的那一环）+ **JS 逻辑层性能评估**
//
// 【这条链路要证明的事】
//   「Vue 整套在 App 端跑通」= 标准 Vue 组件 → Vue 自定义渲染器（`createRenderer`）
//   → 语义树 → **Rust 排版核心算几何** → 宿主自绘（CALayer）。
//   与既有竖切（`entry.ts`：Vue → UIView，布局交给 UIKit）的**本质差别**：
//   本链路里**没有任何 UIKit 布局参与** —— 几何全部来自 Rust 核心。
//
// 【★★为什么本文件导出「相位函数」而不是自己跑完（本轮最重要的架构发现）】
//   本仓用一个最小 JSC 程序**实测确认**：
//     `evaluateScript` **不会在里面排空微任务** —— `Promise.resolve().then(f)` 的 f
//     要等该次 evaluateScript **返回**后才执行（第二次 evaluateScript 才看得到它跑过）。
//   而 Vue 的更新调度**正是微任务**（`queueJob` → `Promise.then(flushJobs)`）：
//     · `mount` 是同步的（首次渲染直接完成）→ 单脚本内可用
//     · **`ref` 变更触发的重渲染是异步的** → 在同一个同步脚本里**永远不会发生**
//   现象（本仓实测）：`count.value = 30` 后立刻量 → patch 次数 0、节点数不变，
//   看起来像「响应式失效」，实际是**宿主集成方式**的问题。
//   ⇒ 正解：**由宿主逐相位调用**（每次 evaluateScript 之间微任务会排空）。
//     这也更贴近真实 App：更新由事件驱动、分散在时间轴上，而不是同步连跑。
//   ★这也是 NativeScript-Vue 不必处理此问题的原因：它跑在**完整集成的 runloop** 上，
//     VM 事件循环被持续泵动；而「evaluateScript 一个 bundle」是一次性执行模型。
//
// 【同步性（铁律 A-02）】每个相位函数内部**全同步**（无 await）；相位之间由宿主驱动。
//
// 【★JS 逻辑层性能评估量什么（用户第二个问题）】
//   ① mount：createApp + mount（响应式建立 + 首帧 VNode + 全量 patch）
//   ② update：分「结构路径」（列表增删）与「纯样式路径」（只改颜色）
//   ③ **边界成本**：树 → 布局请求 → JSON 字符串（跨 JSC↔原生 的序列化面）
//   ④ 纯 JS 吞吐：N 次连续更新（不调宿主）→ 每次均摊
//   ★与 NativeScript-Vue 的对照口径：NS-Vue 走 **FFI 直调**（无序列化），
//     本脚手架走 **JSON 字符串** —— ③ 就是差距来源，必须单独量出来而非混入总数。
import { h, ref, nextTick } from '@vue/runtime-core'
import { createAppRenderer } from '@proteus-vue/renderer-app'
import { createSelfDrawAdapter } from '@proteus-vue/renderer-app/adapters/selfdraw'

/* ────────────────────────── 宿主桥（Swift 经 JSExport 注入） ────────────────────────── */

interface SelfDrawNative {
  mount(treeJson: string): string
  update(treeJson: string): string
  snapshot(name: string): string
  report(json: string): void
  done(summaryJson: string): void
}
declare const proteusSelfDraw: SelfDrawNative
/** 快照名（宿主按模式注入；此处仅作默认） */
const BN = { snapshot: 'selfdraw-final' }

const VP = (globalThis as unknown as { __PROTEUS_VIEWPORT__?: { width: number; height: number } })
  .__PROTEUS_VIEWPORT__ ?? { width: 390, height: 844 }
const now = (): number => Date.now()
const safeParse = (s: string): unknown => {
  try { return JSON.parse(s) } catch { return { parse_error: s.slice(0, 200) } }
}

interface PhaseTiming {
  vue_ms: number         // Vue 自身（响应式 → 重渲染 → diff/patch → nodeOps）
  to_request_ms: number  // 适配器：渲染树 → 引擎就绪请求（数值折叠 + 拍平）
  serialize_ms: number   // ★边界成本：请求 → JSON 字符串（跨 JSC↔原生）
  host_ms: number        // 宿主侧（CoreText 度量 + Rust 布局 + 建 CALayer 树）
  total_ms: number
  node_count: number
  patch_count: number    // ★本次操作触发的 nodeOps 次数（patch 工作量的直接读数）
}

/* ────────────────────────── 应用（标准 Vue 写法，零原生 API） ────────────────────────── */

const count = ref(12)
const accent = ref('#6f4ae8')

const App = {
  name: 'SelfDrawListApp',
  render() {
    const n = count.value
    const c = accent.value
    const rows = Array.from({ length: n }, (_, i) =>
      h('p-view', {
        key: i,
        style: {
          flexDirection: 'row', alignItems: 'center',
          // ★flexShrink: 0 —— 列表项**不该被压缩**（真实列表语义；Android §9.2 规格同样用 flexShrink:0）
          //
          // 【为什么必须显式写：本轮实测发现（是**核心正确**的证据，不是 bug）】
          //   初版没写 → 12 张卡片内容总高 886 > 视口 844 → 溢出 42px；
          //   而 CSS 的 `flex-shrink` **默认 1** ⇒ 卡片被均摊压缩 42/12=3.5 → 实测高 52.5（52~53）。
          //   ★核心算的完全正确（与真实 CSS 语义一致），是**场景规格**要求了放不下的内容。
          //   这同时说明：自绘管线的 flex-shrink **真的生效了**，不是「看起来像布局」。
          height: 56, flexShrink: 0, margin: { bottom: 8 }, padding: { left: 16, right: 16 },
          backgroundColor: '#1b1b21', borderRadius: 12,
        },
      }, [
        h('p-view', { style: { width: 36, height: 36, backgroundColor: c, borderRadius: 18 } }),
        h('p-view', { style: { flexGrow: 1, margin: { left: 12 } } }, [
          h('p-text', { style: { fontSize: 16, color: '#ffffff' } }, `列表项 ${i + 1}`),
          h('p-text', { style: { fontSize: 13, color: '#9aa3b2' } }, i % 3 === 0 ? '分组标题' : '说明文字'),
        ]),
      ]),
    )
    return h('p-view', {
      style: {
        flexDirection: 'column', width: VP.width, height: VP.height,
        backgroundColor: '#101020', padding: { top: 60, left: 16, right: 16 },
      },
    }, [
      h('p-text', { style: { fontSize: 28, color: '#ffffff', margin: { bottom: 4 } } }, 'Proteus · 自绘管线'),
      h('p-text', { style: { fontSize: 14, color: '#9aa3b2', margin: { bottom: 20 } } },
        `Vue → 自定义渲染器 → Rust 核心 → CALayer（${n} 项）`),
      ...rows,
    ])
  },
}

const adapter = createSelfDrawAdapter()
const renderer = createAppRenderer(adapter)
const container = adapter.createElement('p-view')
adapter.root.children.push(container)
container.parent = adapter.root

const phaseOut: Record<string, PhaseTiming> = {}
let mountCreated = { elements: 0, texts: 0 }
const jsOnly: number[] = []
let throughputChain: Promise<void> | null = null

/**
 * 一次「变更 → 渲染 → 树 → 边界 → 宿主」的完整测量。
 *
 * ★异步：Vue 的更新是**微任务**（queueJob → Promise.then）。这里用 `nextTick` 串起来，
 *   而微任务要等**本次 evaluateScript 返回**才排空 ⇒ 宿主必须**再调一次**读结果（见 `pending()`）。
 */
function measureAsync(
  label: string,
  t0: number,
  mutate: () => void,
  hostCall: (treeJson: string) => string,
): void {
  mutate()
  nextTick()
    .then(() => {
      const tVue = now()
      const req = adapter.toRequest(VP)
      const tReq = now()
      const treeJson = JSON.stringify(req)
      const tSer = now()
      hostCall(treeJson)
      const tHost = now()
      phaseOut[label] = {
        vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tSer - tReq,
        host_ms: tHost - tSer, total_ms: tHost - t0,
        node_count: req.nodes.length, patch_count: adapter.patchCount(),
      }
    })
    .catch((e: unknown) => {
      // ★不吞异常：静默失败会表现为「这个相位没记录」，无从归因（本仓已多次踩到）
      phaseErrors[label] = String((e as { message?: string })?.message ?? e)
    })
}

/** ★相位异常（必须可观测——静默失败是本仓反复记录的坑） */
const phaseErrors: Record<string, string> = {}

/** 供宿主逐相位调用（每个函数在**自己那次 evaluateScript** 里同步启动，微任务在其后排空） */
const api = {
  /** ① mount（同步：Vue 首次渲染不经过调度器） */
  mount(): string {
    adapter.resetStats()
    const t0 = now()
    renderer.createApp(App).mount(container)
    const tVue = now()
    const req = adapter.toRequest(VP)
    const tReq = now()
    const treeJson = JSON.stringify(req)
    const tSer = now()
    const hostOut = proteusSelfDraw.mount(treeJson)
    const tHost = now()
    // ★建树刻度必须在此刻取：后面每段都 resetStats()，留到最后读会变成「最后一次更新期间
    //   新建的节点数」（实测 0，易被误读成「一个节点都没建」）——同内存测量「窗口自包含」纪律。
    mountCreated = adapter.createdCount()
    phaseOut.mount = {
      vue_ms: tVue - t0, to_request_ms: tReq - tVue, serialize_ms: tSer - tReq,
      host_ms: tHost - tSer, total_ms: tHost - t0,
      node_count: req.nodes.length, patch_count: adapter.patchCount(),
    }
    return JSON.stringify({ phase: 'mount', timing: phaseOut.mount, host: safeParse(hostOut), created: mountCreated })
  },

  /** ② 结构路径：列表 12 → 30 项 */
  updateGrow(): string {
    adapter.resetStats()
    // ★★这里必须用**闭包包一层**，不能直接传 `proteusSelfDraw.update`：
    //   JSExport 的方法需要 `this` 是宿主对象本身，裸传引用会丢接收者 →
    //   运行时报 `self type check failed for Objective-C instance method`
    //   （本仓实测踩到；症状是「该相位静默不记录」——因为异常被 catch 吞了）。
    measureAsync('update_grow', now(), () => { count.value = 30 }, (j) => proteusSelfDraw.update(j))
    return JSON.stringify({ phase: 'update_grow', scheduled: true })
  },

  /** ③ 纯样式路径：只改强调色（无结构变化） */
  updateStyle(): string {
    adapter.resetStats()
    measureAsync('update_style', now(), () => { accent.value = '#e85a4a' }, (j) => proteusSelfDraw.update(j))
    return JSON.stringify({ phase: 'update_style', scheduled: true })
  },

  /**
   * ④ ★纯 JS 吞吐：N 次连续更新（**不调宿主**）
   *
   * 为什么单独量：② ③ 的 host_ms 含「整树重发 + 重建 CALayer」，那是**宿主侧**成本；
   * JS 逻辑层自己的吞吐必须隔离测，否则会得出「JS 很慢」的错误归因（本仓已有多次此类教训）。
   * ★Vue 更新异步 ⇒ N 次须逐个 nextTick 串行推进；链挂在 `throughputChain`，
   *   由宿主连续调用 `pending()`（每次 evaluateScript 排空一批微任务）直至完成。
   */
  throughput(): string {
    const N = 40
    let chain = Promise.resolve()
    for (let i = 0; i < N; i++) {
      chain = chain.then(() => {
        const a = now()
        count.value = 12 + (i % 20)
        return nextTick().then(() => {
          void adapter.toRequest(VP)      // 含：树拍平 + 数值折叠
          jsOnly.push(now() - a)
        })
      })
    }
    throughputChain = chain
    return JSON.stringify({ phase: 'throughput', scheduled: N })
  },

  /** 收尾（第一段）：把状态稳定到最终形态（★改 ref 同样需一个微任务轮次才落地） */
  finalize(): string {
    count.value = 12
    accent.value = '#6f4ae8'
    return JSON.stringify({ phase: 'finalize', mark: 'pending-flush' })
  },

  /** 收尾（第二段）：此时微任务已排空 —— 生成最终画面、截图、上报 */
  finalize2(): string {
    const req = adapter.toRequest(VP)
    const hostOut = proteusSelfDraw.update(JSON.stringify(req))
    const shot = proteusSelfDraw.snapshot(BN.snapshot)
    const jsAvg = jsOnly.length > 0 ? jsOnly.reduce((x, y) => x + y, 0) / jsOnly.length : -1
    const report = {
      runtime: 'JavaScriptCore（系统自带，与 iOS 竖切同一运行时）',
      viewport: VP,
      phases: phaseOut,
      js_only_throughput: {
        iterations: jsOnly.length,
        avg_ms: jsAvg >= 0 ? Math.round(jsAvg * 1000) / 1000 : -1,
        max_ms: jsOnly.length > 0 ? Math.max(...jsOnly) : -1,
        note: '★每次 = Vue 响应式变更 → 重渲染 → diff/patch → 树拍平 → 数值折叠（**不含**宿主调用与 JSON 序列化）',
      },
      phase_errors: phaseErrors,
      created_nodes_at_mount: mountCreated,
      created_nodes_after_all: adapter.createdCount(),
      // ★未知键必须为空：非空即「写了但没生效」（本仓实测正是靠它抓到 style 未展开）
      unknown_keys: (adapter as unknown as { unknownKeys?: () => Record<string, number> }).unknownKeys?.() ?? {},
      host_final_raw: safeParse(hostOut),
      snapshot: safeParse(shot),
      notes: [
        '★本链路里没有任何 UIKit 布局参与：几何全部来自 Rust 排版核心',
        '★边界成本 = serialize_ms（JSON 字符串跨 JSC↔原生）；NativeScript-Vue 走 FFI 直调，无此项',
        '★update_grow 走结构路径（12→30 项）；update_style 走纯 patch 路径（只改颜色）',
        '★★相位由**宿主驱动**：实测 JSC 的 evaluateScript 不排空微任务，而 Vue 的更新调度正是微任务',
        '★宿主每次 update 都重建整棵树 + 全部 CALayer —— 属脚手架现状，不是架构结论',
      ],
    }
    proteusSelfDraw.report(JSON.stringify(report))
    proteusSelfDraw.done(JSON.stringify({ ok: true, phases: Object.keys(phaseOut).length, js_avg_ms: jsAvg }))
    return JSON.stringify({ phase: 'finalize2', done: true, phases: Object.keys(phaseOut), js_avg_ms: jsAvg })
  },
}

;(globalThis as unknown as { __proteus: Record<string, unknown> }).__proteus = {
  ...api,
  /**
   * 宿主读相位结果（**在下一次** evaluateScript 里调用，此时上一轮排的微任务已排空）。
   *
   * ★同时承担「泵动微任务」的职责：链式 Promise 每被读一次就前进一步——
   *   这正是把「VM 事件循环」在一次性执行模型下**手工补上**的做法。
   */
  pending: () => {
    if (throughputChain) {
      // 链已挂在微任务队列上；本次 evaluateScript 返回后它会推进一批
      void throughputChain
    }
    return JSON.stringify({ phases: Object.keys(phaseOut), timings: phaseOut, js_samples: jsOnly.length })
  },
}
