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
