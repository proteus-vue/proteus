// packages/agent/src/guardrails.ts
// ★G-36 B4（proteus-ai-agent-plan 05-guardrails + 07-batches B4）：三层护栏 + 自修复循环（权威 TS 版）
//   对齐 05-guardrails.md：
//   · L1 结构 = Component IR Schema 校验（validateComponentIR——节点类型/属性合法，拒绝未知原语）
//   · L2 风格 = C1 无裸色值（CMP017）/ C5 禁 wx.* 首选（G-36.3）/ 命名 p- 前缀（G-31.1，G-36.2 禁小程序组件）
//   · L3 语义 = 六端渲染 conformance（经 MCP run_conformance——B1 知识面协议化，G-31 B5 门禁同源）
//   · 自修复循环 generateWithRetry：construct → validate → diagnose 分类 → 修复/enrich 重试（上限 3，G-36.6 超限转人工）
//   · 修复器 repairSource：裸色值 → DESIGN_TOKENS 精确匹配替换 var(--p-*)（design-token-fix 修复策略）
import { validateComponentIR } from '@proteus-vue/component-ir'
import type { ComponentIR } from '@proteus-vue/component-ir'
import { DESIGN_TOKENS } from '@proteus-vue/mcp'
import type { ProteusMcpServer } from '@proteus-vue/mcp'
import { AUTO_CODEMOD_TAGS } from '@proteus-vue/compat-miniprogram'

// ============================================================
// 错误分类（05-guardrails §6 diagnose）
// ============================================================

/** 错误类别 → 修复策略（§6 表） */
export type GuardrailCategory = 'schema' | 'token' | 'naming' | 'capability' | 'conformance'

export interface GuardrailError {
  readonly layer: 'L1' | 'L2' | 'L3'
  readonly category: GuardrailCategory
  readonly message: string
  /** 可自动修复标记（token 裸色值精确匹配可替换） */
  readonly repairable?: boolean
}

export interface GuardrailReport {
  readonly ok: boolean
  /** 各层结论（L3 无 ir 时 skip） */
  readonly layers: ReadonlyArray<{ layer: 'L1' | 'L2' | 'L3'; ok: boolean; skipped?: boolean; detail: string }>
  readonly errors: readonly GuardrailError[]
}

// ============================================================
// L2 风格检测（C1/C5/C7 + 命名——源码字符串级，CMP007 同形态）
// ============================================================

/** 裸色值：hex（#fff/#ffffff/#ffffffaa）与 rgb()/rgba() 字面量 */
const BARE_COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g

/** design token 色值反查表（value(小写) → token 路径——构建期从 SSOT 派生） */
const COLOR_VALUE_TO_TOKEN: Record<string, string> = {}
for (const [name, value] of Object.entries(DESIGN_TOKENS.color)) {
  if (typeof value === 'string') COLOR_VALUE_TO_TOKEN[value.toLowerCase()] = `color.${name}`
}

function tokenPathOf(hex: string): string | null {
  return COLOR_VALUE_TO_TOKEN[hex.toLowerCase()] ?? null
}

/** C1：裸色值检测（返回逐项——修复器消费） */
export function detectBareColors(source: string): Array<{ raw: string; tokenPath: string | null }> {
  const hits = source.match(BARE_COLOR_RE) ?? []
  return hits.map((raw) => ({ raw, tokenPath: tokenPathOf(raw) }))
}

/** C5：wx.* 裸调用（G-36.3——兼容层/平台桥文件由调用方豁免） */
export function detectWxUsage(source: string): string[] {
  return [...new Set((source.match(/\bwx\s*\.\s*[A-Za-z_$][\w$]*/g) ?? []).map((s) => s.replace(/\s+/g, '')))]
}

/** G-36.2 命名：小程序 Layer 1 标签（<view 等）残留 */
export function detectMpTags(source: string): string[] {
  return [...new Set(Object.keys(AUTO_CODEMOD_TAGS).filter((t) => new RegExp(`<${t}(?=[\\s>/])`).test(source)))]
}

// ============================================================
// 三层校验
// ============================================================

export interface GuardrailsInput {
  /** 产出源码（L2/L3 输入） */
  readonly source?: string
  /** 产出 IR（L1/L3 输入） */
  readonly ir?: ComponentIR
}

