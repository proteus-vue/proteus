// hosts/android/bridge/entry-host-runtime.ts —— ★★G-39：真实宿主运行时在设备上跑（QuickJS / JSC 共用）
//
// 【★平台中立（2026-09-30 改造；两端共用本文件——「同一语义一处实现」）】
//   Android 侧壳（MainActivity + quickjs_jni.c）与 iOS 侧壳（selfdraw-scene.swift 的
//   `HostRuntimeBridge` + UIApplication 通知）**注入同一份本 bundle**，差异只在：
//     · `__PROTEUS_HOST_ID__` / `__PROTEUS_HOST_FRAME_DRIVER__`（宿主标识与帧驱动源名，壳注入）；
//     · `proteusHost.memUsage()` 的**口径**：QuickJS 返回 `scope:"engine"`（引擎真实 JS 堆，
//       `JS_ComputeMemoryUsage`）；JSC 无公开 per-context 内存 API ⇒ iOS 壳返回
//       `scope:"process"`（`phys_footprint`，iOS 标准口径）——报告带 `mem_scope` 供判据分档。
//
// 【要证明什么（G-39 宿主运行时 SPI 与职责边界）】
//   ① **生命周期唯一拥有**：宿主壳转发 suspend/resume（Android onPause/onResume）→ runtime 状态机；
//      非法转换（未挂起就 resume 等）**被拒绝且记账**（不是静默接受）。
//   ② **事件循环归属**：队列只有 `pumpFrame()`（宿主帧）能推进；挂起时**不推进**（帧预算归还宿主）。
//      ★并单独验 **QuickJS 的 await/Promise 续体泵**（本轮补的 JNI 入口）——此前 `await` 半执行。
//   ③ **职责边界**：`runOnThread('background')` 诚实拒绝（单线程宿主无后台线程）；原生调用未注册 ⇒ 拒绝。
//   ④ **内存账本**：经宿主 transport（`proteusHost.memUsage()` / `gc()`）读**引擎真实 JS 堆**；
//      分配 → 读数增长；GC → 读数下降（GC 有效性的端上机器证据，替代"相信 GC"）。
//   ⑤ **worker 语义诚实**：逻辑域 `real=false`（机器可读，不假装真并行）。
//
// 【与 iOS 的关系】本入口零平台依赖（quickjs-host.ts 纯 TS）⇒ iOS JSC 若要同款读数，
//   把本文件加到 iOS bundle 的 entry 并注入等价 transport 即可（同一语义一处实现）。
//
// 【产物】`hosts/android/bridge/dist/bundle-host-runtime.js`（IIFE；build-batch.mjs 生成）
// 【调用】Java 侧：eval(bundle) 定义 `globalThis.__proteusHostRun`，再 eval 调用它
import { createQuickJsHostRuntime } from '@proteus-vue/render-backend/quickjs-host'
import type { NativeTransport } from '@proteus-vue/render-backend/quickjs-host'
import { runHostConformance } from '@proteus-vue/render-backend/host-conformance'
// ★★应用与生命周期能力开放（App 宿主腿）：真实事件源（壳 + 虚拟栈）→ 真实 Hooks
import {
  getHostLifecycleBus,
  createAppLifecycleCapabilities,
  createStackPageSource,
} from '@proteus-vue/api/capability-app'
// ★为什么**不** import `@proteus-vue/api/capability`（拿 createCapabilityHooks）：
//   那个文件是 9000 行全能力面 + 依赖 @proteus-vue/shared（含 import.meta.env / window 探测）
//   ⇒ 在 IIFE（QuickJS/JSC 无模块系统）下既拖进 267KB 无关代码，又触发 import.meta 警告。
//   ★分工：**hooks 层的端到端证明在单测**（tests/capability-app.test.ts ② 组，真实 hooks + 真实栈）；
//     本场景证明**端上行为**——壳注入标识后桥能力可用、真实事件真的驱动回调。
// ★真实虚拟栈（M5 核心——不是手写假命令；与 app-stack 场景同一份实现）
import { createAppStack } from '@proteus-vue/router/app-stack'
import type { AppScreenSpec } from '@proteus-vue/router/app-stack'

/** 宿主桥（Java 侧 JsRenderHost / iOS 侧 HostRuntimeBridge 可选实现 memUsage/gc/invoke —— 条件注入） */
interface HostBridge {
  post?(json: string): void
  memUsage?(): string
  gc?(): void
  /** ★App 原生能力通道（Android: quickjs_jni 注入 / iOS: JSExport `invoke(_:_:)`——同一契约） */
  invoke?(method: string, argsJson: string): string
}

declare const proteusHost: HostBridge | undefined

/** 取全局宿主（无宿主环境为 null） */
function globalHost(): HostBridge | null {
  if (typeof proteusHost === 'undefined' || proteusHost === undefined) return null
  return proteusHost
}

// ── ★平台参数（壳注入；缺省 = 桌面自检形态）──
interface HostGlobals {
  __PROTEUS_HOST_ID__?: string
  __PROTEUS_HOST_FRAME_DRIVER__?: string
}
const g = globalThis as unknown as HostGlobals
const HOST_ID = g.__PROTEUS_HOST_ID__ ?? 'quickjs-desktop'
// ★构建标识（由 hosts/ios/bridge/inject-build-id.mjs **编译期替换**——与 entry-bench/entry-selfdraw
//   同一机制；报告据此断言"设备上跑的是本次构建"，而不是靠运行时环境变量（那种是第二种形态））
const BUILD_ID = '8a4702f2-123959'
const FRAME_DRIVER = g.__PROTEUS_HOST_FRAME_DRIVER__ ?? 'manual'

