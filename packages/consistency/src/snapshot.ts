// packages/consistency/src/snapshot.ts
// ★★VC3-a/b（《Proteus_一致性校验任务卡清单》）：**统一几何/样式快照格式**——单一规格 + 归一化 + 校验器。
//
// 【硬约束（卡片原文）】🔴 所有端必须产出**同一格式**，**禁止在比对层做格式适配**——
//   格式适配会把差异隐藏在转换里，与"零静默失败"原则冲突。⇒ 本文件是唯一格式来源：
//   各端探针（Web / 小程序 / App 内核）只负责**采集**，归一化与校验都在这里。
//
// 【为什么独立成包（而不是塞进某个端）】三端 + 比对引擎 + 门禁都要 import 同一份定义
//   （铁律：同一语义一处实现）。零依赖（不 import 任何 @proteus-vue/*），
//   保证它能被浏览器 / QuickJS / Node /（经序列化）Rust 侧共同消费。
//
// 【真值基准】Web 端浏览器 = 真值（卡片 VC3-a）。探针实现必须对齐本文件语义。
//
// ── VC3-a 规格落实 ──
//   · 字段：nodeId / path / x / y / w / h / depth / children[]
//   · 坐标系：**视口左上角原点**（各端采集时自行换算；滚动偏移不进快照）
//   · 浮点：**固定 3 位小数**（round3——避免格式化噪声；确定性序列化的前提）
//   · 序列化：JSON **固定键序**（本文件 serializeGeometry 是唯一序列化入口；CBOR 待后续）
//
// ── VC3-b 规格落实（比对解析后的值，不是源码文本）──
//   · 颜色 → RGBA 数值（{r,g,b,a}，a ∈ [0,1]；支持 hex/rgb/rgba/transparent + 内置常用色名表）
//   · 长度 → px 数值（em/rem/vw 等由采集端先解析成 px——getComputedStyle 天然返回 px）
//   · 字体 → 字族（首个）+ 字号 + 字重（**不含度量结果**——度量差异走 A-1 允许差异）
//   · 边框/间距/圆角 → px 数值

/* ══════════════════ VC3-a：几何快照 ══════════════════ */

/** 快照来源端（闭集——新端必须显式登记，防"悄悄多一个端） */
export type SnapshotEnd =
  | 'web' | 'skyline' | 'webview'
  /** 内核通用标识（Rust 内核是跨平台同一份——它不知道自己跑在哪个宿主上，如实标 'app'）；
   *  宿主专属采集（如需区分）用下方三个。 */
  | 'app'
  | 'app-android' | 'app-ios' | 'app-harmony'

export interface GeometryNode {
  /** 该端稳定节点 id（数字或字符串——Web 用 data-proteus-id 或路径哈希；App 用内核 id） */
  nodeId: number | string
  /** 索引路径（"0" / "0.1" / "0.1.2"；根 = ""）——**结构可比**的确定形态 */
  path: string
  /** 视口坐标系（左上角原点）——固定 3 位小数 */
  x: number
  y: number
  w: number
  h: number
  /** 深度（根 = 0） */
  depth: number
  /** 可选语义键（如组件 pid / 静态 id）——**仅供比对层做语义配对**，不保证各端一致 */
  semanticKey?: string
  /** 子节点（顺序 = 绘制/文档顺序） */
  children: GeometryNode[]
}

export interface GeometrySnapshot {
  format: 'proteus-geometry-snapshot'
  version: 1
  end: SnapshotEnd
  viewport: { width: number; height: number }
  root: GeometryNode
  /** 诚实边界声明（采集端填——"锁字体了吗/文本谁量的"直接进快照，不藏在日志里） */
  boundaries?: {
    fontsLocked?: boolean
    textMeasuredBy?: string
    note?: string
  }
}

/* ══════════════════ VC3-b：计算样式快照 ══════════════════ */

/** 归一化颜色（数值——杜绝 `#fff` / `white` / `rgb(255,255,255)` 文本差异） */
export interface Rgba {
  r: number
  g: number
  b: number
  /** 0..1（固定 3 位小数） */
  a: number
}

