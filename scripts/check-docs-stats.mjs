#!/usr/bin/env node
// scripts/check-docs-stats.mjs —— ★文档权威数字门禁（2026-09-29）
//
// 背景（用户审阅两份新增文档时发现的真实漂移）：
//   `website/scripts/check-stats.ts` 只校验**官网 stats.ts** 的声明值，
//   而 `docs/*.md` 里的数字**没有任何门禁覆盖**——于是同一批事实在 md 里持续漂移：
//     · 183 原语（实际 184）· 69 条规则（实际 111）· 38 个包（实际 43）
//     · 76 个语义组件（实际 77 组件目录 / 65 已实现语义）
//     · ★绘制 0.667 —— 该值**已于 2026-09-29 被证伪**（系「只画色块」子项冒充整体，
//       整体 6ms vs 原生 3ms ⇒ 2.0），却残留在 5 份当前态文档里继续被引用。
//   根因与官网数字事故**同形**：只检查「我声明的」，不核对「实际是什么」。
//
// 判据设计（避免成为噪音源——误报会被关掉，见《实战采集埋点清单》§2.1 同源教训）：
//   ① 只扫**当前态文档**（CURRENT_DOCS 白名单 + docs 根目录的直接文档），
//      不扫 plan 子目录：那里的数字多为**撰写时快照**（历史语境，改动即失真）；
//   ② 黑名单是**过期的确切写法**（不是"所有数字"），每条都能指向已证伪的事实；
//   ③ 需要引述历史时，行内加 `<!-- stats-ok -->` 豁免并写明原因。
//
// 用法：node scripts/check-docs-stats.mjs
// 退出码：0 通过 / 1 存在过期数字
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── 事实来源：与 website/scripts/check-stats.ts 同口径，直接从源码重算 ──────────
// （★不硬编码期望值——那样只是把"两处手写"变成一个"手写"加一个"抄写"）
function sourceFacts() {
  const probe = `
import { PRIMITIVE_CATALOG, implementedPrimitives } from ${JSON.stringify(path.join(ROOT, 'packages/component-ir/src/index.ts'))}
import { listTransformRules } from ${JSON.stringify(path.join(ROOT, 'packages/compiler/src/transforms/registry.ts'))}
import fs from 'node:fs'
import path from 'node:path'
const root = ${JSON.stringify(ROOT)}
let pkgs = 0
for (const e of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
  if (!e.isDirectory()) continue
  const p = path.join(root, 'packages', e.name, 'package.json')
  if (!fs.existsSync(p)) continue
  if (JSON.parse(fs.readFileSync(p, 'utf8')).name?.startsWith('@proteus-vue/')) pkgs++
}
let comps = 0
const cd = path.join(root, 'packages/components')
for (const e of fs.readdirSync(cd, { withFileTypes: true })) {
  if (e.isDirectory() && fs.existsSync(path.join(cd, e.name, 'index.vue'))) comps++
}
console.log(JSON.stringify({
  primitives: PRIMITIVE_CATALOG.length,
  implemented: implementedPrimitives().length,
  rules: listTransformRules().length,
  packages: pkgs,
  components: comps,
}))
`
  const out = execFileSync('npx', ['tsx', '-e', probe], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out.trim().split('\n').pop())
}

const facts = sourceFacts()