// ══════════════════════════════════════════════════════════════════
// ★★真实宿主壳转发钩子（Activity onPause/onResume → 这里）
//
// 【为什么单独一个 runtime（不复用场景里那个）】场景里的 runtime 在结束时会被 destroy
//   （那是"销毁语义"的判据）；壳转发需要**跨多次广播存活**的运行时 ⇒ 单独一个，懒创建、不销毁。
// 【为什么这是"真实"转发】Android 侧 MainActivity 覆写 onPause/onResume 并在其中 eval 本钩子
//   （见 `appHostRun` 注释与 `__proteusHostShellLifecycle`）；触点是**真实 Activity 生命周期**，
//   不是脚本里手动调 rt.suspend()——后者只能证明状态机，前者才证明"壳把生命周期交给了 runtime"。
// ══════════════════════════════════════════════════════════════════

interface ShellLifecycleEntry {
  evt: string
  applied: boolean
  state: string
  /** ★转发到能力总线**之后**的应用生命周期阶段（判据用：HIDE 只能由真实 hide 事件产生
   *  ⇒ 一次 pause 留下 cap_phase='HIDE' 即证明"壳事件确实驱动了能力总线"） */
  cap_phase: string
}
const shellLog: ShellLifecycleEntry[] = []
let shellRt: ReturnType<typeof createQuickJsHostRuntime> | null = null

/** 懒创建壳转发用的运行时（跨广播存活；不销毁——它代表"App 进程"本身） */
function ensureShellRt(): ReturnType<typeof createQuickJsHostRuntime> {
  if (!shellRt || shellRt.state === 'destroyed') {
    shellRt = createQuickJsHostRuntime({ id: `${HOST_ID}-shell`, engine: 'quickjs', frameDriver: FRAME_DRIVER })
    shellRt.bootstrap()
  }
  return shellRt
}

/**
 * 宿主壳生命周期入口（MainActivity.onPause/onResume eval 它）。
 * @returns 累计转发条数（诊断）
 */
function shellLifecycle(evt: string): number {
  const rt = ensureShellRt()
  let applied = false
  try {
    if (evt === 'pause' && rt.state === 'running') {
      rt.suspend()
      applied = true
    } else if (evt === 'resume' && rt.state === 'suspended') {
      rt.resume()
      applied = true
    }
  } catch {
    applied = false
  }
  // ★★执行器接线形态（本轮修正的关键点）：壳把真实生命周期转发给运行时**之后**，
  //   运行时/执行器再把它派发到**能力总线**（C23/C24/C25 的事件源）。
  //   —— 这是 App 侧"生命周期能力开放"的完整链路：
  //       系统事件 → 壳（Activity/通知）→ 运行时状态机 → 能力总线 → Hooks
  //   ★使用全局单例总线（`getHostLifecycleBus()`）⇒ 场景侧订阅的是**同一个**（键 `__proteusHostLifecycleBus`）。
  let capPhase = 'unavailable'
  if (applied) {
    try {
      const bus = getHostLifecycleBus()
      bus.emit({ topic: 'app', kind: evt === 'pause' ? 'hide' : 'show' })
      capPhase = bus.snapshot().app
    } catch {
      /* 总线不可用（极端情况）——不影响壳自身语义 */
    }
  }
  shellLog.push({ evt, applied, state: rt.state, cap_phase: capPhase })
  return shellLog.length
}
;(globalThis as unknown as { __proteusHostShellLifecycle: typeof shellLifecycle }).__proteusHostShellLifecycle =
  shellLifecycle

/** 壳转发读数查询（Java 侧在每次 onPause/onResume 后 eval 它并写报告——真机证据） */
function shellQuery(): string {
  const suspends = shellLog.filter((e) => e.evt === 'pause')
  const resumes = shellLog.filter((e) => e.evt === 'resume')
  // ★★能力读数（C23/C24/C25 在**真实生命周期发生后**的状态）——本报告由壳在每次事件后写，
  //   ⇒ 它是"壳事件 → 总线 → Hooks"链路的**后置证据**（主报告是场景相位的前置证据）。
  const capSnap = (() => {
    try {
      const bus = getHostLifecycleBus()
      const snap = bus.snapshot()
      return {
        app_phase: snap.app,
        page_phase: snap.page,
        subscribers: bus.subscriberCount,
      }
    } catch {
      return { app_phase: 'unavailable', page_phase: 'unavailable', subscribers: -1 }
    }
  })()
  return JSON.stringify({
    hook_loaded: true,
    events: shellLog.length,
    suspend_requested: suspends.length,
    suspend_applied: suspends.filter((e) => e.applied).length,
    resume_requested: resumes.length,
    resume_applied: resumes.filter((e) => e.applied).length,
    final_state: shellRt ? shellRt.state : 'none',
    log: shellLog,
    // ★能力开放：应用生命周期阶段由壳事件驱动后的最终态（应随 pause/resume 变化）
    cap_app_phase: capSnap.app_phase,
    cap_page_phase: capSnap.page_phase,
    cap_subscribers: capSnap.subscribers,
  })
}
;(globalThis as unknown as { __proteusHostShellQuery: typeof shellQuery }).__proteusHostShellQuery = shellQuery

