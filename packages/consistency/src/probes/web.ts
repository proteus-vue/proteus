// packages/consistency/src/probes/web.ts
// ★★VC4-a：Web 端探针——**真值基准**（卡片：Web 端浏览器 = 真值，实现必须严格对齐标准语义）。
//
// 【采集 → 归一化 → 快照，三步都在本文件内完成】本探针**只负责采集 DOM 事实**，
//   归一化一律走 `../snapshot` 的共享原语（单一实现——禁止比对层格式适配，也禁止探针各写一套）。
//
// 【几何坐标系】统一为**视口左上角原点**（卡片 VC3-a）：`getBoundingClientRect()`
//   天然就是视口坐标系 ⇒ Web 端零换算（这正是它做真值基准的原因）。
//
// 【样式采集范围】VC3-b 的闭集（颜色/字体族/间距/边框/圆角/透明度/display/position/visibility）——
//   清单外的属性**不采集**（闭集纪律：要么登记，要么别产出）。
//
// 【诚实边界（写进快照 boundaries）】① 文本度量：本探针不采集文本尺寸（那是几何的一部分，
//   `getBoundingClientRect` 已含——但字体的度量来源是浏览器，与 App 端不同 ⇒ A-1 允许差异）；
//   ② 锁定测试字体由调用方负责（`opts.fontsLocked` 如实记录）；③ 伪元素不采集（无 nodeId 语义）。

import type { GeometryNode, GeometrySnapshot, Rgba, NormalizedStyle, StyleNode, StyleSnapshot } from '../snapshot'
import { round3, normalizeColor, normalizeLength, normalizeFontWeight, normalizeFontFamily } from '../snapshot'

export interface WebProbeOptions {
  /** 根节点选择器（缺省 `body`） */
  rootSelector?: string
  /** 只采集这些语义键（data-proteus-id 有值的节点）——缺省采集全树 */
  semanticOnly?: boolean
  /** 如实记录：调用方是否锁定了确定性测试字体（Ahem 等） */
  fontsLocked?: boolean
  /** 排除选择器（如探针自身挂载点） */
  excludeSelector?: string
}

/** 采集几何：DOM 树 → GeometryNode（视口坐标 + round3 + path/depth） */
export function collectWebGeometry(doc: Document, opts: WebProbeOptions = {}): GeometrySnapshot {
  const rootEl = (doc.querySelector(opts.rootSelector ?? 'body') ?? doc.body) as Element
  const exclude: Set<Element> = opts.excludeSelector ? new Set(Array.from(rootEl.querySelectorAll(opts.excludeSelector)) as Element[]) : new Set<Element>()

  /** 节点 id：优先 data-proteus-id；否则用 path（Web 无内核 id——path 是确定形态） */
  const idOf = (el: Element, path: string): number | string => {
    const attr = el.getAttribute('data-proteus-id')
    return attr !== null && attr !== '' ? attr : `p:${path}`
  }
  const semanticOf = (el: Element): string | undefined => {
    const pid = el.getAttribute('data-proteus-pid')
    return pid ?? undefined
  }

  const walk = (el: Element, path: string, depth: number): GeometryNode => {
    const r = el.getBoundingClientRect()
    const node: GeometryNode = {
      nodeId: idOf(el, path),
      path,
      x: round3(r.left),
      y: round3(r.top),
      w: round3(r.width),
      h: round3(r.height),
      depth,
      children: [],
    }
    const sem = semanticOf(el)
    if (sem !== undefined) node.semanticKey = sem
    let i = 0
    for (const child of Array.from(el.children)) {
      if (exclude.has(child)) continue
      if (opts.semanticOnly && !child.hasAttribute('data-proteus-id') && child.querySelectorAll('[data-proteus-id]').length === 0) {
        // semanticOnly：跳过整棵不含语义键的子树（性能——大页面上探针只关心登记节点）
        continue
      }
      node.children.push(walk(child, path === '' ? String(i) : `${path}.${i}`, depth + 1))
      i++
    }
    return node
  }

  return {
    format: 'proteus-geometry-snapshot',
    version: 1,
    end: 'web',
    viewport: { width: round3(doc.documentElement.clientWidth), height: round3(doc.documentElement.clientHeight) },
    boundaries: {
      fontsLocked: opts.fontsLocked ?? false,
      textMeasuredBy: 'browser (getBoundingClientRect — 含字体度量结果)',
      note: 'Web 端 = 真值基准（卡片 VC3-a）。文本尺寸差异（vs 其他端）归 A-1 允许差异。',
    },
    root: walk(rootEl, '', 0),
  }
}

