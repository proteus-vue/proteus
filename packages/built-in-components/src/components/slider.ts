// packages/web/src/components/slider.ts
// 小程序 <slider>：Web 模拟——自定义结构（div 滑轨 + 填充 + 圆点滑块，不依赖 -webkit 伪元素）
// 轨道色 + activeColor 填充 + 圆点（对齐微信）；隐藏 input 接收拖拽；载荷 { detail: { value } }
// ★属性全覆盖（对齐官方 slider）：min/max/step/disabled/value/activeColor/background-color/block-size/block-color/show-value
import { computed, defineComponent, h, ref } from 'vue'

function calcPct(v: number, min: number, max: number): number {
  return max > min ? Math.round(((v - min) / (max - min)) * 100) : 0
}

/** 组件 attrs 读取（Vue 组件无声明 props 时，kebab 写法以 kebab 键落入 attrs；
 *  对外亦可能传 camel 键——两者都读，避免「写了没生效」的静默偏差） */
function pick(obj: Record<string, unknown>, camel: string): unknown {
  const kebab = camel.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
  return obj[camel] ?? obj[kebab]
}

export const WebSlider = defineComponent({
  name: 'ProteusWebSlider',
  inheritAttrs: false,
  emits: ['change', 'changing', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    const a = attrs as Record<string, unknown>
    const minN = Number(a.min ?? 0)
    const maxN = Number(a.max ?? 100)
    const blockSize = Number(pick(a, 'blockSize') ?? 28)
    // 内部值状态（拖拽后同步——避免受控 attrs.value 静态值重置 input）
    const val = ref(Number(a.value ?? 0))
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
      const {
        class: cls, value: _v, min: _min, max: _max, step, disabled,
        activeColor, blockSize: _bs, blockColor, showValue: _sv, ...rest
      } = a
      const fillColor = String(activeColor ?? pick(a, 'activeColor') ?? '#07c160')
      const trackColor = String(pick(a, 'backgroundColor') ?? pick(a, 'color') ?? '#e5e5e5')
      const thumbColor = String(blockColor ?? '#ffffff')
      const showValueOn = !!(pick(a, 'showValue') ?? _sv)
      return h(
        'div',
        {
          class: ['proteus-web-slider', (cls as string) || ''],
          style: { '--pws-color': fillColor, '--pws-track': trackColor, '--pws-thumb': thumbColor, '--pws-block': blockSize + 'px' },
        },
        [
          h('div', { class: 'pws-track' }, [h('div', { class: 'pws-fill', style: { width: `${pct.value}%` } })]),
          // 圆点滑块（尺寸 = block-size；类名独立避免与 switch 滑块冲突）
          h('span', { class: 'pws-slider-thumb', style: { left: `${pct.value}%` } }),
          showValueOn ? h('span', { class: 'pws-value' }, String(val.value)) : null,
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
