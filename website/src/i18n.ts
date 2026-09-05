// website/src/i18n.ts —— 官网 chrome 国际化（★#468：dogfooding @proteus-vue/i18n——内容翻倍层在 content 变体）
//   分层：content 变体（en/*.md overlay，docs-registry 提供）；本模块管 chrome 文案 + locale 状态（localStorage 记忆）
import { ref } from 'vue'
import { createI18n } from '@proteus-vue/i18n'

const zh = {
  'nav.toggle': '导航',
  'toc.sidebar': '◆ {name}',
  'toc.onthepage': '本页导读',
  'doc.prev': '← 上一篇',
  'doc.next': '下一篇 →',
  'doc.noen.title': '此页暂无英文版',
  'doc.noen.body': '内容还在翻译中——先回中文版阅读，或换一页试试。',
  'doc.noen.back': '返回中文版',
  'doc.ends.title': '终端落地进度',
  'search.placeholder': '搜索文档…（{kbd}）',
  'search.hint': '输入 ≥2 字符全站搜索',
  'search.empty': '无匹配结果——换个关键词试试',
  'search.aria': '搜索文档',
  'search.trigger': '搜索文档…',
  'lang.zh': '中',
  'lang.en': 'EN',
  // —— Home（★#475）——
  'home.heroSub': '不是又一个「小程序跨端框架」。Proteus 定义跨端语义内核，让编译、UI 渲染、原生能力、端接入全部成为可插拔后端——Web、小程序、Flutter、原生 UIKit / Jetpack / ArkUI，都是 SPI 的一种实现。',
  'home.ctaStart': '⚡ 快速开始',
  'home.ctaPlay': '在线体验',
  'home.featuresTitle': '语义是内核，后端是驱动',
  'home.compareTitle': '与「翻译派」的本质分水岭',
  'home.compareSub': '传统框架把小程序 API 当标准去翻译；Proteus 定义自己的语义 IR，各端来实现。',
  'home.dim': '维度',
  'home.cmpNote': '状态标注：✅ 已落地可验证 · 🟡 部分落地 · 📋 规划已入库——明确边界比无限承诺更有说服力。',
  'home.quote1': '我们用 Proteus 建了 Proteus 官网',
  'home.quote2a': '你审查这份页面的源码，看到真实的 ',
  'home.quote2b': '——它正在渲染你眼前的页面。',
  'home.quoteSubPre': '这就是 ',
  'home.quoteSubPost': '。',
  'home.linkSemantic': '统一语义收敛 →',
  'home.linkSpi': 'SPI-First 五步法 →',
  'home.quickTitle': '两分钟跑通双端',
  'home.qsWeb': '# Web SPA 直跑',
  'home.qsMp': '# Skyline 四件套',
  'home.quickNote': '同一份标准 Vue SFC：Web 端由渲染后端直出 DOM，小程序端由编译器生成 WXML/WXSS/JS——接入 Native / Flutter 后端时，这行代码不改。',
  'home.journeyTitle': '学习路径',
  'home.journeySub': '从零到双端跑通的完整旅程——以小程序开放文档的颗粒度标准组织，每页只讲一件事。',
  'home.journeyGo': '进入 →',
  // —— App 壳（★#475）——
  'app.home': '首页',
  'app.docs': '文档',
  'app.multidev': '多端同屏',
  'app.footer': '官网用 Proteus 自身构建（dogfooding）：p-* 语义组件 + @proteus-vue/docs 文档引擎 + G-22 柔性布局（零 @media）',
  // —— 海神精灵（★#488）——
  'spirit.title': 'Proteus 海神精灵（点击变身）',
  // —— Multi-device 同屏墙（★#489）——
  'mdev.subtitle': '同一份源码 · 六端同屏',
  'mdev.sub': '一份真实 Vue 组件，六种设备形态下真实渲染（Web DOM 运行时）：手机/平板/手表窄屏与桌面/车机宽屏跑同一份代码，柔性容器自适应换行收紧；真正的多后端输出树与 IR 见 Playground。',
  'mdev.scenario': '场景预设',
  'mdev.edit': '编辑源码（改完实时重渲六端）',
  'mdev.empty': '（无输出）',
  // —— Mini Playground（TransformDemo，★#477）——
  'pd.tip': '左侧改代码 · 右侧实时看真实编译产物与 IR',
  'pd.file': 'playground.vue（标准 Vue SFC，无平台 DSL）',
  'pd.copy': '复制分享链接',
  'pd.reset': '重置示例',
  'pd.seeCap': '见 IR · bindings.capabilities',
  'pd.trace': '实时编译 · 触发规则 {n} 条（有效转换 {m} 条）',
  // —— Playground 页 chrome（★#478）——
  'pg.eyebrow': '◆ Playground · 透明编译',
  'pg.title': '左边写标准 Vue，右边看编译器在想什么',
  'pg.sub': '浏览器内实时编译——同一套 @proteus-vue/compiler（与本地 build 同源）：Skyline 产物、CompilerIR 中间表示、决策 trace（哪一行触发了哪条规则）、{n} 条规则的 AI 说明书全部可查——拒绝黑盒。',
  'pg.rulesTitle': '规则注册表 · AI 说明书（{n} 条）',
  'pg.rulesDim': '每条规则自带 what / why / when / example / verify——产物可枚举、可查询、可反查源码。',
} as const

