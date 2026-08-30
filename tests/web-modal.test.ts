// tests/web-modal.test.ts
// ★WeUI 三种对话框样式（14-mp-first-semantics 批次4）：双按钮（默认）/ 单按钮（showCancel:false）/ 可输入（editable:true）
// 覆盖：结构（按钮数/输入框/无标题）、文案（cancelText/confirmText）、颜色（cancelColor/confirmColor）、
//       editable 返回 { confirm, content }、点蒙层取消、resolve 后 DOM 清理
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// wx.ts import { adapter } from '@proteus-vue/shared'——mock 掉平台适配器
const { adapterMock } = vi.hoisted(() => ({
  adapterMock: {
    navigateTo: vi.fn(() => Promise.resolve()),
    redirectTo: vi.fn(() => Promise.resolve()),
    reLaunch: vi.fn(() => Promise.resolve()),
    switchTab: vi.fn(() => Promise.resolve()),
    navigateBack: vi.fn(),
    getCurrentPages: vi.fn(() => []),
  },
}))
vi.mock('@proteus-vue/shared', () => ({ adapter: adapterMock }))

import { wx } from '../packages/web/src/wx'

describe('wx.showModal WeUI 三种对话框样式', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    adapterMock.navigateTo.mockClear()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  /** 触发指定按钮点击并返回 resolve 结果 */
  it('样式一：双按钮对话框（默认）——取消/确定 + 标题内容', async () => {
    const p = wx.showModal({ title: '提示', content: '内容文字' })
    expect(document.querySelector('.pwu-modal-title')?.textContent).toBe('提示')
    expect(document.querySelector('.pwu-modal-content')?.textContent).toBe('内容文字')
    const btns = document.querySelectorAll('.pwu-modal-btn')
    expect(btns.length).toBe(2)
    expect(btns[0].textContent).toBe('取消')
    expect(btns[1].textContent).toBe('确定')
    // 无输入框
    expect(document.querySelector('.pwu-modal-input')).toBeNull()
    // 无标题修饰类
    expect(document.querySelector('.proteus-web-modal')?.classList.contains('pwu-modal--no-title')).toBe(false)
    ;(btns[1] as HTMLElement).click()
    const r = await p
    // ★返回对齐小程序：{ confirm, cancel, errMsg }（confirm/cancel 互补）
    expect(r).toEqual({ confirm: true, cancel: false, errMsg: 'showModal:ok' })
  })

  it('样式二：单按钮对话框（showCancel:false）——仅确定', async () => {
    const p = wx.showModal({ title: '提示', content: '仅确认', showCancel: false })
    const btns = document.querySelectorAll('.pwu-modal-btn')
    expect(btns.length).toBe(1)
    expect(btns[0].textContent).toBe('确定')
    ;(btns[0] as HTMLElement).click()
    expect(await p).toEqual({ confirm: true, cancel: false, errMsg: 'showModal:ok' })
  })

  it('样式三：可输入对话框（editable:true）——输入框 + placeholder + 返回 content', async () => {
    const p = wx.showModal({ title: '请输入', content: '昵称', editable: true, placeholderText: '请输入昵称' })
    const input = document.querySelector('.pwu-modal-input') as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.getAttribute('placeholder')).toBe('请输入昵称')
    input!.value = 'proteus'
    ;(document.querySelector('.pwu-modal-btn--confirm') as HTMLElement).click()
    const r = await p
    expect(r).toEqual({ confirm: true, cancel: false, errMsg: 'showModal:ok', content: 'proteus' })
  })

  it('自定义文案/颜色（cancelText/confirmText/cancelColor/confirmColor）', () => {
    void wx.showModal({
      title: 't',
      cancelText: '不',
      confirmText: '好',
      cancelColor: '#ff0000',
      confirmColor: '#00ff00',
    })
    const [cancel, confirm] = document.querySelectorAll('.pwu-modal-btn')
    expect(cancel.textContent).toBe('不')
    expect(confirm.textContent).toBe('好')
    expect((cancel as HTMLElement).style.color).toBe('rgb(255, 0, 0)')
    expect((confirm as HTMLElement).style.color).toBe('rgb(0, 255, 0)')
  })

  it('无标题对话框：内容上下对称居中 + 黑色文字（pwu-modal--no-title，样式由 CSS 驱动）', () => {
    void wx.showModal({ content: '仅内容' })
    const modal = document.querySelector('.proteus-web-modal')
    expect(modal?.classList.contains('pwu-modal--no-title')).toBe(true)
    expect(document.querySelector('.pwu-modal-title')).toBeNull()
    // 样式（对称 padding + 黑色）由 .pwu-modal--no-title .pwu-modal-content 驱动——CDP 实测验证
  })

  it('取消按钮/蒙层 → confirm:false + cancel:true；点蒙层同样', async () => {
    const p1 = wx.showModal({ title: 't' })
    ;(document.querySelector('.pwu-modal-btn--cancel') as HTMLElement).click()
    expect(await p1).toEqual({ confirm: false, cancel: true, errMsg: 'showModal:ok' })
    const p2 = wx.showModal({ title: 't' })
    ;(document.querySelector('.proteus-web-ui-mask') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(await p2).toEqual({ confirm: false, cancel: true, errMsg: 'showModal:ok' })
  })

  it('resolve 后 DOM 清理（mask/modal 移除）', async () => {
    const p = wx.showModal({ title: 't' })
    ;(document.querySelector('.pwu-modal-btn--confirm') as HTMLElement).click()
    await p
    expect(document.querySelector('.proteus-web-modal')).toBeNull()
    expect(document.querySelector('.proteus-web-ui-mask')).toBeNull()
  })

  it('showToast 微信语义：默认 icon success + toast 图标样式（success 无底色白勾 / error 白圆底黑叹号）', () => {
    wx.showToast({ title: '默认' })
    // success：SVG 白色勾（stroke #ffffff），无 pwu-icon-success 底色类
    const okEl = document.querySelector('.proteus-web-toast')
    const okSvg = okEl?.querySelector('svg') as SVGSVGElement | null
    expect(okSvg).not.toBeNull()
    expect(okSvg?.getAttribute('stroke')).toBe('#ffffff')
    expect(okEl?.querySelector('.pwu-icon-success')).toBeNull()
    document.body.innerHTML = ''
    // error：SVG 白圆底（circle fill #ffffff）+ 黑叹号（rect fill #000000）
    wx.showToast({ title: '失败', icon: 'error' })
    const errEl = document.querySelector('.proteus-web-toast')
    const errSvg = errEl?.querySelector('svg') as SVGSVGElement | null
    expect(errSvg).not.toBeNull()
    expect(errSvg?.querySelector('circle')?.getAttribute('fill')).toBe('#ffffff')
    expect(errSvg?.querySelector('rect')?.getAttribute('fill')).toBe('#000000')
    document.body.innerHTML = ''
    // icon:'none' → 无图标
    wx.showToast({ title: 'none', icon: 'none' })
    expect(document.querySelector('.proteus-web-toast .pwu-icon')).toBeNull()
    document.body.innerHTML = ''
    // 显式 loading → spinner
    wx.showToast({ title: '加载', icon: 'loading' })
    expect(document.querySelector('.proteus-web-toast .pwu-icon-loading')).not.toBeNull()
    document.body.innerHTML = ''
    wx.hideToast()
  })
})
