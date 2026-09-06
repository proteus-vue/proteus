// website/scripts/check-en-drift.mjs
// ★#493 双语对齐门禁：EN overlay 与 zh 原文的「结构签名」逐文件比对——漂移即 CI 红。
//   背景：EN overlay（en/<分区>/<slug>.md）靠人工同步，#492 zh 改了配置文档而 EN 漏更，
//   无任何门禁变红（check:alltarget 只查句式，不查结构）——本门禁堵住这个口子。
//   比对维度（语言无关的结构量，不比译文）：
//     ① 标题层级计数（## / ### / ####）
//     ② 代码围栏数（``` 成对）
//     ③ 逐表签名（按出现顺序：表头列数 × 数据行数）——新增字段行/漏翻表格必被抓住
//   白名单：翻译时差豁免，逐条登记 file + check + reason；白名单项失效（不再漂移）→ 提示回收。
//   产物勿手改（capabilities/components 等 gen-* 生成对天然结构等价，本门禁同时作生成器回归探针）。
//   用法：node website/scripts/check-en-drift.mjs（漂移 exit 1）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEBSITE = path.join(ROOT, 'website')

/** 八个双语分区：zh 目录 → en 目录（slug 一一对应） */
const SECTIONS = [
  ['guides', 'guides'],
  ['framework', 'framework'],
  ['content/components', 'components'],
  ['content/capabilities', 'capabilities'],
  ['content/system', 'system'],
  ['content/plugins', 'plugins'],
  ['content/reference', 'reference'],
  ['content/primitives', 'primitives'],
]

/**
 * 双语结构白名单（诚实清单）：key = <分区>/<slug>，value = { reason, allow: [checkKey] }
 * checkKey 形态：`headings` / `fences` / `table:<序号>`（序号 = 文件内第 N 张表，1 起）。
 * 白名单项不再漂移时门禁输出回收提示（豁免登记要有生命周期，防永久挂账）。
 */
const WHITELIST = {
  // 示例（勿删格式参考）：
  // 'guides/16-router.md': { reason: 'EN 滞后翻译，登记 #xxx 批次补', allow: ['table:2'] },
}

// —— 结构签名提取 ——

/** 提取一份 md 的结构签名 */
function signature(src) {
  const lines = src.split('\n')
  const sig = { headings: { 2: 0, 3: 0, 4: 0 }, fences: 0, tables: [] }
  let inFence = false
  let curTable = null
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (!inFence) sig.fences++
      inFence = !inFence
      continue
    }
    if (inFence) continue // 围栏内的 | 行不是表格、# 行不是标题
    const h = line.match(/^(#{2,4})\s+/)
    if (h) {
      sig.headings[h[1].length]++
      continue
    }
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length
      if (curTable === null) {
        curTable = { cols: cells, rows: 0, sep: false }
      } else if (!curTable.sep && /^[\s:|-]+$/.test(line) && line.includes('-')) {
        curTable.sep = true // 分隔行不计数据行
      } else {
        curTable.rows++
      }
      continue
    }
    if (curTable !== null) {
      sig.tables.push(curTable)
      curTable = null
    }
  }
  if (curTable !== null) sig.tables.push(curTable)
  return sig
}

/** 比对两份签名 → 漂移清单（checkKey 列表） */
function diffSignature(zhSig, enSig) {
  const drifts = []
  for (const level of [2, 3, 4]) {
    if (zhSig.headings[level] !== enSig.headings[level]) {
      drifts.push({ key: 'headings', detail: `h${level}: zh ${zhSig.headings[level]} vs en ${enSig.headings[level]}` })
    }
  }
  if (zhSig.fences !== enSig.fences) {
    drifts.push({ key: 'fences', detail: `fences: zh ${zhSig.fences} vs en ${enSig.fences}` })
  }
  const max = Math.max(zhSig.tables.length, enSig.tables.length)
  for (let i = 0; i < max; i++) {
    const z = zhSig.tables[i]
    const e = enSig.tables[i]
    if (!z || !e) {
      drifts.push({ key: `table:${i + 1}`, detail: `table#${i + 1}: zh ${z ? `${z.cols}列×${z.rows}行` : '缺失'} vs en ${e ? `${e.cols}列×${e.rows}行` : '缺失'}` })
      continue
    }
    if (z.cols !== e.cols || z.rows !== e.rows) {
      drifts.push({ key: `table:${i + 1}`, detail: `table#${i + 1}: zh ${z.cols}列×${z.rows}行 vs en ${e.cols}列×${e.rows}行` })
    }
  }
  return drifts
}

// —— 扫描 ——

const problems = [] // 缺 EN 文件 / 白名单外的漂移
const staleWhitelist = [] // 白名单项不再漂移（提示回收）
let pairs = 0

for (const [zhDir, enDir] of SECTIONS) {
  const zhAbs = path.join(WEBSITE, zhDir)
  const enAbs = path.join(WEBSITE, 'en', enDir)
  if (!fs.existsSync(zhAbs)) continue
  const files = fs.readdirSync(zhAbs).filter((f) => f.endsWith('.md')).sort()
  for (const file of files) {
    pairs++
    const zhSrc = fs.readFileSync(path.join(zhAbs, file), 'utf8')
    const enPath = path.join(enAbs, file)
    const slugKey = `${enDir}/${file.replace(/\.md$/, '')}`
    if (!fs.existsSync(enPath)) {
      problems.push(`${slugKey}: EN 文件缺失（双语站承诺 EN 全覆盖）`)
      continue
    }
    const enSrc = fs.readFileSync(enPath, 'utf8')
    const drifts = diffSignature(signature(zhSrc), signature(enSrc))
    if (!drifts.length) continue
    const wl = WHITELIST[slugKey]
    if (wl) {
      const still = drifts.filter((d) => !wl.allow.includes(d.key))
      if (still.length === 0) {
        staleWhitelist.push(`${slugKey}: 白名单已无对应漂移（登记理由：${wl.reason}）——请回收豁免`)
        continue
      }
      problems.push(`${slugKey}: 白名单仅豁免 [${wl.allow.join(', ')}]，仍有未登记漂移 → ${still.map((d) => d.detail).join('；')}`)
      continue
    }
    problems.push(`${slugKey}: ${drifts.map((d) => d.detail).join('；')}`)
  }
}

// —— 报告 ——

console.log(`[en-drift] 比对 ${pairs} 对文档（8 分区）`)
if (staleWhitelist.length) {
  console.log('[en-drift] ⚠ 白名单回收提示（豁免已无对应漂移）:')
  for (const s of staleWhitelist) console.log(`  - ${s}`)
}
if (problems.length) {
  console.error(`[en-drift] ❌ 双语结构漂移 ${problems.length} 处——EN overlay 需同步（或按格式登记白名单）：`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('[en-drift] 修复：同步 en/<分区>/<slug>.md 的章节/表格/围栏结构与 zh 一致（译文语言不限）')
  process.exit(1)
}
console.log('[en-drift] ✅ 双语结构对齐：全部一致')
