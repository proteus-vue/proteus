#!/usr/bin/env node
// scripts/check-decision-numbers.mjs —— ★★★决策链台账的**编号自洽门禁**（2026-10-13 · 决策 #903）
//
// 【为什么需要（这是"实测踩到"才补的，不是提前设计的）】
//   `docs/project-memory-archive/decisions.md` 是本仓的**追溯锚点**：任务板、门禁、代码注释、任务卡
//   全都以「见决策 #NNN」互相引用。而它此前**没有任何机器判据**校验编号本身——实测结果：
//   `#899` 被**同一提交**（`b51b3cb8`）里的两条不同决策**重号**占用（「v-for 静态列表边界」与
//   「App 三端宿主运行时能力对齐专项立项」），随后材质系统/鸿蒙两条又各按序占用 #900/#901。
//   ⇒ 任何"见决策 #899"从此**指代不明**（追溯锚点失效）。
//   这与本仓反复吃过的形态同族：**手写清单会漂移，只有机器判据是结构性的**（同族：
//   `check:gates-sync` 的接线校验、`check:ai-tasks` 的任务板自洽、`css-conformance` 的索引条目校验）。
//
// 【判据（两条，均机器推导）】
//   ① **决策号唯一**：`decisions.md` 里形如 `NNN. **…` 的条目标题，同一 `NNN` 只能出现一次。
//      · 重号 ⇒ 红，并逐条打印**冲突行号 + 标题**（供直接定位）。
//      · 顺带报告**跳号**（info，不判红）：旧文件曾有插入式编号，跳号是历史事实，不必强改。
//   ② **引用不得悬空**：`docs/ai-tasks.json` 的 note/verification 里出现的 `决策 #NNN` **必须在
//      `decisions.md` 真实存在**（任务板是"done 必须挂真实决策号"的台账 ⇒ 悬空引用意味着
//      追溯链断了）。★只判"引用存在性"，不判范围（引用别的决策也合法）。
//
// 【★为什么只扫任务板、不扫全仓】全仓 `#NNN` 引用会命中大量**非决策号**（issue/PR 号、卡号、
//   `#890` 之类的既有多义用法）⇒ 会造出假红。门禁宁窄勿假：任务板是本仓**机器消费**的台账，
//   先把它守住；将来若要扩面，按"先证明无假阳性再扩"的次序做。
//
// 用法：node scripts/check-decision-numbers.mjs
// 退出码：0 通过 / 1 重号或悬空引用
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DECISIONS = path.join(ROOT, 'docs/project-memory-archive/decisions.md')
const TASKS = path.join(ROOT, 'docs/ai-tasks.json')

let failed = false
const fail = (m) => { console.error(`✗ ${m}`); failed = true }

/* ── 解析决策条目标题：行首 `NNN. **…`（本仓 decisions.md 的固定形态） ── */
const text = fs.readFileSync(DECISIONS, 'utf-8')
const lines = text.split('\n')
const entries = []
lines.forEach((l, i) => {
  const m = /^\s*(\d{1,4})\.\s+\*\*/.exec(l)
  if (m) entries.push({ n: Number(m[1]), line: i + 1, title: l.replace(/\*\*/g, '').slice(0, 70) })
})

console.log('[check-decision-numbers] 决策链编号自洽门禁')
console.log(`  条目 ${entries.length} 条 · 号段 #${entries[0]?.n ?? '?'}–#${entries[entries.length - 1]?.n ?? '?'}`)

/* ── 判据① 唯一 ── */
{
  const byNum = new Map()
  for (const e of entries) {
    if (!byNum.has(e.n)) byNum.set(e.n, [])
    byNum.get(e.n).push(e)
  }
  const dups = [...byNum.entries()].filter(([, arr]) => arr.length > 1).sort((a, b) => a[0] - b[0])
  if (dups.length) {
    for (const [n, arr] of dups) {
      fail(`决策号 #${n} 被 ${arr.length} 条不同决策重号占用（追溯锚点失效——"见决策 #${n}" 指代不明）：`)
      for (const e of arr) console.error(`      decisions.md:${e.line}  ${e.title}`)
      console.error('      修法：为**后写入**的那条换一个**未被占用**的新号，并在其条目首写明「★编号勘误」段（不要改动已提交条目引用的号）')
    }
  } else {
    console.log(`  ✓ 决策号唯一（${byNum.size} 个不同号，无重号）`)
  }
  // 跳号：仅报告（历史事实，不判红）
  const nums = [...byNum.keys()].sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) {
      for (let k = nums[i - 1] + 1; k < nums[i]; k++) gaps.push(k)
    }
  }
  if (gaps.length) console.log(`  ℹ 跳号 ${gaps.length} 个（历史事实，不判红）：${gaps.slice(0, 12).join(', ')}${gaps.length > 12 ? ' …' : ''}`)
}

/* ── 判据② 任务板引用不得悬空 ── */
{
  const raw = fs.readFileSync(TASKS, 'utf-8')
  const exist = new Set(entries.map((e) => e.n))
  // 只认「决策 #NNN」这一显式形态（避免把其它 #数字 误当决策号）
  const refs = new Set()
  const re = /决策\s*#(\d{1,4})/g
  let m
  while ((m = re.exec(raw)) !== null) refs.add(Number(m[1]))
  const dangling = [...refs].filter((n) => !exist.has(n)).sort((a, b) => a - b)
  if (dangling.length) {
    fail(`任务板引用了 decisions.md 里**不存在**的决策号：${dangling.map((n) => '#' + n).join(', ')}（追溯链断裂）`)
  } else {
    console.log(`  ✓ 任务板的 ${refs.size} 个「决策 #NNN」引用全部存在（最低 #${Math.min(...refs)}，最高 #${Math.max(...refs)}）`)
  }
}

if (failed) {
  console.error('\n✗ 决策链编号不自洽（重号 / 悬空引用）——见上')
  process.exit(1)
}
console.log('\n✅ 决策链编号自洽（唯一 + 无悬空引用）')
