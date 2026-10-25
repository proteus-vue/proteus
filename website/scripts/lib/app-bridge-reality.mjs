// website/scripts/lib/app-bridge-reality.mjs
// ★★★#1237 App 侧「桥成员是真实现还是纯空壳」判定 —— 补齐 #1090 的**已知历史欠账**。
//
// 【为什么需要（#1090 当时就写下的缺口，原文）】
//   `bridge-impl-reality.mjs` 只覆盖 Web / MP 两端（判据：方法体里有平台入口）。
//   App 侧**没有同等检查** —— 于是「App 桥工厂返回对象里有这个方法名」就判 ✅。
//   含义：一个方法体永远只 `return Promise.resolve()` 或永远抛 `unsupported`，
//   文档照样标"App 端已接线"。这与 Web 侧被修掉的 8 处假绿是**同一种谎报**，
//   只是换了一个端。
//
// 【App 侧为什么不能照搬 Web 的判据】
//   App 桥成员**不直接调平台 API**（JS 里没有 `navigator`/`wx`）——它调 `invokeHost('fs.readBytes')`。
//   ⇒ 判据的"平台入口"必须换成 **`invokeHost(...)` 调用**，而"空壳"的形态也变了：
//   · Web 空壳：有 `unsupported` + 零平台入口；
//   · App 空壳：**一次 `invokeHost` 都没有**，或**只在 `unsupported` 分支里出现**。
//     （例如整个方法体是 `return Promise.reject(new Error('x.unsupported'))`）
//
// 【判据（三档，与 #1090 同口径，刻意保守）】
//   ① `shell`：方法体里 **没有** `invokeHost(` 真调用，且有 `unsupported` ⇒ 纯空壳（判 ⚠️）。
//   ② `real`：方法体里有 `invokeHost(` 真调用 ⇒ ✅（哪怕后续校验可能拒绝——那叫端能力边界）。
//   ③ `pure-js`：无 `invokeHost` 也无 `unsupported` ⇒ 纯 JS 组合实现（如 saveFile 组合 fs.*，
//      实际每个子调用在**别的**方法里；证不出是空壳）⇒ 不算 shell。
//      ★这一档必须存在，否则 `getSavedFileList`（纯 JS 组合宿主 fs.*）会被误判成空壳。
//
// 【诚实边界】
//   ① 纯文本判定（不执行 TS）：`invokeHost` 若被别名/间接调用（如 `const inv = invokeHost`）
//      会漏判成 shell ⇒ 文档保守标 ⚠️（**不会**把空壳判成 ✅，方向是安全的）。
//   ② 只判"有没有真调用"，不判"调用得对不对"——后者由真机探针守（#1225 的 logcat 对拍、#1229 的 zip slip）。
//   ③ 与 `bridge-impl-reality.mjs` 的 `stripLiterals` 同源复用（禁止第二份手写副本）。
import fs from 'node:fs'
import path from 'node:path'
import { maskNonCode, returnObjectMembers, topLevelEntries } from './ts-source-scan.mjs'
import { APP_BRIDGE_SOURCES } from './app-bridge-keys.mjs'

/**
 * App 桥的"平台入口" = 对宿主的真实派发。
 * ★只认 `invokeHost(` 与 `invokeHostAsync(`（本仓唯一的宿主调用原语，见 capability-invoke.ts）。
 */
