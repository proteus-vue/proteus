// packages/component-ir/src/capability-domains.ts
// ★★能力分域表（唯一事实源）——能力页侧栏分组 与 NC0《能力实现优先级表》的**共用分组口径**。
//
// 【为什么抽成模块（本仓纪律：同一问题一处实现）】本表原为 `website/scripts/gen-content.mjs`
//   的内部常量（未导出、75 条）。2026-09-30 NC0（原生能力接入方案·能力清单扫描）需要**同一分组**
//   产出优先级表——若各自维护即"第 N 份手写副本"（本仓已实测多次：手写规格/数字必静默漂移）。
//   ⇒ 抽到语义层（component-ir，与 PRIMITIVE_CATALOG 同处），消费者（官网生成器 / NC0 生成器/
//   后续 MCP/Agent 工具）单向引用。
//
// 【2026-09-30 补齐 7 个未映射项（真缺陷修复）】原表 75 条 vs capability 实为 82 ⇒
//   7 个 hook 落入 `?? '其他'` 兜底（update / album / worker / address / wifi / we-run /
//   webassembly）——官网能力页分组因此不完整、NC0 表也无法按域聚合。归类依据（对齐微信官方
//   文档的接口分组惯例，非按字母猜）：
//     · update（UpdateManager 热更新）→ 应用与生命周期（基础能力·更新）
//     · album（相册 saveToPhotosAlbum 系）→ 媒体与扫码（媒体）
//     · worker（多线程运行时）→ 应用与生命周期（基础能力·运行时）
//     · address（chooseAddress 收货地址）→ 账号与支付（开放接口·用户信息）
//     · wifi（WiFi 连接与控制）→ 网络与通信（网络）
//     · we-run（微信运动步数）→ 设备与系统（开放接口·设备数据）
//     · webassembly（WASM 执行）→ 应用与生命周期（基础能力·运行时，与 worker 同族）
//   ★`capabilityDomainOf` 对未登记 key **不静默兜底**：返回 '其他' 但调用方可断言——
//     新能力落地时若忘了登记，`auditCapabilityDomains()`（同文件）会列出，供门禁使用。

export type CapabilityDomain =
  | '网络与通信'
  | '设备与系统'
  | '存储与文件'
  | '位置与地图'
  | '媒体与扫码'
  | '账号与支付'
  | '通知与分享'
  | '应用与生命周期'
  | '可观测与调试'
  | '其他'

/** 能力分域：key = semantic 去掉 `capability.` 前缀（如 `capability.camera` → `camera`） */
export const CAPABILITY_CATEGORY: Record<string, CapabilityDomain> = {

  fetch: '网络与通信', websocket: '网络与通信', 'socket-task': '网络与通信', socket: '网络与通信', 'local-service': '网络与通信', upload: '网络与通信', download: '网络与通信', 'data-channel': '网络与通信', bluetooth: '网络与通信', nfc: '网络与通信',
  device: '设备与系统', screen: '设备与系统', battery: '设备与系统', orientation: '设备与系统', brightness: '设备与系统', sensor: '设备与系统', vibrate: '设备与系统', network: '设备与系统', keyboard: '设备与系统', clipboard: '设备与系统', 'element-query': '设备与系统', intersection: '设备与系统', 'media-query': '设备与系统', 'screen-capture': '设备与系统', 'cache-manager': '设备与系统', ar: '设备与系统', beacon: '设备与系统', 'device-capability': '设备与系统',
  storage: '存储与文件', cookie: '存储与文件', 'file-system': '存储与文件', archive: '存储与文件',
  location: '位置与地图', map: '位置与地图',
  camera: '媒体与扫码', microphone: '媒体与扫码', live: '媒体与扫码', 'qr-code': '媒体与扫码', canvas: '媒体与扫码', video: '媒体与扫码', audio: '媒体与扫码', 'live-pusher': '媒体与扫码', 'image-edit': '媒体与扫码', 'media-processing': '媒体与扫码',
  login: '账号与支付', auth: '账号与支付', biometric: '账号与支付', 'face-id': '账号与支付', permission: '账号与支付', payment: '账号与支付', 'in-app-purchase': '账号与支付', privacy: '账号与支付',
  notification: '通知与分享', share: '通知与分享', shortcut: '通知与分享', sms: '通知与分享', contact: '通知与分享', 'phone-call': '通知与分享', calendar: '通知与分享', ad: '通知与分享', poster: '通知与分享', translation: '通知与分享',
  'app-lifecycle': '应用与生命周期', 'page-lifecycle': '应用与生命周期', background: '应用与生命周期', 'mini-program': '应用与生命周期', embedded: '应用与生命周期', extension: '应用与生命周期', preload: '应用与生命周期', idle: '应用与生命周期', window: '应用与生命周期', 'navigation-guard': '应用与生命周期',
  analytics: '可观测与调试', log: '可观测与调试', performance: '可观测与调试',
  // ★2026-09-30 补齐（原 75 条 vs 82 能力 ⇒ 7 个落「其他」；归类依据见文件头注释）
  update: '应用与生命周期', worker: '应用与生命周期', webassembly: '应用与生命周期',
  album: '媒体与扫码',
  address: '账号与支付',
  wifi: '网络与通信',
  'we-run': '设备与系统',
  // ★2026-09-30 NC1 首个声明式能力（C83——与设备/屏幕同域）
  'keep-screen-on': '设备与系统',
}

/** 分组展示顺序（官网侧栏 / 优先级表共用） */
export const CAPABILITY_CATEGORY_ORDER: readonly CapabilityDomain[] = ['网络与通信', '设备与系统', '存储与文件', '位置与地图', '媒体与扫码', '账号与支付', '通知与分享', '应用与生命周期', '可观测与调试', '其他'] as const

/** 取能力域（输入可为完整 semantic `capability.x` 或裸 slug `x`） */
export function capabilityDomainOf(semanticOrSlug: string): CapabilityDomain {
  const slug = semanticOrSlug.replace(/^capability\./, '')
  return CAPABILITY_CATEGORY[slug] ?? '其他'
}

/**
 * 审计：capacity 清单里未登记分域的条目（返回缺口列表；空数组 = 全登记）。
 * ★设计为**纯函数**（接收 slug 列表，不 import catalog）——避免循环依赖；
 *   生成器/门禁侧传 `PRIMITIVE_CATALOG.filter(kind==='capability')` 的 slug。
 */
export function auditCapabilityDomains(slugs: readonly string[]): string[] {
  return slugs.filter((s) => !(s in CAPABILITY_CATEGORY))
}
