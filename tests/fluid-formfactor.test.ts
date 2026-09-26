// tests/fluid-formfactor.test.ts
// @vitest-environment jsdom
// ★★Fluid System v2 形态感知层回归锁（2026-09-26）
// 背景：旧柔性系统只有容器宽度一个维度 → PC 1280 与车机 1280、TV 1920 只有宽度差异
//   （用户实测：「大屏设备表现的形态基本没什么差异」「和传统响应式布局没有任何大的差异」）。
//   本文件锁死三件事：① 形态画像表的自洽性（门禁）② 求解优先级（声明 > 探测 > 兜底）
//   ③ ★大屏四形态（tablet / pc / car / tv）在拓扑·导航·输入·能力·缩放上**两两不同**——
//     这一条是防「再退回响应式」的根因回归锁。
import { describe, it, expect, vi } from 'vitest'
import {
  FORM_PROFILES,
  formLabel,
  senseForm,
  probePointer,
  formSupports,
  validateFormProfiles,
  createFormFactor,
  type DeviceForm,
  type FormProfile,
} from '../packages/fluid/src/formfactor'

describe('★形态画像表（SSOT）自洽性', () => {
  it('validateFormProfiles：七形态齐备 · 拓扑/导航合法 · 缩放为正 · 能力与输入自洽', () => {
    expect(validateFormProfiles()).toEqual([])
  })

  it('画像差异有真实设备依据（关键几项快照）', () => {
    // 手表：一屏一意 + 紧凑密度 + 无 hover/无 Tab
    expect(FORM_PROFILES.watch.topology).toBe('glance')
    expect(FORM_PROFILES.watch.density).toBe('compact')
    expect(FORM_PROFILES.watch.caps.hover).toBe(false)
    // 手机：单列 + 底部 Tab + 抽屉
    expect(FORM_PROFILES.phone.topology).toBe('stack')
    expect(FORM_PROFILES.phone.caps.tabs).toBe(true)
    // PC：唯一有 hover + 键盘
    expect(FORM_PROFILES.pc.caps.hover).toBe(true)
    expect(FORM_PROFILES.pc.caps.keyboard).toBe(true)
    // 车机：驾驶降干扰 + 无多规格选择（分心风险）+ 大间距
    expect(FORM_PROFILES.car.caps.driveAware).toBe(true)
    expect(FORM_PROFILES.car.caps.skuMulti).toBe(false)
    expect(FORM_PROFILES.car.density).toBe('comfortable')
    // TV：10ft 观看距离 → 1.4 倍视觉缩放 + 无高密度信息
    expect(FORM_PROFILES.tv.scale).toBe(1.4)
    expect(FORM_PROFILES.tv.caps.dense).toBe(false)
  })

  it('★大屏四形态（tablet / pc / car / tv）互不相同——防「再退回响应式布局」的根因锁', () => {
    const forms: DeviceForm[] = ['tablet', 'pc', 'car', 'tv']
    const fingerprints = forms.map((f) => {
      const p = FORM_PROFILES[f]
      const capsOn = (Object.keys(p.caps) as Array<keyof typeof p.caps>).filter((k) => p.caps[k]).sort().join(',')
      return `${p.topology}|${p.nav}|${p.input}|${p.density}|${p.scale}|${capsOn}`
    })
    const uniq = new Set(fingerprints)
    expect(uniq.size, `大屏四形态指纹须两两不同，实际：\n${fingerprints.join('\n')}`).toBe(4)
    // 且不能「只有缩放不同」——拓扑或导航至少一项不同
    const topoNav = forms.map((f) => `${FORM_PROFILES[f].topology}|${FORM_PROFILES[f].nav}`)
    expect(new Set(topoNav).size, `四形态 拓扑|导航 须两两不同：${topoNav.join(' / ')}`).toBe(4)
    // 拓扑覆盖：平板分栏 / PC 侧栏网格 / 车机与 TV 焦点行（但导航不同：focus-tree vs focus-row）
    expect(FORM_PROFILES.tablet.topology).toBe('rail-split')
    expect(FORM_PROFILES.pc.topology).toBe('rail-grid')
    // ★车机（驾驶大卡片）与 TV（lean-back 海报流）拓扑必须不同——大屏同质化根因锁
    expect(FORM_PROFILES.car.topology).toBe('dashboard')
    expect(FORM_PROFILES.tv.topology).toBe('hero-focus-row')
    expect(FORM_PROFILES.car.nav).not.toBe(FORM_PROFILES.tv.nav)
  })

  it('formLabel 双语 + 未知形态回退', () => {
    expect(formLabel('tv', 'zh')).toBe('TV / 大屏')
    expect(formLabel('tv', 'en')).toBe('TV / Large screen')
    expect(formLabel('unknown' as DeviceForm, 'zh')).toBe('unknown')
  })
})

