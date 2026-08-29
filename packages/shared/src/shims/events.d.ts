// src/shims/events.d.ts
// 事件处理器类型（类型提示全链路步骤 4）—— 全局声明（无 export，页面/组件无需 import）
// 微信事件对象：detail（自定义数据）/ currentTarget.dataset（元素自定义数据）
// 用法：function onChange(e: MpInputEvent) { e.detail.value } / function onTap(e: TapEvent) { e.currentTarget.dataset.url }
// 命名避开 DOM 内置类型（InputEvent/UIEvent 已存在）

/** 通用微信事件（TDetail = 事件携带数据，如 input 的 { value: string }） */
interface MpEvent<TDetail = unknown> {
  type: string
  detail: TDetail
  target: { dataset: Record<string, string>; id?: string }
  currentTarget: { dataset: Record<string, string>; id?: string }
  timeStamp: number
}

/** input/textarea 输入事件（v-model handler 等）：e.detail.value: string */
type MpInputEvent = MpEvent<{ value: string }>

/** 点击事件（tap）：e.currentTarget.dataset 可读元素自定义数据 */
type TapEvent = MpEvent<Record<string, never>>
