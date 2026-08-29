# 编译原理（Compiler）

> Proteus 的**编译引擎**位于 `packages/compiler/`（v0.2 起独立为 monorepo 包 `@proteus/compiler`）——项目最核心的基建。它是**纯函数模块**：零 Vite 依赖、零项目配置依赖、选项全部入参，已可独立构建分发（`npm run build -w @proteus/compiler`）。

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

所有转换规则集中为**自描述的规则注册表**（`packages/compiler/src/transforms/`），每条规则 = 一份结构化 AI 说明书：

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

消费 API（经 `packages/compiler/src/index.ts` 导出）：

```typescript
listTransformRules(phase?) // 枚举规则（能力清单）：template/script/style/validate 四阶段 57 条
getTransformRule(id)       // 查单条规则
formatTransformRule(rule)  // 渲染单条 AI 说明书
formatTransformCatalog()   // 渲染全量目录

// 阶段三分派层（★底线循环 ① 完全形态，已落地）：implemented 规则携带 apply()
executeRule(id, ctx)       // 按规则 ID 执行（AI 覆盖规则 apply → 新能力即生效）
                           // 示范：style/px-to-rpx、template/scope-attr 已登记 apply

// 阶段二：决策 trace（对一份 Vue SFC 输出它实际触发的全部规则）
explainTransform(source, options?)   // → { events: [{ ruleId, phase, line, before, after }] }
formatTransformTrace(result)         // 渲染为按阶段分组的可读文本
```

- **AI 用法**：`listTransformRules()` 摸清编译器能力边界 → `getTransformRule('tag/div-to-view')` 查 why/when/verify → 按 `source` 跳读实现 → 改完跑对应单测；写完页面用 `explainTransform()` 验证转换链路。
- **防漂移**：`mapping` 直接引用 `tags.ts` 常量（`TAG_MAP` / `EVENT_MAP` / `SEMANTIC_CLASS`），`tests/transforms.test.ts` 校验每个键都被规则覆盖——改映射表遗漏会当场报错；trace 事件 ruleId 由 `tests/explain.test.ts` 校验可解析；`tests/registry-drift.test.ts` 反向校验实现引用的规则 ID 全部已登记（实现↔注册表永不脱节，CI 硬卡）。
- **分派层（阶段三已落地）**：规则 `apply()` + `executeRule(id, ctx)` 分派入口——AI 覆盖规则实现（如改 px→rpx 换算公式）→ 编译输出即时变化，无需改框架代码；详见 `packages/compiler/README.md`。

## 组件系统（v0.3）

标准 Vue 组件体系编译为微信小程序组件（`Component()` 构造器 + `properties` + `triggerEvent`）。

### 子组件（`<appRoot>/components/<name>/index.vue`，isComponent 自动判定）

```vue
<!-- examples/components/counter/index.vue -->
<script setup lang="ts">
const props = defineProps({ initial: { type: Number, default: 0 }, label: String })
const emit = defineEmits(['change'])
const count = ref(0)
function add() {
  count.value++
  emit('change', count.value)   // → this.triggerEvent('change', ...)
}
</script>
<template>
  <div class="counter">
    <text>{{ label }}: {{ count }}</text>
    <button @click="add">+</button>
  </div>
</template>
```

编译产物：

```js
Component({
  data: { count: 0 },
  properties: {
    initial: { type: Number, value: 0 },   // defineProps → properties（type + 默认值）
    label: { type: String, value: "" },
  },
  add() {
    this.setData({ count: ... })
    this.triggerEvent('change', this.data.count)   // emit → triggerEvent
  },
})
```

- `defineProps` 对象形式 → `properties`（`{ type, default }` → `{ type, value }`，类型映射 String/Number/Boolean/Object/Array；无 default 按类型给默认值）；`props.xxx` 访问重写为 `this.data.xxx`
- `defineEmits` + `emit('xxx', payload)` → `this.triggerEvent('xxx', payload)`（约定变量名 `emit`）
- `<slot>` 原样透传（TAG_MAP 已有 slot）
- **组件模式无 `onLoad`**（微信组件生命周期无此钩子）：computed 初始化 / immediate watch 走 `attached()`；`onMounted→onReady` 映射不变；`provide` 注册走 `created()`（先于子组件 attached 注入，vue-compat-advance Batch 3）
- MVP：仅对象形式 defineProps（TS 泛型形式警告）；`defineExpose` 忽略

