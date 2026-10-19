// website/scripts/lib/bridge-impl-reality.mjs
// ★★★决策 #1090（2026-10-19）：平台桥成员的「真实现 vs 纯空壳」判定 —— 能力页 ✅ 的**第二道判据**。
//
// 【为什么需要（#1089 落地后用户追问「✅ 是只有接线才算还是有桥就算」）】
//   查证结论：三端口径**不一致**——
//     · 微信 / Web：**方法名存在**就判 ✅（完全不看方法体）
//     · iOS / Android：App 桥工厂返回对象里有该方法名 ⇒ ✅（不看宿主是否真实现）
//     · 鸿蒙：JS 桥 + 宿主三端源码**双证据** ⇒ 最严
//   于是 Web 侧出现 8 处假绿：`getPreload` / `getImageEdit` / `getWindow` / `getAd` /
//   `createCacheManager` / `getSocket` / `getPrivacy` / `navigateMiniProgram` 的方法体
//   **没有任何平台 API 调用**，全部出口是 `*.unsupported` 或直接抛 Err ⇒ 业务永远拿 Err，
//   文档却标「webBridge 实现（平台 API 直连）」。
//   ⇒ 本模块补上"方法体里有没有真活"这道判据，把纯空壳降级为 ⚠️。
//
// 【判据（三档，刻意保守）】
//   ① **纯空壳**：方法体里出现 `unsupported` 错误，且**没有任何平台入口**
//      （Web：`g` / `nav` / `navigator` / `document` / `WebSocket` / `fetch(` … ；
//       微信：`wx.`）⇒ 恒 Err，判 ⚠️。
//   ② **真实现**：有平台入口 ⇒ ✅（哪怕只用到一部分 API 也算——见下"诚实边界"）。
//   ③ **无 unsupported**：纯 JS 实现（如 Web 内存文件系统、导航守卫）⇒ ✅（证不出是空壳）。
//
// 【★为什么"有入口就算真"而不是"每个方法都得能用"】
//   与 #1085 已确立的口径一致：**部分方法空、主体方法如实 Err 的 API 不算谎报**（那类叫"端有能力边界"）。
//   本判据只抓**整块**都不干活的纯空壳——这是"看起来可用、实际不工作"的最恶劣形态。
//   例：Web `getBluetooth` 只有 Web Bluetooth 特性探测、BLE 操作全 Err ⇒ 仍算 ✅（入口是真的）；
//       Web `getPreload` 一行平台调用都没有 ⇒ ⚠️。
//
// 【诚实边界】纯文本判定（不执行 TS）：平台入口靠**标识符白名单**识别。
//   白名单外的平台 API 会被误判为空壳（→ 文档保守标 ⚠️），不会反过来把空壳判成 ✅。
//   ★字符串与注释先被剥掉——否则错误提示里的 `'…请用 window.open…'` 会被当成真实调用
//   （实测：`navigateMiniProgram` 的错误文案就含 `window.open`，首版据此误判为真实现）。
import fs from 'node:fs'
import path from 'node:path'

/** 参与判定的平台桥源（生成物 `bridge-ext` 在运行路径上，必须同扫）。 */
export const BRIDGE_SOURCES = {
  web: [
    { file: 'packages/api/src/capability-bridges.ts', factory: 'webBridge' },
    { file: 'packages/api/src/generated/bridge-ext.ts', factory: 'webBridgeExt' },
  ],
  mp: [
    { file: 'packages/api/src/capability-bridges.ts', factory: 'wxBridge' },
    { file: 'packages/api/src/generated/bridge-ext.ts', factory: 'mpBridgeExt' },
  ],
}

/**
 * Web 平台入口标识符（出现任一即认为方法体里有真活）。
 * ★含闭包别名 `g` / `nav` / `doc`——webBridge 里 `nav = g.navigator`、成员体大量通过别名访问，
 *   只认全名 `navigator` 会把 `getBattery`（`nav?.getBattery`）误判成空壳（首版实测）。
 */
const WEB_ENTRY = [
  'g', 'nav', 'doc',
  'navigator', 'document', 'window', 'location', 'history', 'screen',
  'WebSocket', 'fetch', 'Worker', 'Notification', 'localStorage', 'sessionStorage',
  'crypto', 'performance', 'MediaRecorder', 'MediaSource', 'WebAssembly', 'matchMedia',
  'requestIdleCallback', 'requestAnimationFrame', 'indexedDB', 'caches', 'serviceWorker',
  'URL', 'Blob', 'File', 'FileReader', 'Audio', 'AudioContext', 'XMLHttpRequest',
  'PublicKeyCredential', 'NDEFReader', 'IntersectionObserver', 'ResizeObserver',
  'MutationObserver', 'visualViewport', 'devicePixelRatio', 'postMessage',
  'getUserMedia', 'mediaDevices', 'RTCPeerConnection', 'speechSynthesis', 'import',
]

