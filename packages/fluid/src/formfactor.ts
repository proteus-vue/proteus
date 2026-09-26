// packages/fluid/src/formfactor.ts
// ★★Fluid System v2 · 设备形态感知层（2026-09-26 重构）
//
// 解决的问题（旧版柔性系统的根本缺陷）：
//   旧版只有「容器宽度」一个维度（断点 sm/md/lg/xl）——PC 1280 与车机 1280、TV 1920 在系统眼里
//   只有宽度差异 → 大屏之间形态无区分度，业务只能自己写 if-else 堆能力（「响应式布局 + 能力堆积木」）。
//
// 本模块把**设备形态（form factor）升为一等概念**：形态是由 输入方式 / 观看距离 / 交互精度 /
//   导航模型 共同定义的**画像（profile）**，布局拓扑、导航形态、能力集、密度与视觉缩放
//   全部从画像**自动推导**——业务不再手写「哪种设备显示什么」，只声明内容语义槽。
//
// 三层感知模型（权威性从高到低）：
//   ① 宿主声明（declared）——端 profile / URL 参数 / 宿主注入：**唯一可靠来源**，尤其
//      watch / car / tv（Web 无法自动识别车机与电视——诚实边界，不猜）
//   ② 环境探测（pointer/hover media query + 视口尺寸）——Web 端 phone / tablet / pc 可推断
//   ③ 容器尺寸（context.ts）——同形态内连续变量（档位/断点），不决定形态本身
//
// 诚实边界：形态画像表是**声明式 SSOT**（与组件兼容进度表同一套 supported/fallback 语义）；
//   未声明的能力 = 该形态不支持 → 组件自动走降级分支（不静默失败）。

import type { FluidDensity } from './scale'

/** 设备形态（一等概念） */
export type DeviceForm = 'watch' | 'phone' | 'fold' | 'tablet' | 'pc' | 'car' | 'tv'

/** 输入方式（形态的本质特征之一——决定命中区尺寸/焦点模型/悬停语义） */
export type InputMode = 'touch' | 'cursor' | 'remote' | 'dial'

/** 布局拓扑（框架据形态自动选用——业务不感知） */
export type LayoutTopology =
  /** 一屏一意（手表：只留核心信息与主操作） */
  | 'glance'
  /** 单列纵向（手机） */
  | 'stack'
  /** 双列：主图 + 详情（折叠屏/小平板） */
  | 'duo'
  /** 侧栏 + 主体分栏（平板横屏） */
  | 'rail-split'
  /** 侧栏 + 多列网格（PC） */
  | 'rail-grid'
  /** 大 Hero + 焦点海报行（TV——lean-back 10ft 横滑流） */
  | 'hero-focus-row'
  /** 驾驶大卡片（车机——单层大热区 dashboard，驾驶降干扰不做过密信息） */
  | 'dashboard'

/** 导航形态（形态驱动——车机焦点树 / TV 海报行 / 手表页栈 / PC 侧栏） */
export type NavTopology = 'page-stack' | 'bottom-tabs' | 'tabs' | 'rail' | 'side-nav' | 'focus-tree' | 'focus-row'

/** 形态能力声明（组件据此自动降级；未声明 = 不支持） */
export interface FormCaps {
  /** 指针悬停态（触控/遥控形态为 false——hover 样式与提示自动不渲染） */
  hover: boolean
  /** 多规格/SKU 选择（车机驾驶场景分心风险 → false，走精简分支） */
  skuMulti: boolean
  /** 底部 Tab 栏 */
  tabs: boolean
  /** 侧栏（持久导航） */
  sidebar: boolean
  /** 横向焦点行（海报流——遥控器/旋钮可达） */
  focusRows: boolean
  /** 高密度信息（一屏塞多组信息——10ft 观看距离与驾驶场景为 false） */
  dense: boolean
  /** 抽屉/侧滑弹层（触控形态支持；遥控形态用全屏 dialog 替代） */
  drawer: boolean
  /** 异形屏/刘海（顶部安全区预留） */
  notch: boolean
  /** 物理/软键盘输入（PC 支持键盘快捷键；触控形态无） */
  keyboard: boolean
  /** 驾驶降干扰（限制动效 + 精简信息层级——车机专有语义） */
  driveAware: boolean
}

