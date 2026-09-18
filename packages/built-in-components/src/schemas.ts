// packages/built-in-components/src/schemas.ts
// ★B8 消费端：框架内置组件 ↔ MpComponentSchema（微信内置组件属性注册表）对照
// 定位：内置组件 = 微信小程序内置组件为基准；每个 Web 实现组件对应注册表一个标签（防漂移：
//   mpComponentRegistry 新增标签但无 Web 实现 → 编译报错；Web 组件不在注册表 → 编译报错）
import { getComponentSchema, mpComponentRegistry } from '@proteus-vue/types/mp/component-schema'

/** 已实现 Web 模拟的内置组件标签（与 packages/built-in-components/src/components/* 一一对应） */
export const BUILT_IN_TAGS = [
  'view',
  'text',
  'button',
  'input',
  'image',
  'scroll-view',
  'textarea',
  'switch',
  'slider',
  'icon',
  'progress',
  'navigator',
  'picker',
] as const

// 编译期断言：BUILT_IN_TAGS 每个都必须在 MpComponentRegistry 注册（新增组件漏登记 → 报错）
type _AssertRegistered = Record<(typeof BUILT_IN_TAGS)[number], object>
const _assertRegistered: _AssertRegistered = {
  view: mpComponentRegistry.view,
  text: mpComponentRegistry.text,
  button: mpComponentRegistry.button,
  input: mpComponentRegistry.input,
  image: mpComponentRegistry.image,
  'scroll-view': mpComponentRegistry['scroll-view'],
  textarea: mpComponentRegistry.textarea,
  switch: mpComponentRegistry.switch,
  slider: mpComponentRegistry.slider,
  icon: mpComponentRegistry.icon,
  progress: mpComponentRegistry.progress,
  navigator: mpComponentRegistry.navigator,
  picker: mpComponentRegistry.picker,
}
void _assertRegistered

/** 取内置组件 schema（未实现/未登记返回 undefined） */
export function getBuiltInSchema(tag: string) {
  return getComponentSchema(tag)
}
