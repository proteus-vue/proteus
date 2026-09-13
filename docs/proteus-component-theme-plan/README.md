# Proteus 组件主题（编译器通道）方案 · POC v1

> **状态**：POC 已验证（p-button 双端 + 真机）
> **关联**：`docs/proteus-component-plan/00-overview.md`（组件层定位）· `docs/proteus-app-capabilities-plan/02-theme-five-end.md`（五端主题能力域）· `src/components/theme/registry.ts`（SSOT）
> **一句话**：**不是纯 CSS 皮肤包**（会被微信组件样式隔离挡住），而是**编译器把 `theme` 值落成组件根节点的单类变体**，变体样式定义在**组件自己的 scoped wxss 内**——一切发生在组件边界内，绕开隔离。

---

## 1. 问题：纯 CSS 皮肤包在小程序端物理上不成立

微信自定义组件默认 `styleIsolation: apply-shared`，但**页面 wxss 无法可靠作用于组件内部**——
真机实测：`<p-view class="box">` 外层容器样式失效，即使 apply-shared（见
`packages/compiler/src/template.ts:1417` 与 `gen-routes.ts:635` 注释）。

因此「从外面往里推样式」的纯 CSS 皮肤包（uni-app 式）在 MP 端无法工作。
**这解释了既有定位「不做纯 CSS 主题皮肤包」的真正原因——不是不想做，是纯 CSS 路线在小程序端不成立。**

## 2. 解法：把主题传进组件，而不是从外面推进去

框架为 Vue 的 `class` 继承语义**已经造好了这条通道**：

```
<p-button class="x">  →  root-class="x"  →  组件 properties.rootClass  →  根节点 {{rootClass}}
```

`theme` 是这条通道的**第二个实例**（同构机制）：

```
<p-button theme="brand">
   → 编译期：:class 对象字面量键 → 运行时三元 → 根节点单类 .p-theme--brand-<scopeId>
   → 变体 CSS 定义在组件自身 scoped wxss：.p-theme--brand-<scopeId> { --p-button-bg: #7c5cff; ... }
   → 基类消费变量：background: var(--p-button-bg, <缺省>)
```

**三条关键设计与约束**：

| # | 设计 | 原因（真机实测） |
|---|------|------------------|
| T1 | 变体一律**单类选择器** | Skyline glass-easel **不支持复合类 `.a.b`**（组件自身 wxss 匹配自身根节点都失效）→ 不能写 `.p-button.p-theme--brand` |
| T2 | 变体只**重定义局部 CSS 变量**，不重复声明属性 | 基类已消费 `--p-button-bg/color/border` → 换肤路径与既有 page 级变量注入一致，零重复 |
| T3 | 模板 `:class` 用**字面量键**（`'p-theme--brand': theme === 'brand'`），禁止 `'p-theme--' + theme` 动态拼接 | 动态类名无法被编译器静态后缀 scopeId → MP 端选择器匹配不上（Web 正常） |

### 3.1 配套修复：按下态（`hover-class`）——同一类「替换 vs 叠加」错误

主题化与按下态有同一个陷阱：**用 `background-color` 替换背景会打死彩色按钮**。

| 端 | 旧实现 | 症状 | 修复 |
|----|--------|------|------|
| MP | `:hover-class="hoverClass || undefined"` → 缺省走微信原生 `button-hover` | 原生缺省按下态是 `#dedede` 通用灰 / 按 type 替换色（基础库实测）→ 彩色按钮按下变灰 | 缺省绑框架类 `p-button--hover`（`<style global>` 单类）→ `box-shadow` inset 叠加层保留色相 |
| Web | `.proteus-web-button--hover { background-color: rgba(0,0,0,.1) !important }` | **替换**背景 → 彩色按钮按下瞬间半透明灰 →「一闪一闪」 | 改 `background-image: linear-gradient(...)` 叠加层（`!important` 保留以压过用户基色覆盖） |

