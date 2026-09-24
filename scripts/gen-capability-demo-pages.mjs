#!/usr/bin/env node
// scripts/gen-capability-demo-pages.mjs —— ★能力详情页批量生成（showcase）
//
// 背景（2026-09-19）：showcase 能力详情页仅 1/81（camera 样板），而能力是框架的差异化卖点
//   （`CapResult<T>` 契约 + 81 Hook）。范式已在 camera.vue 验证，本脚本把「机械部分」批量化：
//   页面骨架 / API 表 / 兼容进度表由**数据表 + 模板**生成，各能力的演示逻辑按 `demo` 字段定制。
//
// ★诚实边界：只为「Web 端**真有实现**」的能力生成可交互演示页（判据 = packages/api/src/capability.ts
//   的 webBridge 实现清单，已核）；无 Web 实现的能力不生成——避免产出「点了没反应」的假演示。
//   实现面内部还要再过一层「演示能否真跑通成功路径」：桥已声明但未接线的字段（如 fetch 的
//   config.timeout）照实标在 API 表里，不写成已支持。
//
// 批次：2026-09-19 首批 9 页（感受器/设备类）；2026-09-24 第二批 10 页（存储/通信/权限/实例/调度类）。
//
// 用法：node scripts/gen-capability-demo-pages.mjs [--check]
//   --check：只校验已生成的页与数据表一致（漂移 exit 1），供 CI 使用。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'showcase', 'subpackages', 'capabilities', 'pages')
const check = process.argv.includes('--check')

/**
 * 能力详情页数据表（只收 Web 端真有实现的——判据见文件头「诚实边界」）。
 * `demo` 字段是各页唯一的定制部分（模板只做骨架）。
 */