/**
 * 跑完整场景，返回判据读数。
 *
 * 阶段划分（阶段间靠 runtime 的生命周期/队列语义隔离，不靠"时间等了多久"）：
 *   A. 建运行时（created）→ bootstrap → running
 *   B. 生命周期：suspend → resume → 再 suspend（宿主壳转发语义）
 *   C. 非法转换拒绝 ×4（bootstrap 于 suspended / 未挂起 resume / 销毁后 enqueue / 重复 destroy）
 *   D. 队列与帧驱动：suspend 下入队 → pumpFrame=0（不推进）；resume → pumpFrame 消费；帧内自排队
 *   E. 职责边界：runOnThread('background') 拒绝；invokeNative 未注册拒绝 / 注册后成功
 *   F. 内存账本（真机才有宿主桥）：memUsage 基线 → 分配大数组 → 再读 → gc → 再读
 *   G. ★G-41 宿主 conformance 用本运行时替换 stub：32 项（H-01~H-08）
 */
// ══════════════════════════════════════════════════════════════════
// ★★App 端原生能力通道（`proteusHost.invoke`）——**真机走真实 Java 宿主**
//
// 【★历史纠正（用户质疑「App 端是真的落地能力实现了吗？不是只有一个壳转发通道或者签名定义？」）】
//   初版在此处写了一个 **JS 侧示范实现**（`g.__proteusHostInvoke = …`）并把读数当真机证据——
//   那是**自我闭环**（用自己的桩证明自己的桥），本仓禁止。取证确认：真实 Android 宿主当时
//   **没有** invoke 通道（`quickjs_jni.c` 只注入 post/mount/update/updatePatches/memUsage/gc）。
//   ⇒ 现已改为**真实实现**：
//     · Java 侧 `HostCapabilities.java`（Android 真 API：线程池/位图预热/窗口 LayoutParams/版本查询）
//     · JNI 侧 `quickjs_jni.c` 的 `js_host_invoke`（条件注入 + 异常透传）
//     · 本场景**不再注册任何桩**——`installHostInvokeDemo` 已删除；
//       `invokeHost` 直接走 `globalThis.__proteusHostInvoke`，**未注册就会诚实 missing**
//       （判据里有一条专门查"壳是否真的被调用"——桩在时不成立，真实现才成立）。
// ══════════════════════════════════════════════════════════════════

