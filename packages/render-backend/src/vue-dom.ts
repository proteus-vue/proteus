// packages/render-backend/src/vue-dom.ts
// ★G-27 B2：VueDomBackend——DOM nodeOps 映射（Web 端官方后端原型）
//   验证「Vue 生态零成本复用」：本接口与 Vue nodeOps 同构，createRenderer 可直接桥接（B5 后接）
//   事件归一化：onXxx prop → addEventListener('xxx')（对齐 MP 语义：click → tap 映射由上层负责）
//   注入 documentLike（测试传 fake/happy-dom；运行时用全局 document）
import type { BackendCapabilities, IRNode, NodeHandle, ProteusRenderBackend } from './spi'

interface DocumentLike {
  createElement(tag: string): HTMLElement
}

function defaultDocument(): DocumentLike {
  const g = globalThis as { document?: Document }
  if (g.document && typeof g.document.createElement === 'function') {
    return g.document
  }
  throw new Error('VueDomBackend: 无 document 环境（SSR/Node——请注入 documentLike 或改用 HeadlessBackend）')
}

const VUE_DOM_CAPABILITIES: BackendCapabilities = {
  layout: 'native', // 浏览器原生布局
  glass: 'L1', // backdrop-filter（基础玻璃）
  blur: 'approximate',
  animation: 'js',
  textureSharing: false,
  remoteRendering: false,
  ssr: false,
  input: ['touch', 'cursor'],
}

/** ★G-31：semantic 语义 → Web 元素 + 语义类（Backend 消费 semantic 而非 tag——布局语义映射） */
const SEMANTIC_WEB_MAP: Record<string, { tag: string; className?: string }> = {
  'layout.box': { tag: 'div', className: 'proteus-box' },
  'layout.stack': { tag: 'div', className: 'proteus-stack' },
  'layout.grid': { tag: 'div', className: 'proteus-grid' },
  'layout.fluid': { tag: 'div', className: 'proteus-fluid' },
  'layout.adaptive': { tag: 'div', className: 'proteus-adaptive' },
  'layout.fit': { tag: 'div', className: 'proteus-fit' },
  'layout.split': { tag: 'div', className: 'proteus-split' },
  'layout.safe': { tag: 'div', className: 'proteus-safe' },
  'layout.sidebar': { tag: 'div', className: 'proteus-sidebar' },
  'ui.text': { tag: 'span' },
  'ui.button': { tag: 'button' },
  'ui.image': { tag: 'img' },
  'ui.input': { tag: 'input' },
  'ui.list': { tag: 'div', className: 'proteus-list' },
  'ui.nav': { tag: 'nav' },
  // ★G-31 B5：能力入口（G-28 组件化）——Web 端用标准元素承载，能力实现由 useNative 注入
  'capability.scan-qr': { tag: 'button', className: 'proteus-scan-qr' },
  'capability.pick-photo': { tag: 'input', className: 'proteus-pick-photo' },
  'capability.location': { tag: 'button', className: 'proteus-location' },
  // ★G-32 B1：新增 implemented 语义（与 component-ir SEMANTIC_BACKEND_MAP vue-dom 列同源）
  'layout.inline': { tag: 'div', className: 'proteus-inline' },
  'layout.spacer': { tag: 'div', className: 'proteus-spacer' },
  'layout.divider': { tag: 'hr', className: 'proteus-divider' },
  'layout.scroll': { tag: 'div', className: 'proteus-scroll' },
  'layout.virtual-list': { tag: 'div', className: 'proteus-virtual-list' },
  'layout.masonry': { tag: 'div', className: 'proteus-masonry' },
  'ui.heading': { tag: 'div', className: 'proteus-heading' },
  'ui.icon': { tag: 'span', className: 'proteus-icon' },
  'ui.textarea': { tag: 'textarea' },
  'ui.switch': { tag: 'div', className: 'proteus-switch' },
  'ui.slider': { tag: 'div', className: 'proteus-slider' },
  'shell.nav': { tag: 'nav', className: 'proteus-nav' },
  'shell.tabbar': { tag: 'nav', className: 'proteus-tabbar' },
  'shell.drawer': { tag: 'aside', className: 'proteus-drawer' },
  'shell.modal': { tag: 'div', className: 'proteus-modal' },
}

export function createVueDomBackend(doc?: DocumentLike): ProteusRenderBackend {
  const documentLike = doc ?? defaultDocument()

  function ensureEl(handle: NodeHandle): HTMLElement {
    const el = handle as HTMLElement
    if (!el || typeof el.tagName !== 'string') throw new Error('VueDomBackend: 非法句柄')
    return el
  }

  return {
    id: 'vue-dom',
    version: '0.1.0',
    capabilities: VUE_DOM_CAPABILITIES,

    createElement(node: IRNode): NodeHandle {
      // ★G-31：有 semantic → 按语义映射元素（proteus-* 语义类）；否则按 type（兼容层/原样）
      if (node.semantic) {
        const mapped = SEMANTIC_WEB_MAP[node.semantic]
        if (mapped) {
          const el = documentLike.createElement(mapped.tag)
          if (mapped.className) el.setAttribute('class', mapped.className)
          return el
        }
      }
      return documentLike.createElement(node.type)
    },

    insert(child, parent, anchor) {
      const c = ensureEl(child)
      const p = ensureEl(parent)
      if (anchor) {
        const a = ensureEl(anchor)
        if (a.parentNode === p) {
          p.insertBefore(c, a)
          return
        }
      }
      p.appendChild(c)
    },

    remove(child) {
      const c = ensureEl(child)
      if (c.parentNode) c.parentNode.removeChild(c)
    },

    patchProp(el, key, prev, next) {
      const target = ensureEl(el)
      // 事件：onXxx → addEventListener('xxx' 小写去 on)
      if (key.startsWith('on') && key.length > 2) {
        const eventName = key.slice(2).toLowerCase()
        if (typeof next === 'function') {
          if (prev !== next) target.addEventListener(eventName, next as EventListener)
        } else {
          target.removeEventListener(eventName, prev as EventListener)
        }
        return
      }
      // style 对象
      if (key === 'style' && next && typeof next === 'object') {
        const style = next as Record<string, string>
        for (const k of Object.keys(style)) {
          ;(target.style as unknown as Record<string, string>)[k] = style[k]
        }
        return
      }
      if (next === null || next === undefined) {
        target.removeAttribute(key)
      } else {
        target.setAttribute(key, String(next))
      }
    },

    setText(el, text) {
      ensureEl(el).textContent = text
    },

    measure(node, constraints) {
      // Web 端布局由浏览器负责（layout: 'native'）——measure 为 DOM 尺寸读取
      const el = ensureEl(node)
      const w = constraints?.width ?? el.clientWidth ?? 0
      const h = constraints?.height ?? el.clientHeight ?? 0
      return { width: w, height: h }
    },
  }
}
