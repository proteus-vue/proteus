#!/usr/bin/env node
// scripts/gen-capability-priority.mjs —— ★NC0 交付物：《能力实现优先级表》（生成式）
//
// 【为什么生成而不是手写（本仓纪律：手写 = 第 N 份副本，漂移静默）】
//   NC0（`docs/Proteus_原生能力接入方案.md` §9）的出口是《能力实现优先级表》。
//   若手写：82 个能力的域/状态/承接面会随源码改动静默过期（本仓已实测多次）。
//   ⇒ 本脚本汇总**三类机器可算的事实**，产出优先级表；`--check` 接门禁（漂移即红）。
//
// 【三类事实源（缺一不可）】
//   ① **能力清单**（SSOT）：`PRIMITIVE_CATALOG` kind=capability —— 82 项（id/semantic/api/status/mpEquiv）
//      + 分域（`capabilityDomainOf` —— 与官网能力页分组**同一事实源**，2026-09-30 抽出）
//   ② **需求证据**：本仓消费侧语料（showcase / examples / website/src）的 **Hook 调用点聚合**。
//      ★口径（必须写死，否则数字不可复现）：只计 `useXxx(` 调用形态且 Xxx ∈ 82 Hook 名单；
//        排除 node_modules / dist / scripts / tests / *.d.ts / *.test.* / generated。
//      ★**跨项目覆盖数优先于单项目频次**（方案 §1.1 的优先级算法：「被几个项目用到」> 单项目调用次数）。
//      ★诚实边界：语料=本仓 3 个自有工程（非真实业务项目）⇒ 这是**下界**，真实需求证据待接入补齐。
//   ③ **官方承接面**：微信官方 API 清单（`docs/generated/miniprogram-official-spec.json`，495 个）
//      经 `classifySpecApi` 反查 —— 每个 Hook 承接了几个官方 API（covered 且 proteus 串含该 Hook 名）。
//      这是「完整性标尺」：承接越多 = 收敛缺口越大时影响面越大。
//
// 【成本等级（S/M/L=1/3/8）】★机器不可算——**不编造**：表中该列显式标 `⏳ 待人工估`，
//   由 NC0 出口时人工填写（方案 §1.1 的算法要它，但只能人给）。
//
// 用法：
//   node scripts/gen-capability-priority.mjs          # 生成
//   node scripts/gen-capability-priority.mjs --check  # 校验（漂移即红，接 verify 链）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(ROOT, 'docs/generated/capability-priority.md')
const CHECK = process.argv.includes('--check')

// ── 事实源 ① + ③：求值真实源码（tsx 子进程）──────────────────────────────
const probe = `
import { PRIMITIVE_CATALOG } from ${JSON.stringify(path.join(ROOT, 'packages/component-ir/src/index.ts'))}
import { classifySpecApi } from ${JSON.stringify(path.join(ROOT, 'packages/component-ir/src/mp-spec-coverage.ts'))}
import { capabilityDomainOf, auditCapabilityDomains } from ${JSON.stringify(path.join(ROOT, 'packages/component-ir/src/capability-domains.ts'))}
import fs from 'node:fs'
import path from 'node:path'
const root = ${JSON.stringify(ROOT)}
const caps = PRIMITIVE_CATALOG.filter((p) => p.kind === 'capability')
const hooks = new Set(caps.map((c) => String(c.api).replace('()', '')))
// 官方 API 承接面：spec.apis × classifySpecApi ⇒ 反查 proteus 串里出现的 Hook 名
const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs/generated/miniprogram-official-spec.json'), 'utf8'))
const officialByHook = {}
let coveredTotal = 0
for (const name of spec.apis) {
  const c = classifySpecApi(name)
  if (c.status !== 'covered' || !c.proteus) continue
  coveredTotal++
  for (const h of hooks) if (c.proteus.includes(h)) officialByHook[h] = (officialByHook[h] ?? 0) + 1
}
const rows = caps.map((c) => ({
  id: c.id,
  semantic: c.semantic,
  api: String(c.api),
  hook: String(c.api).replace('()', ''),
  status: c.status,
  tier: c.tier,
  domain: capabilityDomainOf(c.semantic),
  mpEquiv: c.mpEquiv,
  tag: c.tag ?? '',
  officialApis: officialByHook[String(c.api).replace('()', '')] ?? 0,
}))
// (Hook 可用性判据在主脚本侧计算——见下方「事实源 ①-b」)
console.log(JSON.stringify({
  rows,
  officialCoveredTotal: coveredTotal,
  specApiCount: spec.apis.length,
  unregisteredDomains: auditCapabilityDomains(caps.map((c) => String(c.semantic).replace('capability.', ''))),
}))
`

