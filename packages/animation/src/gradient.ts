// packages/animation/src/gradient.ts —— ★★**渐变填充**（v1：静态 paint —— 2026-10-01）
//
// 【★边界的两阶段记录（v1 → v2——"条件变了就迁"的实操记录，防后人误判为反复）】
//   · **v1（静态 paint）刻意落在宿主绘制层**（与 `borderRadius` 同层）：本仓的
//     "内核是唯一解析器"纪律（C1/C2）成立于两个前提之一——① 内核**要求值**才能每帧求值；
//     ② 解析复杂到两端各写一份必然分叉。v1 两条都不满足（不参与内核计算；只是结构校验）
//     ⇒ 硬塞内核会让内核背它不算的负担（本仓反模式"假抽象"）。
//   · **v2（色标动画）打破前提 ①**：`gradientMix` 通道要逐帧混合色标 ⇒ 求值进了内核 ⇒
//     色标数学必须**一处实现**（否则两端各写一份 lerp = 第 N 份手写副本的经典事故）
//     ⇒ 按 v1 写好的迁移路径**迁入内核**（`style::GradState` 是唯一 lerp 实现；
//     宿主只翻译"内核算好的"结果）。**声明面不变**（本文件仍是类型与校验的单一事实源）。
//   ★CSS 对照（这是本引擎的**超出**项）：CSS 的渐变**不可过渡**（`background-image`
//     不在可插值属性里——改色标是硬跳变；平滑要 Houdini，而它只有 Chromium 系）。
//
// 【跨语言契约（三层各自实现，本文件是**声明面与校验的单一事实源**）】
//   · TS（本文件）：类型 + 校验器（作者面：写错立刻报错，带修法）；
//   · iOS `selfdraw-scene.swift`：CAGradientLayer（.axial/.radial）；
//   · Android `ProteusHostView.java`：LinearGradient/RadialGradient + Shader。
//   ⇒ 三方共读**同一份 JSON 形态**（字段名见 `GRADIENT_CONTRACT_KEYS`）；
//     机器门禁 `scripts/check-gradient-contract.mjs` 强制两端都引用全部键名
//     （漏一个 = 该端静默不渲染——与 C2 的"臆想形态"同源事故）。
//
// 【形态（v1 子集——刻意小，够用且零歧义）】
// ```
// fillGradient: { kind: 'linear', angle: 90,  stops: [{ offset: 0, color: '#f2ead6' }, …] }
// fillGradient: { kind: 'radial', cx: 0.5, cy: 0.5, r: 0.8, stops: [ … ] }
// ```
//   · 线性：`angle` 按 **CSS 语义**（0° = 向上，90° = 向右）；端点 = 盒中心 ± 半程
//     （单位空间——不采用 CSS 的边角扩展公式；本引擎契约，两端同式）。
//   · 径向：圆心 `(cx, cy)` 与半径 `r` 都是**单位空间**（相对盒宽/高）；
//     iso 线随盒宽高比呈椭圆（`r = 1` 时横向铺满、纵向按高/宽比缩放）——宽扁的
//     "墨晕"正好要这个形态。
//   · 色标：**2..8 个**，`offset ∈ [0,1]` 严格升序；颜色限 **`#RRGGBB` 六位**
//     （★刻意**不接受** 8 位：内核的 `#RRGGBBAA` 是 CSS4 序，而两端宿主既有
//     `parseHex` 的 8 位约定是 `#AARRGGBB` ⇒ 8 位必然分叉。透明度走**独立 `alpha`
//     数值**（0..1）——两端都读同一个数字，零歧义）。
//
// 【与颜色动画的关系（诚实边界）】v1 渐变是静态 paint：**渐变节点不参与颜色动画**
//   （两端约定一致：有渐变 ⇒ 用渐变，颜色动画被忽略）。要给渐变"上色"= v2 的
//   色标动画（迁内核），届时校验收窄为显式错误。

/** 一个色标：位置 + 颜色（+ 透明度） */
export interface GradientStop {
  /** 位置（0..1；同一渐变内**严格升序**） */
  offset: number
  /** 颜色（**`#RRGGBB` 六位**——8 位在本字段被明确拒绝，见文件头） */
  color: string
  /** 透明度（0..1；缺省 1）。★独立数值字段——两端无 8 位十六进制的顺序分歧 */
  alpha?: number
}

