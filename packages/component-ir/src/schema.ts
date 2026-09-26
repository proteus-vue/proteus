// packages/component-ir/src/schema.ts
// ★G-31 B1：Component IR（C-IR）——组件在编译期标准化后的中间表示，由各端 Render Backend 消费
//   组件=语义（semantic 字段），属性=约束（props），Backend 消费 semantic 而非 tag 字符串
//   与 plan component-ir.schema.json 同构（TS 对象形式——IDE/Compiler/conformance 共享，零依赖）
export interface ComponentIR {
  /** 组件标签名（如 p-grid）——仅用于源码定位，不参与后端映射 */
  tag: string
  /** 语义类型（后端映射依据），格式：<domain>.<kind> */
  semantic: string
  /** 已校验的约束属性（不是平台样式指令） */
  props: Record<string, unknown>
  children: ComponentIR[]
  /** 引用的原生能力（G-28） */
  capabilities?: Array<{ name: string; [key: string]: unknown }>
  /** 属性降级声明（G-31.2 / CMP006）：每个能力属性须声明 supported/fallback/unsupported */
  degradation?: Record<string, 'supported' | 'fallback' | 'unsupported'>
}

/** 语义枚举（与 plan component-ir.schema.json 一致）——<domain>.<kind> */
export const SEMANTIC_ENUM = [
  // —— 布局原语（G-32 ① Layout 12：G-22 泛化——swiper/scroll-view/movable 消灭为属性）——
  'layout.box',
  'layout.inline',
  'layout.stack',
  'layout.grid',
  'layout.fluid',
  'layout.adaptive',
  'layout.fit',
  'layout.spacer',
  'layout.divider',
  'layout.scroll',
  'layout.virtual-list',
  'layout.masonry',
  // ★G-31 B4：Fluid 体系扩展语义（有明确系统原生对应——原则 #10.8）
  'layout.split',
  'layout.safe',
  'layout.sidebar',
  // ★#405 语义登记批：组件库扩展组件（Fluid S1-S4 + 工程兜底，语义层待 L2 落地——G-31.4 降级 planned）
  'layout.aspect',
  'layout.zone',
  'layout.formfactor', // ★★Fluid System v2：柔性形态容器（形态编排）
  // —— 基础 UI 原语（G-32 ② UI 18 + 既有按钮）——
  'ui.text',
  'ui.heading',
  'ui.rich-text',
  'ui.icon',
  'ui.image',
  'ui.avatar',
  'ui.media',
  'ui.canvas',
  'ui.svg',
  'ui.input',
  'ui.textarea',
  'ui.select',
  'ui.checkbox',
  'ui.radio',
  'ui.switch',
  'ui.slider',
  'ui.picker',
  'ui.form',
  'ui.button', // 既有按钮（小程序对照 row 14）
  // ★G-31 B4：既有组件对齐（p-list-view/p-nav-bar）
  'ui.list',
  'ui.nav',
  // ★#405 语义登记批：反馈/状态类组件
  'ui.loading',
  'ui.scale',
  'ui.skeleton',
  // ★能力颗粒度对齐 C2：进度条 / 表单标签（对齐小程序 <progress> / <label>）
  'ui.progress',
  'ui.label',
  // ★权威标尺批 H：局部文本选区（对齐小程序 <selection>）
  'ui.selection',
  // ★权威标尺批 I：相机（对齐小程序 <camera>）
  'ui.camera',
  // —— 容器/导航原语（G-32 ③ Shell 10）——
  'shell.page',
  'shell.nav',
  'shell.tabbar',
  'shell.segment',
  'shell.drawer',
  'shell.modal',
  'shell.popover',
  'shell.toast',
  'shell.action-sheet',
  // ★#405 语义登记批：弹层/工具栏组件
  'shell.mask',
  'shell.popup',
  'shell.toolbar',
  // ★能力颗粒度对齐 C2：页面容器（对齐小程序 <page-container>）
  'shell.page-container',
  // ★权威标尺批 H：键盘上方工具栏（对齐小程序 <keyboard-accessory>）
  'shell.keyboard-accessory',
  // ★权威标尺批 J：内嵌网页 / 广告位（对齐小程序 <web-view>/<ad>）
  'shell.webview',
  'shell.ad',
  // ★权威标尺批 J：地图（对齐小程序 <map>）
  'ui.map',
  // —— 交互/手势原语（G-32 ④ Gesture——组件形态 2 个；v-gesture: 指令归绑定层不产生 C-IR 节点）——
  'gesture.draggable',
  'gesture.scrollable',
  // —— 工程原语（G-32 ⑥ Engineering——组件形态 3 个 + ★#405 错误兑底；Hook/路由方法归 API 层不产生 C-IR 节点）——
  'engineering.router-link',
  'engineering.transition',
  'engineering.animate',
  'engineering.error-boundary',
  'engineering.share-element',
  // —— 能力入口（G-28 组件化：p-* 能力入口组件；useXxx Hook 归 API 层不产生 C-IR 节点）——
  //   ★2026-09-18 语义去重：原列 'capability.scan-qr' / 'capability.pick-photo' 为**重复名**，
  //   已退役改为真实能力（组件的实现分别调用 useQRCode() / useCamera()，即 C42 / C1）——
  //   本枚举收录的是「能作为 C-IR 节点出现的语义」，故此处列真实能力名（E8 双形态先例同源）。
  'capability.location',
  'capability.qr-code',
  'capability.camera',
] as const