const raw = execFileSync('npx', ['tsx', '-e', probe], { cwd: ROOT, encoding: 'utf-8', timeout: 300000 })
const facts = JSON.parse(raw.trim().split('\n').pop())
const { rows } = facts

// ── 事实源 ①-b：**Hook 是否真的可用**（机械判据，不靠 catalog 的 status 字段）────────────
//
// 【为什么必须单独算（本仓实测的口径陷阱）】catalog 里的 status 对**能力项**是**类别标记**，
//   不是实现状态——源码注释写明「纯 Hook，无 C-IR 节点 → planned」（C3 / C3 批 2 / 组件实例批）。
//   ⇒ 若直接把该字段当"已实现/未实现"，会把 useStorage / useNetwork 这些**日常在用的能力**
//     读成"planned（待实现）"——本表首版正是如此，属**误导性列**（已从表中移除该字段）。
//   真实判据 = Hook 是否在 CapabilityHooks 接口里声明（= API 层可直接调用）。
//   ★判据必须认**泛型方法签名** useFetch<T>(...)——本仓同类正则盲区已犯过两次
//   （MP 快照抽取器 298→495；本判据首版也漏了 useFetch）。
{
  const apiSrc = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability.ts'), 'utf8')
  const ifaceStart = apiSrc.indexOf('export interface CapabilityHooks')
  if (ifaceStart < 0) throw new Error('capability.ts 中未找到 CapabilityHooks 接口（结构变了？）')
  const ifaceOpen = apiSrc.indexOf('{', ifaceStart)
  let depth = 0
  let ifaceEnd = -1
  for (let i = ifaceOpen; i < apiSrc.length; i++) {
    if (apiSrc[i] === '{') depth++
    else if (apiSrc[i] === '}') { depth--; if (depth === 0) { ifaceEnd = i; break } }
  }
  if (ifaceEnd < 0) throw new Error('CapabilityHooks 接口括号未闭合')
  const ifaceBody = apiSrc.slice(ifaceOpen + 1, ifaceEnd)
  const declared = new Set()
  for (const m of ifaceBody.matchAll(/^\s+(use[A-Z]\w*)\s*(?:<|\()/gm)) declared.add(m[1])
  for (const r of rows) r.hookImplemented = declared.has(r.hook)
  const notImpl = rows.filter((r) => !r.hookImplemented)
  if (notImpl.length) {
    throw new Error(
      `${notImpl.length} 个能力的 Hook 未在 CapabilityHooks 接口声明：` + notImpl.map((r) => r.api).join(', ') +
        ' —— 要么补声明，要么从 catalog 移除（勿静默：会让"能力可用性"数字失真）',
    )
  }
}

// ── 事实源 ②：消费侧语料的 Hook 调用点聚合 ────────────────────────────────
// ★口径写死（见文件头）；改动本处 = 改动测量定义，须同步更新文档头部的口径说明。
const PROJECTS = { showcase: 'showcase', examples: 'examples', website: 'website/src' }
const HOOK_CALL_EXCLUDE = /(node_modules|\/dist\/|(^|\/)scripts\/|(^|\/)tests?\/|\.d\.ts$|\.test\.|\.spec\.|generated)/

function scanProject(rel) {
  const rootDir = path.join(ROOT, rel)
  const counts = new Map()
  if (!fs.existsSync(rootDir)) return counts
  const hooks = new Set(rows.map((r) => r.hook))
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.(vue|ts|tsx|js|mjs)$/.test(e.name)) continue
      if (HOOK_CALL_EXCLUDE.test(p)) continue
      const s = fs.readFileSync(p, 'utf8')
      for (const m of s.matchAll(/\b(use[A-Z][A-Za-z0-9]*)\s*\(/g)) {
        if (hooks.has(m[1])) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
      }
    }
  }
  walk(rootDir)
  return counts
}

const perProject = {}
for (const [name, rel] of Object.entries(PROJECTS)) perProject[name] = scanProject(rel)

