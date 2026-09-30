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
  updatePatches(patchesJson: string): string
  /** ★V10：绘制补丁（颜色/圆角/字重/字号/透明度）——几何之外的第二条通道（不经核心） */
  paintPatches(patchesJson: string): string
  snapshot(name: string): string
  report(json: string): void
  done(summaryJson: string): void
  // ★★RT2（2026-09-30）：指令驱动动画——曲线求值在 Rust 侧，宿主每帧推进
  layerTransformProbe(idsJson: string): string
  animStopNodes(idsJson: string): string
  animStart(json: string): string
  animSeek(json: string): string
  animTick(dtMs: number): string
  animStartFrameLoop(): string
  animStopFrameLoop(): string
  animFrameStats(): string
  // ★★RT2 帧率测席（§9 指标测量）
  animBenchStart(json: string): string
  animBenchResults(): string
}
declare const proteusSelfDraw: SelfDrawNative
/** 快照名（宿主按模式注入；此处仅作默认） */
const BN = { snapshot: 'selfdraw-final' }

// ★构建标识（每次构建由 hosts/ios/bridge/inject-build-id.mjs 注入；与 entry-bench 同机制）
//   —— 「设备上跑的是哪份代码」必须可**一眼判定**（报告新鲜度判据的内容锚点）。
const BUILD_ID = 'ed51e48a-110628'

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
const hostRawByPhase: Record<string, unknown> = {}

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
      // ★存下宿主原始返回（含 incremental / patch_count / relayout_count 三读数）
      hostRawByPhase[label] = safeParse(hostCall(treeJson))
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

