# 02 — M2: LifecycleOrchestrator 编排器

## 一、职责

`LifecycleOrchestrator` 是启动管线的**执行引擎**：
- 按固定顺序执行 5 个阶段
- 管理阶段超时 + 降级
- 处理阶段间依赖（等待异步完成）
- 收集 trace 数据
- 错误隔离（某阶段失败不阻塞后续）

## 二、核心接口

```ts
interface PhaseDefinition {
  name: 'bootstrap' | 'coreReady' | 'navigationReady'
      | 'beforeFirstPaint' | 'interactive'
  handler: (ctx: LifecycleContext) => void | Promise<void>
  timeout: number       // ms
  fallback: FallbackStrategy
}

interface OrchestratorOptions {
  phases: PhaseDefinition[]
  onPhaseStart?: (name: string) => void
  onPhaseComplete?: (name: string, duration: number) => void
  onPhaseTimeout?: (name: string) => void
  onError?: (err: Error, phase: string) => void
}

class LifecycleOrchestrator {
  private phases: Map<string, PhaseDefinition> = new Map()
  private ctx: LifecycleContext

  register(phase: PhaseDefinition): void
  async run(): Promise<void>
  getStatus(): 'idle' | 'running' | 'completed' | 'degraded'
  getTrace(): LifecycleTrace[]
}
```

## 三、执行算法

```
run():
  for phase in [bootstrap, coreReady, navigationReady, beforeFirstPaint, interactive]:
    emit('phaseStart', phase.name)
    start = now()

    try:
      await Promise.race([
        runPhase(phase, ctx),
        timeout(phase.timeout)
      ])
      emit('phaseComplete', phase.name, now() - start)

    catch (TimeoutError):
      emit('phaseTimeout', phase.name)
      applyFallback(phase.fallback)   // ← 关键：降级而非崩溃

    catch (Error):
      onError(err, phase.name)
      // 判断是否致命：coreReady 失败 → minimal 模式继续

  emit('completed', status)
```

**关键点**：超时用 `Promise.race`，降级策略按 phase 配置执行。

## 四、阶段依赖与并行

```
Phase 1 Bootstrap  ──┐
                      ├─ 并行（关键路径）
Phase 2 Core Ready  ──┤
                      │
Phase 3 Navigation  ──┤
                      │
Phase 4 Paint       ──┘
                      │
Phase 5 Interactive    ── 非关键（可延迟到 idle）
```

实现：每个 phase handler 内部可用 `Promise.all` 并行多个子任务，
Orchestrator 保证 phase 间串行。

```ts
async coreReady(ctx) {
  await Promise.all([
    piniaStore.restore(),      // 并行
    api.auth.refreshToken(),   // 并行
    loadCriticalModules(),     // 并行
  ])
}
```

## 五、降级策略详解

| 阶段 | 默认 fallback | 说明 |
|------|--------------|------|
| bootstrap | `warn` | 能力探测失败只告警 |
| coreReady | `minimal` | 不加载非核心模块，进入精简模式 |
| navigationReady | `home` | 强制跳首页，忽略 deep link |
| beforeFirstPaint | `skeleton` | 显示骨架屏，数据异步补齐 |
| interactive | `lazy` | 非关键模块延迟到空闲 |

`minimal` 模式标记：`ctx.isMinimalMode = true`，业务可读此标记跳过非必要逻辑。

## 六、超时保护实现

```ts
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new PhaseTimeoutError(ms)), ms)
    ),
  ])
}
```

默认超时（可配）：
- `bootstrap`: 3000ms
- `coreReady`: 5000ms
- `navigationReady`: 2000ms
- `beforeFirstPaint`: 3000ms
- `interactive`: 5000ms

## 七、Trace 数据

```ts
interface LifecycleTrace {
  phase: string
  startTime: number
  duration: number
  status: 'success' | 'timeout' | 'error' | 'fallback'
  fallback?: string
  children?: { task: string; duration: number }[]
}
```

`--trace-lifecycle` 输出示例：
```
[bootstrap]        120ms ✓
[coreReady]        480ms ✓ (pinia:120ms, auth:210ms, modules:150ms)
[navigationReady]  190ms ✓ (router:90ms, preload:100ms)
[beforeFirstPaint] 310ms ⚠ fallback=skeleton (image preload timeout)
[interactive]      520ms ✓ (lazy modules: 320ms)
Total: 1620ms
```

## 八、与 Pinia/Router/API 的集成

各层在对应阶段注册初始化逻辑：

```ts
// Pinia 层
export function setupPinia(app: ProteusApp) {
  app.lifecycle('coreReady', async (ctx) => {
    const pinia = createPinia()
    app.use(pinia)
    await restoreStores(pinia)
  })
}

// Router 层
export function setupRouter(app: ProteusApp) {
  app.lifecycle('navigationReady', async (ctx) => {
    await router.ready()
    await handleDeepLink(ctx.launchOptions?.path)
  })
}
```

业务 `defineApp` 里写的钩子**与**各层注册的钩子**按注册顺序合并执行**。

## 九、铁律

1. Orchestrator 是单例，全应用共享
2. 阶段顺序不可业务篡改（只允许配置超时/fallback）
3. 业务钩子不得直接操作 Orchestrator（只能通过 `defineApp` 声明）
4. 所有异步必须 `await`，否则视为 bug 并 warn
