# 编译原理（Compiler）

> Proteus 的**编译引擎**位于 `src/compiler/`——项目最核心的基建。它是**纯函数模块**：零 Vite 依赖、零项目配置依赖、选项全部入参，可独立提取为开源包 `@proteus/compiler`（见文末）。

## 编译管线

一份标准 Vue SFC → 小程序四件套：

```
hello.vue
├── <template>  ── transformTemplateToWxml ──►  .wxml   （标签/指令映射）
├── <script>    ── transformScriptToPage ────►  .js     （Page() 构造器）
├── <style>     ── transformStyleToWxss ─────►  .wxss   （px→rpx + 选择器重写 + 语义基础样式）
└── <route>     ── scripts/gen-routes.ts ────►  .json   （app.json / page.json，由路由生成器负责）
```

Web 端**不走此管线**：标准 Vite + `@vitejs/plugin-vue` 原生渲染，零转换。

## 编译规则注册表（transforms）—— AI-native 透明编译

所有转换规则集中为**自描述的规则注册表**（`src/compiler/transforms/`），每条规则 = 一份结构化 AI 说明书：

```typescript
interface TransformRule {
  id: string          // 稳定 ID，如 'tag/div-to-view'、'script/ref-incdec'
  phase: 'template' | 'script' | 'style' | 'validate'
  title: string       // 人类可读标题
  description: string // what：输入 → 输出
  why: string         // 为什么：平台约束 / 设计决策（关联 PROJECT_MEMORY 决策号）
  when: string        // 触发条件
  example: { before: string; after: string }  // 前后对照
  verify: string      // 如何验证（对应单测 / golden fixture）
  status: 'implemented' | 'planned' | 'limitation'
  source: string      // 实现位置（文件:函数），可跳读源码
  decision?: string   // 相关决策号
  mapping?: Record<string, string>  // 表驱动映射（与 tags.ts 同源引用防漂移）
}
```

消费 API（经 `src/compiler/index.ts` 导出）：

```typescript
listTransformRules(phase?) // 枚举规则（能力清单）：template/script/style/validate 四阶段 49 条
getTransformRule(id)       // 查单条规则
formatTransformRule(rule)  // 渲染单条 AI 说明书
formatTransformCatalog()   // 渲染全量目录

// 阶段二：决策 trace（对一份 Vue SFC 输出它实际触发的全部规则）
explainTransform(source, options?)   // → { events: [{ ruleId, phase, line, before, after }] }
formatTransformTrace(result)         // 渲染为按阶段分组的可读文本
```

- **AI 用法**：`listTransformRules()` 摸清编译器能力边界 → `getTransformRule('tag/div-to-view')` 查 why/when/verify → 按 `source` 跳读实现 → 改完跑对应单测；写完页面用 `explainTransform()` 验证转换链路。
- **防漂移**：`mapping` 直接引用 `tags.ts` 常量（`TAG_MAP` / `EVENT_MAP` / `SEMANTIC_CLASS`），`tests/transforms.test.ts` 校验每个键都被规则覆盖——改映射表遗漏会当场报错；trace 事件 ruleId 由 `tests/explain.test.ts` 校验可解析。
- **演进**：阶段三（随 `@proteus/compiler` 独立包）每条规则增加 `apply()`，注册表升级为分派层，`explainTransform` 从内嵌 trace 升级为分派即 trace；详见 `src/compiler/transforms/README.md`。

## 标签映射（TAG_MAP）

业务代码写标准 HTML 标签，编译器统一映射到小程序标签：

| 标准 HTML | 小程序 | 语义基础类 |
|---|---|---|
| `div` | `view` | — |
| `span` | `text` | — |
| `p` | `text` | `proteus-p` |
| `h1`–`h6` | `text` | `proteus-h1`–`h6` |
| `img` | `image` | — |
| `a`（含 `<a href>` 导航链接） | `view` | `proteus-a` |
| `button` / `input` / `textarea` / `video` / `canvas` | 同名 | — |
| `scroll-view` / `slot` | 同名 | — |
| `router-link`（`to` 属性） | `view` + 导航 handler | — |
| `v-html` 容器 | `rich-text` | — |

