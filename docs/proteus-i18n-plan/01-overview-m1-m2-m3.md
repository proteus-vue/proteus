# 00 - Overview & M1–M3

## 00 架构总览

### 设计目标

类型安全的跨端 i18n：编译期提取消息 → 运行时按需加载语言包 → 产物可审计。

### 分层

```
L4 业务（模板 $t / 组件 <i18n>）
L3 @proteus-vue/i18n（useI18n / MessageCatalog / Loader）
L2 adapter（web(dynamic import) / skyline(分包+require) / app(Native bundle)）
L1 平台（fetch / wx.loadSubPackage / iOS/Android bundle）
```

### 铁律

1. **消息 ID 是契约**：禁止字符串字面量拼接翻译（如 `t('hello') + name` → 用 ICU `t('hello', {name})`）
2. **默认 ICU MessageFormat**：复数 / 性别 / 选择内置
3. **语言包按需**：默认只打包当前 locale，其余懒加载（小程序分包）
4. **类型安全**：`$t('key')` 的 `key` 自动补全，缺失编译报错
5. **RTL 一等公民**：布局通过 `[dir="rtl"]` 属性切换，不写平台分支

### 里程碑

| 里程碑 | 内容 | 依赖 |
|--------|------|------|
| M1 | MessageCatalog + ICU + 类型 | Types |
| M2 | Loader + 分包 + 按需 | Module, Compiler |
| M3 | Runtime API（复数/日期/货币/RTL） | Component |
| M4 | 编译期提取 + audit | Compiler, CLI |
| M5/M7 | 占位符/RTL/性能 | Build |
| M8 | DevTools + 可观测 | DevTools |

---

## M1 - Message Catalog（消息清单）

### 定义

```ts
// locales/en-US.json
{
  "trade.order.status": "{count, plural, one {1 item} other {# items}}",
  "common.confirm": "Confirm",
  "user.greeting": "Hello, {name}"
}
```

### TypeScript 类型安全

```ts
// messages.ts（自动生成，勿手动改）
export type MessageKey = 'trade.order.status' | 'common.confirm' | 'user.greeting'

export const $t = <K extends MessageKey>(key: K, params?: Record<string, unknown>): string => { ... }
```

`$t('trade.order.statu' /* typo */)` → 编译报错。

### 清单来源

- 主清单：`src/locales/<locale>.json`（人工维护）
- 提取清单：Compiler 扫描 `$t()` / `useI18n()` 调用 → `extracted.json`
- CI 比对：主清单 vs 提取清单 → 缺失/多余告警

### ICU 支持

- 复数：`{count, plural, ...}`
- 选择：`{gender, select, male{...} female{...} other{...}}`
- 日期/货币：`new Intl.DateTimeFormat` / `Intl.NumberFormat`（Web 原生；Skyline/App 用 polyfill 或原生接口）

---

## M2 - Loader & Bundling（分包加载）

### 语言包结构

```
src/locales/
  en-US/
    common.json
    trade.json
    user.json
  zh-CN/
    common.json
    ...
```

按 **domain 分包**（对齐 Module chunk），与业务模块一一对应。

### 加载策略

```ts
// 首屏：只加载当前 locale 的 critical domains
useI18n({
  locale: 'zh-CN',
  preload: ['common'],        // 立即加载
  lazy: ['trade', 'user'],   // 按需（进入模块时 fetch）
})
```

### 三端实现

| 平台 | 加载方式 |
|------|---------|
| Web | `import(`./locales/${locale}/${domain}.json`)` 动态 import → code-split |
| Skyline | 语言包放 `subPackages`，`wx.loadSubPackage` + `require` |
| App | 语言包打进对应 Framework/AAR，运行时读取 bundle |

### 分包对齐 Module/Router

- `chunk: 'trade'` 的模块 → 其语言包 `trade.json` 随模块分包加载
- 避免"进了 trade 页才去拉 trade 翻译"的卡顿 → 用 `preloadRule`（对齐 Router M7.1）

---

## M3 - Runtime API

### 核心 API

```ts
const { t, locale, setLocale, dir } = useI18n()

t('trade.order.status', { count: 5 })  // "5 items"
t('user.greeting', { name: 'Alex' })   // "Hello, Alex"

setLocale('ar-EG')  // 切阿拉伯语 → dir 变 'rtl'
```

### 组件用法

```vue
<template>
  <i18n path="user.greeting" tag="p">
    <template #name>{{ userName }}</template>
  </i18n>
</template>
```

### 复数 / 日期 / 货币

```ts
t('cart.items', { count: items.length })       // 复数
formatDate(orderDate, { locale, format: 'long' })
formatCurrency(price, { currency: 'CNY' })
```

### RTL 支持

```css
[dir="rtl"] .sidebar { margin-left: 0; margin-right: 16px; }
```

运行时 `dir` 变化 → 根节点 `document.documentElement.dir` / Skyline `page.setData({ dir })` 同步更新。

### 持久化 locale

- 当前 locale 存 Storage（`encrypted: false`，明文即可）
- 启动时优先：URL query > 存储 > `wx.getSystemInfoSync().language` > 默认 `zh-CN`

## 测试（M1-M3）

- 类型测试：`$t('wrong')` 应编译报错（tsc expect error）
- ICU 复数：各 locale 规则覆盖
- Loader：切换 locale 只请求对应分包（network 断言）
- RTL：布局镜像验证（快照对比）
