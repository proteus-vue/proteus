// tests/web-tap-event.test.ts
// @vitest-environment jsdom
// ★2026-09-24 实测缺陷的回归锁：Web 端 `@tap` 事件此前**没有归一**。
//
// 背景：小程序 `<view>` 的原生事件是 `tap`（`bind:tap`），框架把它列为跨端事件
//   （packages/compiler/src/tags.ts 的 REAL_NATIVE 表：tap / longpress / click）。
//   MP 端由编译器直出原生绑定；**Web 端此前没有任何 tap→click 归一** →
//   组件里写 `@tap="onTap"`（p-mask / p-popup / p-nav-bar / p-map / p-svg-canvas 共 5 个）
//   在 Web 端**静默失效**：`onTap` 作为未知属性透传到 div，DOM 不认识 `tap`，永不触发。
//   （实测暴露：showcase 的 p-mask 页「点遮罩关闭」在 Web 端点了没反应。）
//
// 修法：Web 模拟层（built-in-components/components/view.ts）把 `onTap` 转发到 click。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import { WebView } from '../packages/built-in-components/src/components/view'

describe('★Web 端 @tap 事件归一（tap → click）', () => {
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

  const mount = (props: Record<string, unknown>, tag = WebView) => {
    app = createApp({ setup: () => () => h(tag, props as never, { default: () => '内容' }) })
    app.mount(host!)
    return host!.firstElementChild as HTMLElement
  }

  it('★@tap 在 Web 端真实触发（点遮罩关闭类交互的根因）', async () => {
    let taps = 0
    const el = mount({ onTap: () => { taps++ } })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(taps, '@tap 应在点击时触发（此前 Web 端永不触发）').toBe(1)
  })

  it('@click 仍照常触发（不因新增归一而回归）', async () => {
    let clicks = 0
    const el = mount({ onClick: () => { clicks++ } })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(clicks).toBe(1)
  })

  it('★@tap 与 @click 同写时两者都触发（不互相吞掉）', async () => {
    let taps = 0
    let clicks = 0
    const el = mount({ onTap: () => { taps++ }, onClick: () => { clicks++ } })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(clicks, '@click 不应被 tap 转发吃掉').toBe(1)
    expect(taps, '@tap 也不应被 onClick 覆盖').toBe(1)
  })

  it('★onTap 不残留为 DOM 属性（防「未知属性透传」的脏 DOM）', () => {
    const el = mount({ onTap: () => {} })
    expect(el.hasAttribute('onTap'), '处理过的监听不应以属性形式留在 DOM 上').toBe(false)
    expect(el.getAttribute('ontap')).toBeNull()
  })

  it('无 tap 监听时不注入 click 处理（零副作用）', async () => {
    // 无任何监听时点击不应报错，也不应产生额外行为
    const el = mount({ class: 'plain' })
    expect(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow()
    expect(el.className).toContain('plain')
  })
})