- 未列出的标签按 kebab-case 原样输出。
- `<a href="...">` / `<router-link to="...">` 自动转为导航链接：`data-url` + `bindtap="proteusNavigateTo"`（handler 由 script 转换自动注入）。
- 映射表集中在 `src/compiler/tags.ts`，模板转换与样式选择器重写共用——保证**元素与样式两侧映射永远一致**。

## 事件映射（EVENT_MAP）

| 标准事件 | 小程序事件 |
|---|---|
| `@click` | `bindtap` |
| `@click.stop` / `.prevent` | `catchtap` |
| `@input` / `@change` / `@focus` / `@blur` | 同名 |
| `@touchstart` / `@touchmove` / `@touchend` | 同名 |
| `@longpress` / `@confirm` / `@submit` | 同名 |

- 事件处理器仅支持**简单方法引用**（`handleTap` / `handleTap($event)`），复杂表达式编译期警告。
- `v-model` → `value="{{x}}"` + `bindinput="proteusOnXInput"`（自动 handler 注入 `this.setData({ x: e.detail.value })`）。

## 指令映射

| Vue 指令 | 小程序产物 |
|---|---|
| `v-if` / `v-else-if` / `v-else` | `wx:if` / `wx:elif` / `wx:else` |
| `v-for="(item, idx) in list"` + `:key` | `wx:for` / `wx:for-item` / `wx:for-index` / `wx:key` |
| `v-model` | `value` + `bindinput`（自动 handler） |
| `v-html` | `rich-text nodes` |
| `:class="{ active: on }"` | 三元拼接 `{{ (on?'active ':'') }}` |
| `:style="{ color: c }"` | `style="color:{{c}}"` |
| `v-show` | ⚠ 编译期警告（MVP 不支持，请用 `v-if`） |

## 语义基础样式（h1-h6 / p / a 视觉还原）

Web 端浏览器有 UA 默认样式（大标题 / 段距 / 链接色），小程序 `text`/`view` 没有。编译器做两件事保证两端视觉一致：

1. **模板侧**：`h1-h6/p/a` 自动附加 `proteus-*` 类（与用户 class 并存：`class="proteus-p tapped-count"`，与 `:class` 插值拼接）
2. **样式侧**：注入对齐 HTML 标准附录 D 的基础 WXSS（rpx / em 直接书写，不经过 px2rpx）：

```css
.proteus-h1 { display: block; font-size: 64rpx; font-weight: 700; margin: 0 0 0.67em; }
.proteus-h2 { display: block; font-size: 48rpx; font-weight: 700; margin: 0 0 0.83em; }
.proteus-p  { display: block; margin: 0 0 1em; }   /* 段距对齐 Web（margin 折叠）*/
.proteus-a  { color: #1a7af8; text-decoration: underline; }
```

用户样式特异性（如 `.home h1` → `.home .proteus-h1`）高于基础类，可正常覆盖。

## 样式转换（Style → WXSS）

```typescript
transformStyleToWxss(source, { px2rpx, rpxRatio })
```

依次执行：

1. **语义标签选择器重写**：选择器中的标签映射为小程序目标。关键设计——**多对一映射用基础类隔离**：

   | 源选择器 | 产物 | 说明 |
   |---|---|---|
   | `.card h3` | `.card .proteus-h3` | 语义标签 → 类选择器（`h3/p/a` 都是 `text/view`，若都映射为标签会同特异性互相覆盖——已踩坑：`.card p` 的 `color` 曾污染 `h3`） |
   | `.links a` | `.links .proteus-a` | 同上 |
   | `div > p` | `view > .proteus-p` | 组合器保留 |
   | `input[type="text"]` | `input[type="text"]` | 非语义标签映射为标签；属性选择器内容不误伤 |
   | `h1:hover` / `:not(h1)` | `.proteus-h1:hover` / `:not(.proteus-h1)` | 伪类 / 伪函数保留 |
   | `.a` / `#input` / `.tag-a` | 原样 | 类名 / ID / 长标识符不误伤（标签必须位于选择器起始或组合器之后） |

