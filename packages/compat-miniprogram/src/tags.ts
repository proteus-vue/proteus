// packages/compat-miniprogram/src/tags.ts
// ★G-31 B6（proteus-component-semantics-plan migration.md §2）：小程序组件标签 → Proteus 语义组件映射
//   两个集合：
//   · AUTO_CODED_TAGS —— codemod 自动替换（1:1 语义组件）
//   · MANUAL_TAGS —— 需语义识别（scroll-view/swiper/movable——语义还原为布局原语，AI 辅助 migration.md §2）
//   映射源：miniprogram-mapping.md ✅ 条目逐条对齐（G-32 完整性标尺）

/** codemod 自动替换：小程序标签 → p-* 语义组件（1:1；migration.md §2 自动集） */
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
}

/** 需语义识别（manual 标注——scroll-view→p-stack 等语义还原；AI Agent G-23 辅助） */
export const MANUAL_TAGS: Record<string, string> = {
  'scroll-view': 'p-scroll（或 p-stack direction——语义识别）',
  swiper: 'p-stack snap="mandatory" loop（轮播语义）',
  'swiper-item': 'p-stack 子项',
  'movable-area': 'gesture.scrollable 容器',
  'movable-view': 'gesture.draggable',
  navigator: 'router-link（url → to 映射）',
  label: 'p-label（L2）',
  progress: 'p-progress（L2）',
  'rich-text': 'p-rich-text',
  icon: 'p-icon',
  canvas: 'p-canvas',
  video: 'p-media kind="video"（消灭为属性）',
  audio: 'p-media kind="audio"（消灭为属性）',
  camera: 'p-camera + useCamera（L2）',
  map: 'p-map + useMap（L2）',
  'web-view': 'p-webview（L2）',
}

/** 判定一个标签是否需要 manual 标注（有效小程序组件标签） */
export function isManualTag(tag: string): boolean {
  return tag in MANUAL_TAGS
}

/** 判定一个标签是否自动可替换 */
export function isAutoCodeable(tag: string): boolean {
  return tag in AUTO_CODEMOD_TAGS
}