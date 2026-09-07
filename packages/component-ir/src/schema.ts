// packages/component-ir/src/schema.ts
// ★G-31 B1：Component IR（C-IR）——组件在编译期标准化后的中间表示，由各端 Render Backend 消费
//   组件=语义（semantic 字段），属性=约束（props），Backend 消费 semantic 而非 tag 字符串
//   与 plan component-ir.schema.json 同构（TS 对象形式——IDE/Compiler/conformance 共享，零依赖）
export interface ComponentIR {
  /** 组件标签名（如 p-grid）——仅用于源码定位，不参与后端映射 */
  tag: string
  /** 语义类型（后端映射依据），格式：<domain>.<kind> */
  semantic: string
  /** 已校验的约束属性（不是平台样式指令） */
  props: Record<string, unknown>
  children: ComponentIR[]
  /** 引用的原生能力（G-28） */
  capabilities?: Array<{ name: string; [key: string]: unknown }>
  /** 属性降级声明（G-31.2 / CMP006）：每个能力属性须声明 supported/fallback/unsupported */
  degradation?: Record<string, 'supported' | 'fallback' | 'unsupported'>
}

/** 语义枚举（与 plan component-ir.schema.json 一致）——<domain>.<kind> */
export const SEMANTIC_ENUM = [
  // —— 布局原语（G-32 ① Layout 12：G-22 泛化——swiper/scroll-view/movable 消灭为属性）——
  'layout.box',
  'layout.inline',
  'layout.stack',
  'layout.grid',
  'layout.fluid',
  'layout.adaptive',
  'layout.fit',
  'layout.spacer',
  'layout.divider',
  'layout.scroll',
  'layout.virtual-list',
  'layout.masonry',
  // ★G-31 B4：Fluid 体系扩展语义（有明确系统原生对应——原则 #10.8）
  'layout.split',
  'layout.safe',
  'layout.sidebar',
  // ★#405 语义登记批：组件库扩展组件（Fluid S1-S4 + 工程兜底，语义层待 L2 落地——G-31.4 降级 planned）
  'layout.aspect',
  'layout.zone',
  // —— 基础 UI 原语（G-32 ② UI 18 + 既有按钮）——
  'ui.text',
  'ui.heading',
  'ui.rich-text',
  'ui.icon',
  'ui.image',
  'ui.avatar',
  'ui.media',
  'ui.canvas',
  'ui.svg',
  'ui.input',
  'ui.textarea',
  'ui.select',
  'ui.checkbox',
  'ui.radio',
  'ui.switch',
  'ui.slider',
  'ui.picker',
  'ui.form',
  'ui.button', // 既有按钮（小程序对照 row 14）
  // ★G-31 B4：既有组件对齐（p-list-view/p-nav-bar）
  'ui.list',
  'ui.nav',
  // ★#405 语义登记批：反馈/状态类组件
  'ui.loading',
  'ui.scale',
  'ui.skeleton',
  // —— 容器/导航原语（G-32 ③ Shell 10）——
  'shell.page',
  'shell.nav',
  'shell.tabbar',
  'shell.segment',
  'shell.drawer',
  'shell.modal',
  'shell.popover',
  'shell.toast',
  'shell.action-sheet',
  // ★#405 语义登记批：弹层/工具栏组件
  'shell.mask',
  'shell.popup',
  'shell.toolbar',
  // —— 交互/手势原语（G-32 ④ Gesture——组件形态 2 个；v-gesture: 指令归绑定层不产生 C-IR 节点）——
  'gesture.draggable',
  'gesture.scrollable',
  // —— 工程原语（G-32 ⑥ Engineering——组件形态 3 个 + ★#405 错误兑底；Hook/路由方法归 API 层不产生 C-IR 节点）——
  'engineering.router-link',
  'engineering.transition',
  'engineering.animate',
  'engineering.error-boundary',
  // —— 能力入口（G-28 组件化：p-* 能力入口组件；useXxx Hook 归 API 层不产生 C-IR 节点）——
  'capability.scan-qr',
  'capability.pick-photo',
  'capability.location',
] as const

/** C-IR JSON Schema（等价于 plan component-ir.schema.json——TS 内嵌供校验/工具消费） */
export const COMPONENT_IR_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://proteus.dev/schemas/component-ir.json',
  title: 'Proteus Component IR (C-IR)',
  type: 'object',
  required: ['tag', 'semantic', 'props', 'children'],
  properties: {
    tag: { type: 'string', pattern: '^p-[a-z0-9-]+$' },
    semantic: { type: 'string', enum: SEMANTIC_ENUM },
    props: { type: 'object', additionalProperties: true },
    children: { type: 'array', items: { $ref: '#' }, default: [] },
    capabilities: { type: 'array', items: { type: 'object', required: ['name'] } },
    degradation: { type: 'object', additionalProperties: { enum: ['supported', 'fallback', 'unsupported'] } },
  },
} as const

