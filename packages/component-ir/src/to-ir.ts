// packages/component-ir/src/to-ir.ts
// ★G-31 B2：模板标签 → C-IR 转换器（源码 → Component IR 的生产端雏形——G-29 Compiler Backend 的前置纯函数）
//   p-* 语义组件 → C-IR（semantic 字段）；非 p- 标签（view/text 等小程序/HTML 标签）→ null（属 Layer 1 兼容层，
//   不产生 Layer 0 C-IR——G-31.1）
import { TAG_SEMANTIC_MAP } from './schema'
import type { ComponentIR } from './schema'

/**
 * 单标签 → C-IR（未映射标签 → null——兼容层标签不产生 Layer 0 C-IR）
 * - p-* 语义组件：TAG_SEMANTIC_MAP 提供 semantic
 * - 未知 p-* 标签：semantic 缺省 'layout.box'（原子容器兜底）？——不，返回 null（未知语义不臆造）
 */
export function toComponentIR(tag: string, props: Record<string, unknown> = {}, children: ComponentIR[] = []): ComponentIR | null {
  if (!tag.startsWith('p-')) return null // view/text/button... 属 Layer 1 兼容层
  const semantic = TAG_SEMANTIC_MAP[tag]
  if (!semantic) return null // 未知 p- 标签：无语义定义 → 不臆造
  return { tag, semantic, props: { ...props }, children }
}

/** 递归转换（子节点非 p- 标签丢弃——兼容层标签在 Layer 0 树中不产生 C-IR 节点） */
export function toComponentTree(tag: string, props: Record<string, unknown> = {}, children: Array<{ tag: string; props: Record<string, unknown>; children?: unknown[] }> = []): ComponentIR | null {
  const irChildren: ComponentIR[] = []
  for (const c of children) {
    const sub = toComponentTree(c.tag, c.props, (c.children as Array<{ tag: string; props: Record<string, unknown>; children?: unknown[] }> | undefined) ?? [])
    if (sub) irChildren.push(sub)
  }
  return toComponentIR(tag, props, irChildren)
}
