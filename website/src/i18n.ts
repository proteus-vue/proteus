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

/** 指南侧栏分组名双语（起步/开始/…——未收录的组名回退原样） */
const GROUP_NAME: Record<SiteLocale, Record<string, string>> = {
  zh: {
    起步: '起步', 开始: '开始', 代码构成: '代码构成', 基础概念: '基础概念',
    渲染与能力: '渲染与能力', 架构与工程: '架构与工程', 专题深入: '专题深入', 参考: '参考',
  },
  en: {
    起步: 'Getting Started', 开始: 'Start', 代码构成: 'Code Anatomy', 基础概念: 'Core Concepts',
    渲染与能力: 'Rendering & Capabilities', 架构与工程: 'Architecture & Engineering', 专题深入: 'Deep Dives', 参考: 'Reference',
  },
}
export function groupName(name: string): string {
  return GROUP_NAME[locale.value]?.[name] ?? name
}
