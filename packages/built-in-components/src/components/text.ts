// packages/web/src/components/text.ts
// 小程序 <text>：行内文本。Web 模拟：span（selectable → user-select）
import { defineComponent, h } from 'vue'

export const WebText = defineComponent({
  name: 'ProteusWebText',
  inheritAttrs: false,
  setup(_props, { slots, attrs }) {
    return () => {
      const { class: cls, selectable, ...rest } = attrs as Record<string, unknown>
      const style: Record<string, string> = {}
      if (selectable) {
        style.userSelect = 'text'
        style.webkitUserSelect = 'text'
      }
      return h(
        'span',
        {
          ...rest,
          style: { ...((rest.style as Record<string, string>) ?? {}), ...style },
          class: ['proteus-web-text', (cls as string) || ''],
        },
        slots.default?.(),
      )
    }
  },
})
