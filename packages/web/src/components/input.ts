// packages/web/src/components/input.ts
// 小程序 <input>：Web 模拟：原生 input + bindinput 载荷对齐（{ value } 跨端归一）
import { defineComponent, h } from 'vue'

export const WebInput = defineComponent({
  name: 'ProteusWebInput',
  inheritAttrs: false,
  emits: ['input', 'change', 'focus', 'blur', 'confirm', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    return () => {
      const { class: cls, type, placeholder, value, ...rest } = attrs as Record<string, unknown>
      const onInput = (e: Event) => {
        const v = (e.target as HTMLInputElement).value
        // ★载荷对齐小程序 bindinput：event 结构 { detail: { value } }（小程序语义原生行为）
        emit('input', { detail: { value: v } })
        emit('update:modelValue', v)
      }
      const onChange = (e: Event) => emit('change', { detail: { value: (e.target as HTMLInputElement).value } })
      const onFocus = (e: FocusEvent) => emit('focus', { detail: { value: (e.target as HTMLInputElement).value } })
      const onBlur = (e: FocusEvent) => emit('blur', { detail: { value: (e.target as HTMLInputElement).value } })
      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') emit('confirm', { detail: { value: (e.target as HTMLInputElement).value } })
      }
      return h('input', {
        ...rest,
        type: (type as string) || 'text',
        placeholder: (placeholder as string) || '',
        value: (value as string) ?? '',
        class: ['proteus-web-input', (cls as string) || ''],
        onInput,
        onChange,
        onFocus,
        onBlur,
        onKeydown,
      })
    }
  },
})