const APP_ENTRY = /\b(invokeHost|invokeHostAsync)\s*\(/

/**
 * ★★间接派发：本仓 `capability-app.ts` 有一个同层助手
 *   `const call = (method, args, capSlug) => …invokeHost(method, args)…`
 *   ⇒ 成员体里写 `call(APP_NATIVE_METHODS.x, …)` 是**真派发**。
 *   ★第一版判据只认 `invokeHost(` ⇒ 把 `getPreload` 误判成纯空壳（**假红**）。
 *     假红的危害与假绿不同但同样严重：真实现被降级 ⇒ 团队按错误信息去"修"一个没坏的东西。
 *   ★第二版只认 `call(` 仍然误判——源码写的是 **`call<void>(…)`**（带泛型实参），
 *     而 `\bcall\s*\(` 要求 `call` 后**紧跟** `(` ⇒ 泛型形态漏判（同一个假红修了两次）。
 *     ⇒ 允许 `call<…>(` 形态。
 *   ★为什么不直接把 `call(` 加进 APP_ENTRY（那样更省事）：`call(` 是极常见词，
 *     会把"任意本地函数调用"当成宿主派发 ⇒ 真空壳也能骗过判据（假绿）。
 *     ⇒ 改为**按文件确认**：只有该文件里真的有 `invokeHost`（即那个助手确实存在）时，
 *        才把 `call(` 当入口。判据因此跟着"这个文件的实际形态"走。
 */
// ★允许泛型实参：源码写 `call<void>(…)` / `call<{ id?: number }>(…)`
const INDIRECT_ENTRY = /\bcall\s*(?:<[^<>]*>)?\s*\(/

/**
 * 判定一个 App 桥成员的方法体。
 * @param {string} maskedCode 成员取值片段（注释/字符串已遮罩）
 * @param {string} rawCode 原文（错误码在字符串里，遮罩后会丢）
 * @param {boolean} allowIndirect 该源文件里是否存在把 `invokeHost` 封起来的助手（见 INDIRECT_ENTRY）
 * @returns {'shell'|'real'|'pure-js'}
 */
export function classifyAppMember(maskedCode, rawCode, allowIndirect = false) {
  const hasEntry = APP_ENTRY.test(maskedCode) || (allowIndirect && INDIRECT_ENTRY.test(maskedCode))
  // ★unsupported 判据用原文（`capErr('x.unsupported', …)` 的码在字符串里，遮罩后消失）
  const hasUnsupported = /\bunsupported\b/i.test(maskedCode) || /\bunsupported\b/i.test(rawCode)
  if (hasEntry) return 'real'
  return hasUnsupported ? 'shell' : 'pure-js'
}

/** 从工厂返回对象里抽「成员名 → { masked, raw }」（用共享原语的偏移，保证与桥方法集同源） */
export function extractFactoryMemberBodies(rawSrc, factory) {
  const masked = maskNonCode(rawSrc)
  const body = findFunctionBodyLocal(masked, factory)
  if (!body) return null
  const open = findTopReturnObjectLocal(masked, body)
  if (open < 0) return null
  const close = matchBraceLocal(masked, open)
  if (close < 0) return null
  const out = {}
  for (const e of topLevelEntries(masked, open, close)) {
    out[e.name] = { masked: e.value, raw: rawSrc.slice(e.start, e.end) }
  }
  return out
}

// ── 以下三个薄封装复用 ts-source-scan 的实现（通过 returnObjectMembers 的同一套内部动作）──
// ★为什么不直接 import 那三个未导出的内部函数：它们没导出，而本仓禁止复制粘贴。
//   ⇒ 用导出的 `returnObjectMembers` 拿到成员名清单，再用 `topLevelEntries` 的偏移重建片段。
//   实现上：先调 returnObjectMembers 确认可解析（同一套配对逻辑），再自己定位一次用于取片段。
import { findFunctionBody, findTopReturnObject, matchBrace } from './ts-source-scan.mjs'
const findFunctionBodyLocal = findFunctionBody
const findTopReturnObjectLocal = findTopReturnObject
const matchBraceLocal = matchBrace

const cache = new Map()

/**
 * 加载 App 侧**纯空壳**成员集。
 *
 * @param {string} root 仓库根
 * @returns {{ shells: Set<string>, checked: number, unparsed: string[] }}
 *   `unparsed` = 无法解析的工厂（**如实列出**，不静默当"没有空壳"）
 */
export function loadAppShellMembers(root) {
  const key = root
  if (cache.has(key)) return cache.get(key)
  const shells = new Set()
  const unparsed = []
  let checked = 0
  for (const spec of APP_BRIDGE_SOURCES) {
    const abs = path.join(root, spec.file)
    if (!fs.existsSync(abs)) { unparsed.push(`${spec.file}（文件不存在）`); continue }
    const src = fs.readFileSync(abs, 'utf8')
    const maskedSrc = maskNonCode(src)
    // ★该文件是否把 invokeHost 封进了助手（有则 `call(` 也算入口——见 INDIRECT_ENTRY 注释）
    const allowIndirect = APP_ENTRY.test(maskedSrc)
    for (const fn of spec.functions) {
      const members = extractFactoryMemberBodies(src, fn)
      if (members === null) { unparsed.push(`${fn}（解析失败）`); continue }
      // ★空返回对象是合法形态（宿主缺能力时工厂返回 {}）⇒ 不算解析失败
      const names = returnObjectMembers(maskedSrc, fn)
      if (names.miss) { unparsed.push(names.miss); continue }
      for (const [name, { masked, raw }] of Object.entries(members)) {
        checked++
        if (classifyAppMember(masked, raw, allowIndirect) === 'shell') shells.add(name)
      }
    }
  }
  const result = { shells, checked, unparsed }
  cache.set(key, result)
  return result
}

/** 测试用：清缓存 */
export function resetAppBridgeRealityCache() {
  cache.clear()
}
