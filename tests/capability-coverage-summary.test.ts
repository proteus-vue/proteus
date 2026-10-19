// tests/capability-coverage-summary.test.ts
// ★★★决策 #1089（2026-10-19）：能力总览的「全端兼容进度」汇总判据。
//
// 【为什么（用户需求）】「能力总览建议增加整体端兼容进度吗？本意是让开发者一目了然目前全端能力兼容范围」。
//   ⇒ 总览页顶部加两张表：① 端 → ✅/⚠️/🟡/⬜ 计数 + 覆盖率；② 类别 × 端 的 ✅/总数 矩阵。
//
// 【★本判据要防的核心风险：汇总与逐页表"各算一遍"→ 必然漂移】
//   逐页的「兼容进度」表原本是 `gen-content.mjs` 里两段内联 switch 算的（zh 一份、en 一份）；
//   若总览再写第三份，就会出现"总览说 iOS 30、点进去逐页加起来 28"这类自相矛盾——
//   正是 #1088 刚清掉的"同一事实写两遍"。
//   ⇒ #1089 把判定抽成 `lib/cap-end-status.mjs` 的 `capabilityEndStatuses()`，
//     页面表与总览汇总**调用同一个函数**；本测试再从**产物文本**上反向验证两者确实一致。
//
// 【判据】
//   ① 总览有汇总表，且八端齐全、四档计数之和 = 能力总数、覆盖率 = round(✅/总数×100)；
//   ② **交叉校验**：总览每一端的四档计数 == 各能力页兼容表逐行标记的计数（逐端逐档全等）；
//   ③ 类别矩阵每行的分母 = 该类别能力数，分子 ≤ 分母；
//   ④ 中英两版汇总表**数字完全相同**（同一份判定 ⇒ 不可能只改一边）；
//   ⑤ 判定实现唯一：`gen-content.mjs` 不得再内联 App 端 switch（`case 'app-ios':` 只许出现在 lib）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR_ZH = path.join(ROOT, 'website/content/capabilities')
const DIR_EN = path.join(ROOT, 'website/en/capabilities')

/** 从一张兼容表文本段里按端统计四档 */
function tallyCompatRows(seg: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const line of seg.split('\n')) {
    const cells = line.split('|').map((s) => s.trim())
    if (cells.length < 4 || !cells[1] || cells[1] === '端' || cells[1] === 'Target') continue
    const [, name, mark] = cells
    out[name] ??= { ok: 0, degrade: 0, unwired: 0, planned: 0 }
    if (mark === '✅') out[name].ok++
    else if (mark === '⚠️') out[name].degrade++
    else if (mark === '🟡') out[name].unwired++
    else out[name].planned++
  }
  return out
}

/** 各能力页（排除总览）逐页兼容表汇总 */
function pageTally(dir: string): Record<string, Record<string, number>> {
  const total: Record<string, Record<string, number>> = {}
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md') || f.startsWith('00-')) continue
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const i = src.search(/^##\s+(兼容进度|Compatibility)/m)
    if (i < 0) continue
    const header = src.indexOf('|---', i)
    if (header < 0) continue
    const end = src.indexOf('\n\n', header)
    const seg = src.slice(i, end < 0 ? src.length : end)
    for (const [name, c] of Object.entries(tallyCompatRows(seg))) {
      total[name] ??= { ok: 0, degrade: 0, unwired: 0, planned: 0 }
      for (const k of ['ok', 'degrade', 'unwired', 'planned']) total[name][k] += c[k]
    }
  }
  return total
}