2. **px → rpx**：`padding: 48px` → `padding: 96rpx`（`rpxRatio` 默认 2，仅编译期生效）。
3. **Skyline 不支持属性警告**：`float`、`position: fixed` 编译期警告。
4. **注入语义基础样式**（见上节，位于用户样式之前，可被覆盖）。

## Script → Page() 构造器

```typescript
transformScriptToPage(source, styleOpts, { file, isComponent, vModelBindings, usesNavigate, debug })
```

- **顶层 `const` → `data`**：`ref(0)` / `reactive({...})` / 字面量在构建期求值（`evalLiteral`）。支持多行数组/对象字面量（括号平衡扫描，字符串内括号如 `'rgba(0,0,0,0.8)'` 不干扰）；只提取**零缩进顶层** const（函数体 / 生命周期体内局部 const 不误提取）；无法静态求值 → 编译期警告 + `undefined`。
- **顶层函数 → `methods`**：`function` 声明与 `const fn = () => {}` 箭头函数，方法简写输出。
- **生命周期映射**：`onMounted → onReady`、`onUnmounted → onUnload`、`onLoad` 透传。
- **方法内 ref 写入重写**：

  ```js
  // 源码
  count.value++
  // 产物
  this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1 })
  ```

  `++` / `--` / 赋值 / 读取（`this.data.count`）均重写；**不用 `??` 运算符**（真机预览报 `SyntaxError: Unexpected token ?`）。复合赋值（`+=`）暂不支持。
- **默认 `onLoad`**：路由参数自动 decode 注入 `data`（query 中 JSON 字符串自动 `JSON.parse`）。
- **产物 ES5 安全**：数组解构 / 对象展开 / `??` / `?.` 一律规避（微信真机 babel 转译问题）。

## 反编译黑盒（产物自校验）

| 机制 | 说明 |
|---|---|
| 产物自校验 | 编译产物 JS 语法错误 / WXML 标签不配对 → **当场抛错指明文件**，绝不静默输出坏产物 |
| `PROTEUS_DEBUG=1` | 注入 `[proteus][环节]` 全链路日志（app 启动 / builder 注册 / 页面 onLoad / 导航 tap / navigateTo 成功失败） |
| 行号注释 | `annotateLines: true` 时 WXML 注入源码行号 `<!-- @3 h1 -->`，产物可反查源码 |
| 产物可读 | `build:mp` 不压缩、贴近手写小程序代码 |

## 产物契约

- `.wxml`：标准标签 → 小程序标签 + 指令映射（见上表）
- `.js`：`Page({ data, methods, onReady, onUnload, onLoad, proteusOnXInput, proteusNavigateTo })`（组件为 `Component()`）
- `.wxss`：px→rpx + 选择器重写 + 语义基础样式 + 不支持属性警告
- `.json`：不属于编译引擎，由 `scripts/gen-routes.ts` 生成

## 消费方

- `vite-plugin-mp-transform.ts`（项目根）：薄适配层——小程序页面不在 Vite 模块图中，`buildStart` 扫描 `pagesDir` 编译 + `emitFile` 产物
- `tests/mp-transform.test.ts`：直接调纯函数做 golden test（45 个用例）
- 未来：`@proteus/compiler` 独立包

## MVP 限制（编译期警告或忽略）

- `computed` / `watch` / 跨模块引用
- 复杂事件表达式（仅支持简单方法引用）
- `:class` 数组语法
- `v-show`（请用 `v-if`）
- 方法内 ref 复合赋值（`+=`）
- `<template v-slot>`

## 独立开源计划（后期）

`src/compiler/README.md` 已给出提取路径：整体移到 `packages/compiler/`，加 `package.json`（`@proteus/compiler`，peer 依赖 `@vue/compiler-sfc` / `@vue/compiler-dom`），`tsc` 构建发布；可附带 CLI `@proteus/cli`（`proteus build <dir> --out <dir>`），核心就是调 `compileVueSfc`。
