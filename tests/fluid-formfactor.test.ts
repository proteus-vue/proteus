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
  resolveFluidMetrics,
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
    expect(FORM_PROFILES.tv.visual.ratio.max).toBeGreaterThanOrEqual(2) // 10ft 可放大
    expect(FORM_PROFILES.tv.caps.dense).toBe(false)
  })

  it('★大屏四形态（tablet / pc / car / tv）互不相同——防「再退回响应式布局」的根因锁', () => {
    const forms: DeviceForm[] = ['tablet', 'pc', 'car', 'tv']
    const fingerprints = forms.map((f) => {
      const p = FORM_PROFILES[f]
      const capsOn = (Object.keys(p.caps) as Array<keyof typeof p.caps>).filter((k) => p.caps[k]).sort().join(',')
      // ★指纹含视觉语言（主题/强调色）与流体基准——形态差异的多维度（不止布局）
      return `${p.topology}|${p.nav}|${p.input}|${p.density}|${p.visual.theme}|${p.visual.accent}|${p.visual.ratio.ref}|${capsOn}`
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

  it('★流体度量（v3）：尺寸由容器宽驱动——同一形态任意容器宽都正确（无缩放/无裁剪）', () => {
    // k = clamp(min, containerWidth / ref, max)：ref 处 k=1（设计尺寸）
    const atRef = resolveFluidMetrics(FORM_PROFILES.car.visual.ratio.ref, FORM_PROFILES.car)
    expect(atRef.k).toBe(1)
    expect(atRef.clamped).toBe('none')
    expect(atRef.vars['--pf-font']).toBe(`${FORM_PROFILES.car.visual.ratio.baseFont}px`)
    // 窄容器（mockup 缩放）→ k < 1 但受 min 护栏；宽容器（真实设备）→ k > 1 但受 max 护栏
    const narrow = resolveFluidMetrics(300, FORM_PROFILES.car)
    expect(narrow.k).toBeLessThan(1)
    expect(narrow.clamped).toBe('min')
    expect(Number.parseFloat(narrow.vars['--pf-font'])).toBeGreaterThanOrEqual(FORM_PROFILES.car.visual.ratio.baseFont * FORM_PROFILES.car.visual.ratio.min - 0.01)
    const wide = resolveFluidMetrics(1920, FORM_PROFILES.car)
    expect(wide.k).toBe(FORM_PROFILES.car.visual.ratio.max)
    expect(wide.clamped).toBe('max')
    // 均匀缩放：所有变量同比（无失真）
    const a = resolveFluidMetrics(320, FORM_PROFILES.phone)
    const b = resolveFluidMetrics(640, FORM_PROFILES.phone)
    const ratio = b.k / a.k
    const fa = Number.parseFloat(a.vars['--pf-font'])
    const fb = Number.parseFloat(b.vars['--pf-font'])
    expect(Math.abs(fb / fa - ratio)).toBeLessThan(0.02)
    // 容器不可测（SSR/MP 首帧）→ 按设计尺寸（k=1），不抛错
    expect(resolveFluidMetrics(0, FORM_PROFILES.tv).k).toBe(1)
    // 遥控形态热区更大（d-pad 可达）
    const carCtl = Number.parseFloat(resolveFluidMetrics(640, FORM_PROFILES.car).vars['--pf-control'])
    const phoneCtl = Number.parseFloat(resolveFluidMetrics(640, FORM_PROFILES.phone).vars['--pf-control'])
    expect(carCtl).toBeGreaterThan(phoneCtl)
  })

  it('★展示壳规格（mockup 帧）：七形态比例/上限宽/刘海/状态栏齐备且合法', () => {
    for (const [f, p] of Object.entries(FORM_PROFILES) as Array<[DeviceForm, FormProfile]>) {
      expect(/^\d+\/\d+$/.test(p.frame.ar), `${f} ar`).toBe(true)
      expect(p.frame.maxWidth, `${f} maxWidth`).toBeGreaterThanOrEqual(180)
      expect(p.frame.radius, `${f} radius`).toBeGreaterThan(0)
    }
    // 手机有刘海+状态栏；手表/PC/车机/TV 无
    expect(FORM_PROFILES.phone.frame.notch).toBe(true)
    expect(FORM_PROFILES.phone.frame.statusBar).toBe(true)
    expect(FORM_PROFILES.tv.frame.notch).toBe(false)
    // 帧上限宽：小屏 < 大屏（视觉层级正确）
    expect(FORM_PROFILES.watch.frame.maxWidth).toBeLessThan(FORM_PROFILES.pc.frame.maxWidth)
  })

  it('★视觉语言（形态级主题）：TV/车机暗色沉浸 · 10ft 大字号 · 遥控焦点环可见', () => {
    // 旧版设计本意：TV 是 lean-back 暗色沉浸（不是把浅色 UI 塞进大框）
    expect(FORM_PROFILES.tv.visual.theme).toBe('dark')
    expect(FORM_PROFILES.car.visual.theme).toBe('dark')
    expect(FORM_PROFILES.phone.visual.theme).toBe('light')
    // 观看距离决定尺度的**上限**（10ft/驾驶须能放大到远距离可读——ratio.max 护栏）
    expect(FORM_PROFILES.tv.visual.ratio.max).toBeGreaterThanOrEqual(2)
    expect(FORM_PROFILES.car.visual.ratio.max).toBeGreaterThanOrEqual(1.5)
    expect(FORM_PROFILES.tv.visual.ratio.baseFont).toBeGreaterThan(FORM_PROFILES.phone.visual.ratio.baseFont)
    // 遥控/键盘形态焦点必须可见（焦点环）；触控形态无
    expect(FORM_PROFILES.tv.visual.focus).toBe('ring')
    expect(FORM_PROFILES.car.visual.focus).toBe('ring')
    expect(FORM_PROFILES.phone.visual.focus).toBe('none')
    // 强调色：TV/车机用暖橙价格（旧版 #ffb13d）
    expect(FORM_PROFILES.tv.visual.accent).toBe('#ffb13d')
    // 距离档语义
    expect(FORM_PROFILES.tv.distance).toBe('10ft')
    expect(FORM_PROFILES.car.distance).toBe('dashboard')
  })

  it('★能力清单 14 项（对齐旧版六端能力表：SKU/Tab/hover/d-pad/表冠/密度/焦点树/焦点行/多列/侧栏 + 框架补充）', () => {
    const keys = Object.keys(FORM_PROFILES.tv.caps)
    expect(keys.length).toBe(14)
    for (const k of ['skuMulti', 'tabs', 'hover', 'dpad', 'crown', 'dense', 'focusTree', 'focusRows', 'multiCol', 'sidebar']) {
      expect(keys, `能力清单应含 ${k}（旧版能力表项）`).toContain(k)
    }
    // 语义正确性：TV 有遥控焦点/焦点行/多列但无 SKU 多选·无高密度·无侧栏（旧版勾选态）
    expect(FORM_PROFILES.tv.caps).toMatchObject({ dpad: true, focusRows: true, multiCol: true, skuMulti: false, dense: false, sidebar: false })
    // 车机：d-pad + 表冠 + 焦点树 + 密集 + 驾驶降干扰；无多规格
    expect(FORM_PROFILES.car.caps).toMatchObject({ dpad: true, crown: true, focusTree: true, dense: true, driveAware: true, skuMulti: false })
  })

  it('★形态级媒体比例 + 安全区 + 铰链（专家报告：旧版 mediaAr 丢失 / 安全区缺失 / 无铰链语义）', () => {
    // 媒体比例按形态（旧版设计意图：phone 4/3 · tablet/fold 1/1 · pc 16/10 · car/tv 16/9）
    expect(FORM_PROFILES.phone.mediaRatio).toBe('4/3')
    expect(FORM_PROFILES.tablet.mediaRatio).toBe('4/3')
    expect(FORM_PROFILES.fold.mediaRatio).toBe('1/1')
    expect(FORM_PROFILES.car.mediaRatio).toBe('16/9')
    expect(FORM_PROFILES.tv.mediaRatio).toBe('16/9')
    // 安全区：iPad 握持 20pt / 手机 Home Indicator 34pt / 车机边缘
    expect(FORM_PROFILES.tablet.safe?.side).toBe(20)
    expect(FORM_PROFILES.phone.safe?.bottom).toBe(34)
    expect(FORM_PROFILES.car.safe?.side).toBeGreaterThan(0)
    // 铰链语义：仅折叠屏有（内容不得跨折痕）
    expect(FORM_PROFILES.fold.frame.hinge).toBe(true)
    for (const f of ['phone', 'tablet', 'pc', 'car', 'tv', 'watch'] as DeviceForm[]) {
      expect(FORM_PROFILES[f].frame.hinge, `${f} 不应有铰链`).toBeFalsy()
    }
    // ★折叠屏内屏近方形（专家报告 P1-1：曾 520 会被自身阈值判成 phone）
    const foldW = FORM_PROFILES.fold.viewport.width
    expect(foldW).toBeGreaterThanOrEqual(600)
    const { width: fw, height: fh } = FORM_PROFILES.fold.viewport
    expect(fw / fh).toBeGreaterThan(0.7) // 近方形（真实 Z Fold 内屏 0.86）
    expect(fw / fh).toBeLessThan(1)
    // 平板横屏（专家报告 P1-5/P2-4：曾竖屏视口配横屏帧）
    const { width: tw, height: th } = FORM_PROFILES.tablet.viewport
    expect(tw).toBeGreaterThan(th)
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