const PAGES = [
  {
    file: 'clipboard',
    title: 'useClipboard 剪贴板',
    subtitle: '能力原语 · capability.clipboard · 双端同源码',
    code: 'const read = await useClipboard()\nconst write = await setClipboard("hello")\nif (read.ok) { /* read.data: string */ }',
    demo: `const out = ref('点击按钮读/写剪贴板（浏览器需用户手势 + 权限）')
async function onRead(): Promise<void> {
  const res = await cap.useClipboard()
  out.value = res.ok ? \`✅ 读到：\${res.data || '（空）'}\` : \`⚠ 降级：\${res.error.code}\`
}
async function onWrite(): Promise<void> {
  const res = await cap.setClipboard('Proteus showcase · ' + Date.now())
  out.value = res.ok ? '✅ 已写入剪贴板（可点「读取」验证往返）' : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取剪贴板', 'onRead'], ['写入剪贴板', 'onWrite']]`,
    api: [
      ['useClipboard()', '读取剪贴板文本；返回 Promise<CapResult<string>>', 'CapResult<string>'],
      ['setClipboard(text)', '写入剪贴板文本；返回 Promise<CapResult<void>>', 'CapResult<void>'],
      ['data', '读到的文本（useClipboard 成功时）', 'string'],
      ['error.code', '机器码：clipboard.unsupported（无 Clipboard API）等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.clipboard（需安全上下文 + 用户手势）', '✅'],
      ['微信小程序', 'wx.getClipboardData / wx.setClipboardData', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'network',
    title: 'useNetwork 网络',
    subtitle: '能力原语 · capability.network · 双端同源码',
    code: 'const res = await useNetwork()\nif (res.ok) { /* res.data: NetworkType { online, kind } */ }',
    demo: `const out = ref('点击按钮探测当前网络状态')
async function onNetwork(): Promise<void> {
  const res = await cap.useNetwork()
  out.value = res.ok
    ? \`✅ 在线：\${res.data.online} · 类型：\${res.data.kind ?? '未知'}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['探测网络', 'onNetwork']]`,
    api: [
      ['useNetwork()', '当前网络状态；返回 Promise<CapResult<NetworkType>>', 'CapResult<NetworkType>'],
      ['data.online', '是否在线', 'boolean'],
      ['data.kind', "连接类型：'wifi' | '4g' | '5g' | 'ethernet' | …（不可判定时 undefined）", 'string?'],
      ['error.code', '机器码：network.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.onLine + NetworkInformation.effectiveType', '✅'],
      ['微信小程序', 'wx.getNetworkType + onNetworkStatusChange', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'device',
    title: 'useDevice 设备信息',
    subtitle: '能力原语 · capability.device · 双端同源码',
    code: 'const res = await useDevice()\nif (res.ok) { /* res.data: CapDeviceInfo */ }',
    demo: `const out = ref('点击按钮读取设备信息')
async function onDevice(): Promise<void> {
  const res = await cap.useDevice()
  // ★过滤空段（浏览器不暴露型号 → 原写法会产出 "web · Web · " 这类尾巴）
  const parts = res.ok ? [res.data.platform, res.data.model, res.data.system].filter(Boolean) : []
  out.value = res.ok ? \`✅ \${parts.join(' · ') || '（平台未提供详细信息）'}\` : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取设备信息', 'onDevice']]`,
    api: [
      ['useDevice()', '设备/系统信息；返回 Promise<CapResult<CapDeviceInfo>>', 'CapResult<CapDeviceInfo>'],
      ['data.platform', '平台标识（web / devtools / ios / android…）', 'string?'],
      ['data.model', '设备型号（浏览器多为空）', 'string?'],
      ['data.system', '系统版本', 'string?'],
      ['error.code', '机器码：device.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.userAgent 解析（型号多为空——浏览器不暴露）', '✅'],
      ['微信小程序', 'wx.getSystemInfo（型号/系统齐备）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'battery',
    title: 'useBattery 电量',
    subtitle: '能力原语 · capability.battery · 双端同源码',
    code: 'const res = await useBattery()\nif (res.ok) { /* res.data: BatteryInfo { level, charging } */ }',
    demo: `const out = ref('点击按钮读取电量（桌面浏览器常无 Battery API → 诚实降级）')
async function onBattery(): Promise<void> {
  const res = await cap.useBattery()
  out.value = res.ok
    ? \`✅ 电量 \${Math.round((res.data.level ?? 0) * 100)}% · 充电中：\${res.data.charging}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取电量', 'onBattery']]`,
    api: [
      ['useBattery()', '电量/充电状态；返回 Promise<CapResult<BatteryInfo>>', 'CapResult<BatteryInfo>'],
      ['data.level', '电量 0-1', 'number'],
      ['data.charging', '是否充电中', 'boolean'],
      ['error.code', '机器码：battery.unsupported（浏览器无 getBattery）等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.getBattery（部分浏览器未实现 → Err）', '✅'],
      ['微信小程序', 'wx.getBatteryInfo', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'orientation',
    title: 'useOrientation 屏幕方向',
    subtitle: '能力原语 · capability.orientation · 双端同源码',
    code: 'const res = await useOrientation()\nif (res.ok) { /* res.data: OrientationInfo { angle, type } */ }',
    demo: `const out = ref('点击按钮读取屏幕方向')
async function onOrientation(): Promise<void> {
  const res = await cap.useOrientation()
  out.value = res.ok
    ? \`✅ 角度 \${res.data.angle}° · 方向：\${res.data.type ?? '未知'}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取方向', 'onOrientation']]`,
    api: [
      ['useOrientation()', '屏幕方向；返回 Promise<CapResult<OrientationInfo>>', 'CapResult<OrientationInfo>'],
      ['data.angle', '旋转角度（0/90/180/270）', 'number'],
      ['data.type', "方向类型：'portrait' | 'landscape' 等", 'string?'],
      ['error.code', '机器码：orientation.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'screen.orientation', '✅'],
      ['微信小程序', 'wx.getDeviceInfo + onDeviceOrientationChange', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'screen',
    title: 'useScreen 屏幕信息',
    subtitle: '能力原语 · capability.screen · 双端同源码',
    code: 'const res = await useScreen()\nif (res.ok) { /* res.data: ScreenInfo */ }',
    demo: `const out = ref('点击按钮读取屏幕信息')
async function onScreen(): Promise<void> {
  const res = await cap.useScreen()
  out.value = res.ok
    ? \`✅ \${res.data.width}×\${res.data.height} · DPR \${res.data.pixelRatio != null ? res.data.pixelRatio : '不可用'}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['读取屏幕', 'onScreen']]`,
    api: [
      ['useScreen()', '屏幕尺寸/像素比；返回 Promise<CapResult<ScreenInfo>>', 'CapResult<ScreenInfo>'],
      ['data.width / height', '逻辑像素尺寸', 'number'],
      ['data.pixelRatio', '设备像素比（DPR）', 'number?'],
      ['error.code', '机器码：screen.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'screen.width/height + devicePixelRatio', '✅'],
      ['微信小程序', 'wx.getWindowInfo', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'location',
    title: 'useLocation 定位',
    subtitle: '能力原语 · capability.location · 双端同源码',
    code: 'const res = await useLocation()\nif (res.ok) { /* res.data: Coords */ }\nelse { /* res.error.code === "location.denied" */ }',
    demo: `const out = ref('点击按钮请求定位（浏览器会弹权限申请；拒绝 → 诚实 Err 降级）')
async function onLocation(): Promise<void> {
  const res = await cap.useLocation()
  out.value = res.ok
    ? \`✅ 纬度 \${res.data.latitude?.toFixed(4)} · 经度 \${res.data.longitude?.toFixed(4)}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['请求定位', 'onLocation']]`,
    api: [
      ['useLocation()', '当前位置；返回 Promise<CapResult<Coords>>', 'CapResult<Coords>'],
      ['data.latitude / longitude', '经纬度', 'number'],
      ['data.accuracy', '定位精度（米）', 'number?'],
      ['error.code', '机器码：location.denied（用户拒绝）/ location.unsupported 等', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.geolocation（需用户授权）', '✅'],
      ['微信小程序', 'wx.getLocation（需后台声明 + 用户授权）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  // ───────────────────────── 第二批（2026-09-24）：通信 / 存储 / 权限 / 实例 / 调度 ─────────────────────────
  {
    file: 'storage',
    title: 'useStorage 本地存储',
    subtitle: '能力原语 · capability.storage · 双端同源码',
    code: 'const st = useStorage()\nst.set("k", { msg: "hi" })        // 同步语义\nconst back = st.get("k")\nconst info = await st.info()      // 异步 / 批量 API 同样齐备',
    demo: `const out = ref('点击按钮做一次「写入 → 读回」往返（Web 落 localStorage，小程序落 wx storage）')
function onRoundtrip(): void {
  try {
    const st = cap.useStorage()
    st.set('demo:greet', { msg: 'hello', at: Date.now() })
    const back = st.get<{ msg: string }>('demo:greet')
    out.value = back ? \`✅ 往返成功：\${JSON.stringify(back)}\` : '⚠ 写入后读不到（存储不可用？）'
  } catch (e) {
    out.value = \`⚠ 降级：\${e instanceof Error ? e.message : String(e)}\`
  }
}
async function onInfo(): Promise<void> {
  const res = await cap.useStorage().info()
  out.value = res.ok
    ? \`✅ 已存 \${res.data.keys.length} 键 · 上限 \${(res.data.limitSize / 1024 / 1024).toFixed(0)}MB\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['写入并读回', 'onRoundtrip'], ['存储用量', 'onInfo']]`,
    api: [
      ['useStorage()', '存储句柄（★同步语义，非 CapResult——未命中返回 undefined）', 'CompatStorage'],
      ['get(key) / set(key, value)', '同步读 / 写（值自动 JSON 序列化）', 'T | undefined / void'],
      ['remove(key) / clear()', '同步删除 / 清空', 'void'],
      ['getAsync / setAsync', '异步读写（对齐官方 setStorage/getStorage；大值不阻塞主线程）', 'Promise<CapResult<…>>'],
      ['info()', '用量信息 keys / currentSize / limitSize', 'Promise<CapResult<…>>'],
      ['batchGet(keys) / batchSet(list)', '批量读 / 批量写', 'Promise<CapResult<…>>'],
    ],
    compat: [
      ['Web SPA', 'localStorage（无 localStorage 的宿主 → 内存降级）；异步 API 由同步语义包装为 CapResult', '✅'],
      ['微信小程序', 'wx.setStorageSync/getStorageSync（含异步 wx.getStorage 系列 + wx.getStorageInfo）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'cookie',
    title: 'useCookie Cookie 罐',
    subtitle: '能力原语 · capability.cookie · 双端同源码',
    code: 'const res = await useCookie()\nif (res.ok) {\n  res.data.set("k", "v", 300)   // maxAge 秒\n  res.data.get("k")             // "v"\n}',
    demo: `const out = ref('点击按钮写入一枚 cookie 再读回（Web 走 document.cookie）')
async function onCookie(): Promise<void> {
  const res = await cap.useCookie()
  if (!res.ok) {
    out.value = \`⚠ 降级：\${res.error.code}\`
    return
  }
  const jar = res.data
  jar.set('proteus_demo', 'ok-' + Date.now(), 300)
  const back = jar.get('proteus_demo')
  out.value = \`✅ 读回 proteus_demo = \${back ?? '（无）'} · 罐内共 \${Object.keys(jar.list()).length} 项\`
}`,
    buttons: `[['写入并读回 cookie', 'onCookie']]`,
    api: [
      ['useCookie()', 'Cookie 罐句柄；返回 Promise<CapResult<CookieJar>>', 'CapResult<CookieJar>'],
      ['get(name) / set(name, value, maxAge?)', '读 / 写（maxAge 秒；缺省会话级）', 'string | undefined / void'],
      ['remove(name) / list()', '删除 / 列出全部', 'void / Record<string, string>'],
      ['error.code', '机器码：cookie.unsupported（桥未提供 getCookieJar）等', 'string'],
    ],
    compat: [
      ['Web SPA', 'document.cookie（值 encodeURIComponent；写入自动带 path=/）', '✅'],
      ['微信小程序', '小程序无 document.cookie → wx storage 兜底（键 __proteus_cookies）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'fetch',
    title: 'useFetch 网络请求',
    subtitle: '能力原语 · capability.fetch · 双端同源码',
    code: 'const res = await useFetch<{ name: string }>("/assets/demo-fetch.json")\nif (res.ok) { /* res.data: { name } —— 已解析 */ }\nelse { /* res.error.code === "fetch.failed" */ }',
    demo: `const out = ref('点击按钮发起同源请求（演示站自带 /assets/demo-fetch.json）')
async function onFetch(): Promise<void> {
  const res = await cap.useFetch<{ name: string; capability: string }>('/assets/demo-fetch.json', {
    params: { t: Date.now() },
  })
  out.value = res.ok
    ? \`✅ 收到 JSON：name=\${res.data.name} · capability=\${res.data.capability}\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['发起请求', 'onFetch']]`,
    api: [
      ['useFetch<T>(url, config?)', '网络请求；返回 Promise<CapResult<T>>（data = 已解析载荷）', 'CapResult<T>'],
      ['config.method / data', "HTTP 方法（缺省 GET）/ 请求体（对象自动 JSON 序列化）", "'GET' | 'POST' | … / unknown"],
      ['config.params / headers', '查询参数（自动拼接）/ 自定义请求头', 'Record<string, unknown> / Record<string, string>'],
      ['data', '响应载荷：JSON 自动解析，非 JSON 原样文本', 'T'],
      ['error.code', '机器码：fetch.failed（HTTP 非 2xx / 请求失败）/ fetch.unsupported', 'string'],
      ['config.timeout', '★诚实边界：契约已声明，两端桥当前均未接线（超时不会主动中止请求）', 'number?'],
    ],
    compat: [
      ['Web SPA', 'fetch + JSON.parse（非 2xx → Err fetch.failed）', '✅'],
      ['微信小程序', 'wx.request（success → StatusCode 判非 2xx → Err）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'permission',
    title: 'usePermission 权限查询',
    subtitle: '能力原语 · capability.permission · 双端同源码',
    code: 'const res = await usePermission("geolocation")\nif (res.ok) { /* res.data.state: "granted" | "denied" | "prompt" */ }',
    demo: `const out = ref('点击按钮查询 geolocation 权限状态（只查询，不触发弹窗）')
async function onPermission(): Promise<void> {
  const res = await cap.usePermission('geolocation')
  out.value = res.ok
    ? \`✅ geolocation：\${res.data.state}（granted / denied / prompt）\`
    : \`⚠ 降级：\${res.error.code}\`
}`,
    buttons: `[['查询 geolocation 权限', 'onPermission']]`,
    api: [
      ['usePermission(name)', '查询权限状态；返回 Promise<CapResult<PermissionState>>', 'CapResult<PermissionState>'],
      ['data.permission', '回显权限名（与入参一致）', 'string'],
      ['data.state', "授权状态：'granted' | 'denied' | 'prompt'（未询问）", 'string'],
      ['error.code', '机器码：permission.unsupported（无 Permissions API / 该权限名不被支持）', 'string'],
    ],
    compat: [
      ['Web SPA', 'navigator.permissions.query（只读查询；不受支持的权限名 → Err 而非假 granted）', '✅'],
      ['微信小程序', 'wx.getSetting（读 scope 授权位；映射为 granted / denied / prompt）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'media-query',
    title: 'useMediaQuery 媒体查询',
    subtitle: '能力原语 · capability.media-query · 双端同源码',
    code: 'const h = useMediaQuery()\nif (h.ok) {\n  h.data.observe({ maxWidth: 500 }, (r) => {\n    /* r.matches: 当前是否命中 */\n  })\n  h.data.disconnect()   // 释放\n}',
    demo: `const out = ref('点击按钮开始观察「视口 ≤ 500px」（回调会先以初始状态回调一次）')
let mqHandle: { disconnect(): void } | null = null
function onObserve(): void {
  const h = cap.useMediaQuery()
  if (!h.ok) {
    out.value = \`⚠ 降级：\${h.error.code}\`
    return
  }
  h.data.observe({ maxWidth: 500 }, (r) => {
    out.value = r.matches ? '✅ 窄屏分支命中（视口 ≤ 500px）' : '✅ 宽屏分支命中（视口 > 500px）'
  })
  mqHandle = h.data
}
function onStop(): void {
  if (!mqHandle) {
    out.value = '（尚未开始观察——请先点左侧按钮）'
    return
  }
  mqHandle.disconnect()
  mqHandle = null
  out.value = '✅ 已停止观察（disconnect 释放监听）'
}`,
    buttons: `[['观察 maxWidth:500', 'onObserve'], ['停止观察', 'onStop']]`,
    api: [
      ['useMediaQuery()', '媒体查询句柄（★同步返回 CapResult，非 Promise）', 'CapResult<MediaQueryObserver>'],
      ['observe(condition, cb)', '开始观察；condition 支持 minWidth/maxWidth/width/minHeight/maxHeight/height/orientation（px）', 'void'],
      ['disconnect()', '停止观察并释放监听', 'void'],
      ['error.code', '机器码：element.unsupported（桥未提供 createMediaQuery）等', 'string'],
    ],
    compat: [
      ['Web SPA', 'matchMedia（回调首次即回传初始命中态；窗口尺寸变化自动推送）', '✅'],
      ['微信小程序', 'wx.createMediaQueryObserver', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'element-query',
    title: 'useElement 元素查询',
    subtitle: '能力原语 · capability.element-query · 双端同源码',
    code: 'const h = useElement("#demo-btns")\nif (h.ok) {\n  const rect = await h.data.boundingClientRect()\n  /* rect.data: { left, top, width, height, … } */\n}',
    demo: `const out = ref('点击按钮测量演示区按钮容器 #demo-btns 的真实几何')
async function onGeometry(): Promise<void> {
  const h = cap.useElement('#demo-btns')
  if (!h.ok) {
    out.value = \`⚠ 降级：\${h.error.code}\`
    return
  }
  const rect = await h.data.boundingClientRect()
  out.value = rect.ok
    ? \`✅ 几何：\${Math.round(rect.data.width)}×\${Math.round(rect.data.height)} @ (\${Math.round(rect.data.left)}, \${Math.round(rect.data.top)})\`
    : \`⚠ 降级：\${rect.error.code}\`
}
async function onScroll(): Promise<void> {
  const h = cap.useElement('#demo-btns')
  if (!h.ok) {
    out.value = \`⚠ 降级：\${h.error.code}\`
    return
  }
  const off = await h.data.scrollOffset()
  out.value = off.ok
    ? \`✅ 滚动位置：top \${off.data.scrollTop} · left \${off.data.scrollLeft}\`
    : \`⚠ 降级：\${off.error.code}\`
}`,
    buttons: `[['测量几何', 'onGeometry'], ['读滚动位置', 'onScroll']]`,
    api: [
      ['useElement(id?)', '元素查询句柄（★同步返回 CapResult）', 'CapResult<ElementQuery>'],
      ['boundingClientRect(selector?)', '几何：left/top/right/bottom/width/height', 'Promise<CapResult<ElementRect>>'],
      ['scrollOffset(selector?)', '滚动位置：scrollTop / scrollLeft', 'Promise<CapResult<…>>'],
      ['size(selector?) / batch(selectors)', '尺寸（width/height）/ 批量查询', 'Promise<CapResult<…>>'],
      ['fields(options, selector?)', '按需取 node / rect / size / scrollOffset / computedStyle', 'Promise<CapResult<…>>'],
      ['error.code', '机器码：element.not-found（选择器未命中）/ element.unsupported', 'string'],
    ],
    compat: [
      ['Web SPA', 'querySelector + getBoundingClientRect（id 或类选择器均可）', '✅'],
      ['微信小程序', 'wx.createSelectorQuery（★须用 id 选择器——类选择器不达页面级原生节点）+ 组件探针回落', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'intersection',
    title: 'useIntersection 交叉观察',
    subtitle: '能力原语 · capability.intersection · 双端同源码',
    code: 'const h = useIntersection({ thresholds: [0] })\nif (h.ok) {\n  h.data.relativeToViewport().observe("#target", (r) => {\n    /* r.intersectionRatio: 0–1 */\n  })\n}',
    demo: `const out = ref('点击按钮观察 #demo-btns 与视口的相交状态')
let ih: { disconnect(): void } | null = null
function onObserve(): void {
  const h = cap.useIntersection({ thresholds: [0] })
  if (!h.ok) {
    out.value = \`⚠ 降级：\${h.error.code}\`
    return
  }
  out.value = '⏳ 已开始观察 #demo-btns（相对视口）…'
  h.data.relativeToViewport().observe('#demo-btns', (r) => {
    out.value = \`✅ 相交比例 \${(r.intersectionRatio * 100).toFixed(0)}% · 目标高 \${Math.round(r.boundingClientRect.height)}px\`
  })
  ih = h.data
}
function onStop(): void {
  if (!ih) {
    out.value = '（尚未开始观察——请先点左侧按钮）'
    return
  }
  ih.disconnect()
  ih = null
  out.value = '✅ 已停止观察（disconnect 释放观察器）'
}`,
    buttons: `[['观察 #demo-btns', 'onObserve'], ['停止观察', 'onStop']]`,
    api: [
      ['useIntersection(options?)', '交叉观察句柄（★同步返回 CapResult）；options.thresholds / initialRatio / observeAll', 'CapResult<IntersectionHandle>'],
      ['relativeToViewport(margins?)', '以视口为参照（margins 可扩展/收缩边界）', 'IntersectionHandle'],
      ['relativeTo(selector, margins?)', '以指定元素为参照', 'IntersectionHandle'],
      ['observe(targetSelector, cb)', '开始观察目标元素；结果含 intersectionRatio / boundingClientRect / relativeRect / time', 'void'],
      ['disconnect()', '停止观察（释放）', 'void'],
    ],
    compat: [
      ['Web SPA', 'IntersectionObserver（★relativeTo 受限：浏览器要求 root 在构造期确定 → 当前以视口为参照）', '✅'],
      ['微信小程序', 'wx.createIntersectionObserver（relativeTo 原生支持）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'idle',
    title: 'useIdle 空闲调度',
    subtitle: '能力原语 · capability.idle · 双端同源码',
    code: 'const h = useIdle()\nif (h.ok) {\n  await h.data.request((deadline) => {\n    /* deadline.timeRemaining() / didTimeout */\n  }, 500)\n}',
    demo: `const out = ref('点击按钮提交一个空闲任务（宿主空闲时执行，超时 500ms 兜底）')
function onIdle(): void {
  const h = cap.useIdle()
  if (!h.ok) {
    out.value = \`⚠ 降级：\${h.error.code}\`
    return
  }
  out.value = '⏳ 已提交空闲任务，等待宿主空闲…'
  void h.data.request((d) => {
    out.value = \`✅ 空闲回调执行：剩余 \${d.timeRemaining().toFixed(1)}ms · 超时触发：\${d.didTimeout}\`
  }, 500)
}`,
    buttons: `[['提交空闲任务', 'onIdle']]`,
    api: [
      ['useIdle()', '空闲调度句柄（★同步返回 CapResult）', 'CapResult<IdleAPI>'],
      ['request(cb, timeout?)', '空闲时执行；timeout 到时即执行（ms）', 'Promise<CapResult<number>>'],
      ['cancel(id)', '取消待执行的空闲回调', 'Promise<CapResult<void>>'],
      ['deadline.timeRemaining()', '本次空闲剩余时间（ms）', 'number'],
      ['deadline.didTimeout', '是否因超时触发（非真空闲）', 'boolean'],
    ],
    compat: [
      ['Web SPA', 'requestIdleCallback（Safari 缺省 → setTimeout 兜底：timeRemaining 恒 0）', '✅'],
      ['微信小程序', 'wx.requestIdleCallback', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'performance',
    title: 'usePerformance 性能条目',
    subtitle: '能力原语 · capability.performance · 双端同源码',
    code: 'const h = usePerformance()\nif (h.ok) {\n  const list = await h.data.getEntries("resource")\n  /* list.data: PerformanceEntry[] */\n}',
    demo: `const out = ref('点击按钮读取本页资源加载条目（真实 performance 数据）')
async function onEntries(): Promise<void> {
  const h = cap.usePerformance()
  if (!h.ok) {
    out.value = \`⚠ 降级：\${h.error.code}\`
    return
  }
  const entries = await h.data.getEntries('resource')
  out.value = entries.ok
    ? \`✅ 资源条目 \${entries.data.length} 条 · 累计 \${entries.data.reduce((n, e) => n + (e.duration || 0), 0).toFixed(1)}ms\`
    : \`⚠ 降级：\${entries.error.code}\`
}`,
    buttons: `[['读取资源条目', 'onEntries']]`,
    api: [
      ['usePerformance()', '性能句柄（★同步返回 CapResult）', 'CapResult<PerformanceAPI>'],
      ['getEntries(entryType?)', '按类型读条目：navigation / render / script（缺省全部）', 'Promise<CapResult<PerformanceEntry[]>>'],
      ['getEntriesByName(name, entryType?)', '按名字读条目', 'Promise<CapResult<PerformanceEntry[]>>'],
      ['createObserver() / setBufferSize(n)', '实时观察新条目 / 缓冲区大小', 'PerformanceObserverHandle / void'],
      ['report(id, value)', '自定义指标上报（★仅小程序有后端——Web 端恒 Err）', 'Promise<CapResult<void>>'],
    ],
    compat: [
      ['Web SPA', 'performance.getEntriesByType（★微信语义 navigation/render/script → Web 侧映射为 resource）', '✅'],
      ['微信小程序', 'wx.getPerformance（含 report → 微信性能监控平台）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
  {
    file: 'device-capability',
    title: 'useDeviceCapability 设备能力探测',
    subtitle: '能力原语 · capability.device-capability · 双端同源码',
    code: 'const h = useDeviceCapability()\nif (h.ok) {\n  const hevc = await h.data.supportsHevc()\n  /* hevc.data: boolean */\n}',
    demo: `const out = ref('点击按钮探测本机是否支持 HEVC（H.265）硬解码')
async function onHevc(): Promise<void> {
  const h = cap.useDeviceCapability()
  if (!h.ok) {
    out.value = \`⚠ 降级：\${h.error.code}\`
    return
  }
  const r = await h.data.supportsHevc()
  out.value = r.ok
    ? \`✅ HEVC(H.265) 硬解支持：\${r.data}\`
    : \`⚠ 降级：\${r.error.code}\`
}`,
    buttons: `[['探测 HEVC 支持', 'onHevc']]`,
    api: [
      ['useDeviceCapability()', '设备能力探测句柄（★同步返回 CapResult）', 'CapResult<DeviceCapabilityAPI>'],
      ['supportsHevc()', '是否支持 HEVC（H.265）硬解码', 'Promise<CapResult<boolean>>'],
      ['error.code', '机器码：device-capability.unsupported（无探测通道）等', 'string'],
    ],
    compat: [
      ['Web SPA', 'MediaSource.isTypeSupported（判 codecs hvc1 / hev1；无 MSE → Err）', '✅'],
      ['微信小程序', 'wx.checkDeviceSupportHevc（真机硬解能力）', '✅'],
      ['Headless（SSR/测试）', 'mock 桥注入', '✅'],
    ],
  },
]

/** 渲染单页（骨架固定，差异来自数据表） */
function renderPage(p) {
  const apiRows = p.api.map((r) => `  [${JSON.stringify(r[0])}, ${JSON.stringify(r[1])}, ${JSON.stringify(r[2])}],`).join('\n')
  const compatRows = [...p.compat, ['iOS / Android / 鸿蒙 / Flutter', '端原型映射·能力桥未接线（Err 显式降级）', '🟡']]
    .map((r) => `  [${JSON.stringify(r[0])}, ${JSON.stringify(r[1])}, ${JSON.stringify(r[2])}],`)
    .join('\n')
  const buttons = eval(p.buttons)
  const btnTpl = buttons
    .map(([label, handler]) => `          <p-button size="small" @click="${handler}">${label}</p-button>`)
    .join('\n')
  return `<!-- showcase/subpackages/capabilities/pages/${p.file}.vue —— 能力详情页（${p.title.split(' ')[0]}，官方形态）
     ★由 scripts/gen-capability-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     范式同 camera.vue：能力说明 + 真交互演示 + API 表 + 双端兼容进度。
     ★真交互：按钮真调用能力 Hook，输出区回显 Result<T>（成功/失败 + 错误码）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PView, PButton } from '@proteus-vue/components'
import { createCapabilityHooks } from '@proteus-vue/api'

// ★每页独立实例（demo 页惯例——不共享全局单例，页面间互不影响）
const cap = createCapabilityHooks()

// ★代码片段放 data（含 < > "。直写 :code 字面量会破坏 WXML 解析）
const codeDemo = ref(${JSON.stringify(p.code)})

${p.demo}

const apiRows = ref([
${apiRows}
])
const compatRows = ref([
${compatRows}
])
</script>

<template>
  <page-shell title="${p.title}" subtitle="${p.subtitle}">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
${btnTpl}
        </p-view>
      </template>
      <template #output>
        <p-text class="out">{{ out }}</p-text>
      </template>
    </demo-block>

    <api-table title="API" :columns="['签名 / 字段', '说明', '类型']" :rows="apiRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.btns {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
  word-break: break-all;
}
</style>
`
}

let drifted = false
for (const p of PAGES) {
  const out = path.join(OUT_DIR, `${p.file}.vue`)
  const md = renderPage(p)
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf-8') !== md) {
      console.error(`DRIFT: showcase/subpackages/capabilities/pages/${p.file}.vue 与数据表不一致——重跑本脚本`)
      drifted = true
    }
  } else {
    fs.writeFileSync(out, md)
  }
}
if (check) {
  console.log(drifted ? '❌ 能力详情页漂移（--check）' : `OK: ${PAGES.length} 个能力详情页与数据表一致`)
  process.exitCode = drifted ? 1 : 0
} else {
  console.log(`generated: ${PAGES.length} 个能力详情页`)
}
