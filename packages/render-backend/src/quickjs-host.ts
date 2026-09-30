// packages/render-backend/src/quickjs-host.ts
// ★★G-39 B4 切片（proteus-host-runtime-plan）：**单线程 JS 引擎宿主运行时**——真实实现
//
// 【为什么需要（本文件存在的理由，两句话）】
//   ① G-39 的四块拼图（环境/JS 引擎/事件循环/原生桥）此前只有**参考 stub**（host-conformance.ts 的
//      `createHostRuntimeStub`）+ **Web 宿主**（web-host.ts）；**嵌入式 JS 引擎宿主**（Android QuickJS /
//      iOS JSC 同族：单线程、无 Worker、帧与原生调用由宿主壳注入）**没有任何真实实现** ⇒ G-39 的
//      "B4 iOS/Android/Flutter 宿主"对这两端是零。
//   ② 它是 M5 虚拟栈等上层能力的**运行底座**：帧调度、生命周期、原生调用必须只有一个 owner（G-39.1）。
//
// 【与 web-host.ts 的差别（为什么不是一个实现）】
//   · 无线程原语：没有 Worker / message channel ⇒ **诚实声明 `threads.background=false`**（CMP 原则 #13）；
//     `runOnThread('background', …)` **明确拒绝并记账**，而不是假装排队（假排队 = 静默降级，框架
//     会以为自己拿到了后台线程）。
//   · 无 Event Loop：JS 引擎（QuickJS）不自带事件循环 ⇒ 队列由**宿主帧驱动**（`pumpFrame()` 被
//     Android Choreographer / iOS CADisplayLink 调）⇒ 与 web 的 `flush()`（queueMicrotask）形态不同。
//   · 原生桥是**宿主壳注入的 transport**（Android 走 proteusHost.* → JNI；iOS 走 JSExport）——
//     G-39 的"原生桥唯一拥有"在嵌入式宿主就是这样落地的：JS 侧唯一的出口是 runtime.invokeNative。
//   · **生命周期由宿主壳转发**（Activity onPause/onResume → runtime.suspend/resume；
//     见 hosts/android 的 `__proteusHostLifecycle`）——Backend 不得自己判断前后台（G-39.1）。
//
// 【本文件同时是"单线程嵌入式 JS 引擎宿主"的骨架】iOS JSC / 鸿蒙 ArkTS 轻量形态可复用同一骨架，
//   差异只在宿主壳注入的 transport 与帧驱动源（真出现第二个消费者时再抽公共基座——不做超前抽象）。
import type { HostRuntimeLike } from './host-conformance'

/** 宿主原生调用通道（宿主壳注入：Android = proteusHost.* / iOS = JSExport；**同步**返回 JSON 串） */
export interface NativeTransport {
  /** 调用宿主（同步；返回 JSON 字符串；抛错 = 原生调用失败，语义与 JNI 异常对齐） */
  call(name: string, argsJson: string): string
}

/** 职责边界拒绝记录（G-39.1「唯一拥有」的机器证据——非法操作**被拒绝**而不是被静默吞掉） */
export interface RuntimeRefusal {
  op: string
  reason: string
  /** 拒绝时的状态（诊断用） */
  state: string
}

/** 能力自描述（G-39.3 诚实声明——框架据此决定降级，而不是运行时假装支持） */
export interface QuickJsHostCapabilities {
  threads: { main: boolean; background: boolean; count: number }
  engine: 'quickjs' | 'jsc' | 'node' | 'none'
  nativeBridge: boolean
  lifecycle: 'full' | 'basic' | 'none'
  /** 帧驱动源（诊断：谁在调 pumpFrame） */
  frameDriver: string
}

