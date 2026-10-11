// packages/built-in-components/src/components/icon.ts
// 小程序 <icon>：Web 模拟——经 **Keryx**（`@proteus-vue/icons`）渲染（★图标库方案 §8 P1 收口：
//   淘汰"手绘仿微信 SVG"第二套实现——此前硬编码 `#09BB07` 等字面 hex，违 CHARITES-001「零字面 hex」）。
//   · 几何 = Keryx 同一份 SVG path（三端同源，非手绘副本）；
//   · 着色 = **token**（`--sa-ok/warn/rec/info` + `currentColor`，非字面 hex）；
//   · API 兼容微信 `<icon type size color>`（type→Keryx 语义名，经别名表；color 覆盖）。
//
// 【与微信原生 icon 的诚实差异】微信 icon 是**彩色圆底 + 白色图形**（`success` 绿底白勾等）。
//   现用 Keryx 单色圆形 glyph（`Success=check-circle` 实心圆 + 白勾质感由字形承载）+ token 着色——
//   语义与尺寸对齐，视觉为 Keryx 统一体系（§8 P1「Web shim 与主组件同源同形」）。
import { defineComponent, h } from 'vue'
import { normalizedIcon } from '@proteus-vue/icons'

/** 微信 `<icon type>` → Keryx 语义名（主名或别名，规范 §6 别名表）。 */
const TYPE_TO_KERYX: Record<string, string> = {
  success: 'success', // → check-circle（别名）
  success_no_circle: 'success_no_circle', // → check（别名）
  info: 'info',
  warn: 'warn', // → warning（别名）
  waiting: 'waiting', // → schedule（别名）
  cancel: 'cancel', // 主名（circle + X）
  clear: 'clear', // → error（别名）
  search: 'search',
  download: 'download',
  upload: 'upload',
  share: 'share',
  like: 'favorite-filled', // ♥ 实心（Keryx favorite 的 filled 变体）
  dislike: 'favorite', // ♡ 空心（Keryx favorite 默认 = outline 心）
}

/** ★彩色状态图标的 **token 着色**（§6：状态彩色图标只允许 token 引用，禁止 hex）。
 *   微信彩色语义：success 绿 / info 蓝 / warn 黄 / cancel 红；waiting·clear 为灰（不在此表 → 继承 currentColor）。 */
const TYPE_COLOR_TOKEN: Record<string, string> = {
  success: 'var(--sa-ok)',
  success_no_circle: 'var(--sa-ok)',
  info: 'var(--sa-info)',
  warn: 'var(--sa-warn)',
  cancel: 'var(--sa-rec)',
}

export const WebIcon = defineComponent({
  name: 'ProteusWebIcon',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => {
      const { class: cls, type, size, color, ...rest } = attrs as Record<string, unknown>
      const t = String(type ?? '')
      const px = Number(size ?? 23)
      const keryxName = TYPE_TO_KERYX[t]
      // color 属性优先（微信语义：用户设 color → 覆盖）；否则彩色状态图标用 token；否则继承 currentColor
      const tint = color !== undefined && color !== '' ? String(color) : TYPE_COLOR_TOKEN[t] ?? 'currentColor'
      if (!keryxName) {
        return h(
          'span',
          { ...rest, class: ['proteus-web-icon', (cls as string) || ''], style: { width: `${px}px`, height: `${px}px`, display: 'inline-flex' } },
          [h('span', { class: 'pwi-unknown', style: { fontSize: `${px}px`, color: tint } }, '?')],
        )
      }
      const icon = normalizedIcon(keryxName)
      return h(
        'span',
        {
          ...rest,
          class: ['proteus-web-icon', (cls as string) || ''],
          style: { width: `${px}px`, height: `${px}px`, display: 'inline-flex', color: tint },
        },
        [h('svg', { viewBox: icon.viewBox ?? '0 0 24 24', width: px, height: px, fill: 'currentColor', 'aria-hidden': 'true' }, [h('path', { d: icon.d })])],
      )
    }
  },
})
