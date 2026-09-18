#!/usr/bin/env node
// scripts/audit-degradation.mjs —— 属性降级声明门禁（EA-5 / G-31.2 · 批次 4 M6）
//   每个组件属性都必须声明 supported/fallback/unsupported（不允许空白格）；
//   fallback/unsupported 必须有**可观察降级行为**（反黑盒，03-degradation-tiers.md §4）。
//
//   ★三道检查，且**均可证伪**（非「按构造必然通过」的假绿）：
//     ① 结构：每个组件属性有声明（不得空白格）；
//     ② 反黑盒：非 supported 必须有可观察 behavior；
//     ③ 证据交叉核对：与权威官方属性清单（miniprogram-component-attrs.json）比对——
//        官方 MP 属性**不得**被判为 mp:fallback（自相矛盾）；框架 Web 专有扩展属性**不得**被判 mp:supported；
//        规则表中指向不存在属性的**陈旧规则**同样报错（避免规则静默失效）。
//
//   用法：
//     node scripts/audit-degradation.mjs            # 门禁（问题 > 0 → exit 1）
//     node scripts/audit-degradation.mjs --json     # 机器可读
//
//   SSOT = packages/component-ir/src/degradation.ts（经 tsx 载入，避免与 TS 源重复实现规则）。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const asJson = process.argv.includes('--json')

// 通过 tsx 载入 TS 规则（单一事实源——禁止在 .mjs 里复制规则表）
const probe = `
import {
  auditDegradation, formatDegradationReport, DEGRADATION_TABLE,
  RULE_REGISTERED_PROPS, HOST_FALLBACK_TAGS, degradeProp,
} from ${JSON.stringify(path.join(ROOT, 'packages/component-ir/src/degradation.ts'))}
import { PRIMITIVE_CATALOG } from ${JSON.stringify(path.join(ROOT, 'packages/component-ir/src/primitives.ts'))}
import { componentSpecs } from ${JSON.stringify(path.join(ROOT, 'scripts/lib/component-props.mjs'))}
import fs from 'node:fs'

// ★与端对齐标尺同口径：全 73 个组件（含未登记 catalog 的 11 个），props 取自组件源码真值
const specs = componentSpecs()
const official = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, 'docs/generated/miniprogram-component-attrs.json'))}, 'utf8')).components
const officialNames = new Set()
for (const rows of Object.values(official)) for (const r of rows) officialNames.add(r.name.toLowerCase())
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '\$1-\$2').toLowerCase()

const r = auditDegradation(specs)
const extra = []

// ③a 官方 MP 属性被判 mp:fallback = 自相矛盾（官方端存在却被声明为降级）
// ③b 非官方（框架 Web 专有）属性被判 mp:fallback 但无规则表依据 = 判定无出处
// ★遍历 specs（全 73 组件，与标尺同口径）而非仅 DEGRADATION_TABLE（仅 catalog 62）
const hostTags = new Set(HOST_FALLBACK_TAGS)
for (const { tag, props } of specs) {
  const isHost = hostTags.has(tag)
  for (const prop of props) {
    const entry = degradeProp(tag, prop)
    const isOfficial = officialNames.has(kebab(prop)) || officialNames.has(prop.toLowerCase())
    if (isOfficial && entry.mp !== 'supported') {
      extra.push({ tag, prop, kind: 'official-not-mp-supported', detail: '官方 MP 存在的属性被判 mp:' + entry.mp + '（自相矛盾）' })
    }
    // 非官方且非宿主族却声明 mp:fallback → 除非在规则表登记（避免判定无出处）
    if (!isOfficial && !isHost && entry.mp === 'fallback' && !RULE_REGISTERED_PROPS.includes(prop)) {
      extra.push({ tag, prop, kind: 'undocumented-mp-fallback', detail: 'mp:fallback 无规则表依据' })
    }
  }
}

// ③c 陈旧规则：规则表登记的属性必须在**组件源码**中存在（规则静默失效检测）
//   ★参照基准是 specs（组件源码 defineProps 真值），**不是 PRIMITIVE_CATALOG**——
//   catalog 的 props 与源码存在历史脱节（如 p-input 在 catalog 记 4 项而源码有 26 项、
//   p-list-view 未登记 catalog）。拿 catalog 当参照会把「源码里真实存在、只是 catalog 没记」
//   误判为陈旧规则（假红）。组件属性的真值来源是源码（与端对齐标尺同口径）。
const allProps = new Set(specs.flatMap(s => s.props))
for (const prop of RULE_REGISTERED_PROPS) {
  if (!allProps.has(prop)) extra.push({ tag: '(规则表)', prop, kind: 'stale-rule', detail: '规则登记了源码中不存在的属性（规则已失效，应删除或改名）' })
}
// ③d 宿主族 tag 必须在实际组件中存在
const allTags = new Set(specs.map(s => s.tag))
for (const tag of HOST_FALLBACK_TAGS) {
  if (!allTags.has(tag)) extra.push({ tag, prop: '(规则表)', kind: 'stale-host-tag', detail: '宿主族 tag 不存在于组件库' })
}

const issues = [...r.issues, ...extra]
const ok = issues.length === 0
if (${asJson}) console.log(JSON.stringify({ ...r, issues, ok }))
else {
  console.log(formatDegradationReport({ ...r, issues, ok }))
  if (extra.length) {
    console.log('  ── 证据交叉核对问题：')
    for (const i of extra.slice(0, 20)) console.log('    - [' + i.tag + '] ' + i.prop + '：' + i.detail)
    if (extra.length > 20) console.log('    …另有 ' + (extra.length - 20) + ' 项')
  }
}
process.exit(ok ? 0 : 1)
`
const res = spawnSync('npx', ['tsx', '-e', probe], { cwd: ROOT, encoding: 'utf8' })
const out = (res.stdout ?? '').trim()
const err = (res.stderr ?? '').trim()
if (out) console.log(out)
if (res.status !== 0) {
  if (!asJson && err) console.error(err)
  if (!out) console.error(err)
  process.exit(1)
}
if (!asJson) console.log('\n✅ 降级声明门禁通过（EA-5：无空白格 + fallback 均可观察 + 与官方清单交叉核对一致）')
