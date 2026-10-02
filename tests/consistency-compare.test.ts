// tests/consistency-compare.test.ts
// ★VC5-a（分级容差）+ VC5-b（几何比对）+ VC6（样式比对）—— 单测与反例
//
// 【本档的"必过项"（标准 §7.4 / §14#3 硬要求）】「按钮变色」case（50×20 小面积颜色偏移
//   1/255）必须被检出——捕获不了这套校验就不比截图比对强。此用例在 `describe('★反例')` 中。
//
// 【另一条纪律】本档断言"代码中不存在任何全页差异率判定"（卡 VC5-a 核心约束）——
//   对 compare.ts / tolerance.ts 做**源码扫描**（白盒判据）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareGeometry, compareAgainstWeb, compareStyle, compareStyleAgainstWeb, classifyStyleKey,
  resolveTolerance, validateToleranceConfig, DEFAULT_TOLERANCE,
} from '@proteus-vue/consistency'
import type { GeometrySnapshot, StyleSnapshot } from '@proteus-vue/consistency'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOLERANCE_FILE = path.join(ROOT, 'docs/consistency-tolerance.json')
const projTolerance = resolveTolerance(JSON.parse(fs.readFileSync(TOLERANCE_FILE, 'utf-8')))

/* ── 夹具构造 ── */
/**
 * 夹具：根 → 按钮（path=0, 200×60）→ 文本（path=0.0, 120×24）
 * `over` 覆盖按钮字段、`childOver` 覆盖文本字段；两者都不允许覆盖 children
 * （首版用展开顺序处理，结果互相覆盖——单测抓出；改为**显式取字段**，结构不会被误改）。
 */
const geo = (over: Partial<GeometrySnapshot['root']> = {}, childOver: Partial<GeometrySnapshot['root']> = {}): GeometrySnapshot => ({
  format: 'proteus-geometry-snapshot',
  version: 1,
  end: 'web',
  viewport: { width: 390, height: 844 },
  root: {
    nodeId: 1, path: '', x: 0, y: 0, w: 390, h: 844, depth: 0,
    children: [
      {
        nodeId: 2, path: '0', x: 12, y: 12, w: 200, h: 60, depth: 1, semanticKey: 'p-button',
        ...over,
        children: [
          // ★叶子节点的 children 必须显式写 []（首版漏了 ⇒ 递归遍历 undefined 崩——单测抓出）
          { nodeId: 3, path: '0.0', x: 16, y: 20, w: 120, h: 24, depth: 2, semanticKey: 'p-text', ...childOver, children: [] },
        ],
      },
    ],
  },
})

const style = (mut: (s: Record<string, unknown>) => void = () => {}): StyleSnapshot => {
  const styles: Record<string, unknown> = {
    backgroundColor: { r: 47, g: 111, b: 237, a: 1 },   // #2f6fed（按钮蓝）
    color: { r: 255, g: 255, b: 255, a: 1 },
    borderTopLeftRadius: 18,
    borderTopWidth: 1,
    opacity: 0.5,
    display: 'flex',
    fontSize: 16,
    fontWeight: 700,
    fontFamily: 'PingFang SC',
  }
  mut(styles)
  return {
    format: 'proteus-style-snapshot', version: 1, end: 'web',
    nodes: [{ nodeId: 2, path: '0', styles }],
  }
}