/** 归一化样式值（闭集；未列入的属性不产出——"清单外的值"由校验器报错，不静默带过） */
export interface NormalizedStyle {
  color?: Rgba
  backgroundColor?: Rgba
  /** px 数值（3 位小数） */
  fontSize?: number
  fontWeight?: number
  /** 字族首个（不含引号） */
  fontFamily?: string
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  borderTopWidth?: number
  borderRightWidth?: number
  borderBottomWidth?: number
  borderLeftWidth?: number
  borderTopColor?: Rgba
  borderRightColor?: Rgba
  borderBottomColor?: Rgba
  borderLeftColor?: Rgba
  // ★★★边框族收口批（2026-10-05）：逐边线型（字符串枚举——'solid'/'dashed'/'dotted'）
  borderTopStyle?: string
  borderRightStyle?: string
  borderBottomStyle?: string
  borderLeftStyle?: string
  borderTopLeftRadius?: number
  borderTopRightRadius?: number
  borderBottomRightRadius?: number
  borderBottomLeftRadius?: number
  opacity?: number
  display?: string
  position?: string
  visibility?: string
  /* ── ★★覆盖扩展（2026-10-02·二批）：**布局族字段**（此前只测到 paint 族 + 少数布局）──
   *   来源：把 28 个编译器字段里"computed style 可实测"的其余字段纳入闭集——
   *   数值项（`auto`/`none` ⇒ 不产出）+ 枚举项 + 主轴尺寸。 */
  width?: number
  height?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  flexDirection?: string
  justifyContent?: string
  alignItems?: string
  alignSelf?: string
  flexGrow?: number
  flexShrink?: number
  gap?: number
  overflow?: string
  // ★★★overflow-x 项（2026-10-06）：逐轴溢出（Web 计算值；visible↔非visible 归一已由探针/CSE 同口径处理）
  overflowX?: string
  overflowY?: string
  /* ★★覆盖收官（2026-10-02·三批）：**偏移定位**（`top`/`left`）——
   *   条件可见：仅当 `position` 非 `static` 时浏览器/宿主才给出数值（static 下是 `auto`）。
   *   ⇒ 采集端只在拿到 px 数值时产出（auto/none ⇒ 不产出——与 width 等"无值不判"同口径）。 */
  top?: number
  left?: number
  right?: number
  bottom?: number
  /* ══ ★★★G-61 B3（2026-10-05）：**L2 全覆盖**（每个 IR semantic 字段都有读数）——新增 20 键 ══
   *   分组（形态相似的处理同族）：
   *   · 布局无关 px 长度：letterSpacing / lineHeight / rowGap / columnGap
   *   · 布局无关枚举：textAlign / textOverflow / textDecoration / pointerEvents / flexWrap / alignContent
   *   · 规范串（canonical string）：
   *     - aspectRatio：浏览器给 `16 / 9`（保持原样，空白归一）
   *     - flexBasis：px 数 或 `40%`（百分比保留文本——C 类，判据②几何承担折算）
   *     - transform：**matrix(a,b,c,d,e,f)** 规范串（各端从"应用后的变换"算出同样的串；round3）
   *     - boxShadow：**颜色 偏移x 偏移y 模糊 扩散** 规范串（浏览器 computed 已有此序；各端同法归一）
   *     - gridTemplateColumns/Rows：**逐轨 px** 或原串（浏览器已 resolved 成 px 列表；空白归一）
   *     - gridColumn/gridRow：**`start / end`** 规范串（auto 侧保留 `auto`）
   */
  letterSpacing?: number
  lineHeight?: number
  rowGap?: number
  columnGap?: number
  textAlign?: string
  whiteSpace?: string
  textOverflow?: string
  textDecoration?: string
  pointerEvents?: string
  flexWrap?: string
  alignContent?: string
  aspectRatio?: string
  flexBasis?: string
  transform?: string
  boxShadow?: string
  gridTemplateColumns?: string
  gridTemplateRows?: string
  gridColumn?: string
  gridRow?: string
}

export interface StyleNode {
  nodeId: number | string
  path: string
  styles: NormalizedStyle
}

export interface StyleSnapshot {
  format: 'proteus-style-snapshot'
  version: 1
  end: SnapshotEnd
  nodes: StyleNode[]
  boundaries?: { fontsLocked?: boolean; note?: string }
}

/* ══════════════════ 归一化原语（VC3-b：唯一实现） ══════════════════ */

