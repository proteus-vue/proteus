// tests/web-switch.test.ts
// ★小程序 <switch> Web 模拟（14-mp-first-semantics + 17-weui-io-alignment）：
//   is-disabled 类（禁用态 opacity 0.1 官方对齐）+ change 载荷 { detail: { value } }
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, reactive } from 'vue'
import { WebSwitch } from '../packages/built-in-components/src/components/switch'

describe('WebSwitch（对齐官方 weui.io/#form_switch）', () => {
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

  function mountSwitch(props: Record<string, unknown> = {}) {
    const state = reactive({ changed: -1 })
    const Root = {
      setup() {
        return () =>
          h(
            WebSwitch,
            {
              ...props,
              onChange: (e: { detail: { value: boolean } }) => {
                state.changed = e.detail.value ? 1 : 0
              },
            },
          )
      },
    }
    app = createApp(Root)
    app.mount(host!)
    return state
  }

  it('渲染容器 + 隐藏 input（checked 同步）', () => {
    mountSwitch({ checked: true })
    const sw = document.querySelector('.proteus-web-switch')
    expect(sw).not.toBeNull()
    expect(sw?.classList.contains('is-on')).toBe(true)
    const input = sw?.querySelector('input') as HTMLInputElement | null
    expect(input?.checked).toBe(true)
    expect(sw?.querySelector('.pws-thumb')).not.toBeNull()
  })

  it('disabled → is-disabled 类 + input disabled（官方 opacity 0.1 由 CSS 驱动）', () => {
    mountSwitch({ disabled: true })
    const sw = document.querySelector('.proteus-web-switch')
    expect(sw?.classList.contains('is-disabled')).toBe(true)
    expect((sw?.querySelector('input') as HTMLInputElement | null)?.disabled).toBe(true)
  })

  it('点击切换 → change { detail: { value } } + is-on 类翻转', async () => {
    const state = mountSwitch({})
    const sw = document.querySelector('.proteus-web-switch')
    const input = sw?.querySelector('input') as HTMLInputElement | null
    input?.click()
    await new Promise((r) => setTimeout(r, 30))
    expect(state.changed).toBe(1)
    expect(sw?.classList.contains('is-on')).toBe(true)
  })

  it('禁用态不触发 change（input disabled 阻止点击）', async () => {
    const state = mountSwitch({ disabled: true })
    const input = document.querySelector('.proteus-web-switch input') as HTMLInputElement | null
    input?.click()
    await new Promise((r) => setTimeout(r, 30))
    expect(state.changed).toBe(-1)
    expect(document.querySelector('.proteus-web-switch')?.classList.contains('is-on')).toBe(false)
  })
})

// ★2026-09-13 SOP v2 批次 1：p-switch 官方属性对齐（受控 / type=checkbox / color / disabled）
describe('★WebSwitch 官方属性对齐（p-switch 批次 1）', () => {
  function mount(props: Record<string, unknown>) {
    const h2 = document.createElement('div'); document.body.appendChild(h2)
    const a = createApp({ render: () => h(WebSwitch, props) })
    a.mount(h2)
    return { app: a, host: h2 }
  }

  it('受控：外部 checked 驱动（p-switch v-model 语义）', async () => {
    const state = reactive({ on: false })
    const h2 = document.createElement('div'); document.body.appendChild(h2)
    const a = createApp({
      render: () => h(WebSwitch, {
        checked: state.on,
        onChange: (e: { detail: { value: boolean } }) => { state.on = e.detail.value },
      }),
    })
    a.mount(h2)
    const sw = h2.querySelector('.proteus-web-switch') as HTMLElement
    expect(sw.classList.contains('is-on')).toBe(false)
    ;(sw.querySelector('input') as HTMLInputElement).click()
    await new Promise((r) => setTimeout(r, 20))
    expect(state.on, 'change 应回传新值').toBe(true)
    expect(sw.classList.contains('is-on'), '外部 checked 应驱动视觉').toBe(true)
    a.unmount(); document.body.innerHTML = ''
  })

  it('color → 打开态轨道色（官方 color 语义）', () => {
    const { app: a } = mount({ checked: true, color: 'rgb(255, 0, 0)' })
    const sw = document.querySelector('.proteus-web-switch') as HTMLElement
    expect(sw.style.backgroundColor).toBe('rgb(255, 0, 0)')
    a.unmount(); document.body.innerHTML = ''
  })

  it('disabled → is-disabled（不可交互）', () => {
    const { app: a } = mount({ disabled: true })
    const sw = document.querySelector('.proteus-web-switch')
    expect(sw?.classList.contains('is-disabled')).toBe(true)
    expect((sw?.querySelector('input') as HTMLInputElement)?.disabled).toBe(true)
    a.unmount(); document.body.innerHTML = ''
  })
})
