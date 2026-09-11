// tests/glass.test.ts
// ★G-07 液态玻璃（proteus-glass-plan）：@proteus-vue/glass 纯逻辑 SSOT + <pg-glass> 组件契约 + CLI 审计
//   覆盖：preset 表 / props 归一解析 / 三级降级决策 / 能力矩阵 / 预设扩展 / 组件挂载 / audit glass（GLS001-006）
// @vitest-environment happy-dom（组件挂载）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  GLASS_PRESETS,
  GLASS_PRESET_NAMES,
  GLASS_INTENSITY_SCALE,
  GLASS_L1_MANDATORY,
  GLASS_DEGRADE_CHAIN,
  resolveGlass,
  intensityScale,
  normalizeIntensity,
  resolveGlassLevel,
  glassStyleFor,
  glassClassList,
  showsDecoration,
  glassCeilingFor,
  defineGlassPreset,
  getGlassPreset,
  hasGlassPreset,
  resetCustomPresets,
} from '@proteus-vue/glass'
import { PgGlass } from '@proteus-vue/components'
import { scanGlassSource, runGlassAudit, GLASS_MAX_NODES, GLASS_MAX_NEST_DEPTH } from '../packages/cli/src/glass-audit'

function mountComponent(comp: unknown, props: Record<string, unknown>): HTMLElement {
  const el = document.createElement('div')
  const app = createApp({ render: () => h(comp as never, props as never) })
  app.mount(el)
  return el
}