/** 形态画像（声明式 SSOT——布局/导航/能力/密度/缩放全从这里推导） */
export interface FormProfile {
  form: DeviceForm
  label: { zh: string; en: string }
  /** 输入方式 */
  input: InputMode
  /** 信息密度（字号/行高/间距——resolveDensity 消费） */
  density: FluidDensity
  /** 布局拓扑（框架自动选用） */
  topology: LayoutTopology
  /** 导航形态 */
  nav: NavTopology
  /** 视觉缩放（10ft TV 放大 / 手表紧凑；1 = 基准） */
  scale: number
  /** 典型视口（文档/演示用；真实值以容器查询为准） */
  viewport: { width: number; height: number }
  /** 能力声明 */
  caps: FormCaps
}

const CAPS_BASE: FormCaps = {
  hover: false,
  skuMulti: false,
  tabs: false,
  sidebar: false,
  focusRows: false,
  dense: false,
  drawer: false,
  notch: false,
  keyboard: false,
  driveAware: false,
}

/** ★形态画像表（SSOT）——每项差异都有真实设备依据（注释标注） */
export const FORM_PROFILES: Record<DeviceForm, FormProfile> = {
  watch: {
    form: 'watch',
    label: { zh: '手表', en: 'Watch' },
    input: 'dial', // 表冠 + 触控
    density: 'compact',
    topology: 'glance', // 一屏一意（抬腕场景）
    nav: 'page-stack', // 页栈（无 Tab 无侧栏）
    scale: 0.85, // 小屏紧凑
    viewport: { width: 198, height: 242 },
    caps: { ...CAPS_BASE, notch: false },
  },
  phone: {
    form: 'phone',
    label: { zh: '手机', en: 'Phone' },
    input: 'touch',
    density: 'regular',
    topology: 'stack', // 单列纵向
    nav: 'bottom-tabs', // 底部 Tab
    scale: 1,
    viewport: { width: 390, height: 844 },
    caps: { ...CAPS_BASE, skuMulti: true, tabs: true, dense: true, drawer: true, notch: true },
  },
  fold: {
    form: 'fold',
    label: { zh: '折叠屏', en: 'Foldable' },
    input: 'touch',
    density: 'regular',
    topology: 'duo', // 展开态：主图 + 详情双列（display-mode: fold/span）
    nav: 'tabs',
    scale: 1,
    viewport: { width: 520, height: 720 },
    caps: { ...CAPS_BASE, skuMulti: true, dense: true, drawer: true, notch: true },
  },
  tablet: {
    form: 'tablet',
    label: { zh: '平板', en: 'Tablet' },
    input: 'touch',
    density: 'regular',
    topology: 'rail-split', // 侧栏 + 主体分栏
    nav: 'rail',
    scale: 1,
    viewport: { width: 834, height: 1112 },
    caps: { ...CAPS_BASE, skuMulti: true, sidebar: true, dense: true, drawer: true },
  },
  pc: {
    form: 'pc',
    label: { zh: 'PC / Mac', en: 'PC / Mac' },
    input: 'cursor',
    density: 'regular',
    topology: 'rail-grid', // 侧栏 + 多列网格
    nav: 'side-nav',
    scale: 1,
    viewport: { width: 1440, height: 900 },
    caps: { ...CAPS_BASE, hover: true, skuMulti: true, sidebar: true, dense: true, keyboard: true },
  },
  car: {
    form: 'car',
    label: { zh: '车机', en: 'In-car' },
    input: 'remote', // 旋钮 / d-pad
    density: 'comfortable', // 驾驶场景：大间距大热区
    topology: 'dashboard', // 驾驶大卡片（单层大热区——与 TV 的 lean-back 海报流本质不同）
    nav: 'focus-tree',
    scale: 1.15, // 远距离可读
    viewport: { width: 1280, height: 480 },
    // ★车机能力画像（真实约束）：驾驶中不做精细多规格选择（分心风险）、无悬停、限制动效
    caps: { ...CAPS_BASE, focusRows: true, driveAware: true },
  },
  tv: {
    form: 'tv',
    label: { zh: 'TV / 大屏', en: 'TV / Large screen' },
    input: 'remote',
    density: 'comfortable',
    topology: 'hero-focus-row', // 大 Hero + 横向海报流
    nav: 'focus-row',
    scale: 1.4, // 10ft lean-back 观看距离 → 字号放大
    viewport: { width: 1920, height: 1080 },
    // ★TV 能力画像：10ft 远距离 → 不做高密度信息、无 hover（遥控器）、无侧栏（水平海报流主导）
    caps: { ...CAPS_BASE, focusRows: true },
  },
}

/** 形态标签（UI 展示用；未知形态回退 form 字符串） */
export function formLabel(form: DeviceForm, locale: 'zh' | 'en' = 'zh'): string {
  const p = FORM_PROFILES[form]
  return p ? (locale === 'en' ? p.label.en : p.label.zh) : form
}

