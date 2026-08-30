// packages/web/src/components/view.ts
// 小程序 <view>：块级容器。Web 模拟：div（透传 class/style/事件；hover-class 降级：pointer 按下加类）
import { defineComponent, h, ref } from 'vue'

export const WebView = defineComponent({
  name: 'ProteusWebView',
  inheritAttrs: false,
  setup(_props, { slots, attrs }) {
    const pressed = ref(false)
    return () => {
      const { class: cls, hoverClass, ...rest } = attrs as Record<string, unknown>
      // hover-class：小程序按下加类（Web 用 pointerdown/up 切换；MVP 支持单类名）
      const handlers: Record<string, unknown> = {}
      if (hoverClass) {
        handlers.onPointerdown = () => (pressed.value = true)
        handlers.onPointerup = () => (pressed.value = false)
        handlers.onPointerleave = () => (pressed.value = false)
      }
      return h(
        'div',
        {
          ...rest,
          ...handlers,
          class: ['proteus-web-view', pressed.value && hoverClass ? (hoverClass as string) : '', (cls as string) || ''],
        },
        slots.default?.(),
      )
    }
  },
})