/** C-IR 组件标签 → 语义类型（组件清单映射——G-32 ①-③ 组件原语 + G-31 L1 布局/UI 原语 + ★B4 现有组件对齐） */
export const TAG_SEMANTIC_MAP: Record<string, string> = {
  // G-32 ① 布局原语（12）
  'p-box': 'layout.box',
  'p-inline': 'layout.inline',
  'p-stack': 'layout.stack',
  'p-grid': 'layout.grid',
  'p-fluid': 'layout.fluid',
  'p-adaptive': 'layout.adaptive',
  'p-fit': 'layout.fit',
  'p-spacer': 'layout.spacer',
  'p-divider': 'layout.divider',
  'p-scroll': 'layout.scroll',
  'p-virtual-list': 'layout.virtual-list',
  'p-masonry': 'layout.masonry',
  // G-32 ② UI 原语（18）
  'p-text': 'ui.text',
  'p-heading': 'ui.heading',
  'p-rich-text': 'ui.rich-text',
  'p-icon': 'ui.icon',
  'p-image': 'ui.image',
  'p-avatar': 'ui.avatar',
  'p-media': 'ui.media',
  'p-canvas': 'ui.canvas',
  'p-svg': 'ui.svg',
  'p-input': 'ui.input',
  'p-textarea': 'ui.textarea',
  'p-select': 'ui.select',
  'p-checkbox': 'ui.checkbox',
  'p-radio': 'ui.radio',
  'p-switch': 'ui.switch',
  'p-slider': 'ui.slider',
  'p-picker': 'ui.picker',
  'p-form': 'ui.form',
  'p-button': 'ui.button', // 既有按钮
  // G-32 ③ Shell 原语（10）
  'p-page': 'shell.page',
  'p-nav': 'shell.nav',
  'p-tabbar': 'shell.tabbar',
  'p-segment': 'shell.segment',
  'p-drawer': 'shell.drawer',
  'p-modal': 'shell.modal',
  'p-popover': 'shell.popover',
  'p-toast': 'shell.toast',
  'p-action-sheet': 'shell.action-sheet',
  'p-split': 'layout.split', // ★已落地绑定（G-32 S10 分栏语义——layout.split 承载）
  // G-32 ④ Gesture 组件形态（2）
  'p-draggable': 'gesture.draggable',
  'p-scrollable': 'gesture.scrollable',
  // G-32 ⑥ Engineering 组件形态（3）
  'p-router-link': 'engineering.router-link', // ★E18 组件形态（p- 前缀产 C-IR）
  'router-link': 'engineering.router-link', // ★兼容别名（Vue Router 风格 <router-link> 标签；非 catalog 条目——p-view 先例 G-31 B4）
  'p-transition': 'engineering.transition',
  'p-animate': 'engineering.animate',
  // G-31 能力入口
  'p-scan-qr': 'capability.scan-qr',
  'p-pick-photo': 'capability.pick-photo',
  'p-location': 'capability.location',
  // ★G-31 B4 现有组件对齐（src/components 实际标签 → L1 语义）
  'p-view': 'layout.box', // 原子容器 = p-box 角色
  'p-list-view': 'ui.list',
  'p-nav-bar': 'ui.nav',
  // ★G-31 B4 Fluid 体系扩展语义（有明确系统原生对应——原则 #10.8）
  'p-safe': 'layout.safe',
  'p-sidebar': 'layout.sidebar',
  // ★#405 语义登记批：剩余 10 组件全量入图（EXTRA_KIND 文档兑底退役）——
  //   9 个新语义（catalog planned L2：语义层待多端映射）+ p-scroll-view 复用 layout.scroll（p-view 先例）
  'p-aspect': 'layout.aspect',
  'p-zone': 'layout.zone',
  'p-loading': 'ui.loading',
  'p-scale': 'ui.scale',
  'p-skeleton': 'ui.skeleton',
  'p-mask': 'shell.mask',
  'p-popup': 'shell.popup',
  'p-toolbar': 'shell.toolbar',
  'p-scroll-view': 'layout.scroll', // 滚动容器 = p-scroll 角色
  'p-error-boundary': 'engineering.error-boundary', // E8 原语组件形态（useErrorBoundary API 形态并存）
}