/** C-IR JSON Schema（等价于 plan component-ir.schema.json——TS 内嵌供校验/工具消费） */
export const COMPONENT_IR_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://proteus.dev/schemas/component-ir.json',
  title: 'Proteus Component IR (C-IR)',
  type: 'object',
  required: ['tag', 'semantic', 'props', 'children'],
  properties: {
    tag: { type: 'string', pattern: '^p-[a-z0-9-]+$' },
    semantic: { type: 'string', enum: SEMANTIC_ENUM },
    props: { type: 'object', additionalProperties: true },
    children: { type: 'array', items: { $ref: '#' }, default: [] },
    capabilities: { type: 'array', items: { type: 'object', required: ['name'] } },
    degradation: { type: 'object', additionalProperties: { enum: ['supported', 'fallback', 'unsupported'] } },
  },
} as const

/** C-IR 组件标签 → 语义类型（组件清单映射——G-32 ①-③ 组件原语 + G-31 L1 布局/UI 原语 + ★B4 现有组件对齐） */
export const TAG_SEMANTIC_MAP: Record<string, string> = {
  // G-32 ① 布局原语（12）
  'p-box': 'layout.box',
  'p-inline': 'layout.inline',
  'p-stack': 'layout.stack',
  'p-grid': 'layout.grid',
  // ★Skyline 线收口：'p-fluid' 移除——layout.fluid 是 v-p-fluid **指令**语义（非标签），登记为标签会让 <p-fluid> 静默不渲染
  'p-adaptive': 'layout.adaptive',
  'p-fit': 'layout.fit',
  'p-spacer': 'layout.spacer',
  'p-divider': 'layout.divider',
  'p-scroll': 'layout.scroll',
  'p-virtual-list': 'layout.virtual-list',
  'p-masonry': 'layout.masonry',
  // G-32 ② UI 原语（18）
  'p-text': 'ui.text',
  'p-heading': 'ui.heading',
  'p-rich-text': 'ui.rich-text',
  'p-icon': 'ui.icon',
  'p-image': 'ui.image',
  'p-avatar': 'ui.avatar',
  'p-media': 'ui.media',
  'p-canvas': 'ui.canvas',
  'p-svg': 'ui.svg',
  'p-input': 'ui.input',
  'p-textarea': 'ui.textarea',
  'p-select': 'ui.select',
  'p-checkbox': 'ui.checkbox',
  'p-radio': 'ui.radio',
  'p-switch': 'ui.switch',
  'p-slider': 'ui.slider',
  'p-picker': 'ui.picker',
  'p-form': 'ui.form',
  'p-button': 'ui.button', // 既有按钮
  // G-32 ③ Shell 原语（10）
  'p-page': 'shell.page',
  'p-nav': 'shell.nav',
  'p-tabbar': 'shell.tabbar',
  'p-segment': 'shell.segment',
  'p-drawer': 'shell.drawer',
  'p-modal': 'shell.modal',
  'p-popover': 'shell.popover',
  'p-toast': 'shell.toast',
  'p-action-sheet': 'shell.action-sheet',
  'p-split': 'layout.split', // ★已落地绑定（G-32 S10 分栏语义——layout.split 承载）
  // G-32 ④ Gesture 组件形态（2）
  'p-draggable': 'gesture.draggable',
  'p-scrollable': 'gesture.scrollable',
  // G-32 ⑥ Engineering 组件形态（3）
  'p-router-link': 'engineering.router-link', // ★E18 组件形态（p- 前缀产 C-IR）
  'router-link': 'engineering.router-link', // ★兼容别名（Vue Router 风格 <router-link> 标签；非 catalog 条目——p-view 先例 G-31 B4）
  'p-share-element': 'engineering.share-element', // ★批次 8：页面间共享元素转场（≠ p-transition 页内过渡）
  'p-transition': 'engineering.transition',
  'p-animate': 'engineering.animate',
  // G-31 能力入口
  // ★2026-09-18 语义去重：原 capability.scan-qr / capability.pick-photo 是**重复名**——
  //   两个组件的实现分别调用 useQRCode() / useCamera()，对应真实能力即 C42 capability.qr-code /
  //   C1 capability.camera（其 mpEquiv 与 hook 完全一致）。故**退役重复名、重指向真实能力**，
  //   并按 E8 双形态在两行补 tag（而非新建语义）。
  'p-scan-qr': 'capability.qr-code',
  'p-pick-photo': 'capability.camera',
  'p-location': 'capability.location',
  // ★G-31 B4 现有组件对齐（src/components 实际标签 → L1 语义）
  'p-view': 'layout.box', // 原子容器 = p-box 角色
  'p-list-view': 'ui.list',
  'p-nav-bar': 'ui.nav',
  // ★G-31 B4 Fluid 体系扩展语义（有明确系统原生对应——原则 #10.8）
  'p-safe': 'layout.safe',
  'p-sidebar': 'layout.sidebar',
  // ★#405 语义登记批：剩余 10 组件全量入图（EXTRA_KIND 文档兑底退役）——
  //   9 个新语义（catalog planned L2：语义层待多端映射）+ p-scroll-view 复用 layout.scroll
  //   （★2026-09-18 修正原文「p-view 先例」：显式 multi-tag 别名先例是上一行的 `router-link`
  //    ——同一语义由两个标签提供；本条与 p-view 是并列的别名情形，非「先例」关系）
  'p-aspect': 'layout.aspect',
  'p-zone': 'layout.zone',
  'p-formfactor': 'layout.formfactor', // ★★Fluid System v2：柔性形态容器
  'p-loading': 'ui.loading',
  'p-scale': 'ui.scale',
  'p-skeleton': 'ui.skeleton',
  'p-mask': 'shell.mask',
  'p-popup': 'shell.popup',
  'p-toolbar': 'shell.toolbar',
  'p-scroll-view': 'layout.scroll', // 滚动容器 = p-scroll 角色
  'p-error-boundary': 'engineering.error-boundary', // E8 原语组件形态（useErrorBoundary API 形态并存）
  // ★能力颗粒度对齐 C2：新增真实组件
  'p-progress': 'ui.progress',
  'p-label': 'ui.label',
  'p-page-container': 'shell.page-container',
  // ★权威标尺批 H：选区 / 键盘工具栏
  'p-selection': 'ui.selection',
  'p-keyboard-accessory': 'shell.keyboard-accessory',
  // ★权威标尺批 I：相机
  'p-camera': 'ui.camera',
  // ★权威标尺批 J：内嵌网页 / 广告位
  'p-webview': 'shell.webview',
  'p-ad': 'shell.ad',
  'p-map': 'ui.map',
}

