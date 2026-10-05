#!/usr/bin/env node
// scripts/check-app-ir-shadow.mjs —— ★★★G-61 后批：**App 端 IR 切换 · 影子对账**（plan §2.2 纪律落地）
//
// 【它做什么（plan `04-batches-and-boundaries.md` §2「App 端改造纪律」）】
//   纪律原文：「**新通路与既有通路并行存在**……**每批必须有 IR 等价判据兜底**；任一批不达标即回退该批」
//   ⇒ 本脚本是**切换决策的取数装置**：对语料里每个 SFC，**同时**跑：
//     · 旧通路：`buildLayoutTemplate`（`packages/compiler/src/vapor/template.ts` 的字段折叠器）
//     · 新通路：CSE（`extractFromSfc` + `computeTree` → StyleIR 字段）
//   把两者**归一化到同一口径**后**逐元素**对账，产出每字段的 `match / mismatch / old-only / cse-only`。
//
// 【★★节点对齐（本工具最关键的设计——首版按 DFS 序号配对**失败**，如实记录）】
//   旧通路**做平台转换**：混合文本会拆出合成的 `p-text` 叶（`text-runs.ts` 的既定行为）；
//   CSE 是**纯 CSS 提取**（不做平台转换）。
//   ⇒ 两棵树**结构不同**、节点数不同（实测 config-demo：旧 37 vs CSE 30），**索引对齐无效**
//   （首版把"错位节点的值"当差异报出 981 条——**假差异**，会误导切换决策）。
//   ⇒ 改为**树形感知对齐**：双指针同步走，遇旧侧合成叶（`p-text`）跳过；tag 命中才配对；
//     无法对齐的**如实计数**（`unaligned`，不静默）。
//
// 【★归一化口径（对账的前提）】
//   · 长度：旧 = 裸数（dp）/ `widthRatio` 比例；新 = `{kind:'absolute',dp}` / `{kind:'ratio',ratio,base}`
//   · 边：旧 = `{top,right,bottom,left}` 结构化；新 = 逐边字段（`marginTop` …）
//   · gap：旧 = 单 `gap`；新 = `rowGap`/`columnGap`（同值 ⇒ 折回单 gap）
//   · line-height：旧 = 原样字符串（`'1.4'` / `'22px'`）；新 = px 数 ⇒ 用旧侧 fontSize 折成因子对齐
//   · 颜色/枚举：两路同形（hex / 关键字）
//
// 【诚实边界】a) 只**对账**不切换；b) `old-only` 含"旧通路支持而 IR v1 不消费"的字段
//   （`boxShadow`/`transform` 结构化形态）——切换时必须保留或补 IR 映射；c) 合成叶不参与字段比对
//   （它的样式由文本段合成决定，不在 IR 对账面）。
//
// 用法：
//   node scripts/check-app-ir-shadow.mjs                 # 全语料对账（人读）
//   node scripts/check-app-ir-shadow.mjs --json          # 机器可读
//   node scripts/check-app-ir-shadow.mjs --file <path>   # 单文件（调试）
//   node scripts/check-app-ir-shadow.mjs --write         # 写产物 docs/generated/app-ir-shadow.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const WRITE = argv.includes('--write')
const FILE = (() => {
  const i = argv.indexOf('--file')
  return i >= 0 ? argv[i + 1] : undefined
})()

const compiler = await import(pathToFileURL(path.join(ROOT, 'packages/compiler/dist/index.js')).href)
const { buildLayoutTemplate, extractFromSfc, computeTree } = compiler

/** 语料（真实页面面） */
const WALK_ROOTS = ['examples/pages', 'examples/subpackages', 'superapp/pages', 'packages/components']

function walkDir(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!/^(node_modules|dist|\.)/.test(e.name)) walkDir(p, acc)
      continue
    }
    if (e.name.endsWith('.vue')) acc.push(p)
  }
  return acc
}

/* ────────────────────────── 归一化（两路 → 同一对账面） ────────────────────────── */

function isLen(v) {
  return v !== null && typeof v === 'object' && typeof v.kind === 'string'
}

/** ★颜色归一（两路统一形态——旧通路保留短 hex `#888`，CSE 归一为 `#888888`；语义等价） */
function normColor(v) {
  if (typeof v !== 'string' || !v.startsWith('#')) return v
  const h = v.slice(1).toLowerCase()
  if (h.length === 3) return '#' + h.split('').map((c) => c + c).join('')
  if (h.length === 4) return '#' + h.split('').map((c) => c + c).join('')
  return '#' + h
}

