// tests/web-picker.test.ts
// ★18-picker-swiper B1：picker selector Web 模拟——点击触发半屏弹层、change 载荷对齐微信
// ★2026-08-30 重构：对齐 weui.io/#form_select_primary 官方——左上关闭按钮 + 居中标题 + indicator 灰条 + translate3d 平移
// 注：滚动/拖拽选中依赖真实布局（offsetTop/scrollTop），jsdom 无法模拟——交互由 CDP 实测验证
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, reactive } from 'vue'
import { WebPicker } from '../packages/web/src/components/picker'

describe('WebPicker（selector 单选，18-picker-swiper B1）', () => {
  let app: ReturnType<typeof createApp> | null = null
  let host: HTMLElement | null = null
  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
  })
  afterEach(() => {
    app?.unmount()
    document.body.innerHTML = ''
    app = null
    host = null
  })

  /** 挂载：range 数组 + change 监听，渲染为可点击容器（Vue 渲染器真实挂载）
   * value === undefined 时 props 不含 value（对齐'无 value 默认中间项'语义） */
  function mountPicker(range: unknown[], value?: number, rangeKey?: string, title?: string) {
    const state = reactive({ picked: -1, cancelled: 0 })
    const props: Record<string, unknown> = { range, rangeKey, title }
    if (value !== undefined) props.value = value
    const Root = {
      setup() {
        return () =>
          h(
            WebPicker,
            {
              ...props,
              onChange: (e: { detail: { value: number } }) => {
                state.picked = e.detail.value
              },
              onCancel: () => {
                state.cancelled++
              },
            },
            {
              default: () => [h('span', {}, `picked:${state.picked}`)],
            },
          )
      },
    }
    app = createApp(Root)
    app.mount(host!)
    return state
  }

  it('点击容器 → 打开半屏弹层（左上关闭 + 居中标题 + 滚轮区 + 底部确定）', () => {
    mountPicker(['甲', '乙', '丙'], 0, undefined, '单列选择器')
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    const sheet = document.querySelector('.proteus-web-picker-sheet')
    expect(sheet).not.toBeNull()
    // 官方结构：关闭按钮 + 标题 + indicator + mask + content + 底部确定
    expect(sheet?.querySelector('.pwp-close')).not.toBeNull()
    expect(sheet?.querySelector('.pwp-close-icon')?.getAttribute('width')).toBe('24')
    expect(sheet?.querySelector('.pwp-title')?.textContent).toBe('单列选择器')
    expect(sheet?.querySelector('.pwp-indicator')).not.toBeNull()
    expect(sheet?.querySelector('.pwp-picker-mask')).not.toBeNull()
    expect(sheet?.querySelector('.pwp-confirm')?.textContent).toBe('确定')
    const texts = [...(sheet?.querySelectorAll('.pwp-item') ?? [])].map((el) => el.textContent)
    expect(texts).toEqual(['甲', '乙', '丙'])
  })

  it('range-key：对象数组取字段文本', () => {
    mountPicker([{ n: '北京' }, { n: '上海' }], 1, 'n')
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    const texts = [...document.querySelectorAll('.pwp-item')].map((el) => el.textContent)
    expect(texts).toEqual(['北京', '上海'])
  })

  it('无 value 时默认选中中间项（weui 官方：Math.floor(n/2)）', () => {
    // value 显式传 undefined（区别于默认 0）
    mountPicker(['甲', '乙', '丙', '丁', '戊']) // 5 项 → 中间 index 2
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    const selected = document.querySelector('.pwp-item.is-selected')
    expect(selected?.textContent).toBe('丙')
  })

  it('确定 → change { detail: { value: 选中索引 } } + 关闭弹层（动画后移除）', async () => {
    const state = mountPicker(['甲', '乙', '丙'])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    // 无 value → 默认选中中间项（3 项 → index 1）
    ;(document.querySelector('.pwp-confirm') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 350)) // 关闭动画 0.3s 后移除
    expect(document.querySelector('.proteus-web-picker-sheet')).toBeNull()
    expect(document.querySelector('.proteus-web-ui-mask')).toBeNull()
    expect(state.picked).toBe(1)
  })

  it('关闭按钮 → cancel 事件 + 关闭弹层（不发 change，动画后移除）', async () => {
    const state = mountPicker(['甲', '乙'])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    ;(document.querySelector('.pwp-close') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 350))
    expect(document.querySelector('.proteus-web-picker-sheet')).toBeNull()
    expect(state.picked).toBe(-1)
    expect(state.cancelled).toBe(1)
  })

  it('点遮罩 → cancel + 关闭（动画后移除）', async () => {
    const state = mountPicker(['甲'])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    ;(document.querySelector('.proteus-web-ui-mask') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 350))
    expect(document.querySelector('.proteus-web-picker-sheet')).toBeNull()
    expect(state.cancelled).toBe(1)
  })

  it('显式 value 时初始选中该索引（is-selected 类）', () => {
    mountPicker(['甲', '乙', '丙'], 1)
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    const selected = document.querySelector('.pwp-item.is-selected')
    expect(selected?.textContent).toBe('乙')
  })
})
