// packages/web/src/components/switch.ts
// 小程序 <switch>：Web 模拟——对齐微信 iOS 风格过渡（载荷 { detail: { value } }）
// 静止态：关闭=白底灰边 / 打开=绿底绿边
// ★过渡（track 内的白色扩散，方向区分，被 overflow:hidden 裁剪在滑轨内）：
//   开→关：白色圆从开关中间向四周扩展（wash 0→大）→ 底色绿→白
//   关→开：白色从四周向中间收缩消失（wash 瞬间覆盖 → 底色白→绿 → wash 大→0）
import { defineComponent, h, ref } from 'vue'

export const WebSwitch = defineComponent({
  name: 'ProteusWebSwitch',
  inheritAttrs: false,
  emits: ['change', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    const checked = ref(Boolean((attrs as Record<string, unknown>).checked))
    const wash = ref(false) // 白色扩散遮罩（scale 扩散/收缩）
    const washInstant = ref(false) // 瞬间置大（无过渡——关→开的"白色初始覆盖"）

    const onChange = (e: Event) => {
      const next = (e.target as HTMLInputElement).checked
      if (checked.value) {
        // 开→关：wash 扩散与底色绿→白**同步**（微信效果：白色扩展的同时底色变白，无先后延迟）
        wash.value = true
        checked.value = false
        window.setTimeout(() => {
          wash.value = false // 扩散完成（track 已白）收缩无感
        }, 420)
      } else {
        // 关→开：wash 先瞬间覆盖（无过渡，白底上无感）→ 底色白→绿与 wash 收缩**同步**
        washInstant.value = true
        wash.value = true
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            washInstant.value = false // 恢复过渡
            checked.value = true
            wash.value = false // 收缩（白色从四周向中间缩小消失，底色同步转绿）
          })
        })
      }
      emit('change', { detail: { value: next } })
      emit('update:modelValue', next)
    }

    return () => {
      const { class: cls, checked: _c, disabled, color, ...rest } = attrs as Record<string, unknown>
      const on = checked.value
      // translateX 21：thumb 28px 贴 track 内部右缘（left 1 + 21 + 28 = 50 = 内部右缘）——两端贴合无缝隙
      const tx = on ? 21 : 0
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
          // 白色扩散遮罩：滑轨内小圆（scale 扩散/收缩——方向区分；被 track overflow:hidden 裁剪在圆角内）
          h('span', {
            class: 'pws-wash',
            style: {
              transform: `translate(-50%, -50%) scale(${wash.value ? 2.6 : 0})`,
              opacity: wash.value ? 1 : 0,
              transition: washInstant.value ? 'none' : 'transform 0.4s ease, opacity 0.25s ease',
            },
          }),
          h('input', { ...rest, type: 'checkbox', checked: on, disabled: !!disabled, onChange }),
          // thumb 纯滑动
          h('span', { class: 'pws-thumb', style: { transform: `translateX(${tx}px)` } }),
        ],
      )
    }
  },
})