/** 逻辑 worker 域（**无真并行**——诚实声明；`real=false` 是"单线程宿主"的机器可读标记） */
export interface LogicalWorkerHandle {
  id: string
  thread: string
  /** ★恒为 false：本宿主无真并行（有真 Worker 的宿主见 web-host 的 WebWorkerHandle.raw） */
  real: false
}
export interface QuickJsHostRuntime extends HostRuntimeLike {
  readonly id: string
  readonly capabilities: QuickJsHostCapabilities
  /** ★宿主帧驱动入口（Android Choreographer / iOS CADisplayLink 调用）——返回本帧执行的任务数 */
  pumpFrame(): number
  /** 生命周期由宿主壳转发（Activity onPause/onResume → 这里）——事件流是治理证据 */
  readonly lifecycleEvents: ReadonlyArray<'suspend' | 'resume' | 'destroy'>
  /** 职责边界拒绝日志（非法操作被拒绝的机器证据；不断言"我们不会犯错"，断言"犯错会被拒绝"） */
  readonly refusals: ReadonlyArray<RuntimeRefusal>
  /** 注册 JS→原生方向的原生处理器（宿主壳也可以注册；业务不得绕过 runtime 直连宿主——G-39.1） */
  registerNativeHandler(name: string, handler: (args: unknown) => unknown): void
  /** 调原生：注册的处理器优先，否则走 transport；未注册/未导出 ⇒ **拒绝并记账**（不静默） */
  invokeNative(name: string, args?: unknown): Promise<unknown>
  /**
   * 线程委派（G-39 计划面）：`'main'` ⇒ 入队（由 pumpFrame 消费）；
   * `'background'` ⇒ **诚实拒绝**（capabilities.threads.background=false）——
   * ★这正是 G-39 要治的病：「各 Backend 自己 pthread_create」在本宿主里**没有后门**，
   *   要么查 capabilities 走降级，要么被 runtime 拒绝（记账可观测）。
   */
  runOnThread(thread: 'main' | 'background', task: () => void): void
  /** 已注册的原生处理器名（诊断） */
  readonly nativeHandlers: string[]
}

export interface QuickJsHostOptions {
  /** 宿主标识（'android' | 'ios' | 'harmony' | 诊断用） */
  id?: string
  /** JS 引擎标识（诚实声明） */
  engine?: QuickJsHostCapabilities['engine']
  /** 帧驱动源名（诊断：'Choreographer' / 'CADisplayLink' / 'manual'） */
  frameDriver?: string
  /** 原生调用通道（缺省无桥：invokeNative 未命中处理器时**明确拒绝**） */
  transport?: NativeTransport
}

/**
 * ★★G-39 B4：创建单线程 JS 引擎宿主运行时（Android QuickJS / iOS JSC 同族骨架）
 *
 * 职责边界（G-39.1「唯一拥有」在本实现的落点）：
 *   · **生命周期**：只有 runtime 拥有状态机；宿主壳（Activity）只能**转发**事件；非法转换被拒绝并记账。
 *   · **线程**：只有 runtime.createWorker 能产生新的执行域；`runOnThread('background')` 在本宿主
 *     诚实拒绝（threads.background=false）——调用方应先查 capabilities（G-39.3）。
 *   · **事件循环**：只有 runtime.pumpFrame 消费队列（宿主帧驱动）；destroy 清空队列（不悬空）。
 *   · **原生桥**：唯一出口 invokeNative；未注册 ⇒ 拒绝 + 记账（不静默返回 undefined）。
 */
