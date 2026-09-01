// tests/adaptive.test.ts
// ★p-adaptive（adaptive-container-plan B1+B2）：容器形态自适应——解析/校验/求解 + Controller/形态样式 + 组件
//   用例对齐 06-benchmark-batches.md §3（compute 边界 + validate FLD007）
// @vitest-environment happy-dom（组件挂载）
import { describe, it, expect } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import {
  parseAdaptiveExpression,
  validateAdaptiveRanges,
  computeAdaptiveForm,
  createAdaptiveController,
  resolveAdaptiveFormStyle,
} from '@proteus-vue/fluid'
import type { AdaptiveVariant } from '@proteus-vue/fluid'
import { PAdaptive, PModal } from '@proteus-vue/components'

/** fake 尺寸观察器工厂：observe 记录目标；fire 驱动 onSize（真实 RO 的 contentRect 回调等价） */
function fakeObserverFactory(onSize: (w: number, h: number) => void): { observe: (t: unknown) => void; disconnect: () => void; fire: (w: number, h: number) => void } {
  const targets: unknown[] = []
  return {
    observe: (t) => targets.push(t),
    disconnect: () => {
      targets.length = 0
    },
    fire: (w, h) => onSize(w, h),
  }
}

function mount(comp: unknown, props: Record<string, unknown>, slots?: Record<string, unknown>): HTMLElement {
  const el = document.createElement('div')
  const app = createApp({ render: () => h(comp as never, props as never, slots as never) })
  app.mount(el)
  return el
}

const VARIANTS: AdaptiveVariant[] = [
  { form: 'sheet', lo: 0, hi: 600 },
  { form: 'dialog', lo: 600, hi: 840 },
  { form: 'popover', lo: 840, hi: Infinity },
]

describe('p-adaptive parseAdaptiveExpression（B1 解析）', () => {
  it('标准表达式 `sheet(0, 600) | dialog(600, 840) | popover(840, ∞)` → 有序形态区间', () => {
    const modes = parseAdaptiveExpression('sheet(0, 600) | dialog(600, 840) | popover(840, ∞)')
    expect(modes).toEqual([
      { form: 'sheet', lo: 0, hi: 600 },
      { form: 'dialog', lo: 600, hi: 840 },
      { form: 'popover', lo: 840, hi: Infinity },
    ])
  })

  it('上界省略/∞/inf/空白 → Infinity；下界省略 → 0；空/格式非法 → 空数组', () => {
    expect(parseAdaptiveExpression('sidebar(840,)')).toEqual([{ form: 'sidebar', lo: 840, hi: Infinity }])
    expect(parseAdaptiveExpression('topnav(1280, inf)')).toEqual([{ form: 'topnav', lo: 1280, hi: Infinity }])
    expect(parseAdaptiveExpression('fullscreen(, 768)')).toEqual([{ form: 'fullscreen', lo: 0, hi: 768 }])
    expect(parseAdaptiveExpression('')).toEqual([])
    expect(parseAdaptiveExpression('not-a-range')).toEqual([])
    expect(parseAdaptiveExpression('sheet(0,600) | 垃圾 | dialog(600,840)')).toHaveLength(2)
  })
})

describe('p-adaptive validateAdaptiveRanges（B1 校验 FLD007）', () => {
  it('连续区间 → 零诊断', () => {
    expect(validateAdaptiveRanges(VARIANTS)).toEqual([])
    expect(validateAdaptiveRanges([{ form: 'a', lo: 0, hi: 600 }, { form: 'b', lo: 600, hi: Infinity }])).toEqual([])
  })

  it('重叠区间 → FLD007（06 §3 用例）', () => {
    const diags = validateAdaptiveRanges([
      { form: 'a', lo: 0, hi: 600 },
      { form: 'b', lo: 500, hi: 900 },
    ])
    expect(diags).toContainEqual(expect.objectContaining({ code: 'FLD007' }))
  })

  it('不连续（gap）→ FLD007；非法区间（hi ≤ lo）→ FLD007；空 → FLD007', () => {
    expect(validateAdaptiveRanges([{ form: 'a', lo: 0, hi: 600 }, { form: 'b', lo: 700, hi: 900 }])).toHaveLength(1)
    expect(validateAdaptiveRanges([{ form: 'a', lo: 100, hi: 100 }])).toHaveLength(1)
    expect(validateAdaptiveRanges([])).toHaveLength(1)
    const diags = validateAdaptiveRanges([])
    expect(diags[0]?.code).toBe('FLD007')
  })
})

