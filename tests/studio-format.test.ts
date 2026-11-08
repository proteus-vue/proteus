/**
 * Studio 格式化快捷键 —— 纯函数单测（决策 #1462）
 *
 * 【这层补什么】UI 判据 ㊿c 用 Playwright 的 CDP 按键验「界面 → IPC → buffer」，
 *   但 CDP 给的是干净的 `e.key='F'`；**真 macOS 按 ⌥F 时 e.key 是 `ƒ`**。
 *   若 `keyOf` 只比 `e.key`，UI 判据会绿、真机却永远按不动格式化 ⇒ 正是本仓
 *   「判据通过 ≠ 功能可用」纪律要防的假绿。这里直接构造被 Option 改写过的事件。
 */
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { actionOf, chordFromEvent, chordsOf, conflictOf, resetAllChords, setScheme } from '../packages/studio/ui/src/keybindings'

type EvOpts = Partial<{
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  code: string
}>
const ev = (key: string, opts: EvOpts = {}) =>
  ({ key, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...opts }) as KeyboardEvent

beforeAll(() => {
  vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'MacIntel' })
})
afterEach(() => {
  resetAllChords()
  setScheme('vscode')
})

describe('格式化文档键位', () => {
  it('VS Code ⇧⌥F：真机 Option 改写字符后仍按物理键码命中', () => {
    expect(actionOf(ev('ƒ', { shiftKey: true, altKey: true, code: 'KeyF' }), 'global')).toBe('editor.formatDocument')
  })
  it('CDP/非 mac 的干净 e.key 也能命中（同一条规则不能只照顾一边）', () => {
    expect(actionOf(ev('F', { shiftKey: true, altKey: true, code: 'KeyF' }), 'global')).toBe('editor.formatDocument')
  })
  it('不带 Alt 的 F 不得误触发格式化', () => {
    expect(actionOf(ev('f', { shiftKey: true, code: 'KeyF' }), 'global')).not.toBe('editor.formatDocument')
  })
  it('JetBrains 预设改成 ⌥⌘L，⇧⌥F 不再命中', () => {
    setScheme('jetbrains')
    expect(chordsOf('editor.formatDocument')).toEqual(['Mod+Alt+l'])
    expect(actionOf(ev('¬', { metaKey: true, altKey: true, code: 'KeyL' }), 'global')).toBe('editor.formatDocument')
    expect(actionOf(ev('ƒ', { shiftKey: true, altKey: true, code: 'KeyF' }), 'global')).not.toBe('editor.formatDocument')
  })
  it('⇧⌥F 与已有动作不冲突，录制出来的 chord 可回写注册表', () => {
    expect(conflictOf('Shift+Alt+F', 'editor.formatDocument')).toBeNull()
    expect(chordFromEvent(ev('ƒ', { shiftKey: true, altKey: true, code: 'KeyF' }))).toBe('Alt+Shift+f')
  })
})