/** 微信平台入口。 */
const MP_ENTRY = ['wx']

/** 剥掉注释与字符串/模板字面量内容（保留标识符与调用结构）。 */
export function stripLiterals(code) {
  let out = ''
  let i = 0
  while (i < code.length) {
    const c = code[i]
    const next = code[i + 1]
    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') i++
        i++
      }
      i++
      out += '""'
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * 判定一个桥成员的方法体。
 * @param {string} code 成员源码（从 `name:` 到下一个顶层成员之前）
 * @param {'web'|'mp'} end
 * @returns {'shell'|'real'|'pure-js'}
 *   shell   = 有 unsupported 且无平台入口 ⇒ 恒 Err（判 ⚠️）
 *   real    = 有平台入口
 *   pure-js = 无 unsupported（纯 JS 实现，证不出是空壳）
 */
export function classifyMemberBody(code, end) {
  // ★两个文本各司其职（首版踩坑：错误码 `'preload.unsupported'` **在字符串里**，
  //   统一用剥字符串后的文本判断 ⇒ hasUnsupported 恒 false ⇒ 所有空壳被判成 pure-js）。
  //   · 平台入口：必须剥字符串（否则错误文案里的 `window.open` / `<link rel=preload>` 会被当日志调用）
  //   · unsupported 错误码：用**原文**（它本来就是字符串字面量）
  const codeOnly = stripLiterals(code)
  const tokens = end === 'web' ? WEB_ENTRY : MP_ENTRY
  const hasEntry = tokens.some((t) => new RegExp(`\\b${t}\\b`).test(codeOnly))
  const hasUnsupported = /\bunsupported\b/.test(code)
  if (!hasUnsupported) return 'pure-js'
  return hasEntry ? 'real' : 'shell'
}

/**
 * 从工厂函数的返回对象里抽出「成员名 → 方法体」。
 * ★文本解析（不执行 TS）；找不到工厂/返回对象 ⇒ 返回空 map（调用方决定是否硬失败）。
 * @param {string} src 源码
 * @param {string} factory 工厂函数名
 * @returns {Record<string,string>}
 */
export function extractFactoryMembers(src, factory) {
  const start = src.indexOf(`export function ${factory}`)
  if (start < 0) return {}
  // ★跳过参数表：参数里含对象类型字面量（`webBridge(g: typeof globalThis & { navigator?: … })`）
  //   ⇒ 直接找第一个 `{` 会落进参数里（首版实测：抽出的成员数恒为 0）。
  //   正确做法：先做括号配对跳过 `( … )`，再从其后找函数体 `{`。
  const paren = src.indexOf('(', start)
  if (paren < 0) return {}
  let pd = 0
  let p = paren
  for (; p < src.length; p++) {
    if (src[p] === '(') pd++
    else if (src[p] === ')') { pd--; if (pd === 0) break }
  }
  let i = src.indexOf('{', p)
  if (i < 0) return {}
  let depth = 0
  const bodyStart = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  const body = src.slice(bodyStart, i)
  // 顶层成员：缩进 4 空格的 `name:`（本仓桥工厂的既有写法）
  const starts = []
  for (const m of body.matchAll(/^ {4}([A-Za-z]\w*):/gm)) starts.push({ name: m[1], at: m.index })
  const out = {}
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1].at : body.length
    out[starts[k].name] = body.slice(starts[k].at, end)
  }
  return out
}

const cache = new Map()

/**
 * 加载某端的纯空壳成员集。
 * @param {string} root 仓库根
 * @param {'web'|'mp'} end
 * @returns {Set<string>}
 */
export function loadPureShellMembers(root, end) {
  const key = `${root}::${end}`
  if (cache.has(key)) return cache.get(key)
  const shells = new Set()
  for (const spec of BRIDGE_SOURCES[end]) {
    const abs = path.join(root, spec.file)
    if (!fs.existsSync(abs)) continue
    const members = extractFactoryMembers(fs.readFileSync(abs, 'utf8'), spec.factory)
    for (const [name, code] of Object.entries(members)) {
      if (classifyMemberBody(code, end) === 'shell') shells.add(name)
    }
  }
  cache.set(key, shells)
  return shells
}

/** 测试用：清缓存（改源码后重新判定）。 */
export function resetBridgeRealityCache() {
  cache.clear()
}
