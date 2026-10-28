// ui/src/layout.ts —— IDE 布局的**共享状态**（决策 #1344）
//
// 【为什么需要单独一个模块】布局现在跨组件：
//   · `App.vue` 管外壳（左图标条 rail / 右面板 side）；
//   · `CodePanel.vue` 管代码视图自己的左栏（文件树）。
//   标题栏的"切换左栏"按钮要**按当前视图**决定切谁 ⇒ 两边必须看同一份状态，
//   否则会出现"按钮改了 A、组件用的是 B"这种双份真相。
//
// 【持久化】localStorage（视图偏好，与设备/环境无关）。
//   两个键分开存：外壳布局 `studio.layout.v1`、代码视图 `studio.code.v1`，
//   这样改一个不会把另一个写坏。
import { ref } from 'vue'

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/* ── 外壳 ─────────────────────────────────────────────────────────────── */
export const railW = ref(48) // 左图标条宽度
export const sideW = ref(320) // 右面板宽度
export const railHidden = ref(false)
export const sideHidden = ref(false)

/* ── 终端（底部面板 / 全屏）───────────────────────────────────────────────
 * `termMode`：off=关闭 · pane=底部面板（与编辑器上下并存，**这才是重点**）· full=全屏。
 * ★为什么用三态而不是布尔：VS Code 的"面板"就是这三态（关/面板/最大化），
 *   布尔表达不了"从面板一键最大化"。 */
export type TermMode = 'off' | 'pane' | 'full'
export const termMode = ref<TermMode>('off')
export const termH = ref(260)

/* ── 代码视图 ─────────────────────────────────────────────────────────── */
export const treeW = ref(232) // 文件树宽度
export const treeHidden = ref(false)

const LAYOUT_KEY = 'studio.layout.v1'
const CODE_KEY = 'studio.code.v1'
const TERM_KEY = 'studio.terminal.v1'

export function loadLayout() {
  try {
    const a = localStorage.getItem(LAYOUT_KEY)
    if (a) {
      const s = JSON.parse(a) as Partial<{ railW: number; sideW: number; railHidden: boolean; sideHidden: boolean }>
      if (typeof s.railW === 'number') railW.value = clampNum(s.railW, 40, 96)
      if (typeof s.sideW === 'number') sideW.value = clampNum(s.sideW, 240, 640)
      railHidden.value = !!s.railHidden
      sideHidden.value = !!s.sideHidden
    }
    const c = localStorage.getItem(TERM_KEY)
    if (c) {
      const s = JSON.parse(c) as Partial<{ termMode: TermMode; termH: number }>
      if (s.termMode === 'off' || s.termMode === 'pane' || s.termMode === 'full') termMode.value = s.termMode
      if (typeof s.termH === 'number') termH.value = clampNum(s.termH, 120, 900)
    }
    const b = localStorage.getItem(CODE_KEY)
    if (b) {
      const s = JSON.parse(b) as Partial<{ treeW: number; treeHidden: boolean }>
      if (typeof s.treeW === 'number') treeW.value = clampNum(s.treeW, 160, 480)
      treeHidden.value = !!s.treeHidden
    }
  } catch {
    /* 存的东西坏了就用默认值——布局存不住不该让整页崩 */
  }
}

export function saveLayout() {
  try {
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        railW: railW.value,
        sideW: sideW.value,
        railHidden: railHidden.value,
        sideHidden: sideHidden.value,
      }),
    )
  } catch {
    /* 隐私模式写不进去：忽略 */
  }
}

export function saveCodeLayout() {
  try {
    localStorage.setItem(CODE_KEY, JSON.stringify({ treeW: treeW.value, treeHidden: treeHidden.value }))
  } catch {
    /* 同上 */
  }
}

/* ── 开关 ─────────────────────────────────────────────────────────────── */
export function toggleRail() {
  railHidden.value = !railHidden.value
  saveLayout()
}
export function toggleSide() {
  sideHidden.value = !sideHidden.value
  saveLayout()
}
export function toggleTree() {
  treeHidden.value = !treeHidden.value
  saveCodeLayout()
}

/**
 * 拖动分隔条。`which`：
 *  · `side` 右面板（往左拖变宽）· `rail` 左图标条（往右拖变宽）· `tree` 代码文件树（往右拖变宽）
 * 拖动结束后**只保存对应那一份**，避免把另一份的默认值写回去。
 */
export function startDrag(which: 'side' | 'rail' | 'tree', e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  const x0 = e.clientX
  const w0 = which === 'side' ? sideW.value : which === 'rail' ? railW.value : treeW.value
  const move = (ev: PointerEvent) => {
    const d = ev.clientX - x0
    if (which === 'side') sideW.value = clampNum(w0 - d, 240, 640)
    else if (which === 'rail') railW.value = clampNum(w0 + d, 40, 96)
    else treeW.value = clampNum(w0 + d, 160, 480)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (which === 'tree') saveCodeLayout()
    else saveLayout()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/* ── 终端开关/拖高 ─────────────────────────────────────────────────────── */
export function saveTermLayout() {
  try {
    localStorage.setItem(TERM_KEY, JSON.stringify({ termMode: termMode.value, termH: termH.value }))
  } catch {
    /* 同上 */
  }
}

/** rail 的终端按钮：关 ⇄ 底部面板（用户要的就是"不占整屏"）。再次点击则收起。 */
export function toggleTermPane() {
  termMode.value = termMode.value === 'off' ? 'pane' : 'off'
  saveTermLayout()
}

/** 面板 ⇄ 全屏（面板右上角的最大化按钮 / ⌘⇧J） */
export function toggleTermMax() {
  termMode.value = termMode.value === 'full' ? 'pane' : 'full'
  saveTermLayout()
}

/** 拖底部分割线：**往上拖变高**（clientY 减小 ⇒ 高度增大） */
export function startDragTerm(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  const y0 = e.clientY
  const h0 = termH.value
  const move = (ev: PointerEvent) => {
    termH.value = clampNum(h0 - (ev.clientY - y0), 120, 900)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    saveTermLayout()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
