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
      // ★微信布尔属性语义：show-info（无值）→ attrs['show-info'] = ''——存在即 true（显式 false 才关闭）；
      //   Vue attrs 用原始 kebab 键（attrs.showInfo undefined），需同时查两个键
      const showInfoRaw = (attrs as Record<string, unknown>)['show-info'] ?? showInfo
      const showInfoOn = showInfoRaw !== undefined && showInfoRaw !== false
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
          showInfoOn ? h('span', { class: 'pwp-info' }, `${p}%`) : null,
        ],
      )
    }
  },
})
