// packages/web/src/components/scroll-view.ts
// 小程序 <scroll-view>：Web 模拟——overflow 滚动容器（scroll-y/x）+ scroll/scrolltolower 事件载荷对齐小程序
import { defineComponent, h } from 'vue'

export const WebScrollView = defineComponent({
  name: 'ProteusWebScrollView',
  inheritAttrs: false,
  emits: ['scroll', 'scrolltoupper', 'scrolltolower', 'refresherrefresh'],
  setup(_props, { slots, attrs, emit }) {
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement
      // ★载荷对齐小程序 bindscroll：detail.scrollTop/scrollLeft/scrollHeight
      emit('scroll', { detail: { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, scrollHeight: el.scrollHeight } })
      // 触底（lower-threshold 默认 50，对齐页面 onReachBottom 语义）
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
        emit('scrolltolower', { detail: {} })
      }
    }
    return () => {
      const { class: cls, scrollY, scrollX, lowerThreshold, ...rest } = attrs as Record<string, unknown>
      // 对齐小程序：scroll-y 显式 true 才滚动（默认不滚）；scroll-x 同理
      const style: Record<string, string> = {
        overflowY: scrollY === true ? 'auto' : 'visible',
        overflowX: scrollX === true ? 'auto' : 'hidden',
        WebkitOverflowScrolling: 'touch',
      }
      return h(
        'div',
        {
          ...rest,
          style: { ...((rest.style as Record<string, string>) ?? {}), ...style },
          class: ['proteus-web-scroll-view', (cls as string) || ''],
          onScroll,
        },
        slots.default?.(),
      )
    }
  },
})
