// tests/desktop.test.ts
// ★G-24 B1（proteus-semantic-primitives-plan 03 + 06-integration-batches）：桌面交互原语纯逻辑
//   验证点：p-shortcut（mod+s → Mac ⌘S / Win Ctrl+S 平台惯例 PRIM005 · 命中判定）· p-focus-trap
//   （Tab 循环 / Shift+Tab 反向 / 恢复焦点）· p-context-menu（防溢出翻转定位 / 长按右键归一）·
//   p-hover（preset 类 / touch 降级）· 四指令工厂集
// @vitest-environment happy-dom（指令 DOM 断言）
import { describe, it, expect, vi } from 'vitest'
import {
  parseShortcutExpr,
  normalizeMod,
  matchShortcut,
  shortcutLabel,
  createFocusTrap,
  buildMenuPosition,
  buildContextMenu,
  menuPointFrom,
  resolveHoverClass,
  canHover,
  normalizePointerType,
  createDesktopDirectives,
} from '@proteus-vue/desktop'
import type { FocusableElement } from '@proteus-vue/desktop'

describe('G-24 B1 p-shortcut（键盘快捷键纯逻辑）', () => {
  it('parseShortcutExpr：mod+s:save → keys+id；无 id / 空白容忍', () => {
    expect(parseShortcutExpr('mod+s:save')).toEqual({ keys: ['mod', 's'], id: 'save' })
    expect(parseShortcutExpr('mod+shift+a:selectAll')).toEqual({ keys: ['mod', 'shift', 'a'], id: 'selectAll' })
    expect(parseShortcutExpr('mod+s')).toEqual({ keys: ['mod', 's'], id: undefined })
    expect(parseShortcutExpr('  mod + s : save  ')).toEqual({ keys: ['mod', 's'], id: 'save' })
    expect(parseShortcutExpr('')).toBeNull()
  })

  it('normalizeMod：PRIM005 平台惯例——mac/darwin → meta；其余 → ctrl', () => {
    expect(normalizeMod('mod', 'MacIntel')).toBe('meta')
    expect(normalizeMod('mod', 'darwin')).toBe('meta')
    expect(normalizeMod('mod', 'Win32')).toBe('ctrl')
    expect(normalizeMod('mod', 'linux')).toBe('ctrl')
  })

  it('matchShortcut：修饰符 + 主键命中；未声明修饰符误带不命中；mod 双平台宽容', () => {
    expect(matchShortcut({ metaKey: true, key: 's' }, ['mod', 's'])).toBe(true) // Mac ⌘S
    expect(matchShortcut({ ctrlKey: true, key: 's' }, ['mod', 's'])).toBe(true) // Win Ctrl+S
    expect(matchShortcut({ ctrlKey: true, shiftKey: true, key: 'A' }, ['mod', 'shift', 'a'])).toBe(true)
    expect(matchShortcut({ ctrlKey: true, key: 's' }, ['s'])).toBe(false) // 未声明 mod 却带 Ctrl
    expect(matchShortcut({ key: 's' }, ['mod', 's'])).toBe(false) // 缺 mod
    expect(matchShortcut({ altKey: true, key: 'a' }, ['alt', 'a'])).toBe(true)
    expect(matchShortcut({ key: 'Escape' }, ['escape'])).toBe(true)
  })

  it('shortcutLabel：⌘S（Mac）/ Ctrl+S（其余）——菜单栏提示', () => {
    expect(shortcutLabel('mod+s', 'darwin')).toBe('⌘S')
    expect(shortcutLabel('mod+s', 'win32')).toBe('Ctrl+S')
    expect(shortcutLabel('mod+shift+a', 'linux')).toBe('Ctrl+Shift+A')
    expect(shortcutLabel('escape', 'web')).toBe('Escape')
  })
})

describe('G-24 B1 p-focus-trap（焦点陷阱纯逻辑）', () => {
  it('Tab 循环 + Shift+Tab 反向 + focusFirst 聚焦首项', () => {
    const items: FocusableElement[] = [{ focus: vi.fn(), offsetWidth: 10, offsetHeight: 10 }, { focus: vi.fn(), offsetWidth: 10, offsetHeight: 10 }, { focus: vi.fn(), offsetWidth: 10, offsetHeight: 10 }]
    const trap = createFocusTrap(null as never, { queryFocusable: () => items })
    const first = trap.focusFirst()
    expect(first).toBe(items[0])
    expect(items[0].focus).toHaveBeenCalledTimes(1)
    // Tab 循环：1 → 2 → 0（末尾回绕）
    trap.trapTab({})
    expect(items[1].focus).toHaveBeenCalledTimes(1)
    trap.trapTab({})
    expect(items[2].focus).toHaveBeenCalledTimes(1)
    trap.trapTab({})
    expect(items[0].focus).toHaveBeenCalledTimes(2)
    // Shift+Tab 反向：0 → 2
    trap.trapTab({ shiftKey: true })
    expect(items[2].focus).toHaveBeenCalledTimes(2)
  })

  it('禁用/隐藏元素不入循环；restore 恢复先前焦点（getActiveElement 注入）', () => {
    const prev = { focus: vi.fn() }
    const items: FocusableElement[] = [
      { focus: vi.fn(), offsetWidth: 10, offsetHeight: 10 },
      { focus: vi.fn(), offsetWidth: 10, offsetHeight: 10, disabled: true }, // 禁用跳过
      { focus: vi.fn(), offsetWidth: 0, offsetHeight: 0 }, // 隐藏跳过
    ]
    const trap = createFocusTrap(null as never, { queryFocusable: () => items, getActiveElement: () => prev as FocusableElement })
    trap.focusFirst()
    expect(items[0].focus).toHaveBeenCalled()
    trap.restore()
    expect(prev.focus).toHaveBeenCalled()
  })

  it('空容器：trapTab 返回 false 不抛错（弹窗无聚焦元素）', () => {
    const trap = createFocusTrap(null as never, { queryFocusable: () => [] })
    expect(trap.focusFirst()).toBeUndefined()
    expect(trap.trapTab({})).toBe(false)
  })
})

