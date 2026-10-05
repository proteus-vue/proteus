// packages/consistency/src/appliers/skyline.ts
// ★★★G-61 B3（2026-10-05）：**Skyline Applier**（L-C · StyleIR → wxss 子集 + 编译期降级；plan §7.1）
//
// 【它做什么】把 StyleIR 字段映射为 **Skyline（微信小程序渲染引擎）可表达的形态**：
//   · 长度：绝对 dp → `rpx`（**750rpx = 视口宽**——微信设计宽语义；本仓 `resolveLength` 同口径）
//     或保留为 `px` 字符串；比例 → `%`（Skyline 支持百分比）
//   · 颜色：`#rrggbb[aa]` 直通（wxss 支持 CSS4 8 位 hex）
//   · 枚举：白名单校验（`SKYLINE_BOUNDARY_RULES`——`display:grid` 之类**编译期拒绝**，不静默近似）
//   · 不支持字段：**降级到能表达的形态**（v1 无配方 ⇒ unsupported 计数；`degradeTo` 配方执行器是 B4）
//
// 【与既有资产的接法（不造第二套）】
//   · 数值/单位换算是**纯算术**（不是 CSS 解析）⇒ 本文件内联（`toRpx`）——与 `resolveLength` 的
//     `rpx` 比例（`v/750`）同语义，不引依赖（零依赖纪律）
//   · 能力白名单**不在此处**：归属 `packages/css-compat` 的 `SKYLINE_BOUNDARY_RULES`（官方文档派生，
//     有独立生成器与门禁）。本文件按**结构化的"该端接受的值域"参数**工作——调用方注入，
//     零依赖纪律下不 import（见 `SkylineApplierOptions.accepts`）。
//
// 【诚实边界（v1）】grid 族（`gridTemplate*` / `gridColumn` / `gridRow`）、`aspectRatio`、
//   `gap` 的部分取值、`boxShadow`、`transform` 的 3D 分量 ⇒ 记 unsupported（B4 的 `degradeTo`
//   配方执行器负责把其中可降级的转成等价形态，例如 grid→嵌套 flex）。

/** Applier 选项（能力来源注入——零依赖纪律；调用方从 `SKYLINE_BOUNDARY_RULES` 派生） */
export interface SkylineApplierOptions {
  /**
   * 属性 → 该端接受的值集合（取自 `SKYLINE_BOUNDARY_RULES`；缺省 ⇒ 不做值域校验，只按字段族映射）。
   * ★注入而非 import：`consistency` 是零依赖包（见包头注）。
   */
  accepts?: Record<string, readonly string[]>
  /** rpx 基准视口宽（750rpx = 该值；缺省 750 ⇒ 1dp ≈ 1rpx——与设计宽同形） */
  rpxViewport?: number
  /** dp→px 的密度（缺省 1——App/小程序的 dp 与 wxss px 在 750 设计宽下同值） */
  density?: number
}

export interface SkylineMappingResult {
  /** wxss 声明（键 = **kebab-case CSS 属性**；值 = CSS 文本，如 `'12rpx'` / `'#ff0000'`） */
  wxss: Record<string, string>
  /** 未映射（诚实计数） */
  unsupported: Array<{ field: string; value: unknown; reason: string }>
}

/** dp → rpx（750 设计宽：`dp / viewport * 750`；缺省 viewport=750 ⇒ 1:1） */
function toRpx(dp: number, viewport: number): number {
  return Math.round(((dp / viewport) * 750 + Number.EPSILON) * 100) / 100
}

/** camelCase → kebab-case（wxss 键） */
function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
}

type LengthLike =
  | { kind: 'absolute'; dp: number }
  | { kind: 'ratio'; ratio: number; base: string }
  | { kind: 'auto' }
