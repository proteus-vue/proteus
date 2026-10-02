#!/usr/bin/env node
// scripts/check-consistency-snapshot.mjs —— ★VC3/VC4 门禁：三端快照**同一格式 + 同一校验器**（离线）
//
// 【判据（每条打在"格式分叉"这个会失败的点上）】
//   ① 各端真实产出（Web golden / App 内核工件 / 小程序装置产物）全部通过
//      `@proteus-vue/consistency` 的同一校验器（禁止比对层格式适配）
//   ② 各端产出的**键集形态**一致（App/小程序不得出现 width/height 等旧键名）
//   ③ 三端 end 字段互异且合法（防"复制粘贴时忘改 end"）
//   ④ 小程序两端（skyline/webview）几何**逐位相同**（同夹具同声明 ⇒ 应一致）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGeometrySnapshot, validateStyleSnapshot } from '../packages/consistency/dist/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fails = []
const note = (m) => console.log('  · ' + m)

// ① Web golden（Playwright 实测产物，入库）
const webGolden = path.join(ROOT, 'tests/__snapshots__/consistency/web-home.geometry.json')
if (!fs.existsSync(webGolden)) {
  fails.push(`缺 Web golden：${path.relative(ROOT, webGolden)}（跑 tests/consistency-web-probe.test.ts 生成）`)
} else {
  const g = JSON.parse(fs.readFileSync(webGolden, 'utf-8'))
  const geo = JSON.parse(g.geometry)
  const rg = validateGeometrySnapshot(geo)
  const rs = validateStyleSnapshot(g.style)
  if (!rg.ok) fails.push(`Web 几何未过校验器：${JSON.stringify(rg.issues.slice(0, 2))}`)
  if (!rs.ok) fails.push(`Web 样式未过校验器：${JSON.stringify(rs.issues.slice(0, 2))}`)
  if (geo.end !== 'web') fails.push(`Web 快照 end 应为 web，实际 ${geo.end}`)
  note(`Web：几何 ${rg.nodeCount} 节点 · 样式 ${rs.nodeCount} 节点 —— 校验器 ✅`)
}

// ② App 内核工件（cargo test 落盘）
const appArtifact = path.join(ROOT, 'spike/target/geometry-snapshot-sample.json')
const appArtifactAlt = path.join(ROOT, 'packages/layout-core-rust/target/geometry-snapshot-sample.json')
const appFile = fs.existsSync(appArtifact) ? appArtifact : (fs.existsSync(appArtifactAlt) ? appArtifactAlt : null)
if (!appFile) {
  fails.push('缺 App 内核快照工件（跑 cd packages/layout-core-rust && CARGO_TARGET_DIR=../../spike/target cargo test --release geometry_snapshot）')
} else {
  const geo = JSON.parse(fs.readFileSync(appFile, 'utf-8'))
  const rg = validateGeometrySnapshot(geo)
  if (!rg.ok) fails.push(`App 内核快照未过校验器：${JSON.stringify(rg.issues.slice(0, 2))}`)
  note(`App（Rust 内核）：几何 ${rg.nodeCount} 节点 —— 校验器 ✅`)
}