### 父页面使用

```vue
<!-- 父页面模板：props 传递 + 事件监听（usingComponents 由 gen-routes 自动注入 page.json） -->
<counter :initial="5" label="计数" @change="onChange" />
```

编译产物：`<counter initial="{{5}}" label="计数" bindchange="onChange" />` + page.json 自动注入：

```json
{ "usingComponents": { "counter": "/components/counter/index" } }
```

- **自定义事件（非 EVENT_MAP）→ `bind:` 冒号形式**（`@updated` → `bind:updated`，微信自定义组件事件标准）；EVENT_MAP 内事件保持 `bindxxx` 无冒号
- **usingComponents 自动注入**：gen-routes 扫描页面模板的自定义组件标签（原生小程序标签 / HTML 标签 / `rules.customTags` 白名单排除）→ 按约定 `components/<name>/index` 解析 → page.json 注入；组件缺失编译期警告
- **组件目录约定**：`<appRoot>/components/<kebab-name>/index.vue`，插件自动扫描编译（产物 `dist/mp-weixin/components/<name>/index.*`）

## 底线三循环（框架的立身之本）

框架存在的意义是这三条闭环**必须真实可跑**：

| # | 循环 | 机制 | 验证方式 |
|---|---|---|---|
| ① | **AI 能力涨 → AI 写更复杂的 transform → 框架自动获得新能力** | 规则注册表（纯数据、AI 说明书、source 指向实现）+ `rules.customTags/mapping` 覆盖 + 纯函数实现（AI 可直接改） | `tests/transforms.test.ts`（覆盖完整性）+ `tests/overrides.test.ts`（覆盖即时生效）+ golden fixtures（回归） |
| ② | **编译出问题 → AI 看 dist/ → 定位到哪条 transform → 改规则 → 重编译** | `npm run debug:mp`：产物注入源码行号注释 + `.transform-debug/<file>.json` 携带**完整决策链**（ruleId/line/before/after，来自 explainTransform 同源 trace）；产物行号 → 决策链 ruleId → 注册表 AI 说明书 → 改规则/源码 → 重编译 | `tests/explain.test.ts`（trace 可解析）+ 产物自校验（坏产物当场报错） |
| ③ | **用户需求变 → proteus.config.ts 开关 → 框架行为即时变化** | `rules` 段（disabled / mapping / customTags）由 `resolveOverrides` 解析为生效配置，template/style/script 三转换函数全部走生效配置 | `tests/overrides.test.ts`（17 用例：改写映射 / 禁用规则 / 新增标签 / 决策链反映生效行为） |

三循环的公共底座：**规则注册表 = 编译器能力清单 + AI 说明书 + trace 键**，改动任何一环都有测试兜底，AI 与人类开发者看到的是同一份规则数据。

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
- 映射表集中在 `packages/compiler/src/tags.ts`，模板转换与样式选择器重写共用——保证**元素与样式两侧映射永远一致**。

## 事件映射（EVENT_MAP）

| 标准事件 | 小程序事件 |
|---|---|
| `@click` | `bindtap` |
| `@click.stop` / `.prevent` | `catchtap` |
| `@click.self` | `bindtap="proteusSelfXxx"`（包装：`e.target === e.currentTarget` 才触发；v0.3 尾） |
| `@click.once` | `bindtap="proteusOnceXxx"`（包装：`data` 标记首次触发后不再触发；v0.3 尾） |
| `@input` / `@change` / `@focus` / `@blur` | 同名 |
| `@touchstart` / `@touchmove` / `@touchend` | 同名 |
| `@longpress` / `@confirm` / `@submit` / `@scroll` | 同名 |

- 事件处理器仅支持**简单方法引用**（`handleTap` / `handleTap($event)`），复杂表达式编译期警告。
- `v-model` → `value="{{x}}"` + `bindinput="proteusOnXInput"`（自动 handler 注入 `this.setData({ x: e.detail.value })`）。
- 键位修饰符（`@keyup.enter` 等）：小程序无对等键盘事件，编译期警告（input 键盘行为请用 `@confirm`）。

## 指令映射

