// packages/web/src/components/image.ts
// 小程序 <image>：Web 模拟：img + mode 映射（aspectFill→cover / widthFix→宽满高自适 / scaleToFill→fill）+ 懒加载
import { defineComponent, h } from 'vue'

/** 小程序 image mode → Web object-fit/尺寸 映射 */
function modeStyle(mode: string): Record<string, string> {
  switch (mode) {
    case 'aspectFit':
      return { objectFit: 'contain' }
    case 'aspectFill':
      return { objectFit: 'cover', width: '100%', height: '100%' }
    case 'widthFix':
      return { width: '100%', height: 'auto' }
    case 'top':
    case 'bottom':
    case 'center':
    case 'left':
    case 'right':
    case 'topLeft':
    case 'topRight':
    case 'bottomLeft':
    case 'bottomRight':
      return { objectFit: 'none', objectPosition: modeToPosition(mode) }
    case 'scaleToFill':
    default:
      return { objectFit: 'fill', width: '100%', height: '100%' }
  }
}

function modeToPosition(mode: string): string {
  const map: Record<string, string> = {
    top: 'top', bottom: 'bottom', center: 'center', left: 'left', right: 'right',
    topLeft: 'top left', topRight: 'top right', bottomLeft: 'bottom left', bottomRight: 'bottom right',
  }
  return map[mode] ?? 'center'
}

export const WebImage = defineComponent({
  name: 'ProteusWebImage',
  inheritAttrs: false,
  emits: ['load', 'error'],
  setup(_props, { attrs, emit }) {
    return () => {
      const { class: cls, mode, lazyLoad, src, alt, ...rest } = attrs as Record<string, unknown>
      const style = { ...((rest.style as Record<string, string>) ?? {}), ...modeStyle((mode as string) || 'scaleToFill') }
      return h('img', {
        ...rest,
        src: (src as string) || '',
        alt: (alt as string) || '',
        loading: lazyLoad ? 'lazy' : undefined,
        style,
        class: ['proteus-web-image', (cls as string) || ''],
        onLoad: (e: Event) => emit('load', e),
        onError: (e: Event) => emit('error', e),
      })
    }
  },
})
