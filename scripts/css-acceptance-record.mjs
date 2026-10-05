#!/usr/bin/env node
// scripts/css-acceptance-record.mjs —— 把**独立子代理的视觉验收结论**登记进验收包
//
// 【为什么单列一个脚本】验收包的机器判据段由 `verify-css-feature.mjs` 产出；
//   `visual` 段由**独立子代理**（按 Web 基准评审并排图）给出——两者来源不同、更新节奏不同。
//   本脚本把子代理结论**原样**写进 `docs/generated/css-acceptance/<id>.json` 的 `visual` 段
//   （不加工、不美化——如实登记），并校验：每端 verdict ∈ {pass, fail, unclear}。
//
// 用法：
//   node scripts/css-acceptance-record.mjs <id> <verdicts.json>
//     verdicts.json = [{end, verdict, caseIssues:[{case,issue,severity}], evidence}]
//   node scripts/css-acceptance-record.mjs <id> --show    # 只看当前登记
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [id, src] = process.argv.slice(2)
if (!id || !src) {
  console.error('用法：node scripts/css-acceptance-record.mjs <id> <verdicts.json>|--show')
  process.exit(2)
}
const pkgFile = path.join(ROOT, 'docs/generated/css-acceptance', `${id}.json`)
if (!fs.existsSync(pkgFile)) {
  console.error(`✗ 缺验收包 ${path.relative(ROOT, pkgFile)}——先跑：pnpm run css:verify ${id}`)
  process.exit(1)
}
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'))

if (src === '--show') {
  console.log(JSON.stringify(pkg.visual ?? null, null, 2))
  process.exit(0)
}

const verdicts = JSON.parse(fs.readFileSync(path.resolve(src), 'utf-8'))
if (!Array.isArray(verdicts) || verdicts.length === 0) {
  console.error('✗ verdicts.json 必须是非空数组')
  process.exit(1)
}
const ENDS = ['web', 'mp', 'android', 'ios', 'harmony']
for (const v of verdicts) {
  if (!ENDS.includes(v.end)) { console.error(`✗ 未知端：${v.end}`); process.exit(1) }
  if (!['pass', 'fail', 'unclear'].includes(v.verdict)) { console.error(`✗ verdict 非法：${v.verdict}`); process.exit(1) }
}
const failed = verdicts.filter((v) => v.verdict === 'fail')
pkg.visual = {
  _note:
    '★视觉验收结论（独立子代理按 Web 基准并排图评审；来源 = css-conformance/results/side-by-side/）。' +
    'verdict: pass（与 Web 基准无可归因差异）/ fail（有实差异——见 caseIssues）/ unclear（图不足以判）。' +
    '纪律：左半恒为 Web 基准（D1）；不看不清不编（unclear）。',
  reviewedAt: new Date().toISOString(),
  reviewedBy: 'independent-visual-subagent',
  sideBySideDir: 'css-conformance/results/side-by-side/',
  summary: {
    fails: failed.length,
    ends: verdicts.map((v) => `${v.end}:${v.verdict}`).join(' · '),
  },
  verdicts,
}
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
console.log(`✅ 视觉验收已登记：${id}（${pkg.visual.summary.ends}）`)
console.log(`   未过端 ${failed.length}：${failed.map((v) => v.end).join(', ') || '（无）'}`)
console.log('   ★fail 的 caseIssues 即下一步修复清单（按 severity 排序处理）')
