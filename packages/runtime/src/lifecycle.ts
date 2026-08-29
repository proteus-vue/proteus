// packages/runtime/src/lifecycle.ts
// ★lifecycle-plan B1+B2：App 级阶段化生命周期——defineApp API + LifecycleOrchestrator（顺序执行/超时降级/错误隔离/trace）
// 五阶段：bootstrap → coreReady → navigationReady → beforeFirstPaint → interactive（顺序即契约，业务不可篡改）
// 设计（docs/proteus-lifecycle-plan/01-m1-phases.md + 02-m2-orchestrator.md）
// 产物 ES5 安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构

/** 五阶段（顺序固定） */
export const PHASE_ORDER = ['bootstrap', 'coreReady', 'navigationReady', 'beforeFirstPaint', 'interactive'] as const
export type LifecyclePhase = (typeof PHASE_ORDER)[number]

/** 降级策略（阶段超时后） */
export type FallbackStrategy = 'warn' | 'minimal' | 'home' | 'skeleton' | 'lazy'

/** 默认超时（ms，M2 §六） */
export const DEFAULT_PHASE_TIMEOUT: Record<LifecyclePhase, number> = {
  bootstrap: 3000,
  coreReady: 5000,
  navigationReady: 2000,
  beforeFirstPaint: 3000,
  interactive: 5000,
}

/** 默认降级策略（M2 §五） */
export const DEFAULT_PHASE_FALLBACK: Record<LifecyclePhase, FallbackStrategy> = {
  bootstrap: 'warn',
  coreReady: 'minimal',
  navigationReady: 'home',
  beforeFirstPaint: 'skeleton',
  interactive: 'lazy',
}

export type LaunchType = 'cold' | 'warm' | 'recover'

/** 阶段上下文（业务钩子只读 ctx + 调已注册服务，禁止直连平台 API） */
export interface LifecycleContext {
  launchType: LaunchType
  launchOptions?: { path?: string; query?: Record<string, string> }
  network: 'wifi' | '4g' | '3g' | 'none'
  platform: 'web' | 'skyline' | 'app'
  /** ★minimal 模式（coreReady 超时/失败后）——业务读此标记跳过非必要逻辑 */
  isMinimalMode: boolean
}

export interface LifecycleTrace {
  phase: LifecyclePhase
  startTime: number
  duration: number
  status: 'success' | 'timeout' | 'error' | 'fallback'
  fallback?: FallbackStrategy
}

export class PhaseTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`[proteus-lifecycle] 阶段超时（${ms}ms）`)
    this.name = 'PhaseTimeoutError'
  }
}

/** 超时保护：Promise.race（M2 §六） */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new PhaseTimeoutError(ms)), ms)
    }),
  ])
}

export interface PhaseDefinition {
  name: LifecyclePhase
  handler: (ctx: LifecycleContext) => void | Promise<void>
  timeout: number
  fallback: FallbackStrategy
}

export interface OrchestratorOptions {
  onPhaseStart?: (name: string) => void
  onPhaseComplete?: (name: string, duration: number) => void
  onPhaseTimeout?: (name: string) => void
  onError?: (err: Error, phase: string) => void
  /** --trace-lifecycle 输出（对齐 trace 规范） */
  trace?: (msg: string) => void
}

/** ★B2：启动管线执行引擎（单例，全应用共享） */
export class LifecycleOrchestrator {
  private phases = new Map<LifecyclePhase, PhaseDefinition>()
  private traces: LifecycleTrace[] = []
  private status: 'idle' | 'running' | 'completed' | 'degraded' = 'idle'
  private ctx: LifecycleContext

  constructor(ctx: LifecycleContext, private options: OrchestratorOptions = {}) {
    this.ctx = ctx
  }

  register(phase: PhaseDefinition): void {
    if (this.phases.has(phase.name)) throw new Error(`[proteus-lifecycle] 阶段 "${phase.name}" 重复注册`)
    this.phases.set(phase.name, phase)
  }

  getStatus(): 'idle' | 'running' | 'completed' | 'degraded' {
    return this.status
  }

  getTrace(): LifecycleTrace[] {
    return this.traces
  }

