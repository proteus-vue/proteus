#!/usr/bin/env node
// scripts/check-codenames.mjs —— ★★★万神殿命名的**对外纪律门禁**（决策 #1110）
//
// 【为什么需要（本仓 2026-10-20 的真实事故）】
//   `Morpheus` 在官网当产品名用了很久，直到一次检索才发现 **npm 上 `morpheus` 就是同域动画库**
//   ⇒ 被迫 117 文件全局改名（决策 #1108）。当时的纪律只写在《万神殿命名规范》§3/§5 的**散文里**：
//   「🟡/🔵 的代号，对外使用前必须先完成检索」。而**散文拦不住**——本仓反复验证过这条
//   （sleep 盲等 / 全量重复跑 / 提交不推，全靠工具层门禁才停下）。
//   ⇒ 本门禁把那条纪律变成**可判定**：**未定名的代号不得静默出现在对外面**。
//
// 【判据（两条硬红线 + 一条清单）】
//   R1 **排除名单（§4）里的名字，绝不得出现在对外面**（历史归档除外）。
//      —— 这些是已经检索出「同域知名项目」的名字，用了就是第二次 Morpheus。
//   R2 **§3 里状态为 🟡/🔵（未定名）的代号，不得出现在对外面**——
//      除非该项已登记在下方 PUBLIC_PENDING（**显式承认**的存量 + 检索证据 + 棘轮只减不增）。
//      —— 目的不是"一次清零"，而是让存量债务**每次构建都可见**，新增的一律当场红。
//   R3 每次运行**打印 PUBLIC_PENDING 清单**（存量债务账本，不许沉默）。
//
// 【★本门禁的能力边界（必须说清，否则会被误当成"查重工具"）】
//   它**不能**检测"某代号在外部世界是否撞名"——那需要 npm / GitHub / 商标库检索（人或联网工具做）。
//   它守的是**流程**：未经登记的代号不许进对外面；已登记的每次都会提醒你去查。
//   ⇒ 真正的撞名发现仍然靠人（本仓 2026-10-20 就是靠 npm 检索抓到的 Morpheus）。
//
// 【对外面的定义】用户能读到的文案面：
//   · `website/{content,guides,en,animation,framework}/**/*.md`（文档）
//   · `website/src/**/*.{ts,vue}`（产品页 / 导航 / i18n；**剥离注释与 <style>** 后扫描）
//   【不算对外面】`docs/**`（内部）、`packages/**` / `hosts/**`（代码）、
//     `docs/project-memory-archive/**`（**历史归档——决策号是追溯锚点，绝不回改**）。
//
// 【解析源 = 命名规范 SSOT】本门禁不维护第二份名单：
//   直接解析 `docs/Proteus_万神殿命名规范.md` 的 §3 表（代号 + 状态）与 §4 表（排除名单）。
//   ★表解析有自检（见 SANITY）：命中数低于下限即**判红**——防"表被改了格式、门禁静默全过"
//     （本仓 `test-coupling` 已有同款自检，理由相同）。
//
// 用法：node scripts/check-codenames.mjs [--verbose]
// 退出码：0 通过 / 1 违规 / 2 解析失败（表结构变了）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC = path.join(ROOT, 'docs/Proteus_万神殿命名规范.md')
const VERBOSE = process.argv.includes('--verbose')

/* ── 已登记在案、但状态仍是 🟡/🔵 的同时**已在对外面使用**的代号 ──
 * ★纪律：
 *   ① 新增一项 = **显式承认一笔债**，必须在 note 里写清"为什么现在不能撤" + 检索证据；
 *   ② 状态转为 ✅（完成正式检索）后**必须从本表删除**（否则门禁会提示回收）——棘轮只减不增；
 *   ③ 本表**不是**"允许清单"，是"已知债务账本"；它出现在每次运行输出里。
 *
 * 【2026-10-20 建账时的现状】这四条都是**规范成文之前**就已经在官网当产品名用的
 *   （导航「引擎▾」下拉 + 各自产品页），不是本轮新增。npm / GitHub 粗查均未发现同域占用：
 *   · Kairos  —— npm `kairos` = 时间计算器；非动画/UI 域
 *   · Themis  —— npm `themis` = JSON Schema 校验器 · `wasm-themis` = 加密库；非 CSS 域
 *   · Keryx   —— npm `keryx` = MCP/API 框架 · `@mrciphersmith/keryx` = AI 编码工具；非图标域
 *   · Aether  —— npm `aether` = JS 教学工具；GitHub 高星同名多为网络隧道；非 UI/渲染域
 *   ★**四条都还没做正式商标检索**（USPTO / 中国商标网 / EUIPO）⇒ 状态仍是 🟡，不得对外单独承诺。
 */
