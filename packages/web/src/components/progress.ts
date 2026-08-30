// packages/web/src/components/progress.ts
// 小程序 <progress>：Web 模拟——进度条（percent/color/showInfo/active 对齐）
import { defineComponent, h } from 'vue'

export const WebProgress = defineComponent({
  name: 'ProteusWebProgress',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => {
      const { class: cls, percent, color, showInfo, activeColor, strokeWidth, ...rest } = attrs as Record<string, unknown>
      const p = Math.max(0, Math.min(100, Number(percent ?? 0)))
      const barColor = String(activeColor ?? color ?? '#07c160')
      return h(
        'div',
        {
          ...rest,
          class: ['proteus-web-progress', (cls as string) || ''],
        },
        [
          h('div', { class: 'pwp-track', style: { height: `${Number(strokeWidth ?? 6)}px` } }, [
            h('div', { class: 'pwp-inner', style: { width: `${p}%`, backgroundColor: barColor } }),
          ]),
          showInfo ? h('span', { class: 'pwp-info' }, `${p}%`) : null,
        ],
      )
    }
  },
})
