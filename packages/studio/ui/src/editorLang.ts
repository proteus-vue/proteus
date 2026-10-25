// ui/src/editorLang.ts —— 当前文件的「语言模式」（决策 #1241）
//
// 【为什么要一个独立的小 store】语言模式有两个写入方：
//   ① 编辑器打开文件时按扩展名**自动判定**；② 用户在**底部状态栏**手动改。
//   读取方也有两个：状态栏（显示名字）与编辑器（决定装哪个语法扩展）。
//   放组件里就会出现"状态栏显示的和实际著色的不是同一个"——所以放这一层，两边都读它。
//
// 【覆盖是"按文件"记的】VS Code 也是这样：同一个 .txt 你把它当 Python 看，切走再回来还是 Python。
//   ★只活在这个会话里（不写 state.json）——语言模式是"我现在怎么看这个文件"，不是文件属性。
import { reactive } from 'vue'
import languageMap from './languages.json'

const LANGUAGES = languageMap.languages as Record<string, string>

/** 当前编辑的文件（路径 + 按扩展名判定的自动语言） */
export const editorLang = reactive({ path: '', auto: '' })

/** 用户手动指定的语言：path → lang id */
export const langOverrides = reactive<Record<string, string>>({})

export function detectLangId(path: string): string {
  const i = path.lastIndexOf('.')
  const ext = i >= 0 ? path.slice(i).toLowerCase() : ''
  return LANGUAGES[ext] ?? 'plain'
}

/** 实际生效的语言（手选优先） */
export function effectiveLangId(path: string): string {
  if (!path) return 'plain'
  return langOverrides[path] ?? detectLangId(path)
}

/** 编辑器切到某个文件时调用，供状态栏显示 */
export function trackEditorFile(path: string): void {
  editorLang.path = path
  editorLang.auto = path ? detectLangId(path) : ''
}

/** 手动指定（传空字符串 = 回到自动） */
export function setLangOverride(path: string, id: string): void {
  if (!path) return
  if (!id) delete langOverrides[path]
  else langOverrides[path] = id
}
