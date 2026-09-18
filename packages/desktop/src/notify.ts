// packages/desktop/src/notify.ts
// ★G-24 B2（proteus-semantic-primitives-plan 04-system-integration §1 p-notify）：通知纯逻辑
//   · notifySupported / getNotifyPermission / requestNotifyPermission：Notification API 探测与授权归一
//   · sendNotification(payload, env)：发送（env.Notification 注入——真实 web Notification 构造 / 测试 mock）
//   映射：iOS UNUserNotificationCenter / Android NotificationManager / 鸿蒙 notificationManager / Web Notification API（04 §1）
//   纯逻辑零 DOM 直调（env 注入——审计 no-platform-api 安全）；缺 Notification → Err（G-32.3 非抛同步异常风格——返回结果对象）
export interface NotifyPayload {
  title: string
  body?: string
  tag?: string
  icon?: string
  requireInteraction?: boolean
}

export interface NotifyResult {
  ok: boolean
  error?: 'notification.unsupported' | 'notification.denied' | 'notification.failed'
}

/** web Notification 形态（注入面——真实实现为全局 Notification） */
export interface NotificationLike {
  permission: string
  requestPermission?(): Promise<string>
}

export interface NotificationCtor {
  new (title: string, options?: { body?: string; tag?: string; icon?: string; requireInteraction?: boolean }): unknown
  permission: string
  requestPermission?(): Promise<string>
}

export interface NotifyEnv {
  /** 缺省用全局 Notification */
  Notification?: NotificationCtor
}

function globalNotification(): NotificationCtor | undefined {
  const g = typeof globalThis !== 'undefined' ? globalThis : ({} as never)
  return (g as { Notification?: NotificationCtor }).Notification
}

/** Notification API 可用性（含权限字段——浏览器不支持 → undefined） */
export function notifySupported(env: NotifyEnv = {}): boolean {
  const N = env.Notification ?? globalNotification()
  return typeof N !== 'undefined' && typeof N === 'function'
}

/** 当前通知权限（granted/denied/default/unsupported——PermissionState 语义兼容） */
export function getNotifyPermission(env: NotifyEnv = {}): 'granted' | 'denied' | 'default' | 'unsupported' {
  const N = env.Notification ?? globalNotification()
  if (!N) return 'unsupported'
  const p = typeof N.permission === 'string' ? N.permission : 'default'
  return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default'
}

/** ★requestNotifyPermission：请求通知授权（Notification.requestPermission 归一） */
export async function requestNotifyPermission(env: NotifyEnv = {}, impl?: () => Promise<string>): Promise<'granted' | 'denied' | 'unsupported'> {
  const N = env.Notification ?? globalNotification()
  const run = impl ?? (() => (N && typeof N.requestPermission === 'function' ? N.requestPermission() : Promise.resolve('denied')))
  try {
    const s = await run()
    return s === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/** ★sendNotification：发送系统通知（new Notification——web 真实呈现） */
export function sendNotification(payload: NotifyPayload, env: NotifyEnv = {}, Ctor?: NotificationCtor): NotifyResult {
  const N = Ctor ?? env.Notification ?? globalNotification()
  if (!N || typeof N !== 'function') return { ok: false, error: 'notification.unsupported' }
  const permission = typeof N.permission === 'string' ? N.permission : 'granted'
  if (permission !== 'granted' && permission !== 'default') return { ok: false, error: 'notification.denied' }
  try {
    const opts: { body?: string; tag?: string; icon?: string; requireInteraction?: boolean } = {}
    if (payload.body != null) opts.body = payload.body
    if (payload.tag != null) opts.tag = payload.tag
    if (payload.icon != null) opts.icon = payload.icon
    if (payload.requireInteraction != null) opts.requireInteraction = payload.requireInteraction
    void new N(payload.title, opts)
    return { ok: true }
  } catch {
    return { ok: false, error: 'notification.failed' }
  }
}
