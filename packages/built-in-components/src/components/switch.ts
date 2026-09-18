// packages/web/src/components/switch.ts
// 小程序 <switch>：Web 模拟——★完全对齐 weui.io/#form_switch 官方（2026-08-30 CDP 实测）
// 官方实现：无 wash 白色扩散——轨道背景色 0.1s 直接切换（--weui-FG-3 ↔ --weui-BRAND）+ thumb 0.35s 回弹滑动
//   （wash 扩散是微信真机 iOS 行为，weui.io 网页版无——用户要求完全对齐官方 web）
// 载荷 { detail: { value } } 对齐微信
//
// ★2026-09-13 受控化 + 官方属性补齐（SOP v2 批次 1，对齐官方 <switch>）：
//   · `checked` 支持**受控**：外部传入即由外部驱动（p-switch 的 v-model 语义）；未传时保持内部状态
//     （不传 checked 的旧用法不变——向后兼容）。
//   · 新增 `type`（switch/checkbox 方角+勾选）；`color` 作用于打开态轨道（官方 color 语义）。
import { defineComponent, h, ref, watch } from 'vue'

export const WebSwitch = defineComponent({
  name: 'ProteusWebSwitch',
  inheritAttrs: false,
  props: {
    /** 受控开关态（外部传入即受控；不传 = 内部自管，向后兼容） */
    checked: { type: Boolean, default: undefined },
    disabled: { type: Boolean, default: false },
    /** 样式：switch（默认）/ checkbox（方角 + 勾选标记） */
    type: { type: String, default: 'switch' },
    /** 打开态颜色（缺省微信绿） */
    color: { type: String, default: '' },
  },
  emits: ['change', 'update:modelValue'],
  setup(props, { attrs, emit }) {
    // 受控判定：props 中显式出现 checked（含 false）即受控
    const isControlled = () => props.checked !== undefined
    const inner = ref(Boolean(props.checked))
    watch(
      () => props.checked,
      (v) => {
        if (v !== undefined) inner.value = Boolean(v)
      },
    )
    const on = () => (isControlled() ? Boolean(props.checked) : inner.value)

    const onChange = (e: Event) => {
      const next = (e.target as HTMLInputElement).checked
      if (!isControlled()) inner.value = next
      emit('change', { detail: { value: next } })
      emit('update:modelValue', next)
    }

    return () => {
      const { class: cls } = attrs as Record<string, unknown>
      const checked = on()
      const isCheckbox = props.type === 'checkbox'
      // translateX 21：thumb 28px 贴 track 内部右缘（left 1 + 21 + 28 = 50 = 内部右缘）——两端贴合无缝隙
      // （官方 padding 2px 方案等价位移 20px；我们 border 1px 方案保持 21px 视觉对齐）
      const tx = checked ? 21 : 0
      // ★开关态轨道色：官方 color 优先（打开态）；否则走 CSS 变量（--pwu-sw-*，浅/暗黑自动切换）。
      //   ★type=checkbox 渲染为勾选框形态（小方框+白勾）→ 颜色由 CSS 类控制，不设 inline 背景
      //   （inline style 优先级高于样式表，会盖掉 checkbox 的形态规则）。
      const trackBg = checked ? (props.color || 'var(--pwu-sw-track-on)') : 'var(--pwu-sw-track-off)'
      const trackBorder = checked ? (props.color || 'var(--pwu-sw-track-on)') : 'var(--pwu-sw-border-off)'
      return h(
        'div',
        {
          class: [
            'proteus-web-switch',
            checked ? 'is-on' : '',
            isCheckbox ? 'is-checkbox' : '',
            props.disabled ? 'is-disabled' : '',
            (cls as string) || '',
          ],
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-disabled': props.disabled ? 'true' : 'false',
          style: isCheckbox ? undefined : { backgroundColor: trackBg, borderColor: trackBorder },
        },
        [
          h('input', { type: 'checkbox', checked, disabled: props.disabled, onChange, tabindex: -1 }),
          // thumb 纯滑动（官方 .weui-switch::after：transition transform 0.35s cubic-bezier 回弹）
          h('span', { class: 'pws-thumb', style: { transform: `translateX(${tx}px)` } }),
        ],
      )
    }
  },
})
