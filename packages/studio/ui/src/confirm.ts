// ui/src/confirm.ts —— 应用内确认框的状态（决策 #1243）
//
// 【为什么不用 `window.confirm`】在 WKWebView 里它是**系统模态**：样式不跟主题、会挡住整块画面、
//   而且**无法**给"保存并关闭"这种第三个按钮。IDE 的关闭确认必须是三选一：
//   保存 / 不保存 / 取消——中间那个还得能取消。
//
// 【形态】一个 Promise 化的 `ask()`：调用方 `const r = await ask({...})`，拿到动作 id。
//   好处是调用点读起来就是"问一句、按回答分支"，不用把状态散在组件里。
import { reactive } from 'vue'

export type ConfirmKind = 'default' | 'danger' | 'cancel'

export interface ConfirmAction {
  id: string
  label: string
  kind?: ConfirmKind
}

interface ConfirmState {
  open: boolean
  title: string
  body: string
  actions: ConfirmAction[]
}

export const confirmState = reactive<ConfirmState>({
  open: false,
  title: '',
  body: '',
  actions: [],
})

let resolveOnce: ((id: string) => void) | null = null

/** 问一句。返回被点中的动作 id（Esc 一律当 cancel）。 */
export function ask(opts: { title: string; body: string; actions: ConfirmAction[] }): Promise<string> {
  // 同一时刻只允许一个确认框：前一个当作取消（否则两个 Promise 都挂着，谁都关不掉）
  if (resolveOnce) {
    resolveOnce('cancel')
    resolveOnce = null
  }
  confirmState.title = opts.title
  confirmState.body = opts.body
  confirmState.actions = opts.actions
  confirmState.open = true
  return new Promise<string>((resolve) => {
    resolveOnce = resolve
  })
}

export function answer(id: string): void {
  confirmState.open = false
  const fn = resolveOnce
  resolveOnce = null
  fn?.(id)
}