/** 旧通路 → 归一形态 */
function normalizeOld(style) {
  const out = {}
  for (const [k, v] of Object.entries(style ?? {})) {
    if (v === undefined || v === null) continue
    if (k === 'margin' || k === 'padding') {
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const sv = v[side]
        if (typeof sv === 'number') out[`${k}${side[0].toUpperCase()}${side.slice(1)}`] = sv
      }
      continue
    }
    if (/Ratio$/.test(k) && typeof v === 'number') {
      out[k] = { ratio: v, axis: k.includes('Width') || k.startsWith('width') ? 'w' : 'h' }
      continue
    }
    if (/Pct$/.test(k) && typeof v === 'number') {
      out[k] = { ratio: v, axis: k.includes('Width') ? 'w' : 'h' }
      continue
    }
    if (k === 'lineHeight') {
      out['lineHeight'] = v
      continue
    }
    out[k] = /color/i.test(k) || k === 'color' || k === 'backgroundColor' ? normColor(v) : v
  }
  return out
}

/** CSE → 归一形态（与 normalizeOld 同面；`oldStyle` 提供旧侧 fontSize 供 lineHeight 折算） */
function normalizeCse(fields, oldStyle) {
  const out = {}
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (v === undefined || v === null) continue
    if (isLen(v)) {
      if (v.kind === 'absolute') {
        out[k] = v.dp
        continue
      }
      if (v.kind === 'ratio') {
        // 0% ≡ 0px（语义等价——旧通路对 `flex-basis: 0%` 出 0，CSE 出 ratio 0）
        if (v.ratio === 0) {
          out[k] = 0
          continue
        }
        const axis = v.base === 'parentWidth' || v.base === 'viewportWidth' ? 'w' : 'h'
        if (k === 'width') { out['widthRatio'] = { ratio: v.ratio, axis: 'w' }; continue }
        if (k === 'height') { out['heightRatio'] = { ratio: v.ratio, axis: 'h' }; continue }
        if (k === 'minWidth') out['minWidthPct'] = { ratio: v.ratio, axis }
        else if (k === 'maxWidth') out['maxWidthPct'] = { ratio: v.ratio, axis }
        else if (k === 'minHeight') out['minHeightPct'] = { ratio: v.ratio, axis }
        else if (k === 'maxHeight') out['maxHeightPct'] = { ratio: v.ratio, axis }
        else out[k] = { ratio: v.ratio, axis }
        continue
      }
      if (v.kind === 'auto') {
        if (k.startsWith('margin')) {
          const ma = out['marginAuto'] ?? (out['marginAuto'] = {})
          ma[k.slice('margin'.length).toLowerCase()] = true
          continue
        }
        out[k] = 'auto'
        continue
      }
    }
    if (k === 'lineHeight') {
      if (typeof v === 'number') {
        const fs0 = typeof oldStyle?.fontSize === 'number' ? oldStyle.fontSize : undefined
        if (fs0 !== undefined && fs0 > 0) {
          out['lineHeight'] = String(Math.round((v / fs0) * 10000) / 10000)
          continue
        }
        out['lineHeight'] = `${v}px`
        continue
      }
      out['lineHeight'] = v
      continue
    }
    // pointer-events：CSE 出 'none'/'auto'（CSS 值），旧通路出 boolean ⇒ 归一到 boolean（App 引擎形态）
    if (k === 'pointerEvents') {
      out[k] = v === 'none' ? false : v === 'auto' ? true : v
      continue
    }
    out[k] = /color/i.test(k) || k === 'color' || k === 'backgroundColor' ? normColor(v) : v
  }
  // gap 折叠（rowGap==columnGap ⇒ 单 gap；不同值保留两轴 ⇒ 会被如实列为 cse-only）
  if (out['rowGap'] !== undefined && out['columnGap'] !== undefined && out['rowGap'] === out['columnGap']) {
    out['gap'] = out['rowGap']
    delete out['rowGap']
    delete out['columnGap']
  }
  return out
}

/* ────────────────────────── 树形感知对齐 ────────────────────────── */

/** 双指针配对两段子节点序列（旧侧合成叶 `p-text` 跳过）；返回 pairs + unaligned 计数 */
function alignChildren(oldKids, cseKids) {
  const pairs = []
  let unaligned = 0
  let i = 0
  let j = 0
  while (i < oldKids.length && j < cseKids.length) {
    const o = oldKids[i]
    const c = cseKids[j]
    if (o.tag === c.tag) {
      pairs.push([i, j])
      i++
      j++
      continue
    }
    if (o.tag === 'p-text' && c.tag !== 'p-text') {
      i++
      unaligned++
      continue
    }
    if (c.tag === 'p-text' && o.tag !== 'p-text') {
      j++
      unaligned++
      continue
    }
    // 其余错位：向前最多 3 个内找可对齐者（容错）；找不到 ⇒ 各自跳过并计数
    let matched = false
    for (let look = 1; look <= 3 && !matched; look++) {
      if (oldKids[i + look]?.tag === c.tag) {
        unaligned += look
        i += look
        pairs.push([i, j])
        i++
        j++
        matched = true
      } else if (cseKids[j + look]?.tag === o.tag) {
        unaligned += look
        j += look
        pairs.push([i, j])
        i++
        j++
        matched = true
      }
    }
    if (!matched) {
      unaligned += 2
      i++
      j++
    }
  }
  unaligned += oldKids.length - i + (cseKids.length - j)
  return { pairs, unaligned }
}