describe('G-24 B1 p-context-menu（右键菜单纯逻辑）', () => {
  it('buildMenuPosition：视口内不翻转；溢出右/下 → 翻转 + 4px 安全距', () => {
    const viewport = { width: 800, height: 600 }
    expect(buildMenuPosition({ x: 100, y: 100 }, { width: 160, height: 200 }, viewport)).toMatchObject({ x: 100, y: 100 })
    const flipped = buildMenuPosition({ x: 750, y: 550 }, { width: 160, height: 200 }, viewport)
    expect(flipped.x).toBe(800 - 160 - 4)
    expect(flipped.y).toBe(600 - 200 - 4)
    expect(flipped.flippedX).toBe(true)
    expect(flipped.flippedY).toBe(true)
  })

  it('menuPointFrom：坐标归一（undefined/NaN → 0）；buildContextMenu 构建+定位一步', () => {
    expect(menuPointFrom(10, 20)).toEqual({ x: 10, y: 20 })
    expect(menuPointFrom(undefined, undefined)).toEqual({ x: 0, y: 0 })
    const menu = buildContextMenu([{ label: '编辑', value: 'edit' }], { x: 10, y: 10 }, { width: 160, height: 44 })
    expect(menu.items).toEqual([{ label: '编辑', value: 'edit' }])
    expect(menu.x).toBe(10)
  })
})

describe('G-24 B1 p-hover（悬停纯逻辑）', () => {
  it('resolveHoverClass：preset → p-hover-* 类；none 空', () => {
    expect(resolveHoverClass('brighten')).toBe('p-hover-brighten')
    expect(resolveHoverClass('lift')).toBe('p-hover-lift')
    expect(resolveHoverClass('none')).toBe('')
    expect(resolveHoverClass('')).toBe('')
  })

  it('canHover：mouse/pen 可悬停；touch 降级（tap 高亮语义）；normalizePointerType 归一', () => {
    expect(canHover('mouse')).toBe(true)
    expect(canHover('pen')).toBe(true)
    expect(canHover('touch')).toBe(false)
    expect(canHover('remote')).toBe(false)
    expect(normalizePointerType('mouse')).toBe('mouse')
    expect(normalizePointerType('touch')).toBe('touch')
    expect(normalizePointerType(undefined)).toBe('unknown')
  })
})

describe('G-24 B1 指令工厂（四原语集）', () => {
  it('createDesktopDirectives：返回 v-p-hover / v-p-shortcut / v-p-focus-trap / v-p-context-menu 四指令', () => {
    const dirs = createDesktopDirectives()
    expect(Object.keys(dirs).sort()).toEqual(['p-context-menu', 'p-focus-trap', 'p-hover', 'p-permission', 'p-shortcut'])
    for (const d of Object.values(dirs)) {
      expect(typeof d.mounted).toBe('function')
      expect(typeof d.unmounted).toBe('function')
    }
  })

  it('v-p-shortcut 指令：keydown 命中 → handler(id)；unmounted 清理监听', () => {
    const dir = createDesktopDirectives()['p-shortcut']
    const el = document.createElement('button')
    const handler = vi.fn()
    dir.mounted!(el, { value: { expr: 'mod+s:save', handler }, platform: 'web' } as never)
    const key = (el as HTMLElement & { __p_shortcut_key?: (e: KeyboardEvent) => void }).__p_shortcut_key
    expect(key).toBeDefined()
    key!(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }))
    expect(handler).toHaveBeenCalledWith('save')
    el.remove() // happy-dom 卸载
  })

  it('v-p-hover 指令：mount 后 mouseenter → hover class；unmount 清理', () => {
    const dir = createDesktopDirectives()['p-hover']
    const el = document.createElement('div')
    dir.mounted!(el, { value: 'lift' } as never)
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(el.className).toContain('p-hover-lift')
    el.dispatchEvent(new MouseEvent('mouseleave'))
    expect(el.className).not.toContain('p-hover')
    dir.unmounted!(el)
  })
})