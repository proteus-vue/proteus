/**
 * modPeek.ts —— 按住 ⌘/Ctrl 时的"跳转预览"（决策 #1436）
 *
 * 【对标行为】（VS Code / JetBrains 一致的肌肉记忆）
 *   按住 ⌘ ⇒ 光标下的符号**加下划线**、鼠标**变手型**、并自动弹出**定义预览**；
 *   此时单击 = 跳到定义；松开 ⌘ / 移开 ⇒ 全部复原。
 *
 * 【为什么自己做而不是用 hoverTooltip】
 *   `hoverTooltip` 的浮层**不可点击**（里面点不到东西），而预览卡需要"点一下就跳过去"；
 *   而且它按固定延迟弹，做不到"必须按住修饰键才出现"。
 *   ⇒ 下划线用 Decoration，预览卡用 Vue 组件（`DefPeek.vue`）按坐标绝对定位。
 *
 * 【状态放模块级 refs】预览卡是**单例**（同一时刻只有一张），放组件里反而要层层透传。
 * 【修饰键状态在 `modKey.ts`】`typeHover` / `diagHover` 也要读它（按住 ⌘ 时不许弹各自的提示），
 *   放这里会形成 `nav ↔ modPeek` 循环 import。
 */
import { Decoration, EditorView, ViewPlugin, closeHoverTooltips, type DecorationSet } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { readonly, ref } from 'vue'
import { modHeldState, setModHeld } from './modKey'
import { definitionAt, isReadonlyPath, type DefTarget } from './nav'
import { readSource } from './bridge'

/* ── 修饰键状态 ─────────────────────────────────────────────────────────── */
const hoverRange = ref<{ from: number; to: number } | null>(null)

/** 预览卡内容（null = 不显示） */
export interface PeekData {
  target: DefTarget
  /** 目标文件里定义处附近的行（带行号） */
  lines: { no: number; text: string }[]
  /** 锚点：编辑器坐标系里的矩形（用它定位卡片） */
  anchor: { left: number; top: number; bottom: number }
  /** 是否只读打开（依赖/仓库外） */
  readonly: boolean
}
const peek = ref<PeekData | null>(null)
export const peekState = readonly(peek)