/** 取元素的归一化样式（闭集；异常形态**抛错**——不猜，见 VC3-b） */
function styleOf(el: Element, win: Window): NormalizedStyle {
  const cs = win.getComputedStyle(el)
  const styles: NormalizedStyle = {}
  const color = (prop: string): Rgba | undefined => {
    const v = cs.getPropertyValue(prop)
    if (!v || v === 'rgba(0, 0, 0, 0)' && prop !== 'color') return undefined
    // ★全透明背景视同"未设置"（`rgba(0,0,0,0)` 是浏览器对未设背景的默认返回——
    //   直接采会产生"每个节点都有 backgroundColor"的噪声；显式声明 transparent 同上处理）
    if (prop === 'background-color' && /^rgba\(0,\s*0,\s*0,\s*0\)$/.test(v)) return undefined
    try {
      return normalizeColor(v)
    } catch {
      return undefined // 颜色形态未识别（如 color-mix / oklch）⇒ 不采集（宁缺勿猜；缺口由门禁的覆盖率指标暴露）
    }
  }
  const len = (prop: string): number | undefined => {
    const v = cs.getPropertyValue(prop)
    if (!v) return undefined
    try {
      const n = normalizeLength(v)
      return n === null ? undefined : n
    } catch {
      return undefined
    }
  }
  const c1 = color('color')
  if (c1) styles.color = c1
  const bg = color('background-color')
  if (bg) styles.backgroundColor = bg
  const fs = len('font-size')
  if (fs !== undefined) styles.fontSize = fs
  const fw = cs.getPropertyValue('font-weight')
  if (fw) {
    try {
      styles.fontWeight = normalizeFontWeight(fw)
    } catch {
      /* 未识别字重：不采集 */
    }
  }
  const ff = cs.getPropertyValue('font-family')
  if (ff) styles.fontFamily = normalizeFontFamily(ff)
  for (const [prop, key] of [
    ['padding-top', 'paddingTop'], ['padding-right', 'paddingRight'],
    ['padding-bottom', 'paddingBottom'], ['padding-left', 'paddingLeft'],
    ['margin-top', 'marginTop'], ['margin-right', 'marginRight'],
    ['margin-bottom', 'marginBottom'], ['margin-left', 'marginLeft'],
    ['border-top-width', 'borderTopWidth'], ['border-right-width', 'borderRightWidth'],
    ['border-bottom-width', 'borderBottomWidth'], ['border-left-width', 'borderLeftWidth'],
    ['border-top-left-radius', 'borderTopLeftRadius'], ['border-top-right-radius', 'borderTopRightRadius'],
    ['border-bottom-right-radius', 'borderBottomRightRadius'], ['border-bottom-left-radius', 'borderBottomLeftRadius'],
  ] as const) {
    const n = len(prop)
    if (n !== undefined) (styles as Record<string, unknown>)[key] = n
  }
  for (const [prop, key] of [
    ['border-top-color', 'borderTopColor'], ['border-right-color', 'borderRightColor'],
    ['border-bottom-color', 'borderBottomColor'], ['border-left-color', 'borderLeftColor'],
  ] as const) {
    const c = color(prop)
    if (c) (styles as Record<string, unknown>)[key] = c
  }
  const op = len('opacity')
  if (op !== undefined) styles.opacity = op
  // ★★覆盖扩展（2026-10-02·二批）：布局族（数值项 `auto`/`none`/`normal` ⇒ 不产出——
  //   与 normalizeLength 的口径一致：跳过而非假装 0）
  for (const [prop, key] of [
    ['width', 'width'], ['height', 'height'],
    ['min-width', 'minWidth'], ['max-width', 'maxWidth'],
    ['min-height', 'minHeight'], ['max-height', 'maxHeight'],
    ['flex-grow', 'flexGrow'], ['flex-shrink', 'flexShrink'], ['gap', 'gap'],
  ] as const) {
    const n = len(prop)
    if (n !== undefined) (styles as Record<string, unknown>)[key] = n
  }
  // ★覆盖收官：偏移定位（static 下 computed 是 `auto` ⇒ normalizeLength 返回 null ⇒ 不产出）
  for (const [prop, key] of [['top', 'top'], ['left', 'left']] as const) {
    const n = len(prop)
    if (n !== undefined) (styles as Record<string, unknown>)[key] = n
  }
  // 枚举项（字符串原样——跨端同名归一由各端 computed style 保证）
  for (const [prop, key] of [
    ['flex-direction', 'flexDirection'], ['justify-content', 'justifyContent'],
    ['align-items', 'alignItems'], ['align-self', 'alignSelf'], ['overflow', 'overflow'],
  ] as const) {
    const v = cs.getPropertyValue(prop)
    if (v) (styles as Record<string, unknown>)[key] = v
  }
  const display = cs.getPropertyValue('display')
  if (display) styles.display = display
  const position = cs.getPropertyValue('position')
  if (position) styles.position = position
  const visibility = cs.getPropertyValue('visibility')
  if (visibility) styles.visibility = visibility

  /* ══ ★★★G-61 B3（2026-10-05）：L2 全覆盖新增读数（20 键）——形态按 snapshot.ts 的 canonical 约定 ══ */
  // ① 布局无关 px 长度（pct/normal/auto ⇒ 不产出——与既有"无值不判"同口径）
  for (const [prop, key] of [
    ['letter-spacing', 'letterSpacing'], ['line-height', 'lineHeight'],
    ['row-gap', 'rowGap'], ['column-gap', 'columnGap'],
    ['right', 'right'], ['bottom', 'bottom'],
  ] as const) {
    const n = len(prop)
    if (n !== undefined) (styles as Record<string, unknown>)[key] = n
  }
  // ② 布局无关枚举（字符串原样小写）
  for (const [prop, key] of [
    ['text-align', 'textAlign'], ['text-overflow', 'textOverflow'],
    ['text-decoration-line', 'textDecoration'], ['pointer-events', 'pointerEvents'],
    ['flex-wrap', 'flexWrap'], ['align-content', 'alignContent'],
  ] as const) {
    const v = cs.getPropertyValue(prop)
    if (v) (styles as Record<string, unknown>)[key] = v.trim()
  }
  // ③ canonical 串族
  const aspect = cs.getPropertyValue('aspect-ratio')
  if (aspect && aspect !== 'auto') (styles as Record<string, unknown>).aspectRatio = aspect.trim().replace(/\s*/g, ' ').replace(/\s*\/\s*/g, ' / ').trim()
  {
    // flex-basis：px → `<n>px`；百分比保留文本；auto/content 直通
    const fb = cs.getPropertyValue('flex-basis').trim()
    if (fb && fb !== 'auto' && fb !== 'content' && fb !== '0%') {
      const n = /^(-?[\d.]+)px$/.exec(fb)
      ;(styles as Record<string, unknown>).flexBasis = n ? round3(Number(n[1])) + 'px' : fb.replace(/\s+/g, ' ')
    } else if (fb === 'auto') {
      // auto 是默认值 ⇒ 不产出（与"无值不判"同口径）
    }
  }
  {
    // transform：matrix(a,b,c,d,e,f) 规范串（去掉空格；round3）；none ⇒ 不产出
    const tf = cs.getPropertyValue('transform').trim()
    if (tf && tf !== 'none') {
      const m = /^matrix\(([^)]+)\)$/.exec(tf)
      if (m) {
        const nums = m[1]!.split(',').map((s) => round3(Number(s.trim())))
        ;(styles as Record<string, unknown>).transform = 'matrix(' + nums.join(',') + ')'
      } else {
        ;(styles as Record<string, unknown>).transform = tf.replace(/\s+/g, ' ') // 3D 等形态原样（比对层 strict）
      }
    }
  }
  {
    // box-shadow：浏览器给 `rgba(...) dx dy blur spread`（color 在前）⇒ canonical：`dx dy blur spread #rrggbb[aa]`
    const bs = cs.getPropertyValue('box-shadow').trim()
    if (bs && bs !== 'none') {
      const c = (() => {
        try {
          const rgba = normalizeColor((/^(rgba?\([^)]*\))/.exec(bs)?.[1] ?? '#000').trim())
          const hx = (n: number): string => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
          const base = '#' + hx(rgba.r) + hx(rgba.g) + hx(rgba.b)
          return rgba.a >= 1 ? base : base + hx(Math.round(rgba.a * 255))
        } catch {
          return null
        }
      })()
      const lens = [...bs.matchAll(/(-?[\d.]+)px/g)].map((x) => round3(Number(x[1])))
      if (c !== null && lens.length >= 2) {
        const [dx = 0, dy = 0, blur = 0, spread = 0] = lens
        ;(styles as Record<string, unknown>).boxShadow = `${dx} ${dy} ${blur} ${spread} ${c}`
      }
    }
  }
  for (const [prop, key] of [['grid-template-columns', 'gridTemplateColumns'], ['grid-template-rows', 'gridTemplateRows']] as const) {
    const v = cs.getPropertyValue(prop).trim()
    if (v && v !== 'none') {
      // resolved 已是 px 列表（repeat 已展开）⇒ 规范：单空格分隔 + round3
      const norm = v
        .replace(/(-?[\d.]+)px/g, (_m, n: string) => round3(Number(n)) + 'px')
        .replace(/\s+/g, ' ')
        .trim()
      ;(styles as Record<string, unknown>)[key] = norm
    }
  }
  for (const [prop, key] of [['grid-column', 'gridColumn'], ['grid-row', 'gridRow']] as const) {
    const v = cs.getPropertyValue(prop).trim()
    if (v && v !== 'auto') (styles as Record<string, unknown>)[key] = v.replace(/\s+/g, ' ')
  }
  return styles
}

