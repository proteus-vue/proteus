// website/scripts/lib/demo-page-type-ssot.mjs
// ★★★#1129：**showcase 能力页 → 实现侧类型**的映射（"文档 vs 实现"对齐门禁的 SSOT）。
//
// 【为什么需要】
//   #1128 发现 showcase 的 fetch 页在教用户「config.timeout 两端桥当前均未接线」——
//   而那早已在 #1122 接线。那种缺陷的根源是**演示页的 API 表是手写的**，
//   与实现之间没有任何机器判据（`check:capability-demo` 只比"页面与数据表一致"，
//   数据表自己落后时两边一致、照样绿）。
//
// 【本表声明什么】`slug → 该页 `data` 结构的接口名`。门禁据此校验：
//   · 该接口必须**真实存在**（防改名后文档悬空）；
//   · 页面里的 `<hook>(` 必须出现在 `CapabilityHooks` 里；
//   · 页面声称的 `data.X` 字段必须在该接口（或其 extends 链）里存在。
//
// 【★诚实边界】只覆盖"有明确返回接口"的页。`null` = 该页没有单一返回接口
//   （void / 句柄型 / 联合型），**显式标注不假装覆盖**——门禁对 null 页只查 hook 存在性。
//   ★宁可写 null 也不猜：猜错会让门禁变成"用错误的标准去要求正确的实现"。

export const PAGE_TYPE_SSOT = {
  clipboard: 'string',
  network: 'NetworkType',
  device: 'CapDeviceInfo',
  battery: 'BatteryInfo',
  orientation: 'OrientationInfo',
  screen: 'ScreenInfo',
  location: 'Coords',
  storage: null, // CompatStorage（句柄型，定义在 capability.ts 的 CompatStorage 接口）
  cookie: 'CookieJar',
  fetch: null, // 返回 FetchResult<T> 联合类型；其字段由 tests/demo-page-api-parity 覆盖
  permission: 'PermissionState',
  'media-query': 'MediaQueryResult',
  'element-query': null, // 句柄型
  intersection: 'IntersectionHandle',
  idle: 'IdleAPI',
  performance: 'PerformanceAPI',
  'device-capability': null, // 无单一返回接口
  log: null,
  download: 'DownloadResult',
  'file-system': 'FSAdapter',
  canvas: 'CanvasController',
  'app-lifecycle': 'AppLifecycle',
  'page-lifecycle': 'PageLifecycle',
  'navigation-guard': 'NavigationGuardAPI',
  keyboard: 'KeyboardLifecycle',
  biometric: null,
  background: 'BackgroundAPI',
}
