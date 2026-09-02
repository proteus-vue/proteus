// packages/desktop/src/directives.ts
// ★G-24 B1（proteus-semantic-primitives-plan 03）：Vue 指令工厂——v-p-hover / v-p-context-menu / v-p-shortcut / v-p-focus-trap
//   Web 官方接线（同 gesture 包 createGestureDirective 模式）；MP 端不注册指令（桌面交互无对等——天然降级）
//   指令层薄（DOM 绑定）+ 纯逻辑在 shortcut/focus-trap/context-menu/hover 模块（可单测）
import type { Directive } from 'vue'
import { parseShortcutExpr, matchShortcut, shortcutLabel } from './shortcut'
import { createFocusTrap } from './focus-trap'
import { buildContextMenu, menuPointFrom } from './context-menu'
import { resolveHoverClass } from './hover'
import type { MenuItem } from './context-menu'

export interface ShortcutDirectiveValue {
  /** 快捷键表达式（"mod+s:save"——id 段 = 触发语义） */
  expr: string
  /** 命中回调（或组件 @click 由 id 对应：指令层只 emit 语义字符串给宿主） */
  handler?: (id: string) => void
  platform?: string
}

export interface ContextMenuDirectiveValue {
  items: MenuItem[]
  onSelect?: (value: string | undefined) => void
}

/** 菜单 DOM（指令层内部——thin 渲染层） */
interface MenuDom {
  el: HTMLDivElement
  destroy: () => void
}

/**
 * p-hover：悬停态（mouseenter/mouseleave → hover class）
 * 用法：<div v-p-hover="'lift'">
 */
export function createHoverDirective(): Directive<HTMLElement, string> {
  function applyClass(el: HTMLElement, preset: string): void {
    const base = el.className
    const cls = resolveHoverClass(preset)
    // 清理旧 p-hover-* 类
    const cleaned = base.split(' ').filter((c) => !c.startsWith('p-hover-')).join(' ')
    el.className = (cleaned + (cls ? ' ' + cls : '')).trim()
  }
  return {
    mounted(el, binding) {
      const preset = binding.value || 'brighten'
      const onEnter = () => applyClass(el, preset)
      const onLeave = () => applyClass(el, '')
      el.addEventListener('mouseenter', onEnter)
      el.addEventListener('mouseleave', onLeave)
      ;(el as HTMLElement & { __p_hover_leave?: () => void }).__p_hover_leave = onLeave
    },
    updated(el, binding) {
      applyClass(el, binding.value || 'brighten')
    },
    unmounted(el) {
      const leave = (el as HTMLElement & { __p_hover_leave?: () => void }).__p_hover_leave
      if (leave) el.removeEventListener('mouseleave', leave)
    },
  }
}

/**
 * p-shortcut：全局键盘快捷键（keydown 命中 → handler(id)；mod 平台惯例自动遵循）
 * 用法：<button v-p-shortcut="{ expr: 'mod+s:save', handler: (id) => save() }">保存</button>
 */
export function createShortcutDirective(): Directive<HTMLElement, ShortcutDirectiveValue> {
  return {
    mounted(el, binding) {
      const state = binding.value
      const platform = (state && state.platform) || (typeof navigator !== 'undefined' ? navigator.platform : 'web')
      const onKey = (e: KeyboardEvent) => {
        if (!state || !state.expr) return
        const parsed = parseShortcutExpr(state.expr)
        if (!parsed) return
        if (matchShortcut(e, parsed.keys)) {
          if (e.preventDefault) e.preventDefault()
          if (state.handler) state.handler(parsed.id ?? '')
        }
      }
      window.addEventListener('keydown', onKey)
      ;(el as HTMLElement & { __p_shortcut_key?: (e: KeyboardEvent) => void }).__p_shortcut_key = onKey
      // 菜单栏提示（可访问性——title 展示 ⌘S / Ctrl+S）
      const label = state && state.expr ? shortcutLabel(state.expr, platform) : ''
      if (label && state) {
        const prev = el.getAttribute('title') ?? ''
        el.setAttribute('title', prev ? `${prev} (${label})` : label)
      }
    },
    unmounted(el) {
      const key = (el as HTMLElement & { __p_shortcut_key?: (e: KeyboardEvent) => void }).__p_shortcut_key
      if (key) window.removeEventListener('keydown', key)
    },
  }
}

