// packages/i18n/src/index.ts
// Proteus 国际化（i18n-plan B1）：跨端消息目录 + ICU 子集 + 类型安全 t()
// 类型安全免 codegen：as const catalog + keyof 推导 MessageKey（落地评估 v2 §1 #6）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构（共享模块 _proteus/i18n 编译进 MP）
import { renderMessage } from './icu'
import type { FormatParams } from './icu'

export type { FormatParams }

/** 消息清单：{ [key]: 模板 } —— 用 as const 声明以获得 keyof 类型安全 */
export type Messages = Record<string, string>

/** 语言方向（RTL 一等公民：dir 由 locale 推导，应用自行应用） */
export type LocaleDir = 'ltr' | 'rtl'

export interface CreateI18nOptions<M extends Messages> {
  /** locale 名 → 消息清单（as const） */
  catalogs: Record<string, M>
  /** 默认 locale（缺省取 catalogs 首个 key） */
  defaultLocale?: string
  /** RTL 方向 locale 前缀（缺省：ar/he/fa/ur） */
  rtlLocales?: string[]
}

export interface I18n<M extends Messages> {
  /** 当前 locale */
  readonly locale: string
  /** 类型安全翻译：key 必须是默认清单的 key；缺失消息回退 key 本身（i18n:check 审计） */
  t: <K extends keyof M>(key: K, params?: FormatParams) => string
  /** 切换 locale（未知 locale 忽略） */
  setLocale: (locale: string) => void
  /** 当前方向：ltr / rtl（按 rtlLocales 前缀匹配） */
  dir: () => LocaleDir
  /** locale 变更回调（应用持久化 / 应用 dir 到根节点） */
  onLocaleChange: (cb: (locale: string) => void) => void
}

/** 创建 i18n 实例（应用侧单例，如 pinia 模式） */
export function createI18n<M extends Messages>(options: CreateI18nOptions<M>): I18n<M> {
  const catalogs = options.catalogs
  const firstKey = Object.keys(catalogs).length ? Object.keys(catalogs)[0] : ''
  const defaultLocale = options.defaultLocale ?? firstKey
  const rtlLocales = options.rtlLocales ?? ['ar', 'he', 'fa', 'ur']
  let current = defaultLocale
  let changeCb: ((locale: string) => void) | null = null

  function resolveMessage(key: string): string {
    const cat = catalogs[current] ?? catalogs[defaultLocale]
    const msg = cat ? cat[key] : undefined
    return typeof msg === 'string' ? msg : key
  }

  return {
    get locale() {
      return current
    },
    t: (key, params) => renderMessage(resolveMessage(String(key)), params ?? {}),
    setLocale(locale) {
      if (!catalogs[locale]) return // 未知 locale 忽略（i18n:check 审计可见）
      current = locale
      if (changeCb) changeCb(locale)
    },
    dir: () => {
      for (let i = 0; i < rtlLocales.length; i++) {
        if (current.indexOf(rtlLocales[i]) === 0) return 'rtl'
      }
      return 'ltr'
    },
    onLocaleChange(cb) {
      changeCb = cb
    },
  }
}
