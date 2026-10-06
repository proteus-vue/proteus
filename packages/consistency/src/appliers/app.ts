// packages/consistency/src/appliers/app.ts
// ★★★G-61 B3（2026-10-05）：**App Applier**（L-C · L-A 引擎 → App 内核字段；plan §7.1）
//
// 【它做什么（唯一落地点）】把 CSE 算出的 **StyleIR 字段**映射为 **App 引擎的原生形态**：
//   ① **内核 DTO 键空间**（挂载期全量建树：`NodeDto`，见 `layout-core-rust/src/ffi.rs:71`）
//   ② **ops 键空间**（增量：`layout.*` / `paint.*`——`apply_style_key` 消费，`ops_apply.rs:241`）
//   复用既有通道（INV-CE-03：**零新增运行期解析**——本文件是纯映射，不做 CSS 文本解析）。
//
// 【★零依赖纪律（本包头注的硬约束）】`packages/consistency` **不 import 任何 `@proteus-vue/*`**
//   （它要被浏览器 / QuickJS / Node /（经序列化）Rust 共同消费）⇒ 本文件**不引 contracts**：
//   字段名是开放字符串、长度值是结构同构的 `{kind:'absolute'|'ratio'|'auto'}` 三元组
//   （与 B0 冻结的 `style-ir-values.ts` 同形——此处按结构判定，不按类型 import）。
//
// 【诚实边界（v1，逐条计数不静默）】
//   · `transform`/`transformOrigin`/`boxShadow`：宿主通道独立批次 ⇒ unsupported（不猜不近似）
//   · `zIndex`/`verticalAlign`/`filter`/`backdropFilter`/`float`/`clear`：App 端无能力（注册表登记）
//   · 逐边**宽度**：内核只有统一 `borderWidth` ⇒ unsupported；逐边**颜色**有通道 ⇒ 映射
//   · `fontFamily`：只认**角色**（system/serif/sans-serif/monospace）；任意字族名 ⇒ unsupported
//   · `widthRatio` 家族：只接 `parentWidth`/`parentHeight` 系基准；`viewportWidth`（vw/rpx）有
//     对应 DTO（容差字面不同）⇒ 按 registered 映射（见下），`fontSize` 基准 ⇒ unsupported

/** 映射结果（可序列化） */
export interface AppMappingResult {
  /** 内核 DTO 键空间（挂载期用；键 = camelCase，与 `NodeDto` 的 serde 键一致） */
  dto: Record<string, unknown>
  /** ops 键空间（增量用；键 = `layout.*` / `paint.*`） */
  ops: Record<string, number | string | boolean>
  /** 未映射（诚实计数——每项带原因） */
  unsupported: Array<{ field: string; value: unknown; reason: string }>
}

/** App 端布局字段（→ ops 前缀 `layout.`；与 `NodeDto` 的布局族同集） */
export const APP_LAYOUT_FIELDS: readonly string[] = [
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap',
  'display', 'position', 'top', 'left', 'right', 'bottom', 'overflow',
  // ★★★overflow-x 项（2026-10-06）：逐轴溢出（内核/宿主按轴裁剪子内容）
  'overflowX', 'overflowY',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'gridTemplateAreas', 'gridArea', 'aspectRatio', 'pointerEvents',
  // ★★★grid-auto-flow 项（2026-10-08）：自动放置方向/密度（grid 容器布局，内核 taffy）
  'gridAutoFlow',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
]
/** App 端绘制字段（→ ops 前缀 `paint.`） */
export const APP_PAINT_FIELDS: readonly string[] = [
  'backgroundColor', 'color', 'fontSize', 'fontWeight', 'fontFamily', 'textAlign', 'lineHeight',
  'textOverflow', 'letterSpacing', 'textDecoration', 'visibility', 'borderRadius', 'borderRadiusPct',
  'borderColor', 'borderWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'opacity',
  // ★★★outline 族项（2026-10-08）：轮廓宽/色/线型/偏移（宿主绘制——host-only paint）
  'outlineWidth', 'outlineColor', 'outlineStyle', 'outlineOffset',
  // ★★★背景定位家族（2026-10-07）：背景图层图像盒的 size/position/repeat（字符串，透传宿主几何）
  'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  // ★★★text-shadow 项（2026-10-08）：文本阴影（宿主绘制——host-only paint）
  'textShadow',
]
const LAYOUT_SET = new Set(APP_LAYOUT_FIELDS)
const PAINT_SET = new Set(APP_PAINT_FIELDS)
/** 已知字体角色（App 端编译期字体角色的闭集——批次 36 与宿主 setFontRole） */
const FONT_ROLES = new Set(['system', 'serif', 'sans-serif', 'monospace'])

