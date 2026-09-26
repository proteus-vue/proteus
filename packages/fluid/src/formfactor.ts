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
export type NavTopology =
  | 'page-stack'
  | 'bottom-tabs'
  | 'tabs'
  // ★side-tabs（2026-09-28 借鉴 Apple HIG「Designing for iPhone Duo」）：**宽而矮**的折叠外屏
  //   垂直空间紧张 → 系统把工具栏/Tab 栏移到**侧边**（vertical controls）以保留内容高度。
  //   Apple 原文：「toolbars, tab bars, and navigation controls … move to the side, preserving
  //   vertical space for content」，并强调「keep controls' relative positions as similar as possible」
  //   跨姿态一致。对应我们的 folded 外屏（466×678 —— 比手机更宽更矮）。
  | 'side-tabs'
  | 'rail'
  | 'side-nav'
  | 'focus-tree'
  | 'focus-row'

/** 形态能力声明（组件据此自动降级；未声明 = 不支持）
 *  ★能力清单对齐设计本意（旧版六端能力表）：SKU多选 / 底部Tab / 悬停态 / d-pad遥控焦点 /
 *    表冠旋钮 / 高密度信息 / 焦点树大热区 / 横向焦点行海报流 / 多列并排 / 侧栏
 *    + 框架补充：抽屉 · 异形屏 · 物理键盘 · 驾驶降干扰 */
/**
 * ★★能力三态（2026-09-26 报告 P2-2 收口）：对齐组件兼容进度表协议
 *   `supported`   = 该形态**声明支持**（正常渲染）
 *   `fallback`    = **有条件降级**（渲染降级替代路径——如车机 SKU 走「语音/旋钮单选取代」，
 *                    而非直接删除；此前的布尔 false 把「降级」与「不支持」混为一谈）
 *   `unsupported` = 不支持（不渲染，且**不宜**以任何形式假造）
 *   ★布尔兼容：`true → supported`、`false → unsupported`（既有消费点零改动）。
 */
export type CapsLevel = 'supported' | 'fallback' | 'unsupported' | boolean

/** 判定：该能力是否「有渲染/行为路径」（supported 或 fallback） */
export function capsEnabled(level: CapsLevel | undefined): boolean {
  return level === true || level === 'supported' || level === 'fallback'
}
/** 判定：是否**降级路径**（需渲染替代形态） */
export function capsDegraded(level: CapsLevel | undefined): boolean {
  return level === 'fallback'
}
/** 三态标签（UI 展示/门禁用） */
export function capsLabel(level: CapsLevel | undefined): 'supported' | 'fallback' | 'unsupported' {
  if (level === true || level === 'supported') return 'supported'
  if (level === 'fallback') return 'fallback'
  return 'unsupported'
}

export interface FormCaps {
  /** 多规格/SKU 选择（车机驾驶场景分心风险 → false，走精简分支） */
  skuMulti: CapsLevel
  /** 底部 Tab 栏 */
  tabs: CapsLevel
  /** 指针悬停态（触控/遥控形态为 false——hover 样式与提示自动不渲染） */
  hover: CapsLevel
  /** d-pad / 遥控焦点（遥控形态必有——大热区 + 焦点可见） */
  dpad: CapsLevel
  /** 表冠 / 旋钮（手表表冠、车机旋钮——连续调节输入） */
  crown: CapsLevel
  /** 高密度信息（一屏塞多组信息——10ft 观看距离与驾驶场景为 false） */
  dense: CapsLevel
  /** 焦点树 / 大热区（车机驾驶场景——分层焦点导航） */
  focusTree: CapsLevel
  /** 横向焦点行（海报流——TV lean-back） */
  focusRows: CapsLevel
  /** 多列并排（大屏信息密度表达） */
  multiCol: CapsLevel
  /** 侧栏（持久导航） */
  sidebar: CapsLevel
  /** 抽屉/侧滑弹层（触控形态支持；遥控形态用全屏 dialog 替代） */
  drawer: CapsLevel
  /** 异形屏/刘海（顶部安全区预留） */
  notch: CapsLevel
  /** 物理/软键盘输入（PC 支持键盘快捷键；触控形态无） */
  keyboard: CapsLevel
  /** 驾驶降干扰（限制动效 + 精简信息层级——车机专有语义） */
  driveAware: CapsLevel
}

/**
 * ★★流体度量（v3 核心，2026-09-26 重设计）：
 *   形态**不携带绝对尺寸**——所有尺寸 = 基准单位 × 倍数，基准单位由**容器宽度**推导：
 *     unit = clamp(min, containerWidth × base, max)
 *   `base` 表达「该形态的相对尺度」（10ft 大屏相对更大 / 桌面密排相对更小），
 *   `min/max` 是可读性护栏（mockup 尺寸不缩成蚂蚁字 / 真实大屏不无限放大）。
 *   ★这样同一形态在**任意容器宽**都渲染正确——无需 scale 变换、无需裁剪
 *   （旧版缺陷：绝对 px + 缩放变换 → 只能按「自然视口」渲染再裁切）。
 */
export interface FluidRatio {
  /** ★设计基准字号 px（k=1 时的正文大小——各形态的真实内容尺度差异在此表达） */
  baseFont: number
  /** ★基准容器宽（该形态内容舒适承载宽——容器 = ref 时 k=1 用设计尺寸） */
  ref: number
  /** 尺寸系数下限（防 mockup 缩成蚂蚁字） */
  min: number
  /** 尺寸系数上限（防大容器无限放大） */
  max: number
}