/**
 * p-focus-trap：焦点陷阱（Tab 循环 + Shift+Tab 反向 + 打开聚焦首项 + 关闭恢复）
 * 用法：<div v-p-focus-trap>...</div>（弹窗无障碍）
 */
export function createFocusTrapDirective(): Directive<HTMLElement> {
  return {
    mounted(el) {
      const trap = createFocusTrap(el, {
        getActiveElement: () => (document.activeElement as HTMLElement | null) ?? undefined,
      })
      trap.focusFirst()
      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Tab') trap.trapTab(e)
      }
      el.addEventListener('keydown', onKeydown)
      ;(el as HTMLElement & { __p_trap?: { stop: () => void } }).__p_trap = {
        stop: () => {
          el.removeEventListener('keydown', onKeydown)
          trap.restore()
          trap.destroy()
        },
      }
    },
    unmounted(el) {
      const t = (el as HTMLElement & { __p_trap?: { stop: () => void } }).__p_trap
      if (t) t.stop()
    },
  }
}

/**
 * p-context-menu：右键菜单（contextmenu → 防溢出定位菜单；点击/失焦销毁）
 * 用法：<div v-p-context-menu="{ items: [{ label: '编辑', value: 'edit' }], onSelect: (v) => ... }">
 */
export function createContextMenuDirective(): Directive<HTMLElement, ContextMenuDirectiveValue> {
  function destroyMenu(menu: MenuDom | undefined): MenuDom | undefined {
    if (menu) menu.destroy()
    return undefined
  }
  return {
    mounted(el, binding) {
      let menu: MenuDom | undefined
      const close = () => {
        menu = destroyMenu(menu)
      }
      const onContext = (e: MouseEvent) => {
        e.preventDefault()
        if (!binding.value || !binding.value.items || binding.value.items.length === 0) return
        const point = menuPointFrom(e.clientX, e.clientY)
        const dom = renderMenu(binding.value.items, point, (value) => {
          if (binding.value && binding.value.onSelect) binding.value.onSelect(value)
          close()
        })
        menu = dom
      }
      el.addEventListener('contextmenu', onContext)
      ;(el as HTMLElement & { __p_menu_close?: () => void }).__p_menu_close = close

      /** thin 渲染：fixed 定位菜单（buildContextMenu 纯逻辑定位） */
      function renderMenu(items: MenuItem[], point: { x: number; y: number }, onPick: (v: string | undefined) => void): MenuDom {
        const width = 160
        const height = items.length * 36 + 8
        const pos = buildContextMenu(items, point, { width, height }, typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight } : undefined)
        const wrap = document.createElement('div')
        wrap.style.cssText = `position:fixed;left:${pos.x}px;top:${pos.y}px;z-index:9999;min-width:${width}px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:4px;font-size:13px;color:#1f2328;`
        for (const item of items) {
          const row = document.createElement('button')
          row.type = 'button'
          row.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 10px;border:none;background:transparent;border-radius:6px;cursor:pointer;font:inherit;'
          row.textContent = item.label
          row.style.color = item.danger === true ? '#d92d20' : '#1f2328'
          if (item.disabled === true) {
            row.disabled = true
            row.style.opacity = '0.4'
            row.style.cursor = 'default'
          }
          row.addEventListener('click', () => onPick(item.value))
          wrap.appendChild(row)
        }
        document.body.appendChild(wrap)
        const onDocClick = () => close()
        const onDocKey = (ke: KeyboardEvent) => {
          if (ke.key === 'Escape') close()
        }
        document.addEventListener('click', onDocClick)
        document.addEventListener('keydown', onDocKey)
        return {
          el: wrap,
          destroy: () => {
            wrap.remove()
            document.removeEventListener('click', onDocClick)
            document.removeEventListener('keydown', onDocKey)
          },
        }
      }
    },
    unmounted(el) {
      const close = (el as HTMLElement & { __p_menu_close?: () => void }).__p_menu_close
      if (close) close()
    },
  }
}

/** ★G-24 B1：四指令工厂集（main.ts：Object.entries 注册 v-p-*） */
export function createDesktopDirectives(): Record<string, Directive> {
  return {
    'p-hover': createHoverDirective(),
    'p-shortcut': createShortcutDirective(),
    'p-focus-trap': createFocusTrapDirective(),
    'p-context-menu': createContextMenuDirective(),
  }
}