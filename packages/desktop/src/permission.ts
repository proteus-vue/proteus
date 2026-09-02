// packages/desktop/src/permission.ts
// ★G-24 B2（proteus-semantic-primitives-plan 04-system-integration §2 权限前置）：p-permission 纯逻辑
//   · PERMISSION_CATALOG：语义 → web 权限通道（原则 #10.8——有明确系统原生对应才入表）
//   · buildPermissionManifest(semantics)：Compiler 期权限清单（04 §2「p-permission 编译期校验清单，
//     自动生成各端权限声明」——对接 G-21 的纯函数：iOS Info.plist / Android Manifest / 鸿蒙 module.json5 各端由清单派生）
//   · checkPermission / requestPermission：统一 granted/denied/prompt/unsupported 归一（查询与请求注入式可单测）
//   纯逻辑零 DOM 直调；默认接线走注入（document/navigator 由调用方/指令工厂传 env——审计 no-platform-api 安全）
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

export interface PermissionEntry {
  label: string
  /** Web Permissions API 查询名（query({ name })；无标准查询通道（如 camera）→ 省略 → check 返回 prompt——诚实未知可问） */
  webQueryName?: string
  /** 请求途径说明（各端原生对应见 04 §1 映射表） */
  requestNote: string
}

/** ★语义 → web 权限通道（04 §1 p-permission 行 + 补充：有 web 标准者入表） */
export const PERMISSION_CATALOG: Record<string, PermissionEntry> = {
  notification: { label: '通知', webQueryName: 'notifications', requestNote: 'Notification.requestPermission（web）/ UNUserNotificationCenter / NotificationManager' },
  geolocation: { label: '地理位置', webQueryName: 'geolocation', requestNote: 'navigator.geolocation（web 隐式授权）' },
  camera: { label: '摄像头', requestNote: 'getUserMedia（web 无 query 通道——Chromium 部分支持）/ AVCaptureDevice / CameraManager' },
  microphone: { label: '麦克风', requestNote: 'getUserMedia（web 无 query 通道）/ AVAudioSession / AudioRecord' },
  clipboard: { label: '剪贴板', webQueryName: 'clipboard', requestNote: 'navigator.clipboard（web secure context）/ UIPasteboard / ClipboardManager' },
}

/** 权限查询注入面（默认接线在指令工厂/宿主侧——包内零直调） */
export interface PermissionEnv {
  /** 按 web permission 名查询（navigator.permissions.query 归一）；不支持 → 返回 null */
  query?(name: string): Promise<PermissionState | null>
  /** 按语义执行真实授权请求（通知弹窗/相机流等）；成功 → true */
  request?(semantic: string): Promise<boolean>
}

/** 语义 → 目录条目（未知语义 → undefined——诚实不臆造权限） */
export function permissionEntry(semantic: string): PermissionEntry | undefined {
  return PERMISSION_CATALOG[semantic]
}

/** ★Compiler 期权限清单（04 §2 对接 G-21）：输入模板出现的 p-permission 语义集合 → 清单（去重 + 未知过滤 + 顺序稳定） */
export function buildPermissionManifest(semantics: string[]): Array<{ semantic: string; label: string; webQueryName?: string; requestNote: string }> {
  const seen = new Set<string>()
  const out: Array<{ semantic: string; label: string; webQueryName?: string; requestNote: string }> = []
  for (const s of semantics) {
    if (!s || seen.has(s)) continue
    const entry = PERMISSION_CATALOG[s]
    if (!entry) continue // 未知语义不进清单（04 §原则 10.8：业务权限归插件层）
    seen.add(s)
    out.push({ semantic: s, label: entry.label, webQueryName: entry.webQueryName, requestNote: entry.requestNote })
  }
  return out
}

/** 默认查询归一：navigator.permissions.query（仅目录内声明 webQueryName 者）；缺 API/抛错 → null（调用方降级 prompt） */
export async function defaultPermissionQuery(name: string): Promise<PermissionState | null> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (!nav || typeof nav.permissions?.query !== 'function') return null
  try {
    const st = await nav.permissions.query({ name: name as PermissionName })
    return st.state === 'granted' ? 'granted' : st.state === 'denied' ? 'denied' : 'prompt'
  } catch {
    return null
  }
}

/** ★checkPermission：统一状态查询（目录未知 → unsupported；无 web 查询通道 → prompt——诚实「可能可用，需请求确认」） */
export async function checkPermission(semantic: string, env: PermissionEnv = {}): Promise<PermissionState> {
  const entry = PERMISSION_CATALOG[semantic]
  if (!entry) return 'unsupported'
  const queryName = entry.webQueryName
  if (!queryName) return 'prompt'
  const query = env.query ?? defaultPermissionQuery
  try {
    const s = await query(queryName)
    return s ?? 'prompt'
  } catch {
    return 'prompt'
  }
}

/** ★requestPermission：授权请求（env.request 注入真实实现——通知弹窗/相机流；缺实现 → unsupported 诚实降级） */
export async function requestPermission(semantic: string, env: PermissionEnv = {}): Promise<PermissionState> {
  const entry = PERMISSION_CATALOG[semantic]
  if (!entry) return 'unsupported'
  if (!env.request) return 'unsupported'
  try {
    const granted = await env.request(semantic)
    return granted ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/** 常用 web 默认请求实现（供宿主/指令工厂接线）：notification → Notification.requestPermission；其余无统一通道 → false */
export async function defaultPermissionRequest(semantic: string): Promise<boolean> {
  if (semantic === 'notification') {
    const g = typeof globalThis !== 'undefined' ? globalThis : ({} as never)
    const N = (g as { Notification?: { permission: string; requestPermission?(): Promise<string> } }).Notification
    if (!N || typeof N.requestPermission !== 'function') return false
    try {
      const s = await N.requestPermission()
      return s === 'granted'
    } catch {
      return false
    }
  }
  // camera/microphone/geolocation/clipboard：由宿主具体接线（getUserMedia 流/位置回调）——包内不直调媒体 API
  return false
}
