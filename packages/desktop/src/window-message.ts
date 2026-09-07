// packages/desktop/src/window-message.ts
// ★#449 G-24 B5（proteus-semantic-primitives-plan 续批）：跨窗消息原语——postMessage 收口（来源校验 + type 过滤）
//   语义：同源/指定源 iframe 消息订阅（origin 校验在框架包内完成——页面零裸 window.addEventListener('message')）
//   消费：App 壳 spirit iframe（同源变身消息 → 形态气泡）——cross-window 消息缺口回收
//   分层：纯逻辑 + Web 接线（env 注入可单测；缺省回落真实全局——同 network/lifecycle 族惯例）
export interface WindowMessage {
  /** 消息 type（data.type 字符串；非对象/缺 type → undefined） */
  type?: string
  /** 消息负载（原样） */
  data?: unknown
  /** 发送方来源（字符串 origin；缺失 → null） */
  origin: string | null
}

export interface WindowMessageEnv {
  /** 订阅 message（缺省 window.addEventListener('message')） */
  on?: (fn: (e: { origin?: string | null; data?: unknown }) => void) => void
  /** 取消订阅 */
  off?: (fn: (e: { origin?: string | null; data?: unknown }) => void) => void
  /** 当前页 origin（缺省 location.origin；无 location → null） */
  currentOrigin?: () => string | null
}

export interface WindowMessageOptions {
  /** 只回调这些 type（缺省不按 type 过滤，交给 onMessage 自判） */
  types?: string[]
  /** 期望来源；缺省 = 当前页 origin（同源默认——显式 null 表示接受任意来源） */
  origin?: string | null
  onMessage: (msg: WindowMessage) => void
}

export interface WindowMessageHandle {
  destroy(): void
}

function defaultOn(fn: (e: { origin?: string | null; data?: unknown }) => void): void {
  if (typeof window === 'undefined') return
  window.addEventListener('message', fn as EventListener)
}
function defaultOff(fn: (e: { origin?: string | null; data?: unknown }) => void): void {
  if (typeof window === 'undefined') return
  window.removeEventListener('message', fn as EventListener)
}
function defaultCurrentOrigin(): string | null {
  if (typeof location === 'undefined') return null
  return location.origin
}

/** ★subscribeWindowMessage：跨窗消息订阅（origin 白名单校验 + type 过滤；destroy 清理） */
export function subscribeWindowMessage(opts: WindowMessageOptions, env: WindowMessageEnv = {}): WindowMessageHandle {
  const on = env.on ?? defaultOn
  const off = env.off ?? defaultOff
  const expected = opts.origin !== undefined ? opts.origin : (env.currentOrigin ?? defaultCurrentOrigin)()

  const listener = (e: { origin?: string | null; data?: unknown }): void => {
    const origin = typeof e.origin === 'string' ? e.origin : null
    if (expected !== null && origin !== expected) return // 非白名单来源忽略
    const d = e.data
    const rawType = d && typeof d === 'object' ? (d as { type?: unknown }).type : undefined
    const type = typeof rawType === 'string' ? rawType : undefined
    if (opts.types && !(type !== undefined && opts.types.includes(type))) return
    opts.onMessage({ type, data: d, origin })
  }
  on(listener)
  return {
    destroy: () => off(listener),
  }
}
