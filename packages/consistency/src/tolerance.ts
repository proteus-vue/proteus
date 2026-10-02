// packages/consistency/src/tolerance.ts
// ★★VC5-a（一致性校验任务卡 · ⭐关键）：**分级容差配置规格**——按属性类分级，禁止全局阈值。
//
// 【🔴 核心约束（卡片原文）】禁止全局差异阈值：一个 50×20 的按钮变色只占全高清页面的
//   0.001%，在 0.01% 全局阈值下**必然漏报**——那正是传统视觉回归方案漏报的根源。
//   ⇒ 本文件**没有**任何一种"全页差异率 ≤ X% 即通过"的判定：每个校验项**单独判定**，
//     **单项失败即整体失败**（见 compare.ts 的 `ok` 计算）。
//
// 【每类容差必须带依据（卡片硬性要求：不得凭直觉设值）】每个类别的 `rationale` 是必填字段，
//   `validateToleranceConfig` 会拒绝没有依据的配置。
//
// 【★一处规范冲突的裁决（必须写明，不然实现会被"两头堵"）】
//   卡面表格（与标准 §8.2 同源）写「颜色类 极严格（±1/255）」；而标准 §7.2 的变异算子表
//   「颜色偏移 #FF0000 → #FE0000」与 §7.4「按钮变色必须被捕获」、§14#3「捕获不了就不比截图强」
//   要求 **1/255 的偏移必须判失败**。两者互斥（±1 容差下 1/255 偏移恰好不越界）。
//   ⇒ 核查来源后裁决：§8.2 的表格处在「**像素比对**：非门禁的观察模式」一节（L4 视觉噪声），
//     而 §7.2/§7.4/§14 是**数值比对**（L3）的硬性验收。
//   ⇒ 本实现取**更严的 exact（channelDelta: 0）**：计算样式颜色是确定性整数（无合成/无抗锯齿），
//     任何通道差都是真实缺陷。像素级的 ±1/255 若用于 L4，属 VC7 的独立定义（本配置不含）。
//   ⇒ 这个裁决有机器判据兜底：`tests/consistency-compare.test.ts` 的"按钮变色"用例是**必过项**。

/** 结构类（位置/尺寸）：容差 = max(absPx, relPct% × 参考值) */
export interface StructureTolerance {
  absPx: number
  relPct: number
  rationale: string
}

/** 颜色类：逐通道（含 alpha 折算 0..255）允许的差值 */
export interface ColorTolerance {
  channelDelta: number
  rationale: string
}

/** 字体属性（字族/字号/字重）：严格相等（仅留浮点表示误差） */
export interface FontTolerance {
  exact: boolean
  /** 数值项的浮点表示误差上限（round3 后的表示粒度） */
  epsilon: number
  rationale: string
}

/** 文本度量结果（文本节点的 w/h）：**唯一允许宽带**的类别 */
export interface TextMetricsTolerance {
  absPx: number
  relPct: number
  /** 宽带值是临时标定（标准 §13 待核实项）——字段存在时，报告里会如实标注 */
  provisional?: boolean
  rationale: string
}

/** 非确定性类别（圆角/阴影/渐变）：不比数值，走 L4 像素观察（VC7） */
export interface NonDeterministicTolerance {
  /** 跳过的键名匹配（子串、大小写不敏感）；命中的样式键不参与数值比对 */
  skipped: string[]
  rationale: string
}

export interface ToleranceClasses {
  structure: StructureTolerance
  color: ColorTolerance
  font: FontTolerance
  textMetrics: TextMetricsTolerance
  nonDeterministic: NonDeterministicTolerance
}

/**
 * 组件级 override（卡片：支持组件级 override，但**不得全局放宽**）：
 *   · 按组件 pid 精确匹配（`semanticKey`）；
 *   · 每条必须带 rationale；
 *   · 放宽幅度受 `caps` 硬上限约束（validateToleranceConfig 强制）；
 *   · pid 不得为 `*` / `global` / `all`（那是变相的全局放宽——校验器会拒绝）。
 */
export interface ToleranceOverride {
  pid: string
  rationale: string
  classes: Partial<Pick<ToleranceClasses, 'structure' | 'textMetrics'>>
}

/** 硬上限（非确定性类别不可放宽；结构/文本的放宽不得超过它） */
export interface ToleranceCaps {
  structure: { absPx: number; relPct: number }
  color: { channelDelta: number }
  textMetrics: { absPx: number; relPct: number }
  font: { epsilon: number }
}

export interface ToleranceConfig {
  version: 1
  classes: ToleranceClasses
  overrides: ToleranceOverride[]
  caps: ToleranceCaps
}

/* ══════════════════ 默认容差（每类带依据——卡片硬性要求） ══════════════════ */

