// packages/web/src/components/icon.ts
// 小程序 <icon>：Web 模拟——微信 icon 类型 → 字符/emoji 简化（MVP；size/color 属性对齐）
import { defineComponent, h } from 'vue'

/** 微信 icon type → 展示字符（MVP 简化；后续可升级 SVG 图标集） */
const ICON_GLYPH: Record<string, string> = {
  success: '✓',
  success_no_circle: '✓',
  info: 'ℹ',
  warn: '⚠',
  waiting: '…',
  cancel: '✕',
  clear: '✕',
  search: '⌕',
  download: '↓',
  upload: '↑',
  share: '↗',
  like: '♡',
  dislike: '♠',
}

export const WebIcon = defineComponent({
  name: 'ProteusWebIcon',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => {
      const { class: cls, type, size, color, ...rest } = attrs as Record<string, unknown>
      return h(
        'span',
        {
          ...rest,
          class: ['proteus-web-icon', (cls as string) || ''],
          style: {
            fontSize: `${Number(size ?? 23)}px`,
            lineHeight: '1',
            color: (color as string) || '#000000',
          },
        },
        ICON_GLYPH[String(type ?? '')] ?? '?',
      )
    }
  },
})
