// packages/web/src/components/switch.ts
// 小程序 <switch>：Web 模拟——对齐微信 iOS 风格过渡（载荷 { detail: { value } }）
// 静止态：关闭=白底灰边 / 打开=绿底绿边
// ★过渡（track 上的白色扩散/收缩，非 thumb 放大）：白色 wash 遮罩从中间 scale 扩散（开→关：白色从中间向四周填满）
//   → 底色切换 → wash 收缩（关→开：白色从四周向中间缩小消失）
import { defineComponent, h, ref } from 'vue'

export const WebSwitch = defineComponent({
  name: 'ProteusWebSwitch',
  inheritAttrs: false,
  emits: ['change', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    const checked = ref(Boolean((attrs as Record<string, unknown>).checked))
    const wash = ref(false) // 白色扩散遮罩（track 上的白色扩散/收缩动画）

    const onChange = (e: Event) => {
      const next = (e.target as HTMLInputElement).checked
      // ★iOS 风格（对齐微信）：wash 白色遮罩放大（白色从中间扩散）→ 底色切换（transition 过渡）→ wash 缩小（白色收缩/填满后无感）
      wash.value = true
      window.setTimeout(() => {
        checked.value = next
        window.setTimeout(() => {
          wash.value = false
        }, 140)
      }, 200)
      emit('change', { detail: { value: next } })
      emit('update:modelValue', next)
    }

    return () => {
      const { class: cls, checked: _c, disabled, color, ...rest } = attrs as Record<string, unknown>
      const on = checked.value
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
          // 白色扩散遮罩：滑轨内的小圆（scale 扩散——被 track overflow:hidden 裁剪在圆角内，非整个 switch 大圆）
          h('span', {
            class: 'pws-wash',
            style: {
              transform: `translate(-50%, -50%) scale(${wash.value ? 2.6 : 0})`,
              opacity: wash.value ? 1 : 0,
            },
          }),
          h('input', { ...rest, type: 'checkbox', checked: on, disabled: !!disabled, onChange }),
          // thumb 纯滑动（不放大——扩散动画在 track 遮罩上）
          h('span', { class: 'pws-thumb', style: { transform: `translateX(${tx}px)` } }),
        ],
      )
    }
  },
})