describe('VC5-b · L2 几何比对引擎', () => {
  it('① 完全一致 ⇒ ok（无超容差差异）', () => {
    const r = compareGeometry(geo(), geo(), { tolerance: projTolerance })
    expect(r.ok).toBe(true)
    expect(r.summary.compared).toBe(3)
    expect(r.diffs.every((d) => !d.overTolerance)).toBe(true)
  })

  it('② 间距偏移 3px ⇒ 检出（含 path/属性/偏差/容差/依据——卡片四要素+）', () => {
    const r = compareGeometry(geo(), geo({ x: 15 }), { tolerance: projTolerance })
    expect(r.ok).toBe(false)
    const d = r.diffs.find((x) => x.property === 'x' && x.overTolerance)!
    expect(d.path).toBe('0')
    expect(d.aValue).toBe(12)
    expect(d.bValue).toBe(15)
    expect(d.deviation).toBe(3)
    expect(d.tolerance).toBe(1)              // max(1px, 0.5%×12) = 1
    expect(d.toleranceClass).toBe('structure')
    expect(d.rationale && d.rationale.length).toBeGreaterThan(10)
  })

  it('③ 容差内（0.5px）⇒ 记录但不判失败（单项判定）', () => {
    const r = compareGeometry(geo(), geo({ x: 12.5 }), { tolerance: projTolerance })
    expect(r.ok).toBe(true)
    const d = r.diffs.find((x) => x.property === 'x')!
    expect(d.overTolerance).toBe(false)
  })

  it('④ 节点缺失 / 多余 ⇒ 各自成类且判失败', () => {
    const missing = geo()
    missing.root.children[0]!.children = []          // 候选缺失 path=0.0
    const r1 = compareGeometry(geo(), missing, { tolerance: projTolerance })
    expect(r1.ok).toBe(false)
    expect(r1.diffs.some((d) => d.kind === 'missing-in-candidate' && d.path === '0.0')).toBe(true)

    const extra = geo()
    extra.root.children.push({ nodeId: 9, path: '1', x: 0, y: 300, w: 10, h: 10, depth: 1, children: [] })
    const r2 = compareGeometry(geo(), extra, { tolerance: projTolerance })
    expect(r2.ok).toBe(false)
    expect(r2.diffs.some((d) => d.kind === 'extra-in-candidate' && d.path === '1')).toBe(true)
  })

  it('⑤ 层级错位（同 path 深度不同）⇒ depth-mismatch 判失败', () => {
    const bad = geo()
    bad.root.children[0]!.children[0]!.depth = 3
    const r = compareGeometry(geo(), bad, { tolerance: projTolerance })
    expect(r.ok).toBe(false)
    expect(r.diffs.some((d) => d.kind === 'depth-mismatch')).toBe(true)
  })

  it('⑥ 文本节点走宽带（textMetrics）：同偏移量在文本上不误报、超带仍报', () => {
    // 文本 w=120：宽带 max(2, 2%×120=2.4) = 2.4
    const within = compareGeometry(geo(), geo({}, { w: 122 }), { tolerance: projTolerance })
    const dWithin = within.diffs.find((x) => x.path === '0.0' && x.property === 'w')!
    expect(dWithin.toleranceClass).toBe('textMetrics')
    expect(dWithin.tolerance).toBe(2.4)
    expect(dWithin.overTolerance).toBe(false)
    const beyond = compareGeometry(geo(), geo({}, { w: 125 }), { tolerance: projTolerance })
    expect(beyond.ok).toBe(false)
  })

  it('⑦ 坐标对齐：滚动位移（全树平移）默认不误报；关对齐（align:none）则报', () => {
    const scrolled = geo()
    // 整树 y 平移 300（页面滚动量）
    const shift = (n: GeometrySnapshot['root']): void => { n.y += 300; for (const c of n.children) shift(c) }
    shift(scrolled.root)
    const aligned = compareGeometry(geo(), scrolled, { tolerance: projTolerance })
    expect(aligned.ok, '默认按根归零 ⇒ 滚动位移不算几何差异').toBe(true)
    expect(aligned.aligned).toBe('root')
    const absolute = compareGeometry(geo(), scrolled, { tolerance: projTolerance, align: 'none' })
    expect(absolute.ok, '显式关对齐 ⇒ 绝对坐标差异如实报').toBe(false)
  })

  it('⑧ compareAgainstWeb：基线必须是 web（真值基准不可替换）', () => {
    const candidate: GeometrySnapshot = { ...geo(), end: 'skyline' }
    const r = compareAgainstWeb(geo(), candidate, { tolerance: projTolerance })
    expect(r.baselineEnd).toBe('web')
    expect(r.candidateEnd).toBe('skyline')
    expect(() => compareAgainstWeb(candidate, geo())).toThrow(/基线端必须是 web/)
  })
})