for (const r of rows) {
  const projects = []
  let total = 0
  for (const [name, counts] of Object.entries(perProject)) {
    const n = counts.get(r.hook) ?? 0
    if (n > 0) projects.push(name)
    total += n
  }
  r.projects = projects
  r.calls = total
}

// ── 排序（优先级算法：跨项目覆盖 > 语料频次 > 官方承接面 > 编号）──────────
const sorted = [...rows].sort(
  (a, b) =>
    b.projects.length - a.projects.length ||
    b.calls - a.calls ||
    b.officialApis - a.officialApis ||
    a.id.localeCompare(b.id, undefined, { numeric: true }),
)

// ── 生成文档 ──────────────────────────────────────────────────────────────
const CAT_ORDER = ['网络与通信', '设备与系统', '存储与文件', '位置与地图', '媒体与扫码', '账号与支付', '通知与分享', '应用与生命周期', '可观测与调试', '其他']
const used = rows.filter((r) => r.calls > 0)
const crossProject = rows.filter((r) => r.projects.length >= 2)
const withOfficial = rows.filter((r) => r.officialApis > 0)

const lines = []
lines.push('# 能力实现优先级表（NC0 交付物 —— 生成物，勿手改）')
lines.push('')
lines.push('> **生成**：`node scripts/gen-capability-priority.mjs`（`--check` 接 verify/CI，漂移即红）')
lines.push('> **卡**：NC0「能力清单扫描」（`docs/Proteus_原生能力接入方案.md` §9）· **性质**：能力扩充优先级的**唯一事实源**')
lines.push('> **决策背景**：用户 2026-09-30 裁定本线为战略线（目标「业务代码 99% 不用手写原生插件」）')
lines.push('')
lines.push('## 0. 三类事实源与口径（复现前提）')
lines.push('')
lines.push('| 事实源 | 内容 | 口径 |')
lines.push('|---|---|---|')
lines.push(`| ① 能力清单（SSOT） | ${rows.length} 个 capability（\`PRIMITIVE_CATALOG\` kind=capability） | 域来自 \`capabilityDomainOf\`（与官网能力页分组同一事实源） |`)
lines.push(`| ② 需求证据 | 本仓消费侧语料（showcase / examples / website/src）Hook 调用点 | 只计 \`useXxx(\` 且 Xxx ∈ ${rows.length} 名单；排除 node_modules / dist / scripts / tests / *.d.ts / generated |`)
lines.push(`| ③ 官方承接面 | 微信官方 API 清单（${facts.specApiCount} 个）中该 Hook 承接的 covered 数 | \`classifySpecApi\` 反查 proteus 串（跨端对等标尺） |`)
lines.push('')
lines.push('**优先级算法（方案 §1.1）**：跨项目覆盖数 **优先于** 单项目频次；成本加权 S/M/L=1/3/8。')
lines.push('')
lines.push('**列含义（★防误读）**：')
lines.push('- **Hook 可用** = Hook 是否在 `CapabilityHooks` 接口声明（**机械判据**——API 层可直接调用，双端桥/降级见各能力页）；')
lines.push('- **组件形态** = 该能力是否有 `p-*` 组件标签（`纯 Hook` = 无组件形态，只有函数式入口）；')
lines.push('- ★**不要**把 catalog 的 `status` 字段读成「已实现/未实现」：对能力项它是**类别标记**（`planned` = 纯 Hook 无 C-IR 节点），源码注释已写明。本表因此**不展示**该字段（首版曾展示 ⇒ 把 useStorage/useNetwork 等日常在用的能力读成「待实现」，属误导）。')
lines.push('')
lines.push('**★诚实边界（必读）**：')
lines.push('- 语料 = 本仓 **3 个自有工程**（非真实业务项目）⇒ 需求数字是**下界**；真实证据待接入超级应用后补齐（与《实战采集埋点清单》同一原则）；')
lines.push('- **成本等级机器不可算**——表中该列标 `⏳ 待人工估`，**不编造数字**；NC0 出口时人工按 S/M/L=1/3/8 填写；')
lines.push('- 「官方承接面」只统计 MP 官方 API（组件侧经 MP_MAPPING_MATRIX 另算）；**超清单能力**（如 webassembly，不在官方 301 清单）承接数为 0 属正常。')
lines.push('')
lines.push('## 1. 汇总')
lines.push('')
lines.push(`- **能力总数**：${rows.length} · 语料出现过：**${used.length}** · 跨项目（≥2 工程）：**${crossProject.length}**`)
lines.push(`- **有官方承接**：${withOfficial.length} / ${rows.length}（合计承接 covered API ${facts.officialCoveredTotal} / ${facts.specApiCount}）`)
lines.push(`- **未登记分域**：${facts.unregisteredDomains.length}（应为 0——非 0 即新能力漏登记，见 \`auditCapabilityDomains\`）`)
lines.push('')
lines.push('## 2. 优先级表（按 跨项目覆盖 ↓ · 语料频次 ↓ · 官方承接 ↓）')
lines.push('')
lines.push('| # | 优先信号 | 编号 | Hook | 域 | 跨项目 | 语料频次 | 官方承接 | Hook 可用 | 组件形态 | 成本（S/M/L=1/3/8） |')
lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
sorted.forEach((r, i) => {
  const signal = r.projects.length >= 2 ? '★★' : r.calls > 0 ? '★' : r.officialApis > 0 ? '△' : '·'
  const proj = r.projects.length ? r.projects.join('+') : '—'
  const impl = r.hookImplemented ? '✅' : '❌'
  const shape = r.tag ? '组件+Hook' : '纯 Hook'
  lines.push(`| ${i + 1} | ${signal} | ${r.id} | \`${r.api}\` | ${r.domain} | ${proj} | ${r.calls} | ${r.officialApis} | ${impl} | ${shape} | ⏳ 待人工估 |`)
})
lines.push('')
lines.push('> 优先信号：★★ = 跨项目覆盖（最高证据）· ★ = 单项目有真实调用 · △ = 仅官方承接面（无本仓调用，属完整性缺口）· · = 暂无双侧信号')
lines.push('')
lines.push('## 3. 按域汇总')
lines.push('')
lines.push('| 域 | 能力数 | 跨项目 | 语料用过 | 官方承接合计 |')
lines.push('|---|---|---|---|---|')
for (const cat of CAT_ORDER) {
  const inCat = rows.filter((r) => r.domain === cat)
  if (!inCat.length) continue
  lines.push(
    `| ${cat} | ${inCat.length} | ${inCat.filter((r) => r.projects.length >= 2).length} | ${inCat.filter((r) => r.calls > 0).length} | ${inCat.reduce((a, r) => a + r.officialApis, 0)} |`,
  )
}
lines.push('')
lines.push('## 4. NC0 出口的剩余人工步骤')
lines.push('')
lines.push('1. **成本列**：按实现面（wx 桥 + web 兜底 + 宿主原生落地的实际工作量）估 S/M/L；')
lines.push('2. **真实语料**：接入真实业务项目后重跑本脚本（口径不变），替换"本仓 3 工程"下界；')
lines.push('3. **挑批**：按 `跨项目数 × 1/成本权重` 排序取批次 → 进 NC2「内置能力扩充」。')
lines.push('')