export function __proteusHostRun(): string {
  const host = globalHost()
  const transport: NativeTransport | undefined =
    host && typeof host.memUsage === 'function'
      ? {
          call: (name, _argsJson) => {
            if (name === 'memUsage' && host.memUsage) return host.memUsage()
            if (name === 'gc') {
              host.gc?.()
              return '"ok"'
            }
            throw new Error(`transport 未实现 ${name}`)
          },
        }
      : undefined

  const rt = createQuickJsHostRuntime({ id: HOST_ID, engine: 'quickjs', frameDriver: FRAME_DRIVER, transport })

  // ── A. 建运行时 ──
  const stateA0 = rt.state // created
  rt.bootstrap()
  const stateA1 = rt.state // running

  // ── B. 生命周期（宿主壳转发） ──
  rt.suspend()
  const stateB1 = rt.state
  rt.resume()
  const stateB2 = rt.state

  // ── C. 非法转换拒绝（每一条都必须被拒绝且记账） ──
  let c1 = false // bootstrap 于 suspended
  rt.suspend()
  try {
    rt.bootstrap()
  } catch {
    c1 = true
  }
  let c2 = false // 未挂起 resume（当前已 suspended ⇒ 改判：先 resume 成功，再重复 resume 应拒绝）
  rt.resume()
  try {
    rt.resume()
  } catch {
    c2 = true
  }
  let c3 = false // 未注册的原生调用应拒绝（E 组），此处先占位 false
  const refusalsBeforeDestroy = rt.refusals.length

  // ── D. 队列与帧驱动 ──
  rt.suspend()
  let ranWhileSuspended = false
  rt.enqueue(() => {
    ranWhileSuspended = true
  })
  const pumpWhileSuspended = rt.pumpFrame() // 挂起 ⇒ 0（不推进）
  rt.resume()
  const pumpAfterResume = rt.pumpFrame() // 消费 1 条
  const ranAfterResume = ranWhileSuspended

  let inFrame = 0
  rt.enqueue(() => {
    inFrame++
    rt.enqueue(() => {
      inFrame++
    })
  })
  const pumpInFrame = rt.pumpFrame() // 同帧消费 2 条（防饥饿语义）

  // ── E. 职责边界 ──
  let e1 = false
  try {
    rt.runOnThread('background', () => {})
  } catch {
    e1 = true
  }
  // ★异步部分（invokeNative 返回 Promise）**不能同帧断言**——Promise 续体是 job，
  //   要由宿主的事件循环（JNI nativeRunPendingJobs → JS_ExecutePendingJob）推进。
  //   ⇒ 本场景因此**天然验证 job 泵**：run 相位注册续体（此刻断言为未决），
  //     Java 侧泵 job 后再调 finish 相位取结果（见 __proteusHostFinish 注释）。
  const asyncState: { e2: boolean; e3: boolean; e3Value: string } = { e2: false, e3: false, e3Value: '' }
  ;(globalThis as unknown as { __proteusHostAsync: typeof asyncState }).__proteusHostAsync = asyncState
  rt.invokeNative('native.not-registered').then(
    () => {},
    () => {
      asyncState.e2 = true
    },
  )
  rt.registerNativeHandler('echo', (a) => a)
  rt.invokeNative('echo', { v: 1 }).then(
    (v) => {
      asyncState.e3 = true
      asyncState.e3Value = JSON.stringify(v)
    },
    () => {},
  )

  // ── F. 内存账本（有宿主桥才做；读数来自引擎真实 JS 堆） ──
  //
  // ★★真机抓出的坑（首版 GC 后内存**不降**，判据当场红）：`const ballast` 留在本函数
  //   作用域 ⇒ 数组**仍可达** ⇒ GC 不回收（"打了 GC 却没释放"的经典陷阱）。
  //   ⇒ 修法：分配/释放各自封装进**函数作用域**，返回即不可达；释放用**显式置 null**
  //     （`delete` 全局属性在 QuickJS 上未必生效——delete 后属性可能仍以 undefined 存在，
  //      而引用计数/标记可达性都看实际引用，置 null 是明确不可达）。
  let memOk = false
  let memBefore = 0
  let memAfterAlloc = 0
  let memAfterGc = 0
  let memObjBefore = 0
  let memObjAfter = 0
  let memScopeForReport = 'none'
  if (transport) {
    let memScope = 'unknown'
    const read = (): { used: number; obj: number } => {
      const j = JSON.parse(transport.call('memUsage', 'null')) as {
        memory_used_size?: number
        obj_count?: number
        scope?: string
      }
      memScope = j.scope ?? 'engine' // 缺省 engine（QuickJS 口径；JSC 壳显式返回 process）
      return { used: j.memory_used_size ?? 0, obj: j.obj_count ?? 0 }
    }
    // ★分配规模：按**内存口径**分档——engine 口径（QuickJS）小数组即可见；
    //   process 口径（JSC phys_footprint）需要**大块**才在噪声上可测（本项目 iOS 侧的标准口径）
    const balloonBig = () => {
      // 32MB typed array（Uint8Array 逐块写入：真占用物理页，不是惰性映射）
      const big = new Uint8Array(32 * 1024 * 1024)
      for (let i = 0; i < big.length; i += 4096) big[i] = 1
      return big
    }
    const smallBallast = () => {
      const ballast: number[] = []
      for (let i = 0; i < 20000; i++) ballast.push(i) // 逐元素写入：真占内存（防惰性/稀疏数组）
      return ballast
    }
    let ballastHolder: unknown = null
    const allocateBallast = (scope: string): void => {
      ballastHolder = scope === 'process' ? balloonBig() : smallBallast()
      ;(globalThis as unknown as { __proteusMemBallast?: unknown }).__proteusMemBallast = ballastHolder
    }
    const releaseBallast = (): void => {
      ;(globalThis as unknown as { __proteusMemBallast?: number[] | null }).__proteusMemBallast = null
    }
    const m0 = read()
    memBefore = m0.used
    memObjBefore = m0.obj
    allocateBallast(memScope) // ★按口径选分配规模（见 allocateBallast 注释）
    const m1 = read()
    memAfterAlloc = m1.used
    memObjAfter = m1.obj
    // 释放 + GC（GC 是宿主能力——经 transport 调 Java → JNI nativeRunGC → JS_RunGC）
    releaseBallast()
    ballastHolder = null // 双保险（模块级变量也置空——防"引用仍在"导致 GC 不回收）
    transport.call('gc', 'null')
    const m2 = read()
    memAfterGc = m2.used
    memOk = memAfterAlloc > memBefore && memAfterGc < memAfterAlloc
    memScopeForReport = memScope
  }

  // ── G. G-41 宿主 conformance（用**本运行时**替换 stub） ──
  const conf = runHostConformance({ host: rt })

  // ── 销毁（终态） ──
  let c4 = false
  rt.destroy()
  try {
    rt.destroy()
  } catch {
    c4 = true
  }
  let c5 = false
  try {
    rt.enqueue(() => {})
  } catch {
    c5 = true
  }
  void c3

  // ══════════════════════════════════════════════════════════════════
  // I. ★★应用与生命周期能力开放（C23/C24/C25）——**端到端**：真实事件源 → 真实 Hooks
  //
  // 【为什么放在本场景（而不是单测就够了）】单测证明逻辑（Node/V8）；本场景证明
  //   **设备上、经壳注入的标识与总线**能让三个 Hook 真的被驱动——这才是"能力开放"的判据。
  // 【两条真实事件源】① 壳（`__proteusHostShellLifecycle` 的真实生命周期转发）；
  //   ② 虚拟栈命令流（真实 app-stack 的 drain 输出 → 翻译器 → 页面事件）。
  // ══════════════════════════════════════════════════════════════════
  // ★用**全局单例**总线：壳（`shellLifecycle`）与场景订阅**同一个** ⇒ 壳事件能驱动这里的 Hooks
  const capBus = getHostLifecycleBus()
  const capCaps = createAppLifecycleCapabilities(capBus, Error as unknown as new (c: string, m: string) => Error)

  const capLog: string[] = []
  const lc = capCaps.getAppLifecycle()
  let launches = 0
  lc.onLaunch(() => {
    launches++
    capLog.push('app:launch')
  })
  lc.onShow(() => capLog.push('app:show'))
  lc.onHide(() => capLog.push('app:hide'))
  const pl = capCaps.getPageLifecycle()
  pl.onLoad(() => capLog.push('page:load'))
  pl.onShow(() => capLog.push('page:show'))
  pl.onHide(() => capLog.push('page:hide'))

  // ② 真实栈命令流 → 页面生命周期（**真实 app-stack**，与 M5 同实现）
  const capSpecs: Record<string, AppScreenSpec> = {
    home: { name: 'home', path: '/home' },
    detail: { name: 'detail', path: '/detail' },
  }
  const capStack = createAppStack({ screens: capSpecs })
  const pageSrc = createStackPageSource(capBus)
  const feed = () => {
    for (const c of capStack.drainCommands()) pageSrc.apply(c as never)
  }
  capStack.push('home')
  feed()
  capStack.push('detail', { id: 1 })
  feed()
  capStack.pop()
  feed()
  const capPageAfterPop = capBus.snapshot().currentScreen

  // ① 壳事件 → 能力总线（**执行器的接线形态**：壳把真实生命周期转发给运行时后，
  //   运行时/执行器再把它们派发到能力总线；此处用真实发生过的 shellLog 重放）
  //
  // ★★顺序（真机/桌面首验抓到的判据缺陷）：`shellLog` 里是**本场景开始前**发生过的事件
  //   （壳转发在 bundle 加载时就已进行）⇒ 若先重放再订阅，"launch" 必然读不到。
  //   真实 App 的顺序是「订阅在前、事件在后」⇒ 本场景也照此：**先补一次冷启动 show**
  //   （壳里尚未发生的部分），再重放已发生的历史。
  const shellSuspend = shellLog.filter((e) => e.evt === 'pause' && e.applied).length
  const shellResume = shellLog.filter((e) => e.evt === 'resume' && e.applied).length
  // ★壳事件已在 `shellLifecycle` 里直驱总线（执行器接线形态）——此处只在**尚无任何壳事件**时
  //   补一次冷启动 show（桌面/未触发的形态，验证同一条语义链）
  if (shellLog.length === 0) {
    capBus.emit({ topic: 'app', kind: 'show' })
  }

  // ③ 异步部分（useBackground 返回 Promise ⇒ 挂全局，**finish 相位**读——正好再证 job 泵）
  // ★冷启动补 launch 的**独立读数**（订阅已在前，此时总线仍是 PENDING ⇒ show 必备随 launch）
  const coldLaunchProbe: string[] = []
  const probeOff = capBus.on('app:launch', () => coldLaunchProbe.push('cold'))
  probeOff()

  const capShellDriven: string[] = []
  const offShellProbe = capBus.on('app:show', () => capShellDriven.push('show'))
  const offShellProbe2 = capBus.on('app:hide', () => capShellDriven.push('hide'))
  void offShellProbe
  void offShellProbe2

  const capPending: {
    bgReady: boolean
    bgEvents: string[]
    launchOptions: Record<string, unknown>
    appPhase: string
    pagePhase: string
    pageAfterPop: string | null
    launches: number
    log: string[]
    sysLog: string[]
    subscribers: number
  } = {
    bgReady: false,
    bgEvents: [],
    launchOptions: {},
    appPhase: capBus.snapshot().app,
    pagePhase: capBus.snapshot().page,
    pageAfterPop: capPageAfterPop,
    launches,
    log: capLog,
    sysLog: [],
    subscribers: capBus.subscriberCount,
  }
  ;(globalThis as unknown as { __proteusCapPending?: typeof capPending }).__proteusCapPending = capPending
  capBus.setLaunchOptions({ path: 'pages/detail', query: { id: '7' } })
  const bg = capCaps.getBackground()
  bg.onEvent((e: { type: string }) => capPending.bgEvents.push(e.type))
  // 事件面：发一次内存警告/主题变化验证系统事件通道
  const sysLog: string[] = []
  bg.onMemoryWarning((lv: number) => sysLog.push(`mem:${lv}`))
  bg.onThemeChange((t: string) => sysLog.push(`theme:${t}`))
  capBus.emit({ topic: 'memory-warning', level: 2 })
  capBus.emit({ topic: 'theme-change', theme: 'dark' })
  capPending.sysLog = sysLog
  // ★async 部分：getLaunchOptions 返回 Promise（**finish 相位**读——再证 job 泵）
  void bg.getLaunchOptions().then((r: { ok: boolean; data?: Record<string, unknown> }) => {
    if (r.ok) capPending.launchOptions = r.data ?? {}
    capPending.appPhase = capBus.snapshot().app
    capPending.pagePhase = capBus.snapshot().page
    capPending.launches = launches
    capPending.log = capLog
    capPending.subscribers = capBus.subscriberCount
    capPending.bgReady = true
  })

  // ══════════════════════════════════════════════════════════════════
  // K. ★★应用级生命周期事件源（真系统回调 → JS 总线）——用户要求「保险点儿」
  //
  // 【验证什么】能用 Android 真 API 的事件必须有**真实来源**，且**三环对齐**（任一环断 ⇒ K 红）：
  //   ① Java 侧真系统回调（HostLifecycleEvents.attempts——只在真回调入口 +1）
  //   ② Java 侧成功推入 JS（pushes——壳推通道回执 ok 才 +1）
  //   ③ 本探针（总线订阅者）收到（seen）
  //
  // 【★★为什么重做（2026-09-30 实测抓出的假绿）】初版在这里 `emitFn(...)` **自触发**六个事件
  //   ⇒ 判据读的是"场景自己造的事件"：**把 Java 侧来源整类删掉，K 组照样全绿**。
  //   ⇒ 现在：系统事件一律由**脚本驱动**（run-host-runtime.sh ④/⑥ 阶段：
  //     send-trim-memory / uimode night / user-rotation / TEST_CRASH），本探针**只被动记录**。
  //   ★唯一保留的自触发是 `emitBadEvent`（那是对**校验器**的单测：非法事件名必须被拒——
  //     它验的不是"来源"，不构成假绿）。
  //
  // 【证据落盘】最终快照由 Java 侧在**未捕获异常处理器**里写 `host-app-events.json`
  //   （进程死前最后一刻：java 记账 + 本探针快照 + crash 节）——判据读那份做三链对齐。
  // ══════════════════════════════════════════════════════════════════
  const appEventProbe: Record<string, unknown> =
    (globalThis as unknown as { __proteusAppEventProbe?: Record<string, unknown> }).__proteusAppEventProbe ?? {}
  ;(globalThis as unknown as { __proteusAppEventProbe?: typeof appEventProbe }).__proteusAppEventProbe = appEventProbe
  void (async () => {
    try {
      const { getHostLifecycleBus: getBus, APP_EVENTS: ALL_APP_EVENTS } = await import('@proteus-vue/api/capability-app')
      const bus = getBus()
      // ★幂等：bundle 重载（同进程内二次 RUN）不重复订阅——seen 计数不翻倍、总线不泄漏订阅
      if (appEventProbe.subscribed === undefined) {
        const seen: Record<string, number> = {}
        for (const e of ALL_APP_EVENTS) seen[e] = 0
        // 订阅全部（观察总线层——不经 Hooks，避免 Hook 层的"晚订阅补发"干扰计数）
        for (const e of ALL_APP_EVENTS) {
          bus.on(`app:${e}` as never, () => {
            seen[e] = (seen[e] ?? 0) + 1
          })
        }
        appEventProbe.seen = seen
        appEventProbe.subscribed = ALL_APP_EVENTS.length
      }
      // ★壳推通道是否已装（installAppEventSource 的产物）
      appEventProbe.hostChannelInstalled =
        typeof (globalThis as { __proteusHostAppEvent?: unknown }).__proteusHostAppEvent === 'function'
      // ★唯一自触发：校验器单测（非法事件名必须被拒 + 可读回执）
      const emitFn = (globalThis as { __proteusHostAppEvent?: (e: string, p?: unknown) => string }).__proteusHostAppEvent
      if (emitFn && appEventProbe.emitBadEvent === undefined) {
        appEventProbe.emitBadEvent = emitFn('not-a-real-event')
      }
      appEventProbe.done = true
    } catch (e) {
      appEventProbe.fatal = String(e)
      appEventProbe.done = true
    }
  })()

  // ══════════════════════════════════════════════════════════════════
  // J. ★★App 端原生能力通道（`__proteusHostInvoke`）——**同一份业务代码在 App 端跑**
  //
  // 【验证什么（用户要求 App 也要落地）】10 个能力经壳转发：已实现的真调用、未实现的诚实 Err。
  // 【异步形态】本场景主函数是**同步**的（与 I 组同构）⇒ 用 `.then` 链收集结果到 pending，
  //   由 finish 相位读（正好再证 job 泵）。
  // ══════════════════════════════════════════════════════════════════
  const appPending: Record<string, unknown> = { done: false }
  ;(globalThis as unknown as { __proteusAppPending?: typeof appPending }).__proteusAppPending = appPending
  void (async () => {
    try {
      const { createAppNativeCapabilities } = await import('@proteus-vue/api/capability-app')
      // ★★构造器必须**带 code 属性**（真实用户传 `CapError`）——传原生 `Error` 会让 code 丢失
      //   （`new Error(code, msg)` 只取第一个参数当 message）⇒ 判据读不到 code（真机实测抓出）。
      //   本场景自建一个 CapError 形态的构造器（与 packages/api 的 CapError 同形）。
      class DemoCapError extends Error {
        constructor(
          public readonly code: string,
          message: string,
          public readonly cause?: unknown,
        ) {
          super(`[proteus-cap] ${code}: ${message}`)
          this.name = 'CapError'
        }
      }
      const appCaps = createAppNativeCapabilities(DemoCapError)

      // ① C48 宿主上下文（壳自述——已实现）
      appPending.hostContext = appCaps.getHostContext()
      // ② C51 热更新
      const um = appCaps.getUpdateManager()
      appPending.updateCheck = await um.checkUpdate()
      appPending.updateApply = await um.applyUpdate()
      // ③ C74 窗口
      appPending.windowSetSize = await appCaps.getWindow().setSize(1024, 768)
      // ④ C53 Worker
      try {
        // ★桥现在会把 create 返回的 workerId 带到 post/terminate（真机实测修出的契约断链）
        const w = appCaps.createWorker('demo.js') as unknown as {
          postMessage: (m: unknown) => { ok: boolean; data?: unknown; error?: unknown }
          terminate: () => { ok: boolean }
        }
        appPending.workerPost = w.postMessage({ ping: 1 })
        appPending.workerTerminate = w.terminate()
      } catch (e) {
        appPending.workerError = String(e)
      }
      // ⑤ C73 空闲（含回调）
      let idleCalled = false
      appPending.idleRequest = await appCaps.getIdle().request(() => {
        idleCalled = true
      }, 100)
      appPending.idleCallbackRan = idleCalled
      // ⑥ C67 预加载（assets 已实现 / subpackage 诚实 Err）
      const pre = appCaps.getPreload() as unknown as { assets: (d: unknown) => Promise<unknown>; subpackage: (t: string) => Promise<unknown> }
      appPending.preloadAssets = await pre.assets([])
      appPending.preloadSubpackage = await pre.subpackage('main')
      // ⑦ C75 导航守卫（框架内实现）
      const ng = appCaps.getNavigationGuard()
      appPending.guardEnable = await ng.enable('有未保存内容')
      appPending.guardDisable = await ng.disable()
      // ⑧ C50 扩展（壳未实现 ⇒ 诚实 Err）——★读真实 R（loadExtension 返回 CapResult 而非抛错：
      //   初版脚本用 `.then(ok, err)` ⇒ 恒 ok:true（第一个回调总执行）——**验证脚本自身写错**，已纠正）
      appPending.extensionLoad = await appCaps.loadExtension('demo-ext')
      // ⑨ C47 跳小程序（壳未实现 ⇒ 诚实 Err）
      appPending.navigateMiniProgram = await appCaps
        .navigateMiniProgram({ appId: 'wx-demo' })
        .then(() => ({ ok: true }), (e: Error & { code?: string }) => ({ ok: false, code: e.code }))
      // ⑩ C82 WebAssembly（★★真实 wasm 执行：宿主侧 wasm3 —— 手写模块验证 add(a,b)）
      //   为什么手写：QuickJS 内建无 WASM（实测）⇒ 本端由**宿主 wasm3**执行；
      //   判据要真跑一条指令序列（i32.add），不是"能实例化空模块"这种弱断言。
      type WasmCapsT = {
        supportsStreaming: boolean
        validate: (b: Uint8Array) => Promise<{ ok: boolean; data?: boolean; error?: { code?: string; message?: string } }>
        instantiate: (src: { bytes: Uint8Array }, opts?: unknown) => Promise<{ ok: boolean; data?: { __hostHandle?: number; dispose?: () => void }; error?: { code?: string; message?: string } }>
      }
      const wasmCaps = appCaps.getWebAssembly() as unknown as WasmCapsT
      appPending.wasmSupportsStreaming = wasmCaps.supportsStreaming
      // 手写 wasm：(module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
      const ADD_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11])
      const inst = await wasmCaps.instantiate({ bytes: ADD_WASM }, { limits: { stackBytes: 65536, gasUnits: 1000000 } })
      if (inst.ok && inst.data) {
        const h = (inst.data as { __hostHandle?: number }).__hostHandle
        if (h) {
          // ① 宿主运行时路径（Android wasm3）：真调用 add(2, 40) → 期望 42
          const { invokeHost: rawInv } = await import('@proteus-vue/api/capability-app')
          const callRes = rawInv('webassembly.call', { handle: h, fn: 'add', args: [2, 40] })
          // ★宿主返回 {ok:true, result:N, type:'i32'} —— 取 result（并带上 type 供判据核对）
          appPending.wasmAddResult = callRes.ok
            ? (callRes.data as { result?: unknown; type?: string })
            : { ok: false, reason: callRes.reason }
        } else {
          // ② 引擎内建路径（iOS JSC：`typeof WebAssembly === 'object'` 实测）——标准 WASM API 直调。
          //    ★两条路径**都必须真执行** i32.add（不是"能实例化"这种弱断言）；engine 字段供判据分档。
          const ex = (inst.data as unknown as { exports?: Record<string, unknown> }).exports
          const fn = ex?.add
          const val = typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown)(2, 40) : null
          appPending.wasmAddResult = { ok: true, result: val, type: 'i32', engine: 'engine-builtin' }
        }
        inst.data.dispose?.()
      } else {
        appPending.wasmAddResult = { ok: false, reason: inst.error?.message ?? 'instantiate 失败' }
      }
      // ★★真实宿主自报调用记录（`native.calls`）——证明"能力确实经宿主导出"，
      //   而非桥自造数据（初版用 JS 桩；现已删桩，读宿主的记账）。
      const wv = await wasmCaps.validate(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))
      // ★Error 对象 JSON 序列化会丢 code/message（变成 {}）⇒ 显式展开（判据据此分档）
      const wvErr = (wv as { error?: { code?: string; message?: string } }).error
      appPending.wasmValidateEmptyModule = wv.ok
        ? { ok: true, data: wv.data }
        : { ok: false, code: wvErr?.code, message: String(wvErr?.message ?? '') }
    } catch (e) {
      appPending.fatal = String(e)
    }
    // ★★壳调用记录（真 Java 宿主自报——见 HostCapabilities.callLog）
    //   ★若宿主未实现 invoke，此处会 unsupported ⇒ 判据红（桩时代不成立的判据）
    try {
      const { invokeHost: rawInvoke } = await import('@proteus-vue/api/capability-app')
      const rec = rawInvoke('native.calls')
      appPending.__hostCalls = rec.ok ? rec.data : { ok: false, reason: rec.reason }
    } catch (e) {
      appPending.__hostCalls = { ok: false, reason: String(e) }
    }
    appPending.done = true
  })()

  const result = {
    ok: true,
    scene: 'host-runtime',
    // ★平台标识（壳注入——判据按此分档：内存口径 engine/process、帧驱动源名）
    host_id: HOST_ID,
    frame_driver: FRAME_DRIVER,
    build_id: BUILD_ID,
    // A/B：生命周期
    state_created: stateA0,
    state_running: stateA1,
    state_suspended: stateB1,
    state_resumed: stateB2,
    // C：非法转换拒绝
    refuse_bootstrap_when_suspended: c1,
    refuse_double_resume: c2,
    refuse_destroy_twice: c4,
    refuse_enqueue_after_destroy: c5,
    refusals_recorded: refusalsBeforeDestroy,
    // D：队列/帧
    pump_while_suspended: pumpWhileSuspended,
    pump_after_resume: pumpAfterResume,
    ran_after_resume: ranAfterResume,
    pump_self_queued: pumpInFrame,
    // E：职责边界（同步部分）
    refuse_background_thread: e1,
    // E：职责边界（异步部分）
    // ★证据链：run 相位读一次（**必须 false**——Promise 续体不可能是同步完成的假象），
    //   finish 相位再读（**必须 true**——中间只有宿主侧的 job 泵能推动它；缺泵 ⇒ 恒 false ⇒ 判据红）
    async_resolved_at_run: asyncState.e2 || asyncState.e3,
    // F：内存账本（引擎真实 JS 堆读数——分配增长 / GC 下降）
    mem_available: !!transport,
    mem_before: memBefore,
    mem_after_alloc: memAfterAlloc,
    mem_after_gc: memAfterGc,
    mem_obj_before: memObjBefore,
    mem_obj_after: memObjAfter,
    mem_ok: memOk,
    mem_scope: memScopeForReport,
    // G：conformance
    conf_total: conf.total,
    conf_pass: conf.pass,
    conf_fail: conf.fail,
    conf_skip: conf.skip,
    conf_fail_ids: conf.results.filter((r) => r.status === 'FAIL').map((r) => r.id),
    // 终态
    state_destroyed: rt.state,
    refusal_ops: rt.refusals.map((r) => r.op),
    // H：真实宿主壳转发（MainActivity.onPause/onResume → __proteusHostShellLifecycle）
    shell_hook_installed: typeof (globalThis as unknown as { __proteusHostShellLifecycle?: unknown }).__proteusHostShellLifecycle === 'function',
    shell_lifecycle_logged: shellLog.length,
    shell_suspend_applied: shellLog.filter((e) => e.evt === 'pause' && e.applied).length,
    shell_resume_applied: shellLog.filter((e) => e.evt === 'resume' && e.applied).length,
    // I：应用与生命周期能力（C23/C24/C25）——同步读数；异步部分（bg_*）在 finish 相位补齐
    cap_log: capLog,
    cap_launches: launches,
    // ★冷启动补 launch 的独立证据：记录"第一个 show 事件到达时，launch 是否已随之前置"
    cap_launch_before_any_show: capLog.indexOf('app:launch') >= 0 && (capLog.indexOf('app:show') < 0 || capLog.indexOf('app:launch') < capLog.indexOf('app:show')),
    cap_page_after_pop: capPageAfterPop,
    cap_shell_suspend: shellSuspend,
    cap_shell_resume: shellResume,
    cap_shell_driven_events: capShellDriven.length,
    cap_subscribers: capBus.subscriberCount,
  }
  return JSON.stringify(result)
}