export interface GuardrailsOptions {
  mcp: ProteusMcpServer
  /** vue-dom 的 document 注入（L3 六端 conformance） */
  documentLike?: unknown
}

/** ★G-36 B4：三层护栏校验（任一层失败 → 进入自修复循环） */
export async function validateGuardrails(input: GuardrailsInput, opts: GuardrailsOptions): Promise<GuardrailReport> {
  const errors: GuardrailError[] = []
  const layers: Array<{ layer: 'L1' | 'L2' | 'L3'; ok: boolean; skipped?: boolean; detail: string }> = []

  // —— L1 结构（IR Schema——拒绝未知原语/非法属性）——
  if (input.ir) {
    const diagnostics = validateComponentIR(input.ir)
    layers.push({ layer: 'L1', ok: diagnostics.length === 0, detail: diagnostics.length === 0 ? 'IR Schema 校验通过' : `${diagnostics.length} 项诊断` })
    for (const d of diagnostics) {
      errors.push({ layer: 'L1', category: 'schema', message: `${d.code}: ${d.message}` })
    }
  } else {
    layers.push({ layer: 'L1', ok: true, skipped: true, detail: '无 IR 输入——跳过' })
  }

  // —— L2 风格（C1 裸色值 / C5 wx.* / G-36.2 小程序组件命名）——
  if (input.source !== undefined) {
    let l2ok = true
    // C1 裸色值（CMP017——精确匹配 token 可自动修复）
    for (const hit of detectBareColors(input.source)) {
      l2ok = false
      errors.push({
        layer: 'L2',
        category: 'token',
        message: hit.tokenPath ? `裸色值 ${hit.raw} → 应使用 token ${hit.tokenPath}` : `裸色值 ${hit.raw} 未登记于 design token`,
        repairable: hit.tokenPath !== null,
      })
    }
    // C5 wx.* 首选（G-36.3）
    for (const api of detectWxUsage(input.source)) {
      l2ok = false
      errors.push({ layer: 'L2', category: 'capability', message: `裸调用 ${api}——应改用 use* Hook（G-36.3）` })
    }
    // G-36.2/G-31.1：小程序组件残留
    for (const tag of detectMpTags(input.source)) {
      l2ok = false
      errors.push({ layer: 'L2', category: 'naming', message: `小程序组件 <${tag}> 残留——应替换为 p- 原语（G-36.2）` })
    }
    layers.push({ layer: 'L2', ok: l2ok, detail: l2ok ? '风格校验通过' : '存在风格违规（见 errors）' })
  } else {
    layers.push({ layer: 'L2', ok: true, skipped: true, detail: '无源码输入——跳过' })
  }

  // —— L3 语义（六端渲染 conformance——经 MCP run_conformance，B1 知识面）——
  if (input.ir) {
    const r = await opts.mcp.callTool('run_conformance', { ir: input.ir as unknown })
    const result = r.result as { ok: boolean; results?: Array<{ backend: string; ok: boolean; error?: string }> }
    const bad = (result.results ?? []).filter((x) => !x.ok).map((x) => x.backend)
    layers.push({ layer: 'L3', ok: result.ok === true, detail: result.ok === true ? '六端渲染一致' : `不一致端：${bad.join(',')}` })
    if (result.ok !== true) {
      for (const x of result.results ?? []) {
        if (!x.ok) errors.push({ layer: 'L3', category: 'conformance', message: `引擎 ${x.backend} 渲染异常：${x.error ?? '控件映射不一致'}` })
      }
    }
  } else {
    layers.push({ layer: 'L3', ok: true, skipped: true, detail: '无 IR 输入——跳过' })
  }

  return { ok: errors.length === 0, layers, errors }
}

// ============================================================
// 修复器（design-token-fix 修复策略——裸色值精确匹配 token 替换）
// ============================================================

/** token 路径 → CSS 变量名（color.primary → --p-color-primary） */
function cssVarOf(tokenPath: string): string {
  return `--p-${tokenPath.replace(/\./g, '-')}`
}