/** 固定 3 位小数（**唯一舍入点**——采集端不得自行舍入，防"双重舍入"误差）
 *  ★`-0` 必须归一为 `0`（单测抓出）：JS 的 `Math.round(-0.0004*1000)/1000` 得 `-0`，
 *   而 `JSON.stringify(-0)` 产出 `"0"`、`Object.is(-0, 0)` 为 false ⇒ **破坏字节级确定性**
 *   （同数值两种表示）。⇒ 加 `+ 0` 归一（`-0 + 0 === 0`）。 */
export function round3(v: number): number {
  return Math.round(v * 1000) / 1000 + 0
}

/** 内置常用色名表（CSS 一级/二级常用——不含全表：未识别颜色名**报错不猜**，见 normalizeColor） */
const NAMED_COLORS: Record<string, [number, number, number]> = {
  transparent: [0, 0, 0],
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  lime: [0, 255, 0],
  aqua: [0, 255, 255],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  fuchsia: [255, 0, 255],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  gold: [255, 215, 0],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  crimson: [220, 20, 60],
  salmon: [250, 128, 114],
  tomato: [255, 99, 71],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  beige: [245, 245, 220],
  ivory: [255, 255, 240],
  snow: [255, 250, 250],
  azure: [240, 255, 255],
  mintcream: [245, 255, 250],
  whitesmoke: [245, 245, 245],
  gainsboro: [220, 220, 220],
  darkgray: [169, 169, 169],
  lightgray: [211, 211, 211],
  dimgray: [105, 105, 105],
  slategray: [112, 128, 144],
  steelblue: [70, 130, 180],
  royalblue: [65, 105, 225],
  dodgerblue: [30, 144, 255],
  skyblue: [135, 206, 235],
  lightblue: [173, 216, 230],
  midnightblue: [25, 25, 112],
  darkblue: [0, 0, 139],
  darkred: [139, 0, 0],
  darkgreen: [0, 100, 0],
  darkorange: [255, 140, 0],
  goldenrod: [218, 165, 32],
  chocolate: [210, 105, 30],
  sienna: [160, 82, 45],
  peru: [205, 133, 63],
  tan: [210, 180, 140],
  wheat: [245, 222, 179],
  coral: [255, 127, 80],
  orchid: [218, 112, 214],
  plum: [221, 160, 221],
  thistle: [216, 191, 216],
  hotpink: [255, 105, 180],
  deeppink: [255, 20, 147],
  firebrick: [178, 34, 34],
  forestgreen: [34, 139, 34],
  seagreen: [46, 139, 87],
  mediumseagreen: [60, 179, 113],
  springgreen: [0, 255, 127],
  mediumspringgreen: [0, 250, 154],
  turquoise: [64, 224, 208],
  lightseagreen: [32, 178, 170],
  cadetblue: [95, 158, 160],
  powderblue: [176, 224, 230],
  aliceblue: [240, 248, 255],
  ghostwhite: [248, 248, 255],
  seashell: [255, 245, 238],
  oldlace: [253, 245, 230],
  linen: [250, 240, 230],
  antiquewhite: [250, 235, 215],
  papayawhip: [255, 239, 213],
}

/**
 * 颜色归一化：`#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` / 常用色名 / `transparent`
 * → `Rgba`。**未识别形态抛错**（"零静默失败"——猜颜色会把差异藏进转换里，正是卡片禁止的）。
 */
export function normalizeColor(input: string): Rgba {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)
  if (hex) {
    const h = hex[1]!
    const expand = (x: string): number => parseInt(x + x, 16)
    if (h.length === 3) return { r: expand(h[0]!), g: expand(h[1]!), b: expand(h[2]!), a: 1 }
    if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
    if (h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: round3(parseInt(h.slice(6, 8), 16) / 255) }
    throw new Error(`normalizeColor: 不支持 hex 长度 ${h.length}（${input}）`)
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s)
  if (fn) {
    const parts = fn[1]!.split(/[,/\s]+/).filter(Boolean)
    const num = (x: string): number => (x.endsWith('%') ? round3((parseFloat(x) / 100) * 255) : parseFloat(x))
    const alpha = (x: string): number => (x.endsWith('%') ? round3(parseFloat(x) / 100) : round3(parseFloat(x)))
    if (parts.length < 3) throw new Error(`normalizeColor: rgb 分量不足（${input}）`)
    return { r: num(parts[0]!), g: num(parts[1]!), b: num(parts[2]!), a: parts[3] !== undefined ? alpha(parts[3]!) : 1 }
  }
  const named = NAMED_COLORS[s]
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 }
  throw new Error(`normalizeColor: 未识别颜色「${input}」（内置色名表不含它——请用 hex/rgb；不猜以免把差异藏进转换）`)
}

