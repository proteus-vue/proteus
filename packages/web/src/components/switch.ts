// packages/web/src/components/switch.ts
// 小程序 <switch>：Web 模拟——checkbox 视觉对齐微信 switch（载荷 { detail: { value } }）
import { defineComponent, h } from 'vue'

export const WebSwitch = defineComponent({
  name: 'ProteusWebSwitch',
  inheritAttrs: false,
  emits: ['change', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    return () => {
      const { class: cls, checked, disabled, color, ...rest } = attrs as Record<string, unknown>
      const onChange = (e: Event) => {
        const v = (e.target as HTMLInputElement).checked
        emit('change', { detail: { value: v } })
        emit('update:modelValue', v)
      }
      return h('input', {
        ...rest,
        type: 'checkbox',
        role: 'switch',
        checked: !!checked,
        disabled: !!disabled,
        style: color ? { accentColor: String(color) } : undefined,
        class: ['proteus-web-switch', (cls as string) || ''],
        onChange,
      })
    }
  },
})
