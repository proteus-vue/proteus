// packages/web/src/components/switch.ts
// 小程序 <switch>：Web 模拟——对齐微信 iOS 风格过渡（载荷 { detail: { value } }）
// 静止态：关闭=白底灰边 / 打开=绿底绿边；过渡：白色 thumb 放大（扩散）→ 滑动 + 底色过渡 → 缩回
import { defineComponent, h, ref } from 'vue'

export const WebSwitch = defineComponent({
  name: 'ProteusWebSwitch',
  inheritAttrs: false,
  emits: ['change', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    const checked = ref(Boolean((attrs as Record<string, unknown>).checked))
    const expanding = ref(false) // 白色 thumb 放大（扩散阶段）
    const sliding = ref(false) // 滑动 + 底色过渡阶段

    const onChange = (e: Event) => {
      const next = (e.target as HTMLInputElement).checked
      // ★iOS 风格过渡（对齐微信）：白色从 thumb 位置扩散 → 滑动 + 底色过渡 → 缩回
      expanding.value = true // 放大（白色扩散起点）
      window.setTimeout(() => {
        checked.value = next // 底色切换（transition 过渡）+ 滑动
        sliding.value = true
        window.setTimeout(() => {
          expanding.value = false // 缩回
          sliding.value = false
        }, 280)
      }, 150)
      emit('change', { detail: { value: next } })
      emit('update:modelValue', next)
    }

    return () => {
      const { class: cls, checked: _c, disabled, color, ...rest } = attrs as Record<string, unknown>
      const on = checked.value
      const scale = expanding.value || sliding.value ? 1.5 : 1
      const tx = on ? 20 : 0
      return h(
        'div',
        {
          class: ['proteus-web-switch', on ? 'is-on' : '', (cls as string) || ''],
          style: {
            backgroundColor: on ? '#07c160' : '#ffffff',
            borderColor: on ? '#07c160' : '#d0d0d0',
            accentColor: color ? String(color) : undefined,
          },
        },
        [
          h('input', { ...rest, type: 'checkbox', checked: on, disabled: !!disabled, onChange }),
          h('span', { class: 'pws-thumb', style: { transform: `translateX(${tx}px) scale(${scale})` } }),
        ],
      )
    }
  },
})
