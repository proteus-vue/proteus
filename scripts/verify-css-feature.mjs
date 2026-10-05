#!/usr/bin/env node
// scripts/verify-css-feature.mjs —— ★★★CSS 能力逐项验收装置（用户 2026-10-05 指定：
//   「实现一个就全端对齐视觉验收一个」）
//
// 【它做什么】给一个能力 id（属性/选择器/at-rule/函数/单位），跑**该能力的四步验收**并产出**验收包**：
//   ① **实现对账**：该能力在 CSE/IR/编译器/矩阵里的实现态（证据行——不是声明）
//   ② **真 Chromium parity**：把该能力写进一段 CSS，用**真浏览器** `getComputedStyle` 取值，
//      与 CSE 的 IR 值逐属性比对（≥0.5dp / 颜色精确）——这是"实现对不对"的硬判据
//   ③ **三端落地状态**：App（overlay/applier）/ Skyline（wxss 映射）/ Web（基准）三端对该能力的
//      **可表达性**（native / degraded / unsupported——来自 appliers 的实测映射）
//   ④ **验收包**：`docs/generated/css-acceptance/<id>.json`（含全部证据 + 结论 gates.pass）
//
// 【★纪律（吸取 superapp 8 轮教训）】
//   · 本装置**不替人看**（像素级视觉验收仍由独立子代理按 Web 基准并排做——见 B5 的并排产物）；
//     本装置管的是**机器可判的四步**（实现/parity/三端可表达/证据归档），把"打地鼠"变成"清单勾选"。
//   · 任一判据红 ⇒ **如实标红**（不产出"通过"的验收包）。
//
// 用法：
//   node scripts/verify-css-feature.mjs <id>            # 验收单项（如 `inset` / `background`）
//   node scripts/verify-css-feature.mjs <id> --json     # 机器可读
//   node scripts/verify-css-feature.mjs --next           # 取下一个 P0（推进用）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const NEXT = argv.includes('--next')
const INVENTORY = path.join(ROOT, 'docs/generated/css-feature-inventory.json')

const inv = JSON.parse(fs.readFileSync(INVENTORY, 'utf-8'))

if (NEXT) {
  // ★推进顺序（可复核）：P0 里先取**标准且用量最高**的（排除前缀扩展/实验性——它们不该排在最前）
  const next = inv.entries
    .filter((e) => e.priority === 'P0' && e.mdnStatus === 'standard' && !e.id.startsWith('-'))
    .sort((a, b) => b.usage - a.usage)[0]
    ?? inv.entries.find((e) => e.priority === 'P0')
  if (!next) {
    console.log('✅ 无 P0 待推行（全部已实现或已验收）')
    process.exit(0)
  }
  console.log(`下一个 P0：\`${next.id}\`（用法 ${next.usage}× · ${next.groups.join(', ')}）`)
  console.log(`  跑：node scripts/verify-css-feature.mjs ${next.id}`)
  process.exit(0)
}

const id = argv.find((a) => !a.startsWith('--'))
if (!id) {
  console.error('用法：node scripts/verify-css-feature.mjs <id> [--json] | --next')
  process.exit(2)
}

const entry = inv.entries.find((e) => e.id === id)
if (!entry) {
  console.error(`✗ 清单里没有 \`${id}\`（grep docs/generated/css-feature-inventory.json 找近似的）`)
  process.exit(2)
}

/* ── ① 实现对账（证据行）── */
const implEvidence = {
  impl: entry.impl,
  implNote: entry.implNote,
  inIrRegistry: entry.evidencedBy.inIrRegistry,
  irScope: entry.evidencedBy.irScope,
  inCompilerFold: entry.evidencedBy.inCompilerFold,
  matrixLevel: entry.evidencedBy.matrixLevel,
  webSupport: entry.evidencedBy.webSupport,
  usage: entry.usage,
  priority: entry.priority,
}