/** 长度形态（与 B0 `style-ir-values.ts` 的 ResolvedLength 结构同构——按结构判定，不 import） */
type LengthLike =
  | { kind: 'absolute'; dp: number }
  | { kind: 'ratio'; ratio: number; base: string }
  | { kind: 'auto' }

function isLength(v: unknown): v is LengthLike {
  if (v === null || typeof v !== 'object') return false
  const k = (v as { kind?: unknown }).kind
  if (k === 'absolute') return typeof (v as { dp?: unknown }).dp === 'number'
  if (k === 'ratio') return typeof (v as { ratio?: unknown }).ratio === 'number' && typeof (v as { base?: unknown }).base === 'string'
  return k === 'auto'
}
function absoluteOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (isLength(v) && v.kind === 'absolute') return v.dp
  return undefined
}
/** 比例（基准白名单——基准不符 ⇒ undefined，由调用方记 unsupported） */
function ratioOf(v: unknown, allowed: readonly string[]): number | undefined {
  if (!isLength(v) || v.kind !== 'ratio') return undefined
  return allowed.includes(v.base) ? v.ratio : undefined
}

/**
 * **主映射**：IR 字段表 → App 两套形态。
 * @param fields CSE 产出的 `Record<字段名, StyleValue>`（StyleIR.declarations）
 */
