/**
 * modPeek.ts —— 按住 ⌘/Ctrl 时的"跳转预览"（决策 #1436 / 交互重做 #1438）
 *
 * 【对标行为】
 *   按住 ⌘ ⇒ 光标下的符号**加下划线**、鼠标**手型**、并弹出**定义预览卡**；
 *   鼠标可以**移到卡片上**（卡片不消失）⇒ 选中代码、点「复制」、点「跳转」；
 *   移出卡片且没按住 ⌘、或按 Esc、或在编辑器里点一下 ⇒ 收起。
 *
 * 【为什么自己做而不是用 hoverTooltip】
 *   `hoverTooltip` 的浮层**不可点击/不可选中**，而预览卡要"选代码 + 复制 + 跳转"。
 *   ⇒ 下划线用 Decoration，卡片用 Vue 组件（`DefPeek.vue`）按坐标 fixed 定位。
 *
 * 【三个必须处理的"鼠标一进去就消失"】
 *   1. 卡片 fixed 覆盖在编辑器上 ⇒ 鼠标进入卡片时编辑器先收到 **mouseleave**，
 *      原来那里直接 `clear()` ⇒ 卡片瞬间消失。现改为**延迟关闭**（进入卡片会取消）。
 *   2. 鼠标从符号移向卡片要跨过几像素空隙，途中编辑器会不断 mousemove 到别的词/空白，
 *      原逻辑"没词就 clear" ⇒ 半路被杀。现改为：卡片已显示就**冻结内容**，不移除。
 *   3. 松开 ⌘ 会 reset 掉一切。现在卡片被"钉住"（鼠标在卡片上）时**保留**。
 *
 * 【状态放模块级 refs】卡片是单例（同一时刻只有一张）。
 * 【修饰键状态在 `modKey.ts`】`typeHover` / `diagHover` 也要读（按住 ⌘ 时不许弹），
 *   放这里会形成 `nav ↔ modPeek` 循环 import。
 */
import { Decoration, EditorView, ViewPlugin, closeHoverTooltips, type DecorationSet } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { readonly, ref } from 'vue'
import { modHeldState, setModHeld } from './modKey'
import { definitionAt, isReadonlyPath, type DefTarget } from './nav'
import { readSource } from './bridge'
import { sliceDefinition } from './peekRange'

const hoverRange = ref<{ from: number; to: number } | null>(null)

/** 预览卡内容（null = 不显示） */
export interface PeekData {
  target: DefTarget
  /** 定义块的完整行（带行号） */
  lines: { no: number; text: string }[]
  /** 行数超过上限被截断 */
  truncated: boolean
  /** 定义块实际行数（截断时提示"共 N 行"） */
  span: number
  /** 锚点：编辑器坐标系里的矩形（用它定位卡片） */
  anchor: { left: number; top: number; bottom: number }
  /** 是否只读打开（依赖/仓库外） */
  readonly: boolean
}
const peek = ref<PeekData | null>(null)
export const peekState = readonly(peek)

/** 鼠标是否停在卡片上（钉住）。钉住期间：不随鼠标移动换内容、不因松开 ⌘ 而关闭 */
const pinned = ref(false)
export const peekPinned = readonly(pinned)

/** 卡片 DOM 的 mouseenter/mouseleave 调它 */
export function setPeekPinned(v: boolean): void {
  pinned.value = v
  if (v) {
    clearTimeout(closeTimer)
    clearTimeout(replaceTimer)
  } else {
    /* 移出卡片：给"从卡片移回符号"留一点时间，避免边缘抖动 */
    scheduleClose(260)
  }
}

/** 关闭预览卡（Esc / 点击编辑器 / 滚出视野时调用） */
export function closePeek(): void {
  pinned.value = false
  peek.value = null
  hoverRange.value = null
  clearTimeout(closeTimer)
  clearTimeout(replaceTimer)
  try {
    liveView?.dispatch({ effects: setLink.of(null) })
  } catch {
    /* view 已销毁 */
  }
}

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

/* ── 闭包状态（每个编辑器实例一份；`liveView` 给 keydown 用） ─────────────── */
let liveView: EditorView | null = null
let closeTimer: ReturnType<typeof setTimeout> | undefined
let replaceTimer: ReturnType<typeof setTimeout> | undefined
/** 当前卡片对应的源词起点：用它判断"鼠标是不是换词了" */
let peekSrcFrom = -1

function scheduleClose(delay: number): void {
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    /* 钉住（鼠标在卡片上）⇒ 不关。这是"能复制代码"的前提 */
    if (pinned.value) return
    peek.value = null
    hoverRange.value = null
    try {
      liveView?.dispatch({ effects: setLink.of(null) })
    } catch {
      /* view 已销毁 */
    }
  }, delay)
}

