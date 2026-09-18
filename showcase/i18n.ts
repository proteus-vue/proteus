// showcase/i18n.ts —— 演示用国际化实例（@proteus-vue/i18n）
import { createI18n } from '@proteus-vue/i18n'

export const i18n = createI18n({
  catalogs: {
    'zh-CN': { hello: '你好', cart: '{count} 件商品', apple: '苹果', appleMany: '{count} 个苹果' },
    'en-US': { hello: 'Hello', cart: '{count} items', apple: 'apple', appleMany: '{count} apples' },
  },
  defaultLocale: 'zh-CN',
})