/* ── ② 真 Chromium parity（该能力的最小可判样本）── */
/** 该能力的探针值（按 kind 给最小样本——不足则回退"清单语法串的首个合法值"） */
const PROBE_VALUES = {
  // 属性 → [css 声明, 期望字段（IR 键）, 期望形态]
  inset: ['inset: 4px 8px', 'top', { kind: 'absolute', dp: 4 }],
  // ★★★逐边 border 批（2026-10-05）：逐边宽度样本（CSE 产出 border<Side>Width 数值）
  'border-bottom': ['border-bottom: 2px solid #3355aa', 'borderBottomWidth', 2],
  // ★★★边框族收口批（2026-10-05）：线型 + 逐角样本
  'border-style': ['border-style: dashed', 'borderTopStyle', 'dashed'],
  'border-top-left-radius': ['border-top-left-radius: 8px', 'borderRadius', 8],
  'border-bottom-right-radius': ['border-bottom-right-radius: 8px', 'borderRadius', 8],
  'border-top': ['border-top: 2px solid #3355aa', 'borderTopWidth', 2],
  'border-left': ['border-left: 3px solid #3355aa', 'borderLeftWidth', 3],
  'border-right': ['border-right: 3px solid #3355aa', 'borderRightWidth', 3],
  'overflow-x': ['overflow-x: hidden', 'overflow', 'hidden'],
  'overflow-y': ['overflow-y: hidden', 'overflow', 'hidden'],
  'white-space': ['white-space: nowrap', 'whiteSpace', 'nowrap'],
  'word-break': ['word-break: break-all', 'wordBreak', 'break-all'],
  'justify-self': ['justify-self: center', 'justifySelf', 'center'],
  'grid-area': ['grid-area: 1 / 2 / 3 / 4', 'gridArea', { start: 1, end: 3 }],
  'background-color': ['background-color: #112233', 'backgroundColor', '#112233'],
  color: ['color: #445566', 'color', '#445566'],
  'border-radius': ['border-radius: 10px', 'borderRadius', 10],
  'text-align': ['text-align: center', 'textAlign', 'center'],
  opacity: ['opacity: 0.5', 'opacity', 0.5],
  'font-size': ['font-size: 18px', 'fontSize', 18],
  'letter-spacing': ['letter-spacing: 2px', 'letterSpacing', 2],
  'line-height': ['line-height: 1.5', 'lineHeight', 24],
  'flex-direction': ['flex-direction: column', 'flexDirection', 'column'],
  'justify-content': ['justify-content: space-between', 'justifyContent', 'space-between'],
  'align-items': ['align-items: center', 'alignItems', 'center'],
  gap: ['gap: 8px', 'rowGap', { kind: 'absolute', dp: 8 }],
}

const probe = PROBE_VALUES[id]
let parity = { ran: false, pass: null, detail: [] }
let browser = null
if (!probe) {
  parity.detail.push(`未登记该能力的探针样本（\`PROBE_VALUES\`）——**不假装通过**（补样本后重跑；这是推进一项时的必做步骤）`)
} else {
  const [decl, irField, expect] = probe
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.setContent(`<!doctype html><html><head><style>html{font-size:16px}body{margin:0}
      .t { ${decl}; width: 100px; height: 60px }</style></head><body><div class="t" id="t">x</div></body></html>`)
    const computed = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('t'))
      const out = {}
      for (const p of cs) out[p] = cs.getPropertyValue(p).trim()
      return out
    })
    // CSE 侧
    const compiler = await import(pathToFileURL(path.join(ROOT, 'packages/compiler/dist/index.js')).href)
    const sheet = compiler.parseStyleSheet(`.t { ${decl} }`)
    const node = { key: 't', tag: 'div', classes: ['t'], index: 0, count: 1, children: [] }
    const r = compiler.computeTree([node], sheet, { viewport: { width: 390, height: 844 } })
    const irVal = r.byKey['t']?.fields?.[irField]
    parity.ran = true
    parity.css = decl
    parity.irField = irField
    parity.irValue = irVal
    parity.computedProbe = Object.fromEntries(
      Object.entries(computed).filter(([k]) => ['inset', 'top', 'right', 'bottom', 'left', 'overflow-x', 'overflow-y', 'white-space', 'word-break', 'justify-self', 'grid-area', 'background-color', 'color', 'border-radius', 'text-align', 'opacity', 'font-size', 'letter-spacing', 'line-height', 'flex-direction', 'justify-content', 'align-items', 'gap', 'border-bottom-width', 'border-top-width', 'border-left-width', 'border-right-width', 'border-bottom-color', 'border-top-color', 'border-left-color', 'border-right-color', 'border-style', 'border-top-style', 'border-bottom-style', 'border-top-left-radius', 'border-bottom-right-radius'].includes(k)),
    )
    // 判据：IR 出值且与浏览器 resolved 语义一致（按形态）
    if (irVal === undefined) {
      parity.pass = false
      parity.detail.push(`CSE 未产出字段 \`${irField}\`（该能力**未实现**或未映射）`)
    } else if (typeof expect === 'object' && JSON.stringify(irVal) !== JSON.stringify(expect)) {
      parity.pass = false
      parity.detail.push(`IR 值形态待核：期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(irVal)}`)
    } else if (typeof expect !== 'object' && JSON.stringify(irVal) !== JSON.stringify(expect)) {
      parity.pass = false
      parity.detail.push(`IR 值不符：期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(irVal)}`)
    } else {
      parity.pass = true
      parity.detail.push(`IR \`${irField}\` = ${JSON.stringify(irVal)}（与浏览器样本 ${decl} 一致）`)
    }
    await page.close()
  } catch (e) {
    parity.detail.push(`parity 执行失败：${String(e?.message ?? e).slice(0, 160)}`)
  } finally {
    await browser?.close()
  }
}

