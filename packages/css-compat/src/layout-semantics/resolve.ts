// packages/css-compat/src/layout-semantics/resolve.ts
// ★css-compat G-21 B2 数据层：语义 → 端映射查询（05 §二/§四 + 04 §一）
// 纯函数；未知语义/属性 → undefined（调用方降级）；G-22 Renderer 消费入口
import type { CssPlatform, LayoutSemantic, VisualProperty } from './mappings'
import { LAYOUT_SEMANTICS_MAP, VISUAL_MAP, SEMANTIC_COMPONENTS } from './mappings'

/** 布局语义 → 指定端原生实现（未知语义 → undefined） */
export function resolveLayoutSemantic(semantic: string, platform: CssPlatform): string | undefined {
  const row = LAYOUT_SEMANTICS_MAP[semantic as LayoutSemantic]
  return row ? row[platform] : undefined
}

/** 视觉属性 → 指定端原生属性（未知属性 → undefined） */
export function resolveVisual(prop: string, platform: CssPlatform): string | undefined {
  const row = VISUAL_MAP[prop as VisualProperty]
  return row ? row[platform] : undefined
}

/** 语义组件查询（04 §一）：tag → 规格；非语义组件 → undefined */
export function semanticComponentSpec(tag: string): { tag: string; props: string[]; capability: string } | undefined {
  return SEMANTIC_COMPONENTS.find((c) => c.tag === tag)
}

/** tag 是否为语义组件（p-glass/p-sticky/...） */
export function isSemanticComponent(tag: string): boolean {
  return semanticComponentSpec(tag) !== undefined
}
