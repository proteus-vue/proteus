// ts-source-scan.mjs —— 「生成器 ↔ 源码」文本契约的**共用**结构化扫描原语（纯文本，不执行 TS）
//
// 【为什么共用】`website/scripts/gen-content.mjs` 有两条隐式契约靠文本解析 TS 源码：
//   ① App 桥方法集（`capability-app.ts` 的工厂返回对象成员）→ `lib/app-bridge-keys.mjs`
//   ② hook → 桥方法引用（`capability.ts` 的 `createCapabilityHooks` 返回对象**各成员取值**）→ `lib/hook-bridge-refs.mjs`
//   两者共用同一套底层动作：注释/字符串**等长遮罩** → 括号配对 → `export function` 定函数体
//   → 顶层 `return {` 定返回对象 → 对象**顶层成员**切分。
//   ★本仓纪律：同一件事不得有第二份手写副本（同源教训见 `docs/project-memory-archive/decisions.md` #481）
//     ⇒ 原语收在此处**一份**，两模块 import；改这里 = 同时改两条契约的解析基础（有对应单测锁）。
//
// 【历史（三次同型咬伤，故收敛）】
//   · #870 拆 `capability.ts` → #876 修（生成器数据源断了）；
//   · #884 `capability-app.ts` 桥方法集（窄正则只认简写风格）；
//   · 本次：hook→桥方法引用（切片按"下一个 use/set 键"截断 + 正则只认 `bridge.x(`）。
//
// 【诚实边界】纯文本扫描（不执行 TS、不建 AST）：
//   · 模板字面量**整体遮罩** ⇒ `${...}` 内的表达式不参与扫描（本仓源码不依赖该形态）；
//   · 字符串/注释里出现的名字**不会**被误抽（遮罩生效）——但也意味着"运行时拼出来的名字"永远抽不到；
//     这是刻意选择：抽不到 ⇒ 调用方**硬失败**，好过静默得空集（对外谎报的原产地）。

/**
 * 把注释与字符串字面量替换成**等长**空白（保留换行）——结构性扫描用。
 * 长度与换行位置均不变 ⇒ 可用同一套下标同时读 `masked`（结构）与原文（取值）。
 */