/** 从总览页取汇总表（Target | ✅ | ⚠️ | 🟡 | ⬜ | Coverage） */
function overviewTally(file: string): { rows: Record<string, number[]>, coverageCol: number[] } {
  const src = fs.readFileSync(file, 'utf8')
  const i = src.search(/^##\s+(全端兼容进度|All-target compatibility)/m)
  if (i < 0) return { rows: {}, coverageCol: [] }
  const start = src.indexOf('|---', i)
  const stop = src.indexOf('\n\n', start)
  const rows: Record<string, number[]> = {}
  const coverageCol: number[] = []
  for (const line of src.slice(start, stop < 0 ? src.length : stop).split('\n')) {
    const cells = line.split('|').map((s) => s.trim())
    if (cells.length < 8) continue
    if (!/^\d+$/.test(cells[2])) continue
    rows[cells[1]] = [+cells[2], +cells[3], +cells[4], +cells[5]]
    coverageCol.push(parseInt(cells[6], 10))
  }
  return { rows, coverageCol }
}

/** 类别矩阵（类别 | 端…） */
function catMatrix(file: string): { rows: Array<{ cat: string, cells: string[] }> } {
  const src = fs.readFileSync(file, 'utf8')
  const i = src.search(/^###\s+(按类别|By category)/m)
  if (i < 0) return { rows: [] }
  const start = src.indexOf('|---', i)
  const stop = src.indexOf('\n\n', start)
  const rows = []
  for (const line of src.slice(start, stop < 0 ? src.length : stop).split('\n')) {
    const cells = line.split('|').map((s) => s.trim())
    if (cells.length < 3 || !/^\d+\/\d+$/.test(cells[2])) continue
    rows.push({ cat: cells[1], cells: cells.slice(2, -1) })
  }
  return { rows }
}

const OV_ZH = path.join(DIR_ZH, '00-capabilities-overview.md')
const OV_EN = path.join(DIR_EN, '00-capabilities-overview.md')

describe('★#1089 ① 总览汇总表结构完整', () => {
  it('八端齐全，四档之和 = 能力总数', () => {
    const { rows } = overviewTally(OV_ZH)
    expect(Object.keys(rows).length, '汇总表端数不对').toBe(8)
    for (const [name, v] of Object.entries(rows)) {
      expect(v.reduce((a, b) => a + b, 0), `${name} 四档之和 ≠ 84`).toBe(84)
    }
  })
  it('覆盖率 = round(✅ / 总数 × 100)', () => {
    const { rows, coverageCol } = overviewTally(OV_ZH)
    const names = Object.keys(rows)
    names.forEach((name, i) => {
      const expectPct = Math.round((rows[name][0] / 84) * 100)
      expect(coverageCol[i], `${name} 覆盖率算错`).toBe(expectPct)
    })
  })
})

describe('★#1089 ② 汇总与逐页表交叉一致（核心判据）', () => {
  it('每一端的四档计数 == 各能力页兼容表逐行标记计数', () => {
    const ov = overviewTally(OV_ZH).rows
    const pages = pageTally(DIR_ZH)
    const bad: string[] = []
    for (const [name, v] of Object.entries(ov)) {
      const p = pages[name]
      if (!p) { bad.push(`${name}: 逐页表缺该端`); continue }
      const same = v[0] === p.ok && v[1] === p.degrade && v[2] === p.unwired && v[3] === p.planned
      if (!same) bad.push(`${name}: 总览 ${v.join('/')} vs 逐页 ${[p.ok, p.degrade, p.unwired, p.planned].join('/')}`)
    }
    expect(bad, `总览汇总与逐页兼容表不一致（说明判定不是同一份）：\n${bad.join('\n')}`).toEqual([])
  })
})

describe('★#1089 ③ 类别矩阵自洽', () => {
  it('每格 ✅ ≤ 分母，且分母 = 该类别能力数', () => {
    const { rows } = catMatrix(OV_ZH)
    expect(rows.length, '类别矩阵为空').toBeGreaterThan(0)
    const bad: string[] = []
    for (const r of rows) {
      for (const cell of r.cells) {
        const [ok, total] = cell.split('/').map(Number)
        if (!(ok <= total)) bad.push(`${r.cat}: ${cell} 的分子大于分母`)
      }
      const denoms = new Set(r.cells.map((c) => c.split('/')[1]))
      if (denoms.size !== 1) bad.push(`${r.cat}: 各端分母不一致（${[...denoms].join(',')}）`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
})

describe('★#1089 ④ 中英汇总数字完全一致', () => {
  it('同端同档的中英数字逐格相同（同一份判定）', () => {
    const zh = overviewTally(OV_ZH)
    const en = overviewTally(OV_EN)
    const zhVals = Object.values(zh.rows)
    const enVals = Object.values(en.rows)
    expect(enVals.length, '英文总览缺汇总表').toBe(zhVals.length)
    expect(enVals).toEqual(zhVals)
    expect(en.coverageCol).toEqual(zh.coverageCol)
  })
  it('类别矩阵中英数字一致', () => {
    const zh = catMatrix(OV_ZH)
    const en = catMatrix(OV_EN)
    expect(en.rows.map((r) => r.cells)).toEqual(zh.rows.map((r) => r.cells))
  })
})

describe('★#1089 ⑤ 判定实现唯一（防第三份内联 switch）', () => {
  it('生成器里不再内联 App 端分档 switch', () => {
    const gen = fs.readFileSync(path.join(ROOT, 'website/scripts/gen-content.mjs'), 'utf8')
    expect(gen.includes("case 'app-ios':"), '生成器仍在内联 App 端判定——应只保留在 lib/cap-end-status.mjs').toBe(false)
    expect(gen.includes('capabilityEndStatuses('), '生成器未使用共享判定').toBe(true)
  })
})