/**
 * 长度归一化：`'16px'` / `'16'` → 16；`'auto'` / `'none'` / `''` → null（**语义为非数值**）。
 * ★em/rem/vw 等**不在此处换算**（需上下文）——采集端必须先用平台 API 解析成 px
 * （getComputedStyle 天然返回 px；内核天然是 px）。遇到带单位后缀的非常见形态**抛错**。
 */
export function normalizeLength(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (s === '' || s === 'auto' || s === 'none' || s === 'normal') return null
  const m = /^(-?[\d.]+)px$/.exec(s)
  if (m) return round3(parseFloat(m[1]!))
  if (/^-?[\d.]+$/.test(s)) return round3(parseFloat(s))
  throw new Error(`normalizeLength: 「${input}」不是 px 数值（em/rem/% 等请由采集端先解析——不在此处换算）`)
}

/** 字重归一：`'bold'` → 700；数值原样；`'normal'` → 400（与适配器 `normalizeFontWeight` 同口径） */
export function normalizeFontWeight(input: string | number): number {
  if (typeof input === 'number') return input
  const s = input.trim().toLowerCase()
  if (s === 'normal') return 400
  if (s === 'bold') return 700
  if (s === 'bolder') return 700
  if (s === 'lighter') return 300
  const n = Number(s)
  if (Number.isFinite(n)) return n
  throw new Error(`normalizeFontWeight: 未识别字重「${input}」`)
}

/** 字族归一：取首个族名并去引号（`'system-ui, -apple-system, sans-serif'` → `'system-ui'`） */
export function normalizeFontFamily(input: string): string {
  const first = input.split(',')[0]!.trim()
  return first.replace(/^["']|["']$/g, '')
}

/* ══════════════════ schema 校验器（卡片验收：提供 schema 校验器） ══════════════════ */

export interface ValidationIssue {
  /** 机器可判的问题码（判据/门禁按它分类） */
  code:
    | 'missing-field'
    | 'wrong-type'
    | 'bad-precision'
    | 'depth-mismatch'
    | 'path-mismatch'
    | 'children-not-array'
    | 'unknown-style-key'
    | 'non-rounded-value'
  where: string
  detail: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
  /** 节点数（诊断——防"零节点 = 空绿"） */
  nodeCount: number
}

const PRECISION_RE = /^-?\d+(\.\d{1,3})?$/

function isRounded3(v: unknown): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false
  return PRECISION_RE.test(String(v))
}

/** 校验几何快照（卡片验收：各端产出可被同一解析器读取——本函数即"同一解析器"的守门人） */
export function validateGeometrySnapshot(snap: unknown): ValidationResult {
  const issues: ValidationIssue[] = []
  let nodeCount = 0
  const push = (code: ValidationIssue['code'], where: string, detail: string): void => {
    issues.push({ code, where, detail })
  }
  if (!snap || typeof snap !== 'object') return { ok: false, issues: [{ code: 'wrong-type', where: '$', detail: '不是对象' }], nodeCount: 0 }
  const s = snap as Partial<GeometrySnapshot>
  if (s.format !== 'proteus-geometry-snapshot') push('wrong-type', '$.format', `应为 'proteus-geometry-snapshot'，实际 ${String(s.format)}`)
  if (s.version !== 1) push('wrong-type', '$.version', `应为 1，实际 ${String(s.version)}`)
  if (!s.viewport || typeof s.viewport.width !== 'number' || typeof s.viewport.height !== 'number') {
    push('missing-field', '$.viewport', 'viewpoint {width,height} 必填')
  }
  const walk = (n: unknown, expectPath: string, expectDepth: number, where: string): void => {
    if (!n || typeof n !== 'object') {
      push('wrong-type', where, '节点不是对象')
      return
    }
    const node = n as Partial<GeometryNode>
    nodeCount++
    if (node.nodeId === undefined || node.nodeId === null) push('missing-field', `${where}.nodeId`, 'nodeId 必填')
    if (node.path !== expectPath) push('path-mismatch', `${where}.path`, `path 应为「${expectPath}」，实际「${String(node.path)}」`)
    if (node.depth !== expectDepth) push('depth-mismatch', `${where}.depth`, `depth 应为 ${expectDepth}，实际 ${String(node.depth)}`)
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      const v = node[k]
      if (typeof v !== 'number') push('wrong-type', `${where}.${k}`, `${k} 必填且为 number`)
      else if (!isRounded3(v)) push('bad-precision', `${where}.${k}`, `${k}=${v} 超出 3 位小数（round3 后入快照）`)
    }
    if (node.children === undefined || !Array.isArray(node.children)) {
      push('children-not-array', `${where}.children`, 'children 必填且为数组')
      return
    }
    node.children.forEach((c, i) => {
      const childPath = expectPath === '' ? String(i) : `${expectPath}.${i}`
      walk(c, childPath, expectDepth + 1, `${where}.children[${i}]`)
    })
  }
  if (s.root === undefined) push('missing-field', '$.root', 'root 必填')
  else walk(s.root, '', 0, '$.root')
  if (nodeCount === 0) push('missing-field', '$.root', '快照没有任何节点（空快照不是有效快照）')
  return { ok: issues.length === 0, issues, nodeCount }
}

