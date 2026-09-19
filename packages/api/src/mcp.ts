// packages/api/src/mcp.ts
// ★WebMCP 接入（G-32 ⑥ 工程原语 E30 · engineering.mcp）：把**框架能力**暴露为 agent 可调用工具
//
// —— 规范面（2026-09 核实）——
//   WebMCP = 页面把工具注册给浏览器内 agent 的 Web 标准，要点四条（易记错处已标注）：
//   · 命名空间是 `document.modelContext`（★**不是** navigator——规范与 VueUse 实现均为 document）
//   · 注册 `registerTool(descriptor, { signal })`；**规范无 unregisterTool**，注销靠 `signal.abort()`
//   · descriptor 字段：`name` / `description` / `inputSchema` / `execute`
//   · 探测须判**方法可调用**而非「对象存在」（部分实现只暴露空对象——同 VueUse `useSupported` 的做法）
//
// —— 灵感来源与差异化（★不是照抄）——
//   借鉴 VueUse v15 `useWebMCP` 四点：document 命名空间 / signal 注销 / 方法可调用探测 /
//   返回 `{ isSupported, isRegistered, error }` 三元组。
//   本实现的差异化来自**框架自身的能力契约**：本仓能力原语全部返回 `Promise<CapResult<T>>`
//   （G-32.4 铁律：无回调 / 无全局对象 / 全类型 / 失败即 Err）→ 于是可以**自动**把能力派生为 MCP 工具：
//   `ok` → 工具结果、`Err` → `isError` + 错误码。业务只写「工具名 + 描述 + 参数 schema」，
//   响应归一交给框架（这正是 `capabilityToTool` 相对于手写每个工具的增量）。
//
// —— 降级与产物安全 ——
//   ★MP/SSR 诚实降级：小程序无 `document`（WebMCP 是浏览器侧 agent 通道）→ `isSupported=false`、
//   不注册、**不抛错**（同 G-32.3 降级语义：能力不可用如实反映，不静默假装成功）。
//   ★MP 产物安全（决策 #32/#36）：无 `?.` / `??` / 数组解构；顶层不触碰 `document`；
//   不 import vue（作用域销毁经**注入**，同 Engineering 的 reactivity 注入惯例）。
import type { CapResult } from './capability'

/* ---------- 规范最小面（只声明本模块用到的子集） ---------- */

/** `document.modelContext` 最小面 */
export interface McpModelContextLike {
  /** 注册工具；`options.signal` abort 时注销（规范无 unregisterTool） */
  registerTool?: (tool: unknown, options?: { signal?: unknown }) => unknown
  /** 读取已注册工具（部分实现提供） */
  getTools?: () => unknown
}

/** `document` 最小面（注入用：测试 / 非浏览器环境传 mock） */
export interface McpDocumentLike {
  modelContext?: McpModelContextLike
}

/** agent 传入的工具参数（框架侧透传；约束由 inputSchema 声明） */
export type McpToolArgs = Record<string, unknown>

/** MCP 工具响应（规范 content 形状 + isError 可选） */
export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** 工具描述符（规范字段子集） */
export interface McpToolDescriptor {
  name: string
  description: string
  /** JSON-Schema 风格参数声明（type/properties/required）——agent 据此构造调用 */
  inputSchema?: Record<string, unknown>
  execute: (args: McpToolArgs, options?: { signal?: unknown }) => unknown
}

/**
 * ★能力 → 工具规格（框架差异化入口）。
 * `run` 返回框架统一契约 `CapResult<T>`（或 Promise 包装）——响应归一由 `capabilityToTool` 完成。
 */
export interface McpCapabilityToolSpec {
  /** 工具名（缺省取 capability 名；最终名 = prefix + name） */
  name?: string
  description: string
  inputSchema?: Record<string, unknown>
  run: (args: McpToolArgs) => CapResult<unknown> | Promise<CapResult<unknown>>
}

/* ---------- 响应归一（可独立单测） ---------- */