describe('VC5-a · 分级容差配置（规格与防护）', () => {
  it('⑨ 工程配置（docs/consistency-tolerance.json）合法且每类有依据', () => {
    expect(validateToleranceConfig(projTolerance)).toEqual([])
    for (const k of ['structure', 'color', 'font', 'textMetrics', 'nonDeterministic'] as const) {
      expect(projTolerance.classes[k].rationale.length, `${k} 必须有容差依据`).toBeGreaterThan(20)
    }
  })

  it('⑩ 缺依据 / 出现"全局"类别 / 通配 override / 放宽超 caps ⇒ 校验器逐一拒绝', () => {
    const noRationale = JSON.parse(JSON.stringify(projTolerance))
    noRationale.classes.color.rationale = ''
    expect(validateToleranceConfig(noRationale).some((e) => e.includes('缺容差依据'))).toBe(true)

    const globalCls = JSON.parse(JSON.stringify(projTolerance))
    globalCls.classes.global = { pct: 1 }
    expect(validateToleranceConfig(globalCls).some((e) => e.includes('禁止的类别名'))).toBe(true)

    const wildcard = JSON.parse(JSON.stringify(projTolerance))
    wildcard.overrides = [{ pid: '*', rationale: '想让全部测试通过（反例）', classes: { structure: { absPx: 2 } } }]
    expect(validateToleranceConfig(wildcard).some((e) => e.includes('通配'))).toBe(true)

    const tooWide = JSON.parse(JSON.stringify(projTolerance))
    tooWide.overrides = [{ pid: 'p-tabbar', rationale: '某组件真机有差异', classes: { structure: { absPx: 99 } } }]
    expect(validateToleranceConfig(tooWide).some((e) => e.includes('超 caps'))).toBe(true)

    const colorRelax = JSON.parse(JSON.stringify(projTolerance))
    colorRelax.overrides = [{ pid: 'p-tabbar', rationale: '试图放宽颜色（反例）', classes: { color: { channelDelta: 5 } } }]
    expect(validateToleranceConfig(colorRelax).some((e) => e.includes('只允许放宽 structure / textMetrics'))).toBe(true)
  })

  it('⑪ 组件级 override 生效（仅结构/文本，且不超 caps）', () => {
    const cfg = resolveTolerance({
      ...JSON.parse(JSON.stringify(projTolerance)),
      // ★override 挂**承载文本的节点**（p-text）——compare 取的是文本节点自身的 semanticKey
      //   （首版挂 p-button 无效——测试抓出：override 匹配口径必须写清，否则"配了没生效"）
      overrides: [{ pid: 'p-text', rationale: '真机小字号文本的度量带略宽（已评审）', classes: { textMetrics: { absPx: 3 } } }],
    })
    // 默认（无 override）宽 122.5（偏差 2.5 > 2.4）判失败；override absPx:3 后 max(3, 2.4)=3 ⇒ 通过
    const before = compareGeometry(geo(), geo({}, { w: 122.5 }), { tolerance: projTolerance })
    expect(before.ok, '默认宽带下 2.5px 偏差应判失败').toBe(false)
    const r2 = compareGeometry(geo(), geo({}, { w: 122.5 }), { tolerance: cfg })
    const d = r2.diffs.find((x) => x.path === '0.0' && x.property === 'w')!
    expect(d.tolerance).toBe(3)
    expect(d.overTolerance).toBe(false)
    expect(d.rationale).toContain('override')
  })

  it('⑫ 🔴 代码中不存在"全页差异率 ≤ X% 即通过"的判定（源码白盒扫描）', () => {
    for (const f of ['compare.ts', 'tolerance.ts']) {
      // ★扫描口径：只扫**代码**（去注释）——注释里解释"本文件不含全局阈值"是正当说明，
      //   不该被自己的判据误伤（首版被误伤：rationale 文案里有"全页差异率"四字）。
      const src = fs
        .readFileSync(path.join(ROOT, 'packages/consistency/src', f), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      // ★判据收窄（两轮误伤后的正解）：拦的是**判定形态**——"差异率变量参与比较"。
      //   `tolerance.ts` 的 FORBIDDEN_CLASS_KEYS 黑名单里**必须**列出这些词（那是防御本身）；
      //   而 `rate <= X` / `percent <= X` 这样的比较表达式才是违规。⇒ 只扫比较/赋值形态：
      const antiPatterns = [
        /(diffRate|mismatchRate|pageDiff|overallDiff|diffPercent)\s*[<>=]/i,   // 率变量参与比较
        /[<>=]\s*\w*\d+\s*%[^'"]{0,20}(pass|ok|通过)/i,                          // "≤X% 即通过"字样
        /\b(tolerance\s*=\s*)\d+\s*%/i,                                       // 全局百分比容差赋值
      ]
      for (const re of antiPatterns) {
        const m = re.exec(src)
        expect(m, `${f} 不得含全局差异率判定（命中：${m?.[0]}）`).toBeNull()
      }
    }
    // 判定函数必须逐条（ok = 无任何 overTolerance）
    const src = fs.readFileSync(path.join(ROOT, 'packages/consistency/src/compare.ts'), 'utf-8')
    expect(src).toMatch(/ok\s*=\s*!diffs\.some\(\(d\)\s*=>\s*d\.overTolerance\)/)
  })
})

describe('VC6 · L3 样式比对', () => {
  it('⑬ 样式一致 ⇒ ok；键集交集比对（单侧键计数可见）', () => {
    const r = compareStyle(style(), style(), { tolerance: projTolerance })
    expect(r.ok).toBe(true)
    expect(r.summary.compared).toBe(1)
    expect(r.summary.keysOnlyInA + r.summary.keysOnlyInB).toBe(0)
  })

  it('⑭ 圆角差异 ⇒ 按 nonDeterministic 跳过（不比数值，如实计数）', () => {
    const r = compareStyle(style(), style((s) => { s.borderTopLeftRadius = 0 }), { tolerance: projTolerance })
    expect(r.ok).toBe(true)
    expect(r.summary.skipped).toBe(1)
    expect(classifyStyleKey('borderTopLeftRadius')).toBe('skip')
  })

  it('⑮ 枚举/字体/标量：display 变、字族回退、opacity 容差内各得其所', () => {
    const display = compareStyle(style(), style((s) => { s.display = 'block' }), { tolerance: projTolerance })
    expect(display.ok).toBe(false)
    expect(display.diffs.some((d) => d.key === 'display' && d.class === 'enum' && d.overTolerance)).toBe(true)

    const font = compareStyle(style(), style((s) => { s.fontFamily = 'sans-serif' }), { tolerance: projTolerance })
    expect(font.ok, '字族回退必须被检出（标准 §9.3 例外需显式登记才放行）').toBe(false)

    const scalar = compareStyle(style(), style((s) => { s.opacity = 0.5004 }), { tolerance: projTolerance })
    expect(scalar.ok, 'float 表示粒度内不误报').toBe(true)
  })

  it('⑮b ★允许差异豁免：清单内不判失败（留痕 allowedBy）；清单外仍判失败', () => {
    const withFontDiff = style((s) => { s.fontFamily = 'system-ui' })  // 夹具默认是 'PingFang SC'——必须改成**不同**的值（首版改了同值 = 空测）
    // 无豁免 ⇒ 失败
    const bare = compareStyle(style(), withFontDiff, { tolerance: projTolerance })
    expect(bare.ok, '字族不同默认判失败').toBe(false)
    // 有豁免（A-6）⇒ 通过 + 留痕
    const allowed = compareStyle(style(), withFontDiff, {
      tolerance: projTolerance,
      allowDifferences: [{ id: 'A-6', key: 'fontFamily' }],
    })
    expect(allowed.ok, '豁免后不判失败（标准 §9.1：清单内不判失败）').toBe(true)
    const d = allowed.diffs.find((x) => x.key === 'fontFamily')!
    expect(d.allowedBy, '必须留痕（可审计）').toBe('A-6')
    expect(d.overTolerance).toBe(false)
    // ★豁免不越界：它只对 fontFamily 生效——颜色差异仍判失败
    const colorToo = style((s) => { s.fontFamily = 'system-ui'; s.backgroundColor = { r: 0, g: 0, b: 0, a: 1 } })
    const mixed = compareStyle(style(), colorToo, {
      tolerance: projTolerance,
      allowDifferences: [{ id: 'A-6', key: 'fontFamily' }],
    })
    expect(mixed.ok, '清单外差异（颜色）仍判失败——"清单外一律当 bug"').toBe(false)
  })

  it('⑯ compareStyleAgainstWeb：真值基准强制', () => {
    const candidate: StyleSnapshot = { ...style(), end: 'webview' }
    const r = compareStyleAgainstWeb(style(), candidate, { tolerance: projTolerance })
    expect(r.candidateEnd).toBe('webview')
    expect(() => compareStyleAgainstWeb(candidate, style())).toThrow(/基线端必须是 web/)
  })
})

describe('★反例（标准 §7.4 / §14#3 必过项）：按钮变色必须被检出', () => {
  it('⑰ 50×20 按钮的 1/255 颜色偏移（#2f6fed → #2e6fed）⇒ 判失败且可定位', () => {
    // 这是"小面积、易被噪声淹没"的经典漏报场景——传统全局阈值必然放过
    const mutated = style((s) => { s.backgroundColor = { r: 46, g: 111, b: 237, a: 1 } }) // g 不变、r -1
    const r = compareStyle(style(), mutated, { tolerance: projTolerance })
    expect(r.ok, '★1/255 的单通道偏移必须判失败（exact 容差；若这里绿了，整套校验不比截图比对强）').toBe(false)
    const d = r.diffs.find((x) => x.key === 'backgroundColor' && x.overTolerance)!
    expect(d.class).toBe('color')
    expect(d.deviation).toBe(1)
    expect(d.tolerance).toBe(0)
    expect(d.hint, '含修复方向（VC8-b：可被 AI 消费）').toBeTruthy()
  })

  it('⑱ 几何侧的同类反例：按钮宽 1px 静默漂移（在 0.5% 容差下也必须报）', () => {
    // 200px 宽按钮：0.5% = 1px；1px 偏移恰好触界 ⇒ 用 1.5px 验证"小偏移不被大比例吞掉"
    const r = compareGeometry(geo(), geo({ w: 201.5 }), { tolerance: projTolerance })
    expect(r.ok).toBe(false)
    const d = r.diffs.find((x) => x.property === 'w' && x.overTolerance)!
    expect(d.deviation).toBe(1.5)
  })
})