/* ── 下划线装饰 ─────────────────────────────────────────────────────────── */
const linkMark = Decoration.mark({ class: 'cm-def-link' })
const setLink = StateEffect.define<{ from: number; to: number } | null>()
const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setLink)) {
        deco = e.value ? Decoration.set([linkMark.range(e.value.from, e.value.to)]) : Decoration.none
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/* ── 主扩展 ─────────────────────────────────────────────────────────────── */
export function modPeek(pathOf: () => string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastPos = -1
  /** 最后一次鼠标位置：★按住 ⌘ 时鼠标**已经停在符号上**就不会再有 mousemove，
      必须用它当场算一次，否则"先停住再按 ⌘"这个最常见的操作完全没反应。 */
  let lastXY: { x: number; y: number } | null = null
  /** ★不能用 `this.view`：ViewPlugin 的 class field 初始化**早于** CM 赋值 `view`，
      在 keydown 里读到的是 undefined（实测 `Cannot read properties of undefined (reading 'posAtCoords')`）。
      改用闭包持有：构造器与 mousemove 都能拿到。 */
  let liveView: EditorView | null = null

  /** 清掉一切（松手、移开、切换文件都走这里） */
  const clear = (view?: EditorView) => {
    clearTimeout(timer)
    hoverRange.value = null
    peek.value = null
    lastPos = -1
    if (view && view.state.field(linkField, false)) {
      view.dispatch({ effects: setLink.of(null) })
    }
  }

  const schedule = (view: EditorView, pos: number) => {
    if (!modHeldState.value) return
    const path = pathOf()
    if (!path) return
    const word = view.state.wordAt(pos)
    if (!word) {
      clear(view)
      return
    }
    /* 同一个词内移动不重复请求；换了词才重排 */
    hoverRange.value = { from: word.from, to: word.to }
    if (lastPos === word.from) return
    lastPos = word.from
    view.dispatch({ effects: setLink.of({ from: word.from, to: word.to }) })

    clearTimeout(timer)
    /* 250ms：与 VS Code 的"停住才预览"接近；移动中不请求，避免刷 IPC */
    timer = setTimeout(async () => {
      if (!modHeldState.value || lastPos !== word.from) return
      const line = view.state.doc.lineAt(word.from)
      const col = word.from - line.from + 1
      const t = await definitionAt(path, view.state.doc.toString(), line.number, col)
      if (!t || !modHeldState.value) return
      /* 定义就在本文件同一处 ⇒ 没什么可预览的 */
      const curLine = view.state.doc.lineAt(view.state.selection.main.head).number
      if (t.path === path && t.line === curLine) return

      let lines: { no: number; text: string }[] = []
      try {
        const f = await readSource(t.path)
        const all = f.text.split('\n')
        const start = Math.max(0, t.line - 3)
        const end = Math.min(all.length, t.line + 2)
        lines = all.slice(start, end).map((text, i) => ({ no: start + i + 1, text }))
      } catch {
        /* 读不到（二进制/过大/权限）⇒ 只显示位置，不显示代码 */
      }
      const coords = view.coordsAtPos(word.from)
      if (!coords) return
      peek.value = {
        target: t,
        lines,
        anchor: { left: coords.left, top: coords.top, bottom: coords.bottom },
        readonly: isReadonlyPath(t.path),
      }
    }, 250)
  }

  /* 修饰键：按下/松开/失焦。
     ★必须放在 ViewPlugin 里，不能把 `() => removeEventListener(...)` 直接塞进扩展数组 ——
       **裸函数不是合法 `Extension`**，CodeMirror 会因此在建 state 时失败（实测：整个面板不渲染）。
     ★用 `key` 判断而不是 keyCode；必须处理 blur ——在别的应用里松开 ⌘ 时 keyup 收不到，
       会一直卡在"预览态"。 */
  const modKeyPlugin = ViewPlugin.fromClass(
    class {
      private readonly onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Meta' && e.key !== 'Control') return
        setModHeld(true)
        /* 鼠标已经在某个符号上 ⇒ 不等 mousemove，立刻给反馈（下划线 + 预览） */
        const v = liveView
        if (!v) return
        /* ★已经弹出的 hover 提示（quickinfo / 诊断）**立刻收掉**：
           它们的 source 只在"鼠标移动"或 hoverTime 到点时求值，按住 ⌘ 不会触发重算 ⇒
           不主动关就会一直压在预览卡上面（用户截图里的"被顶替"）。 */
        try {
          v.dispatch({ effects: closeHoverTooltips })
        } catch {
          /* view 正在销毁 —— 忽略 */
        }
        const pos = lastXY ? v.posAtCoords(lastXY) : v.state.selection.main.head
        if (pos != null) schedule(v, pos)
      }
      /** 松开修饰键：预览卡、下划线、悬停态**一起收**（只收卡片会留下孤立的下划线） */
      private readonly onKeyUp = (e: KeyboardEvent) => {
        if (e.key !== 'Meta' && e.key !== 'Control') return
        this.reset()
      }
      private readonly onBlur = () => this.reset()

      private reset() {
        setModHeld(false)
        peek.value = null
        hoverRange.value = null
        lastPos = -1
        clearTimeout(timer)
        try {
          /* 直接派发：不先判 field 是否存在 —— 判错的代价是"下划线留在那儿" */
          liveView?.dispatch({ effects: setLink.of(null) })
        } catch {
          /* view 已销毁（切换文件时）—— 忽略 */
        }
      }
      constructor(view: EditorView) {
        liveView = view
        window.addEventListener('keydown', this.onKey, true)
        window.addEventListener('keyup', this.onKeyUp, true)
        window.addEventListener('blur', this.onBlur)
      }
      destroy() {
        liveView = null
        window.removeEventListener('keydown', this.onKey, true)
        window.removeEventListener('keyup', this.onKeyUp, true)
        window.removeEventListener('blur', this.onBlur)
      }
    },
  )

  return [
    linkField,
    modKeyPlugin,
    EditorView.domEventHandlers({
      mousemove: (e, view) => {
        lastXY = { x: e.clientX, y: e.clientY }
        liveView = view
        if (!modHeldState.value) {
          if (hoverRange.value) clear(view)
          return false
        }
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos != null) schedule(view, pos)
        return false
      },
      mouseleave: (_e, view) => {
        clear(view)
        return false
      },
    }),
    /* 松手时统一清（预览卡也要收），避免"松开还在" */
    EditorView.updateListener.of(() => {
      if (!modHeldState.value && peek.value) peek.value = null
    }),
    EditorView.theme({
      '.cm-def-link': {
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
        textDecorationThickness: '1.5px',
        cursor: 'pointer',
      },
    }),
  ]
}

/** 关闭预览卡（用户点空白/滚动时调用） */
export function closePeek(): void {
  peek.value = null
}