**统一语义**：按下 = **保留原色相、压暗一档**（对齐微信 `.button-hover[type=primary]{background-color:#179b16}`
的压暗思路），用**叠加层**而非**替换**背景。
好处：对任意基色（含 CSS 变量主题色 brand/success/danger/自定义 `--p-button-bg`）自动成立，
无需为每个 theme 再写一条按下态规则（也避免复合类选择器，Skyline 不支持）。

**约束**：MP 端 `hover-class` 类名由**平台**在按下时直接加到组件根节点，**不经** Vue 编译期 `:class`
处理 → **不会**得到 scopeId 后缀 → 必须定义在 `<style global>`（scoped 版 `.p-button--hover-data-v-x`
永远匹配不上）。

**★为什么两端叠加层实现不同（踩过的坑）**：Web 用 `background-image` 成立，但 MP **不能用**——编译器把
`<style global>` 输出在 scoped **之前**，而基类 scoped 规则用 `background:` **简写**会把 `background-image`
重置为 `none` → 叠加层被静默吃掉（用户实测「点击态时好时坏」的真因正是这次从 box-shadow 改成
background-image）。MP 因此用 `box-shadow`（不被 background 简写影响）+ `!important`（与顺序解耦）。
**不要假设「两端口径统一」= 同一 CSS 写法可行，必须两端分别验证。**

### 3.0.1 变体样式必须对齐「基础库权威值」

用户实测抓出的三处 Web/MP 不一致，根因都是 **Web 模拟层当初凭 weui 印象取值，而非对齐微信基础库**：

| 项 | 旧 Web | 基础库权威值 | 修正 |
|----|--------|--------------|------|
| mini 尺寸 | 14px / padding 6px 12px / radius 6px | `wx-button[size=mini]{font-size:16px;line-height:2;padding:0 .75em;width:auto}`（不设 radius） | 对齐（radius 交由组件变量） |
| plain 颜色 | 绿 `#07c160` | `wx-button[type=default][plain]{border:1px solid #353535;color:#353535}`（**默认黑**） | 缺省黑；仅 primary/warn 镂空带对应色 |
| plain 居中 | 继承 `.proteus-web-button{margin:auto}` | 原生 hug-content 不居中 | 组件显式 `margin:0` |

**取权威值的方法**：微信开发者工具的 `app.asar` 内嵌基础库 CSS，直接 grep 二进制即可：
```bash
grep -ao 'wx-button\[size=mini\]{[^}]*}' \
  /Volumes/.../wechatwebdevtools.app/Contents/Resources/app.asar
```
**规则**：新增/修改组件变体样式时，**先取基础库权威值**，不要凭记忆或第三方 UI 库（weui）取值。

### 3.0.2 ★编译器禁忌：CSS 注释内不得出现花括号

`packages/compiler/src/style.ts` 的选择器重写用**原始文本正则**（`([^{}]+)\{`）。若 `<style>` 的
CSS 注释里写了 `{`（如注释里举例 `` `.foo { margin:auto }` ``），该 `{` 会被当成块起始 → 其前的声明
被并入「选择器」并被改写 → **声明全部丢失**（实测：按钮塌成全宽）。已在编译器入口统一屏蔽注释根治
（回归锁 `tests/mp-transform.test.ts`）。写注释时避免用花括号举例，或写成 `margin:auto` 不带括号。


### 3.2 配套修复：分包页被误判为组件（页面无法滚动）

**症状**（用户实测）：showcase 组件详情页（`subpackages/components/pages/p-button`）整页**无法滚动**，
而首页正常。

**根因**：`packages/plugin-vite/src/plugin.ts` 用 `file.includes('/components/')` 反推是否组件——
分包目录名恰好叫 **components**（`subpackages/components/pages/*`）→ **页面**被误判为组件 →
产物成 `Component({})` + 跳过页面自动滚动容器包装（`<scroll-view scroll-y>`）→ 整页不滚。

**修复**：分类改为按**来源目录**显式标记，抽成 `collectMpEntries`（可单测）——页面一律来自
`pagesDir` / 分包根；组件只来自 `<appDir>/components` 与 `frameworkComponentsDir`（与 gen-routes 口径一致）。

