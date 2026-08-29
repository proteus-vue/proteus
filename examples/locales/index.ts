// examples/locales/index.ts —— i18n 单例（i18n-plan B1-B3）
// 类型安全：as const catalog + keyof（免 codegen）；MP 端共享模块（locales.js bundle + _proteus/i18n external）
// ★审计同步：本 TS 目录 key 须与 locales/zh-CN.json 一致（proteus i18n:check examples 校验引用缺失）
import { createI18n } from '@proteus/i18n'

export const zhCN = {
  'common.confirm': '确认',
  'user.greeting': '你好，{name}',
  'cart.items': '{count, plural, one {1 件} other {# 件}}',
  'dir.label': '文字方向',
} as const

export const enUS = {
  'common.confirm': 'Confirm',
  'user.greeting': 'Hello, {name}',
  'cart.items': '{count, plural, one {1 item} other {# items}}',
  'dir.label': 'Text direction',
} as const

export const i18n = createI18n({ catalogs: { zhCN, enUS }, defaultLocale: 'zhCN' })