/** 采集计算样式：DOM 树 → StyleSnapshot（与几何同一遍历顺序——同一 path 语义） */
export function collectWebStyle(doc: Document, opts: WebProbeOptions = {}): StyleSnapshot {
  const win = doc.defaultView ?? window
  const rootEl = (doc.querySelector(opts.rootSelector ?? 'body') ?? doc.body) as Element
  const exclude: Set<Element> = opts.excludeSelector ? new Set(Array.from(rootEl.querySelectorAll(opts.excludeSelector)) as Element[]) : new Set<Element>()
  const nodes: StyleNode[] = []
  const idOf = (el: Element, path: string): number | string => {
    const attr = el.getAttribute('data-proteus-id')
    return attr !== null && attr !== '' ? attr : `p:${path}`
  }
  const walk = (el: Element, path: string): void => {
    nodes.push({ nodeId: idOf(el, path), path, styles: styleOf(el, win) })
    let i = 0
    for (const child of Array.from(el.children)) {
      if (exclude.has(child)) continue
      if (opts.semanticOnly && !child.hasAttribute('data-proteus-id') && child.querySelectorAll('[data-proteus-id]').length === 0) continue
      walk(child, path === '' ? String(i) : `${path}.${i}`)
      i++
    }
  }
  walk(rootEl, '')
  return {
    format: 'proteus-style-snapshot',
    version: 1,
    end: 'web',
    nodes,
    boundaries: { fontsLocked: opts.fontsLocked ?? false, note: 'Web = 真值基准；归一化走 @proteus-vue/consistency 共享原语' },
  }
}