**回归锁**：`tests/plugin-mp-entries.test.ts`（4 用例，★破坏性验证过）。


## 3. 为什么这是「编译器才能给」的能力

| 能力 | 纯 CSS 皮肤包 | 编译器通道 |
|------|--------------|-----------|
| MP 端生效 | ❌ 被样式隔离挡住 | ✅ 组件边界内定义 |
| 类型化 IR 契约 | ❌ | ✅ 主题键可由注册表生成 TS 类型，写错编译期报错 |
| 静态主题零运行时 | 需要 | ✅ 字面量直接落类 |
| **组件级覆盖**（深色页里放品牌色按钮） | ❌ MP 物理不可能 | ✅ `<p-button theme="brand">` |
| 跨端保证一致 | 靠约定 | ✅ conformance 测试锁「注册表 ↔ 变体 CSS ↔ 双端产物」 |

## 4. POC 范围与证据（p-button，2026-09-13）

**落地物**：
- `src/components/theme/registry.ts` —— 主题键 SSOT（brand/success/danger/ghost + 色值）
- `src/components/p-button/index.vue` —— `theme` prop + 四个单类变体（只重定义变量）
- `showcase/subpackages/components/pages/p-button.vue` —— 演示 07（四色并排）+ 08（动态切换）
- `tests/component-theme.test.ts` —— 6 用例回归锁（★破坏性验证过：复合类 / 色值漂移都会被抓住）
- `tests/e2e-showcase-render.test.ts` —— 新增 Web 端**计算色**断言（四色互异 + 动态切换变色）

**双端产物证据**：
```
MP  wxss: .p-theme--brand-data-v-e35be3 { --p-button-bg: #7c5cff; --p-button-color: #ffffff; }   （单类 ✓）
MP  wxml: class="... {{(theme === 'brand'?'p-theme--brand-data-v-e35be3 ':'')}} ..."              （字面量键 → 运行时可变 ✓）
Web css:  .p-theme--brand[data-v-a1b51bc9]{--p-button-bg: #7c5cff;--p-button-color: #ffffff}     （属性选择器，Web 原生 scoped ✓）
```

**真机（Skyline 模拟器）证据**：
- 四色按钮全部正确渲染（品牌紫 #7c5cff / 成功绿 #22b573 / 危险红 #ef4d4d / 幽灵描边）
- **运行时切换**：`setData({dynTheme:'danger'})` → 按钮实时变红、输出文本同步（`:theme` 变量可切换 ✓）

**验收数字**：全量单测 **3099/3099** · showcase 渲染 E2E **11/11** · 双端构建 ✓

## 5. 诚实边界

1. **POC 仅 p-button**：泛化到全组件集需要为每个组件写变体（或由编译器按注册表生成）——这是后续工作量，非已达成。
2. **未覆盖系统明暗（light/dark）自动跟随**：本方案针对**任意命名皮肤**（编译器通道不可替代的场景）；
   light/dark 已有 `@media (prefers-color-scheme: dark)` + `api.onThemeChange` 双端（另属主题能力域）。
3. **第三方组件不自动换肤**：需组件参与 theme 通道（皮肤包契约）。
4. **有重复**：主题数 × 组件数（有界，每组件只带自身变量子集；可 chunk 去重优化）。
5. **切换成本 O(已挂载组件数)**：有界，长列表需留意（或走虚拟列表 / 页面级单例）。
6. **导航栏/tabBar 系统 chrome** 属微信 `theme.json` 领域，不在组件通道内。

## 6. 后续（若要泛化）

| 阶段 | 内容 |
|------|------|
| P1 | 主题注册表 → `ThemeName` TS 类型导出；`theme` prop 进 `BaseProps` 契约 |
| P2 | 编译器按注册表**生成各组件变体样式**（消除手写重复） |
| P3 | conformance 门禁：全组件 × 全皮肤双端产物断言 |
| P4 | 主题能力域联动：ThemeBus（source: light/dark/system）+ 命名皮肤共存 |
