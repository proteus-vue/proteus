#!/usr/bin/env node
// scripts/gen-style-baseline-manifest.mjs —— ★★★G-61 B0：**Web 基准 manifest**（基准守护的载体）
//
// 【它解决什么（立项勘察 G6：没有基准资产）】
//   决策 #546 定调「一致性的 expected 唯一来源 = **Web 视觉**」，#542/#543/#545 三轮实践已按此做——
//   但那是**靠人或代理临时执行**：没有冻结的基准快照、没有环境指纹、没有变更审批。
//   ⇒ 基准随运行漂移 ⇒ 差异无法归因；且"三端同时偏且一致"会被判绿（D1 缺陷）。
//   本脚本把基准**登记成可寻址清单**（`docs/generated/style-baseline/manifest.json`）。
//
// 【基准三件套（plan `03-consistency-gates.md` §1.1）】
//   B-a 计算样式（getComputedStyle）· B-b 几何（getBoundingClientRect）· B-c 视觉（真渲染截图）
//
// 【基准的四条纪律（plan §1.3）】D1 单一（end-to-end 只以 Web 为 expected）· D2 冻结（golden 入仓，
//   不靠当场重跑）· D3 可复现（登记环境指纹：浏览器/DPR/视口/字体/主题）· D4 基准自身合法（先过 lint）。
//
// 【判据（--check）】
//   ① schema：每条样本 id/kind/path/recordedAt 齐备；kind ∈ {computed-style, geometry, screenshot}
//   ② 寻址：每条样本的 `path` 在仓库中**存在**（基线不得贴一个不存在的文件）
//   ③ 指纹同源（★关键设计）：清单里的 fingerprint **从采集产物 `env` 机器读取**、不手抄——
//      并校验"清单 == 产物 env"（抄错、或重采后未刷清单，都会红）。产物缺失 ⇒ 直接违约。
//   ④ 合法（D4）：样本须带 `expect.anchors`（预期锚点文本）；产物须非空（nodes 有 computed 读数）
//   ⑤ 冻结（D2）：本清单本身参与幂等校验——改基准（含重采）必须是一次可见提交
//
// 【诚实边界】采集器 = `scripts/collect-style-baseline.mjs`（真 Playwright 采集，见其头注）；
//   本脚本只**登记与校验**，不采集。当前入口样本 = superapp 的「我的」页。
//   ★写入守卫（D5）：基准只由采集器产出——被测端（App/Skyline）脚本只读，不得写入。
//
// 用法：
//   node scripts/gen-style-baseline-manifest.mjs            # 生成 + 跑判据
//   node scripts/gen-style-baseline-manifest.mjs --check    # 只校验
//   node scripts/gen-style-baseline-manifest.mjs --update   # 写回 manifest
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = path.join(ROOT, 'docs/generated/style-baseline')
const OUT = path.join(BASE, 'manifest.json')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const UPDATE = argv.includes('--update')

/** 样本的**静态声明**（id/kind/path/锚点/来源）；`fingerprint` 由产物机器推导（D3——不手抄） */
const SAMPLE_DECLS = [
  {
    id: 'superapp-mine-computed-style',
    kind: 'computed-style',
    page: 'superapp/pages/mine.vue',
    route: '/pages/mine',
    path: 'docs/generated/style-baseline/superapp-mine.computed.json',
    baselineSensitive: null,
    expect: { anchors: ['验收控制台', 'v0.1.0 · Proteus 超级应用', '深色模式', '客服悬浮球'] },
    recordedAt: '2026-10-05',
    recordedBy: 'G-61 B0（采集器 scripts/collect-style-baseline.mjs · 真 Playwright chromium）',
  },
  {
    id: 'superapp-mine-geometry',
    kind: 'geometry',
    page: 'superapp/pages/mine.vue',
    route: '/pages/mine',
    path: 'docs/generated/style-baseline/superapp-mine.geometry.json',
    baselineSensitive: null,
    expect: { anchors: ['验收控制台'] },
    recordedAt: '2026-10-05',
    recordedBy: 'G-61 B0（同批采集——与 B-a 同一 env）',
  },
  {
    id: 'superapp-mine-screenshot',
    kind: 'screenshot',
    page: 'superapp/pages/mine.vue',
    route: '/pages/mine',
    path: 'docs/generated/style-baseline/superapp-mine.png',
    baselineSensitive: null,
    expect: { anchors: ['验收控制台', '深色模式'] },
    recordedAt: '2026-10-05',
    recordedBy: 'G-61 B0（视口幅截图——与 B-a/B-b 同一 env）',
  },
]

