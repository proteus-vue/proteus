/**
 * Studio 终端快捷键注册表 —— 纯函数单测（决策 #1461）
 *
 * 【这层补什么】UI 判据 ㊿ 走真实键盘验「界面 → IPC → DOM」；这里补的是**分发表本身**：
 *   同一个 ⌘W 在两种 scope 下必须落到两个不同动作、跨 scope 同键不算冲突、
 *   自定义覆盖与三套预设确实改变匹配结果。分发表算错 ⇒ UI 判据可能碰巧绿但换个方案就错。
 */
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIONS, actionOf, chordFromEvent, chordsOf, conflictOf, defaultChordsOf,
  resetAllChords, scopeOf, setChords, setScheme,
} from '../packages/studio/ui/src/keybindings'

const ev = (
  key: string,
  opts: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...opts }) as KeyboardEvent

beforeAll(() => {
  /* 与 keybindings.ts::isMac() 对齐：本机判据在 mac 上跑，Mod = ⌘ */
  vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'MacIntel' })
})
afterEach(() => {
  resetAllChords()
  setScheme('vscode')
})

describe('面板作用域：同键不同动作', () => {
  it('⌘W：终端内关会话，终端外关标签', () => {
    expect(actionOf(ev('w', { metaKey: true }), 'terminal')).toBe('term.close')
    expect(actionOf(ev('w', { metaKey: true }), 'global')).toBe('file.closeTab')
  })
  it('⌘= / ⌘F：终端内是字号与查找，终端外是画布缩放与编辑器查找', () => {
    expect(actionOf(ev('=', { metaKey: true }), 'terminal')).toBe('term.zoomIn')
    expect(actionOf(ev('=', { metaKey: true }), 'global')).toBe('view.zoomIn')
    expect(actionOf(ev('f', { metaKey: true }), 'terminal')).toBe('term.find')
    expect(actionOf(ev('f', { metaKey: true }), 'global')).toBe('editor.findInFile')
  })
  it('终端外完全看不到 terminal 动作（不会偷开会话）', () => {
    expect(actionOf(ev('t', { metaKey: true, shiftKey: true }), 'global')).toBeNull()
    /* vscode 方案下 ⌘1 没有全局动作；切到 JetBrains 才会命中 view.toggleSidebar，仍不是 term.switchTo */
    expect(actionOf(ev('1', { metaKey: true }), 'global')).not.toBe('term.switchTo')
  })
  it('⌘1…⌘9 共用 switchTo；Shift+[ 的 e.key 是 { 也要命中', () => {
    expect(actionOf(ev('1', { metaKey: true }), 'terminal')).toBe('term.switchTo')
    expect(actionOf(ev('9', { metaKey: true }), 'terminal')).toBe('term.switchTo')
    expect(actionOf(ev('{', { metaKey: true, shiftKey: true }), 'terminal')).toBe('term.prevSession')
    expect(actionOf(ev('}', { metaKey: true, shiftKey: true }), 'terminal')).toBe('term.nextSession')
    expect(chordFromEvent(ev('{', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+[')
  })
})

describe('可自定义与冲突检测', () => {
  it('11 个 term.* 都在 ACTIONS 里、且都是 terminal 作用域', () => {
    const ids = ACTIONS.filter((a) => a.group === '终端').map((a) => a.id)
    expect(ids).toHaveLength(11)
    expect(ids.every((id) => scopeOf(id) === 'terminal')).toBe(true)
  })
  it('跨作用域同键不是冲突；同作用域同键才是', () => {
    expect(conflictOf('Mod+W', 'term.close')).toBeNull()
    expect(conflictOf('Mod+=', 'term.zoomIn')).toBeNull()
    expect(conflictOf('Mod+S', 'term.close')).toBeNull()
    expect(conflictOf('Mod+S', 'file.closeTab')).toBe('保存')
  })
  it('自定义覆盖改变匹配，恢复默认后回到出厂键', () => {
    setChords('term.new', ['Mod+Shift+Y'])
    expect(actionOf(ev('y', { metaKey: true, shiftKey: true }), 'terminal')).toBe('term.new')
    expect(actionOf(ev('t', { metaKey: true, shiftKey: true }), 'terminal')).toBeNull()
    setChords('term.new', null)
    expect(actionOf(ev('t', { metaKey: true, shiftKey: true }), 'terminal')).toBe('term.new')
  })
  it('JetBrains 预设的 ⌥F12 只切终端，不再被 term.new 抢走', () => {
    setScheme('jetbrains')
    expect(chordsOf('view.toggleTerminal')).toEqual(['Alt+F12'])
    /* `chordsOf` 会走 normalizeChord 把单字符键小写（冲突检测的设计）；`defaultChordsOf` 给出厂原文 */
    expect(chordsOf('term.new')).toEqual(['Mod+Shift+t'])
    expect(defaultChordsOf('term.new')).toEqual(['Mod+Shift+T'])
  })
})
