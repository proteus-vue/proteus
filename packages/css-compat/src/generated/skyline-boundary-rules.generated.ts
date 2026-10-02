// GENERATED - do not edit（scripts/gen-end-support-matrix.mjs 从官方文档派生）
// 来源：《Skyline WXSS 样式支持与差异》属性表的**纯枚举 formats**（含 <占位符> 的不判——宁漏勿误）

export interface SkylineBoundaryRule {
  /** 规则 id（CSS-PB-<css 属性名>） */
  id: string
  /** CSS 属性名（小写） */
  prop: string
  /** 该端（Skyline）接受的取值白名单（官方 formats 枚举） */
  accept: string[]
  /** 替代建议（官方 remark 派生） */
  suggestion: string
  /** 事实来源（审计用） */
  source: string
}

export const SKYLINE_BOUNDARY_RULES: SkylineBoundaryRule[] = [
  {
    "id": "CSS-PB-display",
    "prop": "display",
    "accept": [
      "none",
      "flex",
      "block"
    ],
    "suggestion": "改用该端接受的取值：none / flex / block",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-position",
    "prop": "position",
    "accept": [
      "relative",
      "absolute",
      "fixed"
    ],
    "suggestion": "top / left / bottom / right 默认值 auto 解析，z-index 只作用在兄弟节点（官方备注）——改用 relative / absolute / fixed 或被支持的语义组件",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-overflow",
    "prop": "overflow",
    "accept": [
      "hidden",
      "visible"
    ],
    "suggestion": "，只能通过 scroll-view 实现（官方备注）——改用 hidden / visible 或被支持的语义组件",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-pointer-events",
    "prop": "pointer-events",
    "accept": [
      "auto",
      "none"
    ],
    "suggestion": "改用该端接受的取值：auto / none",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-box-sizing",
    "prop": "box-sizing",
    "accept": [
      "border-box",
      "content-box"
    ],
    "suggestion": "改用该端接受的取值：border-box / content-box",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-visibility",
    "prop": "visibility",
    "accept": [
      "visible",
      "hidden"
    ],
    "suggestion": "改用该端接受的取值：visible / hidden",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-align-items",
    "prop": "align-items",
    "accept": [
      "stretch",
      "center",
      "flex-start",
      "flex-end",
      "baseline"
    ],
    "suggestion": "改用该端接受的取值：stretch / center / flex-start / flex-end",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-align-self",
    "prop": "align-self",
    "accept": [
      "auto",
      "stretch",
      "center",
      "flex-start",
      "flex-end",
      "baseline"
    ],
    "suggestion": "改用该端接受的取值：auto / stretch / center / flex-start",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-align-content",
    "prop": "align-content",
    "accept": [
      "stretch",
      "center",
      "flex-start",
      "flex-end",
      "space-between",
      "space-around"
    ],
    "suggestion": "改用该端接受的取值：stretch / center / flex-start / flex-end",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-justify-content",
    "prop": "justify-content",
    "accept": [
      "center",
      "flex-start",
      "flex-end",
      "space-between",
      "space-around",
      "space-evenly"
    ],
    "suggestion": "改用该端接受的取值：center / flex-start / flex-end / space-between",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-flex-direction",
    "prop": "flex-direction",
    "accept": [
      "row",
      "row-reverse",
      "column",
      "column-reverse"
    ],
    "suggestion": "改用该端接受的取值：row / row-reverse / column / column-reverse",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-flex-wrap",
    "prop": "flex-wrap",
    "accept": [
      "nowrap",
      "wrap",
      "wrap-reverse"
    ],
    "suggestion": "改用该端接受的取值：nowrap / wrap / wrap-reverse",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-background-repeat",
    "prop": "background-repeat",
    "accept": [
      "repeat-x",
      "repeat-y",
      "repeat",
      "no-repeat"
    ],
    "suggestion": "改用该端接受的取值：repeat-x / repeat-y / repeat / no-repeat",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-transition-property",
    "prop": "transition-property",
    "accept": [
      "none",
      "all",
      "transform",
      "opacity 等"
    ],
    "suggestion": "改用该端接受的取值：none / all / transform / opacity 等",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-text-align",
    "prop": "text-align",
    "accept": [
      "left",
      "center",
      "right",
      "justify",
      "start",
      "end"
    ],
    "suggestion": "改用该端接受的取值：left / center / right / justify",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-white-space",
    "prop": "white-space",
    "accept": [
      "normal",
      "nowrap",
      "normal"
    ],
    "suggestion": "改用该端接受的取值：normal / nowrap / normal",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-text-overflow",
    "prop": "text-overflow",
    "accept": [
      "clip",
      "ellipsis"
    ],
    "suggestion": "改用该端接受的取值：clip / ellipsis",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-word-break",
    "prop": "word-break",
    "accept": [
      "normal",
      "break-all"
    ],
    "suggestion": "改用该端接受的取值：normal / break-all",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-font-style",
    "prop": "font-style",
    "accept": [
      "normal",
      "italic"
    ],
    "suggestion": "改用该端接受的取值：normal / italic",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-text-decoration-line",
    "prop": "text-decoration-line",
    "accept": [
      "none",
      "underline",
      "overline",
      "line-through"
    ],
    "suggestion": "改用该端接受的取值：none / underline / overline / line-through",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-text-decoration-style",
    "prop": "text-decoration-style",
    "accept": [
      "solid",
      "double",
      "dotted",
      "dashed",
      "wavy"
    ],
    "suggestion": "改用该端接受的取值：solid / double / dotted / dashed",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-animation-direction",
    "prop": "animation-direction",
    "accept": [
      "normal",
      "reverse",
      "alternate",
      "alternate-reverse"
    ],
    "suggestion": "改用该端接受的取值：normal / reverse / alternate / alternate-reverse",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-animation-fill-mode",
    "prop": "animation-fill-mode",
    "accept": [
      "forwards",
      "both"
    ],
    "suggestion": "改用该端接受的取值：forwards / both",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  },
  {
    "id": "CSS-PB-will-change",
    "prop": "will-change",
    "accept": [
      "auto",
      "contents"
    ],
    "suggestion": "改用该端接受的取值：auto / contents",
    "source": "Skyline WXSS 支持与差异（官方文档 formats 列）"
  }
]