/** ★D3 指纹：从**采集产物**读取（机器推导——不手抄，抄写必然漂移） */
function fingerprintFromArtifact() {
  const computedPath = path.join(BASE, 'superapp-mine.computed.json')
  if (!fs.existsSync(computedPath)) return null
  let m
  try {
    m = JSON.parse(fs.readFileSync(computedPath, 'utf-8'))
  } catch {
    return null
  }
  const env = m.env ?? {}
  return {
    browser: env.browser ?? null,
    browserUserAgent: env.userAgent ?? null,
    dpr: env.dpr ?? null,
    viewport: env.viewport ? `${env.viewport.width}x${env.viewport.height}` : null,
    theme: env.theme ?? null,
    fontStack: 'system-ui（采集机默认栈；文本度量样本须标 baseline-sensitive: text）',
    artifactCollectedAt: m.collectedAt ?? null,
  }
}

const fp = fingerprintFromArtifact()
const SAMPLES = SAMPLE_DECLS.map((s) => ({ ...s, fingerprint: fp }))

const manifest = {
  _note:
    '★★★G-61 B0 · **Web 基准 manifest**（基准守护载体）。' +
    '基准 = Web 视觉三件套（B-a 计算样式 / B-b 几何 / B-c 截图）；expected 唯一来源是 Web（决策 #546）。' +
    '纪律：D1 单一（端间互比只作诊断）· D2 冻结（golden 入仓，不靠当场重跑）· D3 可复现（环境指纹**从采集产物机器读取**，' +
    '任一变化即基准变更须审批）· D4 合法（锚点校验：基准不得是错误页）。' +
    '★门禁 check:baseline-manifest：schema / 寻址 / 指纹同源 / 锚点与产物非空 / 幂等。' +
    '★写入守卫（D5）：基准只由 scripts/collect-style-baseline.mjs 产出——被测端脚本只读，不得写入。',
  baseline: 'web',
  styleIrVersion: 1,
  collector: 'scripts/collect-style-baseline.mjs',
  fingerprint: fp,
  samples: SAMPLES,
}

const content = JSON.stringify(manifest, null, 2) + '\n'

const problems = []

/* ③ 指纹同源（D3）：产物缺失 ⇒ 直接违约（"无基准即无法进入 B1"——plan §8） */
if (!fp) {
  problems.push('③ 缺采集产物 `superapp-mine.computed.json`（或不可解析）——跑 `node scripts/collect-style-baseline.mjs`（无基准不得进入 B1）')
} else {
  for (const k of ['browser', 'dpr', 'viewport', 'theme']) {
    if (!fp[k]) problems.push(`③ 采集产物的 env 缺 \`${k}\`（D3 不可复现）`)
  }
}

/* ① schema + ② 寻址 + ④ 合法（D4） */
for (const s of SAMPLES) {
  for (const k of ['id', 'kind', 'path', 'recordedAt']) {
    if (!s[k]) problems.push(`① 样本 ${s.id ?? '?'} 缺字段 \`${k}\``)
  }
  if (!['computed-style', 'geometry', 'screenshot'].includes(s.kind)) {
    problems.push(`① 样本 ${s.id}：kind \`${s.kind}\` 非法（只允许 computed-style | geometry | screenshot）`)
  }
  if (!Array.isArray(s.expect?.anchors) || s.expect.anchors.length === 0) {
    problems.push(`④ 样本 ${s.id}：缺 \`expect.anchors\`（基准不得是错误页/占位页——D4）`)
  }
  /* ② 寻址：样本文件必须在仓库里（否则"用不存在的基准比对"） */
  if (!fs.existsSync(path.join(ROOT, s.path))) {
    problems.push(`② 样本 ${s.id}：基准文件不在仓库（${s.path}）——须由采集器产出后入库`)
  }
}