describe('p-adaptive computeAdaptiveForm（B1 求解）', () => {
  it('宽度 < 600 → sheet（06 §3 用例）', () => {
    expect(computeAdaptiveForm(VARIANTS, 320)).toBe('sheet')
    expect(computeAdaptiveForm(VARIANTS, 599)).toBe('sheet')
  })

  it('边界 600/700 → dialog（[lo, hi) 左闭右开——06 §3 用例）', () => {
    expect(computeAdaptiveForm(VARIANTS, 600)).toBe('dialog')
    expect(computeAdaptiveForm(VARIANTS, 700)).toBe('dialog')
  })

  it('840 以上 → popover（06 §3 用例）', () => {
    expect(computeAdaptiveForm(VARIANTS, 840)).toBe('popover')
    expect(computeAdaptiveForm(VARIANTS, 1920)).toBe('popover')
  })

  it('越界兜底：宽度 < 首区间 lo → 首形态；空区间 → null', () => {
    expect(computeAdaptiveForm(VARIANTS, -100)).toBe('sheet')
    expect(computeAdaptiveForm([], 500)).toBeNull()
  })
})

describe('p-adaptive resolveAdaptiveFormStyle（B2 Web 形态样式）', () => {
  it('sheet → 底部全宽；dialog/popover → 居中（popover 锚定降级居中，03 §6）', () => {
    expect(resolveAdaptiveFormStyle('sheet')).toEqual({ position: 'fixed', left: '0px', right: '0px', bottom: '0px' })
    const centered = { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    expect(resolveAdaptiveFormStyle('dialog')).toEqual(centered)
    expect(resolveAdaptiveFormStyle('popover')).toEqual(centered)
    expect(resolveAdaptiveFormStyle('unknown')).toEqual(centered) // 未知形态 → 居中兜底
  })
})

describe('p-adaptive createAdaptiveController（B2 容器监听 + 求解）', () => {
  it('fake 观察器驱动：宽度变化 → 形态切换（边界 600/840）；destroy 停止', () => {
    let fake: ReturnType<typeof fakeObserverFactory> | null = null
    const controller = createAdaptiveController(
      { tag: 'div' },
      {
        modes: VARIANTS,
        createObserver: (onSize) => {
          fake = fakeObserverFactory(onSize)
          return fake
        },
      },
    )
    const forms: Array<string | null> = []
    const off = controller.subscribe((s) => forms.push(s.form))
    // 初始（0 宽）→ 首区间 sheet
    expect(forms[0]).toBe('sheet')
    fake?.fire(320, 800)
    expect(forms[1]).toBe('sheet')
    fake?.fire(600, 800) // 边界 → dialog（[lo, hi) 左闭右开）
    expect(forms[2]).toBe('dialog')
    fake?.fire(840, 800)
    expect(forms[3]).toBe('popover')
    expect(controller.get()).toMatchObject({ form: 'popover', width: 840 })
    off()
    fake?.fire(100, 400)
    expect(forms.length).toBe(4) // 取消订阅后不再回调
    controller.destroy()
    fake?.fire(900, 400)
    expect(forms.length).toBe(4)
  })

  it('readSize 注入初始尺寸；空 modes → form null', () => {
    const c1 = createAdaptiveController(null, { modes: VARIANTS, readSize: () => ({ width: 700, height: 400 }) })
    expect(c1.get()).toMatchObject({ form: 'dialog', width: 700 })
    c1.destroy()
    const c2 = createAdaptiveController(null, { modes: [], readSize: () => ({ width: 700, height: 400 }) })
    expect(c2.get().form).toBeNull()
    c2.destroy()
  })
})

describe('p-adaptive 组件（B2）', () => {
  it('无 ResizeObserver 环境 → 形态恒首区间（sheet 兜底）；visible=false 不渲染形态层', async () => {
    const el = mount(
      PAdaptive,
      { modes: 'sheet(0, 600) | dialog(600, 840) | popover(840, ∞)', visible: false },
      { default: () => h('div', { class: 'content' }, '内容') },
    )
    await nextTick()
    expect(el.querySelector('.p-adaptive-form')).toBeNull() // visible=false
    expect(el.querySelector('.content')).toBeNull()
  })

  it('visible=true → 形态层渲染（sheet 兜底 class）；modes 空 → sheet 兜底', async () => {
    const el = mount(PAdaptive, { modes: 'sheet(0, 600) | dialog(600, 840) | popover(840, ∞)', visible: true }, { default: () => h('div', { class: 'content' }, '内容') })
    await nextTick()
    const formEl = el.querySelector('.p-adaptive-form') as HTMLElement
    expect(formEl).not.toBeNull()
    expect(formEl.classList.contains('p-adaptive-sheet')).toBe(true)
    expect(el.querySelector('.content')).not.toBeNull()
  })
})

describe('p-modal 组件（B4：p-adaptive 属性 + 形态能力并入弹窗）', () => {
  it('visible=false → 不渲染（mask/panel 均无）', async () => {
    const el = mount(PModal, { visible: false, title: '标题' })
    await nextTick()
    expect(el.querySelector('.p-modal')).toBeNull()
  })

  it('★width 覆盖三档：320 → sheet / 700 → dialog / 1024 → popover（不同窗口大小验证）', async () => {
    const cases: Array<[number, string]> = [
      [320, 'p-modal-panel--sheet'],
      [600, 'p-modal-panel--dialog'], // 边界 [lo, hi) 左闭右开
      [700, 'p-modal-panel--dialog'],
      [1024, 'p-modal-panel--popover'],
    ]
    for (const [w, expected] of cases) {
      const el = mount(PModal, { visible: true, width: w })
      await nextTick()
      const panel = el.querySelector('.p-modal-panel') as HTMLElement
      expect(panel.classList.contains(expected)).toBe(true)
    }
  })

  it('★p-adaptive 属性（kebab prop）解析形态区间 + title/close/内容渲染', async () => {
    const el = mount(
      PModal,
      { visible: true, 'p-adaptive': 'sheet(0, 600) | dialog(600, 840) | popover(840, ∞)', width: 700, title: '标题', closable: true },
      { default: () => h('p', { class: 'body-text' }, '内容') },
    )
    await nextTick()
    const panel = el.querySelector('.p-modal-panel') as HTMLElement
    expect(panel.classList.contains('p-modal-panel--dialog')).toBe(true)
    expect((el.querySelector('.p-modal-title') as HTMLElement).textContent).toBe('标题')
    expect(el.querySelector('.body-text')).not.toBeNull()
    expect(el.querySelector('.p-modal-close')).not.toBeNull()
  })

  it('★popover + anchor → 锚定定位（anchor 下方）替代居中降级', async () => {
    const anchor = { getBoundingClientRect: () => ({ left: 120, top: 80, width: 100, height: 32 }) }
    const el = mount(PModal, { visible: true, width: 1024, anchor })
    await nextTick()
    const panel = el.querySelector('.p-modal-panel') as HTMLElement
    expect(panel.classList.contains('p-modal-panel--popover')).toBe(true)
    expect(panel.style.position).toBe('fixed')
    expect(panel.style.left).toBe('120px') // anchor.left
    expect(panel.style.top).toBe('120px') // anchor.bottom + 8 = (80 + 32) + 8
    expect(panel.style.transform).toBe('') // 非居中降级
  })

  it('★popover 无 anchor → 居中降级（03 §6）；sheet 底部安全区自动应用', async () => {
    const el = mount(PModal, { visible: true, width: 1024 })
    await nextTick()
    const panel = el.querySelector('.p-modal-panel') as HTMLElement
    expect(panel.style.transform).toBe('translate(-50%, -50%)')
    const el2 = mount(PModal, { visible: true, width: 320 })
    await nextTick()
    const sheet = el2.querySelector('.p-modal-panel') as HTMLElement
    expect(sheet.classList.contains('p-modal-panel--sheet')).toBe(true)
    // ★happy-dom CSS 解析丢弃 env()（p-safe 同坑）——sheet 底部定位验证 + 安全区 padding 与 resolveSafeAreaStyle 同源（envExpr）
    expect(sheet.style.left).toBe('0px')
    expect(sheet.style.right).toBe('0px')
    expect(sheet.style.bottom).toBe('0px')
  })

  it('点击遮罩（maskClosable）→ update:visible false', async () => {
    const el = document.createElement('div')
    const updates: boolean[] = []
    const app = createApp({
      render: () => h(PModal as never, { visible: true, maskClosable: true, 'onUpdate:visible': (v: boolean) => updates.push(v) } as never),
    })
    app.mount(el)
    await nextTick()
    ;(el.querySelector('.p-modal-mask') as HTMLElement).click()
    expect(updates).toEqual([false])
  })
})
