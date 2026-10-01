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
// ★★MA1：Morpheus 声明式动画表面（预设库 + 编译期校验）——本相位验证"一句话写转场"端到端
import { presets, compileRoute, compileAnimations, isComposited, validateAnimations, isPlatformEligible } from '@proteus-vue/animation'

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
  /** ★停全部动画 + 复位所有层变换（相位收尾清场——滚动动画永不自动结束，必须显式停） */
  animStopAll(): string
  /** ★V4 滚动（纯内容偏移，像素）——不驱动动画；与 scrollAnimSync 的区别是它不碰动画 */
  scrollBy(dx: number, dy: number): string
  animStart(json: string): string
  animSeek(json: string): string
  // ★★MA5（2026-09-30）：滚动联动——宿主只报原始位置，窗口换算在内核
  animSeekScroll(json: string): string
  scrollAnimSync(json: string): string
  /** ★★真手势滚动探针（2026-10-01 收边界）：驱动 pan 处理器的**唯一出口**（同一生产通路） */
  panDragProbe(json: string): string
  // ★★共享元素（跨元素飞行——几何在内核；宿主负责层级提升）
  sharedElement(json: string): string
  setLayerZ(json: string): string
  layerZProbe(idsJson: string): string
  animTick(dtMs: number): string
  animStartFrameLoop(): string
  animStopFrameLoop(): string
  animFrameStats(): string
  // ★★RT2 帧率测席（§9 指标测量）
  animFlip(json: string): string
  animCommit(json: string): string
  layerPresentedProbe(idsJson: string): string
  animRemovePlatform(idsJson: string): string
  animBenchStart(json: string): string
  animBenchResults(): string
  // ★★主线程零唤醒实测（OS 级 CPU 会计 + 阳性对照；xctrace 不可达时的机器判据）
  animCpuProbeStart(json: string): string
  animCpuProbeResults(): string
  /** ★HA1：Host ABI 双路对照（同一棵树走直连 FFI 与 ABI，几何逐字节比对） */
  abiProbe(json: string): string
}
declare const proteusSelfDraw: SelfDrawNative
/** 快照名（宿主按模式注入；此处仅作默认） */
const BN = { snapshot: 'selfdraw-final' }