describe('★形态求解：声明 > 探测 > 兜底', () => {
  it('宿主声明权威：declared=car 时即使探测像 PC 也判车机', () => {
    const r = senseForm({ declared: 'car', viewport: { width: 1440, height: 900 }, pointer: { fine: true, hover: true } })
    expect(r.form).toBe('car')
    expect(r.source).toBe('declared')
  })

  it('★watch / car / tv 不可自动识别——未声明时不猜（诚实边界）', () => {
    // 1920 宽的指针系设备 → pc（不是 tv）；1280 宽的触控大屏 → tablet（不是 car）
    expect(senseForm({ viewport: { width: 1920, height: 1080 }, pointer: { fine: true, hover: true } }).form).toBe('pc')
    expect(senseForm({ viewport: { width: 1280, height: 480 }, pointer: { coarse: true } }).form).toBe('tablet')
  })

  it('探测：指针系 → pc；触控系按宽度 → phone / fold / tablet', () => {
    const p = { coarse: false, fine: true, hover: true }
    expect(senseForm({ viewport: { width: 1440, height: 900 }, pointer: p }).form).toBe('pc')
    const t = { coarse: true, fine: false, hover: false }
    expect(senseForm({ viewport: { width: 390, height: 844 }, pointer: t }).form).toBe('phone')
    expect(senseForm({ viewport: { width: 700, height: 900 }, pointer: t }).form).toBe('fold')
    expect(senseForm({ viewport: { width: 1024, height: 768 }, pointer: t }).form).toBe('tablet')
  })

  it('无信号 → fallback phone（不抛错）', () => {
    const r = senseForm({})
    expect(r.form).toBe('phone')
    expect(r.source).toBe('fallback')
  })

  it('probePointer：两能力皆无 → 按触控系处理（旧内核/SSR 朴素但正确）', () => {
    const mm = () => ({ matches: false })
    expect(probePointer(mm)).toEqual({ coarse: true, fine: false, hover: false })
    const mm2 = (q: string) => ({ matches: q.includes('fine') || q.includes('hover') })
    expect(probePointer(mm2)).toEqual({ coarse: false, fine: true, hover: true })
  })
})

describe('★能力判定与响应式上下文', () => {
  it('formSupports：声明即支持、未声明即降级', () => {
    expect(formSupports('pc', 'hover')).toBe(true)
    expect(formSupports('car', 'hover')).toBe(false)
    expect(formSupports('tv', 'dense')).toBe(false)
    expect(formSupports('watch', 'tabs')).toBe(false)
  })

  it('createFormFactor：setDeclared 触发订阅（端 profile 热切换）', () => {
    const ff = createFormFactor({ declared: 'phone', readViewport: () => ({ width: 1440, height: 900 }) })
    expect(ff.get().form).toBe('phone')
    const seen: DeviceForm[] = []
    ff.subscribe((s) => seen.push(s.form))
    ff.setDeclared('car')
    expect(ff.get().form).toBe('car')
    expect(seen).toEqual(['car'])
    ff.destroy()
  })

  it('createFormFactor：视口跨档重求解（resize 触发；注册了监听才触发）', () => {
    let w = 390
    // happy-dom 提供 addEventListener——resize 事件驱动 refresh
    const ff = createFormFactor({ readViewport: () => ({ width: w, height: 900 }) })
    const before = ff.get().form
    const seen: DeviceForm[] = []
    ff.subscribe((s) => seen.push(s.form))
    w = 1024
    globalThis.dispatchEvent(new Event('resize'))
    expect(ff.get().form).toBe('tablet')
    expect(before).toBe('phone')
    expect(seen).toEqual(['tablet'])
    ff.destroy()
  })
})

describe('形态画像表结构（供 UI 消费）', () => {
  it('每形态都有 viewport 提示 + label 双语', () => {
    for (const [k, p] of Object.entries(FORM_PROFILES) as Array<[DeviceForm, FormProfile]>) {
      expect(p.viewport.width, `${k} viewport`).toBeGreaterThan(0)
      expect(p.label.zh.length, `${k} zh label`).toBeGreaterThan(0)
      expect(p.label.en.length, `${k} en label`).toBeGreaterThan(0)
    }
  })
})