export const DEFAULT_TOLERANCE: ToleranceConfig = {
  version: 1,
  classes: {
    structure: {
      absPx: 1,
      relPct: 0.5,
      rationale:
        '坐标吸附集中在内核（pixel-snap floor(v+0.5)），残留差异只来自浮点路径与各端取整边界；' +
        '1px 覆盖舍入边界、0.5% 让大尺寸元素（>200px）的容差随尺度轻微放宽（避免大元素因浮点尾数误报）。' +
        '依据：卡 VC5-a 表格「结构类 ≤1px 或 ≤0.5% 取大」+ 本仓 I2 纪律（舍入只在 pnode/pixel-snap 与 snap.rs）。',
    },
    color: {
      channelDelta: 0,
      rationale:
        '计算样式颜色是确定性整数（无合成、无抗锯齿），任何通道差都是真实缺陷。' +
        '★规范冲突裁决：卡面「±1/255」源自标准 §8.2 的**像素比对**表（L4 视觉噪声）；' +
        '而 §7.2（#FF0000→#FE0000 必须被捕获）/§7.4/§14#3 要求 1/255 偏移判失败 ⇒ 取更严的 exact。' +
        '依据：tests/consistency-compare.test.ts 的「按钮变色」必过用例。',
    },
    font: {
      exact: true,
      epsilon: 0.0005,
      rationale:
        '字体属性是离散值（字族名、字号档、字重档），无算术路径；不等即缺陷。' +
        'epsilon 仅吸收 round3 序列化的表示粒度（半个千分位）。依据：卡 VC5-a 表格「字体属性 严格相等」。',
    },
    textMetrics: {
      absPx: 2,
      relPct: 2,
      provisional: true,
      rationale:
        '三端文本度量引擎天然不同（StaticLayout / CoreText / 浏览器），是唯一不可消除的结构性差异' +
        '（标准 §2 ③ / 允许差异清单 A-1）。宽带数值为**临时标定**（标准 §13 待核实项 #5）：' +
        '标定前凡超带仍判失败（宁可误报不漏报）；标定后按实测分布收紧并去除 provisional。',
    },
    nonDeterministic: {
      skipped: ['radius', 'shadow', 'gradient'],
      rationale:
        '圆角/阴影/渐变/字形栅格化的差异来自光栅化路径（AA / 离屏渲染 / 色彩空间），**非确定性** ⇒ ' +
        '不比数值，走 L4 像素观察（VC7，非门禁）。依据：卡 VC5-a 表格最后一行 + 标准 §10.1。',
    },
  },
  overrides: [],
  caps: {
    structure: { absPx: 2, relPct: 1 },
    color: { channelDelta: 0 },
    textMetrics: { absPx: 4, relPct: 4 },
    font: { epsilon: 0.0005 },
  },
}

/* ══════════════════ 校验器（卡片验收：容差配置按属性类分级 + 不得全局放宽 + 必有依据） ══════════════════ */

const KNOWN_CLASS_KEYS = new Set(['structure', 'color', 'font', 'textMetrics', 'nonDeterministic'])
/** 被禁的"伪类别名"（任何形式的全局/总体阈值——卡 VC5-a 核心约束） */
const FORBIDDEN_CLASS_KEYS = new Set(['global', 'overall', 'page', 'pagediff', 'diffrate', 'threshold', 'all'])
const FORBIDDEN_PIDS = new Set(['*', 'global', 'all', ''])

/**
 * 校验容差配置：返回错误列表（空 = 合法）。
 * 判据（按卡片逐条落）：
 *   · 每类**必须有 rationale**（不得凭直觉设值）；
 *   · 类别集合闭集（未知键拒绝——`global`/`overall` 之类会被明确点名）；
 *   · 各级数值 ≤ caps（**不得全局放宽**的量化防护）；
 *   · override 必须带 rationale、pid 不得为通配（变相全局放宽）；
 */
