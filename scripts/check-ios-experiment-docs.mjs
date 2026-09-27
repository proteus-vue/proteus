#!/usr/bin/env node
// scripts/check-ios-experiment-docs.mjs —— ★实验数字 ↔ 文档口径一致性门禁
//
// 【为什么需要】性能文档最易腐化：实验重跑后数字变了、文档还写着旧值；
//   或文档引用「单次运行」的数字却标成「中位数」。本仓对「数字」一贯要求可追溯
//   （见 check:stats 的「官网数字 vs 源码实际值」纪律），性能数字同理。
//
// 【口径定义】以 hosts/ios/experiments/results/summary.json 为**权威**（4 次独立重跑的中位数）；
//   experiments.json 是单次运行快照，仅供单跑查看。
//
// 用法：node scripts/check-ios-experiment-docs.mjs
// 退出码：0 一致 / 1 漂移
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SUMMARY = path.join(ROOT, 'hosts/ios/experiments/results/summary.json')

if (!fs.existsSync(SUMMARY)) {
  console.error('[ios-exp-docs] 缺少 summary.json——先跑：bash hosts/ios/experiments/run.sh（至少 2 次以形成中位）')
  process.exit(2)
}
const summary = JSON.parse(fs.readFileSync(SUMMARY, 'utf8'))
const m = summary.exp1_total_median_ms
const docs = [
  'docs/Proteus_App端高性能渲染落地方案.md',
  'docs/proteus-performance-plan/01-ios-route-validation.md',
]
const TOL = 30 // ms——文档取整/四舍五入的容差

const problems = []
/** 断言：文档里出现该数字（或 ±TOL 内的近似值）时，不得同时出现「偏得离谱」的值 */
function checkDoc(file, labels) {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) { problems.push(`${file}: 文件不存在`); return }
  const text = fs.readFileSync(p, 'utf8')
  for (const [label, truth] of Object.entries(labels)) {
    // 若文档引用了该路线的数字，则每个「三位数 ms」候选都应接近真值（防止写了旧数字）
    const near = Math.abs(Math.round(truth) - truth) <= TOL
    if (!near) problems.push(`${file}/${label}: 期望值异常 ${truth}`)
  }
}

checkDoc(docs[0], { A: m.A_uiview_autolayout, B: m.B_uiview_manualframe, C: m.C_calayer_manualframe })
checkDoc(docs[1], { A: m.A_uiview_autolayout, B: m.B_uiview_manualframe, C: m.C_calayer_manualframe })

// 关键：**双向**校验，且**按实验分组**限定真值集。
//   ★两次踩坑记录：
//     ① 初版只查「正确数字是否存在」→ 别处插入错误数字也能过（门禁形同虚设）；
//     ② 第二版扫全部三位数 → 误伤其它实验的真实数字（文本通道 168/239ms 不属于 exp1）。
//   正解：只校验**明确属于该实验**的行（含该实验的特征词），再逐个比对候选数字。
// 配对规则：**数字必须紧跟自己所属的标签**（标签在前 N 个字符内），避免同一行混排实验互相误伤。
//   ★三次踩坑记录（都实测过）：
//     ① 只查「正确数字存在」→ 别处插错值也能过；
//     ② 扫全部三位数 → 误伤其它实验（文本通道 168/239 被 exp1 规则抓）；
//     ③ 按行分组 → 同一行含多实验数字时仍误伤（`CALayer 272ms；文本通道 CATextLayer 168ms` 一行）。
//   正解：`标签 … 数字ms` 就近配对，标签与数字间距 ≤ 40 字符。
const PAIRS = [
  { label: 'AutoLayout', truth: m.A_uiview_autolayout },
  { label: '手算 frame', truth: m.B_uiview_manualframe },
  { label: 'CALayer', truth: m.C_calayer_manualframe },
  { label: 'CATextLayer', truth: summary.exp3_text_median_ms.CATextLayer_1000 },
  { label: 'UILabel', truth: summary.exp3_text_median_ms.UILabel_1000 },
]
for (const file of docs) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\n/g, ' ')
  for (const pair of PAIRS) {
    // 找「label 后 40 字符内出现的 3 位数 + ms」
    const re = new RegExp(pair.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^0-9]{0,40}?(\\d{3})\\s*(?:ms|毫秒)', 'g')
    for (const mm of text.matchAll(re)) {
      const num = Number(mm[1])
      if (Math.abs(num - Math.round(pair.truth)) > TOL) {
        problems.push(`${file}: 「${pair.label}」附近出现 ${num}ms，实测真值 ${Math.round(pair.truth)}ms（±${TOL}）`)
      }
    }
  }
}

if (problems.length) {
  console.error('[ios-exp-docs] ✗ 文档与实验数据不一致：')
  for (const x of problems) console.error('   - ' + x)
  console.error('\n  summary.json 是权威口径（多次重跑中位）。改了实验就同步文档，或反之。')
  process.exit(1)
}
console.log(`[ios-exp-docs] ✅ 文档与实验数据一致（A ${Math.round(m.A_uiview_autolayout)}ms / B ${Math.round(m.B_uiview_manualframe)}ms / C ${Math.round(m.C_calayer_manualframe)}ms，口径=4 次重跑中位）`)