const en = {
  'nav.toggle': 'Sections',
  'toc.sidebar': '◆ {name}',
  'toc.onthepage': 'On this page',
  'doc.prev': '← Previous',
  'doc.next': 'Next →',
  'doc.noen.title': 'No English version yet',
  'doc.noen.body': 'This page is still being translated — read the Chinese version, or try another page.',
  'doc.noen.back': 'Back to Chinese',
  'doc.ends.title': 'Terminal rollout',
  'search.placeholder': 'Search docs…（{kbd}）',
  'search.hint': 'Type ≥2 chars to search the whole site',
  'search.empty': 'No matches — try different keywords',
  'search.aria': 'Search docs',
  'search.trigger': 'Search docs…',
  'lang.zh': '中',
  'lang.en': 'EN',
  // —— Home（★#475）——
  'home.heroSub': 'Not “yet another mini-program framework”. Proteus defines a cross-platform semantic core and turns compilation, UI rendering, native capabilities and target integration into pluggable backends — Web, Mini Programs, Flutter, native UIKit / Jetpack / ArkUI are all just one implementation of the SPI.',
  'home.ctaStart': '⚡ Quick start',
  'home.ctaPlay': 'Try it online',
  'home.featuresTitle': 'Semantics are the core; backends are the drivers',
  'home.compareTitle': 'The essential difference from “translation-style” frameworks',
  'home.compareSub': 'Traditional frameworks translate mini-program APIs as the standard; Proteus defines its own semantic IR and lets each target implement it.',
  'home.dim': 'Dimension',
  'home.cmpNote': 'Status: ✅ shipped & verifiable · 🟡 partially shipped · 📋 planned — honest boundaries beat unlimited promises.',
  'home.quote1': 'We built the Proteus site with Proteus itself',
  'home.quote2a': 'Inspect the source of this page and you will see real ',
  'home.quote2b': '— it is rendering the page in front of you.',
  'home.quoteSubPre': 'This is ',
  'home.quoteSubPost': '.',
  'home.linkSemantic': 'Unified semantic convergence →',
  'home.linkSpi': 'SPI-First in five steps →',
  'home.quickTitle': 'Both targets in two minutes',
  'home.qsWeb': '# Web SPA runs as-is',
  'home.qsMp': '# Skyline artifacts',
  'home.quickNote': 'One standard Vue SFC: Web renders DOM via the render backend; Mini Programs get WXML/WXSS/JS from the compiler — when Native / Flutter backends join, this code does not change.',
  'home.journeyTitle': 'Learning path',
  'home.journeySub': 'A complete path from zero to both targets — organized at the granularity of mini-program docs, one thing per page.',
  'home.journeyGo': 'Open →',
  // —— App shell（★#475）——
  'app.home': 'Home',
  'app.docs': 'Docs',
  'app.multidev': 'Multi-device',
  'app.footer': 'This site is built with Proteus itself (dogfooding): p-* semantic components + the @proteus-vue/docs engine + G-22 fluid layout (zero @media)',
  // —— Spirit pet（★#488）——
  'spirit.title': 'Proteus spirit pet (click to morph)',
  // —— Multi-device wall（★#489）——
  'mdev.subtitle': 'One source · six targets on one wall',
  'mdev.sub': 'One real Vue component rendered live in six device forms (Web DOM runtime): the same code adapts from narrow phone/tablet/watch screens to wide desktop/in-car screens via fluid containers. Real multi-backend trees & IR live in the Playground.',
  'mdev.scenario': 'Scenarios',
  'mdev.edit': 'Edit the source (the six targets re-render live)',
  'mdev.empty': '(no output)',
  // —— Mini Playground（TransformDemo，★#477）——
  'pd.tip': 'Edit code on the left · watch real compile output & IR live on the right',
  'pd.file': 'playground.vue (standard Vue SFC, no platform DSL)',
  'pd.copy': 'Copy share link',
  'pd.reset': 'Reset sample',
  'pd.seeCap': 'see IR · bindings.capabilities',
  'pd.trace': 'Live compile · {n} rules fired ({m} effective)',
  // —— Playground page chrome（★#478）——
  'pg.eyebrow': '◆ Playground · Transparent Compilation',
  'pg.title': 'Write standard Vue on the left, watch what the compiler is thinking on the right',
  'pg.sub': 'Real-time in-browser compilation — the same @proteus-vue/compiler as local builds: Skyline output, CompilerIR intermediate representation, decision trace (which line fired which rule), plus AI explainers for all {n} rules — no black box.',
  'pg.rulesTitle': 'Rule registry · AI explainers ({n})',
  'pg.rulesDim': 'Every rule ships its own what / why / when / example / verify — output is enumerable, queryable and traceable back to source.',
} as const

