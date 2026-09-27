#!/usr/bin/env node
// scripts/check-fluid-wording.mjs —— ★柔性系统对外口径门禁（2026-09-29 收口）
//
// 背景（用户在收口评审时点到的真实漂移）：
//   ① 形态数量：`FORM_PROFILES` 实际 **8 个**（fold 与 flip 已拆为两类折叠设备），
//      而站点多处仍写「六种/七种设备形态」——官网数字与源码事实不符（与 check:stats 同性质的失信）。
//   ② 弃用术语：术语表要求统一 **Fluid System**，而 EN 文档残留 17 处 `Flex System`。
//   ③ 自造命名：书本式半开曾被写成「半折（书本模式）」——「半折」只适用于翻盖式（clamshell），
//      该说法本仓自造、无规范出处（小米原文只写 Book / TableTop）。用户实测纠错过一次。
//
// 本脚本把三类口径变成机器可判定（防回潮）：
//   ① 形态数量：柔性系统文档与站点文案不得出现「六/7/七」形态/端 的**数量断言**
//      （形态枚举本身不受影响；`六端` 作历史语境另有限定见下）
//   ② 弃用术语：website 下不得出现 `Flex System`（应为 `Fluid System`）
//   ③ 命名纪律：不得出现「半折（书本」这类自造组合；书本式一律写「半开」
//
// 用法：node scripts/check-fluid-wording.mjs
// 退出码：0 通过 / 1 存在漂移
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FAIL = []
const hits = (kind, file, line, text) => FAIL.push({ kind, file, line, text: text.trim().slice(0, 100) })

/** 递归收集文件（跳过产物与依赖） */
function walk(dir, filter) {
  const out = []
  const skip = new Set(['node_modules', 'dist', '.git', 'coverage'])
  const visit = (d) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) visit(p)
      else if (filter(p)) out.push(p)
    }
  }
  visit(dir)
  return out
}

/** 阅读文档集（柔性系统专区 zh/en + 站点文案源码） */
const DOC_FILES = [
  ...walk(path.join(ROOT, 'website/content/system'), (p) => p.endsWith('.md')),
  ...walk(path.join(ROOT, 'website/en/system'), (p) => p.endsWith('.md')),
]
const SRC_FILES = [
  ...walk(path.join(ROOT, 'website/src'), (p) => /\.(vue|ts)$/.test(p)),
  // 柔性系统计划文档也受口径约束（收口文档在其中）
  ...walk(path.join(ROOT, 'docs/proteus-fluid-system-plan'), (p) => p.endsWith('.md')),
]

// ── ① 形态数量：实际 8，不得写 6/7 ─────────────────────────────────────────────
// 只匹配**数量断言**（「六种形态」「7 形态」「六端形态」…），不误伤枚举编号/其他计数。
// 允许的行尾豁免标记： <!-- fluid-count-ok -->（用于确需引述历史口径的句子）
const COUNT_PATTERNS = [
  /六种(?:终端)?形态/,
  /六端形态/,
  /6 (?:device )?forms?\b/i,
  /six (?:device )?forms?\b/i,
  /七种(?:设备)?形态/,
  /七形态/,
  /七端/,
  /7 (?:device )?forms?\b/i,
  /seven (?:device )?forms?\b/i,
]
const COUNT_ALLOW = '<!-- fluid-count-ok -->'

// ── ② 弃用术语 ────────────────────────────────────────────────────────────────
const DEPRECATED_TERMS = [/\bFlex System\b/]

// ── ③ 自造命名：书本式不得叫「半折」 ──────────────────────────────────────────
// 命中形如「半折（书本」「半折·书本」「半折 (book」——把 clamshell 的词用在书本式上。
const NAMING_PATTERNS = [/半折[（(]书本/, /半折[·・\s]*书本/]

function scan(files, patterns, kind, allowTag) {
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      const t = line.trim()
      // 注释行豁免（源码注释里允许引述「曾用错的说法」）
      const isComment = /^(\/\/|\*|\/\*|<!--)/.test(t)
      if (allowTag && line.includes(allowTag)) return
      for (const re of patterns) {
        if (re.test(line)) {
          // 文档里在讲「已撤销的说法」时允许：同句含「撤销/弃用/曾/自造」等
          const historical = /撤销|弃用|曾|自造|不再|纠错|历史/.test(line)
          if (isComment || historical) continue
          hits(kind, path.relative(ROOT, f), i + 1, line)
        }
      }
    })
  }
}

scan(DOC_FILES, COUNT_PATTERNS, '形态数量漂移（实际 8 形态）', COUNT_ALLOW)
scan(SRC_FILES, COUNT_PATTERNS, '形态数量漂移（实际 8 形态）', COUNT_ALLOW)
scan(DOC_FILES, DEPRECATED_TERMS, '弃用术语（应为 Fluid System）', COUNT_ALLOW)
scan(SRC_FILES, DEPRECATED_TERMS, '弃用术语（应为 Fluid System）', COUNT_ALLOW)
scan(DOC_FILES, NAMING_PATTERNS, '自造命名（书本式半开 ≠ 半折）', COUNT_ALLOW)
scan(SRC_FILES, NAMING_PATTERNS, '自造命名（书本式半开 ≠ 半折）', COUNT_ALLOW)

// ── ④ 真值自检：形态数必须真的是 8（与 formfactor.ts 对账）──────────────────
const ff = fs.readFileSync(path.join(ROOT, 'packages/fluid/src/formfactor.ts'), 'utf8')
const formsBlock = ff.match(/export const FORM_PROFILES:[\s\S]*?\n\}/)
const formKeys = formsBlock ? [...formsBlock[0].matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]) : []
if (formKeys.length !== 8) {
  hits('形态数与事实不符', 'packages/fluid/src/formfactor.ts', 0, `FORM_PROFILES 实际 ${formKeys.length} 个（门禁口径写的是 8）`)
}

if (FAIL.length) {
  const byKind = new Map()
  for (const f of FAIL) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, [])
    byKind.get(f.kind).push(f)
  }
  console.error('[fluid-wording] ✗ 柔性系统对外口径漂移：\n')
  for (const [kind, list] of byKind) {
    console.error(`  【${kind}】${list.length} 处`)
    for (const h of list) console.error(`    - ${h.file}:${h.line}  ${h.text}`)
    console.error('')
  }
  console.error('  规则：形态数 = 8（FORM_PROFILES 的键数，机器对账）；术语统一 Fluid System；')
  console.error('        书本式半开不得写作「半折」（「半折」属翻盖式 clamshell）。')
  console.error('  确需引述历史口径/历史错误的行可加 `<!-- fluid-count-ok -->`（md 注释，不渲染）豁免；')
  console.error('  计划类历史文档请整段说明「本文为撰写时快照」并逐行标记，不要放宽规则。')
  process.exit(1)
}
console.log(`[fluid-wording] ✅ 口径一致（形态数 ${formKeys.length}；无弃用术语；无自造命名）——扫描 ${DOC_FILES.length + SRC_FILES.length} 文件`)