// ── 过期写法黑名单：每条给出「为什么它是错的」────────────────────────────────
// 约定：pattern 匹配的是**已证伪的当前态断言**，不是泛指的数字。
const STALE = [
  {
    id: 'primitives-183',
    re: /183\s*(?:个|条)?\s*(?:语义)?原语/g,
    truth: `${facts.primitives}`,
    why: '`PRIMITIVE_CATALOG` 实为 ' + facts.primitives + ' 项（check:stats 同口径）',
  },
  {
    id: 'rules-69',
    re: /69\s*条规则/g,
    truth: `${facts.rules}`,
    why: '`listTransformRules()` 实为 ' + facts.rules + ' 条',
  },
  {
    id: 'packages-38',
    re: /38\s*个\s*`?@proteus-vue\/\*/g,
    truth: `${facts.packages}`,
    why: 'workspace 内 @proteus-vue/* 包实为 ' + facts.packages + ' 个',
  },
  {
    id: 'components-76',
    re: /76\s*个语义组件/g,
    truth: `${facts.components}`,
    why: '组件目录 ' + facts.components + ' 个 · 已实现语义 ' + facts.implemented + ' 个',
  },
  {
    id: 'draw-0667',
    re: /绘制\s*(?:耗时)?\s*(?:为)?\s*(?:\*\*)?0\.667(?:\*\*)?(?![0-9])/g,
    truth: '2.0（或不达标）',
    why:
      '0.667 系 `draw_attribution_rects_only_ms`（只画色块）子项，整体 `canvas_draw_software_ms`=6ms vs 原生 3ms ⇒ **2.0 不达标**；2026-09-29 已在 `hosts/android/ACCEPTANCE.md` 更正',
  },
]

// ── 扫描范围：docs 根目录的直接文档（当前态载体）+ 显式白名单 ──────────────────
// 前缀匹配——允许 `<!-- stats-ok -->` 与 `<!-- stats-ok: 理由 -->` 两种写法
const EXEMPT_MARK = '<!-- stats-ok'
const SKIP_FILES = new Set([
  '实战报告_proteus接入.md', // 外部实战报告：含大量历史快照与外部方原文，改动即失真
  'Proteus_实战采集埋点清单.md', // 已在文中显式标注历史语境（1231/603 帧、0.667 子项）
])

function docsRoot() {
  return fs
    .readdirSync(path.join(ROOT, 'docs'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .filter((n) => !SKIP_FILES.has(n))
}

const failures = []
const scanned = []
for (const name of docsRoot()) {
  const file = path.join(ROOT, 'docs', name)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  scanned.push(name)
  lines.forEach((line, i) => {
    if (line.includes(EXEMPT_MARK)) return
    for (const s of STALE) {
      s.re.lastIndex = 0
      let m
      while ((m = s.re.exec(line)) !== null) {
        failures.push({
          file: `docs/${name}`,
          line: i + 1,
          id: s.id,
          text: m[0],
          truth: s.truth,
          why: s.why,
        })
      }
    }
  })
}

// ── 正向断言：SSOT 载体文档必须写出当前值（防"删掉就绿"）──────────────────────
const MUST_STATE = [
  { file: 'docs/Proteus架构收敛模型说明.md', re: new RegExp(`${facts.primitives}\\s*语义原语`), why: `${facts.primitives} 语义原语（SSOT 数）` },
  { file: 'docs/Proteus_实战采集埋点清单.md', re: new RegExp(`${facts.primitives}\\s*原语`), why: `${facts.primitives} 原语（SSOT 数）` },
]
for (const { file, re, why } of MUST_STATE) {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) { failures.push({ file, line: 0, id: 'missing-doc', text: '', truth: why, why: '文档不存在（MUST_STATE 目标缺失）' }); continue }
  if (!re.test(fs.readFileSync(p, 'utf8'))) {
    failures.push({ file, line: 0, id: 'missing-assert', text: '', truth: why, why: '未写出当前权威值（正向断言失败）' })
  }
}

console.log('文档权威数字门禁（docs ↔ 源码实际值）')
console.log(`  事实来源：原语 ${facts.primitives} · 已实现语义 ${facts.implemented} · 规则 ${facts.rules} · 包 ${facts.packages} · 组件 ${facts.components}`)
console.log(`  扫描：docs 根目录 ${scanned.length} 份当前态文档（跳过 ${SKIP_FILES.size} 份历史载体）`)
if (failures.length) {
  console.error(`\n❌ 发现 ${failures.length} 处过期/缺失数字：`)
  for (const f of failures) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file
    console.error(`  - ${loc} [${f.id}] "${f.text}" → 应为 ${f.truth}`)
    console.error(`      理由：${f.why}`)
  }
  console.error(`\n  引述历史口径时，在行内加 ${EXEMPT_MARK} 并写明原因。`)
  process.exit(1)
}
console.log('\n✅ 当前态文档数字与源码一致（含正向断言）')
