// src/components/contracts/props.ts —— 内置组件统一 Props 契约（组件库落地评估 v2 §1）
// 每个基础组件必须继承 BaseProps；组件命名统一 p- 前缀（v2 §2 命名决策）：
//   - 目录名 = 标签名（p-view/index.vue → <p-view>），与既有 virtual-list/index.vue 约定一致
//   - p- 前缀天然避开 MP 原生标签命名冲突（button/input/image/text 等）
// 事件规范：kebab-case（@change / @scroll-to-lower），Skyline 事件对象由运行时归一为 ProteusEvent
// 插槽规范：默认插槽 + header/footer/content 具名插槽；Skyline 不支持动态插槽名时降级条件渲染 + warn
// v-model 规范：value + update:value / visible + update:visible（MP 走 props + triggerEvent，禁止直接改父）

/** 基础 Props 契约：所有内置组件继承 */
export interface BaseProps {
  /** 跨端唯一标识，自动生成，可用于埋点 */
  pid?: string
  /** 统一禁用语义 */
  disabled?: boolean
  /** 无障碍标签（Web ARIA / MP aria-*） */
  ariaLabel?: string
}

/** 内置组件标签统一前缀（v2 命名决策 §2） */
export const COMPONENT_TAG_PREFIX = 'p-'

/** 统一事件命名：kebab-case 事件名列表（新增组件同步追加，矩阵 CI 校验） */
export const EVENT_NAMES = ['change', 'input', 'confirm', 'scroll-to-lower', 'load', 'error'] as const

/** 统一具名插槽清单（新增组件同步追加） */
export const SLOT_NAMES = ['header', 'footer', 'content'] as const
