// scripts/gen-css-support.mjs —— ★CSS 逐属性「多端支持参考」生成器（决策 #699 · #capa 重做）
//
// 【回答什么（用户诉求）】官网要一份**逐属性可查参考**：每个 CSS 能力在 Web / Skyline / App 三端到底
//   支不支持、App 可扩展档位、策略、语义/边界注记。★重做（用户「能力矩阵都是表格看着不方便，且无法做
//   每个能力的跳转锚点，按大厂生产标准重做」）：
//     · 旧版 = 单张 79 行大表格（横向 8 列，窄屏难读、无锚点）；
//     · 新版 = 「按类别分节（h2）+ 每个能力独立小节（h3，稳定锚点 `{#id}`）+ 顶部能力索引（可跳转）」
//       ——右侧页内导航逐能力可点、每项可被外链深链引用（对标 MDN / Can I Use 的属性参考形态）。
//
// 【SSOT】`docs/generated/css-capability-alignment.json`（由 `scripts/gen-css-capability-alignment.mjs`
//   从 Web 真值（Playwright）+ Skyline 官方表 + App 代码事实三源生成）。本生成器**只渲染、不判断**——
//   任何"支持与否"的口径变更都在上游 SSOT，避免第二份真相。
//
// 【锚点契约】能力小节的锚点 id = SSOT 行的 `id` 字段（显式 `{#id}`，不受标题文本变化影响）——
//   测试/文档/外部引用可据此稳定深链（`/docs/reference/css-support#backdrop-filter` 等）。
//
// 【产物】`website/content/reference/css-support.md`（zh）+ `website/en/reference/css-support.md`（EN overlay）
// 用法：node scripts/gen-css-support.mjs [--check]（--check 漂移门禁：与 SSOT 不一致 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))     // website/scripts
const WEB = path.resolve(HERE, '..')                           // website/
const REPO = path.resolve(HERE, '..', '..')                    // 仓库根（SSOT 在 docs/generated）
const SRC = path.join(REPO, 'docs', 'generated', 'css-capability-alignment.json')
const OUT = path.join(WEB, 'content', 'reference', 'css-support.md')
const OUT_EN = path.join(WEB, 'en', 'reference', 'css-support.md')
const check = process.argv.includes('--check')

const data = JSON.parse(fs.readFileSync(SRC, 'utf-8'))
const rows = data.rows ?? []
const profile = data.profile ?? {}

/** 类别中文标签（渲染用；未列出的透传原值） */
const CAT_LABEL = {
  layout: '布局', paint: '绘制', text: '文本', value: '取值', unit: '单位',
  special: '特殊', motion: '动效', selector: '选择器', cascade: '层叠', 'at-rule': '@ 规则', layer: '层',
}
/** 策略 EN 标签 */
const STRATEGY_EN = {
  编译期折叠: 'compile-time fold', 直映射: 'direct mapping', 宿主几何: 'host geometry',
  宿主绘制: 'host-drawn', 降级: 'degrade', 独立通道: 'dedicated channel', 语义组件: 'semantic component',
  禁止: 'forbidden', 简写展开: 'shorthand expand',
}
/** 对齐档 EN */
const TIER_EN = { universal: 'universal', conditional: 'conditional', unsupported: 'unsupported' }
/** 端支持态展示（三端共用一张映射；`—` 保持） */
const stateZh = (v) => ({ supported: '✅ 支持', partial: '◐ 部分', 'not-measured': '◻ 未测', 'not-listed': '◻ 未列', absent: '✗ 无', '—': '—' }[v] ?? String(v))
const stateEn = (v) => ({ supported: '✅ yes', partial: '◐ partial', 'not-measured': '◻ n/a', 'not-listed': '◻ not listed', absent: 'no', '—': '—' }[v] ?? String(v))
/** 表格单元格转义（防 `|` 破坏列） */
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
/** 索引表内链文本：剥 `[` `]`（否则破坏 markdown 链接语法——如「属性选择器 [data-x]」） */
const linkText = (s) => String(s).replace(/[[\]]/g, '')

/** 按类别分组（保持 SSOT 出现序） */
function byCategory() {
  const order = []
  const map = new Map()
  for (const r of rows) {
    const c = r.category ?? 'other'
    if (!map.has(c)) { map.set(c, []); order.push(c) }
    map.get(c).push(r)
  }
  return { order, map }
}

/** 计数（按字段取值聚合） */
function tally(field, value) {
  return rows.filter((r) => r[field] === value).length
}

/** 每能力支持明细行（三端 + 档位 + 策略 + 对齐）——zh（词面）/ en（词面）各一 */
function badgeZh(r) {
  return `**Web** ${stateZh(r.web)} · **Skyline** ${stateZh(r.skyline)} · **App** ${stateZh(r.app)} · `
    + `**App 可扩展** ${cell(r.tier)} · **策略** ${cell(r.strategy)} · **对齐** ${cell(r.supportTier)}`
}
function badgeEn(r) {
  return `**Web** ${stateEn(r.web)} · **Skyline** ${stateEn(r.skyline)} · **App** ${stateEn(r.app)} · `
    + `**App extensible** ${cell(r.tier)} · **Strategy** ${cell(STRATEGY_EN[r.strategy] ?? r.strategy)} · **Alignment** ${cell(TIER_EN[r.supportTier] ?? r.supportTier)}`
}

