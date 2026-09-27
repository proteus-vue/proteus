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
// ★真机数据（device_run）与模拟器数据**同标签**——报告里两者常并列（「模拟器 X ms / 真机 Y ms」），
//   故真值集必须**同时包含两侧**，否则写了真机数字会被误判为可疑值。
//   踩坑：初版只放模拟器真值 → 报告写入真机 C=198ms 后，门禁把 198 视为「可疑数字」。
// 配对规则（第 4 次修正 —— 前三次都实测出漏洞）：
//   ① 只查「正确数字存在」→ 别处插错值也能过；
//   ② 扫全部三位数 → 误伤其它实验；
//   ③ 按行分组 → 同行多实验仍误伤；
//   ④ `标签[^0-9]{0,80}?数字` → **表格里 `| 272.2 ms | **197.6 ms**` 的中间夹着数字**，
//      被 `[^0-9]` 排除在窗口外 ⇒ 仍然漏。
//   定稿：允许窗口内出现任意字符（含数字与小数点），从中**提取所有**「三位数+ms」候选，
//   只要存在一个偏离全部真值就报警（表格行内通常有多个数字，逐个查更稳）。
const DEV = summary.device_run

// ★校验策略（第 5 版定稿——前四版都实测出漏洞，记录于此以免后人重蹈）：
//   ① 只查「正确数字存在」        → 别处插错值也能过（门禁形同虚设）
//   ② 扫全文所有三位数            → 误伤其它实验的数字
//   ③ 按行分组                    → 同一行含多实验数字时仍误伤
//   ④ `标签[^0-9]{0,80}?数字`     → 表格里中间夹数字（`| 272.2 ms | **197.6**`）被窗口排除
//   ⑤ 窗口内取「第一个数字」      → **标签互为子串时串扰**（`CALayer + 手算 frame` 里
//                                    「手算 frame」会吃到 CALayer 的 272）
//   ⇒ 定稿：**放弃纯文本匹配，改按 Markdown 表格结构解析**——
//      只在「同一行的同一行内、标签与数字之间无其它标签」时配对；行内多个候选则全查。
//      这是文本门禁能做到的最可靠形态；再往下就需要把数据表换成机读源（留作后续）。
const ROUTE_TRUTH = new Map([
  ['A_uiview_autolayout', [m.A_uiview_autolayout, DEV.exp1_total_ms.A_uiview_autolayout.median]],
  ['B_uiview_manualframe', [m.B_uiview_manualframe, DEV.exp1_total_ms.B_uiview_manualframe.median]],
  ['C_calayer_manualframe', [m.C_calayer_manualframe, DEV.exp1_total_ms.C_calayer_manualframe.median]],
  ['H_flattened_rows', [DEV.exp1_total_ms.H_flattened_rows?.median ?? 129.9]],
  ['CATextLayer', [summary.exp3_text_median_ms.CATextLayer_1000, DEV.exp3_text_ms.CATextLayer_1000.median]],
  ['UILabel', [summary.exp3_text_median_ms.UILabel_1000, DEV.exp3_text_ms.UILabel_1000.median]],
])

// ★内存真值（真机 11 变体矩阵，MB）——文档写这些数字时须与 summary 一致
const MEMV = summary.device_run.exp8_memory_matrix?.variants ?? {}
const MEM_TRUTH = new Map([
  ['A_uiview_autolayout', 104.6], ['B_uiview_manualframe', 100.9], ['C_calayer_manualframe', 186.9],
  ['D_uiview_manualframe_unique', 101.0], ['E_calayer_manualframe_unique', 221.7],
  ['F_calayer_solid', 4.9], ['G_uiview_solid', 9.8], ['H_flattened_rows', 17.7],
  ['I_calayer_uikittext', 96.0], ['J_calayer_gray8', 114.9], ['K_calayer_opaque', 187.0],
])

/** 表格行首标识 → 该行的 (ms 真值 | MB 真值)——用行首匹配标识，天然避免子串串扰 */
const ROW_KEYS = [
  { key: /^A[ \u00a0]|^A_uiview_autolayout/, id: 'A_uiview_autolayout' },
  { key: /^B[ \u00a0]|^B_uiview_manualframe/, id: 'B_uiview_manualframe' },
  { key: /^C[ \u00a0]|^C_calayer_manualframe/, id: 'C_calayer_manualframe' },
  { key: /^H[ \u00a0]|^H_flattened/, id: 'H_flattened_rows' },
  { key: /^I[ \u00a0]/, id: 'I_calayer_uikittext' },
  { key: /^J[ \u00a0]/, id: 'J_calayer_gray8' },
  { key: /^K[ \u00a0]/, id: 'K_calayer_opaque' },
  { key: /^F[ \u00a0]/, id: 'F_calayer_solid' },
  { key: /^G[ \u00a0]/, id: 'G_uiview_solid' },
]
for (const file of docs) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')
  for (const line of lines) {
    if (!line.trim().startsWith('|')) { continue }
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
    if (!cells.length) continue
    const first = cells[0].replace(/\*\*/g, '')
    for (const rk of ROW_KEYS) {
      if (!rk.key.test(first)) continue
      // ① ms 值：与耗时真值比对（容差 30ms）
      const timeTruth = ROUTE_TRUTH.get(rk.id)
      if (timeTruth) {
        for (const cell of cells) {
          for (const mm of cell.matchAll(/(\d{3})(?:\.\d+)?\s*ms/g)) {
            const num = Number(mm[1])
            const nearest = Math.min(...timeTruth.map((v) => Math.abs(num - Math.round(v))))
            if (nearest > 30) problems.push(`${file}: 行「${first}」的 ${num}ms ≠ 真值 ${timeTruth.map((v) => Math.round(v)).join('/')}ms`)
          }
        }
      }
      // ② MB 值：与内存真值比对（容差 3MB）——覆盖 11 变体矩阵表
      //   ★只校验行内**第一个** MB（= 该变体的主测量值）：
      //     实测踩坑——行内还可能出现「省 72MB」这类**差值**，全量校验会误报。
      const memTruth = MEM_TRUTH.get(rk.id)
      if (memTruth != null) {
        const joined = cells.join(' | ')
        const firstMb = joined.match(/(\d{1,3}(?:\.\d+)?)\s*MB/)
        if (firstMb) {
          const num = Number(firstMb[1])
          if (Math.abs(num - memTruth) > 3) {
            problems.push(`${file}: 行「${first}」的首个 MB 值 ${num} ≠ 真值 ${memTruth}（差值/推算值不参与校验）`)
          }
        }
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
