// src/compiler/tags.ts
// 标签 / 事件映射表 —— 模板转换（template.ts）与样式选择器重写（style.ts）共用
// 业务代码写标准 HTML 标签，编译器统一映射到小程序标签（§0.3 原则 1）

export const TAG_MAP: Record<string, string> = {
  div: 'view',
  span: 'text',
  p: 'text',
  h1: 'text',
  h2: 'text',
  h3: 'text',
  h4: 'text',
  h5: 'text',
  h6: 'text',
  img: 'image',
  a: 'view',
  button: 'button',
  input: 'input',
  textarea: 'textarea',
  video: 'video',
  canvas: 'canvas',
  'scroll-view': 'scroll-view',
  slot: 'slot',
}

export const EVENT_MAP: Record<string, string> = {
  click: 'tap',
  input: 'input',
  change: 'change',
  submit: 'submit',
  focus: 'focus',
  blur: 'blur',
  touchstart: 'touchstart',
  touchmove: 'touchmove',
  touchend: 'touchend',
  longpress: 'longpress',
  confirm: 'confirm',
  scroll: 'scroll', // scroll-view 内置滚动事件（v0.4 虚拟列表）
}

/**
 * ★v-gesture:<kind> → MP 原生事件名（2026-09-18）。
 *
 * 只登记**有真实原生事件对等**的手势。未登记者在编译器走「剥离 + 明示替代」路径
 * （pan/pinch/rotate/press —— MP 无简单事件对等：官方用 worklet 手势处理器**组件**
 * `<pan-gesture-handler>` 等（属性为 `worklet:ongesture` + 协商），非事件属性）。
 *
 * 依据：EVENT_MAP 的 `click: 'tap'` / `longpress: 'longpress'` 即原生真实事件；
 *   官方 view 通用事件表含 tap/longpress（另有 touchstart/move/end/cancel）。
 */
export const GESTURE_MP_EVENTS: Record<string, string> = {
  tap: 'tap',
  longpress: 'longpress',
}

/** 无事件对等手势的**具体**替代指引（反黑盒：不笼统说「无对等机制」） */
export const MP_GESTURE_ALTERNATIVES: Record<string, string> = {
  pan: '`@touchstart/@touchmove/@touchend`（自行判定位移）或原生 `<pan-gesture-handler>` 组件',
  pinch: '`<scale-gesture-handler>` 组件（worklet:ongesture）',
  rotate: '原生手势处理器组件（MP 无 rotate 事件属性）',
  press: '`<force-press-gesture-handler>` 组件（需 3D Touch 设备）',
  swipe: '`@touchstart/@touchend` 自行判定方向',
}

// 语义标签 → 基础样式类名
// Web 端 h1-h6/p/a 有浏览器 UA 默认样式（大标题/加粗/链接色），小程序 text/view 没有默认样式；
// 映射时给语义标签附加 proteus-* 类，样式侧注入基础 WXSS 还原 Web 语义（用户样式特异性更高可覆盖）
export const SEMANTIC_CLASS: Record<string, string> = {
  h1: 'proteus-h1',
  h2: 'proteus-h2',
  h3: 'proteus-h3',
  h4: 'proteus-h4',
  h5: 'proteus-h5',
  h6: 'proteus-h6',
  p: 'proteus-p',
  a: 'proteus-a',
}