/** 值 → 工具响应：字符串直出；undefined/null → 成功但无载荷的可读标记；其余 JSON 序列化 */
export function toToolResponse(value: unknown): McpToolResponse {
  // ★空载荷（能力多为 `CapResult<void>`，如 useVibrate）不能产出字面量 "undefined"/"null"——
  //   浏览器实测暴露：agent 收到 "undefined" 字符串会当有效数据解析。用明确的成功标记替代。
  if (typeof value === 'undefined' || value === null) return { content: [{ type: 'text', text: 'ok（无返回数据）' }] }
  if (typeof value === 'string') return { content: [{ type: 'text', text: value }] }
  let text: string
  try {
    text = JSON.stringify(value)
    if (text === undefined) text = String(value)
  } catch {
    // 循环引用 / BigInt 等 → 不抛给 agent，降级为字符串描述（工具响应必须可序列化）
    text = String(value)
  }
  return { content: [{ type: 'text', text }] }
}

/** 错误 → 工具响应（`isError: true`——agent 据此重试或换策略，而非当成功解析） */
export function toErrorResponse(err: unknown): McpToolResponse {
  const message = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * ★能力 → MCP 工具：把框架统一契约 `CapResult<T>` 归一为工具响应。
 * 这是相对「手写每个工具」的净增量——能力面 90 个 Hook 的成败语义（`ok`/`Err`）无需逐个复述。
 */
export function capabilityToTool(spec: McpCapabilityToolSpec, prefix = ''): McpToolDescriptor {
  // ★MP 产物安全：不用 `??`（决策 #32/#36）——显式判空替代
  const name = prefix + (spec.name ? spec.name : 'capability')
  return {
    name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: async (args: McpToolArgs) => {
      try {
        const result = await spec.run(args)
        // 契约面：CapResult<T>——ok=false 即业务/平台失败，如实回 isError（含错误码）
        if (result && result.ok === false) {
          const code = result.error && result.error.code ? result.error.code : 'unknown'
          const msg = result.error && result.error.message ? result.error.message : ''
          return { content: [{ type: 'text', text: code + (msg ? ': ' + msg : '') }], isError: true }
        }
        return toToolResponse(result ? result.data : undefined)
      } catch (e) {
        // 能力实现抛错（非契约返回）也要归一，避免异常穿透到 agent 通道
        return toErrorResponse(e)
      }
    },
  }
}

/* ---------- 注册（useMCP） ---------- */

/** useMCP 入参：工具来源（显式/能力派生）+ document 注入 + 生命周期钩子 */
export interface UseMCPOptions {
  /** 显式工具声明 */
  tools?: McpToolDescriptor[]
  /** ★能力派生工具（框架差异化：能力 Hook → 自动归一响应的 MCP 工具） */
  capabilities?: McpCapabilityToolSpec[]
  /** 工具名前缀（避免与页面其他工具撞名，如 `app_`） */
  prefix?: string
  /** document 注入（测试 / 非浏览器环境；缺省取全局 document——顶层不触碰） */
  document?: McpDocumentLike
  /** 是否注册（false → 只探测不注册；缺省 true） */
  enabled?: boolean
  /**
   * 作用域销毁钩子（注入式：Vue 侧传 `onScopeDispose` / `onUnmounted` 即可绑生命周期）。
   * ★不 import vue 是有意为之——本包要进 MP 产物，且仓内 `useGesture` 等 composable 同为零依赖惯例。
   */
  onDispose?: (fn: () => void) => void
}

/** useMCP 返回值：状态经 getter 实时读（异步注册/注销后可见）+ 注册工具名 + ready + dispose */
export interface UseMCPReturn {
  /** 运行环境是否支持 WebMCP（方法可调用判定，非对象存在判定） */
  readonly isSupported: boolean
  /** 是否已注册成功（异步注册完成前为 false）★getter：注册/注销后能读到最新值 */
  readonly isRegistered: boolean
  /** 注册失败原因（如 NotAllowedError）；成功为 null ★getter */
  readonly error: Error | null
  /** 实际注册的工具名（含前缀；未注册时为空数组） */
  readonly toolNames: string[]
  /** 等注册完成（含异步 registerTool）——测试/需要确定性的调用方用 */
  readonly ready: Promise<void>
  /** 主动注销（等价规范里的 signal.abort()；幂等） */
  dispose: () => void
}

/**
 * ★状态用 **getter** 而非值快照（2026-09-19 单测暴露的缺陷）：
 *   注册可能是异步的（registerTool 返回 Promise），且 dispose 随时发生——若返回普通值，
 *   调用方拿到的永远是**创建那一刻**的 false/null，异步结果与注销都读不到
 *   （VueUse 用 ref 表达同一诉求；本包零依赖 vue，改用 getter 达成等效的「实时读取」语义）。
 */

/** 取全局 document（MP/SSR 无 document → undefined；不做顶层访问） */
function globalDocument(): McpDocumentLike | undefined {
  const g = globalThis as { document?: McpDocumentLike }
  if (typeof g.document === 'undefined' || g.document === null) return undefined
  return g.document
}

/**
 * ★useMCP：把工具（显式声明 + 能力派生）注册到 `document.modelContext`。
 *
 * 用法（Vue 组件内）：
 * ```ts
 * const cap = createCapabilityHooks()
 * useMCP({
 *   onDispose: onScopeDispose,          // 或 onUnmounted —— 生命周期交还调用方（零 vue 依赖）
 *   capabilities: [
 *     { name: 'vibrate', description: '震动提示', run: (a) => cap.useVibrate(a.durationMs as number) },
 *     { name: 'clipboard_read', description: '读取剪贴板', run: () => cap.useClipboard() },
 *   ],
 * })
 * ```
 * 不支持的环境（小程序 / SSR / 未实现 WebMCP 的浏览器）→ `isSupported=false`，不注册也不抛错。
 */
export function useMCP(options: UseMCPOptions = {}): UseMCPReturn {
  const prefix = options.prefix ? options.prefix : ''
  const explicit = options.tools ? options.tools : []
  const capabilities = options.capabilities ? options.capabilities : []

  const tools: McpToolDescriptor[] = []
  for (let i = 0; i < explicit.length; i++) tools.push(explicit[i])
  for (let i = 0; i < capabilities.length; i++) tools.push(capabilityToTool(capabilities[i], prefix))

  const doc = options.document ? options.document : globalDocument()
  const mc: McpModelContextLike | undefined = doc ? doc.modelContext : undefined
  // ★探测纪律：判「方法可调用」——只判对象存在时，空对象会被误判为支持
  const isSupported = !!(mc && typeof mc.registerTool === 'function')

  const enabled = options.enabled === false ? false : true
  const toolNames: string[] = []
  let disposed = false
  let isRegistered = false
  let error: Error | null = null

  // 注销句柄：优先 AbortController（规范途径）；环境无 AbortController 时退化为「已注销」标志
  // （无 signal 的实现本就不支持注销，此处不假装支持——如实降级）
  let controller: { abort: () => void; signal: unknown } | null = null
  const hasAbort = typeof (globalThis as { AbortController?: unknown }).AbortController !== 'undefined'
  if (hasAbort) {
    const Ctor = (globalThis as { AbortController: new () => { abort: () => void; signal: unknown } }).AbortController
    const c = new Ctor()
    controller = { abort: c.abort.bind(c), signal: c.signal }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    isRegistered = false
    if (controller) controller.abort()
  }

  // 生命周期交还调用方（不 import vue）
  if (options.onDispose) options.onDispose(dispose)

  let resolveReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  /** 统一返回：状态经 getter 实时读（见 UseMCPReturn 注释——异步注册/注销都要能被读到） */
  function api(): UseMCPReturn {
    return {
      get isSupported() {
        return isSupported
      },
      get isRegistered() {
        return isRegistered
      },
      get error() {
        return error
      },
      get toolNames() {
        return toolNames
      },
      ready,
      dispose,
    }
  }

  if (!isSupported || !enabled || !mc || !mc.registerTool) {
    // 诚实降级：不支持/被禁用 → 不注册、不抛错（调用方看 isSupported 或 toolNames 判定）
    resolveReady()
    return api()
  }

  const register = mc.registerTool
  const regOpts = controller ? { signal: controller.signal } : {}
  const pending: Array<Promise<unknown>> = []
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i]
    toolNames.push(t.name)
    try {
      const r = register.call(mc, t, regOpts)
      // registerTool 可能同步返回也可能返回 Promise；失败（如 NotAllowedError）须落到 error 而非穿透
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        pending.push(
          (r as Promise<unknown>).then(
            () => undefined,
            (e: unknown) => {
              error = e instanceof Error ? e : new Error(String(e))
            },
          ),
        )
      }
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
    }
  }

  if (pending.length) {
    Promise.all(pending).then(() => {
      if (!disposed) isRegistered = error === null
      resolveReady()
    })
  } else {
    isRegistered = error === null
    resolveReady()
  }

  return api()
}
