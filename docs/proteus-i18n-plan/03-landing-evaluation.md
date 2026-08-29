# i18n 落地评估与批次重排（v2）

> 状态：已落地评估（2026-08）  
> 前置：`01-overview-m1-m2-m3.md`（Draft：ICU MessageFormat + 分包加载 + Runtime API + RTL）、`02-m4-to-m8-batches.md`  
> 结论先行：**架构方向成立，但 ICU 全量 / 三端分包加载 / Intl 日期货币 / 编译期 AST 提取 超出当前基建** —— 首期做「纯逻辑 i18n 运行时 + 类型安全 + 扫描级审计」，重型能力标后续批次。

---

## 1. 现状核对（Draft 假设 vs 当前代码库现实）

| # | Draft 假设 | 当前现实 | 结论 |
|---|-----------|----------|------|
| 1 | 完整 ICU MessageFormat（复数/性别/选择/日期/货币） | 无现有 ICU 依赖；引入 messageformat 库违背「不引重依赖」 | ⚠️ **ICU 子集**：`{name}` 插值 + `{count, plural, one/other}` + `{gender, select, ...}` 自研小解析器（ES5-safe，~100 行）；完整 ICU 标后续 |
| 2 | M2 三端分包加载（Web dynamic import / Skyline loadSubPackage / App bundle） | module-plan chunk 对齐未做语言包维度；MP 分包机制存在但复杂 | ⏸ 首期**静态全量 catalog**（单 JSON `as const` 打包进应用）；按需分包标后续（依赖 chunk 对齐 + preloadRule） |
| 3 | M3 日期/货币 `Intl.DateTimeFormat`（Web 原生 / Skyline polyfill） | 微信基础库 Intl 支持有限（真机差异大） | ⏸ 首期 `t()` 只做插值/复数/选择；`formatDate/formatCurrency` 标后续（Intl polyfill 评估） |
| 4 | M4 编译期 AST transform 提取 `$t()` → messages 清单 | 编译器无 $t 专项 transform（规则注册表需登记） | ⚠️ 首期 **CLI `i18n:check` 扫描级审计**（正则扫 `t('key')`/`$t('key')` 引用 → 缺失/多余报告）；AST transform 标后续 |
| 5 | RTL 一等公民（`[dir="rtl"]` 布局切换） | Web `documentElement.dir` 可行；Skyline 需 page setData | ✅ 首期 `dir()` + `setLocale` 回调（应用自行应用 dir）；自动 RTL 样式标后续 |
| 6 | 类型安全 `MessageKey` 自动生成（codegen） | codegen 需构建链接入 | ✅ **免 codegen**：`as const` catalog + `keyof` 推导 `MessageKey`（`createI18n<typeof zhCN>`），`t<K extends MessageKey>` 编译期约束 |
| 7 | 持久化 locale（Storage） | @proteus/shared 有 Storage 抽象（async 契约） | ✅ 首期 `setLocale` 透出回调（应用自选持久化）；内置 Storage 依赖标后续 |
| 8 | MP 编译 | 框架包共享模块白名单 `@proteus/*` ✓ 已有（_proteus/<name>） | ✅ **纯逻辑 ES5-safe**（无 ?? / ?. / 展开 / 解构）→ 共享模块直接可用，无需编译器改动 |

---

## 2. 批次重排（M1-M8 → 当前可落地）

| 批 | 交付物 | 依赖 | 说明 |
|----|--------|------|------|
| B1 | `@proteus/i18n` 包：catalog（`createI18n`）+ ICU 子集解析器（插值/复数/选择）+ `useI18n`（t/setLocale/dir）+ 类型安全 | — | 纯逻辑零依赖；workspace 链接 + vitest alias + MP 共享模块 |
| B2 | CLI `i18n:check`：扫描 `t('key')`/`$t('key')` 引用 → 缺失/多余/未引用报告（对齐 capabilities:check 模式）| B1 | 扫描级审计门禁 |
| B3 | demo 页（locale 切换 + 复数/插值演示）+ CI 接入 | B1/B2 | 双端构建验证 |
| 后续 | 按需分包加载（module chunk 对齐）/ 完整 ICU / Intl 日期货币 / RTL 自动应用 / AST 提取 | 基建成熟 | 标注于 02-m4-to-m8-batches.md |

---

## 3. 包设计（B1）

```
packages/i18n/
  src/
    index.ts        # createI18n + useI18n + 类型
    icu.ts          # ICU 子集解析器（{name} / {count, plural, one{..} other{..}} / {gender, select, ...}）
    types.ts        # Messages / MessageKey / I18nOptions
```

```ts
// 用法（类型安全，免 codegen）
const zhCN = { 'common.confirm': '确认', 'cart.items': '{count, plural, one {1 件} other {# 件}}' } as const
const enUS = { 'common.confirm': 'Confirm', 'cart.items': '{count, plural, one {1 item} other {# items}}' } as const
export const i18n = createI18n({ zhCN, enUS, defaultLocale: 'zhCN' })
i18n.t('common.confirm')                          // 类型约束：key 必须存在
i18n.t('cart.items', { count: 5 })                // "5 件"
i18n.setLocale('enUS'); i18n.dir()                // 'ltr' | 'rtl'
```

★MP 产物安全（决策 #32/#36）：解析器/运行时无 ?? / ?. / 对象展开 / 数组解构。

---

## 4. 验收（B1-B3）

1. `createI18n` 类型安全：非法 key 编译报错（tsc 断言）+ 合法 key 通过。
2. ICU 子集：插值 / 复数（one/other + `#` 占位）/ 选择（select）单测全覆盖；`#` 替换正确。
3. MP 产物：示例页经 `@proteus/i18n` 共享模块（`_proteus/i18n`）编译通过，双端构建全绿。
4. `i18n:check`：缺失 key / 多余 key / 未引用 key 报告可测，入 CLI。
5. 每批独立提交，验证 = `npm run verify` 全绿。

---

## 5. 进度追踪

| 批 | 状态 | 说明 |
|----|------|------|
| B1 @proteus/i18n 包（catalog + ICU 子集 + 类型安全）| ✅ 已落地 | 2026-08，11 用例（插值/复数/=N/select/嵌套/类型安全/dir/locale 切换） |
| B2 CLI i18n:check | ⬜ | — |
| B3 demo + CI | ⬜ | — |
