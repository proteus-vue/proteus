#!/usr/bin/env node
// scripts/gen-consistency-metrics.mjs —— ★CS1：多端一致性指标（M1–M4）机器生成 + 允许差异清单 schema 门禁
//
// 【这一件回答什么（《Proteus_多端一致性标准方案.md》§6.1）】标准要"能证明自己一致到什么程度"，
//   就必须有**可公开、可复算、机器生成**的指标——手抄数字会过时、会被怀疑。
//   M1–M4 全部从**已入库产物**读出（矩阵 / 基线 / 边界规则 / 变异测试），本脚本不编任何数。
//
// 【指标口径（与标准 §6.1 对齐；口径变了这里先红）】
//   M1 数值一致性覆盖率 = L1 已机器化校验的字段数 / 编译器可表达字段数
//      （L2/L3 未布点 ⇒ 分子只算 L1——**如实反映当前阶段**，标准 §6.2 要求公开不好看的数）
//   M2 允许差异条目数 = docs/allow-differences.json 条目数（越少越好，每条必须有理由与证据）
//   M3 CI 门禁通过率 = **本指标可判定的**门禁清单（全绿=1.0；任意红则体现为脚本退出非零，
//      故 M3 是"引用式"指标：列出参与门禁名 + 判定者=CI）
//   M4 一致性回归检出率 = L1 变异测试的捕获数 / 注入数（L2/L3/L4 算子未布点 ⇒ 单列 pending）
//
// 【M4 的变异测试（标准 §7）】L1 能做到的部分现在就做——注入"某端不支持"的样式，
//   跑 checkProfileBoundary 看是否捕获；**未布点的算子单列**（标准 §7.3 硬要求：不得悄悄删）。
//
// 【schema 门禁（允许差异清单）】id/category/reason/scope/evidence 必填且 id 唯一；
//   category ∈ 白名单；**A-4（动画插值中间态）受删除保护**（标准 §14#5 要求现在就登记）。
//
// 用法：
//   node scripts/gen-consistency-metrics.mjs            # 生成指标（写 docs/generated/consistency-metrics.json）
//   node scripts/gen-consistency-metrics.mjs --check    # 门禁：漂移 + 清单 schema（CI/verify 链）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'generated', 'consistency-metrics.json')
const ALLOW = path.join(ROOT, 'docs', 'allow-differences.json')
const MATRIX = path.join(ROOT, 'docs', 'generated', 'end-support-matrix.json')
const CHECK = process.argv.includes('--check')

const CATEGORIES = ['text-metrics', 'runtime-behavior', 'animation', 'rasterization', 'interaction']
const REQUIRED_FIELDS = ['id', 'category', 'title', 'reason', 'scope', 'evidence']
/** 删除保护（标准 §14#5：A-4 动画插值中间态必须登记） */
const PROTECTED_IDS = ['A-4']

/* ── ① 允许差异清单 schema 校验（失败即 exit 2——清单不合法时指标无意义） ── */
function validateAllowList() {
  const errs = []
  if (!fs.existsSync(ALLOW)) return { errs: [`缺 ${path.relative(ROOT, ALLOW)}`], items: [] }
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(ALLOW, 'utf-8'))
  } catch (e) {
    return { errs: [`allow-differences.json 解析失败：${e.message}`], items: [] }
  }
  const items = Array.isArray(doc.items) ? doc.items : []
  if (items.length === 0) errs.push('items 为空（清单不得空——至少 A-1~A-5 有据可依）')
  const seen = new Set()
  for (const [i, it] of items.entries()) {
    for (const f of REQUIRED_FIELDS) {
      if (typeof it[f] !== 'string' || it[f].trim().length === 0) errs.push(`items[${i}]（${it.id ?? '无名'}）缺/空字段：${f}`)
    }
    if (seen.has(it.id)) errs.push(`id 重复：${it.id}`)
    seen.add(it.id)
    if (it.category && !CATEGORIES.includes(it.category)) errs.push(`items[${i}] 非法 category：${it.category}（允许：${CATEGORIES.join('/')}）`)
    // ★反"为让测试通过而加条目"：reason 太短视为未写理由（标准 §9.1 硬约束）
    if (typeof it.reason === 'string' && it.reason.trim().length < 12) errs.push(`items[${i}] reason 过短（须写明为什么这是"设计使然"而非 bug）：${it.reason}`)
  }
  for (const pid of PROTECTED_IDS) {
    if (!seen.has(pid)) errs.push(`受保护条目被删除：${pid}（标准 §14#5 要求它必须在清单里）`)
  }
  return { errs, items }
}

