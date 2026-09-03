// packages/render-backend/src/web-host.ts
// ★G-41 B4（proteus-host-integration-plan batches B4 · Web 宿主）：WebHostRuntime 可运行骨架
//   对齐 host-guide §5 Web（Main + Worker + Event Loop）+ host-conformance 的 HostRuntimeLike 面：
//     · bootstrap/suspend/resume/destroy 状态机（G-41.6 注册先于 bootstrap）
//     · createWorker：真实 Web Worker（浏览器）/ fake 降级（SSR/测试——诚实声明）
//     · enqueue/nextTick：Event Loop 语义（微任务队列）；flush() 灌入 queueMicrotask（真实异步路径）
//     · bindPageVisibility：visibilitychange → suspend/resume（宿主生命周期挂钩）
//   与 B3 vue-bridge 组合即「Web 端完整链路」：SFC → Vue renderer → Dispatcher → VueDomBackend → DOM
import type { HostRuntimeLike } from './host-conformance'

/** Worker 句柄（真实 Worker 或降级 fake） */
export interface WebWorkerHandle {
  id: string
  thread: string
  /** 真实 Web Worker 实例（浏览器环境）；SSR/测试降级为 null */
  raw: unknown
  /** 终止（真实 worker.terminate() / fake 清空） */
  terminate(): void
}

export interface WebHostRuntime extends HostRuntimeLike {
  readonly id: 'web'
  /** override：workers 为 Web worker 句柄（含 terminate；SSR 降级 raw=null 诚实声明） */
  workers: WebWorkerHandle[]
  /** override：Web worker 句柄 */
  createWorker(scriptUrl?: string): WebWorkerHandle
  /** 微任务灌入 Event Loop（真实异步路径：await host.flush() 后队列任务执行） */
  flush(): Promise<void>
  /** visibilitychange → suspend/resume 挂钩（绑定 window/document；返回解绑；SSR 无 document 时安全跳过） */
  bindPageVisibility(): () => void
}

export interface WebHostOptions {
  /** Worker 工厂（缺省：浏览器 new Worker(url) / 非浏览器降级 fake——诚实声明） */
  createWorkerImpl?: (scriptUrl?: string) => { raw: unknown; terminate(): void }
  /** document/window 宿主（缺省用全局；注入可单测） */
  env?: { document?: Document; EventTarget?: typeof EventTarget }
}

function defaultWorkerFactory(scriptUrl?: string): { raw: unknown; terminate(): void } {
  const g = globalThis as { Worker?: new (url: string | URL) => { terminate(): void } }
  if (typeof g.Worker === 'function') {
    try {
      const w = new g.Worker(scriptUrl ?? '')
      return { raw: w, terminate: () => w.terminate() }
    } catch {
      // Worker 构造失败（如 blob: URL 受限）→ 降级 fake
    }
  }
  // SSR/Node/受限环境：fake worker（诚实标注 raw=null——G-37.3 能力诚实声明）
  return { raw: null, terminate() {} }
}

/** ★G-41 B4 Web 宿主运行时（Main + Worker + Event Loop 骨架） */
export function createWebHostRuntime(opts: WebHostOptions = {}): WebHostRuntime {
  const createWorkerImpl = opts.createWorkerImpl ?? defaultWorkerFactory
  const g = (opts.env ?? globalThis) as { document?: Document }

  const rt: WebHostRuntime = {
    id: 'web',
    state: 'created',
    threads: ['main'],
    workers: [] as WebWorkerHandle[],
    queue: [],
    bootstrap() {
      // G-41.6：注册先于 bootstrap——宿主持有方在 bootstrap 前完成 backend/carrier 注册
      rt.state = 'running'
      return rt
    },
    suspend() {
      rt.state = 'suspended'
    },
    resume() {
      rt.state = 'running'
    },
    destroy() {
      rt.state = 'destroyed'
      rt.queue = []
      for (const w of rt.workers) w.terminate()
      rt.workers = []
      rt.threads = ['main']
    },
    createWorker(scriptUrl?: string) {
      const impl = createWorkerImpl(scriptUrl as string | undefined)
      const w: WebWorkerHandle = {
        id: `w${rt.workers.length + 1}`,
        thread: `worker${rt.workers.length + 1}`,
        raw: impl.raw,
        terminate: impl.terminate,
      }
      rt.workers.push(w)
      rt.threads.push(w.thread)
      return w
    },
    postMessage() {
      return true
    },
    enqueue(task, priority = 2) {
      rt.queue.push({ task, priority })
    },
    nextTick(fn) {
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
    async flush() {
      // 微任务灌入 Event Loop（真实 Web 异步路径；顺序 = 优先级排序后的队列）
      if (!rt.queue.length) return
      const tasks = rt.queue.splice(0).sort((a, b) => a.priority - b.priority)
      for (const { task } of tasks) {
        await Promise.resolve()
        task()
      }
    },
    bindPageVisibility() {
      const doc = g.document
      if (!doc || typeof doc.visibilityState !== 'string') {
        // SSR/无 document：诚实跳过（Web 生命周期挂钩仅浏览器可用）
        return () => {}
      }
      const onVis = () => {
        if (doc.visibilityState === 'hidden') rt.suspend()
        else rt.resume()
      }
      doc.addEventListener('visibilitychange', onVis)
      return () => doc.removeEventListener('visibilitychange', onVis)
    },
  }
  return rt
}