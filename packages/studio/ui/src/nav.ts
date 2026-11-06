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
import { modHeldState } from './modKey'
import { diagDefinition, diagQuickinfo, diagReferences, diagRename, type RefItem, type RenameResult } from './bridge'

export interface DefTarget {
  path: string
  line: number
  col: number
}

/**
 * 取光标/指定位置的定义。
 * @param col 1-based 字符列（与 tsserver 一致）
 */
/** 全部定义位置（重载 / 合并声明 / 联合类型可能是多条） */
export async function definitionsAt(path: string, text: string, line: number, col: number): Promise<DefTarget[]> {
  if (!path) return []
  const list = await diagDefinition(path, text, line, col).catch(() => [])
  return Array.isArray(list) ? list : []
}

/** 第一个定义（预览卡只展示一处；要选的话走 `goToDefinition` 的 choose） */
export async function definitionAt(path: string, text: string, line: number, col: number): Promise<DefTarget | null> {
  return (await definitionsAt(path, text, line, col))[0] ?? null
}

/** 重命名（F2 用）：能否重命名 + 全部待改位置 */
export async function renameTarget(
  view: EditorView | null,
  path: string,
  pos?: number,
): Promise<RenameResult | null> {
  if (!view || !path) return null
  const at = pos ?? view.state.selection.main.head
  const line = view.state.doc.lineAt(at)
  return diagRename(path, view.state.doc.toString(), line.number, at - line.from + 1).catch(() => null)
}

/** 查找引用（⇧F12 用）：光标/指定位置的符号在**整个项目**里的全部引用 */
export async function referencesAt(
  view: EditorView | null,
  path: string,
  pos?: number,
): Promise<RefItem[]> {
  if (!view || !path) return []
  const at = pos ?? view.state.selection.main.head
  const line = view.state.doc.lineAt(at)
  return diagReferences(path, view.state.doc.toString(), line.number, at - line.from + 1).catch(() => [])
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
  /** 有**多个**定义时的选择器（由组件提供；不传就取第一个，保持旧行为） */
  choose?: (list: DefTarget[]) => Promise<DefTarget | null>,
): Promise<DefTarget | null> {
  /* 判空收在这里：调用方（组件）手里的 view 天然是 `EditorView | null` */
  if (!view || !path) return null
  const at = pos ?? view.state.selection.main.head
  const line = view.state.doc.lineAt(at)
  const all = await definitionsAt(path, view.state.doc.toString(), line.number, at - line.from + 1)
  /* 仓库外 / `..` 这类不可用的位置先剔掉，别让用户选到一个点不动的 */
  const usable = all.filter((t) => isJumpable(t.path))
  if (!usable.length) {
    onInfo(all.length ? `无法跳转（路径不可用）：${all[0].path}` : '这里没有可跳转的定义')
    return null
  }
  /* ★多个定义 ⇒ 交给选择器（决策 #1442）；只有一个就直接跳，不打扰 */
  if (usable.length === 1) return usable[0]
  return choose ? ((await choose(usable)) ?? null) : usable[0]
}

/**
 * 是否"仓库内的依赖文件"（`node_modules/`，含 pnpm 的 `.pnpm/`）。
 * ★决策 #1434：这类文件**能读、能跳，但必须只读** —— 用户要看第三方类型定义，
 *   却绝不能顺手改掉 `node_modules` 里的东西（下次 install 就没了，也污染依赖）。
 */
export function isDependencyPath(path: string): boolean {
  return !!path && !path.startsWith('/') && path.includes('node_modules/')
}

/**
 * 是否只读打开：仓库内依赖（node_modules）+ **任何绝对路径**（仓库外的 SDK/全局包）。
 * 主流 IDE 都这么做（JetBrains 的 External Libraries 直接带锁），我们跟这个语义。
 */
export function isReadonlyPath(path: string): boolean {
  return path.startsWith('/') || isDependencyPath(path)
}

/** 能否跳过去：绝对路径也跳（只读打开）；只有 `..` 这类相对越界不跳 */
export function isJumpable(path: string): boolean {
  return !!path && !path.startsWith('..')
}

const WORD = /[\w$]+/

/**
 * 悬浮类型信息：鼠标停在**标识符**上 300ms 后查 `quickinfo`。
 * ★只在词上才发请求（空白/符号上不发）——否则每移动一次鼠标都要跨进程问一次。
 */
export function typeHover(pathOf: () => string) {
  return hoverTooltip(
    async (view, pos) => {
      /* ★按住 ⌘/Ctrl 时**不许**弹类型提示（决策 #1437）：
         该手势属于"定义预览"，`modPeek` 会弹可点击的定义卡；这两个提示锚在同一位置，
         quickinfo 只要晚 300ms 冒出来就会把预览卡盖掉（用户截图反馈"预览总被顶替"）。 */
      if (modHeldState.value) return null
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
      /* ★再判一次：请求是异步的，回来时用户可能**已经按下** ⌘（按下那一刻还看不到这次结果，
         `closeHoverTooltips` 也关不掉它）⇒ 只能在落地前丢弃。 */
      if (modHeldState.value) return null
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