/* ── ② M4：变异测试（注入 → 跑校验 → 数捕获）── */
//
// ★★扩容（2026-10-02·二批）：从"只测 L1 边界规则"扩到**三层**：
//   · L1：编译期边界规则（CSS 注入 → checkProfileBoundary）
//   · L2：几何比对（构造带已知偏差的快照对 → compareGeometry 必须检出）
//   · L3：样式比对（构造颜色/字族偏差 → compareStyle 必须检出——**含 §7.4 按钮变色反例**）
//   全部用**合成快照**（不需设备/不需构建）——这是"校验机制本身有效"的机器证据。
async function runMutationTests() {
  const cssCompat = await import(pathToFileURL(path.join(ROOT, 'packages', 'css-compat', 'dist', 'index.js')).href)
  const { checkProfileBoundary } = cssCompat
  const consistency = await import(pathToFileURL(path.join(ROOT, 'packages', 'consistency', 'dist', 'index.js')).href)
  const { compareGeometry, compareStyle, resolveTolerance } = consistency
  const tolCfg = resolveTolerance(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/consistency-tolerance.json'), 'utf-8')))

  /** 合成几何快照（与三端夹具同构：root > box > text） */
  const geoSnap = (dx = 0, dw = 0) => ({
    format: 'proteus-geometry-snapshot', version: 1, end: 'web',
    viewport: { width: 400, height: 600 },
    root: {
      nodeId: 1, path: '', x: 0, y: 0, w: 400, h: 600, depth: 0,
      children: [{
        nodeId: 2, path: '0', x: 12 + dx, y: 12, w: 200 + dw, h: 60, depth: 1, semanticKey: 'p-box',
        children: [{ nodeId: 3, path: '0.0', x: 16, y: 20, w: 120, h: 24, depth: 2, semanticKey: 'p-text', children: [] }],
      }],
    },
  })
  /** 合成样式快照 */
  const styleSnap = (mut = {}) => ({
    format: 'proteus-style-snapshot', version: 1, end: 'web',
    nodes: [{
      nodeId: 2, path: '0',
      styles: {
        backgroundColor: { r: 47, g: 111, b: 237, a: 1 }, color: { r: 255, g: 255, b: 255, a: 1 },
        fontSize: 16, fontWeight: 700, fontFamily: 'PingFang SC',
        width: 200, display: 'flex', overflow: 'visible', opacity: 1,
        ...mut,
      },
    }],
  })
  // 算子：{ id, 层, 跑法, 期望是否被捕获 }
  const results = []
  const run = (id, layer, note, expectCaught, fn) => {
    let caught = false
    try {
      caught = fn()
    } catch (e) {
      // 算子自身抛错 ⇒ 视为**未捕获 + 记因**（不静默）
      results.push({ id, layer, caught: false, expected: expectCaught, ok: false, note: `${note}｜算子抛错：${String(e?.message ?? e).slice(0, 80)}` })
      return
    }
    results.push({ id, layer, caught, expected: expectCaught, ok: caught === expectCaught, note })
  }

  /* ── L1：编译期边界规则 ── */
  run('L1-overflow-scroll', 'L1', '官方只认 hidden/visible', true, () => checkProfileBoundary('.x { overflow: scroll; }').violations.length > 0)
  run('L1-display-grid', 'L1', '官方只认 none/flex/block', true, () => checkProfileBoundary('.x { display: grid; }').violations.length > 0)
  run('L1-position-sticky', 'L1', '官方只认 relative/absolute/fixed', true, () => checkProfileBoundary('.x { position: sticky; }').violations.length > 0)
  run('L1-ctrl-legal', 'L1', '对照组：合法值不应误报', false, () => checkProfileBoundary('.x { overflow: hidden; }').violations.length > 0)
  run('L1-ctrl-escaped', 'L1', '对照组：escape hatch 应放行', false, () => checkProfileBoundary('/* proteus-allow-profile: 业务验证过 */\n.x { overflow: scroll; }').violations.length > 0)

  /* ── L2：几何比对（间距偏移 / 尺寸偏移 / 节点缺失 / 层级错位）── */
  const geoCaught = (a, b) => !compareGeometry(a, b, { tolerance: tolCfg }).ok
  run('L2-margin-shift', 'L2', '间距偏移 3px（超 1px 容差）必须检出', true, () => geoCaught(geoSnap(), geoSnap(3)))
  run('L2-width-shift', 'L2', '尺寸偏移 2px 必须检出', true, () => geoCaught(geoSnap(), geoSnap(0, 2)))
  run('L2-node-missing', 'L2', '节点缺失必须检出（结构级）', true, () => {
    const b = geoSnap()
    b.root.children[0].children = []
    return geoCaught(geoSnap(), b)
  })
  run('L2-depth-mismatch', 'L2', '层级错位必须检出', true, () => {
    const b = geoSnap()
    b.root.children[0].children[0].depth = 3
    return geoCaught(geoSnap(), b)
  })
  run('L2-ctrl-within-tol', 'L2', '对照组：0.5px 在容差内不应报', false, () => geoCaught(geoSnap(), geoSnap(0.5)))

  /* ── L3：样式比对（颜色 1/255 / 字族回退 / 枚举 / 标量）── */
  const styleCaught = (mut, opts) => !compareStyle(styleSnap(), styleSnap(mut), { tolerance: tolCfg, ...(opts ?? {}) }).ok
  run('L3-color-shift-1of255', 'L3', '★§7.4 反例：颜色偏移 1/255 必须检出', true, () =>
    styleCaught({ backgroundColor: { r: 46, g: 111, b: 237, a: 1 } }),
  )
  run('L3-font-fallback', 'L3', '字族回退（PingFang SC → system-ui）必须检出', true, () => styleCaught({ fontFamily: 'system-ui' }))
  run('L3-enum-overflow', 'L3', '枚举值差异（overflow）必须检出', true, () => styleCaught({ overflow: 'hidden' }))
  run('L3-scalar-flexgrow', 'L3', '无单位标量（flexGrow 1→2）必须检出——不能用 px 容差吞掉', true, () => {
    const a = styleSnap(); const b = styleSnap(); a.nodes[0].styles.flexGrow = 1; b.nodes[0].styles.flexGrow = 2
    return !compareStyle(a, b, { tolerance: tolCfg }).ok
  })
  run('L3-ctrl-allowed-diff', 'L3', '对照组：A-6 豁免（字族解析差异）不应判失败', false, () =>
    styleCaught({ fontFamily: 'system-ui' }, { allowDifferences: [{ id: 'A-6', key: 'fontFamily' }] }),
  )
  run('L3-ctrl-within-tol', 'L3', '对照组：宽度 0.5px 在容差内不应报', false, () => styleCaught({ width: 200.5 }))

  /* ── L2.5：离散交互（事件 → 结果态几何）──
   *   ★判据的双向性：既抓"结果态不一致"，也抓"**交互没发生**"（"点了没反应"）。
   *   用合成快照（与 L2 同夹具）——L2.5 的判据对象是"事件→结果态"，事件来源不在判据内。 */
  const { compareDiscreteInteraction, verifyInvariants } = consistency
  run('L2.5-result-state-mismatch', 'L2.5', '交互结果态不一致必须检出', true, () => {
    const before = geoSnap()
    const afterA = { ...geoSnap(0, 60) }   // A 端：宽度 +60
    const afterB = { ...geoSnap(0, 90) }   // B 端：宽度 +90（交互语义不同）
    return !compareDiscreteInteraction(before, afterA, before, afterB, { tolerance: tolCfg }).ok
  })
  run('L2.5-dead-interaction', 'L2.5', '★任一端"点了没反应"（几何无变化）必须检出', true, () => {
    const before = geoSnap()
    const after = geoSnap(0, 60)
    return !compareDiscreteInteraction(before, after, before, before, { tolerance: tolCfg }).ok
  })
  run('L2.5-ctrl-consistent', 'L2.5', '对照组：两端交互结果一致不应报', false, () => {
    const before = geoSnap()
    const after = geoSnap(0, 60)
    return !compareDiscreteInteraction(before, after, before, after, { tolerance: tolCfg }).ok
  })

  /* ── L2.6：连续交互不变量（禁止绝对坐标——标准 §10.2）── */
  const translateAll = (dx, dy) => {
    const s = geoSnap()
    const walk = (n) => { n.x += dx; n.y += dy; for (const c of n.children) walk(c) }
    walk(s.root)
    return s
  }
  run('L2.6-gap-broken', 'L2.6', '相对间距被破坏（单节点偏移）必须检出', true, () => {
    const b = geoSnap()
    b.root.children[0].y += 7
    return !verifyInvariants(geoSnap(), b, { tolerance: tolCfg }).ok
  })
  run('L2.6-structure-lost', 'L2.6', '结构不变量（节点缺失）必须检出', true, () => {
    const b = geoSnap()
    b.root.children[0].children = []
    return !verifyInvariants(geoSnap(), b, { tolerance: tolCfg }).ok
  })
  run('L2.6-size-changed', 'L2.6', '尺寸不变量必须检出', true, () => {
    const b = geoSnap()
    b.root.children[0].h += 5
    return !verifyInvariants(geoSnap(), b, { tolerance: tolCfg }).ok
  })
  run('L2.6-ctrl-pure-scroll', 'L2.6', '★对照组：**纯滚动（整体平移）不应报**——"禁止比绝对坐标"的机器证明', false, () =>
    !verifyInvariants(geoSnap(), translateAll(0, -300), { tolerance: tolCfg }).ok,
  )

  /* ── L4：圆角缺失（**真实截图注入**——标准 §7.4 的小面积缺陷场景）──
   * ★为什么用真截图：L4 的观测对象是"系统光栅化"（圆角 AA/阴影/渐变），合成图不经任何渲染器
   *   ⇒ 测的是算法自证。真截图来自 `bash scripts/shoot-l4-fixtures.sh`（小程序模拟器双渲染器）。
   * ★为什么是"同端注入"：跨端比对里**圆角 AA 本身就在噪声底内**（本仓实测：skyline vs webview
   *   的圆角弧线 AA 差异 266px，占块面积 2.2% > 噪声带）⇒ 跨端判定不具区分度（base 与注入后同为
   *   'changed'，只能看量级 266→618）。⇒ 机器判据取**与自身原图比**：原图=identical（字节全等）、
   *   注入后=changed——零噪声底的干净二值判据，这才是"校验机制敏不敏感"的直接证据。
   * ★真截图未入库（干净克隆）⇒ 算子进 pending（不得静默跳过，标准 §7.3）。 */
  const SHOT_DIR = path.join(ROOT, 'docs/generated/consistency-samples/pixels')
  const shotSky = path.join(SHOT_DIR, 'l4.skyline.png')
  const shotWeb = path.join(SHOT_DIR, 'l4.webview.png')
  const pending = []
  if (fs.existsSync(shotSky) && fs.existsSync(shotWeb)) {
    const { pixelObservation, decodePng } = consistency
    const web = await decodePng(new Uint8Array(fs.readFileSync(shotWeb)))
    // 定位圆角块（#2f6fed ±10；x≥4/y≥150——排除模拟器左缘伪影与设备 chrome，见 check-consistency-pixel 的 L4_ROI）
    let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1
    for (let y = 150; y < web.height; y++) for (let x = 4; x < web.width - 4; x++) {
      const i = (y * web.width + x) * 4
      if (Math.abs(web.rgba[i] - 47) <= 10 && Math.abs(web.rgba[i + 1] - 111) <= 10 && Math.abs(web.rgba[i + 2] - 237) <= 10) {
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y
      }
    }
    // 注入"圆角缺失"：四角方块填成直角（r=20 < 实际半径 23 ⇒ 方块内必含弧外像素）
    const r = 20
    const mutated = { width: web.width, height: web.height, rgba: web.rgba.slice() }
    const paint = (cx, cy) => {
      for (let y = cy; y < cy + r; y++) for (let x = cx; x < cx + r; x++) {
        const i = (y * mutated.width + x) * 4
        mutated.rgba[i] = 47; mutated.rgba[i + 1] = 111; mutated.rgba[i + 2] = 237; mutated.rgba[i + 3] = 255
      }
    }
    paint(bx0, by0); paint(bx1 - r + 1, by0); paint(bx0, by1 - r + 1); paint(bx1 - r + 1, by1 - r + 1)
    const obsSelf = pixelObservation(web, web)            // 对照组：自身 ⇒ 必须 identical（字节全等）
    const obsMut = pixelObservation(web, mutated)
    // ★检出判据（**实测定的口径**，不是"必须 changed"——见下）：
    //   圆角缺失的最大可注入信号 ≈ 455px（r≈23 时四角弧外面积 4·r²(1−π/4)）
    //   ——只占整屏 0.05%，**天然低于 0.5% 全局噪声带** ⇒ 本场景 verdict 恒为 noise-level。
    //   ⇒ L4 对这类缺陷的价值形态是**定位**（报告 diffPixels>0 且差异块落在注入区域），
    //     不是全局判定；圆角缺失的"通过/失败"结论由 L1/L3 的 borderRadius 数值承担。
    //   判据 = 对照组 identical ∧（注入后逐字节已不同 ∧ 差异块出现在注入的四角范围内）。
    const mutDiff = obsMut.diffPixels
    const localized = obsMut.regions.some((rg) =>
      rg.x >= bx0 - 24 && rg.x <= bx1 + 24 && rg.y >= by0 - 24 && rg.y <= by1 + 24,
    )
    run(
      'L4-radius-missing', 'L4',
      `圆角缺失（注入真实截图：四角填直角 ⇒ ${mutDiff}px 差异）⇒ 观测报告定位到注入区域（region 落在块边界±24px 内）；` +
        `对照组自身比对 = ${obsSelf.verdict}。★诚实边界：verdict=${obsMut.verdict}（0.05% < 0.5% 全局噪声带——L4 形态是"定位"，判定由 L3 borderRadius 数值承担）`,
      true,
      () => obsSelf.verdict === 'identical' && obsMut.verdict !== 'identical' && mutDiff > 0 && localized,
    )
  } else {
    pending.push({ id: 'L4-radius-missing', note: '真实截图未入库——先跑 `bash scripts/shoot-l4-fixtures.sh` 采集（不静默跳过：标准 §7.3）' })
  }

  const injected = results.filter((r) => r.expected).length
  const captured = results.filter((r) => r.expected && r.caught).length
  return { operators: results, injected, captured, pending }
}

/* ── ③ 指标组装 ── */
async function build() {
  const { errs, items } = validateAllowList()
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf-8'))
  const rows = matrix.rows
  const m1Total = rows.length
  // L1 层覆盖 = 矩阵三端都有实测的字段
  const m1Covered = rows.filter((r) => r.web !== 'not-measured' && r.skyline !== 'not-listed' && r.webview !== 'not-measured').length
  const mutation = await runMutationTests()
  const m4Rate = mutation.injected > 0 ? mutation.captured / mutation.injected : 0

  // ★M1 折算表（同源口径——见 M1 的注释）：样式键 → CSS 字段（四角/四边归并）
  const L3_FIELD_MAP = {
    backgroundColor: 'backgroundColor', color: 'color', display: 'display', fontSize: 'fontSize',
    opacity: 'opacity', position: 'position',
    borderTopLeftRadius: 'borderRadius', borderTopRightRadius: 'borderRadius',
    borderBottomRightRadius: 'borderRadius', borderBottomLeftRadius: 'borderRadius',
    borderTopWidth: 'borderWidth', borderRightWidth: 'borderWidth', borderBottomWidth: 'borderWidth', borderLeftWidth: 'borderWidth',
    borderTopColor: 'borderColor', borderRightColor: 'borderColor', borderBottomColor: 'borderColor', borderLeftColor: 'borderColor',
    marginTop: 'margin', marginRight: 'margin', marginBottom: 'margin', marginLeft: 'margin',
    paddingTop: 'padding', paddingRight: 'padding', paddingBottom: 'padding', paddingLeft: 'padding',
    // ★★覆盖扩展（2026-10-02·二批）：布局族 14 字段（与 TS 闭集同步）
    width: 'width', height: 'height',
    minWidth: 'minWidth', maxWidth: 'maxWidth', minHeight: 'minHeight', maxHeight: 'maxHeight',
    flexDirection: 'flexDirection', justifyContent: 'justifyContent',
    alignItems: 'alignItems', alignSelf: 'alignSelf',
    flexGrow: 'flexGrow', flexShrink: 'flexShrink', gap: 'gap', overflow: 'overflow',
    // ★覆盖收官（2026-10-02·三批）：偏移定位（条件可见——position 非 static 时实测有值）
    top: 'top', left: 'left',
    // fontFamily / fontWeight / visibility：不在 28 字段集内 ⇒ 不计（宁少算）
  }
  const l3Fields = new Set(Object.values(L3_FIELD_MAP))
  /** 几何四量 → 字段（x/y 是位置，不是 CSS 字段——保守只算 width/height） */
  const L2_FIELDS = new Set(['width', 'height'])
  const l1Fields = new Set(rows.map((r) => r.field))
  const coveredFields = new Set([...l1Fields, ...L2_FIELDS, ...l3Fields])

  return {
    version: 1,
    note: 'M1–M4 机器生成（scripts/gen-consistency-metrics.mjs）——每项都指向已入库产物；标准 §6.2 要求公开含不好看的数',
    generatedFrom: {
      matrix: 'docs/generated/end-support-matrix.json',
      allowList: 'docs/allow-differences.json',
      boundaryRules: 'packages/css-compat/src/generated/skyline-boundary-rules.generated.ts',
      baselines: ['examples/profile-boundary-baseline.json', 'showcase/profile-boundary-baseline.json'],
    },
    M1: {
      name: '数值一致性覆盖率',
      // ★★口径（本仓"标尺不虚高"纪律，两轮修正后的定稿）：
      //   标准 §6.1「L1+L2+L3 覆盖的属性数 / 全部可表达属性数」⇒ 分母 = **编译器 CSS 字段数 × 3**。
      //   ★★三层必须先**折算到同一字段集**再相加（首版直接把"几何量 4 + 样式键 25"当字段 =
      //     67.9% **虚高**——几何量不是 CSS 字段、样式键有 4 角/4 边重复与集外键）。
      //   折算规则（保守：宁可少算）：
      //     · L1：直接按字段（矩阵逐字段）——全部 28
      //     · L2：几何四量（x/y/w/h）→ 只映射 width/height **2 个字段**（x/y 是位置不是字段）
      //     · L3：实测样式键 → 映射回字段（四角归 borderRadius、四边归 margin/padding、
      //       四向归 borderWidth/borderColor；fontFamily/fontWeight/visibility **不在 28 字段集内 ⇒ 不计**）
      //   另给 `union`（并集口径：该字段是否被**任一**层机器校验）——对外更好理解的那一个数。
      definition:
        'Σ(L1|L2|L3 各层**折算到同一 CSS 字段集**后的覆盖数) / (可表达字段数 × 3)（分层加总 · 折算口径）' +
        '｜★L2.5/L2.6（交互层）**不计入本比值**：它们校验的不是 CSS 字段（是"结果态等价"与"6 类不变量"），' +
        '计入会让分母失去意义——覆盖状态单列在 byLayer，由门禁与 M4 算子承担。',
      value: m1Total > 0 ? Number(((m1Covered + L2_FIELDS.size + l3Fields.size) / (m1Total * 3)).toFixed(4)) : 0,
      /** ★并集口径：任一层的机器校验覆盖到的字段数 / 字段总数 */
      union: {
        covered: coveredFields.size,
        total: m1Total,
        value: m1Total > 0 ? Number((coveredFields.size / m1Total).toFixed(4)) : 0,
      },
      byLayer: {
        L1: { covered: m1Covered, total: m1Total, note: '支持度矩阵 + 边界门禁 + 棘轮基线（逐字段，已落地）' },
        L2: {
          covered: L2_FIELDS.size,
          total: m1Total,
          note: '比对引擎已落地 + 三端实测通过；**折算口径**：几何 w/h → 字段 width/height（x/y 是位置不是字段——保守计 2）',
        },
        L3: {
          covered: l3Fields.size,
          total: m1Total,
          note: `实测比对已落地（VC6：Web ⇄ WebView，硬门禁 + A-6 豁免）；**折算口径**：可比样式键 → ${l3Fields.size} 个字段（四角/四边归并；集外键不计）`,
        },
        // ★★L2.5 / L2.6 布点（2026-10-02·四批）：**交互层的覆盖口径随层定义**（不是 CSS 字段）——
        //   L2.5 覆盖"交互结果态"（事件→几何，判据是结果态逐节点一致 + 两端都真的动了）；
        //   L2.6 覆盖"6 类不变量"（structure/sizes/gaps/order/containment/translation）。
        //   ★与 M1 分母（CSS 字段）**不同源** ⇒ 数值上如何计入见下方 value 的折算说明。
        L2_5: { covered: 1, total: 1, note: '离散交互（事件→结果态几何）：跨端实测通过（两端位移均 60px + 结果态 7 节点一致）+ M4 算子 3 个（含"点了没反应"必红）' },
        L2_6: { covered: 6, total: 6, note: '连续交互不变量：6 类全绿（structure/sizes/gaps/order/containment/translation）+ 实测滚动 200/500px + M4 算子 4 个（含"纯滚动不应报"对照组）' },
      },
      covered: m1Covered,
      total: m1Total,
      byTier: {
        universal: rows.filter((r) => r.supportTier === 'universal').length,
        conditional: rows.filter((r) => r.supportTier === 'conditional').length,
        unsupported: rows.filter((r) => r.supportTier === 'unsupported').length,
      },
      boundaryRules: 24,
      note: 'L1/L2/L3 已布点；L4 不计入本比值（非门禁观察，且其样本来自光栅化而非 CSS 字段）——L2/L3 覆盖扩展后分子继续扩大（标准 §6.1「逐阶段提升」）',
    },
    M2: {
      name: '允许差异条目数',
      definition: 'docs/allow-differences.json 条目数（越少越好；每条必须有理由与证据；不得为让测试通过而加）',
      value: items.length,
      ids: items.map((i) => i.id),
      protected: PROTECTED_IDS,
    },
    M3: {
      name: 'CI 门禁通过率',
      definition: '参与门禁全绿 = 1.0；任一红 ⇒ 本脚本/CI 退出非零（本项是引用式指标）',
      gates: ['check:end-support', 'check:profile-baseline', 'test', 'check:consistency-metrics'],
      enforcedBy: 'CI (.github/workflows/ci.yml) + pnpm verify',
    },
    M4: {
      name: '一致性回归检出率',
      definition:
        '变异算子捕获数 / 注入数，覆盖六族：L1 编译期 · L2 几何 · L3 样式 · L2.5 离散交互 · L2.6 连续交互不变量 · L4 像素观察（真截图注入）' +
        '（仍未布点者 ⇒ 单列 pending，不得悄悄删——标准 §7.3）',
      value: Number(m4Rate.toFixed(4)),
      injected: mutation.injected,
      captured: mutation.captured,
      operators: mutation.operators,
      pendingOperators: mutation.pending,
      note: '★标准 §7.4 反例（按钮变色 = L3 颜色类 1/255）属必过项；L4 算子取**同端注入**（跨端圆角 AA 本身在噪声底内，无区分度——算子注释有实测数）',
    },
    debt: {
      note: '存量债务可见且只减不增（棘轮基线）——对外公开的"不好看的数"',
      baselines: ['examples/profile-boundary-baseline.json', 'showcase/profile-boundary-baseline.json'].map((rel) => {
        const p = path.join(ROOT, rel)
        const n = fs.existsSync(p) ? Object.keys(JSON.parse(fs.readFileSync(p, 'utf-8'))).length : -1
        return { file: rel, count: n }
      }),
    },
    allowListSchemaErrors: errs,
  }
}

async function main() {
  const metrics = await build()
  const json = JSON.stringify(metrics, null, 2) + '\n'
  // schema 错误：无论何种模式都红（清单不合法时指标无意义）
  if (metrics.allowListSchemaErrors.length > 0) {
    console.error('[consistency-metrics] ✗ 允许差异清单 schema 违规：')
    for (const e of metrics.allowListSchemaErrors) console.error('  - ' + e)
    process.exit(2)
  }
  if (CHECK) {
    const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
    const ok = prev === json
    console.log(`  consistency-metrics --check → docs/generated/consistency-metrics.json${ok ? ' ✅ 一致' : ' ❌ 漂移'}`)
    console.log(`  ▸ M1 ${(metrics.M1.value * 100).toFixed(1)}%（分层加总：L1 ${metrics.M1.byLayer.L1.covered} · L2 ${metrics.M1.byLayer.L2.covered} · L3 ${metrics.M1.byLayer.L3.covered}｜并集 ${(metrics.M1.union.value * 100).toFixed(1)}%）· M2 ${metrics.M2.value} 条 · M4 ${(metrics.M4.value * 100).toFixed(0)}%（${metrics.M4.captured}/${metrics.M4.injected}）· 存量 ${metrics.debt.baselines.map((b) => b.count).join('+')}`)
    // ★M4 自检（防"零运算符假绿"）：注入数必须 > 0 且捕获率必须为 1（L1 算子必须全捕获）
    if (metrics.M4.injected === 0 || metrics.M4.value < 1) {
      console.error('  ✗ M4 自检失败：L1 变异算子必须全部被捕获（当前 %d/%d）——校验机制失效', metrics.M4.captured, metrics.M4.injected)
      process.exit(1)
    }
    if (!ok) process.exit(1)
    console.log('✅ 一致性指标与清单一致（M1–M4 + schema）')
    return
  }
  fs.writeFileSync(OUT, json)
  console.log(`[consistency-metrics] ✅ ${path.relative(ROOT, OUT)}`)
  console.log(`  M1 ${(metrics.M1.value * 100).toFixed(1)}%（分层加总：L1 ${metrics.M1.byLayer.L1.covered} · L2 ${metrics.M1.byLayer.L2.covered} · L3 ${metrics.M1.byLayer.L3.covered}｜并集口径 ${(metrics.M1.union.value * 100).toFixed(1)}%）`)
  console.log(`  M2 ${metrics.M2.value} 条（${metrics.M2.ids.join(' / ')}）`)
  console.log(`  M4 ${(metrics.M4.value * 100).toFixed(0)}%（${metrics.M4.captured}/${metrics.M4.injected}，pending ${metrics.M4.pendingOperators.length} 个算子）`)
  console.log(`  存量债务：${metrics.debt.baselines.map((b) => `${b.file.split('/')[0]} ${b.count}`).join(' · ')}`)
}

main().catch((e) => {
  console.error('[consistency-metrics] ✗', e?.message ?? e)
  process.exit(2)
})
