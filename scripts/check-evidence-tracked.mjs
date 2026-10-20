#!/usr/bin/env node
// scripts/check-evidence-tracked.mjs —— ★★★真机证据「入库即不得缺失」门禁（#1146）
//
// 【为什么需要（#1144 → #1145 → 本条：同一条缺陷链的第三层）】
//   #1144 修了缺陷本身（鸿蒙 screen.mount 漏 env 替换 ⇒ executor 0 节点）；
//   #1145 修了「入库证据缺失被静默跳过」（check-app-screen-content 的四条设备腿）；
//   本条收的是**同一形态在其余判据上的扩散**：
//     `check-app-stack` / `check-mount-layers` / `check-host-runtime` / `check-kernel-anim` /
//     `check-platform-anim` / `check-embed-demo` 六条判据，产物缺失时一律打印「诚实跳过」并 `return 0`。
//
// 【为什么那句"诚实跳过"现在不再诚实】
//   它成立的前提是「判据的输入是真机产物，开发机/CI 上没有属正常」。但**这些产物已全部入库**
//   （14 个文件均 tracked）⇒ 缺失只剩两种可能：**被人删了**，或**仓库损坏**。
//   两种都不该算"跳过验收"——否则 `git rm hosts/android/results/app-stack.json` 就能让
//   `pnpm check:app-stack` 变绿，而三端路由虚拟栈的验收就此消失且**无人察觉**。
//
// 【★判据从哪来（不维护第二份清单）】
//   直接从 `package.json` 的 `check:*` 命令里抽出 `hosts/<end>/results/*.json` 字面量——
//   **判据的 SSOT 是命令本身**（新增一条读证据的门禁 ⇒ 自动被本门禁覆盖，不需要记得来登记）。
//   这正是本仓"同一事实一处实现"纪律；手工清单必然会腐化（新增判据时没人会记得加）。
//
// 【两条判据】
//   ① 被 `check:*` 引用的每个 `hosts/*/results/*.json` 必须**存在于工作树**；
//   ② 必须**已入库（tracked）**——存在但未跟踪 = 本机产物冒充验收证据（提交后别人拿不到）。
//   ③ `--list` 只报告现状（不判红），供人核对覆盖面。
//
// 【诚实边界】本门禁只管"证据在不在、有没有入库"，不管"证据内容对不对"——
//   后者由各条判据自己判（本门禁刻意不碰，避免变成"用存在性冒充正确性"）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIST_ONLY = process.argv.includes('--list')

/** 从一条命令里抽出证据路径（`hosts/<end>/results/<file>.json`） */
const EVIDENCE_RE = /hosts\/[A-Za-z0-9_-]+\/results\/[A-Za-z0-9._-]+\.json/g

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
const scripts = pkg.scripts ?? {}

/** path → 引用它的 check:* 命令名集合 */
const owners = new Map()
for (const [name, cmd] of Object.entries(scripts)) {
  if (!name.startsWith('check:')) continue
  for (const m of String(cmd).matchAll(EVIDENCE_RE)) {
    if (!owners.has(m[0])) owners.set(m[0], new Set())
    owners.get(m[0]).add(name)
  }
}
// ★verify 链里直接 `pnpm run check:x`（不含路径）⇒ 已被上面按 check:* 覆盖；无需额外处理。

if (owners.size === 0) {
  console.error('✗ 未从任何 check:* 命令里找到 hosts/*/results/*.json 证据引用——判据要跟命令形态走，请检查本门禁的正则')
  process.exit(1)
}

/** 是否已入库（git ls-files；失败 ⇒ 不是 git 仓库，按"无法判定"处理） */
function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** 是否在 git 仓库内（否则 tracked 判定无意义——CI 的 shallow/源码包场景） */
function inGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const gitOk = inGitRepo()
const problems = []
const rows = []
/** ② 组：docs/ai-tasks.json 引用的验收证据条数（0 = 未解析/已清理） */
let evidenceDocRows = 0

for (const rel of [...owners.keys()].sort()) {
  const abs = path.join(ROOT, rel)
  const exists = fs.existsSync(abs)
  const tracked = gitOk ? isTracked(rel) : null
  rows.push({ rel, exists, tracked, by: [...owners.get(rel)].sort().join(', ') })

  if (!exists) {
    problems.push(
      `${rel} 缺失（被 ${[...owners.get(rel)].sort().join(', ')} 读取）——` +
        `★它是**入库**的真机证据：缺失不是"跳过验收"，是证据被删/仓库损坏。` +
        `修法：git checkout -- ${rel}（或按该判据的提示重跑真机后提交）`
    )
  } else if (gitOk && tracked === false) {
    problems.push(
      `${rel} 存在但**未入库**（untracked）——本机产物冒充验收证据：` +
        `提交后别人拿不到、CI 也看不到。修法：git add -f ${rel}（若确属证据）或删除它`
    )
  }
}