describe('★G-07 glass 预设表（09-presets 唯一事实源）', () => {
  it('七内置预设齐备且值合法', () => {
    expect(GLASS_PRESET_NAMES.sort()).toEqual(['card', 'custom', 'floating', 'modal', 'navigationBar', 'sidebar', 'tabBar'])
    for (const name of GLASS_PRESET_NAMES) {
      const p = GLASS_PRESETS[name]
      expect(p.blur).toBeGreaterThan(0)
      expect(p.tint).toMatch(/^rgba?\(/)
      expect(p.noise).toBeGreaterThanOrEqual(0)
      expect(p.noise).toBeLessThanOrEqual(1)
    }
  })

  it('导航/标签栏为直角 + 单侧细边；modal/card 有圆角', () => {
    expect(GLASS_PRESETS.navigationBar.radius).toBe(0)
    expect(GLASS_PRESETS.navigationBar.borderSide).toBe('bottom')
    expect(GLASS_PRESETS.tabBar.borderSide).toBe('top')
    expect(GLASS_PRESETS.modal.radius).toBe(24)
    expect(GLASS_PRESETS.card.radius).toBe(16)
    expect(GLASS_PRESETS.floating.interactive).toBe(true)
  })
})

describe('★G-07 props 归一解析（resolveGlass）', () => {
  it('preset 为底：未覆盖字段取预设值', () => {
    const r = resolveGlass({ preset: 'card' })
    expect(r.preset).toBe('card')
    expect(r.intensity).toBe('thin')
    expect(r.blurPx).toBe(Math.round(16 * 0.6)) // card blur 16 × thin 0.6
    expect(r.radiusPx).toBe(16)
    expect(r.noise).toBe(0.03)
  })

  it('props 显式覆盖：tint / radius / noise / border', () => {
    const r = resolveGlass({ preset: 'card', tint: 'rgba(0,0,0,0.5)', radius: 30, noise: 0.2, border: false })
    expect(r.tint).toBe('rgba(0,0,0,0.5)')
    expect(r.radiusPx).toBe(30)
    expect(r.noise).toBe(0.2)
    expect(r.border).toBe(false)
  })

  it('未知 preset → 回退 custom；intensity 数字归一', () => {
    const r = resolveGlass({ preset: 'nonexistent' as never, intensity: 1.5 })
    expect(r.preset).toBe('custom')
    expect(r.intensity).toBe('thick')
    expect(r.blurPx).toBe(Math.round(20 * 1.5))
  })

  it('intensity 档位缩放：none=0 模糊 / thick=1.4', () => {
    expect(intensityScale('none')).toBe(0)
    expect(intensityScale('thick')).toBe(1.4)
    expect(intensityScale(1.25)).toBe(1.25)
    expect(intensityScale(-3)).toBe(1) // 非法 → 1
    expect(resolveGlass({ preset: 'card', intensity: 'none' }).blurPx).toBe(0)
  })

  it('normalizeIntensity：数字 → 最近档位', () => {
    expect(normalizeIntensity(0)).toBe('none')
    expect(normalizeIntensity(0.5)).toBe('thin')
    expect(normalizeIntensity(1)).toBe('regular')
    expect(normalizeIntensity(1.5)).toBe('thick')
    expect(normalizeIntensity(2)).toBe('ultra')
  })

  it('fallback 归一：flat 生效，其余 → solid；solid 缺省由 tint 推导', () => {
    expect(resolveGlass({ fallback: 'flat' }).fallback).toBe('flat')
    expect(resolveGlass({}).fallback).toBe('solid')
    expect(resolveGlass({ preset: 'card' }).solid).toMatch(/^rgba\(/)
  })
})

describe('★G-07 三级降级决策（resolveGlassLevel）', () => {
  it('强制降级 / 无障碍 / 无 backdrop-filter → solid', () => {
    expect(resolveGlassLevel({ forceSolid: true })).toBe('solid')
    expect(resolveGlassLevel({ reducedTransparency: true })).toBe('solid')
    expect(resolveGlassLevel({ backdropFilter: false })).toBe('solid')
  })

  it('低端设备 → l1；web/skyline → l2；原生 + 系统材质 → l3', () => {
    expect(resolveGlassLevel({ platform: 'web', tier: 'low' })).toBe('l1')
    expect(resolveGlassLevel({ platform: 'web' })).toBe('l2')
    expect(resolveGlassLevel({ platform: 'skyline' })).toBe('l2')
    expect(resolveGlassLevel({ platform: 'ios', systemMaterial: true })).toBe('l3')
    expect(resolveGlassLevel({ platform: 'android', systemMaterial: true })).toBe('l2') // Android 无 L3
  })

  it('样式产物：solid 用实色无 backdrop-filter；l2 带 blur + tint', () => {
    const r = resolveGlass({ preset: 'card' })
    const solid = glassStyleFor(r, 'solid')
    expect(solid.background).toBe(r.solid)
    expect(solid.backdropFilter).toBeUndefined()
    const l2 = glassStyleFor(r, 'l2')
    expect(l2.backdropFilter).toBe(`blur(${r.blurPx}px)`)
    expect(l2.WebkitBackdropFilter).toBe(`blur(${r.blurPx}px)`)
    expect(l2.background).toBe(r.tint)
  })

  it('class 列表：preset/intensity/level + 边框朝向', () => {
    const r = resolveGlass({ preset: 'navigationBar' })
    const cls = glassClassList(r, 'l2')
    expect(cls).toContain('pg-glass')
    expect(cls).toContain('pg-glass--navigationBar')
    expect(cls).toContain('pg-glass--regular')
    expect(cls).toContain('pg-glass--l2')
    expect(cls).toContain('pg-glass--border-bottom')
    expect(glassClassList(r, 'solid')).toContain('pg-glass--solid')
  })

  it('showsDecoration：solid 之外均可装饰', () => {
    expect(showsDecoration('l2')).toBe(true)
    expect(showsDecoration('l1')).toBe(true)
    expect(showsDecoration('flat')).toBe(false)
    expect(showsDecoration('solid')).toBe(false)
  })
})

describe('★G-07 能力矩阵与预设扩展', () => {
  it('L1 必达五端；web/skyline 封顶 l2；iOS/鸿蒙 L3 门槛', () => {
    expect(GLASS_L1_MANDATORY.sort()).toEqual(['android', 'harmony', 'ios', 'skyline', 'web'])
    expect(glassCeilingFor('web')).toBe('l2')
    expect(glassCeilingFor('android')).toBe('l2')
    expect(glassCeilingFor('ios', { systemMaterial: true })).toBe('l3')
    expect(GLASS_DEGRADE_CHAIN).toEqual(['l3', 'l2', 'l1', 'solid', 'flat'])
  })

  it('defineGlassPreset 登记自定义预设并可解析', () => {
    resetCustomPresets()
    defineGlassPreset('brandFloating', { blur: 30, intensity: 'thick', tint: 'rgba(99,102,241,0.4)', radius: 28, border: true, noise: 0.06, interactive: true })
    expect(hasGlassPreset('brandFloating')).toBe(true)
    const r = resolveGlass({ preset: 'brandFloating' as never })
    expect(r.radiusPx).toBe(28)
    expect(r.blurPx).toBe(Math.round(30 * 1.4))
    resetCustomPresets()
    expect(hasGlassPreset('brandFloating')).toBe(false)
    expect(getGlassPreset('brandFloating').radius).toBe(GLASS_PRESETS.custom.radius) // 未登记回退 custom
  })
})

describe('★G-07 <pg-glass> 组件挂载（Web L2）', () => {
  it('preset=card → 根节点带语义类 + backdrop-filter 样式', async () => {
    const el = mountComponent(PgGlass, { preset: 'card' })
    await nextTick()
    const root = el.querySelector('.pg-glass') as HTMLElement
    expect(root).toBeTruthy()
    expect(root.className).toContain('pg-glass--card')
    expect(root.className).toContain('pg-glass--thin')
    expect(root.style.backdropFilter).toContain('blur(')
    expect(root.style.borderRadius).toBe('16px')
  })

  it('noise>0 → 渲染噪点层；border=false → 无高光边', async () => {
    const el = mountComponent(PgGlass, { preset: 'modal', noise: 0.05 })
    await nextTick()
    expect(el.querySelector('.pg-glass__noise')).toBeTruthy()
    expect(el.querySelector('.pg-glass__highlight')).toBeTruthy()

    const el2 = mountComponent(PgGlass, { preset: 'modal', border: false })
    await nextTick()
    expect(el2.querySelector('.pg-glass__highlight')).toBeNull()
  })

  it('radius 覆盖生效', async () => {
    const el = mountComponent(PgGlass, { preset: 'custom', radius: 32 })
    await nextTick()
    const root = el.querySelector('.pg-glass') as HTMLElement
    expect(root.style.borderRadius).toBe('32px')
  })
})

describe('★G-07 CLI `proteus audit glass`（GLS001-006）', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-glass-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('裸 backdrop-filter（非 <pg-glass>）→ GLS001 error', () => {
    const f = scanGlassSource('src/pages/home.vue', '<style>.box { backdrop-filter: blur(20px); }</style>')
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe('GLS001')
    expect(f[0].severity).toBe('error')
  })

  it('<pg-glass> 与 pg-glass 组件自身实现均不误报', () => {
    expect(scanGlassSource('src/pages/a.vue', '<pg-glass preset="card"/>')).toHaveLength(0)
    // 组件自身实现即合法入口（唯一允许裸 backdrop-filter）
    expect(scanGlassSource('src/components/pg-glass/index.vue', '@supports not (backdrop-filter: blur(1px)) {}')).toHaveLength(0)
  })

  it('行内 d2-exempt 豁免裸玻璃（JS // 与 CSS /* */ 两种写法）；-webkit- 前缀不重复计', () => {
    expect(scanGlassSource('a.vue', '.x{ backdrop-filter: blur(4px) } // d2-exempt: 迁移期')).toHaveLength(0)
    // CSS 块注释 + 紧邻上一行锚点
    expect(scanGlassSource('a.vue', '/* d2-exempt: 滚动态导航 */\n.x{ backdrop-filter: blur(8px); }')).toHaveLength(0)
    // -webkit-backdrop-filter 是同一声明的厂商前缀，不单独计违规
    expect(scanGlassSource('a.vue', '.y{ -webkit-backdrop-filter: blur(8px); }')).toHaveLength(0)
    const deep = '<pg-glass>\n<pg-glass>\n<pg-glass>\n</pg-glass>\n</pg-glass>\n</pg-glass>'
    const deepFindings = scanGlassSource('a.vue', deep)
    expect(deepFindings.some((x) => x.rule === 'GLS004' && x.severity === 'warn')).toBe(true)
    const many = Array.from({ length: GLASS_MAX_NODES + 3 }, () => '<pg-glass/>').join('\n')
    expect(scanGlassSource('a.vue', many).some((x) => x.rule === 'GLS005')).toBe(true)
    expect(GLASS_MAX_NEST_DEPTH).toBe(2)
  })

  it('runGlassAudit 目录扫描：合规目录 ok=true，含裸玻璃 ok=false', () => {
    fs.mkdirSync(path.join(tmp, 'src/pages'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'src/pages/ok.vue'), '<template><pg-glass preset="card"/></template>')
    const clean = runGlassAudit(path.join(tmp, 'src'))
    expect(clean.ok).toBe(true)
    expect(clean.stats.glassNodes).toBe(1)

    fs.writeFileSync(path.join(tmp, 'src/pages/bad.vue'), '<style>.b{backdrop-filter:blur(2px)}</style>')
    const dirty = runGlassAudit(path.join(tmp, 'src'))
    expect(dirty.ok).toBe(false)
    expect(dirty.stats.bareBackdrop).toBe(1)
  })
})
