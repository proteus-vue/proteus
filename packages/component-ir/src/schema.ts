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
  'layout.box',
  'layout.stack',
  'layout.grid',
  'layout.fluid',
  'layout.adaptive',
  'layout.fit',
  // ★G-31 B4：Fluid 体系扩展语义（有明确系统原生对应——原则 #10.8）
  'layout.split',
  'layout.safe',
  'layout.sidebar',
  'ui.text',
  'ui.button',
  'ui.image',
  'ui.input',
  'ui.list',
  'ui.nav',
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

/** C-IR 组件标签 → 语义类型（组件清单映射——G-31 §3 布局原语 + UI 原语 + ★B4 现有组件对齐） */
export const TAG_SEMANTIC_MAP: Record<string, string> = {
  // G-31 L1 布局原语
  'p-box': 'layout.box',
  'p-stack': 'layout.stack',
  'p-grid': 'layout.grid',
  'p-fluid': 'layout.fluid',
  'p-adaptive': 'layout.adaptive',
  'p-fit': 'layout.fit',
  // G-31 L1 UI 原语
  'p-text': 'ui.text',
  'p-button': 'ui.button',
  'p-image': 'ui.image',
  'p-input': 'ui.input',
  'p-list': 'ui.list',
  'p-nav': 'ui.nav',
  // G-31 能力入口
  'p-scan-qr': 'capability.scan-qr',
  'p-pick-photo': 'capability.pick-photo',
  'p-location': 'capability.location',
  // ★G-31 B4 现有组件对齐（src/components 实际标签 → L1 语义）
  'p-view': 'layout.box', // 原子容器 = p-box 角色
  'p-list-view': 'ui.list',
  'p-nav-bar': 'ui.nav',
  'p-textarea': 'ui.input',
  'p-modal': 'layout.adaptive', // 弹窗 = adaptive 语义载体
  // ★G-31 B4 Fluid 体系扩展语义（有明确系统原生对应——原则 #10.8）
  'p-split': 'layout.split',
  'p-safe': 'layout.safe',
  'p-sidebar': 'layout.sidebar',
}