export function mapStyleIRToApp(fields: Record<string, unknown>): AppMappingResult {
  const dto: Record<string, unknown> = {}
  const ops: Record<string, number | string | boolean> = {}
  const unsupported: AppMappingResult['unsupported'] = []
  const put = (field: string, dtoVal: unknown, opsVal?: number | string | boolean): void => {
    dto[field] = dtoVal
    if (opsVal !== undefined) {
      const prefix = LAYOUT_SET.has(field) ? 'layout' : PAINT_SET.has(field) ? 'paint' : null
      if (prefix) ops[`${prefix}.${field}`] = opsVal
    }
  }
  const drop = (field: string, value: unknown, reason: string): void => {
    unsupported.push({ field, value, reason })
  }

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue

    /* ── 长度族（ResolvedLength 三态） ── */
    if (isLength(value)) {
      const abs = absoluteOf(value)
      if (abs !== undefined) {
        put(field, abs, abs)
        continue
      }
      if (value.kind === 'auto') {
        if (field === 'marginTop' || field === 'marginRight' || field === 'marginBottom' || field === 'marginLeft') {
          const side = field.slice('margin'.length).toLowerCase()
          dto['marginAuto'] = { ...((dto['marginAuto'] as Record<string, unknown>) ?? {}), [side]: true }
          continue
        }
        if (field === 'width' || field === 'height') {
          // auto = 缺省（内核不写即 auto）⇒ 等价，不记 unsupported
          continue
        }
        drop(field, value, 'auto（本字段无 App 等价形态）')
        continue
      }
      // ratio：按目标字段分流
      const ratioTargets: Record<string, { field: string; bases: readonly string[] }> = {
        width: { field: 'widthRatio', bases: ['parentWidth', 'viewportWidth'] },
        height: { field: 'heightRatio', bases: ['parentHeight', 'viewportHeight'] },
        minWidth: { field: 'minWidthPct', bases: ['parentWidth', 'viewportWidth'] },
        maxWidth: { field: 'maxWidthPct', bases: ['parentWidth', 'viewportWidth'] },
        minHeight: { field: 'minHeightPct', bases: ['parentHeight', 'viewportHeight'] },
        maxHeight: { field: 'maxHeightPct', bases: ['parentHeight', 'viewportHeight'] },
      }
      const target = ratioTargets[field]
      if (target) {
        const r = ratioOf(value, target.bases)
        if (r !== undefined) {
          put(target.field, r, r)
          continue
        }
        drop(field, value, `比例基准 ${(value as { base?: string }).base ?? '?'} 不在支持集（${target.bases.join('/')}）`)
        continue
      }
      drop(field, value, '比例长度（本字段无 App 等价形态）')
      continue
    }

    /* ── margin / padding 结构化（兼容 IR 的合成形态） ── */
    if (field === 'margin' || field === 'padding') {
      const edges = value as Record<string, unknown>
      const out: Record<string, number> = {}
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const a = absoluteOf(edges[side])
        if (a !== undefined) out[side] = a
        else if (edges[side] !== undefined) drop(`${field}.${side}`, edges[side], '非绝对长度')
      }
      dto[field] = out
      continue
    }
    if (field === 'marginAuto') {
      dto['marginAuto'] = value
      continue
    }

    /* ── 数值族 ── */
    if (typeof value === 'number') {
      if (field === 'zIndex') {
        drop(field, value, 'App 无层叠上下文（注册表 forbidden）')
        continue
      }
      if (field === 'opacity' || field === 'flexGrow' || field === 'flexShrink' || field === 'aspectRatio' ||
          field === 'fontWeight' || field === 'fontSize' || field === 'letterSpacing' || field === 'lineHeight' ||
          field === 'borderWidth' || field === 'borderRadius' || field === 'borderRadiusPct') {
        put(field, value, value)
        continue
      }
      // ★★★逐边 border 批（2026-10-05 · 真 bug：此分支原在下方「字符串族」之后 ⇒ 逐边宽度永远到不了
      //   ——数值先被「数值（本字段未登记映射）」拦掉）。三端宿主已支持逐边 ⇒ 直传。
      if (/^border(Top|Right|Bottom|Left)Width$/.test(field)) {
        put(field, value, value)
        continue
      }
      drop(field, value, '数值（本字段未登记映射）')
      continue
    }

    /* ── 字符串族：枚举 / 颜色 / 字体 / grid 串 ── */
    // ★★★边框族收口批（2026-10-05）：逐边线型（solid/dashed/dotted）直传——宿主按线型绘制
    if (/^border(Top|Right|Bottom|Left)Style$/.test(field)) {
      if (typeof value === 'string') { put(field, value, value); continue }
      drop(field, value, '非字符串（线型须为 solid/dashed/dotted）')
      continue
    }
    if (typeof value === 'string') {
      if (field === 'fontFamily') {
        const v = value.toLowerCase()
        if (FONT_ROLES.has(v)) {
          put(field, v, v)
          continue
        }
        drop(field, value, '未知字体角色（只认 system/serif/sans-serif/monospace）')
        continue
      }
      if (field === 'gridTemplateColumns' || field === 'gridTemplateRows') {
        put(field, value, value) // 内核解析轨迹串（既有通道）
        continue
      }
      // ★★★grid-template-areas 项（2026-10-08）：命名区域模板串（内核 taffy 解析）+ 命名区引用串（gridArea）
      if (field === 'gridTemplateAreas' || field === 'gridArea') {
        put(field, value, value)
        continue
      }
      const enumFields = new Set([
        'color', 'backgroundColor', 'display', 'position', 'overflow', 'visibility', 'pointerEvents',
        // ★★★overflow-x 项（2026-10-06）：逐轴溢出（字符串枚举）
        'overflowX', 'overflowY',
        'textAlign', 'textOverflow', 'textDecoration', 'flexDirection', 'flexWrap', 'justifyContent',
        'alignItems', 'alignContent', 'alignSelf', 'boxSizing', 'whiteSpace',
        // ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐（字符串枚举，内核 DTO 通道）
        'justifySelf',
        // ★★★grid-auto-flow 项（2026-10-08）：枚举字符串（内核 DTO 通道）
        'gridAutoFlow',
        // ★★★word-break 项（2026-10-06）：行内断词策略（字符串枚举，透传宿主文本引擎）
        'wordBreak',
        // ★★★背景定位家族（2026-10-07）：字符串形态（宿主解析几何）
        'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
        // ★★★outline 族项（2026-10-08）：线型（枚举字符串）
        'outlineStyle',
        // ★★★text-shadow 项（2026-10-08）：CSE 产出浏览器 computed 规范串——直传（宿主文本投影）
        'textShadow',
        'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
      ])
      if (enumFields.has(field)) {
        put(field, value, value as number | string | boolean)
        continue
      }
      drop(field, value, '字符串（本字段未登记映射）')
      continue
    }

    /* ── 布尔族 ── */
    if (typeof value === 'boolean') {
      if (field === 'pointerEvents' || field === 'visibility') {
        // visibility 在 IR 是字符串枚举；此分支只覆盖 pointerEvents 类
        put(field, value, value)
        continue
      }
      drop(field, value, '布尔（本字段未登记映射）')
      continue
    }

    /* ── 结构化族 ── */
    if (field === 'borderRadiusCorners') {
      dto['borderRadiusCorners'] = value // 宿主可选读（逐角掩码）
      continue
    }
    if (field === 'gridColumn' || field === 'gridRow') {
      dto[field] = value
      ops[`layout.${field}`] = JSON.stringify(value)
      continue
    }
    if (field === 'textShadow') {
      dto['textShadow'] = value // 宿主文本绘制投影（结构化 {dx,dy,blur,color}）
      continue
    }
    /* ── v1 明确不支持（不猜不近似） ── */
    if (field === 'transform' || field === 'transformOrigin' || field === 'boxShadow') {
      drop(field, value, 'v1 未接（宿主变换/阴影通道独立批次）')
      continue
    }
    if (field === 'verticalAlign' || field === 'backdropFilter' || field === 'filter' || field === 'float' || field === 'clear') {
      drop(field, value, 'App 端无对应能力（注册表 forbidden/engine-only）')
      continue
    }
    drop(field, value, '未分类（映射表未覆盖——应补映射或显式登记 unsupported）')
  }
  return { dto, ops, unsupported }
}