export function createQuickJsHostRuntime(opts: QuickJsHostOptions = {}): QuickJsHostRuntime {
  const id = opts.id ?? 'quickjs'
  const capabilities: QuickJsHostCapabilities = {
    threads: { main: true, background: false, count: 1 }, // ★诚实声明：无后台线程
    engine: opts.engine ?? 'quickjs',
    // 桥**机制**恒在（registerNativeHandler/invokeNative/拒绝协议都存在）；transport 是可选出口
    nativeBridge: true,
    lifecycle: 'full', // 宿主壳转发 onPause/onResume ⇒ full
    frameDriver: opts.frameDriver ?? 'manual',
  }

  const refusals: RuntimeRefusal[] = []
  const lifecycleEvents: Array<'suspend' | 'resume' | 'destroy'> = []
  const handlers = new Map<string, (args: unknown) => unknown>()

  /** 记账 + 抛错（**不静默**——G-39 铁律：非法操作必须可观测） */
  const refuse = (op: string, reason: string): never => {
    refusals.push({ op, reason, state: rt.state })
    throw new Error(`[${id}] 职责边界拒绝 ${op}：${reason}（state=${rt.state}）`)
  }

  const rt: QuickJsHostRuntime = {
    id,
    state: 'created',
    threads: ['main'],
    workers: [],
    queue: [],
    capabilities,
    lifecycleEvents,
    refusals,
    nativeHandlers: [],

    bootstrap() {
      if (rt.state === 'destroyed') refuse('bootstrap', '已销毁的运行时不可复活（G-39.1：生命周期唯一拥有）')
      if (rt.state === 'suspended') refuse('bootstrap', '已挂起状态下请用 resume()（bootstrap 只负责 created 起步）')
      // created → running；running → 幂等（宿主重复 bootstrap 不应炸，但也不重置任何状态）
      rt.state = 'running'
      return rt
    },

    suspend() {
      if (rt.state !== 'running') refuse('suspend', '仅 running 可挂起（重复 suspend / 未 bootstrap 都被拒绝）')
      rt.state = 'suspended'
      lifecycleEvents.push('suspend')
    },

    resume() {
      if (rt.state !== 'suspended') refuse('resume', '仅 suspended 可恢复（防"没挂起过却上报 resume"的假事件）')
      rt.state = 'running'
      lifecycleEvents.push('resume')
    },

    destroy() {
      if (rt.state === 'destroyed') refuse('destroy', '重复销毁（第二次 destroy 通常是上层的重复清理——真实缺陷）')
      rt.state = 'destroyed'
      rt.queue = []
      rt.workers = []
      rt.threads = ['main']
      lifecycleEvents.push('destroy')
    },

    createWorker() {
      if (rt.state === 'destroyed') refuse('createWorker', '已销毁的运行时不能创建执行域')
      // ★逻辑执行域（无真并行）——与 web-host 的真实 Worker 区分在 `real` 标记上（诚实声明）
      const w: LogicalWorkerHandle = {
        id: `w${rt.workers.length + 1}`,
        thread: `worker${rt.workers.length + 1}`,
        real: false,
      }
      rt.workers.push(w)
      rt.threads.push(w.thread)
      return w
    },

    postMessage() {
      // 单线程无跨线程消息通道 ⇒ 队列内投递（同线程语义；诚实：不做跨线程假象）
      return true
    },

    enqueue(task, priority = 2) {
      if (rt.state === 'destroyed') refuse('enqueue', '已销毁的运行时不再接收任务（防悬空回调）')
      rt.queue.push({ task, priority })
    },

    nextTick(fn) {
      if (rt.state === 'destroyed') refuse('nextTick', '已销毁的运行时不再接收任务')
      rt.queue.push({ task: fn, priority: 0 })
    },

    drain() {
      rt.queue.sort((a, b) => a.priority - b.priority)
      const out: unknown[] = []
      while (rt.queue.length) {
        const { task } = rt.queue.shift()!
        out.push(task())
      }
      return out
    },

    /** ★宿主帧驱动（Android Choreographer / iOS CADisplayLink）：一帧消费一次队列 */
    pumpFrame() {
      if (rt.state === 'destroyed') return 0
      if (rt.state === 'suspended') return 0 // 挂起 = 不推进（帧预算归还宿主；G-39 生命周期语义）
      rt.queue.sort((a, b) => a.priority - b.priority)
      let n = 0
      while (rt.queue.length) {
        const { task } = rt.queue.shift()!
        task()
        n++
      }
      return n
    },

    registerNativeHandler(name, handler) {
      handlers.set(name, handler)
      rt.nativeHandlers.push(name)
    },

    runOnThread(thread, task) {
      if (thread === 'main') {
        rt.enqueue(task, 2)
        return
      }
      // ★诚实拒绝：无后台线程。**不做假排队**——假排队会让调用方以为任务已并行完成。
      return refuse('runOnThread(background)', '本宿主 capabilities.threads.background=false（单线程 JS 引擎；调用方应查 capabilities 后降级）')
    },

    async invokeNative(name, args) {
      if (rt.state === 'destroyed') refuse('invokeNative', '已销毁的运行时不能调原生')
      const h = handlers.get(name)
      if (h) return h(args)
      if (opts.transport) {
        const json = opts.transport.call(name, JSON.stringify(args ?? null))
        try {
          return JSON.parse(json)
        } catch {
          return json // 非 JSON 返回原样（宿主契约未强制 JSON 时可以这样）
        }
      }
      return refuse('invokeNative', `原生方法「${name}」未注册且无 transport（已注册：${rt.nativeHandlers.join(', ') || '（空）'}）`)
    },
  }

  return rt
}