/** 形态求解输入（感知层原始信号） */
export interface FormSense {
  /** ★宿主声明（权威；端 profile / URL / 宿主注入）——watch/car/tv 的唯一可靠来源 */
  declared?: DeviceForm | null
  /** 视口/容器尺寸（探测兜底与同形态档位） */
  viewport?: { width: number; height: number } | null
  /** 输入能力探测（Web matchMedia 真实读取：pointer/hover） */
  pointer?: { coarse?: boolean; fine?: boolean; hover?: boolean } | null
}

export interface ResolvedForm {
  form: DeviceForm
  profile: FormProfile
  /** 来源（诊断/诚实标注用）：declared = 宿主声明；sensed = 环境推断；fallback = 兜底 */
  source: 'declared' | 'sensed' | 'fallback'
}

/**
 * 形态求解（感知层出口）：声明 > 探测 > 兜底。
 * ★探测边界（诚实）：Web 只能区分触控系（phone/tablet）与指针系（pc）——
 *   watch / car / tv **不可自动识别**（无标准信号），必须由宿主声明；未声明时按尺寸兜底到 phone/tablet/pc。
 */
export function senseForm(sense: FormSense = {}): ResolvedForm {
  const declared = sense.declared
  if (declared && FORM_PROFILES[declared]) {
    return { form: declared, profile: FORM_PROFILES[declared], source: 'declared' }
  }
  const vp = sense.viewport
  const pointer = sense.pointer ?? {}
  const width = vp && vp.width > 0 ? vp.width : 0
  // 指针系（鼠标/触控板）→ pc（唯一有指针的形态）
  if (pointer.fine && pointer.hover) {
    return { form: 'pc', profile: FORM_PROFILES.pc, source: 'sensed' }
  }
  // 触控系 → 按宽度推断 phone / fold / tablet（形态内档位；fold 需 display-mode 信号，此处按宽度近似）
  if (width > 0) {
    if (width < 600) return { form: 'phone', profile: FORM_PROFILES.phone, source: 'sensed' }
    if (width < 900) return { form: 'fold', profile: FORM_PROFILES.fold, source: 'sensed' }
    return { form: 'tablet', profile: FORM_PROFILES.tablet, source: 'sensed' }
  }
  return { form: 'phone', profile: FORM_PROFILES.phone, source: 'fallback' }
}

/** Web 端指针能力探测（matchMedia——注入可单测；无 matchMedia → 视为触控系） */
export function probePointer(
  matchMedia?: (q: string) => { matches: boolean } | null,
): { coarse: boolean; fine: boolean; hover: boolean } {
  const mm =
    matchMedia ??
    ((q: string) => {
      const fn = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia
      try {
        return typeof fn === 'function' ? fn(q) : null
      } catch {
        return null
      }
    })
  const read = (q: string): boolean => {
    try {
      return mm(q)?.matches === true
    } catch {
      return false
    }
  }
  const fine = read('(pointer: fine)')
  const coarse = read('(pointer: coarse)')
  const hover = read('(hover: hover)')
  // 两者皆非（旧内核/服务端渲染）→ 按触控系处理（渲染层自决降级，G-22.2「朴素但正确」）
  if (!fine && !coarse) return { coarse: true, fine: false, hover }
  return { coarse, fine, hover }
}

/** 能力判定（组件消费入口）：某形态是否声明支持该能力 */
export function formSupports(form: DeviceForm, cap: keyof FormCaps): boolean {
  return FORM_PROFILES[form]?.caps[cap] === true
}

/**
 * 形态画像校验（SSOT 门禁——新增形态/能力时防止漏填）：
 * ① 七形态画像齐备且 form 字段自洽 ② 拓扑/导航枚举合法 ③ 缩放为正数
 * ④ focusRows 与 input 自洽（焦点行要求遥控类输入）⑤ dense 与 topology 不矛盾（glance 必须 compact+非 dense）
 */