const STYLE_KEYS = new Set([
  'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  // ★★★边框族收口批（2026-10-05）：逐边线型（与接口/覆盖表同批——闭集纪律）
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
  'opacity', 'display', 'position', 'visibility',
  // ★★覆盖扩展（2026-10-02·二批）：布局族字段（与接口同步——闭集纪律：要么登记要么别产出）
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'flexDirection', 'justifyContent', 'alignItems', 'alignSelf',
  'flexGrow', 'flexShrink', 'gap', 'overflow',
  // ★★★overflow-x 项（2026-10-06）：逐轴溢出（与接口/覆盖表同批——闭集纪律）
  'overflowX', 'overflowY',
  'top', 'left',   // ★覆盖收官：偏移定位（条件可见——见接口注释）
  // ★★★G-61 B3：L2 全覆盖新增键（与接口同批——闭集纪律：要么登记要么别产出）
  'right', 'bottom',
  'letterSpacing', 'lineHeight', 'rowGap', 'columnGap',
  'textAlign', 'textOverflow', 'textDecoration', 'pointerEvents', 'flexWrap', 'alignContent',
  // ★★补齐（2026-10-05 · check:style-coverage 抓出的上一轮债务）：whiteSpace 进 semantic 后缺闭集登记
  'whiteSpace',
  'aspectRatio', 'flexBasis', 'transform', 'boxShadow',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow',
])

