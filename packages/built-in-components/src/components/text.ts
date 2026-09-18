// packages/web/src/components/text.ts
// 小程序 <text>：行内文本。Web 模拟：span（selectable/user-select → user-select；overflow/max-lines → CSS）
// ★多词属性 kebab+camel 双读（父级 :user-select → attrs['user-select']）。
import { defineComponent, h } from 'vue'

const pick = (a: Record<string, unknown>, camel: string, kebab: string) => a[camel] ?? a[kebab]

export const WebText = defineComponent({
  name: 'ProteusWebText',
  inheritAttrs: false,
  setup(_props, { slots, attrs }) {
    return () => {
      const a = attrs as Record<string, unknown>
      const { class: cls, ...rest } = a
      const selectable = pick(a, 'selectable', 'selectable')
      const userSelect = pick(a, 'userSelect', 'user-select')
      const overflow = pick(a, 'overflow', 'overflow')
      const maxLines = pick(a, 'maxLines', 'max-lines')
      const style: Record<string, string | number> = {}
      if (selectable || userSelect) {
        style.userSelect = 'text'
        style.webkitUserSelect = 'text'
      }
      const lines = Number(maxLines) || 0
      if (lines > 0) {
        style.display = '-webkit-box'
        style.WebkitBoxOrient = 'vertical'
        style.WebkitLineClamp = lines
        style.overflow = 'hidden'
      } else if (overflow === 'ellipsis') {
        style.overflow = 'hidden'
        style.whiteSpace = 'nowrap'
        style.textOverflow = 'ellipsis'
      } else if (overflow === 'clip') {
        style.overflow = 'hidden'
      }
      for (const k of ['selectable', 'userSelect', 'user-select', 'overflow', 'maxLines', 'max-lines', 'selectOnGesture', 'select-on-gesture', 'space', 'decode']) delete rest[k]
      return h(
        'span',
        {
          ...rest,
          style: { ...((rest.style as Record<string, string>) ?? {}), ...style },
          class: ['proteus-web-text', (cls as string) || ''],
        },
        slots.default?.(),
      )
    }
  },
})
