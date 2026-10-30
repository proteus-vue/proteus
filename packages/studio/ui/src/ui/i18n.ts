/**
 * i18n.ts —— 界面文案（CodeMirror 等第三方控件的中文化）· 决策 #1402
 *
 * 【为什么单独成模块】CodeMirror 的查找面板、跳行面板的按钮文案是**库内置的英文短语**，
 * 只能通过 `EditorState.phrases` 这个 facet 覆盖。如果散在组件里，下次想加英文/加语种就得
 * 满仓库找 —— 集中一处，以后接真正的 i18n 只需换这里的数据源。
 *
 * 【默认语言 = 中文】Studio 的对外文案一直是中文（AGENTS.md 第 7 条：一律中文回复；
 * 产品界面同理），所以这里直接以中文为默认值，**不引入语言切换开关**——
 * 没有第二语言需求时，多一层 locale 状态只会带来"两份真相"。
 */
import { EditorState } from '@codemirror/state'

/** CodeMirror 内置短语 → 中文。key 必须与库里的英文原文**完全一致**（含大小写）。 */
const CM_ZH: Record<string, string> = {
  /* 查找面板 */
  Find: '查找',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  regexp: '正则',
  'by word': '全词',
  replace: '替换',
  /* 首字母大写的版本用在 placeholder / title 上，key 必须分开列（库里有两种写法） */
  Replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  /* 跳行面板 */
  'Go to line': '跳转到行',
  go: '跳转',
  /* 结果提示 */
  'current match': '当前命中',
  'on line': '所在行',
  'replaced $ matches': '已替换 $ 处',
  'replaced match on line $': '已替换第 $ 行的命中',
}

/** 给 CodeMirror 注入中文短语（放进编辑器 extensions 即可）。 */
export const cmPhrases = EditorState.phrases.of(CM_ZH)