function isLength(v: unknown): v is LengthLike {
  if (v === null || typeof v !== 'object') return false
  const k = (v as { kind?: unknown }).kind
  if (k === 'absolute') return typeof (v as { dp?: unknown }).dp === 'number'
  if (k === 'ratio') return typeof (v as { ratio?: unknown }).ratio === 'number'
  return k === 'auto'
}

/** Skyline 侧的长度表达 */
function renderLength(v: LengthLike, viewport: number): string | null {
  if (v.kind === 'absolute') return `${toRpx(v.dp, viewport)}rpx`
  if (v.kind === 'auto') return 'auto'
  // ratio：Skyline 支持百分比（基准 = 父容器对应轴——与 CSS 同语义）
  const pct = Math.round(v.ratio * 10000) / 100
  return `${pct}%`
}

/** **主映射**：IR 字段表 → wxss 声明 */
export function mapStyleIRToSkyline(fields: Record<string, unknown>, opts: SkylineApplierOptions = {}): SkylineMappingResult {
  const viewport = opts.rpxViewport ?? 750
  const wxss: Record<string, string> = {}
  const unsupported: SkylineMappingResult['unsupported'] = []
  const drop = (field: string, value: unknown, reason: string): void => {
    unsupported.push({ field, value, reason })
  }
  /** 值域校验（注入的 accepts；缺省不校验） */
  const acceptCheck = (cssProp: string, value: string): boolean => {
    const acc = opts.accepts?.[cssProp]
    if (!acc || acc.length === 0) return true
    return acc.includes(value)
  }
  const put = (field: string, cssProp: string, value: string): boolean => {
    if (!acceptCheck(cssProp, value)) {
      drop(field, value, `Skyline 该属性接受值域不含此值（${cssProp}）`)
      return false
    }
    wxss[cssProp] = value
    return true
  }

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    // 长度族
    if (isLength(value)) {
      const css = renderLength(value, viewport)
      if (css === null) {
        drop(field, value, '长度形态不可表达')
        continue
      }
      put(field, kebab(field), css)
      continue
    }
    // 数值族（无单位/带单位）
    if (typeof value === 'number') {
      if (field === 'opacity' || field === 'flexGrow' || field === 'flexShrink' || field === 'fontWeight' || field === 'aspectRatio') {
        put(field, kebab(field), String(value))
        continue
      }
      if (field === 'fontSize' || field === 'letterSpacing' || field === 'lineHeight' || field === 'borderWidth' || field === 'borderRadius') {
        // 字号/字距/行高/边框/圆角：px 量 → rpx
        put(field, kebab(field), `${toRpx(value, viewport)}rpx`)
        continue
      }
      if (field === 'borderRadiusPct') {
        put(field, 'border-radius', `${Math.round(value * 10000) / 100}%`)
        continue
      }
      drop(field, value, '数值（本字段未登记映射）')
      continue
    }
    // 字符串族
    if (typeof value === 'string') {
      if (field === 'gridTemplateColumns' || field === 'gridTemplateRows' || field === 'gridColumn' || field === 'gridRow') {
        drop(field, value, 'Skyline 无 Grid（B4 的 degradeTo 配方：grid→嵌套 flex）')
        continue
      }
      if (field === 'borderRadiusCorners') {
        drop(field, value, '逐角掩码（Skyline 侧只表达统一 radius——unified 已映射）')
        continue
      }
      put(field, kebab(field), value)
      continue
    }
    // 布尔 / 结构
    if (typeof value === 'boolean') {
      if (field === 'pointerEvents') {
        put(field, 'pointer-events', value ? 'auto' : 'none')
        continue
      }
      drop(field, value, '布尔（本字段未登记映射）')
      continue
    }
    if (field === 'boxShadow' || field === 'transform' || field === 'transformOrigin') {
      drop(field, value, 'v1 未接（Skyline 支持但形态换算独立批次）')
      continue
    }
    drop(field, value, '未分类（映射表未覆盖——应补映射或显式登记 unsupported）')
  }
  return { wxss, unsupported }
}
