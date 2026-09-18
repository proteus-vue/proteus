// packages/web/src/components/progress.ts
// 小程序 <progress>：Web 模拟——进度条（percent/color/showInfo/active 对齐）
// ★属性对齐官方：percent/show-info/border-radius/font-size/stroke-width/color/active/active-mode/duration
import { defineComponent, h } from 'vue'

/** attrs 读取（kebab/camel 双向） */
function pick(obj: Record<string, unknown>, camel: string): unknown {
  const kebab = camel.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
  return obj[camel] ?? obj[kebab]
}

export const WebProgress = defineComponent({
  name: 'ProteusWebProgress',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => {
      const { class: cls, percent, color, showInfo, activeColor, strokeWidth, fontSize, duration, active, ...rest } = attrs as Record<string, unknown>
      const p = Math.max(0, Math.min(100, Number(percent ?? 0)))
      const barColor = String(activeColor ?? color ?? '#07c160')
      const stroke = Number(strokeWidth ?? 6)
      const radius = pick(attrs, 'borderRadius')
      // ★微信布尔属性语义：show-info（无值）→ attrs['show-info'] = ''——存在即 true（显式 false 才关闭）；
      //   Vue attrs 用原始 kebab 键（attrs.showInfo undefined），需同时查两个键
      const showInfoRaw = pick(attrs, 'showInfo') ?? showInfo
      const showInfoOn = showInfoRaw !== undefined && showInfoRaw !== false
      const activeOn = !!(pick(attrs, 'active') ?? active)
      const durMs = Number(pick(attrs, 'duration') ?? duration ?? 0)
      return h(
        'div',
        {
          ...rest,
          class: ['proteus-web-progress', activeOn ? 'is-active' : '', (cls as string) || ''],
        },
        [
          h(
            'div',
            { class: 'pwp-track', style: { height: `${stroke}px`, borderRadius: radius != null ? radius + 'px' : `${stroke / 2}px` } },
            [
              h('div', {
                class: 'pwp-inner',
                style: {
                  width: `${p}%`,
                  backgroundColor: barColor,
                  borderRadius: radius != null ? radius + 'px' : `${stroke / 2}px`,
                  transition: `width ${durMs > 0 ? durMs + 'ms' : '300ms'} ease`,
                },
              }),
            ],
          ),
          showInfoOn ? h('span', { class: 'pwp-info', style: { fontSize: `${Number(fontSize ?? 12)}px` } }, `${p}%`) : null,
        ],
      )
    }
  },
})