export function maskNonCode(src) {
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

/** 圆括号配对（masked 上做），返回与 open 处 `(` 配对的 `)` 下标；不配对返回 -1 */
export function matchParen(masked, open) {
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
export function matchBrace(masked, open) {
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

/**
 * 定位 `export function <name>` 的函数体范围 `{open, close}`（附参数表范围 `params`）；找不到返回 null。
 * `params` 用于推导形参名（如桥接收者 `bridge`）——避免把"形参名叫什么"写成隐式约定。
 */
export function findFunctionBody(masked, name) {
  const sig = new RegExp(`export\\s+function\\s+${name}\\b`)
  const m = sig.exec(masked)
  if (!m) return null
  // 先跳到参数表 `(`，配对到 `)`，再找函数体首个 `{`（避开参数里的对象类型）
  let i = m.index
  while (i < masked.length && masked[i] !== '(' && masked[i] !== '{') i++
  let params = null
  if (masked[i] === '(') {
    const close = matchParen(masked, i)
    if (close < 0) return null
    params = { open: i, close }
    i = close + 1
  }
  while (i < masked.length && masked[i] !== '{') i++
  if (i >= masked.length) return null
  const open = i
  const close = matchBrace(masked, open)
  return close < 0 ? null : { open, close, params }
}

/**
 * 在函数体**顶层**（相对函数体深度 1）找最后一个 `return {` 的 `{` 下标；找不到返回 -1。
 * 取「最后一个」是为了避开提前返回的 `return { ok: false }` 之类单行小对象（`capability-app.ts` 的 `errNow` 即此类）。
 */
export function findTopReturnObject(masked, body) {
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

/** 跳过 `:`（或 `(`）之后**头部**的泛型参数表 `<T>` / `<T, U>`，返回其后首个非空下标 */
function skipLeadingGenerics(masked, from, close) {
  let k = from
  const skipWs = () => {
    while (k < close && /\s/.test(masked[k])) k++
  }
  skipWs()
  while (masked[k] === '<') {
    let gd = 0
    while (k < close) {
      const ck = masked[k]
      // ★每个分支都必须推进下标——否则遇 `<` 原地自增 `gd` 成死循环（同型缺陷：p-svg-canvas/path-parser.ts 的 Z 分支）
      if (ck === '<') {
        gd++
        k++
      } else if (ck === '>') {
        gd--
        k++
        if (gd === 0) break
      } else k++
    }
    skipWs()
  }
  return k
}

/**
 * 切分对象体**顶层（深度 0）成员** → `[{ name, value, start, end }]`。
 * · `name: <value>`（属性）与 `name(...) { }`（方法简写）两种写法都收；
 * · `value` = 该成员**取值片段**（属性：`:` 之后到深度 0 的逗号；简写方法：`(` 起到其后的深度 0 逗号），
 *   用于"这个 hook 引用了哪些桥方法"这类**逐成员**分析；
 * · 字符串/注释已在 masked 中遮罩 ⇒ 片段里不会混入注释里的花括号/逗号。
 * ★`<`/`>`**不**计入深度（与比较运算符同形，无法静态区分）——只在**取值头部**显式跳过泛型表，
 *   其余位置的泛型实参必在 `(`/`{`/`[` 内，深度已 ≥ 1，逗号不会误判为成员分隔。
 */
export function topLevelEntries(masked, open, close) {
  const out = []
  let depth = 0
  let i = open + 1
  while (i < close) {
    const c = masked[i]
    if (depth === 0) {
      const head = masked.slice(i, Math.min(close, i + 256))
      const m = /^([A-Za-z_$][\w$]*)\s*([:(])/.exec(head)
      if (m) {
        const name = m[1]
        const vStart = m[2] === ':' ? i + m[0].length : i + name.length
        let d = 0
        let j = skipLeadingGenerics(masked, vStart, close)
        while (j < close) {
          const cj = masked[j]
          if (cj === '{' || cj === '(' || cj === '[') d++
          else if (cj === '}' || cj === ']' || cj === ')') d--
          else if (cj === ',' && d === 0) break
          j++
        }
        out.push({ name, value: masked.slice(vStart, j), start: vStart, end: j })
        i = j + 1
        continue
      }
    }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    i++
  }
  return out
}

/** 对象体顶层成员名（`topLevelEntries` 的薄封装——名字序列） */
export function topLevelMemberNames(masked, open, close) {
  return topLevelEntries(masked, open, close).map((e) => e.name)
}

/**
 * `export function <name>` → 顶层 `return {` → 顶层成员名（三条「生成器↔源码」契约的公共一步：
 * App 桥 `capability-app.ts` / 平台桥 `capability-bridges.ts` + `generated/bridge-ext.ts`）。
 * 失败**不抛错**，把可读原因放进 `miss`（调用方决定是否硬失败——本仓纪律：不静默得空集）。
 * ★`miss` == null 而 `names` 为空**不是**失败：`return {}` 是合法空集（如声明数为 0 的生成物），
 *   要求非空的调用方自行判 `names.length`——否则「合法空集」与「解析器坏了」会被混为一谈。
 */
export function returnObjectMembers(masked, name) {
  const body = findFunctionBody(masked, name)
  if (!body) return { names: [], miss: `${name}（函数未找到）` }
  const open = findTopReturnObject(masked, body)
  if (open < 0) return { names: [], miss: `${name}（未找到顶层 \`return {\`）` }
  const close = matchBrace(masked, open)
  if (close < 0) return { names: [], miss: `${name}（返回对象花括号不配对）` }
  return { names: topLevelMemberNames(masked, open, close), miss: null }
}