/* ────────────────────────── 对账主循环 ────────────────────────── */

const FILES = FILE ? [path.resolve(FILE)] : WALK_ROOTS.flatMap((d) => walkDir(path.join(ROOT, d)))
const report = {
  generatedAt: new Date().toISOString(),
  note: 'App 端 IR 切换的影子对账（旧折叠通路 vs CSE）——「只对账不切换」（plan §2.2）',
  files: [],
  summary: { files: 0, alignedNodes: 0, unaligned: 0, match: 0, mismatch: 0, oldOnly: 0, cseOnly: 0, skipped: 0 },
}
const mismatchByField = {}
const mismatchSamples = {}
const mismatchByCategory = {}

/**
 * ★差异分类（决策就绪——切换批次按类处理，而不是逐条猜）：
 *   · `rpx-semantics`：旧通路 `rpx/2`（固定 375 设计宽）vs CSE **视口比例**（750rpx=视口宽）——
 *     **CSE 是 Web 对齐语义**（CSS 的 rpx 定义 = 视口比例）；切换即修掉固定设计宽的 4% 漂移（390 宽设备）
 *   · `app-adaptation`：旧通路为 App 内核做的**有意适配**（如 `position:fixed→absolute`——内核无 fixed）——
 *     切换时该适配必须**搬到 applier**（不得丢）
 *   · `cascade-difference`：两路层叠结果不同（CSE 有完整五级层叠含 id/伪类）——**CSE 是正确方**
 *   · `other`：其余（需逐案归因）
 */
function classifyMismatch(field, a, b) {
  // ★rpx 语义差：比值 = 视口宽/375（本例 1.04 = 390/375）——两侧数值（含 lineHeight 的因子字符串）
  const ratioOf = (x) => (typeof x === 'number' ? x : typeof x === 'string' && /^[\d.]+$/.test(x) ? Number(x) : undefined)
  const na = ratioOf(a)
  const nb = ratioOf(b)
  if (na !== undefined && nb !== undefined && na !== 0 && Math.abs(nb / na - 1.04) < 0.0001) return 'rpx-semantics'
  // ★App 适配（旧通路为内核做的有意转换——切换时必须搬 applier，不得丢）：
  //   · position: fixed → absolute（内核无 fixed）
  //   · fontFamily：完整字体栈 → 字体角色（App 端只认角色——见批次 36）
  if (field === 'position' && a === 'absolute' && b === 'fixed') return 'app-adaptation'
  if (field === 'fontFamily' && !String(a).includes(',') && String(b).includes(',')) return 'app-adaptation'
  // ★形态差（两路值语义相同、表达不同——对账器应补归一化）：
  //   · borderRadiusPct：旧 {ratio,axis} vs CSE 数
  //   · gridColumn/gridRow：旧 {start,end} vs CSE "1 / -1"
  if (typeof a === 'object' && a !== null && typeof b === 'number' && field.endsWith('Pct')) return 'normalization-gap'
  if (field === 'gridColumn' || field === 'gridRow') return 'normalization-gap'
  if (/color/i.test(field)) return 'cascade-difference'
  return 'other'
}

function compareTree(oldNode, cseNode, ctx) {
  const A = normalizeOld(oldNode.style)
  const B = normalizeCse(cseNode.__fields ?? cseNode.fields, oldNode.style)
  const keys = new Set([...Object.keys(A), ...Object.keys(B)])
  const match = []
  const mismatch = []
  const oldOnly = []
  const cseOnly = []
  for (const k of keys) {
    const a = A[k]
    const b = B[k]
    if (a === undefined) { cseOnly.push(k); continue }
    if (b === undefined) { oldOnly.push(k); continue }
    if (JSON.stringify(a) === JSON.stringify(b)) match.push(k)
    else {
      const cat = classifyMismatch(k, a, b)
      mismatch.push({ field: k, old: a, cse: b, category: cat })
      mismatchByField[k] = (mismatchByField[k] ?? 0) + 1
      mismatchByCategory[cat] = (mismatchByCategory[cat] ?? 0) + 1
      if (!mismatchSamples[k]) mismatchSamples[k] = { file: ctx.file, id: oldNode.id, old: a, cse: b, category: cat }
    }
  }
  ctx.report.summary.alignedNodes++
  ctx.report.summary.match += match.length
  ctx.report.summary.mismatch += mismatch.length
  ctx.report.summary.oldOnly += oldOnly.length
  ctx.report.summary.cseOnly += cseOnly.length
  if (match.length + mismatch.length + oldOnly.length + cseOnly.length > 0) {
    ctx.fileReport.nodes.push({ id: oldNode.id, tag: oldNode.tag, match, mismatch, oldOnly, cseOnly })
  }
  const oldKids = (oldNode.children ?? []).filter((k) => k.tag !== 'p-text')
  const cseKids = cseNode.children ?? []
  const { pairs, unaligned } = alignChildren(oldKids, cseKids)
  ctx.report.summary.unaligned += unaligned
  for (const [oi, ci] of pairs) compareTree(oldKids[oi], cseKids[ci], ctx)
}