/** 线性渐变（`angle` 度，CSS 语义：0 = 向上 / 90 = 向右） */
export interface LinearGradientFill {
  kind: 'linear'
  /** 方向角（度；CSS 语义） */
  angle: number
  stops: GradientStop[]
}

/** 径向渐变（单位空间圆心/半径；iso 线随盒宽高比呈椭圆） */
export interface RadialGradientFill {
  kind: 'radial'
  /** 圆心 x（0..1，相对盒宽；缺省 0.5） */
  cx?: number
  /** 圆心 y（0..1，相对盒高；缺省 0.5） */
  cy?: number
  /** 半径（单位空间，相对盒宽；缺省 1） */
  r?: number
  stops: GradientStop[]
}

export type GradientFill = LinearGradientFill | RadialGradientFill

/**
 * ★★**渐变的两态声明**（v2：可动画）——`{ from: 渐变A, to: 渐变B }`。
 *
 * 【怎么用】树里声明 `fillGradient`（A）与 `fillGradientTo`（B）后，动画写
 * `{ kind: 'gradientMix', from: 0, to: 1 }`——内核逐帧混合两态的**每个色标**
 * （颜色四通道 + 位置标量），宿主只翻译结果（零 lerp 数学）。
 *
 * 【结构约束（违反即明确拒绝）】A 与 B 的 `kind` 相同、色标**个数**相同——
 *   "逐标混合"要求一一对应；本引擎不做"补齐/截断"这类静默猜测。
 */
export interface GradientPair {
  from: GradientFill
  to: GradientFill
}

/** 校验两态结构一致（供声明层/测试用；内核在建树时会做同一套校验并给可定位错误） */
export function validateGradientPair(pair: GradientPair): Array<{ path: string; message: string; hint: string }> {
  const out = [validateGradientFill(pair.from), validateGradientFill(pair.to)].flat()
  if (out.length > 0) return out
  if (pair.from.kind !== pair.to.kind) {
    out.push({
      path: 'fillGradientTo.kind',
      message: `两态类型不同（${pair.from.kind} vs ${pair.to.kind}）`,
      hint: '异型渐变之间没有"逐标混合"的定义——两态必须同 kind',
    })
  }
  if (pair.from.stops.length !== pair.to.stops.length) {
    out.push({
      path: 'fillGradientTo.stops',
      message: `两态色标个数不同（${pair.from.stops.length} vs ${pair.to.stops.length}）`,
      hint: '逐标混合要求一一对应（本引擎不做"补齐/截断"这类静默猜测）',
    })
  }
  return out
}

/**
 * ★跨语言契约的**必需键名**（机器门禁 `check-gradient-contract.mjs` 的唯一事实源）：
 *   两端宿主必须都引用这些键名——漏一个就是"该端读不到该维度"（静默降级）。
 *   ★加字段时**只改这里**（门禁与两端检查一起跟进——与 hook 清单同一纪律）。
 */
export const GRADIENT_CONTRACT_KEYS = [
  'fillGradient',
  'fillGradientTo',
  'kind',
  'linear',
  'radial',
  'angle',
  'stops',
  'offset',
  'color',
  'alpha',
  'cx',
  'cy',
] as const

/**
 * 线性渐变的**端点**（单位空间）——两端宿主按同一式换算（本函数是**契约的钉子**：
 * 测试钉住数值；Swift/Kotlin 各自实现同式，门禁保证键名覆盖）。
 *
 * @returns 起点/终点（单位空间；0° = 从下到上）
 */
export function linearGradientEndpoints(angleDeg: number): { x0: number; y0: number; x1: number; y1: number } {
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  return {
    x0: 0.5 - dx / 2,
    y0: 0.5 - dy / 2,
    x1: 0.5 + dx / 2,
    y1: 0.5 + dy / 2,
  }
}

