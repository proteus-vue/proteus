// tests/sidebar-nav-close.test.ts
// ★2026-09-12：p-sidebar「点击后自动收起」语义收窄——只有真实导航项（<a href> / [data-sidebar-close]）
//   才收起抽屉；点击「折叠/展开一级域」等交互控件不再误关（移动端回归修复）。
import { describe, it, expect } from 'vitest'
import { shouldAutoCloseOnClick } from '../src/components/runtime/nav-close'

/** 轻量 DOM 形状 stub（鸭子类型——不依赖 jsdom 元素构造细节） */
function node(tagName: string, attrs: Record<string, string> = {}, parent: unknown = null): unknown {
  const a = attrs
  return {
    tagName,
    parentElement: parent,
    getAttribute: (n: string) => (n in a ? a[n] : null),
  }
}

describe('★侧栏自动收起判定 shouldAutoCloseOnClick', () => {
  it('点在 <a href> 上 → 收起（真导航）', () => {
    expect(shouldAutoCloseOnClick(node('a', { href: '/docs/component/p-grid' }))).toBe(true)
  })

  it('点在 <a href> 的子孙上 → 沿祖先链命中收起', () => {
    const link = node('a', { href: '/x' })
    const span = node('SPAN', {}, link)
    expect(shouldAutoCloseOnClick(span)).toBe(true)
  })

  it('★点在 <button>（一级域折叠）上 → 不收起（回归修复核心）', () => {
    const btn = node('BUTTON', { 'aria-expanded': 'true' })
    const span = node('SPAN', {}, btn)
    expect(shouldAutoCloseOnClick(btn)).toBe(false)
    expect(shouldAutoCloseOnClick(span)).toBe(false)
  })

  it('点在无 href 的 <a> 上 → 不收起（非真导航）', () => {
    expect(shouldAutoCloseOnClick(node('a', {}))).toBe(false)
  })

  it('显式标记 data-sidebar-close 的自定义导航项 → 收起', () => {
    expect(shouldAutoCloseOnClick(node('div', { 'data-sidebar-close': '' }))).toBe(true)
  })

  it('点在侧栏空白容器上 → 不收起', () => {
    const card = node('VIEW')
    const div = node('DIV', {}, card)
    expect(shouldAutoCloseOnClick(div)).toBe(false)
  })

  it('null / 无 tagName 目标 → 不收起（安全兜底）', () => {
    expect(shouldAutoCloseOnClick(null)).toBe(false)
    expect(shouldAutoCloseOnClick(undefined)).toBe(false)
    expect(shouldAutoCloseOnClick({})).toBe(false)
  })

  it('祖先链环（恶意/异常 parentElement 自指）→ 有界不挂死', () => {
    const a = node('DIV')
    ;(a as { parentElement: unknown }).parentElement = a // 自指环
    expect(shouldAutoCloseOnClick(a)).toBe(false)
  })
})
