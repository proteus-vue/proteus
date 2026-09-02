// packages/desktop/src/focus-trap.ts
// ★G-24 B1（proteus-semantic-primitives-plan 03 §4 p-focus-trap）：焦点陷阱纯逻辑（无障碍刚需）
//   · Tab 在容器内循环、Shift+Tab 反向（验收清单）
//   · 打开时聚焦首元素、关闭时恢复先前焦点（弹窗无障碍标准）
//   · 注入式：queryFocusable（Web 可用 el.querySelectorAll('a[href],button,...')；测试可注入 fake 列表）
//   纯逻辑零 DOM 依赖（元素形状注入）；MP 产物安全：无 ?. / ??；无数组解构
export interface FocusableElement {
  focus(): void
  disabled?: boolean
  tabIndex?: number
  offsetWidth?: number
  offsetHeight?: number
}

export interface FocusTrapOptions {
  /** 可聚焦元素查询（注入——Web selector 集 / 测试 fake） */
  queryFocusable?: () => FocusableElement[]
  /** 首元素 fallback（缺省聚焦元素时） */
  initialRef?: FocusableElement | null
  /** 当前活动元素读取（restore 用——注入 document.activeElement 形状 / 测试 fake） */
  getActiveElement?: () => FocusableElement | undefined
}

export interface FocusTrap {
  /** 当前可聚焦元素列表（每次 trapTab 前刷新——DOM 变化容忍） */
  refresh(): FocusableElement[]
  /** 聚焦首个可聚焦元素（打开时调） */
  focusFirst(): FocusableElement | undefined
  /** Tab/Shift+Tab 循环处理（keydown Tab 事件注入形状——Web KeyboardEvent 子集） */
  trapTab(e: { shiftKey?: boolean; preventDefault?: () => void }): boolean
  /** 恢复先前焦点（关闭时调） */
  restore(): void
  /** 销毁（清引用） */
  destroy(): void
}

const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** 可聚焦选择器（默认查询集——Web 标准 focusable 元素） */
export { FOCUSABLE_SELECTOR }

/**
 * ★createFocusTrap：焦点陷阱（Tab 在容器内循环、Shift+Tab 反向；打开聚焦首项、关闭恢复先前焦点）
 * 用法（p-focus-trap 指令底层）：const trap = createFocusTrap(el, { queryFocusable: () => el.querySelectorAll(FOCUSABLE_SELECTOR) })
 * 设计：纯逻辑游标（currentIndex 循环 ±1）——不依赖真实 focus 事件，元素形状注入可单测
 */
export function createFocusTrap(root: unknown, options: FocusTrapOptions = {}): FocusTrap {
  const queryFocusable = options.queryFocusable ?? (() => {
    const el = root as { querySelectorAll?: (sel: string) => ArrayLike<FocusableElement> }
    if (!el || typeof el.querySelectorAll !== 'function') return []
    return Array.from(el.querySelectorAll(FOCUSABLE_SELECTOR))
  })
  const getActiveElement = options.getActiveElement ?? (() => undefined)
  let focusables: FocusableElement[] = []
  let index = -1
  let previous: FocusableElement | undefined

  function refresh(): FocusableElement[] {
    focusables = queryFocusable().filter(isFocusable)
    if (index >= focusables.length) index = focusables.length - 1
    return focusables
  }

  /** 可聚焦判定：非禁用 + 有尺寸或显式 tabIndex（隐藏元素不进入循环） */
  function isFocusable(f: FocusableElement): boolean {
    if (f.disabled === true) return false
    if (typeof f.tabIndex === 'number' && f.tabIndex < 0) return false
    if (typeof f.offsetWidth === 'number' && typeof f.offsetHeight === 'number') {
      if (f.offsetWidth === 0 && f.offsetHeight === 0) return false
    }
    return true
  }

  function focusAt(i: number): FocusableElement | undefined {
    if (i < 0 || i >= focusables.length) return undefined
    focusables[i].focus()
    index = i
    return focusables[i]
  }

  return {
    refresh,
    focusFirst() {
      // 记录先前焦点（restore 用）——注入 getActiveElement 源
      previous = getActiveElement() ?? undefined
      refresh()
      index = -1
      return focusAt(0)
    },
    trapTab(e) {
      const list = refresh()
      if (list.length === 0) return false
      if (e.shiftKey === true) {
        // Shift+Tab 反向循环
        const next = index <= 0 ? list.length - 1 : index - 1
        if (e.preventDefault) e.preventDefault()
        focusAt(next)
        return true
      }
      const next = index >= list.length - 1 ? 0 : index + 1
      if (e.preventDefault) e.preventDefault()
      focusAt(next)
      return true
    },
    restore() {
      if (previous && typeof previous.focus === 'function') previous.focus()
    },
    destroy() {
      focusables = []
      previous = undefined
    },
  }
}