// ★构建标识（每次构建由 hosts/ios/bridge/inject-build-id.mjs 注入；与 entry-bench 同机制）
//   —— 「设备上跑的是哪份代码」必须可**一眼判定**（报告新鲜度判据的内容锚点）。
const BUILD_ID = '0ed7d664-112326'

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
/** ★★RT2 复杂动效读数（弹簧/接管/FLIP/rotate+opacity） */
let animComplexResult: Record<string, unknown> = {}
/** ★★MA0-RT 平台零参与路径读数 */
let animPlatformResult: Record<string, unknown> = {}
/** ★★MA1 预设库读数 */
let animPresetResult: Record<string, unknown> = {}
/** ★★MA5 滚动联动读数 */
let animScrollResult: Record<string, unknown> = {}
/** ★★MA6 序列编排读数 */
let animSequenceResult: Record<string, unknown> = {}
/** ★★共享元素读数 */
let animSharedResult: Record<string, unknown> = {}

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
   * ★★**RT2 复杂动效相位**（弹簧 / 打断接管 / FLIP 布局动画 / rotate+opacity）
   *
   * 【要回答什么（对齐 Flutter 的能力面）】
   *   ① **弹簧物理**：真实物理求解（非查表），静止后精确钉在目标；
   *   ② **打断接管**：曲线跑到一半 → 弹簧接管 ⇒ 位置无跳变 + 速度被带着走；
   *   ③ **FLIP 布局动画**（招牌）：记快照 → 改几何 → 启动 ⇒ 从旧位置平滑滑到新位置（零跨边界几何查询）；
   *   ④ **rotate / opacity**：复杂动效标配属性真的落到层上。
   *
   * 【判据】见 `check-anim-rt2.py` 的 F 组（每步都从**层上真读**——不是回显输入）。
   */
  animComplex(): string {
    const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([2, 3, 4, 5])))
    const present = ((probe as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? [])
      .filter((l) => !l.missing)
      .map((l) => l.id)
    const nA = present[0] ?? 2
    const nB = present[1] ?? nA

    // ① 弹簧：0 → 100（snappy 预设）
    const springStart = safeParse(
      proteusSelfDraw.animStart(
        JSON.stringify({
          anims: [
            { nodeId: nA, kind: 0, from: 0, to: 100, durMs: 1000, spring: { stiffness: 320, damping: 30, mass: 1 } },
          ],
        }),
      ),
    )
    for (let i = 0; i < 60; i++) proteusSelfDraw.animTick(16.7) // 约 1s ⇒ snappy 应已静止
    const springEnd = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([nA])))

    // ② 打断接管：曲线跑到一半 → 弹簧接管（目标反向 ⇒ 必须带速度回弹而非硬跳）
    proteusSelfDraw.animStopNodes(JSON.stringify({ nodeIds: [nB] }))
    proteusSelfDraw.animStart(
      JSON.stringify({ anims: [{ nodeId: nB, kind: 0, curve: 0, from: 0, to: 200, durMs: 400 }] }),
    )
    for (let i = 0; i < 6; i++) proteusSelfDraw.animTick(16.7) // 约 100ms ⇒ 线性 25% ≈ 50px
    const beforeTakeover = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([nB])))
    proteusSelfDraw.animStart(
      JSON.stringify({
        anims: [
          { nodeId: nB, kind: 0, from: 0, to: 60, durMs: 1000, spring: { stiffness: 300, damping: 26, mass: 1 } },
        ],
      }),
    )
    const afterTakeover = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([nB])))
    for (let i = 0; i < 120; i++) proteusSelfDraw.animTick(16.7) // 跑够静止
    const takeoverEnd = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([nB])))

    // ③ FLIP：capture → 改几何（真实补丁路径）→ start
    const flipCapture = safeParse(proteusSelfDraw.animFlip(JSON.stringify({ op: 'capture' })))
    // ★几何变更的属性选择（两次试错后定论，写下来省下轮）：
    //   ① `top` 只对 `position:absolute` 生效 → 本场景是流式布局，无位移；
    //   ② `marginTop` **不是** PatchStyle 的字段名（走 updatePatches 时必须用 LStyle 字段名）；
    //   ③ 正解：`margin: { top: 40 }`（Edges 对象）——改外边距真实改变后续元素位置，FLIP 才有位移可测。
    const patchOut = proteusSelfDraw.updatePatches(
      JSON.stringify([{ id: nB, style: { margin: { top: 40 } } }]),
    )
    const flipStart = safeParse(
      proteusSelfDraw.animFlip(JSON.stringify({ op: 'start', durMs: 300, curve: 1, staggerMs: 0 })),
    )
    const flipBegin = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([nB])))
    for (let i = 0; i < 12; i++) proteusSelfDraw.animTick(16.7)
    const flipMid = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([nB])))
    // ★FLIP 时长 300ms ⇒ 需 ≥19 帧（16.7ms/帧）；跑 30 帧留足余量。
    //   （★别信"52 帧还差一点 = 相位时序"这个直觉——2026-09-30 实测推翻：
    //     真根因是探针路径按 16B 步长解析 24B 记录，见 selfdraw-scene.swift `animUpdateRecordBytes`。
    //     判据端表现：残值恒为"某个中间帧的值"而不是"接近终点的小量"。）
    for (let i = 0; i < 30; i++) proteusSelfDraw.animTick(16.7)
    const flipEnd = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([nB])))

    // ④ rotate + opacity
    proteusSelfDraw.animStopNodes(JSON.stringify({ nodeIds: [nA] }))
    proteusSelfDraw.animStart(
      JSON.stringify({
        anims: [
          { nodeId: nA, kind: 3, curve: 0, from: 0, to: 90, durMs: 100 },
          { nodeId: nA, kind: 4, curve: 0, from: 1, to: 0.2, durMs: 100 },
        ],
      }),
    )
    for (let i = 0; i < 10; i++) proteusSelfDraw.animTick(16.7)
    const rotOpEnd = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([nA])))

    const l0 = (o: unknown) => ((o as { layers?: Array<Record<string, number>> }).layers ?? [])[0] ?? {}
    const r = {
      nodes: [nA, nB],
      spring: { start: springStart, end: l0(springEnd).tx ?? NaN },
      takeover: {
        before: l0(beforeTakeover).tx ?? NaN,
        after_start: l0(afterTakeover).tx ?? NaN,
        end: l0(takeoverEnd).tx ?? NaN,
      },
      flip: {
        capture: flipCapture,
        patch: safeParse(patchOut),
        start: flipStart,
        begin: { tx: l0(flipBegin).tx ?? NaN, ty: l0(flipBegin).ty ?? NaN },
        mid: { tx: l0(flipMid).tx ?? NaN, ty: l0(flipMid).ty ?? NaN },
        end: { tx: l0(flipEnd).tx ?? NaN, ty: l0(flipEnd).ty ?? NaN },
      },
      rotate_opacity: { rotate: l0(rotOpEnd).rotate ?? NaN, opacity: l0(rotOpEnd).opacity ?? NaN },
    }
    animComplexResult = r
    return JSON.stringify(r)
  },

  /**
   * ★★**共享元素**（跨元素飞行：从源矩形飞到目标再归位）
   *
   * 【要回答什么】
   *   ① **几何由内核算**：`dx/dy/scale` 由源矩形与目标几何推出（宿主零几何数学）；
   *   ② **首帧不跳变**：启动当帧值就在**源矩形**（中心对齐 + 宽度比）；
   *   ③ **层级提升生效**：飞行元素 zPosition 被抬起（真读层上值），结束可复位；
   *   ④ **终态精确归位**：translate 0 / scale 1（identity）。
   *
   * 【判据】见 `check-anim-rt2.py` 的 K 组。
   */
  animShared(): string {
    const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([2, 3, 4])))
    const present = ((probe as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? [])
      .filter((l) => !l.missing)
      .map((l) => l.id)
    const target = present[0] ?? 2
    const srcNode = present[1] ?? target
    proteusSelfDraw.animStopNodes(JSON.stringify({ nodeIds: [target] }))

    // ① 预设：源 = **同树节点**（同页面共享元素）——几何由内核从该节点绝对矩形取
    const spec = presets.element.sharedElement({ fromNodeId: srcNode, durationMs: 300 })
    const seOut = safeParse(
      proteusSelfDraw.sharedElement(
        JSON.stringify({ targetId: target, sourceNodeId: srcNode, durMs: spec.durationMs, curve: 1, fadeIn: spec.fadeIn }),
      ),
    )
    // 首帧：目标层上的值应 = 内核算出的起点（弹窗/缩略图的中心差与宽度比）
    const afterStart = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([target])))
    const l0 = ((afterStart as { layers?: Array<Record<string, number>> }).layers ?? [])[0] ?? {}

    // ② 层级提升读数（真读层 zPosition）
    const zAfter = safeParse(proteusSelfDraw.layerZProbe(JSON.stringify([target])))
    const zVal = (((zAfter as { layers?: Array<Record<string, number>> }).layers ?? [])[0] ?? {}).z

    // ③ 跑完（300ms；30 帧 × 16.7 ≈ 501ms 留足）
    for (let i = 0; i < 30; i++) proteusSelfDraw.animTick(16.7)
    const afterEnd = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([target])))
    const l1 = ((afterEnd as { layers?: Array<Record<string, number>> }).layers ?? [])[0] ?? {}

    // ④ 复位层级（飞行结束后必须复位——zPosition 是持久状态）
    const zReset = safeParse(proteusSelfDraw.setLayerZ(JSON.stringify({ ids: [target], z: 0 })))
    const zAfterReset = safeParse(proteusSelfDraw.layerZProbe(JSON.stringify([target])))
    const zResetVal = (((zAfterReset as { layers?: Array<Record<string, number>> }).layers ?? [])[0] ?? {}).z

    // ①b ★**判别力补强**（放在首飞行完整跑完之后——首版插在它前面，
    //     导致 K2/K3 读到的是**被本次覆盖后**的状态，判据全乱。探针的**顺序**也是判据的一部分）：
    //   同树源常与目标同尺寸 ⇒ scale 恒 1，无法证明"宽度比"这条数学。
    //   ⇒ 再用一个**显式小矩形**（系统坐标）跑一次：scale 必须明显 ≠ 1。这也是 `fromRect` 的实用形态。
    const probeRect = { x: 36, y: 620, w: 72, h: 72 }
    const seRectOut = safeParse(
      proteusSelfDraw.sharedElement(
        JSON.stringify({ targetId: target, sourceRect: probeRect, durMs: 120, curve: 1, fadeIn: false }),
      ),
    )
    const re = seRectOut as {
      ok?: boolean; dx?: number; dy?: number; scale?: number
      toRect?: { x: number; y: number; w: number; h: number }
    }
    const afterRectStart = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([target])))
    const lr0 = ((afterRectStart as { layers?: Array<Record<string, number>> }).layers ?? [])[0] ?? {}
    for (let i = 0; i < 12; i++) proteusSelfDraw.animTick(16.7)  // 跑完 120ms 归位
    proteusSelfDraw.setLayerZ(JSON.stringify({ ids: [target], z: 0 }))

    // ⑤ 拒绝分支：源与目标都给错（未布局 / 缺源）必须明确报错
    const badOut = safeParse(
      proteusSelfDraw.sharedElement(JSON.stringify({ targetId: 99999, sourceRect: { x: 0, y: 0, w: 10, h: 10 } })),
    )
    const noSrcOut = safeParse(proteusSelfDraw.sharedElement(JSON.stringify({ targetId: target })))

    const se = seOut as {
      ok?: boolean
      dx?: number
      dy?: number
      scale?: number
      fromRect?: { x: number; y: number; w: number; h: number }
      toRect?: { x: number; y: number; w: number; h: number }
      applied?: number
      zLifted?: number
    }
    const r = {
      node: target,
      srcNode,
      preset: spec.name,
      ok: se.ok,
      dx: se.dx,
      dy: se.dy,
      scale: se.scale,
      fromRect: se.fromRect,
      toRect: se.toRect,
      applied: se.applied,
      // 首帧：层上值应等于内核的起点（tx=dx、scale=scale）
      first_tx: l0.tx,
      first_ty: l0.ty,
      first_scale: l0.scale,
      // 终态：精确归位
      end_tx: l1.tx,
      end_ty: l1.ty,
      end_scale: l1.scale,
      z_lifted: se.zLifted,
      z_after: zVal,
      z_reset_val: zResetVal,
      z_reset_ok: (zReset as { ok?: boolean }).ok,
      bad_rejected: (badOut as { ok?: boolean }).ok === false && !!(badOut as { error?: string }).error,
      bad_error: (badOut as { error?: string }).error?.slice(0, 60),
      no_src_rejected: (noSrcOut as { ok?: boolean }).ok === false,
      // ★fromRect 路径（判别力补强）：小矩形 ⇒ scale 明显 ≠ 1、dx/dy 非零
      rect_ok: re.ok,
      rect_dx: re.dx,
      rect_dy: re.dy,
      rect_scale: re.scale,
      rect_to: re.toRect,
      rect_first_tx: lr0.tx,
      rect_first_ty: lr0.ty,
      rect_first_scale: lr0.scale,
      rect_first_ty_mid: lr0.ty,
    }
    animSharedResult = r
    return JSON.stringify(r)
  },

  /**
   * ★★**MA6：序列编排**（多段动画——"先下压再弹回"收敛在一条动画里）
   *
   * 【要回答什么】
   *   ① **分段推进真的发生**：单条动画内走完"下压段 → 回弹段"（中间值落在两段各自区间）；
   *   ② **段终点精确**：边界处值恰为段 `to`（分段定位不漂移）；
   *   ③ **终值精确到声明 to** + 动画正常结束（否则永占活动集）；
   *   ④ **平台路径仍是"一条"**：整段序列 → **一条** CAKeyframeAnimation（不是 N 条）。
   *
   * 【判据】见 `check-anim-rt2.py` 的 J 组。
   */
  animSequence(): string {
    const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([2, 3])))
    const present = ((probe as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? [])
      .filter((l) => !l.missing)
      .map((l) => l.id)
    const n = present[0] ?? 2
    proteusSelfDraw.animStopNodes(JSON.stringify({ nodeIds: [n] }))

    // 序列：scale 1 → 0.6（100ms）→ 1.2（200ms）→ 1.0（100ms），全线性便于算术断言
    //   预期：t=50 → 0.8 · t=100 → 0.6（精确）· t=200 → 0.9 · t=400 → 1.0（精确）
    const seq = [
      {
        kind: 'scale' as const,
        from: 1,
        to: 1,
        keyframes: [
          { to: 0.6, durationMs: 100, curve: 'linear' as const },
          { to: 1.2, durationMs: 200, curve: 'linear' as const },
          { to: 1.0, durationMs: 100, curve: 'linear' as const },
        ],
      },
    ]
    const c = compileAnimations(seq, { nodeId: n })
    const startOut = safeParse(proteusSelfDraw.animStart(JSON.stringify({ anims: c.anims })))

    const scaleOf = (): number | undefined => {
      const p = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([n])))
      const layers = (p as { layers?: Array<Record<string, number>> }).layers ?? []
      return layers[0]?.scale
    }

    // ★算术必须与序列总时长对齐（段时长 100+200+100=400ms）。
    //   首版只 tick 到 300ms 就读"终值" ⇒ 末段根本没跑到，读到的是次段终点 1.2（探针算术错，
    //   被 J3 当场挡下——判据的价值就在于它认的是"声明 to"，不认"我觉得该到了"）。
    proteusSelfDraw.animTick(50)    // 首段半程 ⇒ 0.8
    const s50 = scaleOf()
    proteusSelfDraw.animTick(50)    // 恰在首段终点（累计 100）⇒ 0.6（精确）
    const s100 = scaleOf()
    proteusSelfDraw.animTick(100)   // 次段半程（累计 200）⇒ 0.9
    const s200 = scaleOf()
    proteusSelfDraw.animTick(200)   // 末段走完（累计 400）⇒ 1.0（精确）
    const s400 = scaleOf()

    // 平台路径：整段序列 = **一条** 平台动画（不是 N 条）
    proteusSelfDraw.animStopNodes(JSON.stringify({ nodeIds: [n] }))
    const commitOut = safeParse(proteusSelfDraw.animCommit(JSON.stringify({ anims: c.anims })))
    const co = commitOut as { ok?: boolean; committed?: number; specs?: number; scaleMin?: number; scaleMax?: number }
    proteusSelfDraw.animRemovePlatform(JSON.stringify([n]))

    const r = {
      node: n,
      start: startOut,
      segments: c.anims[0]?.keyframes?.length,
      durMs: c.anims[0]?.durMs,
      s50,
      s100,
      s200,
      s400,
      platform_ok: co.ok,
      platform_committed: co.committed,
      platform_specs: co.specs,
      // ★采样极值证明"提交内容真的经过各段"（只数 committed 无法区分"三段"与"退化单段"）
      platform_scale_min: co.scaleMin,
      platform_scale_max: co.scaleMax,
    }
    animSequenceResult = r
    return JSON.stringify(r)
  },

  /**
   * ★★**主线程零唤醒实测**（OS 级 CPU 会计 + 阳性对照）——**异步相位**
   *
   * 【为什么是 OS 级会计而不是 Instruments（2026-09-30 取证）】xctrace 无法录制本设备
   *   （`Waiting for device to boot` 超时）；证据链见 swift 侧 `animCpuProbeStart` 注释。
   *   ⇒ 用 `thread_info` 的主线程 CPU 增量对照——**可机器判定**（比人看波形更可回归）。
   *
   * 【判据】见 `check-anim-rt2.py` 的 L 组（L0 提交成功 / L1 阳性对照有效 / L2 平台路径显著更低）。
   */
  animCpuProbe(): string {
    const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([2, 3])))
    const present = ((probe as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? [])
      .filter((l) => !l.missing)
      .map((l) => l.id)
    const target = present[0] ?? 2
    const startOut = safeParse(
      proteusSelfDraw.animCpuProbeStart(JSON.stringify({ windowMs: 600, targetId: target })),
    )
    return JSON.stringify({ phase: 'cpuProbe', started: startOut })
  },

  /**
   * ★★**HA1：Host ABI 双路对照**（现有宿主接入抽象层的等价性判据）
   *
   * 【为什么要"双路"】"ABI 能跑"不足以证明抽象正确——必须证明**两条路产出同一个东西**：
   *   同一棵树分别走 [直连 FFI]（现有生产路径）与 [Host ABI]（新抽象层），几何**逐字节一致**。
   *   同时验证：度量经 vtable 注入（宿主不再自己遍历树量文本）、批处理红线、
   *   版本协商（不兼容必给可操作提示）、能力插件（未注册明确报错）、帧驱动（proteus_frame 推进动画）。
   *
   * 【判据】见 `check-anim-rt2.py` 的 N 组。
   */
  abiProbe(): string {
    // 用**真实适配器产物**（当前树）做输入——不是手写 JSON（判据要落在真实链路上）
    const req = adapter.toRequest(VP)
    const treeJson = JSON.stringify(req)
    const out = safeParse(proteusSelfDraw.abiProbe(JSON.stringify({ tree: treeJson })))
    return JSON.stringify(out)
  },

  /**
   * ★★**MA1：预设驱动的转场**（真机验证"一句话写动画"）
   *
   * 【要回答什么】
   *   ① **预设 → 引擎指令** 端到端可用（不是"API 存在"而是"真的驱动了端上动画"）；
   *   ② **编译期校验有效**：非法声明（非合成属性 / 同属性重复）在**下发前**就被拦下；
   *   ③ 语义与微信 routeType 对齐（`wx://bottom-sheet` 等——双端认知一致）。
   *
   * 【判据】见 check-anim-rt2.py 的 H 组。
   */
  animPreset(): string {
    const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([2, 3, 4])))
    const present = ((probe as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? [])
      .filter((l) => !l.missing)
      .map((l) => l.id)
    const enterId = present[0] ?? 2
    const exitId = present[1] ?? enterId

    // ① 预设：半屏弹窗（对齐 wx://bottom-sheet）——一句话
    const sheet = presets.route.bottomSheet()
    const compiled = compileRoute(sheet, { enter: enterId, exit: exitId })
    // ★相位隔离：本相位要独占动画状态 ⇒ 先停掉上一相位**可能仍在跑**的动画。
    //   ★注意停的是"自己关心的节点"而不是 `animStopAll`（真机教训，两次误判换来的）：
    //     曾把 F3d（FLIP 终值 -0.18）归因于"下一相位 stopAll 清场"，实测**不成立**——
    //     相位是同步串行的，flipEnd 在 complex 相位内就已捕获，后相位动不了它。
    //     真根因是探针路径按 16B 步长解析 24B 记录（见 selfdraw-scene.swift
    //     `animUpdateRecordBytes`）。⇒ 保留精确停（对状态更干净），但别再把"清场"当根因。
    proteusSelfDraw.animStopNodes(JSON.stringify({ nodeIds: [enterId, exitId] }))
    const startOut = safeParse(
      proteusSelfDraw.animStart(JSON.stringify({ anims: [...compiled.enter.anims, ...compiled.exit.anims] })),
    )
    for (let i = 0; i < 5; i++) proteusSelfDraw.animTick(16.7)
    const mid = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([enterId])))
    for (let i = 0; i < 30; i++) proteusSelfDraw.animTick(16.7)
    const end = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([enterId])))

    // ② 编译期校验：非法声明必须被拦（两条红线各验一次）
    let dupRejected = ''
    try {
      compileAnimations(
        [
          { kind: 'scale', to: 0.9, durationMs: 100 },
          { kind: 'scale', to: 1, durationMs: 100 },
        ],
        { nodeId: 1 },
      )
      dupRejected = 'NOT_REJECTED'
    } catch (e) {
      dupRejected = String((e as { message?: string })?.message ?? e).slice(0, 80)
    }
    const nonCompositedIssue = isComposited('width' as never) ? 'WRONG' : 'ok(编译期已识别为不可合成)'

    // ③ 手感预设（弹簧）——与内核同值
    const pressed = compileAnimations(presets.element.pressRelease().decls, { nodeId: enterId })

    const r = {
      nodes: [enterId, exitId],
      preset: sheet.name,
      wx_route_type: sheet.wxRouteType,
      compiled_count: compiled.enter.anims.length + compiled.exit.anims.length,
      composited: compiled.enter.composited,
      start: startOut,
      mid_ty: ((((mid as { layers?: Array<Record<string, number>> }).layers ?? [])[0] ?? {}) as Record<string, number>).ty,
      end_ty: ((((end as { layers?: Array<Record<string, number>> }).layers ?? [])[0] ?? {}) as Record<string, number>).ty,
      dup_rejected: dupRejected,
      non_composited_hint: nonCompositedIssue,
      spring_stiffness: pressed.anims[0]?.spring?.stiffness,
      validation_clean: validateAnimations(presets.route.slideUp().enter).length === 0,
    }
    animPresetResult = r
    return JSON.stringify(r)
  },

  /**
   * ★★**MA5：滚动联动**（吸顶 / 视差 / 渐显——Morpheus §6.1 预设库最后一项）
   *
   * 【要回答什么】
   *   ① **滚动位置 → 动画进度**端到端可用：滚动回调只报**原始位置**，视差/渐显当帧变化；
   *   ② 换算（窗口/钳制/曲线）在**内核**（宿主与 JS 都零数学）；
   *   ③ **生产形态**：`scrollAnimSync`（滚动 + 驱动 + 刷层在宿主内一次完成，JS 不在链路）；
   *   ④ 编译期拦截：退化窗口 / 滚动+弹簧并存被拦；滚动批次**不得**走平台零参与路径。
   *
   * 【判据】见 `check-anim-rt2.py` 的 I 组。
   */
  animScroll(): string {
    const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([2, 3, 4])))
    const present = ((probe as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? [])
      .filter((l) => !l.missing)
      .map((l) => l.id)
    const bg = present[0] ?? 2      // 视差背景层
    const fade = present[1] ?? bg   // 渐显项
    const head = present[2] ?? bg   // 吸顶头

    // 相位隔离：只停自己关心的节点（不 animStopAll——见 animPreset 的教训注释）
    proteusSelfDraw.animStopNodes(JSON.stringify({ nodeIds: [bg, fade, head] }))

    // ① 预设：视差（factor=0.4，窗口 0..400）+ 渐显（窗口 100..300）+ 吸顶（pin 80）
    const parallax = presets.scroll.parallax({ factor: 0.4, from: 0, to: 400 })
    const fadeIn = presets.scroll.fadeIn({ from: 100, to: 300 })
    const sticky = presets.scroll.sticky({ pinAt: 80, span: 120 })
    const cBg = compileAnimations(parallax.decls, { nodeId: bg })
    const cFade = compileAnimations(fadeIn.decls, { nodeId: fade })
    const cHead = compileAnimations(sticky.decls, { nodeId: head })
    const startOut = safeParse(
      proteusSelfDraw.animStart(
        JSON.stringify({ anims: [...cBg.anims, ...cFade.anims, ...cHead.anims] }),
      ),
    )

    const tyOf = (idsJson: string, idx = 0): number | undefined => {
      const p = safeParse(proteusSelfDraw.layerTransformProbe(idsJson))
      const layers = (p as { layers?: Array<Record<string, number>> }).layers ?? []
      return layers[idx]?.ty
    }

    // ② 滚动到 0：视差起点（ty=0）、渐显未到窗口（opacity=0 → 用 ty 无法看，故读 opacity）
    const atZero = safeParse(proteusSelfDraw.animSeekScroll(JSON.stringify({ scroll: 0 })))
    const bg0 = tyOf(JSON.stringify([bg]))

    // ③ 滚动到 200（视差半程 ⇒ -80；渐显半程 ⇒ opacity 0.5）
    const at200 = safeParse(proteusSelfDraw.animSeekScroll(JSON.stringify({ scroll: 200 })))
    const bg200 = tyOf(JSON.stringify([bg]))

    // ④ 滚动到 400（视差全程 ⇒ -160）
    const at400 = safeParse(proteusSelfDraw.animSeekScroll(JSON.stringify({ scroll: 400 })))
    const bg400 = tyOf(JSON.stringify([bg]))

    // ⑤ 生产形态：宿主滚动通路（scrollAnimSync）——从 0 滚到 100（视差 -40）
    proteusSelfDraw.animSeekScroll(JSON.stringify({ scroll: 0 }))
    const syncOut = safeParse(proteusSelfDraw.scrollAnimSync(JSON.stringify({ dx: 0, dy: 100 })))
    const bgSync = tyOf(JSON.stringify([bg]))

    // ⑥ 编译期拦截：退化窗口 / 滚动+弹簧
    let degenerateRejected = ''
    try {
      compileAnimations(
        [{ kind: 'translateY', to: -50, scroll: { from: 300, to: 100 } }],
        { nodeId: bg },
      )
      degenerateRejected = 'NOT_REJECTED'
    } catch (e) {
      degenerateRejected = String((e as { message?: string })?.message ?? e).slice(0, 60)
    }
    let scrollSpringRejected = ''
    try {
      compileAnimations(
        [{ kind: 'translateY', to: -50, spring: { stiffness: 320, damping: 30 }, scroll: { from: 0, to: 100 } }],
        { nodeId: bg },
      )
      scrollSpringRejected = 'NOT_REJECTED'
    } catch (e) {
      scrollSpringRejected = String((e as { message?: string })?.message ?? e).slice(0, 60)
    }
    // ⑦ 滚动批次不得走平台零参与路径（驱动源不同）
    const platformEligible = isPlatformEligible(cBg)

    // ⑦b ★★真手势滚动（2026-10-01 收边界）：从**同一生产通路**再滚回 0，
    //   驱动 pan 处理器的唯一出口（`driveScrollDrag → scrollDragBy`）——
    //   与真手指拖拽走的是同一条代码路径（本探针只替换**触发源**，不换实现）。
    //   期望：识别器已装（recognizer_installed）+ 出口被驱动 N 次（drive_count）+ 逐次 changed>0
    //   + 偏移回到 0（**内容与内核状态都真推进**）。
    proteusSelfDraw.animSeekScroll(JSON.stringify({ scroll: 100 }))
    const panProbe = safeParse(proteusSelfDraw.panDragProbe(JSON.stringify({ dy: -25, steps: 4 })))
    const bgPanTy = tyOf(JSON.stringify([bg])) // 滚回 0 ⇒ 视差回 0

    const r = {
      nodes: [bg, fade, head],
      presets: { parallax: parallax.name, fadeIn: fadeIn.name, sticky: sticky.name },
      window: parallax.window,
      start: startOut,
      bg0_ty: bg0,
      bg200_ty: bg200,
      bg400_ty: bg400,
      sync: syncOut,
      bgSync_ty: bgSync,
      // ★真手势滚动读数（判据 I6 组）
      pan: panProbe,
      bg_pan_ty: bgPanTy,
      last_changed: (at400 as { changed?: number }).changed,
      last_active: (at400 as { active?: number }).active,
      degenerate_rejected: degenerateRejected,
      scroll_spring_rejected: scrollSpringRejected,
      platform_eligible: platformEligible,
      zero_ok: (atZero as { ok?: boolean }).ok,
    }

    // ★★相位收尾（读数**已捕获**，此处只做状态清理）：
    //   ① 偏移归零（真手势探针已滚回 0；此处幂等兜底——`scrollBy(0,0)` 不产生副作用）；
    //   ② `animStopAll`：滚动动画**永不自动结束**（Progress 驱动）⇒ 不清场它会一直在帧率测席里
    //      被每帧"保持写入"（污染 E 组每帧成本读数），并让层留下残姿。
    //   ★顺序不能反：先滚回去（纯内容移动，不驱动动画），再清场。
    proteusSelfDraw.scrollBy(0, -0)
    proteusSelfDraw.animStopAll()

    animScrollResult = r
    return JSON.stringify(r)
  },

  /**
   * ★★**MA0-RT 相位：平台渲染线程零参与路径**（Morpheus §5-bis）
   *
   * 【要回答什么】
   *   ① **合成属性判定**：全 transform/opacity 批次 ⇒ `plan.composited=true`；
   *      含非合成属性 ⇒ **明确拒绝**（不静默降级 —— §5-bis.2 要求）；
   *   ② **提交一次 ⇒ 平台自主插值**：`CAKeyframeAnimation` 交给 CoreAnimation render server 后，
   *      主线程**不再写值**；判据必须从 **`presentationLayer`** 读（model 值已设成终值 ⇒ 读它会像"没动"）；
   *   ③ **两条路径同形**：提交路径的采样值与 tick 路径**同源**（Rust 侧同一 `curve_eval`）。
   *
   * 【判据】见 `check-anim-rt2.py` 的 G 组。
   */
  animPlatform(): string {
    const probe = safeParse(proteusSelfDraw.layerTransformProbe(JSON.stringify([2, 3, 4])))
    const present = ((probe as { layers?: Array<{ id: number; missing?: boolean }> }).layers ?? [])
      .filter((l) => !l.missing)
      .map((l) => l.id)
    const nA = present[0] ?? 2
    const nB = present[1] ?? nA

    // ① 合成属性批次 ⇒ 应判定 composited=true 并生成规格
    const commitOk = safeParse(
      proteusSelfDraw.animCommit(
        JSON.stringify({
          anims: [
            { nodeId: nA, kind: 0, curve: 1, from: 0, to: 150, durMs: 600 },
            { nodeId: nA, kind: 2, curve: 1, from: 1.0, to: 1.25, durMs: 600 },
          ],
        }),
      ),
    )
    // 提交后**主线程不再 tick**（这正是"零参与"的语义）——但我们要给平台留出插值时间。
    //   ★本相位是同步执行的 ⇒ 用"下一次探针"来观察 presentation 值（由宿主在相位间让出主线程时推进）。
    const presented1 = safeParse(proteusSelfDraw.layerPresentedProbe(JSON.stringify([nA])))

    // ② 非合成属性批次 ⇒ 必须**明确拒绝**（这里是合成集之外的键：用一条不存在于合成集的路径验证判定）
    //    注：本引擎的 AnimKind 全部是合成属性 ⇒ 用**合法但非法 kind** 触发解析错误路径；
    //    判定逻辑本身由 Rust 单测覆盖（plan_reports_composited_for_transform_only_batch）。
    const badCommit = safeParse(
      proteusSelfDraw.animCommit(JSON.stringify({ anims: [{ nodeId: nB, kind: 99, from: 0, to: 1, durMs: 100 }] })),
    )

    // ③ 清理平台动画（相位间纪律）
    const cleanup = safeParse(proteusSelfDraw.animRemovePlatform(JSON.stringify([nA, nB])))

    const r = {
      commit_ok: commitOk,
      presented: (presented1 as { layers?: Array<Record<string, unknown>> }).layers ?? [],
      bad_commit: badCommit,
      cleanup,
      nodes: [nA, nB],
    }
    animPlatformResult = r
    return JSON.stringify(r)
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
      // ★★MA1 预设库（一句话写转场 + 编译期校验）
      anim_preset: animPresetResult,
      // ★★HA1：Host ABI 双路对照（几何逐字节一致性 + 批处理 + 能力插件 + 帧驱动）
      host_abi: safeParse(proteusSelfDraw.abiProbe(JSON.stringify({ tree: JSON.stringify(adapter.toRequest(VP)) }))),
      // ★★主线程零唤醒实测（OS 级 CPU 会计 + 阳性对照）
      anim_cpu: safeParse(proteusSelfDraw.animCpuProbeResults()),
      // ★★MA5 滚动联动（吸顶 / 视差 / 渐显——位置→进度换算在内核）
      anim_scroll: animScrollResult,
      // ★★MA6 序列编排（多段动画——一条动画内的分段推进）
      anim_sequence: animSequenceResult,
      // ★★共享元素（跨元素飞行：源矩形 → 目标 → 归位）
      anim_shared: animSharedResult,
      // ★★MA0-RT 平台零参与路径（合成属性判定 + CAKeyframe 提交 + presentation 探针）
      anim_platform: animPlatformResult,
      // ★★RT2 复杂动效（弹簧 / 打断接管 / FLIP / rotate+opacity）
      anim_complex: animComplexResult,
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
  /**
   * ★★**相位函数的自动包裹**（结构性修复：相位抛异常必须可观测，不能只是"该读数缺失"）
   *
   * 【为什么必须自动（2026-09-30 真机教训）】`animShared` 相位调了 `layerZProbe`，
   *   而该方法只在宿主 view 上有、**没加进 JSExport 协议** ⇒ JS 侧 TypeError。
   *   现象：该相位读数**为空**、报告 `phase_errors` **仍为 {}**、整套判据只因"K 组跳过"而变绿
   *   ——静默失败的最坏形态：**错的东西看起来是"没做"，而不是"做错了"**。
   *   ⇒ 用一处包裹覆盖**所有**相位函数（新增相位自动受保护），异常写进 `phase_errors`
   *     并返回 `{ok:false,error}`；判据侧再断言 `phase_errors` 为空（错误必须红）。
   *   ★这与本仓「三条红线要工具层管」同源：靠"记得写 try/catch"是记不住的。
   */
  ...Object.fromEntries(
    Object.entries(api).map(([k, fn]) => [
      k,
      (...args: unknown[]) => {
        try {
          return (fn as (...a: unknown[]) => string)(...args)
        } catch (e) {
          const msg = String((e as { message?: string })?.message ?? e)
          phaseErrors[k] = msg
          return JSON.stringify({ ok: false, phase: k, error: msg })
        }
      },
    ]),
  ),
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
