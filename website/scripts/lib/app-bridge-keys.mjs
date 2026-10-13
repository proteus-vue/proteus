// app-bridge-keys.mjs —— App 宿主桥方法集抽取（生成器 ↔ 源码 的**显式契约**）
//
// 【为什么有本模块（2026-10-13 · 决策 #881，承接审查报告 docs/native-capability-crossend-progress.md §3/§7）】
//   官网能力页的「App 端（iOS/Android）是否接线」由 `capability-app.ts` 的**桥方法名**推导。
//   旧实现是 gen-content.mjs 内一条窄正则 `/^\s{4}(get[A-Z]\w*)\(/gm` —— **只认方法简写风格**：
//     · 不认属性箭头 `getXxx: () => …`（capability-app.ts 两种风格**混用**）
//     · 不认无 `get` 前缀的动词式方法（`loadExtension` / `createWorker` / `navigateMiniProgram`）
//   ⇒ 13 个桥方法只抽到 3 个 ⇒ 8+ 个能力被错误标为「渲染核心已落地——能力桥未接线」（**对外谎报**）。
//   同一形态已咬过一次（#870 拆文件 → #876 修）：**文本隐式契约**这类缺陷，改对了代码反而静默打断它。
//
// 【本模块的做法】**锚定式**解析（不再全文件正则）：
//   ① 按 `export function <name>` 定位工厂函数体（花括号配对；先跳过参数表 `( … )`）；
//   ② 在函数体**顶层（深度 1）**找 `return {` 对象 → 花括号配对取对象体；
//   ③ 取对象体**深度 0** 的成员名（`name:` 与 `name(` 两种写法都收）。
//   字符串 / 注释先做**等长遮罩**（maskNonCode）——结构性扫描不受字面量里的括号干扰。
//   找不到函数 / 找不到返回对象 / 抽出 0 个 ⇒ **抛错（硬失败）**，绝不静默得空集。
//
// 【诚实边界】纯文本解析（不执行 TS）。工厂函数若彻底改名/改结构，本模块**报错**而非猜——
//   这是刻意选择（「数据源缺失 = 硬失败」），与本仓「不静默」纪律一致；改名时同步本文件常量即可。

import fs from 'node:fs'

/**
 * 契约常量：App 桥的两个工厂函数（`packages/api/src/capability-app.ts`）。
 * 二者返回对象的方法名并集 = App 端可用桥方法集。★改源码里的工厂名须同步此表（否则硬失败报错）。
 */
export const APP_BRIDGE_FACTORIES = ['createAppNativeCapabilities', 'createAppLifecycleCapabilities']

/** 把注释与字符串字面量替换成等长空白（保留换行）——结构性扫描用；长度与换行不变 */
function maskNonCode(src) {
  const out = [...src]
  const n = src.length
  let i = 0
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < n) {
    const ch = src[i]
    const nx = src[i + 1]
    if (ch === '/' && nx === '/') {
      const s = i
      while (i < n && src[i] !== '\n') i++
      blank(s, i)
      continue
    }
    if (ch === '/' && nx === '*') {
      const s = i
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i = Math.min(i + 2, n)
      blank(s, i)
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      const s = i
      i++
      while (i < n) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === q) {
          i++
          break
        }
        i++
      }
      blank(s, i)
      continue
    }
    i++
  }
  return out.join('')
}

