// packages/web/src/components/slider.ts
// 小程序 <slider>：Web 模拟——range input（载荷 { detail: { value } }；changing/change 对齐）
import { defineComponent, h } from 'vue'

export const WebSlider = defineComponent({
  name: 'ProteusWebSlider',
  inheritAttrs: false,
  emits: ['change', 'changing', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    return () => {
      const { class: cls, value, min, max, step, disabled, ...rest } = attrs as Record<string, unknown>
      const onInput = (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value)
        emit('changing', { detail: { value: v } })
      }
      const onChange = (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value)
        emit('change', { detail: { value: v } })
        emit('update:modelValue', v)
      }
      return h('input', {
        ...rest,
        type: 'range',
        value: String(value ?? 0),
        min: String(min ?? 0),
        max: String(max ?? 100),
        step: String(step ?? 1),
        disabled: !!disabled,
        class: ['proteus-web-slider', (cls as string) || ''],
        onInput,
        onChange,
      })
    }
  },
})