/* ④ 合法（D4）——两级：产物非空 + **产物真含锚点文本**
 *   ★★B5 强化（2026-10-05）：此前只校验 `expect.anchors` **声明**非空——那挡不住
 *   "采集器把错误页/空态也采下来"（声明里有锚点、产物里没有 ⇒ **基准侧假绿**，
 *   各端对着一份错误基准"全都一致"）。现改为**在产物文本里真验锚点**（逐条包含即可——
 *   产物文本是整块拼接的，不要求逐字相等）。 */
try {
  const m = JSON.parse(fs.readFileSync(path.join(BASE, 'superapp-mine.computed.json'), 'utf-8'))
  const ids = Object.keys(m.nodes ?? {})
  const props = m.properties ?? []
  if (ids.length === 0) problems.push('④ B-a 产物 `nodes` 为空（基准是空对象）')
  if (props.length < 20) problems.push(`④ B-a 产物只声明 ${props.length} 个属性（< 20——采样面过窄）`)
  for (const id of ids) {
    const c = m.nodes[id]?.computed ?? {}
    if (Object.keys(c).length === 0) problems.push(`④ B-a 节点 ${id} 无 computed 读数`)
  }
  // ★锚点真验（基准侧假绿防护）：把产物里所有节点文本拼起来，逐条查声明的锚点
  const allText = Object.values(m.nodes ?? {})
    .map((n) => (typeof n?.text === 'string' ? n.text : ''))
    .join('\n')
  if (allText.trim().length === 0) {
    problems.push('④ B-a 产物**无任何节点文本**——锚点无法验证（基准可能是空态/错误页）')
  } else {
    for (const sample of SAMPLES) {
      for (const anchor of sample.expect?.anchors ?? []) {
        if (!allText.includes(anchor)) {
          problems.push(`④ 样本 ${sample.id} 的锚点「${anchor}」**不在产物文本里**——基准可能是错误页/空态（基准侧假绿防护）`)
        }
      }
    }
  }
} catch (e) {
  problems.push(`④ B-a 产物不可解析：${String(e?.message ?? e).slice(0, 120)}`)
}

/* ⑤ 冻结（D2）：清单幂等 */
if (CHECK || !UPDATE) {
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
  if (prev !== content) {
    problems.push('⑤ 清单与重算不一致——若确为基准变更（含重采），跑 `--update` 并**在提交信息里写明批准人与原因**（D2/D3）')
  }
}

if (UPDATE) {
  fs.mkdirSync(BASE, { recursive: true })
  fs.writeFileSync(OUT, content)
  console.log(`✅ 已写回 ${path.relative(ROOT, OUT)}`)
}

console.log('Web 基准 manifest（G-61 B0 · 基准守护）')
console.log(`  基准端：${manifest.baseline} · 样本 ${SAMPLES.length}（${[...new Set(SAMPLES.map((s) => s.kind))].join(' | ')}）`)
if (fp) {
  console.log(`  环境指纹（自产物读取）：${fp.browser} · DPR ${fp.dpr} · ${fp.viewport} · ${fp.theme}`)
  console.log(`  采集时间：${fp.artifactCollectedAt}`)
}
const missingFiles = SAMPLES.filter((s) => !fs.existsSync(path.join(ROOT, s.path))).length
console.log(`  样本文件就位：${SAMPLES.length - missingFiles}/${SAMPLES.length}`)
if (problems.length) {
  console.log('')
  console.log(`❌ ${problems.length} 项违约：`)
  for (const p of problems) console.log(`    - ${p}`)
  process.exit(1)
}
console.log('')
console.log('✅ 基准 manifest 合规（schema + 寻址 + 指纹同源 + 锚点与产物非空 + 幂等）')
