// packages/web/src/components/scroll-view.ts
// 小程序 <scroll-view>：Web 模拟——overflow 滚动容器（scroll-y/x）+ scroll/scrolltolower 事件载荷对齐小程序
// ★多词属性一律 kebab+camel 双读（:scroll-y → attrs['scroll-y']，只读 scrollY 会永远 undefined → 不滚动）
// ★scroll-top/scroll-left 受控：属性变化时才写 DOM（对齐小程序；避免每次渲染重置滚动位置）
import { defineComponent, h, ref, onMounted, onUpdated } from 'vue'

const pick = (a: Record<string, unknown>, camel: string, kebab: string) => a[camel] ?? a[kebab]

export const WebScrollView = defineComponent({
  name: 'ProteusWebScrollView',
  inheritAttrs: false,
  emits: ['scroll', 'scrolltoupper', 'scrolltolower', 'refresherrefresh', 'refresherpulling', 'refresherrestore', 'refresherabort', 'dragstart', 'dragging', 'dragend', 'scrollstart', 'scrollend'],
  setup(_props, { slots, attrs, emit }) {
    const el = ref<HTMLElement | null>(null)
    let appliedTop: unknown = undefined
    let appliedLeft: unknown = undefined

    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement
      // ★裸载荷（框架约定）：{ scrollTop, scrollLeft, scrollHeight, scrollWidth }
      emit('scroll', { scrollTop: t.scrollTop, scrollLeft: t.scrollLeft, scrollHeight: t.scrollHeight, scrollWidth: t.scrollWidth })
      const upper = Number(pick(attrs as Record<string, unknown>, 'upperThreshold', 'upper-threshold') ?? 50)
      const lower = Number(pick(attrs as Record<string, unknown>, 'lowerThreshold', 'lower-threshold') ?? 50)
      if (t.scrollTop <= upper) emit('scrolltoupper', { scrollTop: t.scrollTop })
      if (t.scrollTop + t.clientHeight >= t.scrollHeight - lower) emit('scrolltolower', { scrollTop: t.scrollTop })
    }

    /** 受控滚动位置：仅在传入值变化时写 DOM（避免每次渲染把用户滚动拉回） */
    const syncPosition = () => {
      const node = el.value
      if (!node) return
      const a = attrs as Record<string, unknown>
      const top = pick(a, 'scrollTop', 'scroll-top')
      const left = pick(a, 'scrollLeft', 'scroll-left')
      if (top !== undefined && top !== null && top !== '' && top !== appliedTop) {
        appliedTop = top
        node.scrollTop = Number(top) || 0
      }
      if (left !== undefined && left !== null && left !== '' && left !== appliedLeft) {
        appliedLeft = left
        node.scrollLeft = Number(left) || 0
      }
    }
    onMounted(syncPosition)
    onUpdated(syncPosition)

    return () => {
      const a = attrs as Record<string, unknown>
      const { class: cls, ...rest } = a
      const scrollY = pick(a, 'scrollY', 'scroll-y')
      const scrollX = pick(a, 'scrollX', 'scroll-x')
      // 消费掉的属性不透传为 DOM 属性
      for (const k of ['scrollY', 'scroll-y', 'scrollX', 'scroll-x', 'scrollTop', 'scroll-top', 'scrollLeft', 'scroll-left', 'upperThreshold', 'upper-threshold', 'lowerThreshold', 'lower-threshold']) delete rest[k]
      const style: Record<string, string> = {
        ...((rest.style as Record<string, string>) ?? {}),
        overflowY: scrollY === true || scrollY === '' ? 'auto' : 'visible',
        overflowX: scrollX === true || scrollX === '' ? 'auto' : 'hidden',
        WebkitOverflowScrolling: 'touch',
      }
      return h(
        'div',
        {
          ...rest,
          ref: el,
          style,
          class: ['proteus-web-scroll-view', (cls as string) || ''],
          onScroll,
        },
        slots.default?.(),
      )
    }
  },
})
