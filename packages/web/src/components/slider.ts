// packages/web/src/components/slider.ts
// 小程序 <slider>：Web 模拟——自定义结构（div 滑轨 + 填充 + 白圆点滑块，不依赖 -webkit 伪元素）
// 浅灰滑轨 + activeColor 填充 + 白圆点（对齐微信）；隐藏 input 接收拖拽；载荷 { detail: { value } }
import { computed, defineComponent, h, ref } from 'vue'

function calcPct(v: number, min: number, max: number): number {
  return max > min ? Math.round(((v - min) / (max - min)) * 100) : 0
}

export const WebSlider = defineComponent({
  name: 'ProteusWebSlider',
  inheritAttrs: false,
  emits: ['change', 'changing', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    const { min, max } = attrs as Record<string, unknown>
    const minN = Number(min ?? 0)
    const maxN = Number(max ?? 100)
    // 内部值状态（拖拽后同步——避免受控 attrs.value 静态值重置 input）
    const val = ref(Number((attrs as Record<string, unknown>).value ?? 0))
    const pct = computed(() => calcPct(val.value, minN, maxN))

    const onInput = (e: Event) => {
      val.value = Number((e.target as HTMLInputElement).value)
      emit('changing', { detail: { value: val.value } })
    }
    const onChange = (e: Event) => {
      val.value = Number((e.target as HTMLInputElement).value)
      emit('change', { detail: { value: val.value } })
      emit('update:modelValue', val.value)
    }

    return () => {
      const { class: cls, value: _v, min: _min, max: _max, step, disabled, activeColor, ...rest } = attrs as Record<string, unknown>
      const fillColor = String(activeColor ?? '#07c160')
      return h(
        'div',
        {
          class: ['proteus-web-slider', (cls as string) || ''],
          style: { '--pws-color': fillColor },
        },
        [
          h('div', { class: 'pws-track' }, [h('div', { class: 'pws-fill', style: { width: `${pct.value}%` } })]),
          h('span', { class: 'pws-thumb', style: { left: `${pct.value}%` } }),
          h('input', {
            ...rest,
            type: 'range',
            value: String(val.value),
            min: String(minN),
            max: String(maxN),
            step: String(step ?? 1),
            disabled: !!disabled,
            onInput,
            onChange,
          }),
        ],
      )
    }
  },
})