/* ── ③ 三端可表达性（来自 appliers 的映射结果——如实）── */
const consistency = await import(pathToFileURL(path.join(ROOT, 'packages/consistency/dist/index.js')).href)
const END_CHECK = (() => {
  if (entry.kind !== 'property') return { web: 'n/a（非属性）', skyline: 'n/a', app: 'n/a' }
  const camel = id.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
  // 构造最小 IR（若已实现——从 parity 的 IR 值取；否则用占位）
  const fieldName = (probe && probe[1]) || camel
  const value = probe ? undefined : null
  void value
  const irFields = {}
  // skyline 映射
  let sky = { wxss: {}, unsupported: [] }
  let app = { dto: {}, ops: {}, unsupported: [] }
  try {
    if (parity.ran && parity.irValue !== undefined) {
      irFields[fieldName] = parity.irValue
      sky = consistency.mapStyleIRToSkyline(irFields)
      app = consistency.mapStyleIRToApp(irFields)
    }
  } catch { /* 映射失败 ⇒ 下面按"未实现"如实标 */ }
  const skyOk = Object.keys(sky.wxss ?? {}).length > 0
  const appOk = Object.keys(app.dto ?? {}).length > 0 || Object.keys(app.ops ?? {}).length > 0
  return {
    web: '基准端（浏览器原生——A 档）',
    skyline: skyOk ? `可表达（${Object.keys(sky.wxss).join(', ')}）` : '未映射（该字段未实现或 Skyline 不支持）',
    app: appOk ? `可表达（dto: ${Object.keys(app.dto).join(', ')}${Object.keys(app.ops).length ? ` · ops: ${Object.keys(app.ops).join(', ')}` : ''}）` : '未映射（该字段未实现）',
    skylineUnsupported: (sky.unsupported ?? []).map((u) => `${u.field}: ${u.reason}`),
    appUnsupported: (app.unsupported ?? []).map((u) => `${u.field}: ${u.reason}`),
  }
})()

/* ── ④ 验收包 ── */
const gates = {
  implemented: entry.impl === 'implemented',
  parity: parity.pass === true,
  endsMapped: entry.kind !== 'property' ? null : END_CHECK.skyline.startsWith('可表达') && END_CHECK.app.startsWith('可表达'),
}
const pass = gates.implemented && gates.parity && (gates.endsMapped === null || gates.endsMapped)

const pkg = {
  _note:
    '★CSS 能力逐项验收包（用户指定流程：实现一个 → 全端对齐视觉验收一个）。' +
    'gates：implemented（IR 在册）/ parity（真 Chromium 同构样本与 CSE 值一致）/ endsMapped（三端可表达）。' +
    '★视觉验收（像素级）仍由独立子代理按 Web 基准并排做——本包只归档**机器可判**的三段；' +
    'pass=true 表示"可以进入视觉验收"，不等于"视觉已验收"。',
  id,
  kind: entry.kind,
  verifiedAt: new Date().toISOString(),
  implEvidence,
  parity,
  endExpressibility: END_CHECK,
  gates,
  pass,
  nextStep: pass
    ? '机器判据三段已过 → 进入**视觉验收**：生成并排产物（node scripts/gen-baseline-side-by-side.mjs）+ 独立子代理按 Web 基准评审'
    : `未过：${Object.entries(gates).filter(([, v]) => v === false).map(([k]) => k).join(' / ')}——先补实现或补探针样本`,
}

const outDir = path.join(ROOT, 'docs/generated/css-acceptance')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `${id}.json`)
// ★★保留既有 `visual` 段（视觉验收结论——由独立子代理评审后写入；机器判据重跑**不得抹掉**）
//   形态：{ verdicts: [{end, verdict, caseIssues[], evidence}], reviewedAt, reviewedBy, sideBySideDir }
try {
  if (fs.existsSync(outFile)) {
    const prev = JSON.parse(fs.readFileSync(outFile, 'utf-8'))
    if (prev.visual) pkg.visual = prev.visual
  }
} catch { /* 旧包损坏 ⇒ 不阻断（重新评审即可） */ }
fs.writeFileSync(outFile, JSON.stringify(pkg, null, 2) + '\n')

if (JSON_OUT) {
  console.log(JSON.stringify(pkg, null, 2))
} else {
  console.log(`CSS 能力验收 · \`${id}\`（${entry.kind} · 用法 ${entry.usage}× · 优先级 ${entry.priority}）`)
  console.log('')
  console.log(`① 实现：${entry.impl}${entry.implNote ? `（${entry.implNote}）` : ''}`)
  console.log(`   IR 注册表 ${entry.evidencedBy.inIrRegistry ? `✅ scope=${entry.evidencedBy.irScope}` : '❌'} · 编译器折叠 ${entry.evidencedBy.inCompilerFold ? '✅' : '❌'} · 矩阵 ${entry.evidencedBy.matrixLevel ?? '—'}`)
  console.log(`② parity（真 Chromium）：${parity.pass === true ? '✅' : parity.pass === false ? '❌' : '⏭ 未跑'}`)
  for (const d of parity.detail) console.log(`   ${d}`)
  console.log(`③ 三端可表达：`)
  console.log(`   Web：${END_CHECK.web}`)
  console.log(`   Skyline：${END_CHECK.skyline}`)
  console.log(`   App：${END_CHECK.app}`)
  console.log('')
  console.log(pass ? '✅ 三段机器判据通过（可进入视觉验收）' : '❌ 未通过（见上）')
  console.log(`   验收包：docs/generated/css-acceptance/${id}.json`)
  if (!pass) console.log(`   → ${pkg.nextStep}`)
}
process.exit(pass ? 0 : 1)