  /** ★超时降级应用（warn → console 提示；minimal → 标记；home/skeleton/lazy → trace 记录，UI 行为由调用方处理） */
  private applyFallback(strategy: FallbackStrategy, phase: string): void {
    if (strategy === 'warn') {
      console.warn(`[proteus-lifecycle] ${phase} 阶段降级：${strategy}（能力探测/初始化失败仅告警）`)
    } else if (strategy === 'minimal') {
      this.ctx.isMinimalMode = true
      console.warn(`[proteus-lifecycle] ${phase} 阶段降级：minimal（进入精简模式，不加载非核心模块）`)
    } else {
      this.options.trace?.(`[lifecycle] ${phase} → fallback=${strategy}（${strategy === 'home' ? '强制跳首页' : strategy === 'skeleton' ? '骨架屏' : '延后到空闲'}）`)
    }
  }

  /** 按固定顺序执行全部阶段（错误隔离：单阶段失败不阻塞后续；coreReady 失败 → minimal 标记） */
  async run(): Promise<LifecycleTrace[]> {
    this.status = 'running'
    for (const name of PHASE_ORDER) {
      const phase = this.phases.get(name)
      if (!phase) continue
      this.options.onPhaseStart?.(name)
      const start = Date.now()
      try {
        await withTimeout(Promise.resolve(phase.handler(this.ctx)), phase.timeout)
        const duration = Date.now() - start
        this.traces.push({ phase: name, startTime: start, duration, status: 'success' })
        this.options.onPhaseComplete?.(name, duration)
        this.options.trace?.(`[lifecycle] [${name}] ${duration}ms ✓`)
      } catch (err) {
        const duration = Date.now() - start
        if (err instanceof PhaseTimeoutError) {
          this.options.onPhaseTimeout?.(name)
          this.applyFallback(phase.fallback, name)
          this.traces.push({ phase: name, startTime: start, duration, status: 'timeout', fallback: phase.fallback })
          this.options.trace?.(`[lifecycle] [${name}] ${duration}ms ⚠ fallback=${phase.fallback}（超时）`)
        } else {
          this.options.onError?.(err as Error, name)
          // ★错误隔离：coreReady 失败 → minimal 模式继续（不致命）
          if (name === 'coreReady') this.ctx.isMinimalMode = true
          this.traces.push({ phase: name, startTime: start, duration, status: 'error' })
          this.options.trace?.(`[lifecycle] [${name}] ${duration}ms ✗ ${(err as Error).message}`)
        }
      }
    }
    this.status = this.traces.some((t) => t.status !== 'success') ? 'degraded' : 'completed'
    return this.traces
  }
}

// ==================== ★B1：defineApp API ====================

/** 运行时钩子（非阶段；由平台映射触发） */
export interface AppRuntimeHooks {
  onShow?: (ctx: LifecycleContext) => void
  onHide?: (ctx: LifecycleContext) => void
  onMemoryWarning?: (ctx: LifecycleContext) => void
  onNetworkChange?: (ctx: LifecycleContext, info: { network: string }) => void
  onDestroy?: (ctx: LifecycleContext) => void
  onRecover?: (ctx: LifecycleContext) => void
  onError?: (err: Error, ctx: LifecycleContext) => void
}

/** defineApp 配置：五阶段 + 运行时钩子 + 阶段超时/降级配置 */
export interface AppLifecycleConfig extends AppRuntimeHooks {
  bootstrap?: (ctx: LifecycleContext) => void | Promise<void>
  coreReady?: (ctx: LifecycleContext) => void | Promise<void>
  navigationReady?: (ctx: LifecycleContext) => void | Promise<void>
  beforeFirstPaint?: (ctx: LifecycleContext) => void | Promise<void>
  interactive?: (ctx: LifecycleContext) => void | Promise<void>
  /** 阶段配置（可选覆盖默认超时/降级） */
  phases?: Partial<Record<LifecyclePhase, { timeout?: number; fallback?: FallbackStrategy }>>
}

export interface ProteusApp {
  orchestrator: LifecycleOrchestrator
  /** 启动（业务入口调用；options 覆盖上下文） */
  run(options?: { launchType?: LaunchType; launchOptions?: { path?: string; query?: Record<string, string> } }): Promise<LifecycleTrace[]>
  /** 运行时钩子（平台映射调用） */
  hooks: AppRuntimeHooks
  /** 触发运行时钩子（--trace-lifecycle 可观察） */
  emit(hook: keyof AppRuntimeHooks, extra?: unknown): void
}