/**
 * 视觉语言（形态级主题——离散；TV/车机是暗色沉浸，10ft 与驾驶场景的真实观感）
 * ★尺寸不在此（见 FluidRatio）——此处只有颜色、焦点语义与流体比例。
 */
export interface FormVisual {
  /** 主题：light = 常规浅色；dark = 沉浸暗色（TV/车机） */
  theme: 'light' | 'dark'
  /** 画布底色 */
  bg: string
  /** 卡片/面板底 */
  surface: string
  /** 主文字 */
  text: string
  /** 次文字 */
  dim: string
  /** 品牌色（按钮/选中） */
  brand: string
  /** 强调色（价格/焦点——TV 用暖橙） */
  accent: string
  /** 焦点环（遥控/键盘形态必有——焦点必须可见；触控形态 none） */
  focus: 'none' | 'ring'
  /** ★流体度量（容器驱动——见 FluidRatio） */
  ratio: FluidRatio
}

/**
 * 形态帧规格（真实 mockup 的框架级支持——旧版设计本意）：
 *   aspect-ratio 决定外框比例；maxWidth 是**展示宽上限**（mockup 舒适尺寸）；
 *   notch = 异形屏（刘海）；statusBar = 顶部状态栏（手机/平板类）。
 * ★帧只影响展示壳，不参与内容度量（内容度量由容器实际宽度驱动）。
 */
export interface FormFrame {
  /** 宽高比（如 '9/16'） */
  ar: string
  /** 展示宽上限 px（mockup 尺寸——居中展示） */
  maxWidth: number
  /** 异形屏（刘海） */
  notch: CapsLevel
  /** 顶部状态栏 */
  statusBar: CapsLevel
  /** 外框圆角（px——按形态：手表更圆 / PC 方） */
  radius: number
  /** ★铰链（折叠屏：竖向折痕在正中——专家报告 P1-2：内容不得跨折痕） */
  hinge?: CapsLevel
  /** ★表盘（手表：状态栏渲染为时间 + complication——报告 P1-4） */
  watchFace?: CapsLevel
}

/** 视角距离档（诚实标注：10ft = 电视观看距离；驾驶 = 车机；桌面 = 臂长） */
export type ViewingDistance = 'glance' | 'arm' | 'desk' | 'dashboard' | '10ft'

/**
 * ★★宽高比分类（2026-09-28，两条国内/国际独立信源共同指向）：
 *   · 华为《布局基础》：断点分**横向断点**（宽度）与**纵向断点**（宽高比）两条独立维度，
 *     原则二「高度相对宽度较小的窗口，可根据宽高比信息进行横向窗口或类方形窗口的差异化设计」。
 *   · 小米《大屏应用 UX 设计指南》：给出**高度断点**（480/900dp）并要求
 *     「**不要使用 rotation，而是根据宽高的大小做布局处理**」；且「宽高比小于 16:9 的窗口」需特殊处理。
 *   ⇒ 二元 orientation（h>w）不足以表达——车机 8/3（2.67）与平板 4/3（1.33）同为 landscape 但形态迥异。
 */
export type AspectClass = 'tall' | 'balanced' | 'wide' | 'ultra-wide'

/** 宽高比分类（输入为容器/视口尺寸；非法尺寸回退 balanced） */
export function resolveAspectClass(width: number, height: number): AspectClass {
  if (!(width > 0) || !(height > 0)) return 'balanced'
  const r = width / height
  if (r < 0.85) return 'tall' // 竖屏/近方（手机 0.46 · 折叠展开 0.70）
  if (r < 1.35) return 'balanced' // 类方形
  if (r < 2.0) return 'wide' // 含小米「16:9 = 1.78」阈值（平板 1.43 · PC 1.60 · TV 1.78）
  return 'ultra-wide' // 极扁（车机 8/3 = 2.67）
}

/**
 * 媒体区高度上限（占可用高度的比例）——按宽高比分配（小米/华为「高度是独立维度」的可执行形态）。
 * 此前逐拓扑硬编码（stack 46% / tabletop 40%），同一个值在极扁画布上会挤没信息区。
 * 越扁的画布，媒体越该让位给信息与操作。
 */
export function aspectMediaCap(aspect: AspectClass): string {
  switch (aspect) {
    case 'tall':
      return '46%'
    case 'balanced':
      return '42%'
    case 'wide':
      return '36%'
    default:
      return '28%' // ultra-wide（车机这类极扁画布）
  }
}

/**
 * ★★折叠屏姿态（2026-09-26 报告 P0-2）：折叠屏的本质是**动态形态**——
 *   `folded`（折叠态：外屏，单屏窄）· `tabletop`（半折：上半展示 + 下半操作）
 *   `expanded`（展开态：内屏，双窗格）
 *   ★连续性（app continuity）：状态与视口在姿态间**连续重排**（不重启、不丢状态）——
 *   框架据 postures 切换拓扑/导航/视口，业务零分支。
 */
export interface FormPosture {
  /** 姿态键 */
  key: 'folded' | 'tabletop' | 'expanded'
  label: { zh: string; en: string }
  /** 该姿态的布局拓扑 */
  topology: LayoutTopology
  /** 该姿态的导航 */
  nav: NavTopology
  /** 该姿态视口（连续性：折叠 340 → 展开 673） */
  viewport: { width: number; height: number }
  /** 半折铰链方向（tabletop 水平铰链——上半展示/下半操作） */
  hinge?: 'horizontal' | 'vertical'
  /** ★姿态级度量覆盖（2026-09-26 三审）：外屏（340pt）在内屏基准（ref:420）下 k=0.81
   *  → 正文 9.7px、规格 Chip 22px（连 WCAG 2.5.8 的 24px 都不达）。
   *  外屏沿用内屏度量基准是错的——Samsung/Google 均按「窄手机」处理外屏。 */
  ratio?: FluidRatio
}

