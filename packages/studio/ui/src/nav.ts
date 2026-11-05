/**
 * nav.ts —— 代码导航：跳转定义（F12）+ 悬浮类型信息（决策 #1429）
 *
 * 【数据来源】复用常驻 tsserver：`definition` / `quickinfo` 两个命令，
 *   都是"拉式"请求（Rust 侧 id 配对，见 `src/diag.rs` 的 `lsp_call`）。
 *
 * 【为什么和补全分文件】补全是"打字过程中高频、必须快"（2.5s 超时），
 *   导航是"按键/停留触发、可以慢一点"（8s / 4s 超时，首次要等项目加载）。
 *   两者失败策略也不同：补全失败静默、导航失败要**告诉用户为什么没跳**。
 */
import { hoverTooltip, type EditorView } from '@codemirror/view'
import { diagDefinition, diagQuickinfo } from './bridge'

export interface DefTarget {
  path: string
  line: number
  col: number
}

/**
 * 取光标/指定位置的定义。
 * @param col 1-based 字符列（与 tsserver 一致）
 */
export async function definitionAt(path: string, text: string, line: number, col: number): Promise<DefTarget | null> {
  if (!path) return null
  const t = await diagDefinition(path, text, line, col).catch(() => null)
  return t ?? null
}

/** 指定文档偏移处的定义（⌘+单击用） */
export async function definitionAtPos(view: EditorView, path: string, pos: number): Promise<DefTarget | null> {
  const line = view.state.doc.lineAt(pos)
  return definitionAt(path, view.state.doc.toString(), line.number, pos - line.from + 1)
}

/** F12：光标处的定义。`col` 用 UTF-16 偏移（tsserver 的口径就是 UTF-16 code unit） */
export async function definitionAtCursor(view: EditorView, path: string): Promise<DefTarget | null> {
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  return definitionAt(path, view.state.doc.toString(), line.number, pos - line.from + 1)
}

/**
 * F12 的完整动作：拿定义位置；拿不到或目标在仓库外就**说明原因**（`onInfo`），不硬跳。
 * 放在这里而不是组件里，是因为"跳不跳、为什么不跳"属于导航语义，和 UI 无关。
 */
export async function goToDefinition(
  view: EditorView | null,
  path: string,
  onInfo: (msg: string) => void,
  /** 指定位置（F12 用光标；⌘+单击传鼠标处的文档偏移） */
  pos?: number,
): Promise<DefTarget | null> {
  /* 判空收在这里：调用方（组件）手里的 view 天然是 `EditorView | null` */
  if (!view || !path) return null
  const t = pos === undefined ? await definitionAtCursor(view, path) : await definitionAtPos(view, path, pos)
  if (!t) {
    onInfo('这里没有可跳转的定义')
    return null
  }
  if (!isInRepo(t.path)) {
    onInfo(`定义在仓库外：${t.path}`)
    return null
  }
  return t
}

/** 目标是否在仓库内（`node_modules` / 绝对路径之外都算外） */
export function isInRepo(path: string): boolean {
  return !!path && !path.startsWith('/') && !path.startsWith('..') && !path.includes('node_modules/')
}

const WORD = /[\w$]+/

/**
 * 悬浮类型信息：鼠标停在**标识符**上 300ms 后查 `quickinfo`。
 * ★只在词上才发请求（空白/符号上不发）——否则每移动一次鼠标都要跨进程问一次。
 */
export function typeHover(pathOf: () => string) {
  return hoverTooltip(
    async (view, pos) => {
      const path = pathOf()
      if (!path) return null
      const line = view.state.doc.lineAt(pos)
      const col = pos - line.from + 1
      const text = line.text
      /* 光标所在位置往前找到词首，确认这一点确实落在词内（而不是词后空格） */
      let start = col - 1
      while (start > 0 && WORD.test(text[start - 1] ?? '')) start--
      const word = WORD.exec(text.slice(start))?.[0] ?? ''
      if (!word) return null
      const info = await diagQuickinfo(path, view.state.doc.toString(), line.number, start + 1).catch(() => null)
      if (!info || !info.text) return null
      return {
        pos: line.from + start,
        create() {
          const dom = document.createElement('div')
          dom.className = 'studio-type-tip'
          const sig = document.createElement('div')
          sig.className = 'st-sig'
          sig.textContent = info.text
          dom.append(sig)
          if (info.doc) {
            const doc = document.createElement('div')
            doc.className = 'st-doc'
            doc.textContent = info.doc
            dom.append(doc)
          }
          return { dom }
        },
      }
    },
    { hoverTime: 300 },
  )
}