/* ═══════════ ② 文档里被引用的验收证据（docs/ai-tasks.json 的 verification 字段）═══════════
 * 【为什么单独一组】上一组（被 check:* 命令引用）只覆盖**代码里**的判据输入；
 *   而 `docs/ai-tasks.json` 的 `verification` 字段会写"真机终版：亮条 255 / 胶囊 237（.workbuddy/salvage/...）"
 *   —— 那些截图是**验收证据**，被引用了却不在库 = 结论无法复核（与"提交 ≠ 交付"同族）。
 *   ★背景（#1147）：.workbuddy/salvage 是迭代草稿区（5447 个/6 GB），已整目录 gitignore；
 *     但其中**被引用的 106 个文件已入库**——忽略规则不作用于已跟踪文件，所以两者可以共存。
 *     本组的职责就是把"共存"钉死：**草稿可以忽略，被引用的证据不能少**。
 * 【解析口径】取引用路径的**目录锚点**（去掉 `{light,dark}` 这类花括号展开），
 *   断言该目录/文件存在**且至少有一个文件已入库**（目录内部分文件未入库属正常——草稿与证据混杂）。
 * 【诚实边界】只校验"引用到的证据在不在库里"，不校验内容（图对不对由人/visual 判据看）。 */
{
  const tasksFile = path.join(ROOT, 'docs/ai-tasks.json')
  if (!fs.existsSync(tasksFile)) {
    problems.push('docs/ai-tasks.json 缺失——它是验收证据引用的 SSOT（无法核对引用是否可复核）')
  } else if (gitOk) {
    const text = fs.readFileSync(tasksFile, 'utf-8')
    const refs = [...new Set([...text.matchAll(/\.workbuddy\/salvage\/[A-Za-z0-9._/{}-]+/g)].map((m) => m[0]))]
    if (refs.length === 0) {
      // ★"一条都没有"是可疑信号（解析口径腐化 ⇒ 静默空跑），不是"无需校验"
      problems.push('docs/ai-tasks.json 里没解析出任何 .workbuddy/salvage 引用——若确已全部清理，请同步本判据的口径')
    }
    for (const raw of refs) {
      const anchorPath = (raw.includes('{') ? raw.slice(0, raw.indexOf('{')) : raw).replace(/[\/]+$/, '')
      const abs = path.join(ROOT, anchorPath)
      if (!fs.existsSync(abs)) {
        problems.push(`${anchorPath} 被 docs/ai-tasks.json 引用但**不存在**——验收结论无法复核`)
        continue
      }
      const trackedCount = Number(
        String(
          execFileSync('git', ['ls-files', anchorPath], { cwd: ROOT, encoding: 'utf-8' })
        )
          .split('\n')
          .filter(Boolean).length
      )
      if (trackedCount === 0) {
        problems.push(
          `${anchorPath} 被 docs/ai-tasks.json 引用但**一个文件都没入库**——` +
            `.workbuddy/salvage/ 已整目录 gitignore（#1147），新增证据须显式 \`git add -f <path>\``
        )
      }
    }
    if (!problems.some((p) => p.includes('.workbuddy/salvage'))) {
      evidenceDocRows = refs.length
    }
  }
}

if (LIST_ONLY) {
  console.log(`真机证据清单（从 package.json 的 check:* 命令自动推导，共 ${rows.length} 条）`)
  for (const r of rows) {
    const mark = !r.exists ? '✗ 缺失' : r.tracked === false ? '⚠ 未入库' : '✓ 已入库'
    console.log(`  ${mark.padEnd(9)} ${r.rel}  ← ${r.by}`)
  }
  // ★#1147：② 组（docs/ai-tasks.json 引用的验收证据）也须在 --list 里如实报出——
  //   原实现把它只打在**成功分支**，而 --list 在此之前就 exit(0) ⇒ 清单看不到这一组，
  //   等于"核对覆盖面"时漏掉一半（且 0 条时无法与"解析口径腐化"区分）。
  console.log(`  ── ② 文档引用证据（docs/ai-tasks.json 的 verification 字段）：${evidenceDocRows} 条可复核`)
  if (problems.length > 0) {
    console.log(`  ⚠ 另有 ${problems.length} 条问题（--list 只报告，不判红）：`)
    for (const p of problems) console.log(`     · ${p}`)
  }
  process.exit(0)
}

if (problems.length > 0) {
  console.error('✗ 真机证据「入库即不得缺失」门禁未过：')
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}
console.log(
  `✅ 真机证据齐备（${rows.length} 个被 check:* 引用的产物 · 全部存在${gitOk ? '且已入库' : ''}）` +
    (gitOk ? '' : '——注意：非 git 环境，未校验入库状态') +
    (evidenceDocRows > 0 ? ` · 文档引用证据 ${evidenceDocRows} 条可复核` : '')
)
