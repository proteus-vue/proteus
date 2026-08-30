// packages/web/src/components/switch.ts
// 小程序 <switch>：Web 模拟——★完全对齐 weui.io/#form_switch 官方（2026-08-30 CDP 实测）
// 官方实现：无 wash 白色扩散——轨道背景色 0.1s 直接切换（--weui-FG-3 ↔ --weui-BRAND）+ thumb 0.35s 回弹滑动
//   （wash 扩散是微信真机 iOS 行为，weui.io 网页版无——用户要求完全对齐官方 web）
// 载荷 { detail: { value } } 对齐微信
import { defineComponent, h, ref } from 'vue'

export const WebSwitch = defineComponent({
  name: 'ProteusWebSwitch',
  inheritAttrs: false,
  emits: ['change', 'update:modelValue'],
  setup(_props, { attrs, emit }) {
    const checked = ref(Boolean((attrs as Record<string, unknown>).checked))

    const onChange = (e: Event) => {
      const next = (e.target as HTMLInputElement).checked
      checked.value = next
      emit('change', { detail: { value: next } })
      emit('update:modelValue', next)
    }

    return () => {
      const { class: cls, checked: _c, disabled, color, ...rest } = attrs as Record<string, unknown>
      const on = checked.value
      // translateX 21：thumb 28px 贴 track 内部右缘（left 1 + 21 + 28 = 50 = 内部右缘）——两端贴合无缝隙
      // （官方 padding 2px 方案等价位移 20px；我们 border 1px 方案保持 21px 视觉对齐）
      const tx = on ? 21 : 0
      // ★开关态轨道色走 CSS 变量（--pwu-sw-*：浅色白底灰边 / 暗黑 rgba(255,255,255,0.1)）——
      //   打开态微信绿（浅暗黑同值）；CSS 变量在运行时由 prefers-color-scheme 自动切换
      const trackBg = on ? 'var(--pwu-sw-track-on)' : 'var(--pwu-sw-track-off)'
      const trackBorder = on ? 'var(--pwu-sw-track-on)' : 'var(--pwu-sw-border-off)'
      return h(
        'div',
        {
          class: ['proteus-web-switch', on ? 'is-on' : '', (cls as string) || ''],
          style: {
            backgroundColor: trackBg,
            borderColor: trackBorder,
            accentColor: color ? String(color) : undefined,
          },
        },
        [
          h('input', { ...rest, type: 'checkbox', checked: on, disabled: !!disabled, onChange }),
          // thumb 纯滑动（官方 .weui-switch::after：transition transform 0.35s cubic-bezier 回弹）
          h('span', { class: 'pws-thumb', style: { transform: `translateX(${tx}px)` } }),
        ],
      )
    }
  },
})