/** 形态画像（声明式 SSOT——布局/导航/能力/密度/缩放**与视觉语言**全从这里推导） */
export interface FormProfile {
  form: DeviceForm
  label: { zh: string; en: string }
  /** 输入方式 */
  input: InputMode
  /** 观看/操作距离（形态语义——决定字号与热区尺寸） */
  distance: ViewingDistance
  /** 信息密度（字号/行高/间距——resolveDensity 消费） */
  density: FluidDensity
  /** 布局拓扑（框架自动选用） */
  topology: LayoutTopology
  /** 导航形态 */
  nav: NavTopology
  /** ★展示壳规格（mockup 帧：比例/上限宽/刘海/状态栏——居中完整展示） */
  frame: FormFrame
  /** ★视觉语言（形态级主题——TV/车机暗色沉浸、10ft 大字号、焦点环可见） */
  visual: FormVisual
  /** ★媒体比例（专家报告 P2-2：旧版有 mediaAr，重建时丢失——形态级媒体形态差异） */
  mediaRatio: string
  /** ★安全区（专家报告 P1-3：TV overscan 5% / iPad 20pt 握持 / 手机 Home Indicator） */
  safe?: { side?: number; bottom?: number; top?: number }
  /** ★姿态集（折叠屏等**动态形态**——折叠/半折/展开；单姿态形态可省） */
  postures?: FormPosture[]
  /** 典型视口（文档/演示用；真实值以容器查询为准） */
  viewport: { width: number; height: number }
  /** 能力声明（14 项——未声明即不支持，组件自动降级） */
  caps: FormCaps
}

const CAPS_BASE: FormCaps = {
  skuMulti: 'unsupported',
  tabs: 'unsupported',
  hover: 'unsupported',
  dpad: 'unsupported',
  crown: 'unsupported',
  dense: 'unsupported',
  focusTree: 'unsupported',
  focusRows: 'unsupported',
  multiCol: 'unsupported',
  sidebar: 'unsupported',
  drawer: 'unsupported',
  notch: 'unsupported',
  keyboard: 'unsupported',
  driveAware: 'unsupported',
}

/**
 * ★能力键全量序列（SSOT）——面板/审计/文档遍历能力的唯一入口。
 * 派生自 CAPS_BASE（每个画像都 spread 它 → 键集恒等），新增能力字段自动入列，
 * 杜绝「面板只列 10/14、恰好漏掉手表唯一支持的 crown」这类手工清单漂移。
 * （tests/fluid-formfactor.test.ts 断言每个画像的 caps 键集与之逐项相等）
 */
export const FORM_CAP_KEYS = Object.freeze(Object.keys(CAPS_BASE) as Array<keyof FormCaps>)

