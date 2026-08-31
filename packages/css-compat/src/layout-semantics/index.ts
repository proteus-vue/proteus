// packages/css-compat/src/layout-semantics/index.ts
// @proteus-vue/css-compat/layout-semantics —— Style IR → 五端 Renderer 映射数据（css-compat B2 数据层）
// 04 语义组件清单 + 05 布局/视觉映射表 + Skyline 子集矩阵；G-22 App Renderer 消费入口
export {
  CSS_PLATFORMS,
  SEMANTIC_COMPONENTS,
  LAYOUT_SEMANTICS,
  LAYOUT_SEMANTICS_MAP,
  VISUAL_PROPERTIES,
  VISUAL_MAP,
  SKYLINE_CSS_SUPPORT,
  CONVERGENCE_RULE,
} from './mappings'
export type { CssPlatform, SemanticComponentSpec, LayoutSemantic, VisualProperty } from './mappings'
export { resolveLayoutSemantic, resolveVisual, semanticComponentSpec, isSemanticComponent } from './resolve'