type MessageKey = keyof typeof zh
const enCatalog: Record<MessageKey, string> = en

export const ui = createI18n({ catalogs: { zh, en: enCatalog }, defaultLocale: 'zh' })

export type SiteLocale = 'zh' | 'en'
const STORE_KEY = 'proteus-site-lang'
function readStored(): SiteLocale {
  try {
    return localStorage.getItem(STORE_KEY) === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

/** 当前语言（响应式——组件 computed 依赖即随切换重渲染） */
export const locale = ref<SiteLocale>(readStored())

// ★初始化：持久化 locale 同步给 i18n 实例（整页刷新后保持英文 chrome）
ui.setLocale(locale.value)

/** 切换语言（记忆到 localStorage；内容层由组件读 en 变体） */
export function setLocale(l: SiteLocale): void {
  locale.value = l
  ui.setLocale(l)
  try {
    localStorage.setItem(STORE_KEY, l)
  } catch {
    /* 隐私模式等——仅本次会话 */
  }
}

/** 类型安全 chrome 翻译（读取 locale ref——切换语言触发组件重渲染） */
export function t<K extends MessageKey>(key: K, params?: Record<string, string>): string {
  void locale.value
  return ui.t(key, params ?? {})
}

/** 分区名双语（兼容两套键：registry section.key（guide/components…）与 DocSearch 路径前缀（docs/component…）——都映射到同一显示名） */
const SECTION_NAME: Record<SiteLocale, Record<string, string>> = {
  zh: {
    guide: '指南', docs: '指南',
    framework: '框架',
    components: '组件', component: '组件',
    capabilities: '能力', capability: '能力',
    primitives: '原语',
    system: '柔性系统',
    plugins: '插件 API', plugin: '插件 API',
    reference: '工具链',
  },
  en: {
    guide: 'Guides', docs: 'Guides',
    framework: 'Framework',
    components: 'Components', component: 'Components',
    capabilities: 'Capabilities', capability: 'Capabilities',
    primitives: 'Primitives',
    system: 'Flex System',
    plugins: 'Plugin API', plugin: 'Plugin API',
    reference: 'Tooling',
  },
}
export function sectionName(key: string): string {
  return SECTION_NAME[locale.value]?.[key] ?? key
}

/** 指南/框架/分区侧栏分组名双语（未收录的组名回退原样；★#479 扩到全部七个分区） */
const GROUP_NAME: Record<SiteLocale, Record<string, string>> = {
  zh: {
    起步: '起步', 开始: '开始', 代码构成: '代码构成', 基础概念: '基础概念',
    渲染与能力: '渲染与能力', 架构与工程: '架构与工程', 专题深入: '专题深入', 参考: '参考',
    总览: '总览', 语义模型: '语义模型', 编译期: '编译期', 运行期: '运行期',
    渲染层: '渲染层', 组件框架: '组件框架', 自定义组件: '自定义组件', 数据与状态: '数据与状态',
    基础能力: '基础能力', 质量与兼容: '质量与兼容', 宿主与内存: '宿主与内存',
    内容与表单: '内容与表单', 工程: '工程', 布局: '布局', 手势: '手势', 页面外壳: '页面外壳',
    位置与地图: '位置与地图', 可观测与调试: '可观测与调试', 媒体与扫码: '媒体与扫码',
    存储与文件: '存储与文件', 应用与生命周期: '应用与生命周期', 网络与通信: '网络与通信',
    设备与系统: '设备与系统', 账号与支付: '账号与支付', 通知与分享: '通知与分享',
    工程原语: '工程原语', 手势原语: '手势原语', 桌面原语: '桌面原语',
    '柔性系统': '柔性系统', '插件 API': '插件 API', '工程参考': '工程参考', 工程命令: '工程命令',
    开发者工具: '开发者工具', 模块化: '模块化',
  },
  en: {
    起步: 'Getting Started', 开始: 'Start', 代码构成: 'Code Anatomy', 基础概念: 'Core Concepts',
    渲染与能力: 'Rendering & Capabilities', 架构与工程: 'Architecture & Engineering', 专题深入: 'Deep Dives', 参考: 'Reference',
    总览: 'Overview', 语义模型: 'Semantic Model', 编译期: 'Compile Time', 运行期: 'Runtime',
    渲染层: 'Rendering Layer', 组件框架: 'Component Framework', 自定义组件: 'Custom Components', 数据与状态: 'Data & State',
    基础能力: 'Core Capabilities', 质量与兼容: 'Quality & Compatibility', 宿主与内存: 'Hosts & Memory',
    内容与表单: 'Content & Forms', 工程: 'Engineering', 布局: 'Layout', 手势: 'Gestures', 页面外壳: 'Page Shell',
    位置与地图: 'Location & Maps', 可观测与调试: 'Observability & Debugging', 媒体与扫码: 'Media & Scanning',
    存储与文件: 'Storage & Files', 应用与生命周期: 'App & Lifecycle', 网络与通信: 'Network & Communication',
    设备与系统: 'Device & System', 账号与支付: 'Account & Payment', 通知与分享: 'Notifications & Sharing',
    工程原语: 'Engineering Primitives', 手势原语: 'Gesture Primitives', 桌面原语: 'Desktop Primitives',
    '柔性系统': 'Flex System', '插件 API': 'Plugin API', '工程参考': 'Engineering Reference', 工程命令: 'Engineering Commands',
    开发者工具: 'Developer Tools', 模块化: 'Modularity',
  },
}
export function groupName(name: string): string {
  return GROUP_NAME[locale.value]?.[name] ?? name
}