const PUBLIC_PENDING = {
  Kairos: '动画引擎。导航+动画分区+产品页（20 文件）。npm 粗查无同域占用；正式检索未做',
  Themis: '多端一致 CSS 引擎。导航+产品页。npm 粗查无同域占用；正式检索未做',
  Keryx: 'OS 级图标库。导航+产品页+生成的能力页。npm 粗查无同域占用；正式检索未做',
  Aether: '液态玻璃外壳组件库（**仍属规划未落地**）。导航+产品页+指引页。npm 粗查无同域占用；正式检索未做',
}

/** 允许出现"排除名单名字"的文件（**它们的存在意义就是记录排除**，不是违规） */
const EXCLUSION_DOCS = new Set([
  'website/guides/38-module-codenames.md',
  'website/en/guides/38-module-codenames.md',
])

/** 解析自检下限（表结构变了就判红，不静默） */
const SANITY = { registered: 14, excluded: 12 }

/* ────────────────────────── 解析 SSOT ────────────────────────── */

const specText = fs.readFileSync(SPEC, 'utf-8')
const lines = specText.split('\n')

/** 找 §3 与 §4 的行区间 */
function sectionRange(title) {
  const s = lines.findIndex((l) => l.startsWith(title))
  if (s < 0) return null
  let e = lines.length
  for (let i = s + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { e = i; break }
  }
  return [s, e]
}

/** §3：`| **Name** | 神职 | 模块 | 状态 | 出处 |` —— 状态列以 ✅/🟡/🔵 开头 */
function parseRegistered() {
  const r = sectionRange('## §3 万神殿总览')
  if (!r) return null
  const out = new Map()
  for (let i = r[0]; i < r[1]; i++) {
    const m = /^\|\s*\*\*([A-Za-z][A-Za-z0-9]*)\*\*\s*\|(.*)$/.exec(lines[i])
    if (!m) continue
    const name = m[1]
    const cells = m[2].split('|').map((s) => s.trim())
    // cells: [神职, 模块, 状态, 出处]
    const status = cells[2] ?? ''
    const st = status.startsWith('✅') ? 'named' : status.startsWith('🟡') ? 'pending' : status.startsWith('🔵') ? 'tentative' : null
    if (!st) continue
    out.set(name, { status: st, module: cells[1] ?? '' })
  }
  return out
}

/** §4：`| **Name** | 排除原因 | 出处 |`（含 `**A / B / C**` 这种并列写法） */
function parseExcluded() {
  const r = sectionRange('## §4 排除名单')
  if (!r) return null
  const out = []
  for (let i = r[0]; i < r[1]; i++) {
    const m = /^\|\s*\*\*([^*]+)\*\*\s*\|/.exec(lines[i])
    if (!m) continue
    // 拆并列：`Aegis / Vitreus / GlassUI`、`Hyaleos / Krystallos`
    for (const raw of m[1].split('/')) {
      const n = raw.trim().replace(/^~+/, '')
      if (/^[A-Za-z][A-Za-z0-9]*$/.test(n)) out.push(n)
    }
  }
  return [...new Set(out)]
}

const registered = parseRegistered()
const excluded = parseExcluded()

if (!registered || !excluded) {
  console.error('✗ 命名规范结构变了（找不到 §3 或 §4）——门禁无法解析，按失败处理（不静默）')
  process.exit(2)
}
if (registered.size < SANITY.registered || excluded.length < SANITY.excluded) {
  console.error(
    `✗ 解析自检失败：解析到 ${registered.size} 个已登记代号 / ${excluded.length} 个排除名，` +
      `低于下限 ${SANITY.registered}/${SANITY.excluded} ⇒ 表格式可能已变（防门禁静默全过）`,
  )
  process.exit(2)
}

/* ────────────────────────── 扫描对外面 ────────────────────────── */

const SCAN_ROOTS = [
  'website/content',
  'website/guides',
  'website/en',
  'website/animation',
  'website/framework',
  'website/src',
]

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|dist|\.)/.test(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(md|ts|vue|json)$/.test(e.name)) acc.push(p)
  }
  return acc
}

