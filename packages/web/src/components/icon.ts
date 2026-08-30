// packages/web/src/components/icon.ts
// 小程序 <icon>：Web 模拟——内联 SVG 对齐微信图标集（彩色圆底 + 白色图形，非字符简化）
// size 控制尺寸（默认 23 对齐微信）；color 仅单色图标生效
import { defineComponent, h } from 'vue'

/** 微信 icon type → SVG path 内容（viewBox 22，圆底彩色 + 白图形对齐微信样式） */
const ICON_SVG: Record<string, string> = {
  success: '<circle cx="11" cy="11" r="10" fill="#09BB07"/><path d="M6.5 11.5 10 15l5.5-6.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  success_no_circle: '<path d="M5.5 11.5 9.5 15.5l7-8.5" stroke="#09BB07" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="11" cy="11" r="10" fill="#10AEFF"/><path d="M11 9.2h.01M11 11v4.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  warn: '<circle cx="11" cy="11" r="10" fill="#FFC300"/><path d="M11 6.5v6" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="16" r="1.1" fill="#fff"/>',
  waiting: '<circle cx="11" cy="11" r="10" fill="#C9C9C9"/><path d="M11 6.5V11l3.5 2" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>',
  cancel: '<circle cx="11" cy="11" r="10" fill="#F43530"/><path d="M7.5 7.5l7 7M14.5 7.5l-7 7" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  clear: '<circle cx="11" cy="11" r="10" fill="#C9C9C9"/><path d="M7.5 7.5l7 7M14.5 7.5l-7 7" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  search: '<circle cx="10" cy="10" r="5.5" stroke="#C9C9C9" stroke-width="1.8" fill="none"/><path d="M14.2 14.2l4 4" stroke="#C9C9C9" stroke-width="1.8" stroke-linecap="round"/>',
  download: '<path d="M11 4.5v8M7.5 9l3.5 3.5L14.5 9" stroke="#C9C9C9" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 17h11" stroke="#C9C9C9" stroke-width="1.8" stroke-linecap="round"/>',
  upload: '<path d="M11 12.5v-8M7.5 8 11 4.5 14.5 8" stroke="#C9C9C9" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 17h11" stroke="#C9C9C9" stroke-width="1.8" stroke-linecap="round"/>',
  share: '<path d="M11 5v6M7.5 8 11 4.5 14.5 8" stroke="#C9C9C9" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 12v5.5h11V12" stroke="#C9C9C9" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  like: '<path d="M11 18c-4.5-3-7-5.2-7-8a3.5 3.5 0 0 1 7-1.5A3.5 3.5 0 0 1 18 10c0 2.8-2.5 5-7 8z" fill="#FF5000"/>',
  dislike: '<path d="M11 18c-4.5-3-7-5.2-7-8a3.5 3.5 0 0 1 7-1.5A3.5 3.5 0 0 1 18 10c0 2.8-2.5 5-7 8z" stroke="#C9C9C9" stroke-width="1.6" fill="none"/>',
}

export const WebIcon = defineComponent({
  name: 'ProteusWebIcon',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => {
      const { class: cls, type, size, color, ...rest } = attrs as Record<string, unknown>
      const t = String(type ?? '')
      const svg = ICON_SVG[t]
      const px = Number(size ?? 23)
      return h(
        'span',
        {
          ...rest,
          class: ['proteus-web-icon', (cls as string) || ''],
          style: { width: `${px}px`, height: `${px}px` },
        },
        [
          svg
            ? h('svg', {
                viewBox: '0 0 22 22',
                width: px,
                height: px,
                innerHTML: svg,
              })
            : h('span', { class: 'pwi-unknown', style: { fontSize: `${px}px`, color: (color as string) || '#c9c9c9' } }, '?'),
        ],
      )
    }
  },
})
