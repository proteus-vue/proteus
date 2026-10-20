// website/scripts/lib/ts-ifaces.mjs
// ★★★#1129：**TS 接口属性抽取**（从源码文本，供"文档 vs 实现"对齐门禁使用）。
//
// 【为什么要单独一份（不复用 gen-content 的）】
//   gen-content.mjs 里那份 `extractInterfaces` 不能直接 import（那是带顶层 await 的脚本），
//   而门禁需要**同一个口径**。⇒ 抽成独立 lib，两边同源。
//
// 【★本文件的前身踩过的坑（写在这里，因为下次还会有人写同一个正则）】
//   首版用 `(?:\/\*\*[\s\S]*?\*\/\s*)?export interface (\w+)[^{;]*\{` ——
//   那个**可选**的 JSDoc 前缀是贪婪的：`[\s\S]*?` 会跨越**前一个接口**去凑匹配，
//   于是 160 个接口里有一批被跳过或取错体 ⇒ 实测把 `NetworkType.online`、
//   `CapDeviceInfo.platform`、`BatteryInfo.level` 等**真实存在的字段**判成"不存在"（8 处假红）。
//   ⇒ 正确做法：**不匹配 JSDoc**，只定位 `export interface NAME`，再从其后第一个 `{` 做花括号配对。
//     文档（JSDoc）另由单独的 `docOf()` 从接口声明**之前紧邻**的注释块取。
//
// 【支持形态（本仓实际出现的）】
//   · 普通多行接口
//   · `extends X`（父接口属性在调用方合并；本文件只给自身属性）
//   · 单行接口（`{ a: X; b: Y }`）
//   · 泛型声明（`Foo<T = any> {`）
//   · `readonly` 修饰符（★#1124 踩过：不支持它会让 `AbortSignalLike.aborted` 整行丢失）
//   · 方法成员（`foo(a: string): void`）——与属性分开收集

/** 去掉注释与字符串，避免花括号计数被 `{` / `}` 字面量干扰。 */
function maskNonCode(src) {
  let out = ''
  let i = 0
  let state = 'code' // code | line | block | sq | dq | tpl
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === "'") { state = 'sq'; out += ' '; i++; continue }
      if (c === '"') { state = 'dq'; out += ' '; i++; continue }
      if (c === '`') { state = 'tpl'; out += ' '; i++; continue }
      out += c; i++; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i++; continue }
      out += ' '; i++; continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '; i++; continue
    }
    // 字符串态：保留换行以便行号稳定，其余打空格
    if (c === '\\') { out += '  '; i += 2; continue }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'; out += ' '; i++; continue
    }
    out += c === '\n' ? '\n' : ' '; i++; continue
  }
  return out
}

/**
 * 抽 `export interface X { ... }` 的成员。
 * @returns {Record<string, {props: Array<{name:string,type:string,optional:boolean,doc:string}>, methods: Array<{name:string,sig:string,doc:string}>}>}
 */
export function extractInterfaces(src) {
  const masked = maskNonCode(String(src))
  const out = {}
  const re = /export interface (\w+)/g
  let m
  while ((m = re.exec(masked))) {
    const name = m[1]
    // 从声明后第一个 `{` 起做花括号配对（masked 里注释/字符串已变空格 ⇒ 计数可靠）
    const braceAt = masked.indexOf('{', m.index + m[0].length)
    if (braceAt < 0) continue
    let depth = 0
    let end = -1
    for (let i = braceAt; i < masked.length; i++) {
      if (masked[i] === '{') depth++
      else if (masked[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) continue
    // ★必须用**原文**取成员（masked 把类型里的字符串字面量打成空格了）
    const bodyRaw = src.slice(braceAt + 1, end)
    const props = []
    const methods = []
    for (const rawLine of bodyRaw.split('\n')) {
      const t = rawLine.trim()
      if (!t) continue
      if (t.startsWith('/**') || t.startsWith('*') || t.startsWith('//')) continue
      // 方法成员：`name(` 在 `:` 之前
      const mm = /^(\w+)\s*(?:<[^>]*>)?\s*\(/.exec(t)
      if (mm) { methods.push({ name: mm[1], sig: t.replace(/;\s*$/, ''), doc: '' }); continue }
      // 属性成员（支持 readonly / 可选 / 单行多属性里的后缀片段）
      const pm = /^(?:readonly\s+)?(\w+)(\?)?\s*:\s*(.+)$/.exec(t)
      if (pm) props.push({ name: pm[1], optional: pm[2] === '?', type: pm[3].replace(/;\s*$/, '').trim(), doc: '' })
    }
    out[name] = { props, methods }
    re.lastIndex = end
  }
  // ★#1129：**type alias 也要跟**（`export type AppLifecycle = AppLifecycleHandle`）——
  //   文档里的 `data` 结构常写成 alias 名，而 alias 指向的才是真 interface。
  //   首版只认 `interface` ⇒ app-lifecycle / page-lifecycle 两页被判"接口不存在"（假红）。
  const aliasRe = /export type (\w+)\s*=\s*(\w+)\s*(?:\n|;|$)/g
  let am
  while ((am = aliasRe.exec(masked))) {
    const [, alias, target] = am
    if (out[alias]) continue   // 已有 interface 同名 ⇒ 不覆盖
    out[alias] = { props: [], methods: [], aliasOf: target }
  }

  // 解析 alias 链（最多 5 跳，防循环）
  for (const k of Object.keys(out)) {
    let cur = out[k]
    let hops = 0
    while (cur && cur.aliasOf && out[cur.aliasOf] && hops < 5) {
      cur = out[cur.aliasOf]
      hops++
    }
    if (cur && cur !== out[k] && (cur.props.length || cur.methods.length)) {
      out[k] = { ...cur }
    }
  }
  return out
}

/**
 * ★#1129：**跨文件解析 alias 链**（`capability-types.ts` 的 `AppLifecycle` 指向
 *   `capability-app.ts` 的 `AppLifecycleHandle`）——单文件 extractInterfaces 内解析不了。
 *   门禁应把多文件结果**合并后**调本函数。
 */
export function resolveAlias(ifaces) {
  for (const k of Object.keys(ifaces)) {
    let cur = ifaces[k]
    let hops = 0
    while (cur && cur.aliasOf && ifaces[cur.aliasOf] && hops < 5) {
      cur = ifaces[cur.aliasOf]
      hops++
    }
    if (cur && cur !== ifaces[k] && (cur.props.length || cur.methods.length)) ifaces[k] = { ...cur }
  }
  return ifaces
}

/** 取某接口名 → 属性名集合（门禁最常用的形态）。 */
export function propsOf(ifaces, name) {
  return new Set((ifaces[name]?.props ?? []).map((p) => p.name))
}
