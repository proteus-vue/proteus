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
  FORM_CAP_KEYS,
  formLabel,
  senseForm,
  probePointer,
  formSupports,
  validateFormProfiles,
  createFormFactor,
  resolveFluidMetrics,
  resolveFrameVars,
  capsLabel,
  capsEnabled,
  capsDegraded,
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
    expect(capsLabel(FORM_PROFILES.watch.caps.hover)).toBe('unsupported')
    // 手机：单列 + 底部 Tab + 抽屉
    expect(FORM_PROFILES.phone.topology).toBe('stack')
    expect(capsLabel(FORM_PROFILES.phone.caps.tabs)).toBe('supported')
    // PC：唯一有 hover + 键盘
    expect(capsLabel(FORM_PROFILES.pc.caps.hover)).toBe('supported')
    expect(capsLabel(FORM_PROFILES.pc.caps.keyboard)).toBe('supported')
    // 车机：驾驶降干扰 + 无多规格选择（分心风险）+ 大间距
    expect(capsLabel(FORM_PROFILES.car.caps.driveAware)).toBe('supported')
    expect(capsLabel(FORM_PROFILES.car.caps.skuMulti)).toBe('fallback')  // ★三态：降级而非删除
    expect(FORM_PROFILES.car.density).toBe('comfortable')
    // TV：10ft 观看距离 → 1.4 倍视觉缩放 + 无高密度信息
    expect(FORM_PROFILES.tv.visual.ratio.max).toBeGreaterThanOrEqual(2) // 10ft 可放大
    expect(capsLabel(FORM_PROFILES.tv.caps.dense)).toBe('unsupported')
  })

  it('★大屏四形态（tablet / pc / car / tv）互不相同——防「再退回响应式布局」的根因锁', () => {
    const forms: DeviceForm[] = ['tablet', 'pc', 'car', 'tv']
    const fingerprints = forms.map((f) => {
      const p = FORM_PROFILES[f]
      const capsOn = (Object.keys(p.caps) as Array<keyof typeof p.caps>).filter((k) => capsEnabled(p.caps[k])).sort().join(',')
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
    // ★热区下限语义（三审定稿）：物理 dp 按**展示缩放**投影——同一容器宽下不同形态的
    //   「帧内 px」不可直接比较（车机是 50% 缩略、手机是 1:1）。比较必须换算到**设备尺度 dp**：
    //     car  640px 帧 → scale 0.50 → 39px 帧内 = 78dp ✓（AAOS ≥76）
    //     phone 640px 帧 → scale 1.00 → 50.7px 帧内 = 50.7dp ✓（HIG ≥44）
    //   绝对 px 版本（曾把 76px 塞进缩略帧）会把主视觉挤没——当时的 ≥76 断言之所以「通过」
    //   是因为 phone 也被错算成 76（`caps.dpad ? …` 三态裸真值），属永真断言。
    const dpOf = (form: DeviceForm, ctl: number): number => {
      const p = FORM_PROFILES[form]
      return ctl / (Math.min(1, 640 / p.viewport.width) || 1)
    }
    expect(dpOf('car', carCtl)).toBeGreaterThanOrEqual(76)
    expect(dpOf('phone', phoneCtl)).toBeGreaterThanOrEqual(44)
    expect(dpOf('car', carCtl)).toBeGreaterThan(dpOf('phone', phoneCtl))
  })

  it('★热区下限（三审）：**在设备尺度上**任何形态 × 任何容器宽 → ≥44dp（遥控/驾驶 ≥76dp）', () => {
    // 规范依据：Apple HIG 44pt / Material 48dp（保守取 44）· AAOS 76dp。
    // ★物理语义：展示壳是等比缩略——540px 帧展示 1280pt 车机 = 42% 尺度，
    //   76dp 在帧内投影为 ~32px。故断言**换算回设备尺度**后的等效 dp，而非帧内绝对 px
    //   （早期版本把 76px 当绝对 px 塞进缩略帧 → 热区占内容高 44%、主视觉被挤没）。
    const cases: Array<[DeviceForm, number]> = [
      ['watch', 240], ['watch', 198], ['phone', 300], ['phone', 390], ['phone', 430],
      ['fold', 470], ['fold', 340], ['tablet', 520], ['tablet', 1194],
      ['pc', 620], ['pc', 1440], ['car', 760], ['car', 1280], ['tv', 620], ['tv', 1920],
    ]
    for (const [form, w] of cases) {
      const p = FORM_PROFILES[form]
      const m = resolveFluidMetrics(w, p)
      const px = Number.parseFloat(m.vars['--pf-control'])
      const deviceW = p.viewport.width
      const showScale = Math.min(1, w / deviceW)
      // 帧内 px → 设备尺度 px（÷ 展示缩放）；再与 dp 下限比较（1dp ≈ 1px @1x）
      const dp = px / (showScale || 1)
      const need = capsEnabled(p.caps.dpad) ? 76 : 44
      expect(dp, `${form}@${w} 热区换算 ${dp.toFixed(1)}dp < ${need}dp（帧内 ${px.toFixed(1)}px）`).toBeGreaterThanOrEqual(need - 0.6)
    }
  })

  it('★姿态级度量（三审）：折叠态外屏用 phone 级基准 → 正文不再 9.7px', () => {
    const folded = FORM_PROFILES.fold.postures?.find((x) => x.key === 'folded')
    expect(folded?.ratio, '折叠态须有姿态级 ratio（否则外层 340pt 用内屏 ref:420）').toBeTruthy()
    const eff = { ...FORM_PROFILES.fold, visual: { ...FORM_PROFILES.fold.visual, ratio: folded!.ratio! } }
    const m = resolveFluidMetrics(340, eff)
    const font = Number.parseFloat(m.vars['--pf-font'])
    expect(font).toBeGreaterThanOrEqual(11) // WCAG 可读底线（此前 9.7px）
  })

  it('★iPhone Duo 对齐（2026-09-28 借鉴 Apple HIG）：外屏宽而矮 · 控件侧置 · 跨姿态一致功能', () => {
    // Apple HIG「Designing for iPhone Duo」（2026-09-09 新增页）+ 官方技术规格：
    //   内屏 1878×2670px @430ppi ≈ 626×890pt · 外屏 1398×2034px @460ppi ≈ 466×678pt
    //   关键指导：① 宽而矮的外屏把工具栏/Tab 移到**侧边**（vertical controls，保垂直内容空间）
    //            ② 内屏横向时控件保持同侧（跨屏连续）③ 跨姿态保持**同样功能**
    const fold = FORM_PROFILES.fold
    const folded = fold.postures?.find((x) => x.key === 'folded')
    const expanded = fold.postures?.find((x) => x.key === 'expanded')
    // ① 外屏真实比例：宽而矮（而非 Z Fold 式窄长）——旧值 340×800（w/h=0.43），真机 466/678=0.69
    expect(folded!.viewport.width).toBeGreaterThan(folded!.viewport.height * 0.6)
    // ② 控件侧置：折叠/展开两姿态都用 side-tabs（跨姿态同侧）
    expect(folded!.nav).toBe('side-tabs')
    expect(expanded!.nav).toBe('side-tabs')
    // ③ 内屏视口对齐真机（626×890pt 量级）
    expect(expanded!.viewport.width).toBeGreaterThanOrEqual(600)
    expect(expanded!.viewport.width / expanded!.viewport.height).toBeCloseTo(626 / 890, 1)
    // ④ 展开视口 > 折叠视口（连续性语义保持不变）
    expect(expanded!.viewport.width).toBeGreaterThan(folded!.viewport.width)
    // ⑤ 校验器认可新 nav 取值
    expect(validateFormProfiles()).toEqual([])
  })

  it('★安全区按展示缩放投影（2026-09-27）：TV overscan 在缩略壳内仍为**设备的 5%**', () => {
    // 用户实测「TV 四周都有边界、不沉浸」的根因：96px 是**真机 1920 的 5%**，
    // 却按绝对 px 塞进 620px 缩略壳 = 15.5%（比真机大三倍）。物理量必须按展示缩放投影。
    const tv = FORM_PROFILES.tv
    const wide = resolveFrameVars(tv, 620)
    const narrow = resolveFrameVars(tv, 540)
    const side = (v: string) => Number.parseFloat(v)
    // 620 帧：96 × (620/1920) = 31px ≈ 帧宽 5%
    expect(side(wide['--pf-safe-side'])).toBeCloseTo(31, 0)
    expect(side(wide['--pf-safe-side']) / 620).toBeCloseTo(0.05, 2)
    // 540 帧：96 × (540/1920) = 27px
    expect(side(narrow['--pf-safe-side'])).toBeCloseTo(27, 0)
    // 不传宽 → 按设计帧宽（mockup 默认口径）投影
    const dflt = side(resolveFrameVars(tv)['--pf-safe-side']!)
    expect(dflt).toBeCloseTo(96 * (tv.frame.maxWidth / 1920), 0)
    // 底部同理（54 × 620/1920 = 17.4px）
    expect(side(wide['--pf-safe-bottom'])).toBeCloseTo(17, 0)
    // 真机/超宽：满值（不做反向放大）
    expect(side(resolveFrameVars(tv, 1920)['--pf-safe-side'])).toBeCloseTo(96, 0)
    expect(side(resolveFrameVars(tv, 3840)['--pf-safe-side'])).toBeCloseTo(96, 0)
  })

  it('★媒体展示尺度（2026-09-27 用户实测）：hero 形态 ×2.6（10ft 主视觉），其余 ×1', () => {
    // 英雄区是 10ft 主视觉：媒体内容在 620px 缩略壳里若只有 ~43px 会像贴纸浮在大画布上。
    // 框架按形态声明尺度，业务用变量消费（零形态分支）。
    expect(resolveFrameVars(FORM_PROFILES.tv)['--pf-media-scale']).toBe('2.6')
    expect(resolveFrameVars(FORM_PROFILES.car)['--pf-media-scale']).toBe('1')
    expect(resolveFrameVars(FORM_PROFILES.phone)['--pf-media-scale']).toBe('1')
    // 只有 hero 拓扑得到放大（防以后误加到别的形态）
    for (const f of ['watch', 'phone', 'fold', 'tablet', 'pc', 'car'] as DeviceForm[]) {
      expect(resolveFrameVars(FORM_PROFILES[f])['--pf-media-scale'], `${f} 不应放大媒体`).toBe('1')
    }
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
    expect(FORM_PROFILES.watch.frame.statusBar).toBe(true) // ★表盘状态栏（时间）
    expect(FORM_PROFILES.watch.frame.watchFace).toBe(true)
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
    expect(FORM_PROFILES.tv.caps).toMatchObject({ dpad: 'supported', focusRows: 'supported', multiCol: 'supported', skuMulti: 'unsupported', dense: 'unsupported', sidebar: 'unsupported' })
    // 车机：d-pad + 表冠 + 焦点树 + 驾驶降干扰；无多规格（fallback）
    // ★三审：dense 撤除（接口注释明示「10ft 与驾驶场景为 false」，此前误声明且无有效后果）
    expect(FORM_PROFILES.car.caps).toMatchObject({ dpad: 'supported', crown: 'supported', focusTree: 'supported', driveAware: 'supported', skuMulti: 'fallback' })
    expect(FORM_PROFILES.car.caps.dense).toBe('unsupported')
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

  it('★能力三态（报告 P2-2）：supported / fallback / unsupported——车机 SKU 走降级而非删除', () => {
    // 三态判定助手
    expect(capsLabel('supported')).toBe('supported')
    expect(capsLabel(true)).toBe('supported')       // 布尔兼容
    expect(capsLabel('fallback')).toBe('fallback')
    expect(capsLabel('unsupported')).toBe('unsupported')
    expect(capsLabel(false)).toBe('unsupported')
    // 有渲染路径 vs 降级
    expect(capsEnabled('supported')).toBe(true)
    expect(capsEnabled('fallback')).toBe(true)      // ★降级路径仍需渲染（替代形态）
    expect(capsEnabled('unsupported')).toBe(false)
    expect(capsDegraded('fallback')).toBe(true)
    // ★车机 SKU 是 fallback（语音/旋钮单选替代多选），不是 unsupported（此前布尔无法表达该区别）
    expect(capsLabel(FORM_PROFILES.car.caps.skuMulti)).toBe('fallback')
    // 手机 SKU 是 supported；TV 是 unsupported（10ft 无多规格手势）
    expect(capsLabel(FORM_PROFILES.phone.caps.skuMulti)).toBe('supported')
    expect(capsLabel(FORM_PROFILES.tv.caps.skuMulti)).toBe('unsupported')
  })

  it('★折叠屏姿态集（报告 P0-2）：折叠/半折/展开三态 + 连续性（视口递增 · 拓扑切换）', () => {
    const postures = FORM_PROFILES.fold.postures
    expect(postures, '折叠屏须声明姿态集').toBeTruthy()
    const keys = postures!.map((x) => x.key)
    expect(keys).toEqual(['folded', 'tabletop', 'expanded'])
    const folded = postures!.find((x) => x.key === 'folded')!
    const tabletop = postures!.find((x) => x.key === 'tabletop')!
    const expanded = postures!.find((x) => x.key === 'expanded')!
    // ★连续性：折叠态 → 展开态视口变宽，且拓扑从单列切到双窗格（app continuity 语义）
    // ★连续性：展开态（内屏 673）宽于折叠态（外屏 340）——折叠态视口须显著更窄
    expect(expanded.viewport.width).toBeGreaterThan(folded.viewport.width)
    expect(folded.viewport.width).toBeLessThan(500)
    expect(folded.topology).not.toBe(expanded.topology)
    expect(expanded.topology).toBe('duo')
    expect(folded.topology).toBe('stack')
    // 半折有水平铰链（上半展示 / 下半操作）
    expect(tabletop.hinge).toBe('horizontal')
    // 单姿态形态不应有 postures（避免无意义复杂度）
    for (const f of ['phone', 'watch', 'pc', 'tv', 'car', 'tablet'] as DeviceForm[]) {
      expect(FORM_PROFILES[f].postures, `${f} 不应声明姿态集`).toBeFalsy()
    }
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

describe('★★能力可证伪性（专家报告 P1-4：面板绿点必须有消费者）', () => {
  it('★三态真值安全（二次复审 P0）：组件内不得对 CapsLevel 做裸真值判断', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const comp = fs.readFileSync(
      require('node:path').resolve(__dirname, '../packages/components/p-formfactor/index.vue'),
      'utf8',
    )
    // ★教训（7 位复审专家一致命中）：`Boolean('unsupported')` 恒真 → 未支持的能力反而渲染出徽标
    //   （手表/手机上出现 ⌘K 与表冠，与同屏面板「未支持」自相矛盾）。
    //   本门禁：模板与脚本里禁止裸用 caps.X / caps.value.X 做真值判断，必须走 capsEnabled/capsLabel。
    //   ★2026-09-26 三审扩面：同时扫 **fluid/src/*.ts**——同类缺陷曾在 SSOT 内存活
    //   （`profile.caps.dpad ? … : 3.0` 让 76dp 下限外溢到全部形态，而门禁只扫 .vue）。
    const fluidSrc = fs
      .readdirSync(require('node:path').resolve(__dirname, '../packages/fluid/src'))
      .filter((f: string) => f.endsWith('.ts'))
      .map((f: string) => fs.readFileSync(require('node:path').resolve(__dirname, '../packages/fluid/src', f), 'utf8'))
      .join('\n')
    const bareFluid = [...fluidSrc.matchAll(/(?:if \(|\?\s|Boolean\()\s*[^\n]*caps(?:\.value)?\.(\w+)\b(?![\w(])/g)]
      .map((m) => m[0])
      .filter((line) => !/capsEnabled\(|capsLabel\(|capsDegraded\(/.test(line))
      .filter((line) => !/\/\//.test(line))
    expect(bareFluid, `fluid/src 内发现裸真值判断（三态字符串恒真）：\n${bareFluid.join('\n')}`).toEqual([])
    const bare = [...comp.matchAll(/(?:v-if|:class|Boolean\()\s*[^\n]*caps(?:\.value)?\.(\w+)\b(?![\w(])/g)]
      .map((m) => m[0].trim())
      .filter((line) => !/capsEnabled\(|capsLabel\(/.test(line))
      // 允许：三态助手内部实现（formfactor 包，不在此文件）
      .filter((line) => !/skuLevel|capsLevelOf|cap-|has-/.test(line))
    expect(bare, `发现裸真值判断（三态字符串恒真）：\n${bare.join('\n')}`).toEqual([])
  })

  it('14 项 caps 每一项都在组件层有消费点（静态扫描——防「空头声明」回归）', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const comp = fs.readFileSync(
      require('node:path').resolve(__dirname, '../packages/components/p-formfactor/index.vue'),
      'utf8',
    )
    const caps = Object.keys(FORM_PROFILES.tv.caps)
    const missing: string[] = []
    for (const cap of caps) {
      // 组件中需出现 caps.<name> 的消费（模板 v-if 或 rootClass 映射）
      // 消费形态：caps.X（直接）/ c.X（rootClass）/ capsEnabled(caps.X) / 三态经 XxxLevel 派生
      const consumed =
        new RegExp(`caps\\.${cap}\\b`).test(comp) ||
        new RegExp(`c\\.${cap}\\b`).test(comp) ||
        (cap === 'skuMulti' && /skuLevel/.test(comp)) ||
        (cap === 'dpad' && /has-dpad/.test(comp)) ||
        (cap === 'crown' && /pf-crown-hint/.test(comp))
      if (!consumed) missing.push(cap)
    }
    expect(missing, `以下能力声明无消费者（面板绿点不可证伪）：${missing.join(', ')}`).toEqual([])
  })

  it('★FORM_CAP_KEYS 是能力键 SSOT：七画像的 caps 键集逐项与之相等（面板派生依据）', () => {
    // 面板/审计遍历 FORM_CAP_KEYS；若某画像漏写字段（键集小于 SSOT）→ 面板会把它当 unsupported 显示，
    // 属「悄悄降级」；多写字段则是幽灵字段。两侧都必须红。
    expect(FORM_CAP_KEYS.length).toBe(14)
    for (const [form, profile] of Object.entries(FORM_PROFILES)) {
      expect(Object.keys(profile.caps).sort(), `${form} 的 caps 键集与 SSOT 不一致`).toEqual([...FORM_CAP_KEYS].sort())
    }
  })
})

describe('★能力判定与响应式上下文', () => {
  it('formSupports：声明即支持、未声明即降级', () => {
    expect(formSupports('pc', 'hover')).toBe(true)  // formSupports 归一为布尔（三态归一）
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
