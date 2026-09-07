# @proteus-vue/i18n

Proteus 跨端国际化（i18n-plan B1）：消息目录 + ICU 子集 + 类型安全 `t()`。

## 用法

```ts
// locales.ts（应用侧单例，as const 获得类型安全）
import { createI18n } from '@proteus-vue/i18n'

const zhCN = {
  'common.confirm': '确认',
  'user.greeting': '你好，{name}',
  'cart.items': '{count, plural, one {1 件} other {# 件}}',
  'gender.notice': '{gender, select, male {他} female {她} other {TA}}',
} as const
const enUS = {
  'common.confirm': 'Confirm',
  'user.greeting': 'Hello, {name}',
  'cart.items': '{count, plural, one {1 item} other {# items}}',
  'gender.notice': '{gender, select, male {he} female {she} other {they}}',
} as const

export const i18n = createI18n({ catalogs: { zhCN, enUS }, defaultLocale: 'zhCN' })

i18n.t('user.greeting', { name: 'Alex' }) // "你好，Alex"（key 类型约束：拼错编译报错）
i18n.setLocale('enUS')
i18n.t('cart.items', { count: 5 })        // "5 items"
i18n.dir()                                // 'ltr'；setLocale('ar...') → 'rtl'
```

## 能力范围（B1）

- `{name}` 插值 / `{count, plural, one{..} other{..} =N{..}}` / `{gender, select, ...}` / `#` 数量占位
- 类型安全：`as const` catalog + `keyof` 推导（免 codegen）
- `dir()` RTL 推导 + `onLocaleChange` 回调（应用自行应用 dir/持久化）
- MP 产物安全（ES5-safe，共享模块 `_proteus/i18n`）

## 简化边界（落地评估 v2）

- ICU 子集（few/many 复数规则、date/number 格式）→ 后续批次
- 按需语言包分包加载 / 完整 RTL 自动应用 / 编译期 AST 提取 → 见 `docs/proteus-i18n-plan/03-landing-evaluation.md`
