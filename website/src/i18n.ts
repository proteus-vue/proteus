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
  'home.relVersion': 'v0.6 · 可插拔渲染后端',
  'home.relLicense': 'MIT 开源',
  'home.relBuild': '构建通过 · 单测全绿',
  'home.relMore': '发布说明 →',
  'home.eyebrow': '◆ 语义内核 · 可插拔渲染',
  'home.heroTitle1': '为现代跨端应用而生的',
  'home.heroTitle2': 'Vue 语义引擎',
  'home.heroSub': '不是又一个「小程序跨端框架」。Proteus 定义跨端语义内核，让编译、UI 渲染、原生能力、端接入全部成为可插拔后端——Web、小程序、Flutter、原生 UIKit / Jetpack / ArkUI，都是 SPI 的一种实现。',
  'home.whyEyebrow': '核心特性',
  'home.whySub': '专注于真实跨端场景——语义稳定、后端可换、边界诚实。',
  'home.codeEyebrow': '透明编译',
  'home.codeTitle': '更少的代码，跨更多端',
  'home.codeSub': '业务只写标准 Vue SFC，跨端差异在编译期吸收；右边是浏览器内真实编译产物，非示意图。',
  'home.codeCta': '查看工程结构 →',
  'home.statsEyebrow': '可验证',
  'home.statsTitle': '每个数字都可追溯',
  'home.statsSub': '官网展示的一切数字均登记于 stats.ts 并注明权威验证来源——不写不可验证的宣称。',
  'home.scenEyebrow': '适用场景',
  'home.scenTitle': '为多种真实场景而设计',
  'home.scenSub': '无论是中后台、数据可视化还是多端同屏，同一份语义都能稳定交付。',
  'home.capEyebrow': '框架能力',
  'home.capTitle': '四层可插拔内核',
  'home.capSub': '编译 · UI · 能力 · 端——每一层都是可替换的 SPI，换后端业务零改动。',
  'home.chanEyebrow': '渲染通道',
  'home.chanTitle': '同一份语义，两条渲染通道',
  'home.chanSub': '框架的路由 / 渲染 / 能力全部可插拔——下面两条通道同时运行，都是框架自身的实现。',
  'home.chanV1': '矢量渲染通道',
  'home.chanVSub': '标准 SVG 源码（径向渐变 / 高斯模糊辉光 / 描边进度 / 路径运动 / 裁剪能量波）——Web 端原生矢量渲染，小程序端同源走 Canvas 通道。',
  'home.chanW1': '结构渲染通道',
  'home.chanWSub': '零依赖手写 WebGL1 引擎（正二十面体线框 + 透视 + 深度衰减）——不引任何第三方 3D 库，实时旋转。',
  'home.stackEyebrow': '生态支持',
  'home.stackTitle': '与主流技术栈同行',
  'home.stackSub': '基于标准 Vue 3 生态构建，不引入私有 DSL——现有工具链与知识可直接复用。',
  'home.compareEyebrow': '对标',
  'home.journeyEyebrow': '学习路径',
  'home.endTitle': '开始构建更好的跨端应用',
  'home.endSub': '一份标准 Vue 源码，跑通 Web 与小程序；接入原生 / Flutter 后端时代码不改。',
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
  'home.journeyTitle': '学习路径',
  'home.journeySub': '从零到双端跑通的完整旅程——以小程序开放文档的颗粒度标准组织，每页只讲一件事。',
  'home.journeyGo': '进入 →',
  // —— App 壳（★#475）——
  'app.home': '首页',
  'app.docs': '文档',
  'app.multidev': '多端同屏',
  'app.footer': '官网用 Proteus 自身构建（dogfooding）：p-* 语义组件 + @proteus-vue/docs 文档引擎 + G-22 柔性布局（零 @media）',
  // —— Multi-device 同屏墙（★#489）——
  'mdev.subtitle': '同一份语义 · 六端各自的样子',
  'mdev.sub': '同一份商品数据，由渲染后端按端形态推导出各自该有的界面——手机单列+底部导航、平板侧栏双列、PC 侧栏三列可悬停、车机大热区焦点、电视 Hero+海报流、手表一屏一意。这不是页面缩放，也不是 #ifdef。',
  'mdev.theme': '主题',
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
  'home.relVersion': 'v0.6 · pluggable render backends',
  'home.relLicense': 'MIT licensed',
  'home.relBuild': 'build passing · tests green',
  'home.relMore': 'What’s new →',
  'home.eyebrow': '◆ Semantic core · Pluggable rendering',
  'home.heroTitle1': 'The Vue semantic engine',
  'home.heroTitle2': 'for modern cross-platform apps',
  'home.heroSub': 'Not “yet another mini-program framework”. Proteus defines a cross-platform semantic core and turns compilation, UI rendering, native capabilities and target integration into pluggable backends — Web, Mini Programs, Flutter, native UIKit / Jetpack / ArkUI are all just one implementation of the SPI.',
  'home.whyEyebrow': 'Key features',
  'home.whySub': 'Focused on real cross-platform scenarios — stable semantics, swappable backends, honest boundaries.',
  'home.codeEyebrow': 'Transparent compilation',
  'home.codeTitle': 'Less code, more targets',
  'home.codeSub': 'Business code is standard Vue SFC only; cross-platform differences are absorbed at compile time. On the right is real in-browser compilation output, not a mockup.',
  'home.codeCta': 'See project structure →',
  'home.statsEyebrow': 'Verifiable',
  'home.statsTitle': 'Every number traces to a source',
  'home.statsSub': 'All figures on this site are registered in stats.ts with their authoritative verification source — no unverifiable claims.',
  'home.scenEyebrow': 'Use cases',
  'home.scenTitle': 'Designed for real-world scenarios',
  'home.scenSub': 'Admin tools, data visualization, or multi-device — the same semantics deliver reliably.',
  'home.capEyebrow': 'Framework capabilities',
  'home.capTitle': 'A four-layer pluggable core',
  'home.capSub': 'Compiler · UI · capabilities · targets — every layer is a replaceable SPI; swapping backends needs zero business changes.',
  'home.chanEyebrow': 'Render channels',
  'home.chanTitle': 'One semantic source, two render channels',
  'home.chanSub': 'Routing, rendering and capabilities are all pluggable — both channels below run on the framework’s own implementations.',
  'home.chanV1': 'Vector channel',
  'home.chanVSub': 'Standard SVG source (radial gradient / Gaussian-blur glow / stroke progress / path motion / clip wave) — rendered natively as vectors on Web; the same source runs the Canvas channel on Mini Program.',
  'home.chanW1': 'Structure channel',
  'home.chanWSub': 'Zero-dependency hand-written WebGL1 engine (icosahedron wireframe + perspective + depth falloff) — no third-party 3D library, rotating live.',
  'home.stackEyebrow': 'Ecosystem',
  'home.stackTitle': 'Plays well with the mainstream stack',
  'home.stackSub': 'Built on the standard Vue 3 ecosystem, no proprietary DSL — your existing tooling and knowledge carry over.',
  'home.compareEyebrow': 'Comparison',
  'home.journeyEyebrow': 'Learning path',
  'home.endTitle': 'Start building better cross-platform apps',
  'home.endSub': 'One standard Vue source runs on Web and Mini Program; native / Flutter backends need no code changes.',
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
  'home.journeyTitle': 'Learning path',
  'home.journeySub': 'A complete path from zero to both targets — organized at the granularity of mini-program docs, one thing per page.',
  'home.journeyGo': 'Open →',
  // —— App shell（★#475）——
  'app.home': 'Home',
  'app.docs': 'Docs',
  'app.multidev': 'Multi-device',
  'app.footer': 'This site is built with Proteus itself (dogfooding): p-* semantic components + the @proteus-vue/docs engine + G-22 fluid layout (zero @media)',
  // —— Spirit pet（★#488）——
  // —— Multi-device wall（★#489）——
  'mdev.subtitle': 'One semantic set · a different shape on each target',
  'mdev.sub': 'The same product data takes the shape each target deserves, derived by the render backend: phone single-column + bottom tabs, tablet rail + two columns, desktop side-nav + three columns with hover, in-car large hit areas + focus navigation, TV hero + poster rows, watch one screen, one meaning. Not page scaling — not #ifdef.',
  'mdev.theme': 'Theme',
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
