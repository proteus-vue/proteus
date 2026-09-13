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
    // ★多词属性名兼容（2026-09-13 真 bug）：WebButton 未声明 props（inheritAttrs:false），
    //   父级（p-button SFC）写 `:open-type` / `:hover-class` 时，Vue 对**未声明**的 prop 保留
    //   模板里的**原始 kebab 键**（attrs['open-type']），而 camelCase（attrs.openType）为 undefined
    //   → open-type 与 hover-class 在 Web 端**静默失效**（单字属性 type/size/disabled 不受影响）。
    //   统一按 camel 优先、kebab 回退取值（onClick 与 render 共用）。
    const pick = (camel: string): unknown => {
      const kebab = camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      return (attrs as Record<string, unknown>)[camel] ?? (attrs as Record<string, unknown>)[kebab]
    }
    const onClick = (e: Event) => {
      const openType = pick('openType') as string | undefined
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
      // 单字属性直接解构（`:type` → attrs.type，无 kebab 歧义）；多词的 open-type/hover-class 用 pick
      const { class: cls, type, size, disabled, loading, plain, ...rest } = attrs as Record<string, unknown>
      const hoverClass = pick('hoverClass') as string | undefined
      // ★布尔属性三态：true/'true'/'（小程序无值属性空串）→ 启用；false/undefined → 不启用。
      //   ★2026-09-07 e2e 弹层复测抓到：p-button 显式 :disabled=false/:loading=false 传 Vue 组件 attrs=false，
      //   旧 `!== undefined` 判定把 false 当「存在」→ Web 端全部按钮 disabled+loading（点不动）——改显式真值判定
      const boolOn = (v: unknown): boolean => v === true || v === '' || v === 'true'
      const isDisabled = boolOn(disabled)
      const isLoading = boolOn(loading)
      const isPlain = boolOn(plain)
      // ★按下态类（2026-09-13 真 bug 修复）：Web 端**框架默认按下类必须始终存在**
      //   （`.proteus-web-button--hover` 是框架叠加层样式的唯一挂载点）。
      //   此前把父级 hover-class 直接当按下类 → p-button 传 `p-button--hover`（MP 侧的类名）
      //   覆盖了框架默认类 → Web 端按下样式完全不匹配、无反馈。
      //   现：框架默认类恒在；父级自定义 hover-class（非 'none'、非框架类本身）作为**附加类**。
      const customHover = typeof hoverClass === 'string' && hoverClass && hoverClass !== 'none' && hoverClass !== 'proteus-web-button--hover'
        ? hoverClass
        : ''
      const hoverOff = hoverClass === 'none'
      const hoverCls = hoverOff ? '' : ['proteus-web-button--hover', customHover].filter(Boolean).join(' ')
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
