// tests/component-visible-defects.test.ts
// @vitest-environment jsdom
// ★2026-09-24 两处「可见性」级组件缺陷的回归锁（均由 showcase 组件页实测暴露）：
//   ① p-avatar：`broken` 被赋值但模板从不消费 → src 图片加载失败时显示**破图**，
//      而 prop 文档承诺「缺图/加载失败显示首字符」（静默失效——声明与实现不符）。
//   ② p-divider：垂直方向用 `height: 100%`——百分比高度需父级有**确定高度**，
//      最常见用法（p-stack row 行内分隔）是内容驱动高度 → 解析为 0 → 分隔线**完全不可见**
//      （实测：E2E 关键元素可见占比 2/4 报红）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, ref } from 'vue'
import PAvatar from '../packages/components/p-avatar/index.vue'
import PDivider from '../packages/components/p-divider/index.vue'

describe('p-avatar 缺图兜底（加载失败 → fallback 首字符）', () => {
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

  const mountAvatar = (props: Record<string, unknown>) => {
    app = createApp({ setup: () => () => h(PAvatar, props) })
    app.mount(host!)
  }

  it('无 src → 直接渲染 fallback 文本（不打 img）', () => {
    mountAvatar({ fallback: '兜底' })
    expect(host!.querySelector('.p-avatar-img'), '无 src 不应渲染 img').toBeNull()
    expect(host!.querySelector('.p-avatar-text')?.textContent, '应显示 fallback 首字符').toBe('兜')
  })

  it('★图片加载失败（error）→ 切换到 fallback 文本，不残留破图', async () => {
    mountAvatar({ src: '/definitely-missing.png', fallback: '失败' })
    expect(host!.querySelector('.p-avatar-img'), '初始应渲染 img（src 非空）').not.toBeNull()
    // 触发图片加载失败（真实浏览器/模拟器下由 img 的 error 事件驱动）
    const img = host!.querySelector('img') as HTMLImageElement
    img.dispatchEvent(new Event('error'))
    await new Promise((r) => setTimeout(r, 0))
    expect(host!.querySelector('.p-avatar-img'), '★加载失败后 img 必须移除（否则显示破图）').toBeNull()
    expect(host!.querySelector('.p-avatar-text')?.textContent, '应显示 fallback 首字符').toBe('失')
  })

  it('图片正常时不误切兜底（防「一律显示文本」的过度修复）', async () => {
    mountAvatar({ src: '/assets/avatar-demo.svg', fallback: '正常' })
    await new Promise((r) => setTimeout(r, 0))
    expect(host!.querySelector('.p-avatar-img'), '未报错时应保持图片形态').not.toBeNull()
    expect(host!.querySelector('.p-avatar-text'), '未报错不应出现兜底文本').toBeNull()
  })
})

describe('p-divider 垂直分隔线可见性（height:100% → align-self:stretch）', () => {
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

  /**
   * ★回归判据（与真机/E2E 同源）：垂直分隔线在**内容驱动高度**的 flex 父容器里
   *   必须有可解析的尺寸——断言「计算样式不含 height:100%」+「含 alignSelf:stretch」。
   *   jsdom 不做布局计算（getBoundingClientRect 恒 0），故断言**样式契约**而非像素；
   *   像素级可见性由 showcase E2E（真实 Chromium）覆盖。
   */
  const mountDivider = (props: Record<string, unknown>) => {
    app?.unmount() // ★同一 host 重复挂载会触发 Vue 告警——每次先卸载上一个实例
    app = createApp({
      setup: () => () => h('div', { style: 'display:flex;align-items:center' }, [h(PDivider, props)]),
    })
    app.mount(host!)
    return host!.querySelector('.p-divider') as HTMLElement
  }

  it('★垂直：不使用百分比高度（内容驱动父容器下会解析为 0 → 不可见）', () => {
    const el = mountDivider({ orientation: 'vertical', inset: 8 })
    const style = el.getAttribute('style') ?? ''
    expect(style, '垂直分隔线不得用 height:100%（内容驱动父容器下不可见）').not.toMatch(/height:\s*100%/)
    expect(style, '应以 align-self:stretch 沿交叉轴撑满').toMatch(/align-self:\s*stretch/)
    expect(style, '应有 min-height 兜底（非 flex 父容器下仍可见）').toMatch(/min-height/)
  })

  it('水平：保持 width:100%（该方向无此问题，防误改）', () => {
    const el = mountDivider({})
    const style = el.getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*100%/)
    expect(el.className).toContain('p-divider-horizontal')
  })

  it('inset 映射到左右外边距（垂直）/ 上下外边距（水平）', () => {
    const v = mountDivider({ orientation: 'vertical', inset: 8 })
    expect(v.getAttribute('style')).toMatch(/margin-left:\s*8px/)
    const hEl = mountDivider({ inset: 12 })
    expect(hEl.getAttribute('style')).toMatch(/margin-top:\s*12px/)
  })
})
