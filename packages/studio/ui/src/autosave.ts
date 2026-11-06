/**
 * autosave.ts —— 自动保存（决策 #1455）
 *
 * 【三种模式】对齐 VS Code 的 `files.autoSave`：
 *   · `off`（默认）：不自动保存 —— 写盘是"有副作用"的动作，默认交给人；
 *   · `afterDelay`：停止输入 1s 后保存（最常用）；
 *   · `onFocusChange`：窗口失焦时保存（切到浏览器/别的应用就存）。
 *
 * 【为什么默认 off】Studio 直接改的是真实工作区文件；一进来就自动写盘，
 *   用户改错一个字都来不及撤销。默认保守，想开的人在设置里开。
 *
 * 【为什么用 DOM `input` 事件而不是 CodeMirror 的 updateListener】
 *   监听挂在 `#codeHost` 上就够了，且**不需要**把 view 传进来 —— `CodePanel`
 *   已贴着 1000 行上限，只能给它留一行调用。
 *
 * 【存储在 localStorage】设置窗口是独立 Tauri 窗口，用 workspace state 会被主窗口
 *   deep watch 覆盖（同快捷键方案的坑，决策 #1431）；localStorage 同源共享 + `storage` 事件广播。
 */
import { readonly, ref } from 'vue'

export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange'

export const AUTO_SAVE_OPTIONS: { value: AutoSaveMode; label: string }[] = [
  { value: 'off', label: '关闭（手动 ⌘S）' },
  { value: 'afterDelay', label: '停止输入 1 秒后' },
  { value: 'onFocusChange', label: '窗口失焦时' },
]

const KEY = 'proteus.autoSave'
const DELAY = 1000

const isMode = (v: unknown): v is AutoSaveMode =>
  v === 'off' || v === 'afterDelay' || v === 'onFocusChange'

const mode = ref<AutoSaveMode>(load())
export const autoSaveMode = readonly(mode)

function load(): AutoSaveMode {
  try {
    const v = localStorage.getItem(KEY)
    return isMode(v) ? v : 'off'
  } catch {
    return 'off'
  }
}

export function setAutoSave(m: AutoSaveMode): void {
  if (!isMode(m)) return
  mode.value = m
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* 隐私模式写不了：内存里仍生效 */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && isMode(e.newValue)) mode.value = e.newValue
  })
}

/**
 * 装好监听，返回卸载函数。
 * 只在编辑器内输入时计时（`#codeHost` 内），不会因为点别处输入就触发保存。
 */
export function installAutoSave(opts: { isDirty: () => boolean; save: () => void }): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    if (opts.isDirty()) opts.save()
  }

  const onInput = (e: Event): void => {
    if (mode.value !== 'afterDelay') return
    const host = document.getElementById('codeHost')
    if (!host || !(e.target instanceof Node) || !host.contains(e.target)) return
    clearTimeout(timer)
    timer = setTimeout(flush, DELAY)
  }

  const onBlur = (): void => {
    clearTimeout(timer)
    if (mode.value === 'onFocusChange') flush()
  }

  document.addEventListener('input', onInput, true)
  window.addEventListener('blur', onBlur)

  return () => {
    clearTimeout(timer)
    document.removeEventListener('input', onInput, true)
    window.removeEventListener('blur', onBlur)
  }
}