/** 剥离"不是用户可见文案"的部分：注释 / <style> / 代码围栏里的代码（md 保留正文） */
function visibleText(rel, src) {
  if (rel.endsWith('.md')) return src // 文档整篇都算文案（含代码围栏——围栏里的示例也是给用户看的）
  let t = src
  if (rel.endsWith('.vue')) t = t.replace(/<style[\s\S]*?<\/style>/g, '')
  t = t.replace(/<!--[\s\S]*?-->/g, '')
  t = t.replace(/\/\*[\s\S]*?\*\//g, '')
  t = t.replace(/^\s*\/\/.*$/gm, '')
  t = t.replace(/([^:])\/\/.*$/gm, '$1') // 行尾注释（避开 http://）
  return t
}

const files = SCAN_ROOTS.flatMap((d) => walk(path.join(ROOT, d)))
const hits = [] // { rel, name, kind }

for (const abs of files) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/')
  const raw = fs.readFileSync(abs, 'utf-8')
  const text = visibleText(rel, raw)
  const words = new Set(text.match(/\b[A-Z][A-Za-z0-9]{2,}\b/g) ?? [])
  for (const name of words) {
    if (excluded.includes(name)) {
      if (!EXCLUSION_DOCS.has(rel)) hits.push({ rel, name, kind: 'excluded' })
    } else {
      const reg = registered.get(name)
      if (reg && reg.status !== 'named') hits.push({ rel, name, kind: reg.status })
    }
  }
}

/* ────────────────────────── 判定 ────────────────────────── */

console.log('[check-codenames] 万神殿命名 · 对外纪律门禁')
console.log(
  `  命名规范：已登记 ${registered.size} 个（✅ ${[...registered.values()].filter((v) => v.status === 'named').length} / ` +
    `🟡 ${[...registered.values()].filter((v) => v.status === 'pending').length} / ` +
    `🔵 ${[...registered.values()].filter((v) => v.status === 'tentative').length}）· 排除 ${excluded.length} 个`,
)
console.log(`  扫描对外面：${files.length} 个文件（${SCAN_ROOTS.join(' · ')}）`)

// 现存债务账本（每次打印，不许沉默）
const debtNames = [...new Set(hits.filter((h) => h.kind !== 'excluded').map((h) => h.name))].sort()
console.log(`\n  存量债务账本（PUBLIC_PENDING，只减不增）：${Object.keys(PUBLIC_PENDING).length} 项`)
for (const [n, note] of Object.entries(PUBLIC_PENDING)) {
  if (debtNames.includes(n)) console.log(`    · ${n} —— ${note}`)
  else console.log(`    · ${n} —— ⏳ 对外面已无使用，**可从本表删除**（棘轮回收）`)
}

const errs = []

// R1 排除名单出现在对外面 ⇒ 硬红
const badExcluded = hits.filter((h) => h.kind === 'excluded')
if (badExcluded.length) {
  errs.push(
    `[R1] **排除名单里的名字**出现在对外面（这些已检索出同域知名项目，用了就是第二次 Morpheus）：\n` +
      badExcluded.map((h) => `    ✗ ${h.name} ← ${h.rel}`).join('\n') +
      `\n    → 改成职能描述（如「声明式动画引擎」），并在 §4 记录排除原因`,
  )
}

// R2 未定名代号出现在对外面且未登记 ⇒ 硬红
const badPending = hits.filter((h) => h.kind !== 'excluded' && !(h.name in PUBLIC_PENDING))
if (badPending.length) {
  const byName = new Map()
  for (const h of badPending) {
    if (!byName.has(h.name)) byName.set(h.name, [])
    byName.get(h.name).push(h.rel)
  }
  errs.push(
    `[R2] **未定名代号（🟡/🔵）出现在对外面**，且未登记进 PUBLIC_PENDING：\n` +
      [...byName].map(([n, fs2]) => `    ✗ ${n} ← ${fs2.slice(0, 3).join(' · ')}${fs2.length > 3 ? ` …(共 ${fs2.length})` : ''}`).join('\n') +
      `\n    → 二选一：① 先完成 npm/GitHub/商标检索，状态转 ✅ 后再对外；` +
      `\n              ② 若必须现在用，在 scripts/check-codenames.mjs 的 PUBLIC_PENDING 里**登记债务**（写清检索证据 + 为什么现在不能撤）`,
  )
}

if (VERBOSE) {
  for (const h of hits) console.log(`  · ${h.rel} → ${h.name}（${h.kind}）`)
}

if (errs.length) {
  console.error('')
  for (const e of errs) console.error(`✗ ${e}\n`)
  process.exit(1)
}

console.log('\n✅ 对外面无「排除名单名字」、无「未登记的未定名代号」')