/** 括号配对（masked 上做），返回与 open 处 `(` 配对的 `)` 下标；不配对返回 -1 */
function matchParen(masked, open) {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    const c = masked[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 花括号配对（masked 上做），返回与 open 处 `{` 配对的 `}` 下标；不配对返回 -1 */
function matchBrace(masked, open) {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    const c = masked[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 定位 `export function <name>` 的函数体范围 {open, close}；找不到返回 null */
function findFunctionBody(masked, name) {
  const sig = new RegExp(`export\\s+function\\s+${name}\\b`)
  const m = sig.exec(masked)
  if (!m) return null
  // 先跳到参数表 `(`，配对到 `)`，再找函数体首个 `{`（避开参数里的对象类型）
  let i = m.index
  while (i < masked.length && masked[i] !== '(' && masked[i] !== '{') i++
  if (masked[i] === '(') {
    const close = matchParen(masked, i)
    if (close < 0) return null
    i = close + 1
  }
  while (i < masked.length && masked[i] !== '{') i++
  if (i >= masked.length) return null
  const open = i
  const close = matchBrace(masked, open)
  return close < 0 ? null : { open, close }
}

/**
 * 在函数体**顶层**（相对函数体深度 1）找最后一个 `return {` 的 `{` 下标；找不到返回 -1。
 * 取「最后一个」是为了避开提前返回的 `return { ok: false }` 之类单行小对象（本文件 `errNow` 即此类）。
 */
function findTopReturnObject(masked, body) {
  let depth = 0
  let ret = -1
  for (let i = body.open; i <= body.close; i++) {
    const c = masked[i]
    if (c === 'r' && depth === 1 && masked.startsWith('return', i)) {
      const prev = masked[i - 1]
      const isWord = prev !== undefined && /[\w$]/.test(prev)
      if (!isWord) {
        let j = i + 'return'.length
        while (j <= body.close && /\s/.test(masked[j])) j++
        if (masked[j] === '{') ret = j
      }
    }
    if (c === '{') depth++
    else if (c === '}') depth--
  }
  return ret
}

/** 取对象体内**深度 0** 的成员名（`name:` / `name(` 两种写法）——按行边界匹配，不跨行 */
function topLevelMemberNames(masked, open, close) {
  const names = []
  let depth = 0
  let lineStart = open + 1
  for (let i = open + 1; i < close; i++) {
    const c = masked[i]
    if (c === '\n') lineStart = i + 1
    if (i === lineStart && depth === 0) {
      let lineEnd = masked.indexOf('\n', i)
      if (lineEnd < 0 || lineEnd > close) lineEnd = close
      const m = /^\s*([A-Za-z_$][\w$]*)\s*[:(]/.exec(masked.slice(i, lineEnd))
      if (m) names.push(m[1])
    }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
  }
  return names
}

/**
 * 抽取：给定源码 + 工厂函数名列表 → `{ keys:Set<string>, perFn:{[fn]:number}, misses:string[] }`。
 * 纯函数（可单测）；不抛错，把问题汇总到 `misses`。
 */
export function extractAppBridgeKeys(src, functions = APP_BRIDGE_FACTORIES) {
  const masked = maskNonCode(src)
  const keys = new Set()
  const perFn = {}
  const misses = []
  for (const fn of functions) {
    const body = findFunctionBody(masked, fn)
    if (!body) {
      misses.push(`${fn}（函数未找到）`)
      continue
    }
    const retOpen = findTopReturnObject(masked, body)
    if (retOpen < 0) {
      misses.push(`${fn}（未找到顶层 \`return {\`）`)
      continue
    }
    const close = matchBrace(masked, retOpen)
    if (close < 0) {
      misses.push(`${fn}（返回对象花括号不配对）`)
      continue
    }
    const names = topLevelMemberNames(masked, retOpen, close)
    if (!names.length) {
      misses.push(`${fn}（返回对象未解析出成员）`)
      continue
    }
    perFn[fn] = names.length
    for (const nm of names) keys.add(nm)
  }
  return { keys, perFn, misses }
}

/**
 * 从文件读并抽取。**数据源契约硬失败**：文件缺失 / 函数缺失 / 返回对象缺失 / 抽到 0 个 ⇒ 抛错。
 * 返回 `{ keys, perFn }`。
 */
export function loadAppBridgeKeys(filePath, functions = APP_BRIDGE_FACTORIES) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[app-bridge-keys] 找不到 App 桥源文件：${filePath}（数据源缺失 = 硬失败，不静默得空集）`)
  }
  const { keys, perFn, misses } = extractAppBridgeKeys(fs.readFileSync(filePath, 'utf8'), functions)
  if (misses.length) {
    throw new Error(`[app-bridge-keys] 解析失败（数据源契约被破坏）：${misses.join('；')}`)
  }
  if (keys.size === 0) {
    throw new Error('[app-bridge-keys] 抽取到 0 个 App 桥方法（不静默得空集）')
  }
  return { keys, perFn }
}
