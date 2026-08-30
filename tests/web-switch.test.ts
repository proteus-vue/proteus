// tests/web-switch.test.ts
// ★小程序 <switch> Web 模拟（14-mp-first-semantics + 17-weui-io-alignment）：
//   is-disabled 类（禁用态 opacity 0.1 官方对齐）+ change 载荷 { detail: { value } }
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, reactive } from 'vue'
import { WebSwitch } from '../packages/web/src/components/switch'

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