/** ★G-36 B4：repairSource——可修复错误自动修正（裸色值精确匹配 → var(--p-*)；不可修复项原样保留） */
export function repairSource(source: string, errors: readonly GuardrailError[]): { code: string; repaired: number } {
  let code = source
  let repaired = 0
  for (const e of errors) {
    if (e.category !== 'token' || !e.repairable) continue
    const m = e.message.match(/裸色值 (\S+) → 应使用 token (\S+)/)
    if (!m) continue
    const [, raw, tokenPath] = m
    if (code.includes(raw)) {
      code = code.split(raw).join(`var(${cssVarOf(tokenPath)})`)
      repaired++
    }
  }
  return { code, repaired }
}

// ============================================================
// 自修复循环（05-guardrails §5——上限 3 次，超限转人工 G-36.6）
// ============================================================

export interface RetryInput {
  readonly intent: string
  /** 重试上限（缺省 3——G-36.6） */
  readonly max?: number
}

export interface ConstructInput {
  readonly intent: string
  readonly source?: string
  readonly ir?: ComponentIR
}

export type Constructor = (input: { intent: string; attempt: number; previousErrors: readonly GuardrailError[] }) => Promise<ConstructInput> | ConstructInput

export interface RetryResult {
  readonly ok: boolean
  readonly status: 'delivered' | 'need-human-review'
  readonly code: string | null
  readonly ir: ComponentIR | null
  readonly attempts: number
  readonly errors: readonly GuardrailError[]
  /** 修复轨迹（每次 attempt 的层结论） */
  readonly trail: ReadonlyArray<{ attempt: number; ok: boolean; failed: readonly string[] }>
}

/** 诊断 → 修正意图（enrichIntent——LLM 版构造器消费修正指令重生成） */
export function enrichIntent(intent: string, errors: readonly GuardrailError[]): string {
  if (errors.length === 0) return intent
  const fixes = errors.map((e) => `[fix:${e.category}] ${e.message}`).join('; ')
  return `${intent}\n[上一轮校验失败，修正要求] ${fixes}`
}

/**
 * ★G-36 B4：自修复循环——construct → 三层校验 → 修复/enrich → 重试。
 * token 类可修复错误在循环内自动 repairSource（design-token-fix 策略）；
 * 上限 3 次（G-36.6）超限 → need-human-review（诚实转人工，不静默放行）。
 */
export async function generateWithRetry(
  input: RetryInput,
  opts: {
    construct: Constructor
    mcp: ProteusMcpServer
    documentLike?: unknown
  },
): Promise<RetryResult> {
  const max = input.max ?? 3
  let intent = input.intent
  let lastErrors: readonly GuardrailError[] = []
  const trail: Array<{ attempt: number; ok: boolean; failed: readonly string[] }> = []

  for (let attempt = 1; attempt <= max; attempt++) {
    const produced = await opts.construct({ intent, attempt, previousErrors: lastErrors })
    let source = produced.source
    const report = await validateGuardrails({ source, ir: produced.ir }, { mcp: opts.mcp, documentLike: opts.documentLike })

    // token 类可修复错误 → 自动修复后复检（design-token-fix 策略内联——修复不计入 attempt 消耗）
    if (!report.ok) {
      const { code, repaired } = repairSource(source ?? '', report.errors)
      if (repaired > 0) {
        source = code
        const recheck = await validateGuardrails({ source, ir: produced.ir }, { mcp: opts.mcp, documentLike: opts.documentLike })
        trail.push({ attempt, ok: recheck.ok, failed: recheck.layers.filter((l) => !l.ok && !l.skipped).map((l) => l.layer) })
        if (recheck.ok) {
          return { ok: true, status: 'delivered', code: source ?? null, ir: produced.ir ?? null, attempts: attempt, errors: [], trail }
        }
        lastErrors = recheck.errors
        intent = enrichIntent(input.intent, lastErrors)
        continue
      }
    }

    trail.push({ attempt, ok: report.ok, failed: report.layers.filter((l) => !l.ok && !l.skipped).map((l) => l.layer) })
    if (report.ok) {
      return { ok: true, status: 'delivered', code: source ?? null, ir: produced.ir ?? null, attempts: attempt, errors: [], trail }
    }
    lastErrors = report.errors
    intent = enrichIntent(input.intent, lastErrors)
  }

  return { ok: false, status: 'need-human-review', code: null, ir: null, attempts: max, errors: lastErrors, trail }
}