/** 校验样式快照（VC3-b：归一化规则完整且无歧义——未登记的样式键**报错**，不静默丢弃） */
export function validateStyleSnapshot(snap: unknown): ValidationResult {
  const issues: ValidationIssue[] = []
  const push = (code: ValidationIssue['code'], where: string, detail: string): void => {
    issues.push({ code, where, detail })
  }
  if (!snap || typeof snap !== 'object') return { ok: false, issues: [{ code: 'wrong-type', where: '$', detail: '不是对象' }], nodeCount: 0 }
  const s = snap as Partial<StyleSnapshot>
  if (s.format !== 'proteus-style-snapshot') push('wrong-type', '$.format', `应为 'proteus-style-snapshot'，实际 ${String(s.format)}`)
  if (s.version !== 1) push('wrong-type', '$.version', `应为 1，实际 ${String(s.version)}`)
  if (!Array.isArray(s.nodes)) {
    push('wrong-type', '$.nodes', 'nodes 必填且为数组')
    return { ok: false, issues, nodeCount: 0 }
  }
  s.nodes.forEach((n, i) => {
    const where = `$.nodes[${i}]`
    if (!n || typeof n !== 'object') {
      push('wrong-type', where, '节点不是对象')
      return
    }
    if (n.nodeId === undefined || n.nodeId === null) push('missing-field', `${where}.nodeId`, 'nodeId 必填')
    if (typeof n.path !== 'string') push('missing-field', `${where}.path`, 'path 必填（字符串）')
    if (!n.styles || typeof n.styles !== 'object') {
      push('missing-field', `${where}.styles`, 'styles 必填')
      return
    }
    for (const [k, v] of Object.entries(n.styles)) {
      if (!STYLE_KEYS.has(k)) {
        push('unknown-style-key', `${where}.styles.${k}`, `未登记的样式键「${k}」——归一化闭集外（要么登记，要么别产出）`)
        continue
      }
      if (v === undefined) continue
      if (k === 'color' || k === 'backgroundColor' || k.startsWith('border') && k.endsWith('Color')) {
        const c = v as Partial<Rgba>
        if (typeof c?.r !== 'number' || typeof c?.g !== 'number' || typeof c?.b !== 'number' || typeof c?.a !== 'number') {
          push('wrong-type', `${where}.styles.${k}`, '颜色必须是 {r,g,b,a} 数值')
        } else if (![c.r, c.g, c.b, c.a].every(isRounded3)) {
          push('non-rounded-value', `${where}.styles.${k}`, '颜色分量必须 round3 后入快照')
        }
      } else if (
        // ★字符串族（枚举项）——★必须与 STYLE_KEYS 的字符串键同步（首版漏扩 ⇒ 25 条误报：
        //   校验器把新枚举键当数值项要求。这正是"两处必须同源"的教训——本仓纪律：闭集与校验同改。）
        k === 'display' || k === 'position' || k === 'visibility' || k === 'fontFamily'
        || k === 'flexDirection' || k === 'justifyContent' || k === 'alignItems' || k === 'alignSelf' || k === 'overflow'
        || k === 'overflowX' || k === 'overflowY'   // ★★★overflow-x 项（2026-10-06）
        // ★★★G-61 B3：新增字符串族（与接口/STYLE_KEYS 同步——三处同改）
        || k === 'textAlign' || k === 'textOverflow' || k === 'textDecoration' || k === 'pointerEvents'
        || k === 'whiteSpace'   // ★★补齐（同 ②）
        || k === 'borderTopStyle' || k === 'borderRightStyle' || k === 'borderBottomStyle' || k === 'borderLeftStyle'   // ★★★边框族收口批
        || k === 'flexWrap' || k === 'alignContent'
        || k === 'aspectRatio' || k === 'flexBasis' || k === 'transform' || k === 'boxShadow'
        || k === 'gridTemplateColumns' || k === 'gridTemplateRows' || k === 'gridColumn' || k === 'gridRow'
      ) {
        if (typeof v !== 'string') push('wrong-type', `${where}.styles.${k}`, `${k} 应为字符串`)
      } else if (typeof v === 'number') {
        if (!isRounded3(v)) push('non-rounded-value', `${where}.styles.${k}`, `${k}=${v} 超出 3 位小数`)
      } else {
        push('wrong-type', `${where}.styles.${k}`, `${k} 应为 number`)
      }
    }
  })
  return { ok: issues.length === 0, issues, nodeCount: s.nodes.length }
}

/* ══════════════════ 确定性序列化（VC3-a：JSON 固定键序） ══════════════════ */

/** 几何节点 → 固定键序对象（键序：nodeId,path,x,y,w,h,depth,semanticKey?,children） */
function geoToOrdered(n: GeometryNode): Record<string, unknown> {
  const o: Record<string, unknown> = {
    nodeId: n.nodeId,
    path: n.path,
    x: n.x, y: n.y, w: n.w, h: n.h,
    depth: n.depth,
  }
  if (n.semanticKey !== undefined) o.semanticKey = n.semanticKey
  o.children = n.children.map(geoToOrdered)
  return o
}

/** 确定性序列化（唯一入口——快照落盘的字节级确定性：同数据 ⇒ 同字节） */
export function serializeGeometry(snap: GeometrySnapshot): string {
  return JSON.stringify(
    {
      format: snap.format,
      version: snap.version,
      end: snap.end,
      viewport: { width: snap.viewport.width, height: snap.viewport.height },
      ...(snap.boundaries ? { boundaries: snap.boundaries } : {}),
      root: geoToOrdered(snap.root),
    },
    null,
    0,
  )
}
