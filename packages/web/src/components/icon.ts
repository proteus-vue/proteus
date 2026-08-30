// packages/web/src/components/icon.ts
// 小程序 <icon>：Web 模拟——内联 SVG 对齐微信图标集（彩色圆底 + 白色图形）
// size 控制尺寸（默认 23 对齐微信）；color 控制**单色图标**颜色（对齐微信 icon color 属性——彩色图标固定色）
import { defineComponent, h } from 'vue'

/** 微信 icon type → SVG path 内容（viewBox 22；符号相对小 + 细描边，对齐微信——非均匀粗细近似用圆头） */
const ICON_SVG: Record<string, string> = {
  success:
    '<circle cx="11" cy="11" r="10" fill="#09BB07"/><path d="M7.5 11.5 10 14.5l4.5-5.5" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  success_no_circle:
    '<path d="M6.5 11.5 9.5 14.5l6-7.5" stroke="#09BB07" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="11" cy="11" r="10" fill="#10AEFF"/><path d="M11 9.2v4.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/><circle cx="11" cy="7.4" r="0.7" fill="#fff"/>',
  warn: '<circle cx="11" cy="11" r="10" fill="#FFC300"/><path d="M11 7v4.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="15.2" r="0.9" fill="#fff"/>',
  waiting:
    '<circle cx="11" cy="11" r="10" fill="#C9C9C9"/><path d="M11 7v4.4l2.8 1.7" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  cancel: '<circle cx="11" cy="11" r="10" fill="#F43530"/><path d="M8 8l6 6M14 8l-6 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
  clear: '<circle cx="11" cy="11" r="10" fill="#C9C9C9"/><path d="M8 8l6 6M14 8l-6 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
  search:
    '<circle cx="10" cy="10" r="4.8" stroke="#C9C9C9" stroke-width="1.5" fill="none"/><path d="M13.8 13.8l3.8 3.8" stroke="#C9C9C9" stroke-width="1.5" stroke-linecap="round"/>',
  download:
    '<path d="M11 5.5v6.4M8.2 9.3l2.8 2.8 2.8-2.8" stroke="#C9C9C9" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 15.8h9" stroke="#C9C9C9" stroke-width="1.5" stroke-linecap="round"/>',
  upload:
    '<path d="M11 12.5V6.1M8.2 8.7 11 5.9l2.8 2.8" stroke="#C9C9C9" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 15.8h9" stroke="#C9C9C9" stroke-width="1.5" stroke-linecap="round"/>',
  share:
    '<path d="M11 5.5v5.2M8.2 8.5 11 5.7l2.8 2.8" stroke="#C9C9C9" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 11.5v4.8h9V11.5" stroke="#C9C9C9" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  like:
    '<path d="M11 16.8c-3.8-2.5-6-4.4-6-6.8a3 3 0 0 1 6-1.3A3 3 0 0 1 17 10c0 2.4-2.2 4.3-6 6.8z" fill="#FF5000"/>',
  dislike:
    '<path d="M11 16.8c-3.8-2.5-6-4.4-6-6.8a3 3 0 0 1 6-1.3A3 3 0 0 1 17 10c0 2.4-2.2 4.3-6 6.8z" stroke="#C9C9C9" stroke-width="1.5" fill="none"/>',
}

/** 单色图标（color 属性生效——对齐微信 icon color；彩色图标固定色） */
const MONO_ICONS = new Set(['waiting', 'clear', 'search', 'download', 'upload', 'share', 'dislike'])

export const WebIcon = defineComponent({
  name: 'ProteusWebIcon',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => {
      const { class: cls, type, size, color, ...rest } = attrs as Record<string, unknown>
      const t = String(type ?? '')
      const svg = ICON_SVG[t]
      const px = Number(size ?? 23)
      const colorVal = String(color ?? '#c9c9c9')
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
                // 单色图标：color 替换默认灰（对齐微信 icon color 属性）
                innerHTML: MONO_ICONS.has(t) ? svg.replace(/#C9C9C9/g, colorVal) : svg,
              })
            : h('span', { class: 'pwi-unknown', style: { fontSize: `${px}px`, color: colorVal } }, '?'),
        ],
      )
    }
  },
})