const RUNTIME_HOOKS = ['onShow', 'onHide', 'onMemoryWarning', 'onNetworkChange', 'onDestroy', 'onRecover', 'onError'] as const

/** 创建默认上下文（launchType 缺省 cold；platform 缺省探测） */
function createContext(platform?: 'web' | 'skyline' | 'app', launchType: LaunchType = 'cold'): LifecycleContext {
  const wxGlobal = (globalThis as { wx?: unknown }).wx
  const p = platform ?? (typeof wxGlobal !== 'undefined' ? 'skyline' : 'web')
  return { launchType, network: 'wifi', platform: p, isMinimalMode: false }
}

/**
 * ★B1：应用生命周期声明（三端通用，编译期映射各端原生钩子）
 * 用法：export default defineApp({ bootstrap(ctx) {...}, coreReady: async (ctx) => {...}, ... })
 * 校验：未知顶层键 / 未知阶段配置 → 报错（透明化铁律）
 */
export function defineApp(config: AppLifecycleConfig): ProteusApp {
  // ★校验：阶段名/运行时钩子白名单
  const known = new Set<string>([...PHASE_ORDER, ...RUNTIME_HOOKS, 'phases'])
  for (const key of Object.keys(config)) {
    if (!known.has(key)) throw new Error(`[proteus-lifecycle] defineApp 未知配置键 "${key}"（支持 ${[...PHASE_ORDER].join('/')} + ${RUNTIME_HOOKS.join('/')} + phases）`)
  }
  if (config.phases) {
    for (const key of Object.keys(config.phases)) {
      if (!(PHASE_ORDER as readonly string[]).includes(key)) {
        throw new Error(`[proteus-lifecycle] phases 未知阶段 "${key}"（五阶段：${PHASE_ORDER.join('/')}）`)
      }
    }
  }
  // 运行时钩子提取（平台映射调用；非阶段）
  const hooks: AppRuntimeHooks = {}
  for (const h of RUNTIME_HOOKS) {
    const fn = config[h]
    if (typeof fn === 'function') (hooks as Record<string, unknown>)[h] = fn
  }
  const run = (options?: { launchType?: LaunchType; launchOptions?: { path?: string; query?: Record<string, string> } }): Promise<LifecycleTrace[]> => {
    const ctx = createContext(undefined, options?.launchType ?? 'cold')
    if (options?.launchOptions) ctx.launchOptions = options.launchOptions
    const orchestrator = new LifecycleOrchestrator(ctx)
    for (const name of PHASE_ORDER) {
      const handler = config[name]
      if (typeof handler !== 'function') continue
      const cfg = config.phases?.[name] ?? {}
      orchestrator.register({
        name,
        handler,
        timeout: cfg.timeout ?? DEFAULT_PHASE_TIMEOUT[name],
        fallback: cfg.fallback ?? DEFAULT_PHASE_FALLBACK[name],
      })
    }
    return orchestrator.run()
  }
  // 惰性单例：run 首次调用构建 orchestrator；app.orchestrator 提供访问（注册后）
  let orchestrator: LifecycleOrchestrator | undefined
  const api: ProteusApp = {
    get orchestrator() {
      if (!orchestrator) throw new Error('[proteus-lifecycle] 尚未 run()——orchestrator 在启动时创建')
      return orchestrator
    },
    run: (options) => {
      const ctx = createContext(undefined, options?.launchType ?? 'cold')
      if (options?.launchOptions) ctx.launchOptions = options.launchOptions
      orchestrator = new LifecycleOrchestrator(ctx)
      for (const name of PHASE_ORDER) {
        const handler = config[name]
        if (typeof handler !== 'function') continue
        const cfg = config.phases?.[name] ?? {}
        orchestrator.register({
          name,
          handler,
          timeout: cfg.timeout ?? DEFAULT_PHASE_TIMEOUT[name],
          fallback: cfg.fallback ?? DEFAULT_PHASE_FALLBACK[name],
        })
      }
      return orchestrator.run()
    },
    hooks,
    emit(hook, extra) {
      const fn = hooks[hook]
      if (typeof fn !== 'function') return
      const ctx = createContext()
      if (hook === 'onNetworkChange') (fn as (c: LifecycleContext, i: unknown) => void)(ctx, extra)
      else (fn as (c: LifecycleContext) => void)(ctx)
    },
  }
  return api
}