export function validateToleranceConfig(config: unknown): string[] {
  const errs: string[] = []
  if (!config || typeof config !== 'object') return ['配置不是对象']
  const c = config as Partial<ToleranceConfig>
  if (c.version !== 1) errs.push(`version 应为 1，实际 ${String(c.version)}`)
  const classes = c.classes as Record<string, unknown> | undefined
  if (!classes || typeof classes !== 'object') {
    errs.push('缺 classes')
    return errs
  }
  for (const k of Object.keys(classes)) {
    if (FORBIDDEN_CLASS_KEYS.has(k.toLowerCase())) {
      errs.push(`禁止的类别名「${k}」——本配置不允许任何"全局/总体阈值"形态（卡 VC5-a 核心约束）`)
    } else if (!KNOWN_CLASS_KEYS.has(k)) {
      errs.push(`未知类别「${k}」（允许：${[...KNOWN_CLASS_KEYS].join(' / ')}）`)
    }
  }
  for (const k of KNOWN_CLASS_KEYS) {
    const cls = classes[k] as { rationale?: unknown } | undefined
    if (!cls || typeof cls !== 'object') {
      errs.push(`缺类别 ${k}`)
      continue
    }
    const r = cls.rationale
    if (typeof r !== 'string' || r.trim().length < 12) {
      errs.push(`类别 ${k} 缺容差依据（rationale 必填且需说明为什么这样设——卡 VC5-a 硬性要求）`)
    }
  }
  const caps = c.caps as ToleranceCaps | undefined
  if (!caps) {
    errs.push('缺 caps（硬上限——"不得全局放宽"的量化防护）')
  } else {
    const st = classes.structure as StructureTolerance | undefined
    const col = classes.color as ColorTolerance | undefined
    const tm = classes.textMetrics as TextMetricsTolerance | undefined
    const ft = classes.font as FontTolerance | undefined
    if (st && (st.absPx > caps.structure.absPx || st.relPct > caps.structure.relPct)) {
      errs.push(`structure 超出 caps（${st.absPx}px/${st.relPct}% > ${caps.structure.absPx}px/${caps.structure.relPct}%）`)
    }
    if (col && col.channelDelta > caps.color.channelDelta) {
      errs.push(`color 超出 caps（${col.channelDelta} > ${caps.color.channelDelta}）——颜色不可放宽`)
    }
    if (tm && (tm.absPx > caps.textMetrics.absPx || tm.relPct > caps.textMetrics.relPct)) {
      errs.push(`textMetrics 超出 caps（${tm.absPx}px/${tm.relPct}% > ${caps.textMetrics.absPx}px/${caps.textMetrics.relPct}%）`)
    }
    if (ft && ft.epsilon > caps.font.epsilon) {
      errs.push(`font.epsilon 超出 caps（${ft.epsilon} > ${caps.font.epsilon}）`)
    }
    const ovs = c.overrides ?? []
    if (!Array.isArray(ovs)) errs.push('overrides 应为数组')
    else {
      for (const [i, o] of ovs.entries()) {
        if (!o || typeof o !== 'object') {
          errs.push(`overrides[${i}] 不是对象`)
          continue
        }
        if (FORBIDDEN_PIDS.has(String(o.pid))) {
          errs.push(`overrides[${i}] 的 pid「${o.pid}」是通配/空——变相的全局放宽，禁止（卡 VC5-a）`)
        }
        if (typeof o.rationale !== 'string' || o.rationale.trim().length < 12) {
          errs.push(`overrides[${i}]（${o.pid}）缺 rationale`)
        }
        const oc = (o.classes ?? {}) as Partial<ToleranceClasses>
        for (const key of Object.keys(oc)) {
          if (key !== 'structure' && key !== 'textMetrics') {
            errs.push(`overrides[${i}] 只允许放宽 structure / textMetrics（color/font/非确定性不可放宽——卡 VC5-a）`)
            continue
          }
          const v = oc[key as 'structure' | 'textMetrics'] as StructureTolerance | TextMetricsTolerance
          const cap = caps[key as 'structure' | 'textMetrics']
          if (v.absPx !== undefined && v.absPx > cap.absPx) errs.push(`overrides[${i}].${key}.absPx ${v.absPx} 超 caps ${cap.absPx}`)
          if (v.relPct !== undefined && v.relPct > cap.relPct) errs.push(`overrides[${i}].${key}.relPct ${v.relPct} 超 caps ${cap.relPct}`)
        }
      }
    }
  }
  return errs
}

/** 解析配置（JSON 覆盖默认；overrides 以 JSON 为准）。不合法时抛错（不静默用默认值） */
export function resolveTolerance(json?: unknown): ToleranceConfig {
  if (json === undefined || json === null) return DEFAULT_TOLERANCE
  const merged = JSON.parse(JSON.stringify(DEFAULT_TOLERANCE)) as ToleranceConfig
  const j = json as Partial<ToleranceConfig>
  if (j.classes) {
    for (const k of Object.keys(j.classes)) {
      ;(merged.classes as unknown as Record<string, unknown>)[k] = (j.classes as unknown as Record<string, unknown>)[k]
    }
  }
  if (j.caps) merged.caps = { ...merged.caps, ...j.caps }
  if (Array.isArray(j.overrides)) merged.overrides = j.overrides
  const errs = validateToleranceConfig(merged)
  if (errs.length > 0) {
    throw new Error('容差配置不合法：' + errs.join('；'))
  }
  return merged
}

/** 取某组件 pid 的生效结构容差（override 优先；无则默认） */
export function structureToleranceFor(config: ToleranceConfig, pid?: string, nodeId?: number | string): StructureTolerance {
  const key = pid ?? (nodeId !== undefined ? String(nodeId) : '')
  const ov = config.overrides.find((o) => o.pid === key && o.classes.structure)
  if (ov?.classes.structure) {
    return { ...config.classes.structure, ...ov.classes.structure, rationale: `${config.classes.structure.rationale} ｜ 组件 ${key} override：${ov.rationale}` }
  }
  return config.classes.structure
}

/** 取某组件 pid 的生效文本度量容差（override 优先；无则默认） */
export function textMetricsToleranceFor(config: ToleranceConfig, pid?: string, nodeId?: number | string): TextMetricsTolerance {
  const key = pid ?? (nodeId !== undefined ? String(nodeId) : '')
  const ov = config.overrides.find((o) => o.pid === key && o.classes.textMetrics)
  if (ov?.classes.textMetrics) {
    return { ...config.classes.textMetrics, ...ov.classes.textMetrics, rationale: `${config.classes.textMetrics.rationale} ｜ 组件 ${key} override：${ov.rationale}` }
  }
  return config.classes.textMetrics
}