export function validateFormProfiles(
  profiles: Record<DeviceForm, FormProfile> = FORM_PROFILES,
): string[] {
  const problems: string[] = []
  const forms: DeviceForm[] = ['watch', 'phone', 'fold', 'tablet', 'pc', 'car', 'tv']
  const topologies: LayoutTopology[] = ['glance', 'stack', 'duo', 'rail-split', 'rail-grid', 'hero-focus-row', 'dashboard']
  const navs: NavTopology[] = ['page-stack', 'bottom-tabs', 'tabs', 'rail', 'side-nav', 'focus-tree', 'focus-row']
  for (const f of forms) {
    const p = profiles[f]
    if (!p) {
      problems.push(`形态画像缺失：${f}`)
      continue
    }
    if (p.form !== f) problems.push(`${f}: form 字段自洽（实际 ${p.form}）`)
    if (!topologies.includes(p.topology)) problems.push(`${f}: 非法拓扑 ${p.topology}`)
    if (!navs.includes(p.nav)) problems.push(`${f}: 非法导航 ${p.nav}`)
    if (!(p.scale > 0)) problems.push(`${f}: 缩放须为正数（实际 ${p.scale}）`)
    if (p.caps.focusRows && p.input === 'touch') problems.push(`${f}: 焦点行要求遥控类输入（实际 ${p.input}）`)
    if (p.topology === 'glance' && p.caps.dense) problems.push(`${f}: 一屏一意（glance）不应声明 dense`)
    if (p.density === 'compact' && p.input === 'remote') problems.push(`${f}: 遥控形态不应 compact（远距离可读性）`)
  }
  return problems
}

/* ───────────────────────── 响应式形态上下文 ───────────────────────── */

export interface FormFactorOptions {
  /** 宿主声明（权威）——变化时可直接 setDeclared */
  declared?: DeviceForm | null
  /** matchMedia 注入（测试/非浏览器环境） */
  matchMedia?: (q: string) => { matches: boolean } | null
  /** 视口尺寸读取器（缺省 window.innerWidth/Height；无 window → 0×0 兜底） */
  readViewport?: () => { width: number; height: number }
}

export interface FormFactorState extends ResolvedForm {}

export interface FormFactor {
  get(): FormFactorState
  /** 宿主声明变更（端 profile 热切换） */
  setDeclared(form: DeviceForm | null): void
  subscribe(cb: (state: FormFactorState) => void): () => void
  destroy(): void
}

function defaultReadViewport(): { width: number; height: number } {
  const g = globalThis as { innerWidth?: number; innerHeight?: number }
  return { width: g.innerWidth ?? 0, height: g.innerHeight ?? 0 }
}

/**
 * 创建响应式形态上下文：初始求解 + 监听（pointer media query 变化 / 视口尺寸跨档 / 宿主声明变更）。
 * ★响应式语义：形态变化 → 订阅者重渲染（布局拓扑与能力集随之自动切换）。
 */
export function createFormFactor(opts: FormFactorOptions = {}): FormFactor {
  const readViewport = opts.readViewport ?? defaultReadViewport
  let declared: DeviceForm | null = opts.declared ?? null
  const listeners: Array<(s: FormFactorState) => void> = []

  const solve = (): FormFactorState =>
    senseForm({ declared, viewport: readViewport(), pointer: probePointer(opts.matchMedia) })

  let state: FormFactorState = solve()

  const refresh = (): void => {
    const next = solve()
    if (next.form === state.form && next.source === state.source) return
    state = next
    for (const l of listeners) l(state)
  }

  // 监听接线（无浏览器环境跳过——SSR/测试安全）
  const cleanups: Array<() => void> = []
  const g = globalThis as {
    addEventListener?: (t: string, cb: () => void) => void
    removeEventListener?: (t: string, cb: () => void) => void
  }
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('resize', refresh)
    cleanups.push(() => g.removeEventListener?.('resize', refresh))
  }
  // pointer/hover 变化（外接鼠标、二合一设备翻转）
  const mm = opts.matchMedia ?? ((q: string) => {
    const fn = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia
    try {
      return typeof fn === 'function' ? fn(q) : null
    } catch {
      return null
    }
  })
  for (const q of ['(pointer: fine)', '(hover: hover)']) {
    try {
      const mql = mm(q) as (MediaQueryListLike & { matches: boolean }) | null
      const cb = (): void => refresh()
      mql?.addEventListener?.('change', cb)
      cleanups.push(() => mql?.removeEventListener?.('change', cb))
    } catch {
      /* 内核不支持该 query → 跳过 */
    }
  }

  return {
    get: () => state,
    setDeclared(form) {
      declared = form
      refresh()
    },
    subscribe(cb) {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
    destroy() {
      for (const c of cleanups) c()
      cleanups.length = 0
      listeners.length = 0
    },
  }
}

/** matchMedia 返回值结构类型（addEventListener/removeEventListener 可选——旧内核只有 addListener） */
export interface MediaQueryListLike {
  matches: boolean
  addEventListener?(event: 'change', cb: () => void): void
  removeEventListener?(event: 'change', cb: () => void): void
}