/** 规范化径向参数（缺省值落定——两端宿主读到的永远是落定后的值） */
export function radialNormalized(g: RadialGradientFill): { cx: number; cy: number; r: number } {
  return { cx: g.cx ?? 0.5, cy: g.cy ?? 0.5, r: g.r ?? 1 }
}

/**
 * ★校验一个渐变声明（作者面：错误**当场报**，消息含修法）。
 * 返回空数组 = 合法；每条含 `path`（如 `stops[2].offset`）便于定位。
 */
export function validateGradientFill(g: unknown): Array<{ path: string; message: string; hint: string }> {
  const out: Array<{ path: string; message: string; hint: string }> = []
  if (g == null || typeof g !== 'object') {
    return [{ path: 'fillGradient', message: '不是对象', hint: "应为 { kind: 'linear' | 'radial', stops: [...] }" }]
  }
  const o = g as Record<string, unknown>
  const kind = o['kind']
  if (kind !== 'linear' && kind !== 'radial') {
    out.push({
      path: 'fillGradient.kind',
      message: `未知类型 ${JSON.stringify(kind)}`,
      hint: "支持 'linear'（angle + stops）与 'radial'（cx/cy/r + stops）",
    })
  }
  if (kind === 'linear') {
    const angle = o['angle']
    if (typeof angle !== 'number' || !Number.isFinite(angle)) {
      out.push({ path: 'fillGradient.angle', message: `angle 非法：${JSON.stringify(angle)}`, hint: '应为有限数（度；0 = 向上，90 = 向右）' })
    }
  }
  if (kind === 'radial') {
    for (const k of ['cx', 'cy', 'r'] as const) {
      const v = o[k]
      if (v === undefined) continue // 缺省由 radialNormalized 落定
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        out.push({ path: `fillGradient.${k}`, message: `${k} 非法：${JSON.stringify(v)}`, hint: '应为有限数（单位空间；cx/cy ∈ 0..1 通常）' })
      }
    }
    const r = o['r']
    if (typeof r === 'number' && Number.isFinite(r) && r <= 0) {
      out.push({ path: 'fillGradient.r', message: `r 必须为正：${r}`, hint: 'r = 0 的径向渐变不可见，请给正数（缺省 1）' })
    }
  }
  const stops = o['stops']
  if (!Array.isArray(stops)) {
    out.push({ path: 'fillGradient.stops', message: 'stops 缺失或不是数组', hint: '至少 2 个色标，如 [{ offset: 0, color: "#f2ead6" }, { offset: 1, color: "#7d8ea6", alpha: 0.2 }]' })
    return out
  }
  if (stops.length < 2 || stops.length > 8) {
    out.push({ path: 'fillGradient.stops', message: `色标数量 ${stops.length} 不在 2..8`, hint: '线性/径向渐变至少 2 个色标；本引擎上限 8 个（超出请拆分节点）' })
  }
  let prev = -Infinity
  stops.forEach((s, i) => {
    const st = s as Record<string, unknown>
    const off = st['offset']
    if (typeof off !== 'number' || !Number.isFinite(off) || off < 0 || off > 1) {
      out.push({ path: `stops[${i}].offset`, message: `offset 非法：${JSON.stringify(off)}`, hint: '应为 0..1 的有限数' })
    } else if (off <= prev) {
      out.push({ path: `stops[${i}].offset`, message: `offset 非升序：${off} 不大于前一个 ${prev}`, hint: '色标必须按 offset 严格升序（同位置写两个会得到硬边——需要硬边请换成相邻的极小间隔）' })
    } else {
      prev = off
    }
    const color = st['color']
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      out.push({
        path: `stops[${i}].color`,
        message: `颜色非法：${JSON.stringify(color)}`,
        hint: '只接受 **#RRGGBB 六位**（8 位在本字段被拒——透明请用独立的 alpha 数值，避免两端十六进制顺序分歧）',
      })
    }
    const alpha = st['alpha']
    if (alpha !== undefined && (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha < 0 || alpha > 1)) {
      out.push({ path: `stops[${i}].alpha`, message: `alpha 非法：${JSON.stringify(alpha)}`, hint: '应为 0..1 的有限数（缺省 1）' })
    }
  })
  return out
}