/** ★形态画像表（SSOT）——每项差异都有真实设备依据（注释标注） */
export const FORM_PROFILES: Record<DeviceForm, FormProfile> = {
  watch: {
    form: 'watch',
    label: { zh: '手表', en: 'Watch' },
    input: 'dial', // 表冠 + 触控
    density: 'compact',
    topology: 'glance', // 一屏一意（抬腕场景）
    nav: 'page-stack', // 页栈（无 Tab 无侧栏）
    mediaRatio: '1/1',
    viewport: { width: 198, height: 242 },
    distance: 'glance', // 抬腕一瞥
    // ★视觉语言（2026-09-26 报告 P1-3/P2-1）：手表是 **AMOLED 暗色常亮**形态——
    //   此前浅色（#f2f4fa）在暗色页面上形成眩光块、AMOLED 不省电、夜间不友好；
    //   对比度按 AA 校验（text/bg 18.9:1 · accent/bg 9.8:1）
    visual: { theme: 'dark', bg: '#000000', surface: '#141418', text: '#f5f6fa', dim: '#9aa3b2', brand: '#6f4ae8', accent: '#ff9f43', focus: 'none', ratio: { baseFont: 13, ref: 198, min: 0.9, max: 1.6 } },
    // 展示壳（mockup 帧——居中完整展示：比例/上限宽/刘海/状态栏）
    // ★状态栏 = 时间（报告 P1-4：watchOS/Wear 上「时间」是表盘第一锚点，缺了会立刻显得假）
    frame: { ar: '1/1', maxWidth: 240, notch: false, statusBar: true, radius: 34, watchFace: true },
    caps: { ...CAPS_BASE, crown: 'supported' }, // ★表冠（旧版 cap）+ 无 Tab（一屏一意不设 tabbar）
  },
  phone: {
    form: 'phone',
    label: { zh: '手机', en: 'Phone' },
    input: 'touch',
    density: 'regular',
    topology: 'stack', // 单列纵向
    nav: 'bottom-tabs', // 底部 Tab
    mediaRatio: '4/3',
    safe: { side: 0, bottom: 34 },
    viewport: { width: 390, height: 844 },
    distance: 'arm', // 臂长
    // 视觉语言：常规触控（浅色 · 单列大热区 · 无焦点环）
    visual: { theme: 'light', bg: '#f7f8fa', surface: '#ffffff', text: '#17171f', dim: '#616875', brand: '#6f4ae8', accent: '#6f4ae8', focus: 'none', ratio: { baseFont: 13, ref: 300, min: 0.7, max: 1.5 } }, // ★触控正文（审查：真机 390pt 下 ≈16.9pt ≈ HIG 17pt）
    // 展示壳（mockup 帧——居中完整展示：比例/上限宽/刘海/状态栏）
    frame: { ar: '9/16', maxWidth: 300, notch: true, statusBar: true, radius: 22 },
    caps: { ...CAPS_BASE, skuMulti: 'supported', tabs: 'supported', dense: 'supported', drawer: 'supported', notch: 'supported' },
  },
  fold: {
    form: 'fold',
    label: { zh: '折叠屏', en: 'Foldable' },
    input: 'touch',
    density: 'regular',
    topology: 'duo', // 展开态：主图 + 详情双列（display-mode: fold/span）
    nav: 'tabs',
    mediaRatio: '1/1',
    safe: { side: 0, bottom: 16 },
    // ★姿态集（报告 P0-2）：折叠态外屏（单列+Tab）→ 半折 tabletop（水平铰链）→ 展开态内屏（双窗格）
    //   连续性语义：视口 340 → 673，拓扑 stack → duo（状态跨姿态连续重排，不重启）
    postures: [
      // ★折叠态度量（三审）：外屏 = 窄手机——用 phone 级基准（ref 300），不用内屏 ref 420
      // ★折叠态（2026-09-28 对齐 Apple HIG「Designing for iPhone Duo」）：
      //   ① 视口 340×800 → **466×678**（Duo 外屏 1398×2034px @460ppi ≈ 466×678pt）——
      //      真实折叠外屏是「比手机更宽更矮」，不是窄长竖屏（旧值来自 Z Fold 式窄外屏）；
      //   ② nav bottom-tabs → **side-tabs**：Apple 明确「宽而矮的外屏把控件移到侧边，
      //      以保留垂直空间」，且内屏横向时控件保持同侧（跨屏连续）。
      { key: 'folded', label: { zh: '折叠态（外屏）', en: 'Folded (cover)' }, topology: 'stack', nav: 'side-tabs', viewport: { width: 466, height: 678 }, ratio: { baseFont: 13, ref: 340, min: 0.85, max: 1.5 } },
      // ★半折（2026-09-28）：视口 673×420 是**横屏**——Apple HIG 明确「controls remain on the side
      //   in landscape to preserve a continuous experience」，且要求跨姿态控件位置一致
      //   （用户不应随姿态变化重新学习操作在哪）→ nav 统一 side-tabs（三姿态同侧）。
      { key: 'tabletop', label: { zh: '半折（桌面模式）', en: 'Tabletop (flex)' }, topology: 'stack', nav: 'side-tabs', viewport: { width: 673, height: 420 }, hinge: 'horizontal' },
      // ★展开态（2026-09-28）：内屏横向时控件**保持侧边**（Apple：controls remain on the side
      //   in landscape to preserve a continuous experience at the same vertical height）——
      //   跨姿态控件位置一致，用户不用重新学习操作在哪。
      { key: 'expanded', label: { zh: '展开态（内屏）', en: 'Expanded (inner)' }, topology: 'duo', nav: 'side-tabs', viewport: { width: 626, height: 890 } },
    ],
    viewport: { width: 626, height: 890 }, // ★2026-09-28：对齐 Duo 内屏（1878×2670px @430ppi ≈ 626×890pt）
    distance: 'arm',
    visual: { theme: 'light', bg: '#f6f7fb', surface: '#ffffff', text: '#17171f', dim: '#616875', brand: '#6f4ae8', accent: '#6f4ae8', focus: 'none', ratio: { baseFont: 12, ref: 420, min: 0.7, max: 1.5 } },
    // 展示壳（mockup 帧——居中完整展示：比例/上限宽/刘海/状态栏）
    frame: { ar: '6/7', maxWidth: 470, notch: false, statusBar: true, radius: 18, hinge: true },
    // ★nav↔caps 自洽（2026-09-26 二次复审 P1）：三姿态的 nav 均为 tabs/bottom-tabs，
    //   但 caps.tabs 曾为 unsupported → Tab 栏被能力过滤永久不渲染 = 折叠屏**零导航**。
    //   折叠屏就是触控大屏（展开态 673×841），Tab 是其真实导航形态，故声明 supported。
    caps: { ...CAPS_BASE, tabs: 'supported', skuMulti: 'supported', multiCol: 'supported', dense: 'supported', drawer: 'supported', notch: 'supported' },
  },
  tablet: {
    form: 'tablet',
    label: { zh: '平板', en: 'Tablet' },
    input: 'touch',
    density: 'regular',
    topology: 'rail-split', // 侧栏 + 主体分栏
    nav: 'rail',
    mediaRatio: '4/3',
    safe: { side: 20, bottom: 24 },
    viewport: { width: 1194, height: 834 },
    distance: 'arm',
    // 视觉语言：分栏阅读（浅色 · 中等字号 · 无焦点环）
    visual: { theme: 'light', bg: '#f4f6fb', surface: '#ffffff', text: '#1a2a55', dim: '#616875', brand: '#6f4ae8', accent: '#6f4ae8', focus: 'none', ratio: { baseFont: 12.5, ref: 520, min: 0.68, max: 1.5 } },
    // 展示壳（mockup 帧——居中完整展示：比例/上限宽/刘海/状态栏）
    frame: { ar: '4/3', maxWidth: 520, notch: false, statusBar: true, radius: 20 },
    caps: { ...CAPS_BASE, skuMulti: 'supported', sidebar: 'supported', multiCol: 'supported', dense: 'supported', drawer: 'supported' },
  },
  pc: {
    form: 'pc',
    label: { zh: 'PC / Mac', en: 'PC / Mac' },
    input: 'cursor',
    density: 'regular',
    topology: 'rail-grid', // 侧栏 + 多列网格
    nav: 'side-nav',
    mediaRatio: '16/10',
    viewport: { width: 1440, height: 900 },
    distance: 'desk', // 桌面臂长（信息密度最高）
    // 视觉语言：桌面密排（浅色 · 三栏 · hover 反馈 · 键盘焦点环细）
    visual: { theme: 'light', bg: '#f7f8fa', surface: '#ffffff', text: '#17171f', dim: '#616875', brand: '#6f4ae8', accent: '#6f4ae8', focus: 'ring', ratio: { baseFont: 13, ref: 620, min: 0.62, max: 1.45 } }, // ★桌面字 ≥ 平板（审查：曾 12 < 12.5） // 键盘 Tab 可达 → 焦点环可见
    // 展示壳（mockup 帧——居中完整展示：比例/上限宽/刘海/状态栏）
    frame: { ar: '16/10', maxWidth: 620, notch: false, statusBar: false, radius: 12 },
    caps: { ...CAPS_BASE, hover: 'supported', skuMulti: 'supported', sidebar: 'supported', multiCol: 'supported', dense: 'supported', keyboard: 'supported' },
  },
  car: {
    form: 'car',
    label: { zh: '车机', en: 'In-car' },
    input: 'remote', // 旋钮 / d-pad
    density: 'comfortable', // 驾驶场景：大间距大热区
    topology: 'dashboard', // 驾驶大卡片（单层大热区——与 TV 的 lean-back 海报流本质不同）
    nav: 'focus-tree',
    mediaRatio: '16/9',
    safe: { side: 8, bottom: 8 },
    viewport: { width: 1280, height: 480 },
    distance: 'dashboard', // 驾驶位
    // ★视觉语言：驾驶暗色舱（暗底 + 高亮大热区瓦片 + 暖橙强调 + 焦点环粗——驾驶员余光可辨）
    // ★色值修正（2026-09-26 专家审查）：text 曾 == bg（#10142a）→ 标题对比度 1.00:1 完全隐形；
    //   surface 曾 = #ffffff → 夜间白块眩光（17.1:1）且暖橙价格在白底仅 1.81:1。
    //   改为浅色文字 + 半透明卡面（对齐 TV 写法）→ 价格 #ffb13d on 暗底 = 10.05:1
    visual: { theme: 'dark', bg: '#10142a', surface: 'rgba(255,255,255,0.10)', text: '#eef2ff', dim: '#8b93a7', brand: '#6f4ae8', accent: '#ffb13d', focus: 'ring', ratio: { baseFont: 15, ref: 640, min: 0.65, max: 1.8 } },
    // 展示壳（mockup 帧——居中完整展示：比例/上限宽/刘海/状态栏）
    frame: { ar: '8/3', maxWidth: 760, notch: false, statusBar: false, radius: 14 },
    // ★车机能力画像（真实约束）：驾驶中不做精细多规格选择（分心风险）、无悬停、限制动效
    // ★车机能力画像（2026-09-26 三态）：多规格**降级**而非删除——驾驶场景用「语音/旋钮单选」
    //   替代多选（旧版设计本意：`@conditional` 退化为单选/语音选择），不是「不支持」
    // ★dense 撤除（2026-09-26 三审）：接口注释明示「10ft 与驾驶场景为 false」，此前误声明支持
    //   且内联 --pf-gap-dense 恒覆盖 .is-dense → 无任何有效后果（声明与语义双错）。
    caps: { ...CAPS_BASE, skuMulti: 'fallback', dpad: 'supported', crown: 'supported', focusTree: 'supported', multiCol: 'supported', focusRows: 'supported', driveAware: 'supported' },
  },
  tv: {
    form: 'tv',
    label: { zh: 'TV / 大屏', en: 'TV / Large screen' },
    input: 'remote',
    density: 'comfortable',
    topology: 'hero-focus-row', // 大 Hero + 横向海报流
    nav: 'focus-row',
    mediaRatio: '16/9',
    // ★overscan（2026-09-26 二次复审纠正：上轮提交信息声称已改 96/54 但代码实为 0/0——现真正落地）
    safe: { side: 96, bottom: 54 },
    viewport: { width: 1920, height: 1080 },
    distance: '10ft', // 客厅沙发距离
    // ★视觉语言：10ft 沉浸暗色（深蓝底 + 半透明海报胶囊 + 暖橙价格 + 焦点环粗）
    // ★10ft 度量修正（专家审查：14px 相对 PC 12px 只大 1.17×，而观看距离差 5×；
    //   1080p 实机 30.8px ≈ 15.4sp 低于 Android TV 正文下限 16sp）→ baseFont 18 / max 2.6
    visual: { theme: 'dark', bg: '#0f1838', surface: 'rgba(255,255,255,0.12)', text: '#ffffff', dim: '#bcd0e8', brand: '#6f4ae8', accent: '#ffb13d', focus: 'ring', ratio: { baseFont: 18, ref: 620, min: 0.68, max: 2.6 } },
    // 展示壳（mockup 帧——居中完整展示：比例/上限宽/刘海/状态栏）
    frame: { ar: '16/9', maxWidth: 620, notch: false, statusBar: false, radius: 12 },
    // ★TV 能力画像：10ft 远距离 → 不做高密度信息、无 hover（遥控器）、无侧栏（水平海报流主导）
    caps: { ...CAPS_BASE, dpad: 'supported', focusRows: 'supported', multiCol: 'supported' },
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

/**
 * ★★流体度量求解（v3 核心 API）：容器宽 + 形态 → CSS 变量表
 *
 *   k = clamp(ratio.min, containerWidth / ratio.ref, ratio.max)   // 尺寸系数
 *   unit = k px（所有尺寸 = unit × 语义倍数：font 1× / title 1.35× / gap 0.55× / control 3.2×）
 *
 * ★ratio.ref = 该形态的**基准容器宽**（内容舒适承载宽）：
 *   容器 = ref → k = 1（设计尺寸）；容器更窄 → 内容等比缩小（mockup 场景）；
 *   容器更宽 → 等比放大（真实大屏场景）。min/max 是可读性护栏（防蚂蚁字 / 防无限放大）。
 *
 * ★为什么这样设计（旧版缺陷的对症修复）：
 *   旧版形态携带**绝对 px**（TV font 38px）→ 只能按「自然视口」渲染再靠 scale 变换缩到展示区
 *   （内容被裁切、非居中）。改为「容器驱动比例」后，**同一形态在任意容器宽都正确渲染**：
 *   mockup 尺寸与真实设备尺寸走同一条公式，只是 k 不同——无缩放变换、无裁剪。
 */
export interface FluidMetrics {
  /** 尺寸系数（已 clamp） */
  k: number
  /** 是否被护栏截断（诊断用） */
  clamped: 'none' | 'min' | 'max'
  /** CSS 变量表（--pf-u / --pf-font / --pf-gap / --pf-pad / --pf-radius / --pf-control——全部有真实消费者） */
  vars: Record<string, string>
}

export function resolveFluidMetrics(containerWidth: number, profile: FormProfile): FluidMetrics {
  const r = profile.visual.ratio
  const w = containerWidth > 0 ? containerWidth : r.ref
  const raw = w / r.ref
  let k = raw
  let clamped: FluidMetrics['clamped'] = 'none'
  if (containerWidth <= 0) {
    k = 1 // 容器不可测（SSR/MP 首帧）→ 按设计尺寸（渲染端自决，朴素但正确）
  } else if (raw < r.min) {
    k = r.min
    clamped = 'min'
  } else if (raw > r.max) {
    k = r.max
    clamped = 'max'
  }
  const px = (m: number): string => `${Math.round(r.baseFont * k * m * 100) / 100}px`
  // ★热区下限（2026-09-26 三审定稿）——**物理量按设备尺度换算**，不是容器绝对 px：
  //   · 规范下限：遥控/驾驶 ≥76dp（AAOS）· 触控/旋钮 ≥44dp（HIG 44pt / Material 48dp 保守下界）
  //   · 但展示壳（mockup）只是真机的**等比縮略**：车机帧 540 / 真机 1280 → 42% 尺度。
  //     若把 76px 当绝对 px 塞进 540 帧，热区会占内容高 44% → 主视觉被挤没、文案只剩省略号
  //     （实测：立即购买被压到 58px 宽）。正确语义 = `minDp × 展示缩放`，真机（w ≥ 设备宽）时为满值。
  //   · 并修同类三态裸真值：`profile.caps.dpad ? …` 对 'unsupported' 恒真
  //     → 76dp 下限曾外溢到全部 7 形态（3.0 分支不可达、测试断言被削成永真）。
  const deviceW = profile.viewport.width > 0 ? profile.viewport.width : r.ref
  const showScale = Math.min(1, w / deviceW) // 展示缩放（真机/超宽 → 1，不做反向放大）
  const minDp = capsEnabled(profile.caps.dpad) ? 76 : 44
  const control = Math.max(2.6, (minDp * showScale) / (r.baseFont * k))
  return {
    k: Math.round(k * 100) / 100,
    clamped,
    vars: {
      '--pf-u': px(1),
      '--pf-font': px(1),
      '--pf-gap': px(0.55),
      '--pf-pad': px(1),
      '--pf-radius': px(0.6),
      '--pf-control': px(control),
    },
  }
}

/** 形态帧 CSS 变量（展示壳——比例/上限宽/刘海；帧只影响壳，不参与内容度量）
 *  ★containerWidth（2026-09-27）：**安全区是设备物理量**（TV overscan = 真机 1920 的 5% = 96px），
 *  必须按展示缩放投影进缩略壳——否则 96px 塞进 620px 帧 = 15.5%（比真机大三倍），
 *  用户实测「TV 不沉浸、四周都是边界」。传 0/不传 → 按设计帧宽投影（mockup 默认口径）。 */
export function resolveFrameVars(profile: FormProfile, containerWidth = 0): Record<string, string> {
  const deviceW = profile.viewport.width > 0 ? profile.viewport.width : profile.frame.maxWidth
  const w = containerWidth > 0 ? containerWidth : profile.frame.maxWidth
  const showScale = Math.min(1, w / deviceW) // 展示缩放（真机/超宽 → 1）
  const safePx = (dp: number | undefined): string => `${Math.round((dp ?? 0) * showScale * 100) / 100}px`
  return {
    // ★形态级媒体比例（2026-09-26 二次复审 P1：此前 0 发射点 → 7 形态全走 4/3 fallback）
    '--pf-media-ar': profile.mediaRatio.replace('/', ' / '),
    // ★媒体展示尺度（2026-09-27 用户实测）：英雄区是**10ft 主视觉**——媒体内容（产品图/封面）
    //   在 620px 缩略壳里只有 ~43px，像一枚贴纸浮在大画布上（「图片位置奇怪」的观感来源之一）。
    //   框架按形态声明尺度：hero 形态 ×2.6（10ft 主视觉），其余 ×1。业务侧用变量消费（零分支）。
    '--pf-media-scale': profile.topology === 'hero-focus-row' ? '2.6' : '1',
    // ★安全区（复审 P1：0 发射点已修；三审再修「物理量按展示缩放投影」——见函数注释）
    '--pf-safe-side': safePx(profile.safe?.side),
    '--pf-safe-bottom': safePx(profile.safe?.bottom),
    // ★铰链几何（二次复审 P1：折叠屏折痕此前只是装饰；现把真实铰链带交给布局消费——
    //   真机（Web foldable）有 env(fold-*) → 双栏按窗格成列；无该 API 的环境回退 0px = 现有行为）
    ...(profile.frame.hinge
      ? { '--pf-fold-width': 'env(fold-width, 0px)' }
      : {}),
    // ★notch 的真实消费量（2026-09-26 三审：此前 notch 只有类名、零后果——声明不可证伪）：
    //   真机刘海屏（Web standalone / 沉浸模式）经 env(safe-area-inset-top) 让位；桌面 env=0 无副作用
    ...(capsEnabled(profile.caps.notch) ? { '--pf-safe-top': 'env(safe-area-inset-top, 0px)' } : {}),
  }
}

/** 能力判定（组件消费入口）：某形态是否声明支持该能力 */
export function formSupports(form: DeviceForm, cap: keyof FormCaps): boolean {
  // ★三态归一（2026-09-26）：supported / fallback 都算「有路径」；仅 unsupported 为 false
  return capsEnabled(FORM_PROFILES[form]?.caps[cap])
}

/**
 * 形态画像校验（SSOT 门禁——新增形态/能力时防止漏填）：
 * ① 七形态齐备 / form 自洽 / 拓扑·导航枚举合法 / 度量护栏 / 展示壳规格
 * ② 姿态集齐备 · 视口递增 · 折叠/展开拓扑不同 · 姿态级度量护栏
 * ③ 颜色对比度（text/bg ≥4.5 · accent/bg ≥3）
 * ④ ★跨字段自洽（2026-09-26 三审：此前 nav↔caps、topology↔caps、input↔caps 的矛盾可静默通过——
 *    「nav=tabs 但 caps.tabs 不支持」这类组合会让导航永不渲染，正是折叠屏踩过的坑）
 */
export function validateFormProfiles(
  profiles: Record<DeviceForm, FormProfile> = FORM_PROFILES,
): string[] {
  const problems: string[] = []
  const forms: DeviceForm[] = ['watch', 'phone', 'fold', 'tablet', 'pc', 'car', 'tv']
  const topologies: LayoutTopology[] = ['glance', 'stack', 'duo', 'rail-split', 'rail-grid', 'hero-focus-row', 'dashboard']
  const navs: NavTopology[] = ['page-stack', 'bottom-tabs', 'tabs', 'side-tabs', 'rail', 'side-nav', 'focus-tree', 'focus-row']
  for (const f of forms) {
    const p = profiles[f]
    if (!p) {
      problems.push(`形态画像缺失：${f}`)
      continue
    }
    if (p.form !== f) problems.push(`${f}: form 字段自洽（实际 ${p.form}）`)
    if (!topologies.includes(p.topology)) problems.push(`${f}: 非法拓扑 ${p.topology}`)
    if (!navs.includes(p.nav)) problems.push(`${f}: 非法导航 ${p.nav}`)
    // ★流体度量护栏：min<max 且 base>0（防「不可读的 mockup」与「无上限放大」）
    const r = p.visual.ratio
    if (!(r.ref > 0)) problems.push(`${f}: ratio.ref 须为正数（实际 ${r.ref}）`)
    if (!(r.min > 0 && r.max > r.min)) problems.push(`${f}: ratio 护栏非法（min ${r.min} / max ${r.max}）`)
    // ★ref 应与展示壳上限宽同量级（mockup 下 k≈1——防止「ref 与帧宽不匹配导致内容比例怪异」）
    if (r.ref < p.frame.maxWidth * 0.6 || r.ref > p.frame.maxWidth * 1.6) {
      problems.push(`${f}: ratio.ref（${r.ref}）与 frame.maxWidth（${p.frame.maxWidth}）量级不匹配`)
    }
    // ★展示壳规格
    if (!/^\d+\/\d+$/.test(p.frame.ar)) problems.push(`${f}: frame.ar 非法（${p.frame.ar}）`)
    if (!(p.frame.maxWidth >= 180)) problems.push(`${f}: frame.maxWidth 过小（${p.frame.maxWidth}）`)
    // ★姿态自洽（报告 P0-2）：三姿态齐备 · 视口递增 · 展开态拓扑 ≠ 折叠态拓扑（连续性语义）
    if (p.postures) {
      const keys = p.postures.map((x) => x.key)
      for (const need of ['folded', 'tabletop', 'expanded'] as const) {
        if (!keys.includes(need)) problems.push(`${f}: 姿态集缺 ${need}`)
      }
      const folded = p.postures.find((x) => x.key === 'folded')
      const expanded = p.postures.find((x) => x.key === 'expanded')
      if (folded && expanded) {
        if (!(expanded.viewport.width > folded.viewport.width)) {
          problems.push(`${f}: 展开态视口须宽于折叠态（连续性语义）`)
        }
        if (folded.topology === expanded.topology) {
          problems.push(`${f}: 折叠态与展开态拓扑须不同（否则无「形态切换」可言）`)
        }
      }
    }
    if (p.density === 'compact' && p.input === 'remote') problems.push(`${f}: 遥控形态不应 compact（远距离可读性）`)
    // ★视觉语言自洽：遥控/键盘形态必须可见焦点（焦点环）；10ft/驾驶形态字号须显著放大
    if ((capsEnabled(p.caps.dpad) || capsEnabled(p.caps.keyboard)) && p.visual.focus !== 'ring') {
      problems.push(`${f}: 遥控/键盘形态必须焦点可见（visual.focus 应为 ring）`)
    }
    // ★距离语义护栏（改到 ratio.max——绝对 px 已随容器驱动移除）
    // 远距离形态：基准容器宽须足够大（真实大屏）+ k 上限允许放大（远距离可读）
    if (p.distance === '10ft' && (p.visual.ratio.ref < 560 || p.visual.ratio.max < 1.8)) {
      problems.push(`${f}: 10ft 形态的 ref/max 不足（ref ${p.visual.ratio.ref} / max ${p.visual.ratio.max}）`)
    }
    if (p.distance === 'dashboard' && (p.visual.ratio.ref < 560 || p.visual.ratio.max < 1.5)) {
      problems.push(`${f}: 驾驶形态的 ref/max 不足（ref ${p.visual.ratio.ref} / max ${p.visual.ratio.max}）`)
    }
    if (!(p.visual.bg && p.visual.text && p.visual.brand)) problems.push(`${f}: 视觉语言缺关键色`)
    // ★对比度护栏（专家审查实锤「车机标题隐形」）：正文/背景须达 WCAG AA 4.5:1
    const contrast = (a: string, b: string): number => {
      const lum = (hex: string): number => {
        const h = hex.replace('#', '')
        const rgb = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
        const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
      }
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (l1! + 0.05) / (l2! + 0.05)
    }
    if (/^#[0-9a-f]{6}$/i.test(p.visual.text) && /^#[0-9a-f]{6}$/i.test(p.visual.bg)) {
      const c = contrast(p.visual.text, p.visual.bg)
      if (c < 4.5) problems.push(`${f}: 正文/背景对比度 ${c.toFixed(2)}:1 < 4.5:1（文字不可读）`)
    }
    if (/^#[0-9a-f]{6}$/i.test(p.visual.accent) && /^#[0-9a-f]{6}$/i.test(p.visual.bg)) {
      const c = contrast(p.visual.accent, p.visual.bg)
      if (c < 3) problems.push(`${f}: 强调色/背景对比度 ${c.toFixed(2)}:1 < 3:1（价格类信息不可读）`)
    }

    // ★④ 跨字段自洽（2026-09-26 三审）
    const has = (k: keyof FormCaps): boolean => capsEnabled(p.caps[k])
    // nav ↔ caps：声明的导航形态必须真有渲染它的能力（否则导航永不出现）
    if ((p.nav === 'bottom-tabs' || p.nav === 'tabs' || p.nav === 'side-tabs') && !has('tabs')) {
      problems.push(`${f}: nav=${p.nav} 但 caps.tabs 未支持（导航永不渲染）`)
    }
    if ((p.nav === 'rail' || p.nav === 'side-nav') && !has('sidebar')) {
      problems.push(`${f}: nav=${p.nav} 但 caps.sidebar 未支持（导航永不渲染）`)
    }
    if ((p.nav === 'focus-tree' || p.nav === 'focus-row') && !has('dpad')) {
      problems.push(`${f}: nav=${p.nav} 但 caps.dpad 未支持（焦点导航无法启用）`)
    }
    // topology ↔ caps/input
    if (p.topology === 'hero-focus-row' && (p.input !== 'remote' || !has('focusRows'))) {
      problems.push(`${f}: hero-focus-row 要求 remote 输入且 caps.focusRows 支持`)
    }
    if (p.topology === 'dashboard' && p.input !== 'remote') {
      problems.push(`${f}: dashboard 拓扑要求 remote 输入（驾驶场景）`)
    }
    if (p.topology === 'glance' && p.density !== 'compact') {
      problems.push(`${f}: glance 拓扑要求 compact 密度（一屏一意）`)
    }
    if ((p.topology === 'rail-split' || p.topology === 'rail-grid') && !has('sidebar')) {
      problems.push(`${f}: ${p.topology} 拓扑要求 caps.sidebar 支持`)
    }
    // input ↔ caps
    if (has('crown') && p.input !== 'dial' && p.input !== 'remote') {
      problems.push(`${f}: caps.crown 支持但 input=${p.input}（表冠/旋钮属 dial/remote）`)
    }
    if (has('hover') && p.input !== 'cursor') {
      problems.push(`${f}: caps.hover 支持但 input=${p.input}（悬停属指针输入）`)
    }
    if (has('driveAware') && p.distance !== 'dashboard') {
      problems.push(`${f}: caps.driveAware 支持但 distance=${p.distance}（驾驶降干扰属 dashboard 距离）`)
    }
    if (has('dense') && (p.distance === '10ft' || p.distance === 'dashboard' || p.topology === 'glance')) {
      problems.push(`${f}: caps.dense 与远距/驾驶/一屏语义矛盾（10ft·dashboard·glance 不做高密度）`)
    }
    // 媒体比例格式
    if (!/^\d+\/\d+$/.test(p.mediaRatio)) problems.push(`${f}: mediaRatio 非法（${p.mediaRatio}）`)
    // 姿态 nav/ratio 也须自洽
    if (p.postures) {
      for (const po of p.postures) {
        if ((po.nav === 'bottom-tabs' || po.nav === 'tabs') && !has('tabs')) {
          problems.push(`${f}/${po.key}: nav=${po.nav} 但 caps.tabs 未支持`)
        }
        if (po.ratio) {
          if (!(po.ratio.ref > 0) || !(po.ratio.min > 0 && po.ratio.max > po.ratio.min)) {
            problems.push(`${f}/${po.key}: 姿态级 ratio 护栏非法（ref ${po.ratio.ref} / min ${po.ratio.min} / max ${po.ratio.max}）`)
          }
        }
      }
    }
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