/** 小表（表头 + 数据行）→ markdown 行数组 */
function smallTable(head, bodyRows) {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...bodyRows.map((r) => `| ${r.join(' | ')} |`)]
}

function bodyZh() {
  const { order, map } = byCategory()
  const uni = tally('supportTier', 'universal')
  const cond = tally('supportTier', 'conditional')
  const un = tally('supportTier', 'unsupported')
  const appSup = tally('app', 'supported')
  const appAbsent = tally('app', 'absent')

  const out = []
  out.push('---')
  out.push('title: CSS 多端支持参考')
  out.push('order: 43')
  out.push('group: 工程参考')
  out.push('generated: true')
  out.push('---')
  out.push('')
  out.push('# CSS 多端支持参考')
  out.push('')
  out.push(`> ${rows.length} 项 CSS 能力在 **Web / Skyline / App 三端**的支持现状与可扩展档位。**每项能力均带独立锚点**（右侧页内导航可逐项跳转、可被外链深链引用），支持度以 **Web 真值为基准**，App 端自研引擎按 **L0–L5 成本分级**。`)
  out.push('> ★自动生成（`scripts/gen-css-support.mjs`），SSOT = `docs/generated/css-capability-alignment.json`；漂移门禁 `--check`。')
  out.push('')
  out.push('## 概览')
  out.push('')
  out.push(`共 **${rows.length}** 项：三端全支持（universal）**${uni}** 项 · 条件支持（conditional）**${cond}** 项 · 三端不可用（unsupported）**${un}** 项。App 端当前**已支持 ${appSup} 项**、**暂缺 ${appAbsent} 项**（候选特性按 L 档扩展）。`)
  out.push('')
  out.push('### 端模型')
  out.push('')
  out.push('- **Web** —— 浏览器原生 CSSOM（真值基准）。')
  out.push('- **Skyline** —— 微信小程序容器（唯一刚性外部约束）。')
  out.push('- **App** —— 自研自绘 Rust 引擎（一套，覆盖 iOS / Android / 鸿蒙 三平台；CSS 面由我们定义、可扩展）。')
  out.push('')
  out.push('### App 现状取值口径')
  out.push('')
  out.push(...smallTable(['取值', '含义'], Object.entries(profile.todayValues ?? {}).map(([k, v]) => [`\`${cell(k)}\``, cell(v)])))
  out.push('')
  out.push('### App 可扩展档位（L0–L5 成本分级）')
  out.push('')
  out.push(...smallTable(['档位', '含义'], Object.entries(profile.tiers ?? {}).map(([k, v]) => [cell(k), cell(v)])))
  out.push('')
  out.push('## 能力索引')
  out.push('')
  out.push('> 点击任一能力跳到其详情小节（每项皆有稳定锚点，可被外链直接引用）。')
  out.push('')
  out.push(...smallTable(['类别', '能力'], order.map((c) => {
    const links = map.get(c).map((r) => `[${cell(linkText(r.css))}](#${r.id})`).join(' · ')
    return [`[${CAT_LABEL[c] ?? c}](#cat-${c})`, links]
  })))
  out.push('')
  out.push('## 逐能力参考')
  out.push('')
  for (const c of order) {
    const items = map.get(c)
    out.push(`## ${CAT_LABEL[c] ?? c} · ${items.length} 项 {#cat-${c}}`)
    out.push('')
    for (const r of items) {
      out.push(`### ${r.css} {#${r.id}}`)
      out.push('')
      out.push(badgeZh(r))
      out.push('')
      if (r.note) {
        out.push(`> ${r.note}`)
        out.push('')
      }
    }
  }
  out.push('> 复现：能力验收项目（`css-conformance`）逐页对照本表；语义边界以各端实测为准。')
  out.push('')
  out.push('<!-- generated by scripts/gen-css-support.mjs · SSOT：docs/generated/css-capability-alignment.json -->')
  return out.join('\n')
}

