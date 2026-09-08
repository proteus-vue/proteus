// tests/popover.test.ts
// ★方案 A spike（Skyline 层叠解药）：p-popover 面板 fixed + 像素坐标定位。
//   自动化测试框架（vitest + happy-dom + mock adapter.measureRect）锁契约：
//   ① 纯函数 computePopoverPosition 四方向坐标（node 亦可跑，happy-dom 无碍）
//   ② 组件：measureRect 返回 rect → 面板 position:fixed + left/top
//   ③ 组件：measureRect 失败/不支持/异常 → panelStyle 空 → 回退静态 .p-popover-{placement} 绝对锚定
//   ★诚实边界：Skyline 是否渲染 fixed+像素坐标是**真机命门**，自动化只能锁代码契约，真机验证另排。
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { PPopover, computePopoverPosition } from '@proteus-vue/components'
import { adapter } from '@proteus-vue/shared'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(comp: unknown, props: Record<string, unknown>, slots?: Record<string, unknown>): HTMLElement {
  const el = document.createElement('div')
  const app = createApp({ render: () => h(comp as never, props as never, slots as never) })
  app.mount(el)
  return el
}

const TRIGGER_RECT = { top: 100, left: 50, right: 150, bottom: 120, width: 100, height: 20 }

async function flush(): Promise<void> {
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

describe('computePopoverPosition 纯函数（四方向 fixed 视口坐标）', () => {
  it('bottom（默认）：left=trigger.left、top=trigger.bottom+6', () => {
    expect(computePopoverPosition({ trigger: TRIGGER_RECT })).toEqual({ left: 50, top: 126, placement: 'bottom' })
  })
  it('top：left=trigger.left、top=trigger.top-6', () => {
    expect(computePopoverPosition({ trigger: TRIGGER_RECT, placement: 'top' })).toEqual({ left: 50, top: 94, placement: 'top' })
  })
  it('left：left=trigger.left-6、top=trigger.top（侧方同顶对齐）', () => {
    expect(computePopoverPosition({ trigger: TRIGGER_RECT, placement: 'left' })).toEqual({ left: 44, top: 100, placement: 'left' })
  })
  it('right：left=trigger.right+6、top=trigger.top', () => {
    expect(computePopoverPosition({ trigger: TRIGGER_RECT, placement: 'right' })).toEqual({ left: 156, top: 100, placement: 'right' })
  })
  it('gap 可自定义（默认 6；传 8 → bottom top=trigger.bottom+8）', () => {
    expect(computePopoverPosition({ trigger: TRIGGER_RECT, placement: 'bottom', gap: 8 })).toEqual({ left: 50, top: 128, placement: 'bottom' })
  })
})

describe('p-popover 方案 A（measureRect + fixed 坐标；降级回退）', () => {
  it('measureRect 返回 rect → 面板 position:fixed + left/top（bottom 分支）', async () => {
    const spy = vi.spyOn(adapter, 'measureRect').mockResolvedValue(TRIGGER_RECT)
    const el = mount(PPopover, { modelValue: true, placement: 'bottom' }, { default: () => h('text', 'content') })
    await flush()
    const panel = el.querySelector('.p-popover-panel') as HTMLElement
    expect(panel.style.position).toBe('fixed')
    expect(panel.style.left).toBe('50px')
    expect(panel.style.top).toBe('126px')
    expect(panel.getAttribute('style')).toContain('position: fixed')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0][0])).toBe('[data-role="proteus-popover-trigger"]')
  })

  it('measureRect 返回 null（元素未找到）→ panelStyle 空 → 回退静态锚定（.p-popover-bottom 类在位）', async () => {
    vi.spyOn(adapter, 'measureRect').mockResolvedValue(null)
    const el = mount(PPopover, { modelValue: true, placement: 'bottom' }, { default: () => h('text', 'c') })
    await flush()
    const panel = el.querySelector('.p-popover-panel') as HTMLElement
    expect(panel.getAttribute('style')).toBe('') // 空串 → 走 .p-popover-panel 的 absolute
    expect(panel.classList.contains('p-popover-bottom')).toBe(true) // 静态锚定分支类仍在
  })

  it('measureRect 抛错 → 回退（不抛、panelStyle 空）', async () => {
    vi.spyOn(adapter, 'measureRect').mockRejectedValue(new Error('boom'))
    const el = mount(PPopover, { modelValue: true }, { default: () => h('text', 'c') })
    await flush()
    const panel = el.querySelector('.p-popover-panel') as HTMLElement
    expect(panel.getAttribute('style')).toBe('')
  })

  it('measureRect 不存在（旧/adapter 无此方法）→ 回退（panelStyle 空）', async () => {
    const original = adapter.measureRect
    delete (adapter as { measureRect?: unknown }).measureRect
    try {
      const el = mount(PPopover, { modelValue: true }, { default: () => h('text', 'c') })
      await flush()
      const panel = el.querySelector('.p-popover-panel') as HTMLElement
      expect(panel.getAttribute('style')).toBe('')
    } finally {
      ;(adapter as { measureRect?: unknown }).measureRect = original
    }
  })

  it('关闭（modelValue=false）→ panelStyle 清空（回到空/回退）', async () => {
    vi.spyOn(adapter, 'measureRect').mockResolvedValue(TRIGGER_RECT)
    const el = document.createElement('div')
    const open = ref(true)
    const app = createApp({
      render: () => h(PPopover as never, { modelValue: open.value } as never, { default: () => h('text') } as never),
    })
    app.mount(el)
    await flush()
    expect((el.querySelector('.p-popover-panel') as HTMLElement).getAttribute('style')).toContain('position: fixed')
    open.value = false
    await flush()
    expect((el.querySelector('.p-popover-panel') as HTMLElement).getAttribute('style')).toBe('')
  })
})