/**
 * ★框架**内部运行时标签**（2026-09-18 批次 7）：由编译器产出或仅供内部运行的组件标签——
 * 它们**刻意不获得跨端语义**（不登记进 TAG_SEMANTIC_MAP / PRIMITIVE_CATALOG），
 * 但必须在「未登记 p-*」反黑盒检查中被识别，否则产生**错误告警**。
 *
 * 判定依据（与 G-31 一致：不把平台私有的实现载体上升为框架语义）：
 *  - `p-svg-canvas`：G-62 SVG 动画降级的 **MP 运行时载体**（`template/svg-canvas` 规则从 `<svg>`
 *    形状变化动画产出，见 packages/compiler/src/template.ts）。组件自身文档写明
 *    「MP-only 运行时组件——离屏 canvas 逐帧绘制依赖 wx.createOffscreenCanvas；Web 端不走此组件，
 *    故无 L2 等价物」→ 它是 `ui.svg` 语义在 MP 端的**实现形态**，不是独立跨端语义。
 *    ★修复背景：此前它被 `tag/unknown-p-star` 检查命中，编译期报
 *    「未入库组件？产物将按未注册自定义组件输出（MP 端不渲染）」——**该断言是错的**
 *    （组件确实在库中、产物亦由 gen-routes 正确注册），属误导告警（实测 155 个文件受影响面）。
 *
 * 新增条目须给理由；**不得**用它绕过「新组件必须登记语义」的要求——仅限「实现载体」类。
 */
