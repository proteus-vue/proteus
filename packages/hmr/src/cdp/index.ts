// packages/hmr/src/cdp/index.ts —— CDP 桥接（devtools-plus G-34 M2：DevTools 桥接）
// 把 Proteus 事件流（TraceBus TraceEvent + HMR HmrEvent + StyleGateRecord）转译为 CDP 消息，
// 推给标准 DevTools 客户端；处理 CDP 命令子集（Runtime.* + Proteus.* 自定义域）。
// ★注入式零依赖：transport/subscribe/evaluate 全部注入，纯逻辑可单测。
import type { HmrEvent } from '../types'
import type { StyleGateRecord } from '../style-gate'

/** TraceBus 事件形状（结构类型：@proteus-vue/devtools-runtime 的 TraceEvent 天然符合） */
export interface TraceEventLike {
  source: string
  phase: string
  name: string
  payload?: unknown
  timestamp: number
  traceId?: string
}

/** Proteus 开发事件（桥接输入：trace / hmr / style-gate 三类） */
export type ProteusDevEvent =
  | { kind: 'trace'; event: TraceEventLike }
  | { kind: 'hmr'; event: HmrEvent }
  | { kind: 'style-gate'; record: StyleGateRecord }

/** CDP 消息（标准 JSON-RPC 形状：请求/响应 { id } / 事件推送 { method, params } 无 id） */
export interface CdpMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

/** CDP 客户端传输（注入：WS / 内存通道均可） */
export interface CdpTransport {
  send(message: CdpMessage): void
}

export interface CdpBridgeOptions {
  /** 客户端传输 */
  transport: CdpTransport
  /** Runtime.evaluate 执行器（缺省拒绝——未注入时返回 error） */
  evaluate?: (expression: string) => Promise<unknown>
  /** StyleGateRecord 环形缓冲上限（缺省 500；Proteus.getStyleGates 查询用） */
  styleGateBufferSize?: number
  /** 可观测（桥接自身事件：client 命令/推送） */
  onEvent?: (event: { type: 'command' | 'push'; method: string }) => void
}

export interface CdpBridge {
  /** 处理客户端一条命令（响应经 transport.send 回发） */
  handleMessage(message: CdpMessage): void
  /** 推送 Proteus 事件（按客户端 enable 状态转 CDP 消息） */
  push(event: ProteusDevEvent): void
  /** 查询已收集的 StyleGateRecord 缓冲 */
  styleGates(): StyleGateRecord[]
  readonly runtimeEnabled: boolean
  readonly proteusEnabled: boolean
}

export function createCdpBridge(options: CdpBridgeOptions): CdpBridge {
  const { transport, onEvent } = options
  const evaluate = options.evaluate ?? (() => Promise.reject(new Error('Runtime.evaluate 未注入执行器')))
  const bufferSize = options.styleGateBufferSize ?? 500
  let runtimeEnabled = false
  let proteusEnabled = false
  const gateBuffer: StyleGateRecord[] = []

  function reply(id: number | undefined, result: unknown): void {
    if (id === undefined) return
    transport.send({ id, result })
  }

  function replyError(id: number | undefined, code: number, message: string): void {
    if (id === undefined) return
    transport.send({ id, error: { code, message } })
  }

  function handleMessage(message: CdpMessage): void {
    const { id, method } = message
    if (!method) {
      replyError(id, -32600, 'Invalid Request：缺 method')
      return
    }
    onEvent?.({ type: 'command', method })
    switch (method) {
      case 'Runtime.enable':
        runtimeEnabled = true
        reply(id, {})
        return
      case 'Runtime.disable':
        runtimeEnabled = false
        reply(id, {})
        return
      case 'Proteus.enable':
        proteusEnabled = true
        reply(id, {})
        return
      case 'Proteus.disable':
        proteusEnabled = false
        reply(id, {})
        return
      case 'Runtime.evaluate': {
        const expression = String(message.params?.expression ?? '')
        void evaluate(expression)
          .then((value) => reply(id, { result: { type: 'string', value: JSON.stringify(value) } }))
          .catch((err) => replyError(id, -32000, String(err instanceof Error ? err.message : err)))
        return
      }
      case 'Proteus.getStyleGates':
        reply(id, { records: gateBuffer })
        return
      default:
        replyError(id, -32601, `Method not found: ${method}`)
    }
  }

  function push(event: ProteusDevEvent): void {
    if (event.kind === 'style-gate') {
      const record = event.record
      gateBuffer.push(record)
      if (gateBuffer.length > bufferSize) gateBuffer.splice(0, gateBuffer.length - bufferSize)
      if (proteusEnabled) {
        onEvent?.({ type: 'push', method: 'Proteus.styleGate' })
        transport.send({ method: 'Proteus.styleGate', params: { record } })
      }
      return
    }
    // trace / hmr：Runtime.consoleAPICalled（调试台可见）+ Proteus.event（结构化）
    const source = event.kind === 'trace' ? event.event.source : 'hmr'
    const name = event.kind === 'trace' ? event.event.name : event.event.type
    const timestamp = event.kind === 'trace' ? event.event.timestamp : Date.now()
    if (runtimeEnabled) {
      onEvent?.({ type: 'push', method: 'Runtime.consoleAPICalled' })
      transport.send({
        method: 'Runtime.consoleAPICalled',
        params: {
          type: 'info',
          args: [{ type: 'string', value: `[${source}] ${name}` }],
          timestamp,
        },
      })
    }
    if (proteusEnabled) {
      onEvent?.({ type: 'push', method: 'Proteus.event' })
      transport.send({
        method: 'Proteus.event',
        params: {
          source,
          name,
          phase: event.kind === 'trace' ? event.event.phase : undefined,
          payload: event.kind === 'trace' ? event.event.payload : event.event,
          timestamp,
        },
      })
    }
  }

  return {
    handleMessage,
    push,
    styleGates: () => gateBuffer,
    get runtimeEnabled() {
      return runtimeEnabled
    },
    get proteusEnabled() {
      return proteusEnabled
    },
  }
}
