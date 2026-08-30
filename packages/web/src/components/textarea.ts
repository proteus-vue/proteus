// packages/web/src/components/textarea.ts
// 小程序 <textarea>：Web 模拟——原生 textarea（载荷对齐小程序 { detail: { value } }）
import { defineComponent, h } from 'vue'

export const WebTextarea = defineComponent({
  name: 'ProteusWebTextarea',
  inheritAttrs: false,
  emits: ['input', 'change', 'focus', 'blur'],
  setup(_props, { slots, attrs, emit }) {
    return () => {
      const { class: cls, value, placeholder, ...rest } = attrs as Record<string, unknown>
      const onInput = (e: Event) => emit('input', { detail: { value: (e.target as HTMLTextAreaElement).value } })
      const onChange = (e: Event) => emit('change', { detail: { value: (e.target as HTMLTextAreaElement).value } })
      const onFocus = (e: FocusEvent) => emit('focus', { detail: { value: (e.target as HTMLTextAreaElement).value } })
      const onBlur = (e: FocusEvent) => emit('blur', { detail: { value: (e.target as HTMLTextAreaElement).value } })
      return h(
        'textarea',
        {
          ...rest,
          value: (value as string) ?? '',
          placeholder: (placeholder as string) || '',
          class: ['proteus-web-textarea', (cls as string) || ''],
          onInput,
          onChange,
          onFocus,
          onBlur,
        },
        slots.default?.(),
      )
    }
  },
})
