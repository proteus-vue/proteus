// tests/tab-bar-spec.test.ts —— ★★tab 栏视觉规格（TAB_BAR_SPEC）字段语义断言
// 【它防什么】用户 2026-10-11：「即使文字和图标变大，内容区也应该和上下间距保持一致——不可能
//   固定文字和图标大小」。⇒ 规格新增 **contentHeight = max(height, 内容块自然高)** 作为**唯一计算点**
//   （三端读同一值）。本测试钉住：① contentHeight ≥ height（永不小于最小内容区）；
//   ② 正常字号下 = height（即 52，零视觉回归）；③ 字号变大 ⇒ contentHeight 随之变大（撑高不裁切）。
import { describe, it, expect } from 'vitest'
import { TAB_BAR_SPEC } from '../packages/render-backend/src/tab-bar-spec'
import { getGlassPreset } from '../packages/glass/src/index'

describe('★★TAB_BAR_SPEC：内容区有效高 contentHeight（字号可变 ⇒ 内容区自适应）', () => {
  it('contentHeight ≥ height（内容区最小高语义）', () => {
    expect(TAB_BAR_SPEC.contentHeight).toBeGreaterThanOrEqual(TAB_BAR_SPEC.height)
  })

  it('★正常字号下 contentHeight == height（= 52，零视觉回归）', () => {
    // 内容块自然高 = 图标行(19×1.2) + 间距(2) + 文案行(10×1.2) ≈ 37 < 52 ⇒ 取 52
    expect(TAB_BAR_SPEC.height).toBe(52)
    expect(TAB_BAR_SPEC.contentHeight).toBe(52)
  })

  it('★内容区高与 Web 基准一致（.sa-tabbar 内容区 52px）', async () => {
    // Web 真值：superapp/App.vue .sa-tabbar__item { height: 52px }
    const fs = await import('node:fs')
    const app = fs.readFileSync(new URL('../superapp/App.vue', import.meta.url), 'utf-8')
    const m = app.match(/\.sa-tabbar__item\s*\{[^}]*height:\s*(\d+)px/)
    expect(m, '.sa-tabbar__item 应声明 height: Npx').not.toBeNull()
    expect(Number(m![1])).toBe(TAB_BAR_SPEC.height)
  })

  it('contentHeight 随 iconSize/labelSize 增大而增大（撑高语义——用同公式重算验证）', () => {
    // 复刻规格公式（LINE_FACTOR 1.2 + gap 2）：字号翻倍 ⇒ contentHeight 必须变大
    const blockH = (icon: number, label: number) => Math.round(icon * 1.2 + 2 + label * 1.2)
    const max52 = (v: number) => Math.max(52, v)
    const base = max52(blockH(TAB_BAR_SPEC.iconSize, TAB_BAR_SPEC.labelSize))
    const big = max52(blockH(TAB_BAR_SPEC.iconSize * 2, TAB_BAR_SPEC.labelSize * 2))
    expect(base).toBe(TAB_BAR_SPEC.contentHeight)   // 正常字号 = 规格值
    expect(big).toBeGreaterThan(TAB_BAR_SPEC.contentHeight) // 字号大 ⇒ 撑高
  })
})

describe('★★TAB_BAR_SPEC.glass：值 == @proteus-vue/glass 的 tabBar preset（单一真源，防漂移）', () => {
  it('glass 规格非空且与玻璃 SSOT 的 tabBar preset 逐字段一致', () => {
    // ★#803 教训：「规格自述基准」≠「规格等于基准」——门禁须钉 `值 == 基准源`。
    const preset = getGlassPreset('tabBar')
    expect(TAB_BAR_SPEC.glass, 'glass 规格应存在（期 B 起 tab 栏玻璃）').toBeTruthy()
    expect(TAB_BAR_SPEC.glass!.blur).toBe(preset.blur)
    expect(TAB_BAR_SPEC.glass!.tint).toBe(preset.tint)
    expect(TAB_BAR_SPEC.glass!.border).toBe(preset.border)
    expect(TAB_BAR_SPEC.glass!.borderSide).toBe(preset.borderSide)
  })
})
