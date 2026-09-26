// tests/fluid-formfactor-render.test.ts
// @vitest-environment jsdom
// ★★p-formfactor 渲染级回归锁（2026-09-26 二次复审 P0 的机器门禁）：
//   背景：`v-if="caps.drawer"` 对三态字符串（'unsupported'）恒真 → 七形态全部渲染假徽标，
//   面板却显示「未支持」——声明与渲染互相打脸。静态扫描（.vue 文本正则）只能防「裸真值写法」，
//   无法证明「渲染结果与能力声明一致」。本文件真挂载组件，逐形态断言**渲染出的 UI 与 caps 判定同源**：
//     ① keyboard 徽标（⌘K）：仅 PC 出现
//     ② 表冠徽标：仅手表 / 车机出现
//     ③ 抽屉把手：仅 phone / fold / tablet 出现
//     ④ SKU 降级路径：仅车机（skuMulti=fallback）出现；手机/平板渲染真实多规格槽
//     ⑤ 触控形态不得拿到 dpad 热区类 / 焦点接管（has-dpad）
//     ⑥ 姿态覆盖：fold + tabletop → data-pf-nav='tabs'（nav 字段必须有渲染后果）
//     ⑦ Tab 栏：仅声明 tabs 的形态渲染（fold 已修——此前 unsupported 导致三姿态零导航）
import { describe, it, expect } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { PFormfactor } from '@proteus-vue/components'
import { FORM_PROFILES, capsEnabled, type DeviceForm } from '@proteus-vue/fluid'

/** 挂载 p-formfactor（注入全部内容槽——组件按能力过滤各槽的渲染） */
async function mountForm(form: DeviceForm, opts: { posture?: string; width?: number } = {}): Promise<HTMLElement> {
  const el = document.createElement('div')
  const slots = {
    rail: () => h('span', { class: 't-rail' }, 'rail'),
    media: () => h('div', { class: 't-media' }, 'media'),
    heading: () => h('strong', { class: 't-heading' }, 'heading'),
    price: () => h('span', { class: 't-price' }, '¥1299'),
    sku: () => h('span', { class: 't-sku fp-sku' }, 'sku'),
    actions: () => h('button', { class: 't-buy' }, 'buy'),
    recommend: () => h('div', { class: 't-rec pf-rec-card' }, 'rec'),
    tabbar: () => h('span', { class: 't-tab' }, 'tab'),
  }
  const app = createApp({
    render: () =>
      h(PFormfactor as never, { declared: form, posture: opts.posture ?? '', width: opts.width ?? 400 } as never, slots as never),
  })
  app.mount(el)
  await nextTick()
  return el
}

const root = (el: HTMLElement): HTMLElement => el.querySelector('.p-formfactor') as HTMLElement

describe('★p-formfactor 渲染与能力声明同源（二次复审 P0 回归锁）', () => {
  it('① keyboard 徽标（⌘K）仅在声明 keyboard 的形态渲染（此前 7/7 全渲染）', async () => {
    for (const form of Object.keys(FORM_PROFILES) as DeviceForm[]) {
      const el = await mountForm(form)
      const has = !!el.querySelector('.pf-key-hint')
      expect(has, `${form}: keyboard 徽标渲染=${has}，声明=${capsEnabled(FORM_PROFILES[form].caps.keyboard)}`).toBe(
        capsEnabled(FORM_PROFILES[form].caps.keyboard),
      )
    }
  })

  it('② 表冠徽标仅在声明 crown 的形态渲染（手表唯一支持的能力不得漏）', async () => {
    for (const form of Object.keys(FORM_PROFILES) as DeviceForm[]) {
      const el = await mountForm(form)
      const has = !!el.querySelector('.pf-crown-hint')
      expect(has, `${form}: 表冠徽标渲染=${has}`).toBe(capsEnabled(FORM_PROFILES[form].caps.crown))
    }
  })

  it('③ 抽屉把手仅在声明 drawer 的形态渲染', async () => {
    for (const form of Object.keys(FORM_PROFILES) as DeviceForm[]) {
      const el = await mountForm(form)
      const has = !!el.querySelector('.pf-drawer-hint')
      expect(has, `${form}: 抽屉把手渲染=${has}`).toBe(capsEnabled(FORM_PROFILES[form].caps.drawer))
    }
  })

  it('④ SKU 三态：supported 渲染真实槽 / fallback 渲染降级路径 / unsupported 不渲染', async () => {
    const phone = await mountForm('phone')
    expect(!!phone.querySelector('.pf-sku'), '手机应渲染多规格').toBe(true)
    const car = await mountForm('car')
    expect(!!car.querySelector('.pf-sku-fallback'), '车机应渲染降级路径').toBe(true)
    const tv = await mountForm('tv')
    expect(!!tv.querySelector('.pf-sku') || !!tv.querySelector('.pf-sku-fallback'), 'TV 不应渲染任何 SKU 形态').toBe(false)
  })

  it('⑤ has-dpad 类与 dpad 声明同源；触控形态无遥控热区语义', async () => {
    for (const form of Object.keys(FORM_PROFILES) as DeviceForm[]) {
      const el = await mountForm(form)
      expect(root(el).classList.contains('has-dpad'), `${form} has-dpad`).toBe(capsEnabled(FORM_PROFILES[form].caps.dpad))
    }
  })

  it('⑥ 姿态覆盖：fold + tabletop → data-pf-nav=tabs（nav 字段必须有渲染后果）', async () => {
    const folded = await mountForm('fold', { posture: 'folded' })
    expect(root(folded).dataset.pfNav).toBe('bottom-tabs')
    expect(root(folded).dataset.pfPosture).toBe('folded')
    const table = await mountForm('fold', { posture: 'tabletop' })
    expect(root(table).dataset.pfNav).toBe('tabs')
    const expanded = await mountForm('fold', { posture: 'expanded' })
    expect(root(expanded).dataset.pfTopology).toBe('duo')
  })

  it('⑦ Tab 栏渲染：fold 三姿态必须有导航（此前 caps.tabs=unsupported → Tab 被过滤 = 零导航）', async () => {
    const phone = await mountForm('phone')
    expect(!!phone.querySelector('.pf-tabbar'), '手机 Tab 栏').toBe(true)
    for (const posture of ['folded', 'tabletop', 'expanded'] as const) {
      const el = await mountForm('fold', { posture })
      expect(!!el.querySelector('.pf-tabbar'), `折叠屏 ${posture} 应有 Tab 导航`).toBe(true)
    }
    const tv = await mountForm('tv')
    expect(!!tv.querySelector('.pf-tabbar'), 'TV 无 Tab').toBe(false)
  })

  it('⑧ 根类覆盖全部声明能力（能力 → CSS 后果的接线不可漏项）', async () => {
    const el = await mountForm('car')
    const cls = root(el).classList
    // 车机声明：dpad / crown / focusTree / dense / multiCol / focusRows / driveAware
    for (const c of ['has-dpad', 'has-crown', 'has-focus-tree', 'is-dense', 'has-multicol', 'is-drive']) {
      expect(cls.contains(c), `车机应有 ${c}`).toBe(true)
    }
    // 未声明：hover / keyboard / sidebar / notch / drawer / tabs
    for (const c of ['has-hover', 'has-keyboard', 'has-notch', 'has-drawer']) {
      expect(cls.contains(c), `车机不应有 ${c}`).toBe(false)
    }
  })
})
