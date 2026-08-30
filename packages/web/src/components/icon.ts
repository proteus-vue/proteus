// packages/web/src/components/icon.ts
// 小程序 <icon>：Web 模拟——内联 SVG 对齐微信图标集（彩色圆底 + 白色图形）
// size 控制尺寸（默认 23 对齐微信）；color 控制**单色图标**颜色（对齐微信 icon color 属性——彩色图标固定色）
import { defineComponent, h } from 'vue'

/** 微信 icon type → SVG path 内容（viewBox 22；符号相对小 + 细描边，对齐微信——非均匀粗细近似用圆头） */
const ICON_SVG: Record<string, string> = {
  success:
    // ★毛笔对勾（对齐微信：起笔左下轻细 → 中间运笔粗 → 右上提笔变尖）——fill 闭合路径模拟两头细中间粗
    '<circle cx="11" cy="11" r="10" fill="#09BB07"/><path d="M7.4 11.2 L9.6 13.6 L14.4 9.2 L14.9 9.7 L10.4 14.2 L7.8 12 Z" fill="#fff"/>',
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

/** 图标主色（圆底 fill / 单色描边）——color 属性传入时统一替换（对齐微信：color 覆盖所有图标主色，白图形保持） */
const MAIN_COLORS = ['#09BB07', '#10AEFF', '#FFC300', '#F43530', '#FF5000', '#C9C9C9']

export const WebIcon = defineComponent({
  name: 'ProteusWebIcon',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => {
      const { class: cls, type, size, color, ...rest } = attrs as Record<string, unknown>
      const t = String(type ?? '')
      const svg = ICON_SVG[t]
      const px = Number(size ?? 23)
      const colorVal = color !== undefined && color !== '' ? String(color) : null
      let inner = svg
      if (svg && colorVal) {
        // ★color 覆盖主色（对齐微信：用户设 color → 图标主色变 color；白色图形保持）
        for (const c of MAIN_COLORS) {
          inner = inner.split(c).join(colorVal)
        }
      }
      return h(
        'span',
        {
          ...rest,
          class: ['proteus-web-icon', (cls as string) || ''],
          style: { width: `${px}px`, height: `${px}px` },
        },
        [
          svg
            ? h('svg', { viewBox: '0 0 22 22', width: px, height: px, innerHTML: inner })
            : h('span', { class: 'pwi-unknown', style: { fontSize: `${px}px`, color: (color as string) || '#c9c9c9' } }, '?'),
        ],
      )
    }
  },
})