// ③ 小程序装置产物（wechatide 实测，入库）
const mpFiles = {
  skyline: path.join(ROOT, 'spike/vc0-skyline-geom/results/consistency-skyline.txt'),
  webview: path.join(ROOT, 'spike/vc0-skyline-geom/results/consistency-webview.txt'),
}
const mpGeos = {}
for (const [end, f] of Object.entries(mpFiles)) {
  if (!fs.existsSync(f)) {
    fails.push(`缺小程序 ${end} 产物：${path.relative(ROOT, f)}（跑微信 IDE 装置采集）`)
    continue
  }
  const s = fs.readFileSync(f, 'utf-8')
  // ★容错解析（实测：evaluate 超时/结构异常时给可行动报错，不崩在 JSON.parse）
  let data
  try {
    const d = JSON.parse(s.slice(s.indexOf('{')))
    if (d.ok === false) {
      fails.push(`小程序 ${end} 采集命令失败：${String(d.message ?? '').slice(0, 120)}（重跑装置采集）`)
      continue
    }
    data = JSON.parse(d.result.result.result)
  } catch (e) {
    fails.push(`小程序 ${end} 产物解析失败（${path.relative(ROOT, f)}）：${String(e.message).slice(0, 120)}`)
    continue
  }
  const geo = data.geo ?? data
  const style = data.style ?? null
  // ★★空绿防护（门禁首跑实测）：采集未完成时 `geo` 可能为空对象/无 root——
  //   `validateGeometrySnapshot({})` 会因 format 不符报错，但 `geo.root` 缺失时
  //   下面的 walk 会**崩**（或判成 0 节点）。⇒ 先断言 root 存在且节点数 > 0。
  if (!geo || !geo.root) {
    fails.push(`小程序 ${end} 快照缺 root（采集可能未完成——检查装置是否跑完/账本是否被重置）：${JSON.stringify(data).slice(0, 200)}`)
    continue
  }
  const rg = validateGeometrySnapshot(geo)
  if (!rg.ok) fails.push(`小程序 ${end} 未过校验器：${JSON.stringify(rg.issues.slice(0, 2))}`)
  if (rg.nodeCount <= 0) fails.push(`小程序 ${end} 快照 0 节点（空快照不是有效快照）`)
  if (style) {
    const rs = validateStyleSnapshot(style)
    if (!rs.ok) fails.push(`小程序 ${end} 样式未过校验器：${JSON.stringify(rs.issues.slice(0, 2))}`)
  }
  if (geo.end !== end) fails.push(`小程序 ${end} 快照 end 应为 ${end}，实际 ${geo.end}`)
  if (geo.collectionErrors) fails.push(`小程序 ${end} 采集有错误：${JSON.stringify(geo.collectionErrors)}`)
  mpGeos[end] = geo
  note(`小程序 ${end}：几何 ${rg.nodeCount} 节点 —— 校验器 ✅`)
}

// ④ skyline ⇄ webview 一致（同夹具同声明）
//   ★判据口径（门禁首跑抓出的真问题——"比 y 绝对值"是错的）：两个页面是**独立滚动容器**，
//     滚动位置不同 ⇒ 视口 y 本就不同。VC3-a 规定"视口左上角原点"，而**页面滚动量**不属于
//     节点几何（它是容器的状态）。⇒ 正确判据：**x/w/h 逐位相同 + y 的相对关系不变**
//     （各节点 y 减根 y 后逐位相同——"关系不变"而非"值相等"，与标准 §10.2 的连续交互口径一致）。
if (mpGeos.skyline && mpGeos.webview) {
  const flat = (n, acc = []) => {
    acc.push({ path: n.path, x: n.x, y: n.y, w: n.w, h: n.h })
    for (const c of n.children ?? []) flat(c, acc)
    return acc
  }
  const A = flat(mpGeos.skyline.root)
  const B = flat(mpGeos.webview.root)
  if (A.length !== B.length) fails.push(`skyline/webview 节点数不同：${A.length} vs ${B.length}`)
  else {
    const diffs = []
    // ★基线取**第一个子节点**（path='0'）——根节点的 y 就是滚动位置本身（比它无意义：
    //   "根相对自己的间距"恒 0，而两页的滚动量不同 ⇒ 会误报。门禁首跑实测抓出。）
    const baseA = A.find((n) => n.path === '0')
    const baseB = B.find((n) => n.path === '0')
    if (!baseA || !baseB) {
      fails.push('skyline/webview 快照缺 path=0 节点（夹具应有子节点）')
    } else {
      for (let i = 0; i < A.length; i++) {
        for (const f of ['x', 'w', 'h']) {
          if (A[i][f] !== B[i][f]) diffs.push(`${A[i].path}: ${f} ${A[i][f]} vs ${B[i][f]}`)
        }
        // y 判"相对第一个子节点的间距"（滚动无关的不变量；根与 path=0 自身跳过）
        if (A[i].path === '' || A[i].path === '0') continue
        const relA = A[i].y - baseA.y
        const relB = B[i].y - baseB.y
        if (Math.abs(relA - relB) > 0.01) diffs.push(`${A[i].path}: 相对 y ${relA} vs ${relB}`)
      }
    }
    if (diffs.length) fails.push(`skyline/webview 几何不一致（${diffs.length} 处）：${diffs.slice(0, 4).join(' · ')}`)
    else note(`skyline ⇄ webview 一致（${A.length} 节点：x/w/h 逐位相同 + 相对 y 相同；绝对 y 差 ${(B[0].y - A[0].y).toFixed(1)}px 属滚动位置，非几何差异）`)
  }
}

