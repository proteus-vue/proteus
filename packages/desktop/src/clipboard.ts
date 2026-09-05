// packages/desktop/src/clipboard.ts
// ★G-24 B2（proteus-semantic-primitives-plan 04-system-integration §1 p-clipboard）：剪贴板纯逻辑
//   · clipboardSupported / copyText / pasteText：Web Clipboard API（secure context）→ execCommand('copy') 降级 → Err
//   映射：iOS UIPasteboard / Android ClipboardManager / 鸿蒙 pasteboard / Web Clipboard API（04 §1）
//   env 注入可单测；env 省略 → 回落真实浏览器全局（typeof 守卫——封装只在框架包内，页面零裸平台 API）
export interface ClipboardResult<T = string> {
  ok: boolean
  data?: T
  error?: 'clipboard.unsupported' | 'clipboard.failed' | 'clipboard.read-unsupported'
}

export interface ClipboardEnv {
  navigator?: { clipboard?: { writeText(text: string): Promise<void>; readText?(): Promise<string> } }
  document?: {
    execCommand(command: string): boolean
    createElement(tag: string): {
      value?: string
      select(): void
      setAttribute(k: string, v: string): void
      remove(): void
      style: { position: string; left: string; top: string }
    }
  }
}

/** env 省略时的页面即用形态：取当前宿主全局（浏览器 navigator.clipboard / document.execCommand 降级链） */
function browserEnv(): ClipboardEnv {
  const env: ClipboardEnv = {}
  if (typeof navigator !== 'undefined') env.navigator = navigator as ClipboardEnv['navigator']
  if (typeof document !== 'undefined') env.document = document as unknown as ClipboardEnv['document']
  return env
}

export function clipboardSupported(env?: ClipboardEnv): boolean {
  const e = env ?? browserEnv()
  return typeof e.navigator?.clipboard?.writeText === 'function'
}

/** ★copyText：写剪贴板——Clipboard API（异步 Promise）→ execCommand('copy') 降级（textarea 临时选择）→ unsupported */
export async function copyText(text: string, env?: ClipboardEnv): Promise<ClipboardResult> {
  const clip = (env ?? browserEnv()).navigator?.clipboard
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(text)
      return { ok: true, data: text }
    } catch {
      // 权限拒绝/非安全上下文 → 降级
    }
  }
  const doc = (env ?? browserEnv()).document
  if (doc && typeof doc.execCommand === 'function') {
    try {
      const ta = doc.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      ta.style.top = '0'
      ta.select()
      const done = doc.execCommand('copy')
      ta.remove()
      return done ? { ok: true, data: text } : { ok: false, error: 'clipboard.failed' }
    } catch {
      return { ok: false, error: 'clipboard.failed' }
    }
  }
  return { ok: false, error: 'clipboard.unsupported' }
}

/** ★pasteText：读剪贴板——Clipboard API readText（execCommand('paste') 无可靠降级——诚实 Err） */
export async function pasteText(env?: ClipboardEnv): Promise<ClipboardResult> {
  const clip = (env ?? browserEnv()).navigator?.clipboard
  if (clip && typeof clip.readText === 'function') {
    try {
      const text = await clip.readText()
      return { ok: true, data: text }
    } catch {
      return { ok: false, error: 'clipboard.failed' }
    }
  }
  return { ok: false, error: 'clipboard.read-unsupported' }
}