export const FRAMEWORK_INTERNAL_TAGS: ReadonlySet<string> = new Set(['p-svg-canvas'])

/**
 * ★多标签共享语义的**显式别名登记**（2026-09-18）。
 *
 * 背景：`checkPrimitiveCatalog` 只校验 **catalog** 的 semantic 唯一，不校验 `TAG_SEMANTIC_MAP`
 *   的**值**唯一——于是「两个标签指向同一语义」这一情形长期**无人校验**，实测存在 3 处：
 *   `layout.box`（p-box / p-view）、`layout.scroll`（p-scroll / p-scroll-view）、
 *   `engineering.router-link`（p-router-link / router-link）。
 *
 * 语义：这些**不是缺陷**（同一语义可由多个标签提供，如 `router-link` 是 Vue Router 风格兼容别名），
 *   但**必须显式登记 + 给理由 + 指明规范标签**，否则属「悄悄重复」（新增重复值不再可能漏检——
 *   由 auditCatalogConsistency 的 **C6** 强制）。
 *
 * ★规范标签（canonical）判定依据：**端对齐产物且实际被源码引用者**为规范；
 *   另一者为 G-32 血统的兼容别名（历史组件，保留不删——删除属更大决策）。
 *   ★实测源码引用（排除构建产物/缓存）：p-view 22 · p-scroll-view 2 · p-box 0 · p-scroll 1。
 */
export interface TagAliasDecl {
  /** 规范标签（端对齐产物 + 实际使用；catalog 应登记此 tag） */
  canonical: string
  /** 兼容别名标签 */
  aliases: string[]
  reason: string
}

export const TAG_SEMANTIC_ALIASES: Record<string, TagAliasDecl> = {
  'layout.box': {
    canonical: 'p-view',
    aliases: ['p-box'],
    reason:
      'p-view 为端对齐产物（对齐官方 <view> 按压反馈 4 属性、模板用 <view> 走 Web 模拟层）且实际被引用；' +
      'p-box 为 G-32 L1 血统（aspectRatio/overflow 两个语义属性，当前零源码引用）——保留为兼容别名不删。' +
      '★注：catalog L1 行的 props 是两者的并集，属「意图声明」，与两实现均不完全一致（见 audit C8 披露）。',
  },
  'layout.scroll': {
    canonical: 'p-scroll-view',
    aliases: ['p-scroll'],
    reason:
      'p-scroll-view 为端对齐产物（透传官方 <scroll-view> 全量属性：scroll-into-view/upper-threshold/refresher 全家桶/enhanced 等）；' +
      'p-scroll 为 G-32 L10 血统（axis/paging/refresh/indicator 语义属性）。★注：catalog L10 行 props 同为两者并集。',
  },
  'engineering.router-link': {
    canonical: 'p-router-link',
    aliases: ['router-link'],
    reason: 'router-link 是 Vue Router 风格标签兼容别名（framework 保留字，非 catalog 条目）。',
  },
}
