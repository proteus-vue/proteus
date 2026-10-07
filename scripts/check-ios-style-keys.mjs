#!/usr/bin/env node
// scripts/check-ios-style-keys.mjs —— ★★★iOS 宿主「styleOf 透传键」覆盖门禁（决策 #650）
//
// 【它防什么】iOS 自绘宿主 `SelfDrawView.styleOf(_:)` 是**建层必经之路**（`buildLayers` /
//   `insertLayers` 都经它把节点 dict 抽成 style dict，结果同时进 `metaByNodeId` = 度量真源）。
//   `styleOf` 用**白名单**（刻意：只透传绘制/布局相关键）。白名单的代价：
//   **被消费者读、却没进 styleOf 白名单的键 = 请求树里有值、宿主永远读 nil ⇒ 静默不生效**
//   ——无报错、无日志。
//
//   ★这类缺陷在本文件**已复发 6+ 次**（每次都被真机/子代理抓出，注释里记了好几次"教训"）：
//     clipPath / glow / mask / perspective（2026-10-01~03）· borderRadiusCorners（03 个月静默）·
//     letterSpacing / textDecoration / transform / transformOrigin / opacity / visibility（2026-10-08）·
//     lineClamp · padding（2026-10-09）……
//   ⇒ 与 Android `check:host-kernel-keys` **同源**（"漏登记只有工具层能兜住"）。
//     但 `check:host-kernel-keys` 明说不覆盖 iOS（iOS 无 LAYOUT_KEYS 白名单，形式不同）——
//     本门禁补上这块：iOS 的"白名单"就是 `styleOf` 内部写进 `style` 的键集。
//
// 【判据（机器推导，不手写清单）】
//   ① **透传集** = `styleOf` 函数体里写进 `style` 的键（三种形态：`for k in [..]` 数组字面量 ·
//      `n["X"]` 读 · `style["X"] =` 直写）。
//   ② **消费集** = 全文件 `style["X"]` 的**读**（= 计算属性访问；即宿主真正会用的键）。
//   ③ **外部写入集** = `styleOf` **之外**的 `style["X"] =` 写（这些键不经 styleOf，属合法来源）。
//   ④ 惩罚：`消费集 − 透传集 − 外部写入集` 必须 ⊆ `EXCUSED`（每条带理由）——否则红。
//   ⑤ 陈旧豁免：`EXCUSED` 里的键若**不再**缺（说明已补或已不用）⇒ 红（逼着删，不留过期豁免）。
//   ⑥ 解析护栏：函数/`return style` 找不到、或透传/消费集异常偏小 ⇒ 红（防被改名/搬走后门禁静默失效）。
//
// 【诚实边界】覆盖范围 = **`style["X"]` 直读**这一种形态（本文件消费 style 的唯一大宗写法，143 处）。
//   经**别名变量**（如 `let s = style` 后再 `s["X"]`）的读不在内——目前本文件无此形态；
//   若将来出现，本门禁的"消费集"会偏小（漏报方向），补一条别名规则即可。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift')

/**
 * 显式豁免：**被 `style["X"]` 读、但刻意不经 `styleOf` 透传**的键（每条必须带理由）。
 * ★写豁免 = 承诺"该键不经 styleOf 进入 style 是**有意**的"；拿不准就补透传（默认安全方向）。
 */
const EXCUSED = {
  // （当前为空——`borderRadiusPct` / `animation` 曾在此缺失并被本门禁首跑抓出，已补进 styleOf。）
}

const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1 }

const src = fs.readFileSync(SRC, 'utf-8')
const lines = src.split('\n')

/* ── ① 切出 styleOf 函数体 ── */
const start = lines.findIndex((l) => /static func styleOf\(_ n: \[String: Any\]\)/.test(l))
if (start < 0) { console.error('✗ 找不到 `static func styleOf(_ n: [String: Any])`（被改名/搬走？）——门禁失效，先修门禁'); process.exit(2) }
let end = -1
for (let i = start; i < lines.length; i++) { if (/^\s*return style\s*$/.test(lines[i])) { end = i; break } }
if (end < 0) { console.error('✗ 找不到 styleOf 的 `return style`——门禁失效，先修门禁'); process.exit(2) }
const body = lines.slice(start, end + 1).join('\n')

/* ── ② 透传集 ── */
const passthrough = new Set()
for (const m of body.matchAll(/for k in \[([^\]]*)\]/g)) for (const s of m[1].matchAll(/"([a-zA-Z][a-zA-Z0-9]*)"/g)) passthrough.add(s[1])
for (const m of body.matchAll(/\bn\["([a-zA-Z][a-zA-Z0-9]*)"\]/g)) passthrough.add(m[1])          // n["X"] 读进 style
for (const m of body.matchAll(/\bstyle\["([a-zA-Z][a-zA-Z0-9]*)"\]\s*=/g)) passthrough.add(m[1])    // style["X"] = 直写

/* ── ③ 消费集（全文件 style["X"] 读） ── */
const consumed = new Set()
for (const m of src.matchAll(/\bstyle\["([a-zA-Z][a-zA-Z0-9]*)"\]/g)) consumed.add(m[1])

/* ── ④ 外部写入集（styleOf 之外写 style） ── */
const externalWrites = new Set()
for (let i = 0; i < lines.length; i++) {
  if (i >= start && i <= end) continue
  for (const m of lines[i].matchAll(/\bstyle\["([a-zA-Z][a-zA-Z0-9]*)"\]\s*=/g)) externalWrites.add(m[1])
}

/* ── ⑥ 解析护栏（防静默失效） ── */
if (passthrough.size < 30) fail(`styleOf 透传集异常偏小（${passthrough.size}）——解析规则或被改，先修门禁`)
if (consumed.size < 20) fail(`消费集异常偏小（${consumed.size}）——解析规则或被改，先修门禁`)

/* ── ⑤ 判据 ── */
const missing = [...consumed].filter((k) => !passthrough.has(k) && !externalWrites.has(k)).sort()
const unexpected = missing.filter((k) => !(k in EXCUSED))
const staleExcused = Object.keys(EXCUSED).filter((k) => !missing.includes(k))

if (unexpected.length) {
  fail(`iOS styleOf **漏透传**（被宿主读、却未进白名单 ⇒ 静默不生效）：${unexpected.join(', ')}`)
  console.error('  → 修法：在 `styleOf` 里补该键的透传（照抄邻近键的形态）；确属不经 styleOf 的键 ⇒ 写进 EXCUSED 并给理由。')
}
if (staleExcused.length) fail(`EXCUSED 陈旧（键已不缺，应删除该豁免）：${staleExcused.join(', ')}`)

if (!process.exitCode) {
  console.log(`✅ iOS styleOf 透传覆盖（透传 ${passthrough.size} · 消费 ${consumed.size} · 外部写入 ${externalWrites.size} · 豁免 ${Object.keys(EXCUSED).length}）`)
}
