// packages/component-ir/src/conformance.ts
// ★G-31 B5：组件渲染 conformance——渲染快照 vs SEMANTIC_BACKEND_MAP 规范参考表（conformance.md §3.1/§3.4）
//   「Backend 消费 semantic 而非 tag 字符串」的机器验证：后端渲染出的控件必须与参考表一致；
//   跨端结构同构（同一 C-IR → 各端 semantic 路径一致）用 extractSemanticTree 比对
//   分层职责：快照产出在 render-backend（renderComponentSnapshot/createControlReader——句柄形状归属）；
//             本文件只做「快照 vs 参考表」纯逻辑对照（零运行时依赖——render-backend 仅类型引用）
import type { BackendId } from '@proteus-vue/contracts'
import { SEMANTIC_BACKEND_MAP } from './map'
import { SEMANTIC_ENUM } from './schema'
import { implementedPrimitives } from './primitives'

/** ★#425 破 type-only 环：渲染快照的本地鸭子视图（只读 component-ir 所需字段——结构与 render-backend
 *   RenderNodeSnapshot 对齐，结构兼容即可传参；component-ir 零 import render-backend，build 序单向可排） */
export interface RenderNodeSnapshotView {
  type: string
  semantic: string
  control: string
  children: RenderNodeSnapshotView[]
  props?: Record<string, unknown>
  text?: string
}

/** 控件映射偏差：error=与参考表不符（门禁阻断）；unverified=参考表未声明该后端/语义，或 Layer 1 兼容层标签（不强制） */
export interface ControlMismatch {
  path: string
  semantic: string
  expected: string | null
  actual: string
  reason: 'mismatch' | 'no-row' | 'no-column' | 'compat'
}

export interface ComponentConformanceResult {
  ok: boolean
  backendId: string
  /** 校验节点数 */
  nodes: number
  /** 门禁错误：语义节点的控件映射与参考表不一致 */
  errors: ControlMismatch[]
  /** 不强制项：参考表缺行/缺列、Layer 1 兼容层标签 */
  unverified: ControlMismatch[]
}

/** 语义树（跨端结构比对载体：同一 C-IR → 各端 semantic 路径必须同构） */
export interface SemanticTree {
  semantic: string
  children: SemanticTree[]
}

/** 提取语义树（忽略控件/属性——只比结构形状） */
export function extractSemanticTree(snap: RenderNodeSnapshotView): SemanticTree {
  return { semantic: snap.semantic, children: snap.children.map(extractSemanticTree) }
}

/**
 * 渲染快照 vs 规范参考表（SEMANTIC_BACKEND_MAP）
 * - Layer 0 语义节点（semantic ≠ type）：参考表命中 → 控件必须一致（error）；参考表缺该语义/后端列 → unverified（不臆造门禁）
 * - Layer 1 兼容层节点（无 semantic，semantic === type）：各后端自定义 compat 映射 → 不设门禁（unverified）
 */
export function checkComponentSnapshot(backendId: string, snapshot: RenderNodeSnapshotView): ComponentConformanceResult {
  const errors: ControlMismatch[] = []
  const unverified: ControlMismatch[] = []
  let nodes = 0

  function visit(snap: RenderNodeSnapshotView, path: string): void {
    nodes++
    if (snap.semantic !== snap.type) {
      // —— Layer 0 语义节点：必须与参考表一致 ——
      const row = SEMANTIC_BACKEND_MAP[snap.semantic]
      if (!row) {
        unverified.push({ path, semantic: snap.semantic, expected: null, actual: snap.control, reason: 'no-row' })
      } else {
        const mapped = row[backendId as BackendId]
        if (mapped === undefined) {
          unverified.push({ path, semantic: snap.semantic, expected: null, actual: snap.control, reason: 'no-column' })
        } else if (snap.control !== mapped) {
          errors.push({ path, semantic: snap.semantic, expected: mapped, actual: snap.control, reason: 'mismatch' })
        }
      }
    } else {
      // —— Layer 1 兼容层标签（view/text/...）：compat 映射由各后端自定义，不设渲染门禁 ——
      unverified.push({ path, semantic: snap.semantic, expected: null, actual: snap.control, reason: 'compat' })
    }
    snap.children.forEach((c, i) => visit(c, path ? `${path}/${i}` : String(i)))
  }

  visit(snapshot, '')
  return { ok: errors.length === 0, backendId, nodes, errors, unverified }
}

/** 参考表覆盖缺口（G-31.4：新组件进 L1 须 ≥3 端映射；不足 → 降级 L2，禁入 core）
 *  ★G-32 B1：仅对 catalog 中 status='implemented' 的原语设门禁——planned（L2 生态/待落地）不阻断
 */
export interface CoverageGap {
  semantic: string
  backends: string[]
}

export function checkSemanticCoverage(minBackends = 3): CoverageGap[] {
  const gaps: CoverageGap[] = []
  for (const p of implementedPrimitives()) {
    const row = SEMANTIC_BACKEND_MAP[p.semantic]
    const backends = row ? Object.keys(row) : []
    if (backends.length < minBackends) gaps.push({ semantic: p.semantic, backends })
  }
  return gaps
}