/** ★★RT2 动画相位读数（finalize2 带进报告；见 animProbe） */
let animRt2Result: Record<string, unknown> = {}

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

  /**
   * ★★**RT2 帧率测席**（§9：转场帧率 / 帧耗时 P95 / 掉帧率）
   *
   * 【与 animProbe 的分工】animProbe 验**机制与正确性**（同步、毫秒级）；本相位测**长时间性能**——
   *   启动一段持续动画 + 每帧模拟手指跟随，由宿主 CADisplayLink 跑满真实时长后汇总。
   *
   * 【为什么本相位不阻塞 JS】它只负责**发起**；宿主跑满时长（事件驱动）后回调相位链继续
   *   （见宿主 `schedulePhases` 的停车分支）——JS 从不等待，也不轮询。
   *
   * 【诚实边界】① 帧率上限受设备刷新率（iPhone 12 = **60Hz**）⇒ §9 的「120 FPS」目标
   *   需 ProMotion 设备验证，本轮如实标注；② 本测席量的是**宿主每帧工作**
   *   （tick + seek + 写层）——JS 侧成本为 0 是设计目标（曲线求值在内核）。
   */
  animBench(): string {
    // 目标节点：复用 layerTransformProbe（不猜 id、不手算坐标——本仓纪律）
    const probeIds = [2, 3, 4, 5, 6, 7, 8]
    const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify(probeIds)))
    const present = ((probe as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? [])
      .filter((l) => !l.missing)
      .map((l) => l.id)
    const targets = present.length ? present : [2]
    const yNodes = targets // Y 动画（持续时长 = 测席时长）
    const gestureNode = targets[0]
    const started = safeParse(
      proteusSelfDraw.animBenchStart(
        JSON.stringify({
          durationMs: 3000,
          nodeIds: yNodes,
          amp: 60,
          gestureNodeId: gestureNode,
          gestureFrom: 0,
          gestureTo: 80,
        }),
      ),
    )
    return JSON.stringify({ phase: 'animBench', started, targets })
  },

  /**
   * ★★**RT2 动画相位（真机验证）**：启动动画 → 逐帧 tick → 校验变换真的落到层上
   *
   * 【这一相位要回答什么（RT0 是桌面微基准，这里是真机）】
   *   ① 指令真的能驱动端上动画（**曲线求值在 Rust 侧**，JS 只发启动参数）；
   *   ② `tick` 的二进制返回被宿主**真的应用**到层上（读层上 transform 复核——不是"调了就算"）；
   *   ③ 帧循环（CADisplayLink）真的在跑（帧计数增长 + dt 是真实 vsync 间隔）；
   *   ④ 手势驱动（`seek`）**立即生效**（不等帧）。
   *
   * 【判据设计（本仓纪律：不是"跑通了"）】见 `check-anim-rt2.py`——
   *   层上 transform 必须随进度变化，且终值必须精确等于目标（端点钉死）。
   */
  animProbe(): string {
    const t0 = now()
    // ★目标节点：取**真实存在于层表**的两个（探针先问宿主哪些 id 有层 ⇒ 不猜、不手算——本仓纪律）
    const probeIds = [2, 3, 4, 5]
    const before = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify(probeIds)))
    const layersBefore = (before as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? []
    const present = layersBefore.filter((l) => !l.missing).map((l) => l.id)
    const targetA = present[0] ?? 2
    const targetB = present[1] ?? targetA

    // ① 启动两条动画：位移（time 驱动）+ 缩放（progress 驱动，供 seek 用）
    const startOut = proteusSelfDraw.animStart(
      JSON.stringify({
        anims: [
          { nodeId: targetA, kind: 0, curve: 1, from: 0, to: 120, durMs: 300 },
          { nodeId: targetB, kind: 2, curve: 1, from: 0.6, to: 1.0, durMs: 300, drive: 1 },
        ],
      }),
    )

    // ② 手势驱动：seek 到 50% ⇒ 应当**立即**在层上生效（不等 tick）
    const seekOut = proteusSelfDraw.animSeek(JSON.stringify({ nodeId: targetB, kind: 2, progress: 0.5 }))
    const afterSeek = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([targetA, targetB])))

    // ③ 时间驱动：手动 tick 到终点（保证确定性——不依赖真实帧节奏）
    //    ★同时验证"tick 返回 applied>0"（宿主真的写了层）
    const tickOut1 = proteusSelfDraw.animTick(150)
    const mid = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([targetA, targetB])))
    const tickOut2 = proteusSelfDraw.animTick(200) // 累计 350ms > 300ms ⇒ 已到终点
    const end = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([targetA, targetB])))

    // ③-b ★§7.3 节点复用解绑（专项判据）：起一条动画 → 停它 → 再 tick 必须**不再改动**
    //
    // 【为什么单列（Morpheus §7 明确要求）】本仓复用率 0.997 ⇒ 节点会被回收给别的数据项。
    //   若动画未解绑：重物化时显示"半路的变换"（错位）+ 每帧白算——两者都静默。
    // ★探针顺序修正（首版缺陷，真机抓出）：前一段的 tick(200) 已让 targetA 的动画**自然结束并被移除**
    //   ⇒ 那时再 stop 得到 stopped=0，**看着像"没调用 stop_nodes"**，实为"已无动画可停"（探针缺陷）。
    //   ⇒ 正解：**先起一条新的**（长时长，确保仍在活动），再停它——这才真正检验"解绑"。
    const _seed = proteusSelfDraw.animStart(
      JSON.stringify({ anims: [{ nodeId: targetA, kind: 0, curve: 0, from: 0, to: 60, durMs: 5000 }] }),
    )
    const stopBefore = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([targetA])))
    // ★报文形状：FFI 期望 `{"nodeIds":[…]}`（**不是裸数组**）——首版传了裸数组 ⇒ 内核
    //   正确拒绝（ok:false）**不是静默**，但探针把 removed 读成 0 ⇒ 看着像"解绑失败"。
    //   （这反而验证了内核的入参校验有效；探针已修。）
    const stopCall = safeParse(proteusSelfDraw.animStopNodes(JSON.stringify({ nodeIds: [targetA] })))
    const tickAfterStop = safeParse(proteusSelfDraw.animTick(100))
    const stopAfter = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([targetA])))
    const txBefore = ((stopBefore as { layers?: Array<{ id: number; tx: number }> }).layers ?? [])[0]?.tx ?? 0
    const txAfter = ((stopAfter as { layers?: Array<{ id: number; tx: number }> }).layers ?? [])[0]?.tx ?? 0
    const recycleUnbind = {
      stopped: (stopCall as { removed?: number }).removed ?? 0,
      moved_after_stop: Math.abs(txAfter - txBefore) > 0.001 ? 1 : 0,
      tx_before: txBefore,
      tx_after: txAfter,
      tick_after_stop: tickAfterStop,
    }

    // ④ 真实帧循环：启动 → 让宿主自己跑若干帧 → 读数
    const loopStart = proteusSelfDraw.animStartFrameLoop()
    const stats1 = safeParse(proteusSelfDraw.animFrameStats())
    const loopStop = proteusSelfDraw.animStopFrameLoop()
    const stats2 = safeParse(proteusSelfDraw.animFrameStats())

    phaseOut.animProbe = { vue_ms: 0, to_request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: now() - t0, node_count: 0, patch_count: 0 }
    const _r = {
      phase: 'animProbe',
      targets: [targetA, targetB],
      start: safeParse(startOut),
      seek: safeParse(seekOut),
      tick1: safeParse(tickOut1),
      tick2: safeParse(tickOut2),
      loopStart: safeParse(loopStart),
      loopStop: safeParse(loopStop),
      // ★层上读数（宿主从 CALayer 真读——不是回显我们自己的输入）
      layer_after_seek: afterSeek,
      layer_mid: mid,
      layer_end: end,
      recycle_unbind: { ...recycleUnbind, seed: safeParse(_seed), stop_raw: stopCall },
      frame_stats_1: stats1,
      frame_stats_2: stats2,
      host_tick_bytes: (safeParse(tickOut1) as { bytes?: number }).bytes,
    }
    // ★存进模块级变量：finalize2 生成报告时带上（否则判据脚本读不到——只有 NSLog 前 400 字符）
    animRt2Result = _r
    return JSON.stringify(_r)
  },

  /** 收尾（第二段）：此时微任务已排空 —— 生成最终画面、截图、上报 */
  finalize2(): string {
    const req = adapter.toRequest(VP)
    const hostOut = proteusSelfDraw.update(JSON.stringify(req))
    const shot = proteusSelfDraw.snapshot(BN.snapshot)
    const jsAvg = jsOnly.length > 0 ? jsOnly.reduce((x, y) => x + y, 0) / jsOnly.length : -1
    const report = {
      build_id: BUILD_ID,
      runtime: 'JavaScriptCore（系统自带，与 iOS 竖切同一运行时）',
      viewport: VP,
      phases: phaseOut,
      // ★★RT2 动画读数（真机判据的输入——见 hosts/ios/check-anim-rt2.py）
      anim_rt2: animRt2Result,
      // ★★RT2 帧率测席（§9 指标；宿主跑满时长后写入）
      anim_bench: safeParse(proteusSelfDraw.animBenchResults()),
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
      // ★★每个相位的宿主原始返回（增量读数在这里，逐相位可比）
      host_raw_by_phase: hostRawByPhase,
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
