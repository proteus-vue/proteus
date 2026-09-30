// hosts/android/bridge/entry-host-runtime.ts —— ★★G-39：真实宿主运行时在设备上跑（QuickJS）
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

/** 宿主桥（Java 侧 JsRenderHost 可选实现 memUsage/gc —— 条件注入，见 quickjs_jni.c） */
interface HostBridge {
  post?(json: string): void
  memUsage?(): string
  gc?(): void
}

declare const proteusHost: HostBridge | undefined

/** 取全局宿主（无宿主环境为 null） */
function globalHost(): HostBridge | null {
  if (typeof proteusHost === 'undefined' || proteusHost === undefined) return null
  return proteusHost
}

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
}
const shellLog: ShellLifecycleEntry[] = []
let shellRt: ReturnType<typeof createQuickJsHostRuntime> | null = null

/** 懒创建壳转发用的运行时（跨广播存活；不销毁——它代表"App 进程"本身） */
function ensureShellRt(): ReturnType<typeof createQuickJsHostRuntime> {
  if (!shellRt || shellRt.state === 'destroyed') {
    shellRt = createQuickJsHostRuntime({ id: 'android-shell', engine: 'quickjs', frameDriver: 'activity-lifecycle' })
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
  shellLog.push({ evt, applied, state: rt.state })
  return shellLog.length
}
;(globalThis as unknown as { __proteusHostShellLifecycle: typeof shellLifecycle }).__proteusHostShellLifecycle =
  shellLifecycle

/** 壳转发读数查询（Java 侧在每次 onPause/onResume 后 eval 它并写报告——真机证据） */
function shellQuery(): string {
  const suspends = shellLog.filter((e) => e.evt === 'pause')
  const resumes = shellLog.filter((e) => e.evt === 'resume')
  return JSON.stringify({
    hook_loaded: true,
    events: shellLog.length,
    suspend_requested: suspends.length,
    suspend_applied: suspends.filter((e) => e.applied).length,
    resume_requested: resumes.length,
    resume_applied: resumes.filter((e) => e.applied).length,
    final_state: shellRt ? shellRt.state : 'none',
    log: shellLog,
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

  const rt = createQuickJsHostRuntime({ id: 'android', engine: 'quickjs', frameDriver: 'device-scene', transport })

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
  if (transport) {
    const read = (): { used: number; obj: number } => {
      const j = JSON.parse(transport.call('memUsage', 'null')) as { memory_used_size?: number; obj_count?: number }
      return { used: j.memory_used_size ?? 0, obj: j.obj_count ?? 0 }
    }
    const allocateBallast = (): void => {
      const ballast: number[] = []
      for (let i = 0; i < 20000; i++) ballast.push(i) // 逐元素写入：真占内存（防惰性/稀疏数组）
      ;(globalThis as unknown as { __proteusMemBallast?: number[] }).__proteusMemBallast = ballast
    }
    const releaseBallast = (): void => {
      ;(globalThis as unknown as { __proteusMemBallast?: number[] | null }).__proteusMemBallast = null
    }
    const m0 = read()
    memBefore = m0.used
    memObjBefore = m0.obj
    allocateBallast()
    const m1 = read()
    memAfterAlloc = m1.used
    memObjAfter = m1.obj
    // 释放 + GC（GC 是宿主能力——经 transport 调 Java → JNI nativeRunGC → JS_RunGC）
    releaseBallast()
    transport.call('gc', 'null')
    const m2 = read()
    memAfterGc = m2.used
    memOk = memAfterAlloc > memBefore && memAfterGc < memAfterAlloc
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

  const result = {
    ok: true,
    scene: 'host-runtime',
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
  return JSON.stringify({
    async_resolved: !!st && (st.e2 || st.e3),
    refuse_unregistered_native: st?.e2 ?? false,
    registered_native_ok: st?.e3 ?? false,
    registered_native_value: st?.e3Value ?? '',
  })
}

;(globalThis as unknown as { __proteusHostFinish: typeof __proteusHostFinish }).__proteusHostFinish =
  __proteusHostFinish
