#!/usr/bin/env node
// scripts/check-vapor-capability.mjs —— ★★★**Vapor 能力缺口棘轮门禁**（P4 能力视图，2026-10-03）
//
// 【为什么需要（本仓实测的静默缺陷链）】`explain --vapor` 此前只读**订阅表侧**诊断，
//   而**模板侧**诊断（v-html / 自定义指令 / 内置组件边界 / 动态组件…——**绝大多数能力缺口
//   产生在那里**）**一条都不显示** ⇒ 用户自查"槽位分层全绿"就以为没事。
//   ⇒ 本批修了这个"诊断工具吞诊断"，并把它**接上门禁**：能力缺口从此**可机器判定**。
//
// 【判据（两条，都落在可复算的量上）】
//   ① **逐页面零 error 级缺口**（error = "会静默出错"，如无 :key 的 v-for）——**零容忍**；
//   ② **按 code 的缺口计数棘轮**：与基线（`scripts/vapor-capability-baseline.json`）比，
//      **只减不增**（同 `no-blind-wait-baseline` 的手法：存量钉死、改善落账）。
//      ★为什么是棘轮而不是"全清零"：缺口里混着两类——
//        · **已说明的边界**（如 v-model 无回写：诊断明确 + 给替代路径）——它们是**如实标注**，
//          不是缺陷；清不掉是坦率，不是欠账；
//        · 真正的欠账（如某类诊断缺失）——棘轮保证它只减不增。
//   ⇒ 新增缺口当场红；改好一批 ⇒ `--update` 重新落账（**只允许降**，脚本会拦住"偷偷调高"）。
//
// 用法：node scripts/check-vapor-capability.mjs [--update]
//   --update = 重新生成基线（**只允许比旧基线更小**；变大 ⇒ 拒绝并报明细）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BASELINE = path.join(HERE, 'vapor-capability-baseline.json')
/** 扫描范围：真实样例页面（**用户视角的 SFC**——与六端 stress 同源的那批） */
const PAGES_DIR = path.join(ROOT, 'examples/pages')
const UPDATE = process.argv.includes('--update')

/** 用 tsx 跑 analyzeVaporGaps（与 `proteus explain --vapor --json` **同一个实现**——"一处实现"） */
function scanAll() {
  const script = `
import fs from 'node:fs'
import path from 'node:path'
import { analyzeVaporGaps } from ${JSON.stringify(path.join(ROOT, 'packages/cli/src/explain.ts'))}
const dir = ${JSON.stringify(PAGES_DIR)}
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.vue')).sort()
const out = { pages: [], errors: [], counts: {} }
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf-8')
  let g
  try { g = analyzeVaporGaps(src) } catch (e) {
    out.errors.push(f + ': ' + String(e).slice(0, 120))
    continue
  }
  out.pages.push({ file: f, supported: g.supported, errorCount: g.errorCount, warnCount: g.warnCount })
  for (const c of g.byCode) out.counts[c.code] = (out.counts[c.code] ?? 0) + c.count
  for (const d of g.diagnostics) if (d.severity === 'error') out.errors.push(f + ' [' + d.code + '] ' + d.message.slice(0, 100))
}
process.stdout.write(JSON.stringify(out))
`
  const json = execFileSync('npx', ['tsx', '--eval', script], { cwd: ROOT, encoding: 'utf-8', timeout: 300000 })
  return JSON.parse(json)
}

function main() {
  console.log('═══ Vapor 能力缺口棘轮（P4 能力视图 · 诊断工具不再吞诊断）═══')
  let scan
  try {
    scan = scanAll()
  } catch (e) {
    console.error(`✗ 扫描失败（tsx 求值）：${String(e).slice(0, 300)}`)
    process.exit(2)
  }
  console.log(`  扫描 ${scan.pages.length} 个样例页面（examples/pages/*.vue）`)
  const zero = scan.pages.filter((p) => p.supported).length
  console.log(`  零缺口 ${zero} / 有缺口 ${scan.pages.length - zero}`)

  // ── ① error 级缺口零容忍 ──
  if (scan.errors.length > 0) {
    console.log('')
    console.log(`  ✗ error 级缺口 ${scan.errors.length} 处（会**静默出错**——零容忍）：`)
    for (const e of scan.errors.slice(0, 20)) console.log(`      ${e}`)
    console.log('      ⇒ 先修这些（error 级 = "不报错但结果错"，本仓最忌的一类）')
    return 1
  }
  console.log('  ✓ error 级缺口：0（无"静默出错"类问题）')

  // ── ② 按 code 的棘轮 ──
  const counts = scan.counts
  const sorted = Object.fromEntries(Object.entries(counts).sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  if (UPDATE) {
    // ★只允许降（防"偷偷调高"把棘轮变成橡皮图章）
    if (fs.existsSync(BASELINE)) {
      const old = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'))
      const worse = Object.keys(sorted).filter((k) => (old.counts?.[k] ?? 0) < sorted[k])
      if (worse.length > 0) {
        console.error('')
        console.error('✗ 拒绝 update：以下缺口**比基线更多**（棘轮只减不增）：')
        for (const k of worse) console.error(`    ${k}: ${old.counts?.[k] ?? 0} → ${sorted[k]}`)
        console.error('  ⇒ 先修掉新增缺口，或确认是"新增了如实诊断"（那说明基线该重定，请人工评审后改文件）')
        return 1
      }
    }
    fs.writeFileSync(
      BASELINE,
      JSON.stringify({ scannedPages: scan.pages.length, counts: sorted, note: '棘轮：只减不增（--update 只允许更小）' }, null, 2) + '\n',
    )
    console.log(`  ✅ 基线已更新（${Object.keys(sorted).length} 类 · 共 ${Object.values(sorted).reduce((a, b) => a + b, 0)} 条）`)
    return 0
  }
  if (!fs.existsSync(BASELINE)) {
    console.error(`✗ 缺基线 ${path.relative(ROOT, BASELINE)}——先跑 --update 生成（首次）`)
    return 1
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'))
  const baseCounts = base.counts ?? {}
  const grown = Object.keys(sorted).filter((k) => (baseCounts[k] ?? 0) < sorted[k])
  const shrunk = Object.keys(baseCounts).filter((k) => (baseCounts[k] ?? 0) > (counts[k] ?? 0))
  if (grown.length > 0) {
    console.log('')
    console.log(`  ✗ 缺口**增长**（${grown.length} 类——新增诊断缺口或回归）：`)
    for (const k of grown) console.log(`      ${k}: ${baseCounts[k] ?? 0} → ${sorted[k]}`)
    console.log('  ⇒ 修掉新增；若确为"新增了如实诊断"，请人工评审后跑 --update 落账')
    return 1
  }
  const total = Object.values(sorted).reduce((a, b) => a + b, 0)
  const baseTotal = Object.values(baseCounts).reduce((a, b) => a + b, 0)
  console.log(`  ✓ 缺口棘轮：${total} 条（基线 ${baseTotal}）· ${Object.keys(sorted).length} 类（明细：${Object.keys(sorted).join(', ')}）`)
  if (shrunk.length > 0) {
    console.log(`  ⓘ 已改善（可 --update 落账）：${shrunk.map((k) => `${k} ${baseCounts[k]}→${counts[k] ?? 0}`).join(' · ')}`)
  }
  console.log('')
  console.log('✅ Vapor 能力缺口：无 error 级 · 存量不增长（棘轮生效）')
  return 0
}

process.exit(main())