/* ── 主扩展 ─────────────────────────────────────────────────────────────── */
export function modPeek(pathOf: () => string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastPos = -1
  /** 最后一次鼠标位置：★按住 ⌘ 时鼠标**已经停在符号上**就不会再有 mousemove，
      必须用它当场算一次，否则"先停住再按 ⌘"这个最常见的操作完全没反应。 */
  let lastXY: { x: number; y: number } | null = null

  const clearLink = (view?: EditorView) => {
    hoverRange.value = null
    lastPos = -1
    const v = view ?? liveView
    if (v?.state.field(linkField, false)) v.dispatch({ effects: setLink.of(null) })
  }

  const schedule = (view: EditorView, pos: number) => {
    if (!modHeldState.value || pinned.value) return
    const path = pathOf()
    if (!path) return
    const word = view.state.wordAt(pos)
    if (!word) {
      /* 没有词：已有卡片就冻住（鼠标可能正移向卡片），没有才清下划线 */
      if (!peek.value) clearLink(view)
      return
    }
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
      /* 定义就在光标这一行 ⇒ 没什么可预览的 */
      const curLine = view.state.doc.lineAt(view.state.selection.main.head).number
      if (t.path === path && t.line === curLine) return

      let slice = { lines: [] as { no: number; text: string }[], truncated: false, span: 0 }
      try {
        const f = await readSource(t.path)
        /* ★整块截取（决策 #1438）：原来固定 ±5 行会把长接口/长函数拦腰截断 */
        slice = sliceDefinition(f.text.split('\n'), t.line)
      } catch {
        /* 读不到（二进制/过大/权限）⇒ 只显示位置 */
      }
      const coords = view.coordsAtPos(word.from)
      if (!coords) return
      peekSrcFrom = word.from
      peek.value = {
        target: t,
        lines: slice.lines,
        truncated: slice.truncated,
        span: slice.span,
        anchor: { left: coords.left, top: coords.top, bottom: coords.bottom },
        readonly: isReadonlyPath(t.path),
      }
    }, 250)
  }

  /* 修饰键：按下/松开/失焦。
     ★必须放在 ViewPlugin 里，不能把 `() => removeEventListener(...)` 直接塞进扩展数组 ——
       **裸函数不是合法 `Extension`**，CodeMirror 会因此在建 state 时失败（实测：整个面板不渲染）。 */
  const modKeyPlugin = ViewPlugin.fromClass(
    class {
      private readonly onKey = (e: KeyboardEvent) => {
        /* Esc：关掉卡片（钉住时也能关，否则用户没法取消） */
        if (e.key === 'Escape' && peek.value) {
          e.preventDefault()
          closePeek()
          return
        }
        if (e.key !== 'Meta' && e.key !== 'Control') return
        setModHeld(true)
        const v = liveView
        if (!v) return
        /* ★已经弹出的 hover 提示（quickinfo / 诊断）**立刻收掉**：
           它们的 source 只在"鼠标移动"或 hoverTime 到点时求值，按住 ⌘ 不会触发重算。 */
        try {
          v.dispatch({ effects: closeHoverTooltips })
        } catch {
          /* view 正在销毁 */
        }
        const pos = lastXY ? v.posAtCoords(lastXY) : v.state.selection.main.head
        if (pos != null) schedule(v, pos)
      }
      private readonly onKeyUp = (e: KeyboardEvent) => {
        if (e.key !== 'Meta' && e.key !== 'Control') return
        this.reset()
      }
      private readonly onBlur = () => this.reset()

      private reset() {
        setModHeld(false)
        clearTimeout(timer)
        clearLink()
        /* ★卡片被钉住（鼠标在卡片上/正在选代码）⇒ 不关，否则"按住 ⌘ → 移上去复制"永远做不到 */
        if (pinned.value) return
        peek.value = null
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
        /* 钉住（鼠标在卡片上）：编辑器里的任何移动都不影响卡片 */
        if (pinned.value) return false
        if (!modHeldState.value) {
          /* 没按 ⌘：有卡片就延迟收（可能正移向卡片），没有就只清下划线 */
          if (peek.value) scheduleClose(200)
          else if (hoverRange.value) clearLink(view)
          return false
        }
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos == null) return false
        /* 卡片已显示：**冻结内容**，但允许"停在新词 500ms"再换（松手/移入卡片都会取消）。
           冻结是必需的：鼠标从符号移向卡片途中会不断经过别的词与空白，不冻结就会闪变/消失。 */
        if (peek.value) {
          const w = view.state.wordAt(pos)
          if (w && w.from !== peekSrcFrom) {
            clearTimeout(replaceTimer)
            replaceTimer = setTimeout(() => {
              if (!pinned.value) schedule(view, pos)
            }, 500)
          }
          return false
        }
        schedule(view, pos)
        return false
      },
      /* ★不能在这里直接 clear：卡片 fixed 覆盖编辑器，鼠标进入卡片必然先触发 mouseleave */
      mouseleave: () => {
        if (peek.value) scheduleClose(280)
        else clearLink()
        return false
      },
      /* 在编辑器里按下鼠标：收起卡片（含钉住的），普通点击/⌘+单击跳转照常继续 */
      mousedown: () => {
        if (peek.value) closePeek()
        return false
      },
    }),
    /* 兜底：没按住 ⌘ 且卡片没被钉住 ⇒ 收起（keyup 在别的窗口丢失时也不会残留） */
    EditorView.updateListener.of(() => {
      if (!modHeldState.value && peek.value && !pinned.value) scheduleClose(120)
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
