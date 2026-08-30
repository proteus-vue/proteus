// packages/web/src/components/button.ts
// 小程序 <button>：Web 模拟：原生 button + open-type 开放能力降级（触发 openxxx 事件）
//   + hover-class 按下反馈（对齐微信 button 默认 button-hover：按下背景变暗 rgba(0,0,0,0.1)）
import { defineComponent, h, ref } from 'vue'
import { OPEN_TYPE_EVENTS } from '../open-type'

export const WebButton = defineComponent({
  name: 'ProteusWebButton',
  inheritAttrs: false,
  emits: ['click', ...Object.values(OPEN_TYPE_EVENTS)],
  setup(_props, { slots, attrs, emit }) {
    const hovered = ref(false)
    const onClick = (e: Event) => {
      const openType = (attrs as Record<string, unknown>).openType as string | undefined
      if (openType && OPEN_TYPE_EVENTS[openType]) {
        const eventName = OPEN_TYPE_EVENTS[openType]
        // ★开放能力降级（反黑盒）：小程序为原生开放能力，Web 无微信对等 → 触发自定义事件由开发者处理
        console.info(
          `[proteus-web] <button open-type="${openType}"> 在小程序为原生开放能力（${openType}），Web 端无微信对等——已触发事件 "${eventName}"，请自定义处理（如分享用 navigator.share）`,
        )
        emit(eventName, e)
      }
      emit('click', e)
    }
    return () => {
      const { class: cls, openType, hoverClass, ...rest } = attrs as Record<string, unknown>
      // hover-class：小程序按下加类（默认 button-hover 背景变暗）；Web 用 pointer 事件切换
      const hoverCls = (hoverClass as string) || 'proteus-web-button--hover'
      const handlers: Record<string, unknown> = {
        onClick,
        onPointerdown: () => (hovered.value = true),
        onPointerup: () => (hovered.value = false),
        onPointerleave: () => (hovered.value = false),
      }
      return h(
        'button',
        {
          ...rest,
          ...handlers,
          class: ['proteus-web-button', hovered.value ? hoverCls : '', (cls as string) || ''],
        },
        slots.default?.(),
      )
    }
  },
})