for (const file of FILES) {
  const rel = path.relative(ROOT, file)
  let src
  try {
    src = fs.readFileSync(file, 'utf-8')
  } catch { continue }
  let oldRoot
  let cseRoot
  try {
    const tpl = buildLayoutTemplate(src, rel).template
    // ★旧通路是**扁平 nodes**（无 children 字段——见 LayoutNode 契约）⇒ 按 parentId 建 children 索引；
    //   合成叶（p-text）在此**就过滤掉**（对齐已在 compareTree 内再做一次兜底）
    const kidsOf = new Map()
    for (const n of tpl.nodes) {
      const pid = n.parentId ?? null
      if (!kidsOf.has(pid)) kidsOf.set(pid, [])
      kidsOf.get(pid).push(n)
    }
    const withKids = (n) => ({
      id: n.id,
      tag: n.tag,
      style: n.style,
      children: (kidsOf.get(n.id) ?? []).filter((k) => k.tag !== 'p-text').map(withKids),
    })
    const flatRoot = tpl.nodes.find((n) => n.parentId === null)
    oldRoot = flatRoot ? withKids(flatRoot) : undefined
    const ex = extractFromSfc(src)
    const cse = computeTree(ex.roots, ex.sheet, { inlineStyles: ex.inlineStyles })
    cseRoot = ex.roots[0]
    // 深度挂 fields（byKey 已有）
    const attach = (n) => { n.__fields = cse.byKey[n.key]?.fields ?? {}; for (const c of n.children) attach(c) }
    attach(cseRoot)
  } catch {
    report.summary.skipped++
    continue
  }
  if (!oldRoot || !cseRoot) continue
  const fileReport = { file: rel, nodes: [] }
  const ctx = { report, fileReport, file: rel }
  compareTree(oldRoot, cseRoot, ctx)
  if (fileReport.nodes.length > 0) report.files.push(fileReport)
  report.summary.files++
}

report.mismatchByField = Object.fromEntries(Object.entries(mismatchByField).sort((a, b) => b[1] - a[1]))
report.mismatchSamples = mismatchSamples
report.mismatchByCategory = Object.fromEntries(Object.entries(mismatchByCategory).sort((a, b) => b[1] - a[1]))

/* ────────────────────────── 输出 ────────────────────────── */
if (WRITE) {
  const outPath = path.join(ROOT, 'docs/generated/app-ir-shadow.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
  if (!JSON_OUT) console.log(`[app-ir-shadow] ✅ 已写 ${path.relative(ROOT, outPath)}`)
}
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const s = report.summary
  console.log('App 端 IR 切换 · 影子对账（旧折叠通路 vs CSE · 树形感知对齐）')
  console.log(`  语料 ${s.files} 文件 · 对齐节点 ${s.alignedNodes}（未对齐 ${s.unaligned}）· 跳过 ${s.skipped}`)
  console.log(`  逐字段：一致 ${s.match} · 不同 ${s.mismatch} · 仅旧路 ${s.oldOnly} · 仅 CSE ${s.cseOnly}`)
  if (Object.keys(report.mismatchByField).length > 0) {
    if (report.mismatchByCategory) {
    console.log('  ★差异分类（切换批次的处理单位）：')
    for (const [c2, n2] of Object.entries(report.mismatchByCategory)) console.log(`    ${String(n2).padStart(4)}  ${c2}`)
  }
  console.log('  ★差异字段排行（字段 × 次数 → 样例）：')
    for (const [f, c] of Object.entries(report.mismatchByField).slice(0, 12)) {
      const sample = report.mismatchSamples[f]
      console.log(`    ${String(c).padStart(4)}  ${f.padEnd(18)} 例：旧=${JSON.stringify(sample.old)} cse=${JSON.stringify(sample.cse)}（${path.basename(sample.file)} id=${sample.id}）`)
    }
  }
  console.log('')
  console.log('★诚实边界：只对账不切换（plan §2.2 逐字段批次 + 每批 IR 等价判据兜底）。')
}
