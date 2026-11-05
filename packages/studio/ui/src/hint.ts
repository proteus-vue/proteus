/**
 * hint.ts —— 编辑器内**就地提示**（决策 #1440）
 *
 * 【为什么不用右下角 toast】
 *   F12 / ⌘+单击失败时的「这里没有可跳转的定义」，用户视线就在代码上，
 *   右下角离得太远、还要主动去看 —— 用户反馈"不太注意到"。
 *   这里把提示放在**光标/点击处下方**：距离视线≈0，2.2s 自动消失，不打断输入。
 *
 * 【和 toast 的分工】
 *   · toast：全局 / 跨面板的结果（保存了几个文件、构建失败、语言模式切换）；
 *   · hint：编辑器内的**动作反馈**（跳转没找到定义、文件只读不能改）。
 *
 * 【为什么命令式建 DOM，不用 Vue 组件】
 *   `CodePanel.vue` 贴着 1000 行上限，挂组件要加 import + 模板两行；
 *   而这条提示是纯展示（`pointer-events: none`、无状态交互），命令式更省也更轻。
 *   样式在 `styles.css` 的 `.studio-inline-hint`（不能用 scoped，元素在 body 下）。
 */
import type { EditorView } from '@codemirror/view'

let el: HTMLDivElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function ensure(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div')
    el.className = 'studio-inline-hint'
    el.setAttribute('role', 'status')
    document.body.append(el)
  }
  return el
}

/** 在指定视口坐标显示一条短提示（2.2s 自动淡出） */
export function showHint(text: string, x: number, y: number): void {
  const d = ensure()
  d.textContent = text
  /* 视口收边：贴右/贴底时别被切掉（宽度按最长提示估 320） */
  const W = 320
  const vw = window.innerWidth
  const vh = window.innerHeight
  d.style.left = `${Math.max(8, Math.min(x, vw - W - 8))}px`
  d.style.top = `${y + 34 > vh ? Math.max(8, y - 44) : y}px`
  d.classList.add('on')
  clearTimeout(timer)
  timer = setTimeout(() => d.classList.remove('on'), 2200)
}

export function hideHint(): void {
  clearTimeout(timer)
  el?.classList.remove('on')
}

/**
 * 在文档的某个位置显示提示。
 * ★`pos` 由调用方给：F12 用光标位置、⌘+单击用**鼠标位置** ——
 *   我们的 mousedown 是 preventDefault 的，光标不会跟着移到点击处，
 *   若一律用光标，提示会飘到上一次光标所在的地方。
 */
export function hintAt(view: EditorView | null, pos: number, text: string): void {
  if (!view) return
  const c = view.coordsAtPos(pos)
  if (!c) return
  /* ★优先贴在**行尾右侧的空白**里：放在光标正下方会直接盖住下一行代码
     （实测截图里 `const c = 3` 被整个遮住，很别扭）。
     只有当行尾右边放不下（长行 / 窗口窄）时，才退回"光标下方"。 */
  const end = view.coordsAtPos(view.state.doc.lineAt(pos).to)
  const need = 260
  if (end && end.right + 12 + need < window.innerWidth) {
    showHint(text, end.right + 12, c.top - 3)
    return
  }
  showHint(text, c.left, c.bottom + 8)
}