| Vue 指令 | 小程序产物 |
|---|---|
| `v-if` / `v-else-if` / `v-else` | `wx:if` / `wx:elif` / `wx:else` |
| `v-for="(item, idx) in list"` + `:key` | `wx:for` / `wx:for-item` / `wx:for-index` / `wx:key` |
| `v-model` | `value` + `bindinput`（自动 handler） |
| `v-html` | `rich-text nodes` |
| `:class="{ active: on }"` | 三元拼接 `{{ (on?'active ':'') }}` |
| `:class="[a, { b: on }, 'c']"` | 数组逐项拼接 `{{((a)?(a)+' ':'')+(on?'b ':'')+'c '}}`（v0.3） |
| `:style="{ color: c }"` | `style="color:{{c}}"` |
| `v-show` | `hidden="{{!expr}}"`（小程序 hidden = display:none，元素始终渲染；v0.3 已支持） |

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

## scoped CSS（v0.3）

小程序无 scoped 原生机制，编译期用**属性选择器等价**：

1. **模板侧**：`<style scoped>` 存在时，所有元素附加作用域属性 `data-v-xxxxxx`（由文件名 djb2 哈希生成，同文件稳定）
2. **样式侧**：每条规则选择器末尾追加 `[data-v-xxxxxx]`（`.card` → `.card[data-v-xxxxxx]`）；`:deep(X)` 去包装为 `X`；`@media`/`@keyframes` 骨架保留

```css
/* 源码（<style scoped>） */
.card .title { color: red; }
/* 产物 */
.card .title[data-v-e984db] { color: red; }
/* 模板对应：<view data-v-e984db class="card"><text data-v-e984db class="proteus-p title"> */
```

- **MVP 简化**：任一 `<style scoped>` 则全量作用域化（多块混用后续完善）；`:deep()` 部分同样作用域化（组件边界场景后续完善）；`rules.disabled: ['style/scoped-css', 'template/scope-attr']` 可关闭。

## `<transition>` 动画（vue-compat-advance Batch 2/5）

**进入动画**（Batch 2）：`<transition name="fade">` 装饰式处理——过渡标签不输出，子元素注入 `class="proteus-transition-{name}"`（fade 0.25s / slide-up 0.32s / scale 0.4s），进入动画由重建自动播放；wxss 按 `usesTransition` 按需注入 keyframes。

**离开动画**（Batch 5，状态机延迟移除）：transition 直接子元素 **v-if 为裸 ref 名**时启用——
- wxml：`wx:if="{{__tv{i}}}"`（显示状态，初始 = ref 初始值）+ class 插值 `{{__tl{i} ? 'proteus-transition-{name}-leave' : ''}}`
- js：data 注入 `__tv{i}` / `__tl{i}`（离开中标记）；生成 `proteusTransitionToggle{i}()`——ref 写入点（赋值/自增自减，rewriteRefAccess 注入）驱动：on 变 false → `__tl{i}=true` 播离开动画（leave keyframes `forwards`）+ `setTimeout`（时长对齐 keyframes）后 `__tv{i}=false` 延迟移除；on 变 true（含离开中反向）→ 取消定时器 + 恢复进入动画
- **范围**：仅裸 ref v-if 支持状态机；复杂表达式 / 多子元素保持 Batch 2 现状（进入动画 + 立即移除）
- 规则：`transition/component`（进入，Batch 2）+ `transition/leave-state`（离开，Batch 5）

## 样式转换（Style → WXSS）

```typescript
transformStyleToWxss(source, { px2rpx, rpxRatio })
```

