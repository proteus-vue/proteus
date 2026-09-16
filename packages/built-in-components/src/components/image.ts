// packages/web/src/components/image.ts
// 小程序 <image>：Web 模拟：img + mode 映射（aspectFill→cover / widthFix→宽满高自适 / scaleToFill→fill）+ 懒加载
// ★show-menu-by-longpress（官方属性）：Web 无系统菜单 → 用「长按（600ms）/右键」弹出自绘菜单（保存图片 / 新标签打开），
//   对齐官方语义（长按图片出菜单）。多词属性一律 kebab+camel 双读。
import { defineComponent, h, ref, onUnmounted } from 'vue'

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

const pick = (a: Record<string, unknown>, camel: string, kebab: string) => a[camel] ?? a[kebab]

export const WebImage = defineComponent({
  name: 'ProteusWebImage',
  inheritAttrs: false,
  emits: ['load', 'error', 'menu'],
  setup(_props, { attrs, emit }) {
    const menuOpen = ref(false)
    let pressTimer: ReturnType<typeof setTimeout> | null = null
    const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null } }
    onUnmounted(clearPress)

    const closeMenu = () => { menuOpen.value = false }

    return () => {
      const a = attrs as Record<string, unknown>
      const { class: cls, ...rest } = a
      const mode = pick(a, 'mode', 'mode')
      const lazyLoad = pick(a, 'lazyLoad', 'lazy-load')
      const byLongpress = pick(a, 'showMenuByLongpress', 'show-menu-by-longpress')
      const { src, alt } = a as { src?: string; alt?: string }
      const style = { ...((rest.style as Record<string, string>) ?? {}), ...modeStyle((mode as string) || 'scaleToFill') }
      for (const k of ['showMenuByLongpress', 'show-menu-by-longpress', 'lazyLoad', 'lazy-load', 'mode', 'src', 'alt']) delete rest[k]

      const handlers: Record<string, unknown> = {}
      if (byLongpress) {
        handlers.onPointerdown = () => { clearPress(); pressTimer = setTimeout(() => { menuOpen.value = true; emit('menu', { src }) }, 600) }
        handlers.onPointerup = clearPress
        handlers.onPointerleave = clearPress
        // 桌面右键：阻止浏览器默认菜单，弹自绘菜单（对齐长按语义）
        handlers.onContextmenu = (e: Event) => { e.preventDefault(); menuOpen.value = true; emit('menu', { src }) }
      }

      const img = h('img', {
        ...rest,
        ...handlers,
        src: (src as string) || '',
        alt: (alt as string) || '',
        loading: lazyLoad ? 'lazy' : undefined,
        style,
        class: ['proteus-web-image', (cls as string) || ''],
        onLoad: (e: Event) => emit('load', e),
        onError: (e: Event) => emit('error', e),
      })

      if (!byLongpress) return img

      // 长按菜单（自绘；点击遮罩关闭）
      const menu = menuOpen.value
        ? h('div', { class: 'proteus-web-image-menu-mask', onClick: closeMenu }, [
            h('div', { class: 'proteus-web-image-menu', onClick: (e: Event) => e.stopPropagation() }, [
              h('a', {
                class: 'proteus-web-image-menu-item',
                href: (src as string) || '',
                download: 'image',
                target: '_blank',
                rel: 'noopener',
                onClick: closeMenu,
              }, '保存图片'),
              h('a', {
                class: 'proteus-web-image-menu-item',
                href: (src as string) || '',
                target: '_blank',
                rel: 'noopener',
                onClick: closeMenu,
              }, '新标签打开'),
            ]),
          ])
        : null

      return h('span', { class: 'proteus-web-image-wrap', style: { position: 'relative', display: 'inline-block' } }, [img, menu])
    }
  },
})
