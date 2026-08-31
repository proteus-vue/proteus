// packages/web/src/components/button.ts
// 小程序 <button>：Web 模拟：原生 button + open-type 开放能力降级（触发 openxxx 事件）
//   + hover-class 按下反馈（对齐微信 button 默认 button-hover：按下背景变暗 rgba(0,0,0,0.1)）
//   + type（default/primary/warn）/ size（default/mini）/ disabled / loading / plain 变体（对齐微信原生 + weui-btn 视觉）
import { defineComponent, h, ref } from 'vue'
import { OPEN_TYPE_EVENTS } from '../open-type'

export const WebButton = defineComponent({
  name: 'ProteusWebButton',
  inheritAttrs: false,
  emits: ['click', ...Object.values(OPEN_TYPE_EVENTS)],
  setup(_props, { slots, attrs, emit }) {
    const hovered = ref(false)
    const onClick = (e: Event) => {
      const openType = (attrs as Record<string, unknown>).openType as string | undefined
      if (openType && OPEN_TYPE_EVENTS[openType]) {
        const eventName = OPEN_TYPE_EVENTS[openType]
        // ★开放能力降级（反黑盒）：小程序为原生开放能力，Web 无微信对等 → 触发自定义事件由开发者处理
        console.info(
          `[proteus-web] <button open-type="${openType}"> 在小程序为原生开放能力（${openType}），Web 端无微信对等——已触发事件 "${eventName}"，请自定义处理（如分享用 navigator.share）`,
        )
        emit(eventName, e)
      }
      emit('click', e)
    }
    return () => {
      const { class: cls, openType, hoverClass, type, size, disabled, loading, plain, ...rest } = attrs as Record<string, unknown>
      // ★布尔属性：小程序无值属性在 attrs 是空字符串（falsy）——用 !== undefined 判断存在性
      const isDisabled = disabled !== undefined
      const isLoading = loading !== undefined
      const isPlain = plain !== undefined
      // hover-class：小程序按下加类（默认 button-hover 背景变暗）；Web 用 pointer 事件切换
      const hoverCls = (hoverClass as string) || 'proteus-web-button--hover'
      // ★变体类（对齐微信原生 button + weui-btn 视觉）：type/size/disabled/loading/plain
      const typeCls = type === 'primary' ? 'is-primary' : type === 'warn' ? 'is-warn' : 'is-default'
      const sizeCls = size === 'mini' ? 'is-mini' : ''
      const stateCls = [isDisabled ? 'is-disabled' : '', isLoading ? 'is-loading' : '', isPlain ? 'is-plain' : '']
      const handlers: Record<string, unknown> = {
        onClick,
        onPointerdown: () => (hovered.value = true),
        onPointerup: () => (hovered.value = false),
        onPointerleave: () => (hovered.value = false),
      }
      return h(
        'button',
        {
          ...rest,
          ...handlers,
          disabled: isDisabled ? true : undefined,
          class: ['proteus-web-button', typeCls, sizeCls, ...stateCls, hovered.value ? hoverCls : '', (cls as string) || ''],
        },
        [
          // loading spinner（对齐 weui-btn_loading：白/灰圆环旋转）
          isLoading ? h('span', { class: 'pwb-loading' }) : null,
          slots.default?.(),
        ],
      )
    }
  },
})