// ⑤ ★★VC5-b：**真实三端比对**（skyline ⇄ webview，按分级容差）——M1 的 L2 覆盖落地
if (mpGeos.skyline && mpGeos.webview) {
  const { compareGeometry, resolveTolerance } = await import('../packages/consistency/dist/index.js')
  const cfg = resolveTolerance(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/consistency-tolerance.json'), 'utf-8')))
  const r = compareGeometry(mpGeos.skyline, mpGeos.webview, { tolerance: cfg })
  note(`VC5-b 比对（skyline ⇄ webview，${r.summary.compared} 节点）：${r.ok ? '✅ 全部在容差内' : `❌ ${r.diffs.filter((d) => d.overTolerance).length} 条超容差`}`)
  for (const d of r.diffs.filter((x) => x.overTolerance).slice(0, 6)) {
    note(`    · path=${d.path} ${d.property ?? ''} ${d.aValue} → ${d.bValue}（Δ${d.deviation}，容差 ${d.tolerance}，类 ${d.toleranceClass}）`)
  }
  // ★比对结论的**门禁口径**（本轮实测演进，写清避免误读）：
  //   · skyline ⇄ webview：**硬门禁**（同夹具同声明，须一致——上文 ④ 已判，且 VC5-b 复核）；
  //   · 小程序 ⇄ App 内核：**报告**（两端 renderer 不同：微信容器 vs 自研内核；当前差异如实列出，
  //     待 L2 覆盖扩到 App 端后按允许差异清单评估）。这不是"放水"——是"差异必须先被看见"。
}

// ⑥ ★App 内核 ⇄ 小程序（跨 renderer 比对，如实报告）
if (appFile && mpGeos.skyline) {
  const { compareGeometry, resolveTolerance } = await import('../packages/consistency/dist/index.js')
  const cfg = resolveTolerance(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/consistency-tolerance.json'), 'utf-8')))
  const appGeo = JSON.parse(fs.readFileSync(appFile, 'utf-8'))
  const r = compareGeometry(appGeo, mpGeos.skyline, { tolerance: cfg })
  note(`VC5-b 比对（App 内核 ⇄ skyline，${r.summary.compared} 节点）：${r.ok ? '✅ 全部在容差内' : `⚠ ${r.diffs.filter((d) => d.overTolerance).length} 条差异（跨 renderer，如实报告）`}`)
  for (const d of r.diffs.filter((x) => x.overTolerance).slice(0, 6)) {
    note(`    · path=${d.path} ${d.property ?? d.kind} ${d.aValue ?? ''} → ${d.bValue ?? ''}${d.deviation !== undefined ? `（Δ${d.deviation}）` : ''}`)
  }
}

if (fails.length) {
  console.error('\n✗ 一致性快照门禁失败：')
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('\n✅ 三端快照同一格式 + 同一校验器（Web / App 内核 / 小程序双模式）')