function bodyEn() {
  const { order, map } = byCategory()
  const uni = tally('supportTier', 'universal')
  const cond = tally('supportTier', 'conditional')
  const un = tally('supportTier', 'unsupported')
  const appSup = tally('app', 'supported')
  const appAbsent = tally('app', 'absent')

  // 英文图例（比 SSOT 中文更短、面向英文读者）
  const todayEn = {
    supported: 'compile-time fold + engine + host drawing all pass (actually on screen)',
    'folded-only': 'folded into the kernel tree at compile time, but the host does not draw it yet (read honestly, not as supported)',
    'engine-only': 'engine / host can already draw it, but the compile-time fold surface is not wired yet (an available extension point)',
    absent: 'not present today (candidate; see tier / strategy)',
  }
  const tierEn = {
    L0: 'zero runtime cost (fully foldable at compile time: selectors / cascade / inheritance / specificity / unit conversion)',
    L1: 'low runtime cost (pure drawing / direct mapping; e.g. backgroundColor / border-radius / opacity)',
    L2: 'moderate cost (supported on demand; flex / position / overflow / grid — needs layout and containing-block resolution)',
    L3: 'high cost (off by default; z-index / fixed·sticky / 3D / filter / shadow / will-change — affects compositing layers and memory)',
    L4: 'not in-house (reuse the platform: fonts / BiDi / emoji / complex rich text)',
    L5: 'forbidden (compile-time error: runtime dynamic selectors / unfoldable cascade / runtime stylesheet insertion / beyond profile)',
  }

  const out = []
  out.push('---')
  out.push('title: CSS cross-end support reference')
  out.push('order: 43')
  out.push('group: 工程参考')
  out.push('generated: true')
  out.push('---')
  out.push('')
  out.push('# CSS cross-end support reference')
  out.push('')
  out.push(`> How ${rows.length} CSS capabilities are supported across **Web / Skyline / App**, with App extensibility tier. **Every capability has its own anchor** (jump from the on-page outline; deep-linkable from anywhere), measured against the **Web baseline**, with the in-house Rust engine graded **L0–L5**.`)
  out.push('> ★Auto-generated (`scripts/gen-css-support.mjs`), SSOT = `docs/generated/css-capability-alignment.json`; drift gate `--check`.')
  out.push('')
  out.push('## Overview')
  out.push('')
  out.push(`**${rows.length}** capabilities: **${uni}** universal · **${cond}** conditional · **${un}** unsupported. App currently supports **${appSup}**, with **${appAbsent}** not present yet (candidates graded by tier).`)
  out.push('')
  out.push('### End model')
  out.push('')
  out.push('- **Web** — native browser CSSOM (the baseline).')
  out.push('- **Skyline** — WeChat Mini Program container (the one rigid external constraint).')
  out.push('- **App** — in-house self-drawn Rust engine (one engine, covering iOS / Android / HarmonyOS; the CSS surface is ours to define and extend).')
  out.push('')
  out.push('### App status values')
  out.push('')
  out.push(...smallTable(['Value', 'Meaning'], Object.entries(profile.todayValues ?? {}).map(([k, v]) => [`\`${cell(k)}\``, cell(todayEn[k] ?? v)])))
  out.push('')
  out.push('### App extensibility tiers (L0–L5 cost levels)')
  out.push('')
  out.push(...smallTable(['Tier', 'Meaning'], Object.entries(profile.tiers ?? {}).map(([k, v]) => [cell(k), cell(tierEn[k] ?? v)])))
  out.push('')
  out.push('## Capability index')
  out.push('')
  out.push('> Click any capability to jump to its section (each has a stable, deep-linkable anchor).')
  out.push('')
  out.push(...smallTable(['Category', 'Capabilities'], order.map((c) => {
    const links = map.get(c).map((r) => `[${cell(linkText(r.css))}](#${r.id})`).join(' · ')
    return [`[${CAT_LABEL[c] ?? c}](#cat-${c})`, links]
  })))
  out.push('')
  out.push('## Per-capability reference')
  out.push('')
  for (const c of order) {
    const items = map.get(c)
    out.push(`## ${CAT_LABEL[c] ?? c} · ${items.length} {#cat-${c}}`)
    out.push('')
    for (const r of items) {
      out.push(`### ${r.css} {#${r.id}}`)
      out.push('')
      out.push(badgeEn(r))
      out.push('')
      out.push(`> ${STRATEGY_EN[r.strategy] ?? r.strategy} · ${TIER_EN[r.supportTier] ?? r.supportTier}`)
      out.push('')
    }
  }
  out.push('> Reproduce: the capability acceptance project (`css-conformance`) verifies each page against this matrix; end-specific boundaries follow real device measurement.')
  out.push('')
  out.push('<!-- generated by scripts/gen-css-support.mjs (en overlay) · SSOT: docs/generated/css-capability-alignment.json -->')
  return out.join('\n')
}

const md = bodyZh()
const mdEn = bodyEn()

if (check) {
  const a = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : null
  const b = fs.existsSync(OUT_EN) ? fs.readFileSync(OUT_EN, 'utf-8') : null
  if (a === md && b === mdEn) {
    console.log('CHECK OK — CSS 支持参考与 SSOT 一致')
  } else {
    console.error('DRIFT: content/reference/css-support.md 与 docs/generated/css-capability-alignment.json 不一致——运行 npm run gen:css-support 并提交')
    process.exit(1)
  }
} else {
  fs.writeFileSync(OUT, md)
  fs.mkdirSync(path.dirname(OUT_EN), { recursive: true })
  fs.writeFileSync(OUT_EN, mdEn)
  console.log(`generated: content/reference/css-support.md + en overlay（${rows.length} 项 CSS，逐能力锚点）`)
}
