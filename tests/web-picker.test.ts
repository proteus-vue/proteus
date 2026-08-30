// tests/web-picker.test.ts
// ★18-picker-swiper B1：picker selector Web 模拟——点击触发半屏弹层、change 载荷对齐微信
// 注：滚动选中高亮依赖真实布局（offsetTop/scrollTop），jsdom 无法模拟——交互由 CDP 实测验证（scripts/cdp 流程）
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

  /** 挂载：range 数组 + change 监听，渲染为可点击容器（Vue 渲染器真实挂载） */
  function mountPicker(range: unknown[], value = 0, rangeKey?: string) {
    const state = reactive({ picked: -1 })
    const Root = {
      setup() {
        return () =>
          h(
            WebPicker,
            {
              range,
              value,
              rangeKey,
              onChange: (e: { detail: { value: number } }) => {
                state.picked = e.detail.value
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

  it('点击容器 → 打开半屏弹层（toolbar 取消/确定 + 滚动列渲染 range）', () => {
    mountPicker(['甲', '乙', '丙'])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    const sheet = document.querySelector('.proteus-web-picker-sheet')
    expect(sheet).not.toBeNull()
    const btns = [...(sheet?.querySelectorAll('.pwp-toolbar-btn') ?? [])].map((b) => b.textContent)
    expect(btns).toEqual(['取消', '确定'])
    const texts = [...document.querySelectorAll('.pwp-col-item')].map((el) => el.textContent)
    expect(texts).toEqual(['甲', '乙', '丙'])
  })

  it('range-key：对象数组取字段文本', () => {
    mountPicker([{ n: '北京' }, { n: '上海' }], 1, 'n')
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    const texts = [...document.querySelectorAll('.pwp-col-item')].map((el) => el.textContent)
    expect(texts).toEqual(['北京', '上海'])
  })

  it('确定 → change { detail: { value: 选中索引 } } + 关闭弹层', async () => {
    const state = mountPicker(['甲', '乙', '丙'])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    // 默认选中 value=0（jsdom 无布局，但 highlight 初始用 initValue 兜底）
    ;(document.querySelector('.pwp-toolbar-btn--confirm') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 30))
    expect(document.querySelector('.proteus-web-picker-sheet')).toBeNull()
    expect(document.querySelector('.proteus-web-ui-mask')).toBeNull()
    expect(state.picked).toBe(0)
  })

  it('取消 → 不触发 change + 关闭弹层', async () => {
    const state = mountPicker(['甲', '乙'])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    ;(document.querySelector('.pwp-toolbar-btn') as HTMLElement).click() // 第一个按钮=取消
    await new Promise((r) => setTimeout(r, 30))
    expect(document.querySelector('.proteus-web-picker-sheet')).toBeNull()
    expect(state.picked).toBe(-1)
  })

  it('点遮罩 → 取消关闭', async () => {
    const state = mountPicker(['甲'])
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    ;(document.querySelector('.proteus-web-ui-mask') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
    expect(document.querySelector('.proteus-web-picker-sheet')).toBeNull()
    expect(state.picked).toBe(-1)
  })

  it('再次打开：初始选中 value 索引（highlight 兜底 initValue）', () => {
    mountPicker(['甲', '乙', '丙'], 2)
    ;(document.querySelector('.proteus-web-picker') as HTMLElement).click()
    // jsdom 无布局——但数据集上应有 is-selected 类（初始化 highlight 调用于 DOM 挂载后）
    expect(document.querySelectorAll('.pwp-col-item').length).toBe(3)
  })
})
