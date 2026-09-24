// packages/web/src/components/view.ts
// 小程序 <view>：块级容器。Web 模拟：div（透传 class/style/事件）
// ★按压反馈（hover-class）三要素对齐小程序：hover-start-time（按住多久出现）/ hover-stay-time（松开后保留）/
//   hover-stop-propagation（阻止祖先按压态）。★多词属性必须 kebab+camel 双读（父级写 :hover-class → attrs['hover-class']）。
import { defineComponent, h, ref, onUnmounted } from 'vue'

const pick = (a: Record<string, unknown>, camel: string, kebab: string) => a[camel] ?? a[kebab]

export const WebView = defineComponent({
  name: 'ProteusWebView',
  inheritAttrs: false,
  setup(_props, { slots, attrs }) {
    const pressed = ref(false)
    let startTimer: ReturnType<typeof setTimeout> | null = null
    let stayTimer: ReturnType<typeof setTimeout> | null = null
    const clearTimers = () => {
      if (startTimer) { clearTimeout(startTimer); startTimer = null }
      if (stayTimer) { clearTimeout(stayTimer); stayTimer = null }
    }
    onUnmounted(clearTimers)

    return () => {
      const a = attrs as Record<string, unknown>
      const { class: cls, ...rest } = a
      const hoverClass = pick(a, 'hoverClass', 'hover-class')
      const hoverStartTime = Number(pick(a, 'hoverStartTime', 'hover-start-time') ?? 50)
      const hoverStayTime = Number(pick(a, 'hoverStayTime', 'hover-stay-time') ?? 400)
      const hoverStop = pick(a, 'hoverStopPropagation', 'hover-stop-propagation')
      // 消费掉的按压属性不再透传为 DOM 属性（kebab/camel 两态都清）
      delete rest.hoverClass; delete rest['hover-class']
      delete rest.hoverStartTime; delete rest['hover-start-time']
      delete rest.hoverStayTime; delete rest['hover-stay-time']
      delete rest.hoverStopPropagation; delete rest['hover-stop-propagation']

      const active = typeof hoverClass === 'string' && hoverClass !== '' && hoverClass !== 'none'
      const handlers: Record<string, unknown> = {}
      // ★跨端事件归一：`@tap` 必须在 Web 端等价于点击（2026-09-24 实测缺陷）
      //   小程序 `<view>` 的原生事件是 `tap`（`bind:tap`），框架把它列为跨端事件
      //   （compiler/tags.ts 的 REAL_NATIVE 事件表）；但 Web 端此前**没有任何 tap→click 归一**
      //   → 组件里写 `@tap="onTap"`（p-mask / p-popup 等弹层）的 Web 行为**静默失效**：
      //   `onTap` 作为未知属性透传到 div，DOM 不认识 `tap`，永不触发（实测：点遮罩不关闭）。
      //   修在此处（Web 模拟层的唯一入口）：把 `tap` 监听原样接到 click 上——原生 tap 与
      //   现代浏览器的 click 语义等价（移动端 300ms 延迟已移除）。
      //   ★只做转发不改语义：`@click` 与 `@tap` 各自独立挂载，两者同时写会各触发一次（与 MP 端一致）。
      if (typeof rest.onTap === 'function') {
        const tapHandler = rest.onTap
        const clickHandler = rest.onClick // ★两者同写时串联（handlers 展开在后，直接赋值会吃掉 onClick）
        handlers.onClick =
          typeof clickHandler === 'function'
            ? (e: Event) => {
                ;(clickHandler as (e: Event) => void)(e)
                ;(tapHandler as (e: Event) => void)(e)
              }
            : tapHandler
        delete rest.onTap
      }
      delete rest['on-tap']
      if (active) {
        handlers.onPointerdown = (e: Event) => {
          if (hoverStop) e.stopPropagation()
          if (stayTimer) { clearTimeout(stayTimer); stayTimer = null }
          if (pressed.value) return
          if (hoverStartTime <= 0) { pressed.value = true; return }
          if (startTimer) clearTimeout(startTimer)
          startTimer = setTimeout(() => { pressed.value = true }, hoverStartTime)
        }
        const release = () => {
          if (startTimer) { clearTimeout(startTimer); startTimer = null }
          if (!pressed.value) return
          if (hoverStayTime <= 0) { pressed.value = false; return }
          if (stayTimer) clearTimeout(stayTimer)
          stayTimer = setTimeout(() => { pressed.value = false }, hoverStayTime)
        }
        handlers.onPointerup = release
        handlers.onPointerleave = release
        handlers.onPointercancel = release
      }
      return h(
        'div',
        {
          ...rest,
          ...handlers,
          class: ['proteus-web-view', pressed.value && active ? (hoverClass as string) : '', (cls as string) || ''],
        },
        slots.default?.(),
      )
    }
  },
})