> **CSS 预处理器（v0.3 尾）**：`<style lang="scss">` 先经 `CompileOptions.preprocessStyle` 钩子转 css（插件注入 sass 实现，编译器零依赖；Web 端 Vite 原生处理 scss）——变量/嵌套在编译期展开，产物 WXSS 与手写 css 无异。less 待内置。

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
- **`computed` 读路径（v0.3）**：`const double = computed(() => count.value * 2)` 编译为 **data 派生字段**——① `data` 不存 double；② `onLoad` 初始化 `this.setData({ double: this.data.count * 2 })`（首次渲染前就绪）；③ `count` 写入时**合并重算**：`this.data.count = ...; this.setData({ count: this.data.count, double: this.data.count * 2 })`（先更新 `this.data` 再 setData，保证派生表达式读到**新值**——setData 是异步批量，对象内求值用当前 this.data）。静态提取 getter 中的 `x.value` 作为依赖；仅支持**箭头简写 + 表达式体**（块体 / function 形式编译期警告）；依赖未在顶层 data 定义 → 警告。
- **`watch`（v0.3）**：`watch(ref, (newVal, oldVal) => {...})` 编译为 `proteusWatchX(newVal, oldVal)` 方法——依赖 ref 写入 setData 后**自动调用**（编译期在写入点注入：`const oldX = this.data.x; ...setData(...); this.proteusWatchX(this.data.x, oldX)`，旧值在写入前保存）；`{ immediate: true }` → onLoad 初始化调用一次（oldVal = undefined）；回调体内 ref 读写照常重写（可再触发其它 computed/watch 联动）。MVP：仅单 ref 直接引用 + 箭头函数回调（数组源 / 函数源 / function 回调警告）；同一 ref 多个 watch 仅保留后者（警告）。
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
- **`provide/inject`（vue-compat-advance Batch 3/4）**：零缩进顶层 `provide("key", expr)` / `const x = inject("key"[, default])` → 编译为 `getApp().__proteusProvides` 全局注册表读写（MP 单文件产物无模块系统，不 import 运行时；运行时桥 `@proteus/runtime` 的 `registerProvide/readInject/subscribeProvide/notifyProvide` 与之共享同一注册表）：**页面 onLoad 单函数合并块**（registry 声明一次 + provide 注册 + inject setData）；**组件 provide 放 `created`**（先于子组件 attached 注入）、**inject 放 `attached`**（computed/immediate-watch 之后）；provide 值表达式重写裸 ref 名 / `ref.value` → `this.data.<name>`；inject 默认值编译为 ES5 三元（`provides[k] === undefined ? def : provides[k]`）。**★Batch 4 响应式联动**：裸 ref 提供（`provide("k", refName)`）→ ref 写入点（赋值/自增自减）追加 `proteusSyncProvide("k", "ref")`（同步注册表值 + 通知 `__subs` 订阅者）；inject 侧订阅 `provides.__subs[key]`（值变化 setData 刷新，`__self` 闭包捕获）+ `detached`/`onUnload` 取消（`proteusUnsubscribeProvide` 按引用移除防泄漏）；`.value`/字面量提供保持静态快照（对齐 Vue：传 ref 联动、传值快照）。MVP 全局注册表；规则 `script/provide-inject`
- **产物 ES5 安全**：数组解构 / 对象展开 / `??` / `?.` 一律规避（微信真机 babel 转译问题）。

## 反编译黑盒（产物自校验）

| 机制 | 说明 |
|---|---|
| 产物自校验 | 编译产物 JS 语法错误 / WXML 标签不配对 → **当场抛错指明文件**，绝不静默输出坏产物 |
| `PROTEUS_DEBUG=1` | 注入 `[proteus][环节]` 全链路日志（app 启动 / builder 注册 / 页面 onLoad / 导航 tap / navigateTo 成功失败） |
| 行号注释 | `annotateLines: true` 时 WXML 注入源码行号 `<!-- @3 h1 -->`，产物可反查源码 |
| **方法级 sourcemap（v0.3）** | 调试构建产出 `<page>.js.map`（sourcemap v3，VLQ 编码：产物每行 ↔ 源码行，方法体/生命周期/watch 回调体映射）+ JS 尾部 `//# sourceMappingURL`；方法前注入 `// @行号 方法名` 注释——微信开发者工具可定位源码（对标 uni-app 自定义基座调试） |
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

- `computed` 读路径已支持（v0.3：`computed(() => 表达式)` → data 派生 + 写入合并）；`watch` / computed 写路径 / 跨模块引用暂不支持
- 复杂事件表达式（仅支持简单方法引用）
- 方法内 ref 复合赋值（`+=`）
- `<template v-slot>`

## 独立开源（✅ v0.2 已落地）

`packages/compiler/` 已是 monorepo 独立包 `@proteus/compiler`：`npm run build -w @proteus/compiler` 产出 `dist/`（esbuild 单文件 + tsc 声明文件），`npm publish` 即发布；peer 依赖 `@vue/compiler-sfc` / `@vue/compiler-dom`。下一步 CLI `@proteus/cli`（`proteus build <dir> --out <dir>` / `proteus explain`），核心就是调 `compileVueSfc` + `explainTransform`。