const content = lines.join('\n')

// ── 写盘 / 校验 ───────────────────────────────────────────────────────────
if (CHECK) {
  // ★先查分域完整性（更精确的原因优先报）：新能力漏登记 ⇒ 直接指名，不让它伪装成"表漂移"
  //   （本仓纪律：装置/判据失效要报**装置错**，不伪装成被测对象的回归）
  if (facts.unregisteredDomains.length) {
    console.error(`DRIFT: ${facts.unregisteredDomains.length} 个能力未登记分域（packages/component-ir/src/capability-domains.ts）：${facts.unregisteredDomains.join(', ')}`)
    console.error('      ⇒ 新能力落地时必须在分域表登记（否则官网分组与优先级表都落入「其他」兜底）')
    process.exit(1)
  }
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (current !== content) {
    console.error('DRIFT: docs/generated/capability-priority.md 与源不一致 —— 运行 node scripts/gen-capability-priority.mjs 并提交')
    process.exit(1)
  }
  console.log(`CHECK OK — 能力优先级表与源一致（${rows.length} 能力 · 跨项目 ${crossProject.length} · 分域 0 缺口）`)
} else {
  fs.writeFileSync(OUT, content)
  console.log(`generated: ${path.relative(ROOT, OUT)}（${rows.length} 能力 · 跨项目 ${crossProject.length} · 语料用过 ${used.length}）`)
}
