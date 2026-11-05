/**
 * completion.ts —— tsserver 驱动的自动补全（决策 #1428）
 *
 * 【为什么用 tsserver 而不是 CodeMirror 自带的词法补全】
 *   自带的只按"本文档出现过的词"猜；而 tsserver 给的是**语义**候选：
 *   真实符号、属性、方法、以及 import 进来的名字 —— 这才是"补全"而不是"联想"。
 *   而且 tsserver 已经作为常驻诊断服务在跑（`diag-lsp.mjs`），补全只是多一条请求，**零额外进程**。
 *
 * 【链路】CodeMirror `autocompletion` → 本函数（异步）→ `diag_complete`（Rust 转发）
 *   → `completionInfo`（tsserver）→ 候选返回。
 *
 * 【降级】后端不可用 / 超时 / 非 TS 家族文件 ⇒ 返回 `null`（CodeMirror 就不弹候选），
 *   **绝不弹错误提示**：打字过程中弹错误比没有补全更烦。
 */
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { diagComplete, type CompletionItem } from './bridge'

/** tsserver 的 kind → CodeMirror 的图标类型（决定候选列表里的小图标） */
function kindType(kind: string): string {
  switch (kind) {
    case 'function':
    case 'method':
      return 'function'
    case 'class':
    case 'interface':
    case 'enum':
      return 'class'
    case 'type':
    case 'typeParameter':
      return 'type'
    case 'property':
    case 'getter':
    case 'setter':
      return 'property'
    case 'const':
    case 'let':
    case 'var':
    case 'alias':
    case 'parameter':
      return 'variable'
    case 'keyword':
    case 'primitive':
      return 'keyword'
    case 'module':
      return 'namespace'
    default:
      return 'text'
  }
}

const SUPPORTED = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/

/**
 * ★这里**不能**写成 `async function source(...)`：那样返回的是 `Promise<CompletionSource>`，
 * 而 `autocompletion({ override })` 只接受**函数**，不会 await 数组元素
 * ⇒ 补全源永远不会被调用（实测：输入 `co` 一次 `diag_complete` 都没发）。
 * 只有内层（每次请求）才该是 async。
 */
function source(pathOf: () => string) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const path = pathOf()
    if (!path || !SUPPORTED.test(path)) return null
    /* 光标前的标识符片段（含 `$`）：CodeMirror 用它决定"替换哪一段"与后续过滤 */
    const word = ctx.matchBefore(/[\w$]*/)
    if (!word) return null
    /* 没打字也不是手动触发（⌃Space）⇒ 不打扰 */
    if (word.from === word.to && !ctx.explicit) return null

    const line = ctx.state.doc.lineAt(ctx.pos)
    /* 失败一律当"没有候选"：补全过程中弹错误比不补全更烦 */
    const items: CompletionItem[] = await diagComplete(
      path,
      ctx.state.doc.toString(),
      line.number,
      ctx.pos - line.from + 1,
    ).catch(() => [])
    if (!items.length) return null
    return {
      from: word.from,
      options: items.map((i) => ({
        label: i.label,
        type: kindType(i.kind),
        detail: i.detail || undefined,
        /* `insert` 可能带括号/参数占位（tsserver 的 insertText），没有就退回 label */
        apply: i.insert || i.label,
      })),
      /* 同一段标识符内继续打字不再重新请求（本地过滤即可） */
      validFor: /^[\w$]*$/,
    }
  }
}

/** 编辑器补全扩展：`pathOf` 取当前文件路径（由调用方注入，避免这里依赖路由状态） */
export function tsAutocomplete(pathOf: () => string) {
  return autocompletion({
    override: [source(pathOf)],
    activateOnTyping: true,
    /* 候选多时限制渲染数量：上千条 DOM 会卡（面板宽度只有 ~300px，看 12 条足够） */
    maxRenderedOptions: 12,
    defaultKeymap: true,
  })
}
