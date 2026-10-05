#!/usr/bin/env node
// scripts/check-baseline-freshness.mjs —— ★★★G-61 B5：**基准腐化检测**（plan §6 第 3 行 · **非门禁**）
//
// 【它做什么】用**活体 Web 重采集**与入仓基准比对，回答一个问题：
//   「基准还成立吗」——成立（一致）/ 腐化了（指纹一致但值变了 ⇒ 告警）/ 环境漂移
//   （指纹不一致 ⇒ **先归因环境，不告警**——D3：指纹变化即基准变更，不是腐化）。
//
// 【为什么非门禁（plan 明示）】基准腐化需要**真浏览器 + 活体重采集**：
//   · 在 CI 共享 runner 上浏览器版本会变（指纹天然不一致 ⇒ 天天"换环境"，告警无意义）
//   · 腐化是**缓慢过程**，不需要每次提交都拦（拦了会变成"改浏览器就红"的噪音门禁）
//   ⇒ 定期跑（本地/计划任务），输出结论给人；**退出码恒 0**（除非自身出错）。
//
// 【判据（三段）】
//   ① 读入仓 manifest（`docs/generated/style-baseline/manifest.json`）
//   ② 跑采集器到**临时目录**（不覆盖入仓基准！——`PROTEUS_BASELINE_OUT=<tmp>`）
//   ③ 比对：
//      · 指纹不一致（浏览器版本/DPR/视口/主题）⇒ **环境漂移**（不告警，列出差异）
//      · 指纹一致 + 值不同 ⇒ **基准腐化**（告警，给出差异项）
//      · 指纹一致 + 值相同 ⇒ 基准新鲜
//
// 用法：node scripts/check-baseline-freshness.mjs [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'docs/generated/style-baseline')
const MANIFEST = path.join(BASELINE, 'manifest.json')
const JSON_OUT = process.argv.includes('--json')

function fail(msg) {
  console.error(`[baseline-freshness] ✗ ${msg}`)
  process.exit(2) // 2 = 检测器自身出错（不是"腐化"结论）
}

if (!fs.existsSync(MANIFEST)) fail(`缺基准清单 ${path.relative(ROOT, MANIFEST)}（先跑采集器 + 清单生成器）`)

/* ① 入仓基准 */
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'))
const storedFp = manifest.fingerprint
if (!storedFp?.browser) fail('清单缺环境指纹（D3）')

/* ② 活体重采集到临时目录（★不覆盖入仓基准——只读纪律） */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-baseline-freshness-'))
let fresh = null
try {
  execFileSync(process.execPath, ['scripts/collect-style-baseline.mjs'], {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, PROTEUS_BASELINE_OUT: tmp },
    timeout: 180_000,
  })
  const freshPath = path.join(tmp, 'superapp-mine.computed.json')
  if (!fs.existsSync(freshPath)) fail('活体采集未产出样本（采集器失败或不支持 PROTEUS_BASELINE_OUT）')
  fresh = JSON.parse(fs.readFileSync(freshPath, 'utf-8'))
} catch (e) {
  fs.rmSync(tmp, { recursive: true, force: true })
  fail(`活体采集失败：${String(e?.message ?? e).slice(0, 200)}（本检测需要真 Chromium）`)
}
fs.rmSync(tmp, { recursive: true, force: true })

/* ③ 比对（先指纹，后值） */
const freshFp = fresh.env ?? {}
const fpDiffs = []
if (storedFp.browser !== freshFp.browser) fpDiffs.push(`browser: ${storedFp.browser} → ${freshFp.browser}`)
if (String(storedFp.dpr) !== String(freshFp.dpr)) fpDiffs.push(`dpr: ${storedFp.dpr} → ${freshFp.dpr}`)
if (storedFp.viewport !== `${freshFp.viewport?.width}x${freshFp.viewport?.height}`) {
  fpDiffs.push(`viewport: ${storedFp.viewport} → ${freshFp.viewport?.width}x${freshFp.viewport?.height}`)
}
if (storedFp.theme !== freshFp.theme) fpDiffs.push(`theme: ${storedFp.theme} → ${freshFp.theme}`)

const stored = JSON.parse(fs.readFileSync(path.join(BASELINE, 'superapp-mine.computed.json'), 'utf-8'))
const valueDiffs = []
for (const [id, node] of Object.entries(stored.nodes ?? {})) {
  const freshNode = fresh.nodes?.[id]
  if (!freshNode) {
    valueDiffs.push(`${id}: 活体缺该节点`)
    continue
  }
  for (const [prop, val] of Object.entries(node.computed ?? {})) {
    const fv = freshNode.computed?.[prop]
    if (fv !== val) valueDiffs.push(`${id} · ${prop}: 入仓 ${JSON.stringify(val)} → 活体 ${JSON.stringify(fv)}`)
  }
}

const verdict =
  fpDiffs.length > 0 ? 'environment-drift' : valueDiffs.length > 0 ? 'baseline-rot' : 'fresh'
const report = {
  verdict,
  fingerprintDiffs: fpDiffs,
  valueDiffs: valueDiffs.slice(0, 20),
  valueDiffCount: valueDiffs.length,
  note:
    verdict === 'fresh'
      ? '基准新鲜（同指纹同值——D2 冻结成立）'
      : verdict === 'environment-drift'
        ? '环境漂移（指纹变化——按 D3 属"基准变更"须审批，**不是腐化**；告警抑制）'
        : '★基准确认腐化（指纹一致而值变了——基准样本需重采并走审批）',
}
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('基准腐化检测（G-61 B5 · 非门禁）')
  console.log(`  入仓指纹：${storedFp.browser} · DPR ${storedFp.dpr} · ${storedFp.viewport} · ${storedFp.theme}`)
  console.log(`  活体指纹：${freshFp.browser} · DPR ${freshFp.dpr} · ${freshFp.viewport?.width}x${freshFp.viewport?.height} · ${freshFp.theme}`)
  console.log('')
  if (verdict === 'fresh') {
    console.log('✅ 基准新鲜（同指纹同值）')
  } else if (verdict === 'environment-drift') {
    console.log(`⚠ 环境漂移（${fpDiffs.length} 项）——不属于基准腐化（D3：指纹变化 = 基准变更，须审批）`)
    for (const d of fpDiffs) console.log(`    - ${d}`)
  } else {
    console.log(`★ 基准腐化告警：指纹一致但 ${valueDiffs.length} 项值变了`)
    for (const d of valueDiffs.slice(0, 10)) console.log(`    - ${d}`)
    console.log('  ⇒ 基准样本已不可信：重采（collect-style-baseline.mjs）+ 清单 --update + 提交信息写批准人与原因')
  }
}
// ★非门禁：结论不影响退出码（plan §6 明示；只有检测器自身出错才 exit 2）
process.exit(0)
