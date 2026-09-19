// packages/compat-miniprogram/src/tags.ts
// ★G-31 B6（proteus-component-semantics-plan migration.md §2）：小程序组件标签 → Proteus 语义组件映射
//   两个集合：
//   · AUTO_CODED_TAGS —— codemod 自动替换（1:1 语义组件）
//   · MANUAL_TAGS —— 需语义识别（scroll-view/swiper/movable——语义还原为布局原语，AI 辅助 migration.md §2）
//   映射源：miniprogram-mapping.md ✅ 条目逐条对齐（G-32 完整性标尺）

/** codemod 自动替换：小程序标签 → p-* 语义组件（1:1；migration.md §2 自动集）
 *  ★2026-09-19 增补 `scroll-view → p-scroll-view`：端对齐批次 2 已把 `<scroll-view>` 官方属性
 *    40/40 全量透传进薄包装 `p-scroll-view`（属性名 kebab 同名、事件名同名且载荷归一）→ 属真 1:1，
 *    不再需要「语义识别」人工环节（原 MANUAL 判定写于该组件落地之前）。语义还原为 `p-stack`
 *    direction 仍是**可选**的进一步精炼，非迁移必需。 */
export const AUTO_CODEMOD_TAGS: Record<string, string> = {
  view: 'p-box',
  text: 'p-text',
  button: 'p-button',
  image: 'p-image',
  input: 'p-input',
  textarea: 'p-textarea',
  switch: 'p-switch',
  slider: 'p-slider',
  checkbox: 'p-checkbox',
  radio: 'p-radio',
  form: 'p-form',
  picker: 'p-picker',
  'scroll-view': 'p-scroll-view',
}

/** 需语义识别（manual 标注——语义还原为布局原语；AI Agent G-23 辅助）
 *  ★提示文案纪律：只写**已落地**的目标（不得指向未实现的 props——否则迁移者照着做会得到静默无效属性）。 */
export const MANUAL_TAGS: Record<string, string> = {
  swiper: '轮播语义——无 1:1 组件（layout.stack 目标形态 snap/loop 尚未实现）；候选 p-scroll-view scroll-x + paging-enabled',
  'swiper-item': '随 swiper 一并决策（轮播子项）',
  'movable-area': 'gesture.scrollable 容器（p-scrollable）',
  'movable-view': 'gesture.draggable（p-draggable）',
  navigator: 'p-router-link（url → to 属性映射）',
  label: 'p-label',
  progress: 'p-progress',
  'rich-text': 'p-rich-text',
  icon: 'p-icon',
  canvas: 'p-canvas',
  video: 'p-media kind="video"（消灭为属性）',
  audio: 'p-media kind="audio"（消灭为属性）',
  camera: 'p-camera + useCamera',
  map: 'p-map + useMap',
  'web-view': 'p-webview',
}

/** 判定一个标签是否需要 manual 标注（有效小程序组件标签） */
export function isManualTag(tag: string): boolean {
  return tag in MANUAL_TAGS
}

/** 判定一个标签是否自动可替换 */
export function isAutoCodeable(tag: string): boolean {
  return tag in AUTO_CODEMOD_TAGS
}