// packages/component-ir/src/validate.ts
// ★G-31 B1：C-IR 属性约束校验（纯逻辑可单测——验证先于运行，支柱 ③）
//   - 结构校验：tag 前缀 p- / semantic 枚举合法 / children 递归
//   - GRID_CONFLICT：min-col-width × max-cols > 设计宽 → max-cols 永不达（永远单列）——编译期 warning
//   - CMP006：capabilities 声明的属性缺 degradation 声明（G-31.2）
import { SEMANTIC_ENUM } from './schema'
import type { ComponentIR } from './schema'

export interface CIRDiagnostic {
  code: string
  message: string
  path?: string
}

/** 默认设计稿宽度（grid 冲突校验基准） */
export const DEFAULT_DESIGN_WIDTH = 375

/**
 * 校验单个 C-IR 节点（含 children 递归）：
 * - CIR_INVALID_TAG：tag 非 p- 前缀（G-31.1 语义命名铁律）
 * - CIR_INVALID_SEMANTIC：semantic 非枚举
 * - CMP006：capabilities 属性缺 degradation 声明（G-31.2）
 */
export function validateComponentIR(ir: unknown): CIRDiagnostic[] {
  const diags: CIRDiagnostic[] = []
  if (!ir || typeof ir !== 'object') {
    return [{ code: 'CIR_INVALID', message: 'C-IR 必须为对象' }]
  }
  const node = ir as ComponentIR
  if (typeof node.tag !== 'string' || !/^p-[a-z0-9-]+$/.test(node.tag)) {
    diags.push({ code: 'CIR_INVALID_TAG', message: `tag="${String(node.tag)}" 非法——必须 p- 前缀 + 语义名词（G-31.1）` })
  }
  if (typeof node.semantic !== 'string' || (SEMANTIC_ENUM as readonly string[]).indexOf(node.semantic) < 0) {
    diags.push({ code: 'CIR_INVALID_SEMANTIC', message: `semantic="${String(node.semantic)}" 非法——须为语义枚举（<domain>.<kind>）` })
  }
  if (node.props === null || typeof node.props !== 'object') {
    diags.push({ code: 'CIR_INVALID_PROPS', message: 'props 必须为对象' })
  }
  // ★CMP006：capabilities 引用的属性须声明降级（G-31.2——属性可降级）
  const caps = node.capabilities
  if (Array.isArray(caps) && caps.length) {
    const declared = new Set(Object.keys(node.degradation ?? {}))
    for (const cap of caps) {
      if (typeof cap === 'object' && cap !== null && typeof (cap as { name?: unknown }).name === 'string' && !declared.has((cap as { name: string }).name)) {
        diags.push({ code: 'CMP006', message: `capability "${(cap as { name: string }).name}" 未声明 degradation（supported/fallback/unsupported）——G-31.2` })
      }
    }
  }
  // children 递归
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      diags.push.apply(diags, validateComponentIR(child))
    }
  }
  return diags
}

/**
 * ★grid 属性约束冲突（plan 单测 grid-conflict.spec.ts）：min-col-width × max-cols > 设计宽
 * → max-cols 永不达（永远单列）——编译期 warning（验证先于运行，支柱 ③）
 */
export function validateGridConstraints(props: Record<string, unknown>, designWidth = DEFAULT_DESIGN_WIDTH): CIRDiagnostic[] {
  const minColWidth = props.minColWidth ?? props.minColWidth
  const maxCols = props.maxCols
  if (typeof minColWidth === 'number' && typeof maxCols === 'number' && maxCols > 1) {
    const needed = minColWidth * maxCols
    if (needed > designWidth) {
      return [
        {
          code: 'GRID_CONFLICT',
          message: `min-col-width=${minColWidth} × max-cols=${maxCols} = ${needed} > 设计宽 ${designWidth}——max-cols=${maxCols} 永不达（永远单列），请调小 min-col-width 或 max-cols`,
        },
      ]
    }
  }
  return []
}

/** 校验整棵组件树（根 + grid 约束，children 递归） */
export function validateComponentTree(ir: unknown, designWidth = DEFAULT_DESIGN_WIDTH): CIRDiagnostic[] {
  const diags = validateComponentIR(ir)
  if (ir && typeof ir === 'object') {
    const node = ir as ComponentIR
    if (node.props && typeof node.props === 'object') {
      diags.push.apply(diags, validateGridConstraints(node.props as Record<string, unknown>, designWidth))
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        diags.push.apply(diags, validateComponentTree(child, designWidth))
      }
    }
  }
  return diags
}