// ★挂到全局，供 Java 侧直接 eval 调用（IIFE 无模块系统）
;(globalThis as unknown as { __proteusHostRun: typeof __proteusHostRun }).__proteusHostRun = __proteusHostRun

/**
 * ★★**finish 相位**：读异步断言的结果（`proteusHost.memUsage` 的同步读数 + E 组 Promise 续体）。
 *
 * 【为什么必须两相（本场景的设计要点，不是变通）】`invokeNative` 的返回是 Promise——
 *   它的续体是 QuickJS 的 **pending job**，只有宿主的事件循环能推进
 *   （`nativeRunPendingJobs` → `JS_ExecutePendingJob`；本轮新补的 JNI 入口）。
 *   ⇒ Java 侧顺序必须是：`__proteusHostRun()` → `nativeRunPendingJobs()` → `__proteusHostFinish()`。
 *   **这条顺序本身**就是 G-39「事件循环由运行时唯一拥有」在设备上的可执行证明：
 *   假如 job 泵缺失（本仓此前的真实状态），本相位的 e2/e3 恒为 false ⇒ 判据当场红。
 */
export function __proteusHostFinish(): string {
  const st = (globalThis as unknown as { __proteusHostAsync?: { e2: boolean; e3: boolean; e3Value: string } })
    .__proteusHostAsync
  const cap = (globalThis as unknown as { __proteusCapPending?: Record<string, unknown> }).__proteusCapPending
  const app = (globalThis as unknown as { __proteusAppPending?: Record<string, unknown> }).__proteusAppPending
  return JSON.stringify({
    async_resolved: !!st && (st.e2 || st.e3),
    refuse_unregistered_native: st?.e2 ?? false,
    registered_native_ok: st?.e3 ?? false,
    registered_native_value: st?.e3Value ?? '',
    // I：能力开放的异步读数（useBackground 的 Promise 经 job 泵 resolved）
    cap_bg_ready: cap?.bgReady ?? false,
    cap_bg_events: cap?.bgEvents ?? [],
    cap_launch_options: cap?.launchOptions ?? {},
    cap_app_phase: cap?.appPhase ?? 'PENDING',
    cap_page_phase: cap?.pagePhase ?? 'IDLE',
    cap_subscribers: cap?.subscribers ?? -1,
    // J：App 端原生能力通道读数（**同一份业务代码在 App 端跑**）
    app_native: app ?? { done: false },
    // K：应用级生命周期事件源（真系统回调 → 总线）
    app_events: (globalThis as unknown as { __proteusAppEventProbe?: unknown }).__proteusAppEventProbe ?? { done: false },
  })
}

;(globalThis as unknown as { __proteusHostFinish: typeof __proteusHostFinish }).__proteusHostFinish =
  __proteusHostFinish
