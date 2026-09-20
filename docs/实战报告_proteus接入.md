> **最新一轮（第七轮 · 2026-09-20 · `0.3.0-beta.11`）**：上一轮的 F-17/F-18 已确认修复（编译器类独立复测 **7/7**）；
> **新发现 Bug D（`v-model` 绑定对象属性 → 非法 JS，阻断）与 Bug E（`v-model` + `@input` → `bindinput` 重复）**。
> **本轮也是首次按框架新发布的「AI 共建规范」协作**：规范 / 台账 / 门禁 / `proteus cobuild init` 分发机制
> 全部实跑验证，效果见 **第十七节**；协作机制评估见 **第十六节**。
>
> ⚠️ 本报告按轮次追加；**判断当前可用性请看第十七节**（缺陷状态）/ **第十六节**（协作机制评估）。
> 历史轮次：一（beta.2 三处阻断）→ 二（beta.4 shared 双实例）→ 三（beta.5/6 两问题）
> → 四（beta.7 components 全量丢件）→ 五（beta.8 首跑小程序编译）→ 六（beta.9 半修 + Bug C）→ 七（beta.11 共建设施 + Bug D/E）。
>
> **维护方的处理回执**在文末（第十八～二十节，按轮次）。台账见 `docs/框架问题台账.json`（当前 20 条，收口率见 `node scripts/ledger_check.mjs`）。

---

## 一、修复复测：三处阻断项 ✅ 已解决

| # | 原问题 | 现状 | 验证方式 |
|---|---|---|---|
| 1 | CLI 依赖未发布的 `devtools-runtime` 导出 | ✅ CLI 能启动 | `proteus --help` 正常 |
| 2 | CLI 不组装 vite 配置 | ✅ **已补**：`runTargetedBuildProgrammatic()` | 删掉桥接文件后构建成功 |
| 3 | CLI 不生成路由表（web 目标） | ✅ **已补** | 构建后 `auto-routes.ts` 有 5 条 |

**证据（源码注释，他们就是照报告修的）**：

```ts
// ★web 目标也须更新**应用侧路由表**（2026-09-19 修外部实战报告第 3 条阻断项）：
//   `auto-routes.ts` 双端共用，但此前只在 MP 目标生成 → 页面 404（外部项目实测复现）。
runGenRoutes({ config, root, webOnly: true })
```

我的两个桥接文件（`vite.config.ts` + `scripts/gen-routes.mjs`）**已删除**——
官方主路径现在能自己完成。这正是修复该有的样子。

> ⚠️ 但 `devtools-runtime@0.1.0` 的 dist **仍只有 3 个导出**（缺 8 个），
> CLI 也仍 import 它们。之所以能跑，是因为 `--help` 提前返回、没走到那条路径。
> **建议尽快重发该包**——否则一旦 CLI 某条路径真的用到，会再次崩。

### 新增：CLI 的 legacy 分支会造成困惑

新版 CLI 有两条路：

```js
if (!hasLegacyViteConfig(cwd)) {
  runTargetedBuildProgrammatic(target)   // 新路（官方主路径）
} else {
  planTargetedBuild(...)                 // 旧路：委托 npm run build:web
}
```

判据是**工程里有没有 `vite.config.ts`**。我此前的桥接文件恰好触发旧路 →
委托 `npm run build:web` → 而那个脚本又是 `proteus build` → **无限递归**。

删掉桥接文件即恢复。**建议**：旧路加防重入标记（如 `PROTEUS_DELEGATED=1`），
或在递归时给出明确提示，而不是刷屏。

---

## 二、★ 新发现：`@proteus-vue/shared` 重复实例会让路由**静默失效**

### 现象（最难查的一个）

- URL 变了（`/pages/workbench`）
- **视图不切换**（DOM 仍是列表页）
- transition class 正常（`cls=page`，不是动画卡住）
- 无任何报错、无控制台警告

### 根因

工程里存在**两份 `@proteus-vue/shared`**：

```
node_modules/@proteus-vue/shared                                     0.2.0-beta.0  ← 顶层（我装的）
node_modules/@proteus-vue/runtime/node_modules/@proteus-vue/shared   0.2.0-beta.1  ← 嵌套
node_modules/@proteus-vue/capabilities/node_modules/@proteus-vue/shared  0.2.0-beta.1
```

而 `adapter` 是 `shared` 里的**模块级单例**：

```ts
var adapter = isMP ? createMpAdapter() : createWebAdapter();
```

- RouterView 从**顶层副本**取 adapter，注册 `onPageLoad` listener
- router 从**嵌套副本**取 adapter，在 `navigateTo()` 里 `emit()`
- **两个 adapter 实例** → emit 发给了没有 listener 的那个 → 视图永不更新

### 修法

在应用 `package.json` 里**显式声明 `@proteus-vue/shared`**，版本对齐依赖方要求：

```json
"dependencies": {
  "@proteus-vue/shared": "^0.2.0-beta.1",   // ← 与 router / runtime 的要求一致
  ...
}
```

npm 随即去重成一份实例，路由立刻正常。

### 为什么外部用户必踩

- **不会有任何报错**——这是最危险的地方
- 从 `create-proteus` 模板起步的项目**不会**显式声明 `shared`（模板没写），
  只要引入 `@proteus-vue/runtime` 或 `capabilities` 就可能出现嵌套副本
- pnpm（proteus 自己用）默认更严格，npm/yarn 更容易出现此问题

**建议**（按优先级）：

1. **`adapter` 单例改用 `globalThis` 或 `Symbol.for`**——
   从根上消除"模块实例不同 → 单例不共享"。这是唯一彻底的修法
2. `create-proteus` 模板显式列出 `shared`，版本与 router/runtime 对齐
3. `adapter` 加开发期自检：`onPageLoad` 注册与 `emit` 若来自不同实例，
   打 `console.warn`——**把静默失败变成显式告警**
4. `check:pkg` 门禁增加"单实例包"清单（adapter / traceBus 这类模块级单例）

---

## 三、另一处：Web 端路由参数拿不到（仍在）

- `runtime/src/pageLifecycle.ts`：Web 端 `onLoad` 是 no-op（"MVP 不注入"）
- `RouterView`：`<component :is="view" />` **不传 props**

两条路都断，Web 端**无法**从路由取参数。本项目改用 pinia store 传"当前章号"。
**建议**：RouterView 至少把 query 透传为 props，或实现 `onLoad` 注入。

---

## 四、完整端到端实测（真实 Chromium）

★ **必须用真实 Chromium，不要用 ZCode in-app browser**——后者的 webview
**不驱动 `requestAnimationFrame`**（实测 500ms 内 0 次；真实 Chromium 是 30 次/500ms），
Vue 的 `<Transition>` 因此永不结束，会造成"路由失效"的**假象**，且极难排查。

```
作品列表    3 本
工作台      默者（Operator 005）/ 16 幕 / 继续写第 48 章
写作页      第 41 章 权给了，名没有 / 2516 字 / 正文 2315 字符
输入        +17 字 → 状态"未保存"
自动保存    停手 2 秒 → "已保存 22:03"
```

（`playwright install chromium` 一次即可；proteus 仓库自带 playwright 依赖。）

---

## 五、排查教训（给我自己的）

这件事上我花了远超预期的时间，犯了三个可复现的错：

| 错 | 表现 | 正确做法 |
|---|---|---|
| **用不可靠的探针下结论** | 通过 `__vueParentComponent.ctx` 读 `routeMap` 得到空对象，据此判断"路由表没生成" | `ctx` 只暴露模板用到的绑定，不是模块作用域——**探针本身要先验证** |
| **被环境假象带偏** | in-app browser 不驱动 rAF → transition 卡住 → 误判为"框架动画 bug" | 涉及渲染/动画的问题，**先确认测试环境是否真在渲染** |
| **没有先做最小复现** | 在完整业务页上反复排查多轮 | 第三轮才做"极简页面"对照，那时才排除业务代码 |

**可复用的判据**：

- 「URL 变了视图没变」→ 先查**驱动视图的数据源**（这里是 adapter 单例），不是动画
- 怀疑"两个模块实例"→ `find node_modules -path "*包名/package.json"` 数副本
- 涉及渲染 → 先用 `requestAnimationFrame` 计数确认环境真在渲染

---

## 六、最终工程形态

```
web/
├── proteus.config.ts      # 唯一配置（页面 meta + vite proxy + 平台宏）
├── package.json           # 依赖来自 npm（含显式 @proteus-vue/shared）
├── index.html
├── src/
│   ├── main.ts            # 只装 pinia + 挂载（router 不是 Vue 插件，不要 app.use）
│   ├── App.vue
│   ├── api/               # API 层 + 类型（类型来自 OPERATOR 的 make_api_contract.py）
│   ├── store/session.ts   # pinia：当前作品 / 章节 / 幕树 / 任务
│   ├── pages/             # 5 页：index / workbench / editor / search / newbook
│   ├── components/        # 4 组件（约定：components/<kebab-name>/index.vue）
│   ├── router/            # RouterView + auto-routes（生成物）
│   └── styles/            # tokens.css（v3 纸感令牌）+ app.css
```

**已删除的桥接层**：`vite.config.ts`、`scripts/gen-routes.mjs`

**技术栈对比**

| | 旧（手写） | 新（Proteus） |
|---|---|---|
| 规模 | app.js 1900 行单文件 | 5 页 + 4 组件，按职责分文件 |
| 类型 | .js + JSDoc（tsc --checkJs） | **.ts + .vue**（vue-tsc） |
| 构建 | 无（直接给浏览器 .js） | Vite 打包，**按页自动懒加载** |
| 跨端 | 只能 Web | 同一份源码 → Web + 小程序 |
| 状态 | 手写 data() 一坨 | pinia store |

---

## 七、给 proteus 的建议（按优先级）

1. **`adapter` / `traceBus` 等模块级单例改用 `globalThis` 或 `Symbol.for`**
   ——彻底消除"包副本不同 → 单例不共享"（本次最难的 bug）
2. **重发 `devtools-runtime`**（0.1.0 的 dist 缺 8 个导出，CLI 仍 import 它们）
3. **★ 重发 `fluid`**（0.1.0 缺 `styleToString` 导出，见第九节——
   这同时**堵死了整包入口导入**，不只是柔性布局用不了）
4. **`create-proteus` 模板显式声明 `shared`**，版本与 router/runtime 对齐
5. **Web 端补路由参数注入**（onLoad 或 props 任一条）
6. **包的聚合入口不要 re-export 会崩的模块**（或改成按需 import），
   让"用不了 p-grid"不至于变成"用不了任何组件"
7. 旧委托路径加**防重入标记**；递归时报明确错误而不是刷屏
8. 组件查找失败时，报错里**带上"应放哪"**

---

## 九、★ 第三次复测：用上了内置组件，但 `fluid` 缺件堵住整包入口

上一轮报告后 proteus 发了新版，我按用户要求改用**框架内置组件**（`p-drawer` 做任务详情抽屉）。
过程中挖出第三处同家族缺件，且它的影响面比前两处大。

### 现象：导入聚合入口 → **整个 app 加载失败**

```ts
import { PDrawer } from '@proteus-vue/components'   // ❌ app 白屏
```

报错：

```
SyntaxError: The requested module '@proteus-vue/fluid'
does not provide an export named 'styleToString'
```

而我**只是想要一个抽屉**——报错却指向 `fluid`，与抽屉毫无关系。

### 根因链

```
包的 index.ts  import 全部组件
      └── p-grid / p-fit  import { styleToString } from '@proteus-vue/fluid'
                └── npm 版 fluid@0.1.0 的 dist 没有这个导出（本地源码有）
                          └── 模块图求值失败 → 整个 app 起不来
```

**影响面**：这不是"柔性布局用不了"，而是**任何 `from '@proteus-vue/components'` 都用不了**。
外部用户正常的写法就是聚合入口导入，第一行代码就会撞上。

### 我们这边的绕法（可用，但不该由用户承担）

按**具体路径**导入（vite 支持，跳过 index）：

```ts
import PDrawer from '@proteus-vue/components/p-drawer/index.vue'
import PButton from '@proteus-vue/components/p-button/index.vue'
```

`p-drawer` / `p-button` / `p-text` 实测都是自包含的（零 import），这样导入完全正常。

### 柔性系统当前**未启用**

```ts
// ⚠️ 暂不可用——npm 版 fluid@0.1.0 缺 styleToString 导出（本地源码有）
// import { installFluidLayout } from '@proteus-vue/components'
// installFluidLayout(app)
```

`main.ts` 里**保留注释掉的两行 + 原因**，重发后取消注释即启用
（不是删掉，避免下次又要重新查一遍）。**同时确认：只要碰 `p-grid`/`p-fit`/柔性布局，
就无法绕过这个缺件——不是我们没接。**

### 附带确认：换肤必须走 CSS 变量，不能覆盖样式

框架在 `p-button/index.vue` 注释里写明：

```
宿主可设 --p-button-bg / --p-button-color / --p-button-radius 换肤（CSS 变量天然继承）
```

我们据此把主题接上（而不是写 `.p-button { … }` 覆盖）：

```css
:root { --p-button-bg: var(--accent); --p-button-color: #fff; --p-button-radius: var(--r-sm); }
.jd-close { --p-button-bg: transparent; --p-button-border: 1px solid var(--line); }
```

实测：关闭按钮背景 `rgba(0,0,0,0)`、文字色 `rgb(107,98,89)`、边框 `1px rgb(227,220,211)`。
**建议把这个变量清单写进框架文档**——小程序端样式隔离下，外部覆盖**根本不生效**，
变量是唯一两端通用的接口，用户不知道这条就会走错路。

### 一个值得记的坑：容器尺寸

框架的 `.page` 是 `height: auto`，因此**子元素写 `height:100%` 会静默失效**
（实测编辑器算出 738px 而视口 900px，下方留 162px 空白）。
改用 `100vh` 解决。建议框架在文档里点明 `.page` 的高度语义。

---

## 十一、★ 第三轮：新版修复确认 + 两个新问题（2026-09-19）

用户反馈"框架又发布了新版"。本轮按 npm 上的 beta 标签升级并逐项实测。

### 一、上一轮报的缺件：已修复 ✅

| 包 | 旧版 | 新版 | 验证方式 | 结果 |
|---|---|---|---|---|
| `fluid` | 0.1.0（缺 `styleToString`） | **0.1.1-beta.0** | 解包后 `grep styleToString dist/index.js` → 在 `export {}` 里 | ✅ |
| `devtools-runtime` | 0.1.0（3 个导出） | **0.1.1-beta.1** | `import()` 求值 → **12 个导出**，含 CLI 要的 `createTraceBus/createFlamegraphCollector/createTimelineCollector` | ✅ |
| `shared` | 0.2.0-beta.1 | **0.2.0-beta.2** | 见下 | ✅（且实现了我们的建议） |
| `router` / `runtime` | beta.4 / beta.3 | **beta.5 / beta.4** | 编译产物逐文件 diff | 无源码差异 |
| `components` | 0.1.0 | **0.2.0-beta.1 → 0.2.0-beta.2** | `installFluidLayout` 从聚合入口导出成功 | ✅ |

**★ `shared@0.2.0-beta.2` 采纳了本报告第七节第 1 条建议**（用 `globalThis` 消除"包副本不同 → 单例不共享"）：

```js
// 0.2.0-beta.1（旧）
var adapter = isMP ? createMpAdapter() : createWebAdapter()
// 0.2.0-beta.2（新）
var ADAPTER_GLOBAL_KEY_WEB = "__PROTEUS_ADAPTER_WEB__"
function resolveAdapter() {
  const g = globalThis; const existing = g[key]
  if (existing) return existing          // ← 副本不共享问题从根上消除
  ...
}
```

实测确认生效：浏览器里 `__PROTEUS_ADAPTER_WEB__` 键存在，且 `adapter` 被创建。

### 二、但我们这边仍需在 package.json 里强制去重

新版各包对 `shared` 的**精确依赖版本不一致**（`components`/`built-in-components` 钉 `0.2.0-beta.1`，
`router`/`runtime` 要 `0.2.0-beta.2`）→ npm 只能在各自下面各嵌一份，实测**全树 8 份副本**，
其中嵌套那 7 份是**旧的 beta.1（没有 globalThis 修复）**。

```json
"overrides": { "@proteus-vue/shared": "0.2.0-beta.2" }
```

加完 `npm install` → **8 份降到 1 份**。
> 建议 proteus：把各包对 `shared` 的依赖统一到同一版本（或用 `^`），让 npm 能自然去重。
> 框架自身去重后，我们这个 `overrides` 就可以删掉。

### 三、新问题 1：`p-fluid` 在 Web 端**静默不生效**（已定位，规避方案已实测）

框架在 `fluid.ts` 里把 `p-fluid="font-size(20, 32)"` 定义为**跨端统一写法**，
小程序端由 compiler 直接生成 `linear calc`。但 Web 端实测：**该属性原样留在 DOM，不生成任何样式，也不报错**。

根因（读源码定位，非猜测）：负责把 `p-fluid` 改写成 `v-p-fluid` 的 `defaultScopedPlugin`，
由 `plugin-vite` **导出但未注册**——`resolveProteusViteConfig` 的 Web 分支只装
`[platformVariant, vue, platformMacro, platformPublicAssets, routeBlocks]`。

我们临时写了个只做这一件事的本地插件，**实测确实生效**：

| 视口 | 实测字号 |
|---|---|
| 1024 | 17.5px |
| 1440 | 18px |
| 1920 | 19.5px |

`style` 属性为 `font-size: clamp(17.5px, calc(13.50px + 0.3125vw), 19.5px)`，与配置的
`designWidth: 1280 / fluidViewport: 768–1920` 一致。

> ⚠️ 但**不能直接用 `defaultScopedPlugin`**：它顺带把原生标签改写成 MP 标签
> （`<button>`→`<proteus-button>`、`<textarea>`→`<proteus-textarea>`…），
> Web 端没有这些全局组件 → 实测页面直接渲染不出来，报
> `Failed to resolve component: proteus-button / proteus-textarea / proteus-view`。
> **建议拆成两个插件**：`p-fluid 改写` 与 `MP 标签改写`，Web 分支只注册前者。

配置字段名也已核对：是 **`layout.designWidth` / `layout.fluidViewport`**（`@proteus-vue/types` 的 `ProteusConfig`），
不是 `fluidLayout.viewport`——后者编译期报类型错。

### 四、新问题 2（阻断级）：`v-p-fluid` 的样式**每次重渲染都在累加**

因为上一条需要临时插件，我们把它用在了编辑器正文字号上。实测**无法使用**：

| 时刻 | 元素 `style` 里 `font-size: clamp` 的出现次数 |
|---|---|
| 初次挂载 | 1 |
| 输入 10 个字符后 | **13** |

根因在 `runtime/fluid.ts` 的 `applyFluidStyle`：

```ts
export function applyFluidStyle(el, expr, designWidth?, viewportMax?) {
  const css = createFluidStyle(expr, designWidth, viewportMax)
  if (!css) return
  const existing = el.getAttribute('style') ?? ''
  el.setAttribute('style', existing ? existing + '; ' + css : css)   // ← 每次追加，从不清理
}
```

`createFluidDirective` 把它挂在 `mounted` **和 `updated`** 上，而 Vue 的元素级 `updated`
在父组件每次重渲染时都会触发 → 只要元素所在组件更新（例如输入框每次击键），
style 字符串就再追加一遍。高频更新元素上会迅速膨胀成几千字符。

> 建议修法：改为**幂等的样式属性写入**（`el.style.setProperty(prop, value)` 逐条设置），
> 或先移除上一次本指令写入的声明再写。这样重复执行是安全的。
> **在修好之前，我们把 `p-fluid` 的用法撤掉了**——保留字面固定字号，避免把膨胀的 style
> 写进用户正在编辑的正文区域。

### 五、★ 新问题 3（阻断级，最严重）：离开某些页面后，路由转场**永久卡死**

**现象**：URL 变了、旧页已从 DOM 移除、新页渲染成一个空注释 `<!---->`，**控制台零报错**。
从"工作台"页跳走之后，**此后每一次页面切换都失效**（首页↔新建作品来回跳十次都正常）。

**定位过程**（在 Vue 运行时里插桩，直接观察状态机）：

```
[out-in entered] 进工作台 → afterLeave FIRED  → instance.update() called   ← 正常
[out-in entered] 离开工作台 → （afterLeave 始终不出现）                      ← 卡死
```

`@vue/runtime-core` 的 `BaseTransition` 在 `mode="out-in"` 下会先置 `state.isLeaving = true`，
把新子树的渲染**短路**成占位注释：

```js
if (state.isLeaving) { return emptyPlaceholder(child) }
...
state.isLeaving = true
leavingHooks.afterLeave = () => { state.isLeaving = false; instance.update() }
```

即：**只要 `afterLeave` 不触发，该 RouterView 的后续渲染就全部变成空注释**——
这正是"URL 变了、页面空白、零报错"的成因。

**规避（已实测通过）**：把默认的 `fade` 也改为**层叠交叉淡入**（框架对 `halfScreen`/`slideUp`/`scaleDown`
已用这条路径），不再依赖 `out-in` 的完成回调。

```ts
const layeredNames = [...原有, 'fade']   // fade 由 out-in 改为层叠并发
```

实测结果（同一份测试脚本，改前/改后）：

| 导航 | 改前 | 改后 |
|---|---|---|
| 首页 → 工作台 | ✅ | ✅ |
| 工作台 → 找内容 | ❌ 卡死 | ✅ |
| 找内容 → 后退回工作台 | ❌ 卡死 | ✅ |
| 工作台 → 写作 | ❌ 卡死 | ✅ |

> 补充说明（避免误导）：**这个卡死与新版无关**——我们在升级前的版本上回退复测，
> 现象完全一致。它可能一直存在，只是因为此前没有连续跨页导航的测试才没被发现。
> 具体是"工作台页面的什么特征"触发，我们**没有定位到根因**（已二分排除：抽屉、各内容区块、
> 柔性布局、导航方式 push/goBack）。这里只报告**可复现的现象 + 已验证的规避方案**，不做推测。

### 六、本轮实测结果

```
构建              ✓ built in 3.26s（含 vue-tsc 类型检查，0 报错）
聚合入口导入      ✅ installFluidLayout 从 '@proteus-vue/components' 导入成功
柔性指令注册      ✅ app._context.directives = ['p-fluid']
shared 副本       ✅ 8 → 1（overrides 后）
五页导航          ✅ 首页→工作台→找内容→后退→写作 全部正常
任务抽屉          ✅ 打开、宽 720、x=720（右侧）
写作页尺寸        ✅ 编辑器高 900 = 视口 900；正文/标注同宽 736
默者门禁          ✅ pipeline --outline 五项全绿
```

### 七、给 proteus 的建议（本轮新增，按优先级）

1. **修 `applyFluidStyle` 的累加**（第四节）——它让 `v-p-fluid` 在任何高频更新的元素上都不可用
2. **Web 分支注册 `p-fluid` 改写**（第三节），并把 MP 标签改写拆出去
3. **`router-view` 的 `out-in` 卡死**（第五节）：已给出可复现步骤与规避方案，建议复现确认
4. **各包对 `shared` 的依赖统一版本**，让 npm 自然去重（第二节）

---

## 十二、★ 第四轮复测：`0.3.0-beta.7`（2026-09-20）—— 版本统一落地；但 components 包全量丢件

> 背景：proteus 于昨晚（09-19 23:37）发布 `0.3.0-beta.7`——41 包**统一版本号**（changesets fixed 分组），
> 我们报告过的三处缺件也已修复。本轮把工程升级到该版本逐项实测。
> 结论：**好消息都属实，但这次全量发布自带一个回退级缺陷——组件库一个组件都没发出去。**

### 一、升级与验证方式

以全新安装方式把工程依赖从散装 beta 版本升级到 `0.3.0-beta.7`（含删掉 `overrides` 后的全新 `npm install`），
逐项做静态检查 → 构建 → 消费者侧复现。发现的组件缺件问题在下文用**最小复现 + 字节级对比**定位。

### 二、✅ 已修复确认（逐项实测）

| 项 | 验证方式 | 结果 |
|---|---|---|
| `fluid` 缺 `styleToString` | 包内容检查 | ✅ 导出已在 |
| `devtools-runtime` 缺 8 个导出 | 实际 `import()` 求值 | ✅ **12 个导出**（含 CLI 需要的三个 collector） |
| `shared` 双实例（8 份副本） | **删掉我们加的 `overrides`** 后全新安装 | ✅ **自然去重为 1 份**（`npm ls` 全部 deduped）——我们上次建议的「各包统一 shared 依赖」已生效，`overrides` 正式退休 |
| 聚合入口导出 `installFluidLayout` | `components/index.ts` 检查 | ✅ 已从聚合入口导出 |
| 模板声明 `shared` | `create-proteus/templates/package.json` | ✅ 已声明，版本与 router/runtime 对齐 |
| Web 端路由参数 | 模板 `RouterView.vue` + `shared` 的 `page.query` | ✅ 双路已补齐（与框架回执一致） |

### 三、❌ 阻断项（新 · 回退级）：`@proteus-vue/components` **丢失全部 74 个 `p-*` 组件**

**现象**：任何工程装上 `0.3.0-beta.7` 后，只要 import `@proteus-vue/components`——
聚合入口或按具体路径都一样——构建立即失败：

```
Could not resolve "./p-view/index.vue" from "node_modules/@proteus-vue/components/index.ts"
```

上一轮"聚合入口恢复可用"（fluid 修好）**又被打回去了**，而且这次连按路径导入
（`@proteus-vue/components/p-drawer/index.vue`）也一并失效——文件根本不在包里。
影响面不是"柔性布局用不了"，而是**组件库整体不可用**：74 个组件一个都拿不到，
`index.ts` 顶层 import 全部组件，连"只想要一个指令"的用法也被一起挂（与上一轮 fluid 事故同形）。
小程序端同理——MP 编译器要到包里按目录扫 `.vue` 源码，同样找不到。

**证据（字节级）**：

| 证据 | 数值 |
|---|---|
| registry 上 beta.7 的 tarball | **17 个文件**（丢 76 个：74 个 `p-*` 目录下全部文件） |
| 同一份源码用 `pnpm pack` | **94 个文件**（完整：76 个组件文件 + LICENSE + …） |
| registry tarball ↔ 本地 `npm pack` 产物 | **逐字节相同**（shasum `bbe61aff5be5424c574b3355d2be6504b319c837`）→ 发布物就是 npm 打包的结果 |
| 上一版 `0.2.0-beta.2` 的 tarball | **94 个文件、含 LICENSE**（pnpm 打包特征；beta.7 不含 LICENSE） |

一个干净的旁证：`files` 里**显式列出的** `pg-glass/`、`virtual-list/` 在包里都在；
**通配的 `p-*`** 全部丢失。规律就是"字面项保留、目录通配不展开"。

**最小复现**（与 proteus 无关，任何 npm 包适用；npm 9.5.1 与 10.9.4 均复现）：

```bash
mkdir -p /tmp/g/p-drawer && cd /tmp/g && echo '<div/>' > p-drawer/index.vue
echo '{"name":"g","version":"1.0.0","files":["p-*"]}' > package.json
npm pack --dry-run        # → total files: 1 —— p-drawer 没被收进去
echo '{"name":"g","version":"1.0.0","files":["p-*/"]}' > package.json
npm pack --dry-run        # → total files: 1 —— 尾斜杠同样不行
echo '{"name":"g","version":"1.0.0","files":["p-*/**"]}' > package.json
npm pack --dry-run        # → total files: 2 ✅
```

即：**`files` 里的纯目录通配 `"p-*"` 在 npm 打包器下不展开目录内容；写 `"p-*/**"`（或显式目录名）才有效。**
（本地源码位置：`packages/components/package.json:28`）

**根因链（时间线，北京时间——两个正确决定在四分钟内叠成一个事故）**：

```
09-18 17:30  files 增补 "p-*"（当时发布走 changesets → pnpm 打包 → 侥幸完整，问题被掩盖）
09-19 22:36  components@0.2.0-beta.2 发布 —— 仍走 changeset publish（pnpm 仓库会调 pnpm publish）→ 94 文件 ✅
09-19 23:33  发布链重写：为绕开「pre 模式禁止自定义 tag」，弃用 changeset publish，
             改 publish-all.sh 逐包 npm publish（该修复本身是对的）
09-19 23:37  components@0.3.0-beta.7 全量发布 —— 首次经 npm 打包 → 17 文件 ❌
             （fixed 分组把 41 包统一到同一版本，components 恰好在这次被带上）
```

两处机制旁证：① changesets 源码在 pnpm 仓库确实调用 `pnpm publish`
（`@changesets/cli`：`if (!pm || pm.name !== "pnpm") … spawn('pnpm', ['publish', …])`）；
② 两个版本的打包指纹不同（beta.2 含 LICENSE、beta.7 不含）。

### 四、为什么四道门禁全部放行

| 门禁 | 它检查什么 | 为什么漏 |
|---|---|---|
| `check-publish-drift` | 本地 npm pack ↔ registry 内容一致 | **两侧都出自 npm 打包** → 同样缺件被判 identical；连慢速语义比对也以 npm pack 的文件清单为基准 |
| `verify-publish-smoke` | 干净目录安装 + 冒烟 | 包清单只有 `cli / shared / devtools-runtime / plugin-vite / create-proteus`（`scripts/verify-publish-smoke.mjs:236`）——**从不装 components** |
| `check-package-health` | 源码包 `files` 含 `index.ts`、入口文件在磁盘存在 | 只查磁盘，不查"实际发布物"；通配符是否命中 0 个文件无人验证 |
| `release --dry-run` | `npm publish --dry-run` 命令可执行 | 只证明"命令跑得通"，不检查 tarball 内容是否合理 |
| 框架自身测试 | 仓库内跑（workspace 软链源码） | 源码树里 74 个组件都在 → 全绿；只有 **npm 安装形态**才能暴露 |

> 一句话：**所有门禁都在检查"我声明的"，没有一道在检查"实际打出去的包里有什么"。**

### 五、修复建议（按优先级）

1. **改 `files`：`"p-*"` → `"p-*/**"`**——已在真实包上实测：93 个文件、74 个组件齐全
   （或改用显式目录清单/发布前展开；`"p-*/"` 不行，已测）。
2. **打包器二选一**：a) `publish-all.sh` 的 `npm publish` 改 `pnpm publish`
   （pnpm 打包语义正确，同样支持 `--tag`）；b) 保留 npm publish + 上面第 1 条。**建议都做**，声明与打包器解耦才稳。
3. **加"发布物内容"门禁（根治）**：解包 tarball，验证 `index.ts` 中每条相对 import 的目标在包内存在；
   或对 `files` 每个通配符断言"至少命中 1 项"（本次若加，"p-* 命中 0 项"当场报警）。
4. **smoke 补 components 用例**：干净目录 `npm i @proteus-vue/components` + `import` 一个 `p-*` + 最小 vite build。
   （本轮我们就是用等价的探针复现并定位的）
5. **给坏版本打 deprecate**：`npm deprecate @proteus-vue/components@0.3.0-beta.7 "缺件，请用新版本"`
   ——npm 版本不可变，只能换版本号重发。

### 六、上一轮遗留项的处理状态（本轮逐条核对）

| # | 问题（来自第十一节） | 状态 | 证据 |
|---|---|---|---|
| 1 | `applyFluidStyle` 每次更新**累加** style | ❌ 未修 | `components/runtime/fluid.ts:39-44` 仍是 `existing + '; ' + css` 追加式 |
| 2 | Web 分支未注册 `p-fluid` 改写 | ❌ 未修 | Web 插件列表仍是 5 个（`plugin-vite/src/vite-config.ts:191`），`defaultScopedPlugin` 只导出未注册；官方 examples 靠**手动注册**绕过（`examples/proteus.config.ts:107`），且该插件仍把 `p-fluid` 改写与 MP 标签改写捆在一起（`plugin.ts:94-117`）——本工程页面大量使用原生 `<button>/<input>`，手动注册会把它们整成 Web 端不存在的 `proteus-*` 标签 |
| 3 | `router-view` fade `out-in` 卡死 | ❌ 未修 | 模板 `RouterView.vue:58-60, 96` 仍是 `out-in`；未见相关修复提交。本工程继续保留"fade 也走层叠"的规避 |
| 4 | CLI legacy 分支递归（建议防重入） | ❌ 未加 | 全仓 `PROTEUS_DELEGATED` 0 处；判定仍是 `hasLegacyViteConfig`（`packages/cli/src/dev.ts:46`） |
| 5 | 组件查找失败报"应放哪" | ❌ 未见 | 未搜到报错文案调整 |

### 七、工程侧决定与升级条件

- **本工程暂不升级**，保持 `0.2.0-beta.2 / router beta.5 / runtime beta.4 / cli beta.4`（构建已验证、门禁全绿）。
- **升级条件**：框架修好上面第三节并**换版本号重发**（beta.7 已污染，不可原地覆盖）。
- 修复后的升级路径已实测：升级依赖 + **删除 `overrides`**（自然去重为 1 份）即可，无需其它改动。
- 诊断过程中做的一次性操作（用 pnpm 产物覆盖 node_modules 后构建通过、类型检查 0 错）**已全部还原**，未进入工程。

### 八、复测命令

```bash
# 消费者侧（任何工程）复现"导入即失败"
npm i @proteus-vue/components@0.3.0-beta.7
# 用 vite build → Could not resolve "./p-view/index.vue" from ".../components/index.ts"

# 发布侧（proteus 仓库内）对比两种打包器
cd packages/components
npm pack --dry-run   # → 17 个文件（丢件）
pnpm pack            # → 94 个文件（完整）
```

## 十、复测命令

```bash
cd web
npm install                 # 依赖来自 npm
npm run dev                 # → http://localhost:5273（/api 代理到 8760 后端）
npm run build:web           # 生产构建（按页分 chunk）
npm run build:mp            # 小程序构建（需真实 AppID 才能真机验证）
```

---

## 十三、★ 第五轮复测：`0.3.0-beta.8`（2026-09-20）—— 上一轮问题全修；**首次真跑小程序编译，暴露两个编译器 bug**

> 背景：proteus 今早（09-20 10:18）发布 `0.3.0-beta.8`，明确针对本报告第十二节修复。
> 本轮升级后逐项复测：**第十二节的阻断项与第十一节全部 5 条遗留项均确认修复（含端到端实测）**；
> 同时按"一份源码 → 两端"的承诺第一次真正运行了**小程序全量编译**——**失败**，定位到两个编译器 bug
> （一个阻断构建，一个更隐蔽：**静默改写产物里的正则**）。两者都不是 beta.8 引入，是长期存在、此前的验证没走到这一步。

### 一、结论速览

| 项 | 结果 | 证据 |
|---|---|---|
| components 全量丢件（第十二节） | ✅ **已修** | registry tarball 94 文件（含 76 个 `p-*` 文件）；安装后 74 个组件目录齐全 |
| `overrides` 能否删除 | ✅ **能**（自然去重 1 份） | 删除后全新 `npm install` → `shared` 全树 1 份 |
| Web 构建 / 类型检查 | ✅ 通过 | `build:web` 2.45s；`vue-tsc` 0 报错 |
| Web 端运行时（真实 Chromium） | ✅ 通过 | 五页导航、`p-drawer` 任务抽屉、写作页尺寸、自动保存 |
| 上一轮 5 条遗留项 | ✅ **5/5 全修** | 见下节逐条实测 |
| **小程序全量构建** | ❌ **失败（新发现 · 阻断）** | `js 产物语法错误：Unexpected token ':'` |
| **正则被静默改写（新发现 · 隐蔽）** | ❌ 确认 | 本工程产物中 **10 处**；**不影响 Web，只影响 MP** |

### 二、已验证修复（逐项实测，非源码推断）

| # | 上一轮问题 | 验证方式 | 实测结果 |
|---|---|---|---|
| 1 | `applyFluidStyle` 样式累加 | **端到端**：临时在编辑器 `textarea` 上加 `p-fluid="font-size(14,20)"`，输入 18 个字符（触发 18 次重渲染） | ✅ 全程只有 **1 个** clamp 声明（旧版会累加到 13+）；计算字号 15.5px 与配置吻合 |
| 2 | Web 分支未注册 `p-fluid` 改写 | 同上（Web 构建产物） | ✅ 属性已改写为指令且**不残留 DOM**；样式正确生成。产品代码已还原，未保留测试属性 |
| 3 | `router-view` fade `out-in` 卡死 | 真实 Chromium 连续跨页 **6 次** | ✅ **6/6 通过**（旧版从工作台跳走即永久卡死）；框架已改为层叠路径、结构上移除对 `afterLeave` 的依赖 |
| 4 | CLI legacy 委派递归 | 源码核对（`DELEGATED_ENV` + `detectDelegationLoop`，dev/build 双路径） | ✅ 已实现（含可执行修法提示）——非本工程触发路径，未独立构造递归场景 |
| 5 | 组件查找失败未报"应放哪" | **实际构建输出** | ✅ 报错明确给出「应用组件放这里 → … / 框架组件放这里 → …」 |

**components 修复的验证（第十二节阻断项）**：

```
registry tarball（0.3.0-beta.8）: 94 个文件 / 76 个 p-* 文件   （0.3.0-beta.7 是 17 / 0）
安装后 node_modules/@proteus-vue/components/: 74 个组件目录
发布侧：files 已改 "p-*/**" + 打包/上传职责分离（pnpm 打包 + npm publish <tarball>）
```

Web 端运行时实测（真实 Chromium，1440×900）：

```
五页导航        6/6（含「工作台 → 找内容 → 后退 → 写作」旧卡死路径）
任务抽屉        p-drawer 宽 720 / x=720（右侧），内容正常
写作页          .ed 高 900 == 视口 900；正文 736 == 标注 736；字数 2516
编辑→自动保存   输入后「未保存」→ 停手 2 秒「已保存」；正文已还原
控制台          0 报错
```

> 说明：首轮测试脚本曾误报三处失败——原因是本站工作台在"未选中作品"时会**按设计跳回首页**
> （我们自己的路由逻辑），以及 `text=写作` 选择器先命中了「写作量」面板标题。修正测试路径后全绿。
> **这几处不是缺陷**，记录在此避免下次误判。

### 三、新发现 Bug A（阻断）：`computed({ set })` 的**参数类型注解原样进产物**

**现象**：`npm run build:mp` 直接失败——

```
x Build failed in 229ms
[proteus] vite build 失败：[vite-plugin-mp-transform] [proteus-compiler] pages/editor:
          js 产物语法错误：Unexpected token ':'
```

产物里对应行：

```js
proteusSetBody(v: string) {   // ← TS 类型注解没有被剥离，JS 语法错误
```

**最小复现**（标准 Vue 写法，5 行）：

```ts
const t = ref('')
const c = computed({ get: () => t.value, set: (v: string) => { t.value = v } })
//  → 产物: proteusSetC(v: string) { ... }   ❌ SyntaxError
// 对照: set: (v) => {...}       → ✅ 通过
// 对照: set: function(v: string) → ✅ 通过（走的是另一条解析路径）
```

**根因**（框架源码，两处配合）：

| 位置 | 问题 |
|---|---|
| `packages/compiler/src/script.ts:963` | 用**正则**从 `computed({ get, set })` 里截取 setter 参数：`set\s*:\s*\(([^)]*)\)` → 捕获到的是原始文本 `v: string`（含类型注解） |
| `packages/compiler/src/script.ts:3316` | 生成方法时**原样拼接**：`proteusSet${X}(${c.setter.param})` → 类型注解直接进产物 |

> 同文件 `script.ts:79` 的注释写明"方法参数 AST → 产物参数文本（**类型注解天然剔除**）"——
> 说明框架本有正确的 AST 剥离工具（`astParamText`），但 setter 这条路径走的是正则、没用它。

**影响面**：本工程 2 个文件命中——`src/pages/editor.vue`（`set: (v: string)`）、
`src/components/job-drawer/index.vue`（`set: (o: boolean)`）。**任一命中，该页编译即失败**，
而 `computed` 的 getter/setter 对象写法是最标准的 Vue 形态。

### 四、新发现 Bug B（隐蔽 · 静默语义损坏）：方法体里的**正则字面量被当变量改写**

**现象**：产物里的正则被改坏，但**语法合法、构建通过**——所以不报错，只静默改行为：

```js
// 源码（editor.vue）
(text.value || '').replace(/\s/g, '').length          // 统计字数：去掉所有空白
// 产物（MP）
(this.data.text || '').replace(/\this.s/g, '').length // ← \s 的 s 被当成变量 s，改写成 this.s

head.replace(/【章纲提示】[\s\S]*?【\/章纲提示】/g, …)
// 产物:  /【章纲提示】[\this.s\S]*?【\/章纲提示】/g   ← 字符类被掺进 "his.s"，跨行匹配失效
```

**最小复现**（触发条件已收窄）：

```ts
const s = 1                       // 顶层单字母变量（data 或 runtimeInit 皆可）
function count() { return (x || '').replace(/\s/g, '').length }
//  → 产物: replace(/\this.data.s/g, '')     ❌ 正则被改坏
// 对照：没有同名顶层变量 → ✅ 原样保留
```

**根因**：`packages/compiler/src/script.ts:1481` 的 `rewriteInstanceRefsSafe()`
——它做"裸标识符 → `this.xxx`"的字符级改写，注释明确写了要跳过**字符串、模板串、注释**，
**但没有跳过正则字面量**（函数体内只识别 `//` 行注释，不识别 `/.../ `）。于是 `\s` / `\d` / `\w` 里的字母
被当作裸标识符改写。（`\t`、`\n` 等单字母转义同理中招，取决于是否存在同名变量。）

**影响面**：本工程产物中 **10 处**（全部在 `editor.vue`，含 `[\s\S]` 这类关键正则）。
`\this.s` 仍是合法 JS（`\t` 转义 + `his.s`），所以**构建不报错、Web 端不受影响（不走这条编译器）、
真机上行为静默错误**——字数统计失准、章纲提示块剥不干净。**这类"看起来成功了"的缺陷，
正是本项目反复记录的最危险形态。**

**两个 bug 的版本归属**：用 `compiler@0.3.0-beta.3`（迁移时用的版本）跑同一最小复现——
**两个 bug 同样复现**。即：**不是 beta.8 引入，是长期存在**；只是此前从未真正编译过小程序。

### 五、为什么直到今天才发现（诚实归因）

1. **本项目此前只验证到"构建产物生成"**——上一轮报告"仍未做的"里写的就是这句。
   本次检查 `dist/mp-weixin/` 证实：里面**只有 gen-routes 的 `.json`，没有任何 `.wxml`/`.js`/`.wxss`**
   ——说明历史上有过的"小程序构建"从未走完编译阶段。**这是第一次真正全量编译，失败即暴露。**
2. **框架自身测试未覆盖这两类**：`computed({ set: (v: T) => })`、方法体内正则——搜遍框架 `tests/` 无对应用例。
3. 两处都属"**单测跑在源码树上、编译产物不做语法校验**"的盲区：这次是靠**产物被 JS 引擎解析失败**才暴露。

### 六、修复建议（给 proteus）

1. **Bug A（阻断）**：setter 参数改用 AST 剥离（复用同文件已有的 `astParamText`），或对捕获到的参数文本做一次类型注解剥离；
   建议同时覆盖 `set: function(v: T)` 形态（该形态当前恰好正常，但要锁住）。
2. **Bug B（隐蔽，优先级不低于 A）**：`rewriteInstanceRefsSafe` 增加**正则字面量跳过分支**。
   判据用标准的"前一个有效 token"启发式即可——扫描器里已有 `prevSig` 状态：`/` 前若是标识符/数字/`)`/`]` 视为除号，
   否则视为正则起始，整段跳到未转义的闭合 `/`（并继续跳过其后的标志位 `gimsuy`）。
3. **加锁**：为上述两形态各加最小回归用例（我们的最小复现可直接用）。
4. **更进一步的建议**：编译产物在输出前跑一次**语法校验**（`new Function(js)` 或等价），
   把"产物非法"从"用户构建失败"变成"框架自己的测试失败"——本次 Bug A 若有此门禁，在框架仓库就会红。

### 七、工程侧决定

- **保留 `0.3.0-beta.8` 升级**（不再回退）：Web 侧全绿（构建/类型/运行时），且修复了 components 丢件与
  `shared` 双实例两个真问题；两个 MP bug 在旧版本（beta.3）同样存在，回退解决不了任何问题。
- **MP 目标暂不可用**（`npm run build:mp` 失败），等待框架修复；本工程当前生产路径是 Web，不受影响。
- 诊断过程中的一切临时改动（测试用 `p-fluid` 属性）**已全部还原**，产物 `dist/` 由 `.gitignore` 覆盖，未入库。

### 八、复测命令

```bash
# 消费者侧（本工程）——两个 bug 的复现
cd web
npm run build:web     # ✅ 通过（2.45s）
npm run build:mp      # ❌ 失败：Unexpected token ':'（Bug A）

# 最小复现（可直接给框架做回归用例）
node -e "
const { transformScriptToPage } = require('@proteus-vue/compiler')
// Bug A
console.log(transformScriptToPage(\"const t = ref('')\nconst c = computed({ get: () => t.value, set: (v: string) => { t.value = v } })\").js)
// Bug B
console.log(transformScriptToPage(\"const s = 1\nfunction f() { return (x || '').replace(/\\\\s/g, '') }\").js)
"
```

---

## 十四、★ 第六轮复测：`0.3.0-beta.9`（2026-09-20）—— Bug A 全修、Bug B 修了一半；新发现 Bug C

> 背景：proteus 于 09-20 11:18 发布 `0.3.0-beta.9`，针对第十三节的两个编译器 bug 修复。
> 本轮升级后逐项复测，并把小程序编译**推到能推的最深处**——每修一层就撞出下一层。
> 结论：**Bug A 彻底修复；Bug B 只修了一条路径（另两条仍在，且会误改字符串）；新发现 Bug C（async 生命周期回调丢 async 标记）**。

### 一、结论速览

| 项 | 结果 |
|---|---|
| 第十三节 Bug A（setter 参数类型注解） | ✅ **彻底修复**（含 `set: (v: string)` 与 `set: function(v: string)` 两形态） |
| 第十三节 Bug B（正则被当变量改写） | ⚠️ **只修了 1/3 路径**：`rewriteInstanceRefsSafe` 已加正则跳过；但 `computedInitLine`（行 1528）与 `rewriteBareMethodCalls`（行 2210）两处**仍是朴素正则替换**，实测仍误改 |
| 新发现 Bug C（async 生命周期回调） | ❌ **新缺陷**：`onMounted(async () => { await ... })` 编译后 async 标记被丢弃 → 产物 `onReady() { await ... }` 语法错误 |
| 我方平台适配（模板 `?.`） | ✅ 已修 8 处（WXML 官方 UnsupportedSyntax），Web 端回归 7/8（唯一失败是测试选择器，实测正常） |
| Web 端整体 | ✅ 构建 4.03s、类型检查 0 错、真实 Chromium 全通过 |

### 二、Bug A：已彻底修复 ✅

```ts
// 最小复现（第十三节提供）
const c = computed({ get: () => t.value, set: (v: string) => { t.value = v } })
// beta.8 产物: proteusSetC(v: string) { ... }   ❌ SyntaxError
// beta.9 产物: proteusSetC(v) { ... }          ✅
```

修复实现（框架工作树 `packages/compiler/src/script.ts`）：新增 `stripParamTypeAnnotation()`，
按参数位语法剥离类型注解，支持 `v: T` / `v?: T` / `v: T = 1` / 多参数 / 嵌套对象与泛型里的逗号。

### 三、Bug B：修复不完整 ⚠️（**同一个 bug 有三处实现，只修了一处**）

框架在 `rewriteInstanceRefsSafe()` 里加了完整的正则字面量跳过（含 `/` 歧义判定 `isDivision`，与我们报告建议一致）。
但**这个文件里还有两处独立的、更朴素的改写**没有同步：

| 位置 | 实现 | 覆盖场景 | beta.9 实测 |
|---|---|---|---|
| `script.ts:1552` `rewriteInstanceRefsSafe` | 字符级扫描（**已修正则**） | `this.data.x` 前缀路径 | ✅ 修好了 |
| `script.ts:1528` `computedInitLine` | `new RegExp('(?<!\\.)\\b' + name + '\\b')` | **computed 表达式内的 runtimeInit 名** | ❌ 仍误改 |
| `script.ts:2210` `rewriteBareMethodCalls` | 同上朴素正则 | **方法体内的 runtimeInit 名** | ❌ 仍误改 |

**实测证据**（beta.9，两条未修路径）：

```ts
// 路径 A：方法体（rewriteBareMethodCalls）
const s = useSession()
function count() { return (t.value || '').replace(/\s/g, '').length }
// 产物: return (this.data.t || '').replace(/\this.s/g, '').length     ❌ \s → \this.s

// 路径 B：computed 表达式（computedInitLine）
const s = useSession()
const words = computed(() => (t.value || '').replace(/\s/g, '').length)
// 产物: this.setData({ words: (this.data.t || '').replace(/\this.s/g, '').length })   ❌

// 同样中招的还有字符类：[\\s\\S] → [\\this.s\\S]
```

**并且这两条路径会误改字符串内容**（`rewriteInstanceRefsSafe` 修了、它们没修）：

```ts
const s = useSession()
function msg() { return 'count s here' }
// 产物: return 'count this.s here'    ❌ 字符串里的裸名被改写
```

**本工程影响面**：`editor.vue` 产物里 **10 处正则被改坏**（全部来自路径 A/B），
含 `/[\s\S]*?/`（章纲提示块剥离——跨行匹配失效）与 `/\s/g`（字数统计——口径失准）。
**这些产物语法合法、构建通过、Web 端无感，只有真机行为静默错误**——与第十三节 Bug B 同性质，
且比它更隐蔽（因为是"部分修复"造成的假安全感）。

> **给 proteus 的建议**：这两处应改为复用 `rewriteInstanceRefsSafe`（唯一实现），而不是各自维护朴素正则。
> 与第十二节 components 事故同源：**同一件事有三份实现，修一份就等于没修**。
> 建议加一条结构性测试：断言 `script.ts` 中不存在裸的 `(?<!\.)\b${name}\b` 改写（只允许走统一扫描器）。

### 四、新发现 Bug C（阻断）：`onMounted(async () => {...})` 丢失 async 标记

**现象**：小程序编译在这一层失败——

```
x Build failed
[proteus] vite build 失败：pages/index: js 产物语法错误：
          await is only valid in async functions and the top level bodies of modules
```

**产物**：

```js
// 源码（Vue 官方标准写法）
onMounted(async () => { await Promise.all([s.loadHealth(), s.loadProjects()]) })

// 产物（beta.9）
onReady() {
  await Promise.all([this.s.loadHealth(), this.s.loadProjects()])   // ❌ 非 async 函数里有 await
}
```

**最小复现**（覆盖两种回调形态，均复现）：

```ts
onMounted(async () => { await load() })        // ❌ 丢 async
onMounted(async function () { await load() })  // ❌ 丢 async
onMounted(() => { load() })                    // ✅（无 async，自然正常）
async function go() { await load() }           // ✅（普通 async 方法正常——只有生命周期回调中招）
```

**根因**（框架源码 `packages/compiler/src/script.ts:2423` `extractLifecycles`）：
该函数用 AST 找到生命周期回调后，只取回调**体的文本**（`extractBracedBody`）并塞进 `onReady()/onUnload()`，
**没有把回调自身的 `async` 标记带过去**。文本回退路径（正则版）同样只截 `{...}` 体。产物生成处
（`script.ts:3316` 一带）固定写 `onReady() {`，从不加 `async`。

**为什么这是框架缺陷而不是平台限制**：Vue 官方支持异步生命周期回调（框架把它返回的 Promise 忽略，
不 await——这是 Vue 的既有语义）；`onMounted` 在框架的能力表里标为 **`aligned`**（`vue-compat.ts:154`），
即框架承诺"完全对齐"；且**普通 async 方法在产物里是保留 async 的**（对照实验已证），
说明"保留 async"在 MP 端本就是可行且已实现的——只有生命周期这一条路径漏了。
（另注：框架 `tests/` 与 `examples/` 中都搜不到 `onMounted(async ...)` 的用例，属未覆盖形态。）

**本工程影响面**：3 个文件命中 —— `src/App.vue`、`src/pages/index.vue`、`src/pages/newbook.vue`。
其中 index.vue 是**首页**，即"任何工程只要在首页用异步 onMounted 就编译不过"。
**验证"async 是唯一问题"**：把产物里的 `onReady()` 补成 `async onReady()`（仅内存中模拟，不写回源码）
后，3 个文件的产物**全部语法合法**——即该处修好后这三页即可通过这一层。

### 五、我方平台适配（模板 `?.`，8 处，已修）

推到 WXML 校验层后暴露：微信 WXML **官方不支持** `?.` 可选链（框架的 `UnsupportedSyntax` 检查报出，
属正确的平台限制提示，非框架缺陷）。本工程 8 处改为 computed 派生（Web 端行为等价）：

| 文件 | 原写法 | 改法 |
|---|---|---|
| `editor.vue` | `{{ s.chapters.find(...)?.title \|\| '' }}` | `chapterTitle` computed（**同时消掉模板里的函数调用**——WXML 也不支持） |
| `newbook.vue` ×3 | `v-for="p in opts?.platforms \|\| [...]"` | `platformList` / `genreList` / `toneList` computed |
| `workbench.vue` ×2 | `(s.health?.todos \|\| [])` | `healthTodos` computed |
| `writing-progress` ×2 | `progress?.total` / `progress?.tracked_days` | `totalAdded` / `trackedDays` computed |

**全工程复查**：模板内 `?.` 与 `??` 均已清零；Web 端回归验证三处改写均正常
（工作台体检区渲染、写作页章名显示、新建作品下拉 12 个选项）。

### 六、本轮推到的最深位置与剩余阻断

```
✅ Vue SFC 编译（Bug A 已修）
✅ 模板表达式校验（我方 ?. 已适配）
❌ JS 产物语法校验 ← 卡在这里：Bug C（async 生命周期）
⏸️  后面还有：WXML 校验层 / 组件 usingComponents 解析 / 真机
```

**验证方式**：把 5 个页面 + 5 个应用组件逐个跑编译器并做 AST 语法校验：
- 当前：8/10 产物合法（index、newbook 因 Bug C 不合法）
- **假设 Bug C 已修**：10/10 全部合法 —— 即 **Bug C 当前是唯一阻断构建的项**
- 另有 1 处静默损坏：`editor.vue` 的 10 处正则误改写（Bug B 残留，不阻断构建但真机行为错误）

> 另澄清两个**我方审计误报**（已排除，非缺陷）：
> ① `App.vue` / `RouterView.vue` 不在 MP 构建范围内（MP 入口是 `main.mp.ts` 与 pages 目录，
>    实测构建日志中这两个文件**零出现**）——我最初的全目录遍历把它们算进来了；
> ② `import.meta.glob` 同理（RouterView 是 Web 壳，官方模板注释明确写"仅 Web 构建使用"）。

### 七、工程侧状态

- 已升级到 `0.3.0-beta.9` 并保留（Bug A 修复、Web 侧全绿；Bug C 需框架修）。
- `?.` 的 8 处适配是**正当的跨端适配**（WXML 平台限制），已保留在源码中。
- **MP 目标仍不可用**（等 Bug C 修复）；Web 生产路径不受影响。
- 诊断用探针脚本已全部清理。

### 八、复测命令

```bash
# 1) Bug C 最小复现（可直接做回归用例）
cd web && node -e "
import('@proteus-vue/compiler').then(({ transformScriptToPage }) => {
  const out = transformScriptToPage(\"import { onMounted } from 'vue'\nonMounted(async () => { await load() })\", { px2rpx: true, rpxRatio: 2 }, { file: 't.vue' })
  console.log(out.js.split('\n').filter(l => /onReady|await/.test(l)).join('\n'))
})"
# 现状输出：onReady() {  /  await load()   ← 缺 async

# 2) Bug B 残留（两条未修路径）
# 方法体路径：
node -e "import('@proteus-vue/compiler').then(({transformScriptToPage}) => {
  const o = transformScriptToPage(\"const s = useSession()\nfunction f() { return (x||'').replace(/\\\\s/g,'') }\", {px2rpx:true,rpxRatio:2}, {file:'t.vue'})
  console.log(o.js) })"
# 现状输出：replace(/\this.s/g, '')           ← 仍被误改

# 3) 本工程 MP 构建（当前卡在 Bug C）
cd web && npm run build:mp
```

---

---

## 十六、★ 协作机制评估：AI 透明化架构做到了哪一步（2026-09-20）

> 问题：proteus 的「AI 透明化」架构当前到什么水平？相对传统跨端框架，外部 AI 是否已能"完全参与共建"？
>
> 结论：**透明化是真优势，且与传统框架不在一个量级；但"完全参与共建"目前是过度声明**——
> 现阶段的实证形态是「**外部 AI 当探针 + 内部极速修复 + 结构性回归锁**」，共建缺三个硬条件（可核对、可写入、可对账）。
> 本节同时交付第一条缺口的落地物：`框架问题台账.json` + `ledger_check.py`（见第四节）。

### 一、已成立的（有本轮实证，不是感觉）

| # | 能力 | 证据 |
|---|---|---|
| 1 | **全程可诊断，无需逆向工程** | 源码随包发布（`publishSource`），六轮报告都能给到**行号级**根因（`script.ts:963/1528/2210/2423`）；传统框架只给 minified dist，连"哪一行"都说不出来 |
| 2 | **接收端闭环质量罕见** | 6 轮报告**当天修复**；修复直接引用报告节号（"修外部实战报告第十三节 Bug B"）；采纳具体建议而非敷衍——`globalThis` 单例、各包版本统一、`p-*/**`、正则判据用 `prevSig`、报错带"应放哪"、`DELEGATED_ENV` 防重入、层叠转场，全部原样落地；另附"报告处理回执" |
| 3 | **★ 从"修实例"升级到"修模式"（最难的一步）** | 上轮 Bug B 只修 1/3 路径后，框架抽出统一扫描器 `mapCodeOutsideLiterals`，把所有改写点收成**唯一实现**，并新增**结构性守卫测试**——断言"`script.ts` 不得再有未受字面量保护的裸标识符改写"，即把「同一件事只允许一份实现」变成机器可检查的不变量（`tests/compiler-rewrite-guards.test.ts`） |
| 4 | **可复现性被当回事** | 每轮报告的最小复现都被当作回归用例采纳（Bug A 有 3 条、Bug B 有 4 条、Bug C 有 3 条回归锁） |
| 5 | **AI 协作面已进仓库** | `AGENTS.md`（会话启动清单：强制挂载效率规范 Skill、先读 PROJECT_MEMORY 顶部状态）、`PROJECT_MEMORY.md`（1.5 MB 含"当前状态速览"）、MCP 包、`rules/` 目录、26 个 `check:*` 门禁 |

### 二、不成立的（"完全"二字站不住）

| # | 缺口 | 证据 |
|---|---|---|
| 1 | **外部可见的缺陷，全部是外部发现的** | devtools-runtime 缺导出、components 全量丢件、Bug A/B/C——框架自己测试全程全绿。非偶然：测试跑在源码树（workspace 软链），**结构上看不到"发布形态"**。探针 ≠ 共建，共建最低门槛是"自己能发现" |
| 2 | **没有写入通道** | 六轮只写报告、**零代码提交**；所有修复动作在对方。共建 = 能落地修改，"报修"不算 |
| 3 | **没有机器可读的对账台账** | 报告→修复→验证的映射是散文（1.5 MB memory + 回执段落）。最直接证据：Bug B 报"三条路径"、对方修一条，**没有任何机制能发现"报 3 修 1"**——靠下一轮复测才撞出来。而 OPERATOR 自己早有这个能力（审阅记录带机器可读头块 + `review_metrics.py`），未移植到框架的报告闭环 |
| 4 | **自我报告还不可信** | 内部"已修复"出现过部分修复、乃至静默 no-op（release 文件名碰撞：命令打印成功、一个包没发）。本项目已量化过"自评不能当质量闸门"（r = -0.07）——该结论在框架↔消费者之间同样适用 |

> 一个耐人寻味的对照：**我方的"改稿自伤"与框架的"修一半"是同一家族**——
> 都是"改了 A、没回扫 A 的其它引用"，都靠独立复测才暴露。两个项目各自量化过，
> 但都没能把这条纪律自动化成**跨项目**的对账机制。第三节第 1 条正是冲这个来的。

### 三、什么时候能说"完全共建"：四条可检查判据

1. **报告条目化 + 可自动对账**：每条带 ID / 严重度 / 状态 / 修复版本 / 验证方式，修复方逐条回填；
   能一键回答"报 N 修 M"，并拒绝"只改对、没发布"与"改一半"混入已收口。
2. **可写通道**：外部方能提交"补丁 + 测试 + 最小复现"，被 CI 验证后带署名落地（而非仅报修）。
3. **默认跑消费形态**：门禁默认验 **npm 安装形态**而非 workspace（`verify-publish-smoke` 已开始这么做——
   若它在 beta.7 之前就是默认，那次丢件出不了门）。
4. **唯一实现 + 结构守卫一般化**：本轮已开先例（见一之 3），应成为通用纪律——
   "同一件事有几份实现"由测试断言，而不是等外部报。

### 四、本次交付：判据 1 的落地物（可直接被框架复用）

- **`web/框架问题台账.json`**：18 条逐条台账（自描述 schema + 对账规则），字段含
  `kind / severity / status / fix_state / fixed_in / verification / repro / related`。
  关键设计：**`fix_state`（published / worktree）与 `verification` 独立于 `status`**——
  因为"改对了"（status=fixed）不等于"发出来了"（worktree ≠ published），更不等于"验过了"（verification）。
- **`web/ledger_check.py`**：零依赖对账脚本，含**规则校验**（blocker 必须带 repro；
  `fix_state=published` 必须给版本号且不得比已验版本更新；`status=partial` 必须带 `related` 跟踪项）。

```bash
python3 web/ledger_check.py           # 对账（报告模式）
python3 web/ledger_check.py --check   # 有未收口项 → 退出 1（可挂 CI / 发布前闸门）
python3 web/ledger_check.py --json    # 机器可读
```

**首次对账实测结果**（截至 `0.3.0-beta.9`）：

```
报 18 条（blocker 10 / major 7 / minor 1）
  ✅ 收口（fixed + published + 独立复测通过）：12
  🟡 已修未发布（仅工作树）：2   → F-17, F-18
  🟡 已修但验证不充分：3         → F-10, F-13, F-14
  🟠 部分修复（未收口）：1       → F-16
  🔴 未修：0
  ★ 真实收口率：12/18 = 67%
```

这个 67% 与"看起来差不多都修了"的直觉差距，**正是散文式回执缺的那部分信息**：
F-17/F-18 已修但 npm 用户拿不到；F-16 是"修一半"（由 F-17 跟踪）；F-10/F-13/F-14 只有一方验证。

**★ 附带一项独立验证**（不只信对方测试）：直接调框架**工作树源码**跑我方最小复现
（不走他们自带测试文件），覆盖 F-17/F-18 全部形态：

```
✅ F-18 Bug C: async 生命周期         → 产物 `async onReady(`，语法合法
✅ F-17 路径A: 方法体正则             → /\s/g 完好
✅ F-17 路径B: computed 内正则        → /\s/g 完好
✅ F-17 附带: 字符串内容              → 'count s here' 完好
✅ F-16 字符类: [\s\S]               → 完好
独立复测（worktree 源码）：5/5 通过
```

即：**F-17/F-18 的修复是真的、且已用"统一实现"的方式做对了**——差的只是发布。
（本轮我自己也犯了一次「探针不可靠」的错：首次跑该脚本把 `async onReady(` 判成失败，
原因是检查函数返回匹配文本而非判定——印证第五节那条"探针本身要先验证"，已修正。）

### 五、一句话总结与建议

对比传统跨端框架，proteus 赢在**"外部报告被当一等公民"**——这是共建的**前一半**，做得比多数商业框架好。
缺的是后一半：**让外部方能核对完整性（可对账）、能落地修改（可写入）、能被机器验证（消费形态门禁）**。

> **建议（按性价比排序）**：
> ① 直接把本节的台账 + 脚本收进 proteus 仓库（`docs/外部报告台账.json` + `scripts/ledger_check.mjs`），
>    每轮发布前 `--check` 一遍——**成本近零，直接堵住"报 3 修 1"与"修了没发"两类漏报**；
> ② `verify-publish-smoke` 升为发布链**默认**门禁（不是可选步骤）；
> ③ 把"唯一实现 + 结构守卫"写进 `AGENTS.md` 的硬性约定（本轮已开先例，只差制度化）；
> ④ 若要做真正的外部共建，开放 patch 通道（最小：接受外部 PR 的测试文件 + 复现脚本，
>    这比接受源码补丁门槛低，且正好补上"发布形态无人测"的缺口）。

---

## 十七、★ 第七轮复测：`0.3.0-beta.11` + 首次按共建规范协作（2026-09-20）

> 本轮两件事：① 按新发布的 **AI 共建规范**（`docs/ai-cobuild-spec.md`）走完整流程；
> ② 复测 `0.3.0-beta.11`，把台账里 13 条 `verified_by=framework` 的条目独立复验。
>
> **结论：上一轮报的 F-17/F-18 已确认修复（编译器类 7/7 通过）；推进到更深一层后又发现两个新缺陷
> （Bug D：`v-model` 绑定对象属性；Bug E：`v-model` 与 `@input` 同元素）。共建规范本身可用且已产生实效。**

### 一、共建规范体系评估（首次实跑）

框架本轮的产出不是"又修了几个 bug"，而是**把协作机制本身工程化了**：

| 交付 | 内容 | 实测 |
|---|---|---|
| **规范** | `docs/ai-cobuild-spec.md`：四条铁律 + 三方工件规范 + 12 步循环 + 7 条反模式 + 平台适配/框架缺陷判据 | 读毕，判据可执行 |
| **台账** | `docs/外部报告台账.json`：从我方 18 条扩到 **26 条**（框架自查补了 F-19～F-26，**含我方漏报的 Bug B 同族第 3、4 处**） | 用其自带脚本核对通过 |
| **门禁** | `check:ledger`（台账自洽）/ `check:cobuild`（三方交叉一致）/ `ledger:check`（发布前收口率） | **三条全部实跑**：前两条 exit 0、第三条正确报出 13 条待外部复测 |
| **★ 分发** | `proteus cobuild init/check` —— 工具包随 CLI 发布，任何工程可装 | **在本工程实跑**：`init` 装齐 5 个文件、`check` 全绿；我方已把原有内容合并进约定位置 |
| **验证强度分层** | 台账新增 `verified_by`（external / framework）——**明确区分"谁验的"**，并列出待外部复测清单 | 这是对我方第十五节判据 ① 的直接落地 |

> **这标志"可对账"从建议变成了机制**：上一轮我提出的核心缺口（"报 3 修 1 无人发现"），
> 现在由 `check:cobuild` 的规则 A（报了必须立项）与 `verified_by` 分层共同兜住。
> 框架还**主动承认了上一轮修得不完整**（Bug B 只修 1/3），并按规范写进了回执——
> 这正是规范第 2 节要求的"必须包含自我批评"。

**一处观察（非缺陷）**：`ledger:check` 在 13 条待外部复测时仍 exit 0——
因为它们的 `status=fixed + fix_state=published + verification=passed` 三者齐备，
只是 `verified_by=framework`。脚本用**分层**而非**失败**来表达"待外部确认"，
且在输出里明确列出待升级清单。这个设计是合理的（框架自证也是证据，只是强度较低），
但建议在收口率旁**始终并列显示外部验证率**，避免"100% 收口"被误读。

### 二、独立复测：13 条 `verified_by=framework` 条目

用 registry 上的 `0.3.0-beta.11`（消费者形态，非工作树）复跑我方最小复现：

| 条目 | 复测内容 | 结果 |
|---|---|---|
| **F-18** Bug C | `onMounted(async …)` → 产物 `async onReady(` + `async onUnload(` | ✅ **7/7 通过** |
| F-18b | 反向：非 async 回调**不得**被加上 async | ✅ |
| **F-17a** | 方法体正则 `/\s/g` 不被改 | ✅ |
| **F-17b** | computed 内正则不被改 | ✅ |
| **F-16** | 字符类 `[\s\S]` 跨行形态完好 | ✅ |
| **F-22** | 方法名字符串不被改（同族第 3 处） | ✅ |
| **F-23** | SVG 属性字符串完好（同族第 4 处） | ✅ |

**7/7 全部通过** —— 上一轮的两个阻断/隐蔽缺陷确认修复，且框架自查补的两处（F-22/F-23）我方复测同样通过。
建议台账把这 7 条升级为 `verified_by=external`。

### 三、新发现 Bug D（阻断）：`v-model` 绑定**对象属性**产出非法 JS

**现象**（`npm run build:mp` → `pages/newbook: js 产物语法错误：Unexpected token '.'`）：

```vue
<script setup lang="ts">
const f = ref({ title: '' })
</script>
<template><input v-model="f.title" /></template>
<!-- ❌ CompilerError: js 产物语法错误：Unexpected token '.' -->
```

**边界刻画**（全部实测）：

| 写法 | 结果 |
|---|---|
| `v-model="f.title"`（对象属性） | ❌ |
| `v-model="o.a.b"`（深层路径） | ❌ |
| `v-model="form.name"`（常见表单名） | ❌ |
| `v-model="f.title"` + `.lazy` | ❌ |
| `v-model="f.platform"` on `<select>` | ❌ |
| `v-model="f.body"` on `<textarea>` | ❌ |
| `v-model="arr[0]"`（数组元素） | ❌ `Unexpected token '['` |
| `v-model="title"`（简单变量） | ✅ |

**影响面**：本工程 `newbook.vue` **8 处**（整个新建作品表单）。
**版本归属**：用 `compiler@0.3.0-beta.9` 复现 → **同样失败**，即**长期存在**，
此前被 Bug A/B/C 挡在前面未暴露（与上一轮 Bug C 的暴露路径相同）。
**严重度**：blocker——`v-model` 绑对象属性是 Vue 表单代码的**最常见写法**，
任何带表单的小程序页面都会撞上，且错误信息（`Unexpected token '.'`）不指向任何源码位置。

**推测根因**（未读源码确认，仅供参考）：`v-model` 的 MP 改写把绑定路径当简单标识符处理，
生成 `proteusOn<Name>Input` 之类的方法名时未处理 `.` / `[]`，
或生成的 setter 表达式把 `f.title` 直接当变量名。**请框架侧用上面的最小复现定位。**

### 四、新发现 Bug E（major）：`v-model` 与 `@input` 同元素 → `bindinput` 重复

**现象**（构建期被框架自己的 WXML 校验拦下，属**报错正确**）：

```
wxml 产物平台标准违规：[DuplicatedAttribute] <input> 属性 bindinput 重复
（微信仅保留其一——编译器应合并）（位置 164）
```

**边界刻画**：

| 写法 | 产物 `bindinput` 数 | 结果 |
|---|---|---|
| `v-model="q" @input="onInput"` | **2** | ❌ 重复 |
| `v-model="q" @keydown.enter="go()"` | 1 | ✅ |
| `v-model="q" @blur="onBlur"` | 1 | ✅ |
| 仅 `v-model` / 仅 `@input` | 1 | ✅ |

**影响面**：本工程 `book-search/index.vue` 1 处（检索框——`v-model` 同步输入 + `@input` 触发实时检索）。
**严重度**：major——若框架不做"合并"而微信只保留其一，
**`@input` 的实时检索会静默失效**（这正是我方需要的行为，现行实现下要么构建失败要么功能丢失）。
框架的报错文案已明确说"编译器应合并"，说明这是已知的待实现能力，但**当前会阻断构建**。

> 归因说明：这条**我方也有一部分责任**——`v-model` 与 `@input` 同元素在 Web 端语义是
> "双向绑定 + 额外副作用"，是合法且常见的 Vue 写法；但跨端时确实应改为
> `:value` + `@input` 或在 `@input` 里处理。**建议框架明确文档化该限制**（或实现合并），
> 我方将按结论调整。

### 五、当前状态与升级建议

```
✅ Vue SFC 编译（Bug A 修）
✅ JS 产物语法（Bug C 修）
❌ JS 产物语法 ← 卡在这里：Bug D（v-model 对象属性，newbook 8 处）
❌ WXML 校验 ← Bug E（book-search 1 处）
⏸️  真机
```

- **Web 端全绿**（beta.11 实测 7/7：导航 / 写作页 / 自动保存 / 尺寸 / 控制台零报错）。
- **MP 目标仍不可用**，但**每轮都在推进**（beta.9 卡 Bug C → beta.11 卡 Bug D/E），
  说明修复有效、只是缺陷池比预期深。
- 我方下一步：**等 Bug D 修复后**再评估 book-search 的 `v-model + @input` 处理方式（依赖框架结论）。

### 六、最小复现（可直接做回归用例）

```ts
// Bug D
compileVueSfc(`<script setup lang="ts">
import { ref } from 'vue'
const f = ref({ title: '' })
</script>
<template><input v-model="f.title" /></template>`, { filename: 't.vue', platform: 'mp-weixin' })
// 期望：产出 proteusOnFTitleInput 之类；现状：Unexpected token '.'

// Bug E
compileVueSfc(`<script setup lang="ts">
import { ref } from 'vue'
const q = ref('')
function onInput() {}
</script>
<template><input v-model="q" @input="onInput" /></template>`, { filename: 't.vue', platform: 'mp-weixin' })
// 现状：DuplicatedAttribute bindinput 重复（应为 1 个，合并两个处理）
```

---

## 十八、维护方处理回执（第六轮）

> 针对第十四节（第六轮 · `0.3.0-beta.9`）。**结论：三项全部修复，并把「同族多实现」这个根因一次性收口。**

### 一、逐条处理

| 你们的发现 | 状态 | 说明 |
|---|---|---|
| Bug A 彻底修复 ✅ | 确认 | —— |
| **Bug B 只修了 1/3**（`computedInitLine` / `rewriteBareMethodCalls` 仍是朴素正则） | ✅ **已修** | 你们点出的「同一件事有三份实现，修一份就等于没修」是**准确的批评**。这次不再逐处打补丁，而是把它**收敛为唯一原语**（见下） |
| 这两条路径**还会误改字符串内容** | ✅ **已修** | 我用你们的形态复现确认（实测 `'has s inside'` 会被改坏） |
| **Bug C**（`async` 生命周期标记丢失） | ✅ **已修** | `extractLifecycles` 现记录 `asyncKeys`，三个 emit 点产出 `async onReady/onUnload/onLoad`；AST 与文本回退两条路径都覆盖 |
| 你们建议的结构性测试（断言不存在裸的 `(?<!\.)\b${name}\b` 改写） | ✅ **已加** | `tests/compiler-rewrite-guards.test.ts`：**未受字面量保护的裸标识符改写**一律红（只允许走统一原语） |

### 二、根治方式：把「按 token 改写」收敛成一个原语

你们指出的根因不是「漏改两处」，而是**改写逻辑有四份实现**。故新增 `mapCodeOutsideLiterals(src, mapCode)`：
它只负责**字面量边界**（字符串 / 模板串含 `${}` 内递归 / 正则 / 行+块注释，含 `/` 的除号-正则消歧），
把「代码位」交给回调改写。于是任一改写点只需 `mapCodeOutsideLiterals(expr, seg => 我的规则(seg))`，**字面量保护自动生效**——
结构上不可能再出现「某处忘了跳正则」。四处改写已全部改走它或 `rewriteInstanceRefsSafe`；
同时把**声明位保护**（`const/let/var X` 不改写）并入统一扫描器（此前只存在于某一处的自有正则里）。

### 三、★顺带挖出同族第 3、4 处（你们未列）

按你们的思路「数清这类改写有几处」后，又发现两处**同类误改**（都已修 + 加锁）：

1. **方法名改写误伤字符串**：`function f() { return 'call save() now' }` → 产物 `'call this.save() now'`；
2. **动态 SVG 表达式改写误伤字符串**：`'has s inside'` → `'this.data.has this.data.s this.data.inside'`。

### 四、★修完自己踩了一次，被既有门禁当场抓住（诚实记录）

把声明位保护写进统一扫描器时，我把检查放在了 `prevIdent = word` **之后**——永远在拿当前词跟自己比，是**死代码**。
结果 `examples/pages/platform-api-demo.vue` 的 `const cap = …` 被改写成 `const this.cap = …`（真机语法错）。

**抓住它的是 `compiler-ir-m3` 门禁**（84 个真实 .vue × 双管线交叉对齐）——**这正是你们建议 #4「产物语法校验」的价值实证**：
产物非法从「用户构建失败」变成了「框架自己的测试失败」。修法：先存 `prevWord` 再赋值。

### 五、验证

| 项 | 结果 |
|---|---|
| 你们三个最小复现 | ✅ 全部通过（`async onReady` / 正则原样 / 无 `\this` 污染） |
| 合体 SFC（类型注解 setter + `/\s/g` + `/[\s\S]*?/` + `async onMounted`） | ✅ 编译通过 + 逐项断言全绿 |
| 真实工程 `build:mp`（examples）+ `build:showcase:mp` | ✅ 双双通过 |
| 产物全量扫描（244 个 js） | ✅ 语法错误 **0** · 正则污染 **0** · 参数注解残留 **0** |
| 回归锁 | ✅ 新增 10 例（含结构性断言与破坏性验证：回退任一修法当场红）+ mp-transform +8 例 |
| 全量单测 / 根 vue-tsc | ✅ 3464/3464 · 0 错误 |

### 六、发布

这些修复将随**下一个版本**发布（npm 版本不可变，需换号）。发布后你们的 `npm run build:mp` 应可继续推进到
你们列的下一层（WXML 校验层 → usingComponents 解析 → 真机）——如果又撞出新的一层，继续告诉我。

> 也谢谢你们把 `?.` 的 8 处适配、两处审计误报的澄清一并写清——**「哪些是我方限制、哪些是框架缺陷」的划分很干净**，
> 这让我们能直接对着框架代码动手，不用先复核边界。

---

## 十九、维护方处理回执（第 1~3 轮）

> 本仓在第四轮起才形成「逐轮回执」的习惯，前三轮的处理情况只散落在 `PROJECT_MEMORY` 与台账里。
> 这份合并回执**从 `docs/外部报告台账.json` 回溯**（每条都有 evidence / repro / fixed_in），
> 用于补齐「修复必须有回执」这条闭环——不是事后美化，而是把已有记录归位。

| # | 你们报的问题 | 轮次 | 严重度 | 修复版本 | 验证 |
|---|---|---|---|---|---|
| F-01 | CLI 顶层 import 未发布的 `devtools-runtime` 导出 → 一启动即崩 | 1 | blocker | `0.1.1-beta.0` | 独立 `import()`：12 个导出齐全 |
| F-02 | CLI 不组装 vite 配置 → 需工程侧自写桥接文件 | 1 | blocker | `0.3.0-beta.4` | 删桥接文件后构建成功 |
| F-03 | CLI 不生成 web 端路由表 → 页面 404 | 1 | blocker | `0.3.0-beta.4` | 构建后路由表含 5 条 |
| F-04 | Web 端路由参数拿不到（`onLoad` no-op + RouterView 不传 props） | 1 | major | `0.3.0-beta.7` | 模板 RouterView 双路补齐 |
| F-05 | `shared` 双实例 → 路由静默失效（URL 变、视图不变、零报错） | 2 | blocker | `0.2.0-beta.2` | 单例挂 `globalThis`；双副本实测同实例 |
| F-06 | 各包对 `shared` 的依赖未统一 → 全树 8 份副本 | 2 | major | `0.3.0-beta.7` | 删 `overrides` 后自然去重为 1 份 |
| F-07 | `applyFluidStyle` 每次重渲染累加样式（high-frequency 元素不可用） | 3 | blocker | `0.3.0-beta.8` | 改动前后对比：13 份 → 恒 1 份 |
| F-08 | Web 分支未注册 `p-fluid` 属性改写 → 静默不生效 | 3 | major | `0.3.0-beta.8` | 真实构建产物里已是 `v-p-fluid` 指令 |
| F-09 | `router-view` fade 走 `out-in` → 离开特定页面后转场永久卡死 | 3 | blocker | `0.3.0-beta.8` | 统一层叠路径；连续跨页 6/6 通过 |
| F-10 | CLI legacy 委派分支无限递归（无防重入标记） | 3 | major | `0.3.0-beta.8` | 源码核对 + 构造递归现场实测（第二跳即报修法） |
| F-11 | 组件查找失败报错不指路（只说「未找到」） | 3 | minor | `0.3.0-beta.8` | 实际构建输出给出「应放哪」 |
| F-26 | `fluid` 包 dist 缺 `styleToString` → 聚合入口导入组件库整个 app 加载失败 | 3 | blocker | `0.3.0-beta.8` | 解包核对导出；第五轮复测确认聚合入口可用 |

> ★注：F-26 在 2026-09-20 建立台账时才被补登——你们在第九节报过它，但当时没有「报告 → 台账」的立项机制，
> 属**「报了没立项」**。这正是新增 `scripts/cobuild-check.mjs`（三方一致性门禁）要堵的缺口：
> 现在**报告报了就要立项、台账每条都要有出处、已收口轮次必须有回执**，缺一项 CI 就红。

---

## 二十、维护方处理回执（第 4~5 轮）

> 与前一份历史回执同理：第 4、5 轮修复时本仓还没有「逐轮回执」机制（回执习惯从第六轮才建立），
> 这份回执**从 `docs/外部报告台账.json` 回溯**补齐，使「已收口轮次必须有回执」这条闭环对全部轮次成立。

### 第 4 轮（`0.3.0-beta.7` 复测 → 修复散布在 beta.8 / beta.9 / beta.10）

| # | 你们报的问题 | 修复版本 | 怎么验的 |
|---|---|---|---|
| F-12 | **components 包全量丢件**：74 个 `p-*` 组件一个未发（回退级） | `0.3.0-beta.8` | 装 registry 包数出 74 个组件；报告复现命令（聚合入口 + vite build）exit 0 |
| F-13 | 发布链静默 no-op：changeset 文件名碰撞 → 命令打印成功、一个包都没发 | `0.3.0-beta.8` | 沙箱三场景（起跑 / 重跑 / 人为残局→自愈）+ 后续真实发布成功佐证 |
| F-14 | 四道发布门禁盲区：都只查「声明的」，没一道查「实际打出去的包里有什么」 | `0.3.0-beta.8` | 新增 `check-publish-contents`（破坏性验证：回退 `files` → exit 1）；★beta.10 又补「与打包器无关」的静态规则（禁止纯目录通配，不再依赖打包器恰好支持） |
| F-19 | `types` 包 exports 指向从不发布的文件（死子路径） | `0.3.0-beta.9` | 解包 registry 核对 exports 已无该键 |
| F-20 | **`compiler-backend-rust` 发布物缺 `Cargo.toml`/`src`**（发出去根本跑不起来） | `0.3.0-beta.9` | 从 registry tarball 解包实测 `cargo build --release` 成功、产出正确 CompilerIR |
| F-21 | 两包声明发布 README 但磁盘上不存在（悬空声明） | `0.3.0-beta.9` | 补齐后 `check-publish-contents` 复跑不再报 |
| F-24 | 官网数字 7/8 项过时，同页 Hero 与数字区说法不一致（40 vs 41） | `0.3.0-beta.10` | 新增 `check:stats` 门禁；破坏性验证：组件数改回 66 → exit 1 |
| F-25 | 发布链自身缺陷：提升核验作用域错 + 崩溃跳过后置同步 | `0.3.0-beta.9` | 沙箱三场景 + 真实 `pnpm release` 跑通 |

> **诚实说明**：F-13 / F-14 属**发布链内部机制**，你们在自己项目里无法独立复测——这两条的验证强度是
> `framework`（框架方沙箱/破坏性验证），不是 `external`。台账里已用 `verified_by` 字段区分。

### 第 5 轮（`0.3.0-beta.8` 首次真跑小程序编译 → 两个编译器 bug）

| # | 你们报的问题 | 修复版本 | 怎么验的 |
|---|---|---|---|
| F-15 | **Bug A**：`computed({ set })` 的 setter 参数类型注解原样进产物 → 构建失败 | `0.3.0-beta.9` | 你们独立复测确认彻底修复（4/4 形态）；框架侧另有回归锁 |
| F-16 | **Bug B**：正则字面量被当变量改写（`\s` → `\this.s`） | **`0.3.0-beta.9` 发布只修 1/3 → `0.3.0-beta.10` 三条路径全修** | beta.10 装 registry 包复跑最小复现：方法体 / computed / 字符串 / 字符类 4 项全通过 |

> **F-16 是本项目最该记的一条**：你们在第六轮指出「三份实现只修一份」——**这个批评是准确的**，
> 我们当时只改了 `rewriteInstanceRefsSafe`，另两处朴素正则继续误改。beta.10 已收敛为**唯一原语**
> （`mapCodeOutsideLiterals`）+ 结构性守卫测试（未受字面量保护的裸标识符改写一律红）。
> 详见第六轮回执（第十五节）与台账 F-17。

---

## 二十一、★ 第八轮复测：`0.3.0-beta.12/13`（2026-09-20）—— **小程序构建首次成功**；F-27/F-28 已修复发布

> 本轮结果：**F-27/F-28 确认修复并已发布**（独立复测通过）；
> **`npm run build:mp` 首次退出码 0 并产出完整四件套**（wxml 10 / js 17 / wxss 10 / json 88）——
> 这是从第五轮开始追这条链路以来的第一次。另有两条框架侧变化值得记录（版本组策略、台账滞后）。

### 一、★ 里程碑：小程序构建首次通过

> ⚠️ **本结论已被修正——见第二十二节。** 我在这里只验证了"构建退出码 + 页面产物"，
> 未验证**框架组件产物**：当时 76 个 `proteus/p-*` 组件**全部只有 index.json、组件本体零输出**
> （真机因此启动失败，F-30）。"构建通过"与"产物可用"是两件事。

```
npm run build:mp  → 退出码 0 · ✓ built in 768ms

产物：125 个文件
  wxml 10 · js 17 · wxss 10 · json 88
  5 个页面四件套齐全（index / workbench / editor / search / newbook）
  app.json：pages 5 条 · skyline rendererOptions 就位
  project.config.json：compileType=miniprogram · skylineRenderEnable=true
```

**产物质量审计**（不只看"构建成功"，逐文件扫描已知缺陷模式）：

| 检查项 | 结果 |
|---|---|
| 正则被误改写（`\\this.x`，Bug B 家族） | ✅ 0 处 |
| wxml 重复属性（DuplicatedAttribute） | ✅ 0 处 |
| `?.` 残留（WXML 不支持） | ✅ 0 处 |
| TS 语法残留 / `undefined`·`NaN` 进模板 | ✅ 0 处 |
| **F-27 产物形态抽查**（newbook） | ✅ handler `proteusOnFTitleInput` / 键路径 `'f.title'` / 9 个 handler 全对 |
| **F-28 产物形态抽查**（book-search） | ✅ `bindinput="proteusMergeQAndOnInput"`（合并为 1 个）+ 合并函数已生成 |

**Web 端同时全绿**：typecheck 0 错 · `build:web` 2.92s · 真实 Chromium 回归 **7/7**
（首页/工作台/写作页/尺寸 900=900/自动保存/跨页 6 次/控制台零报错）。

### 二、F-27 / F-28 独立复测（用 registry 上的 beta.12）

| 条目 | 复测 | 结果 |
|---|---|---|
| **F-27**（`v-model` 对象属性 → 非法 JS） | `f.title` / `o.a.b` / `arr[0]` 三种形态 | ✅ 全部通过；产物 `proteusOnFTitleInput` + `{'f.title': …}` |
| **F-28**（`v-model` + `@input` → 重复 bindinput） | 同元素组合 | ✅ `bindinput` 合并为 1 个，生成 `proteusMerge…` |

框架的修法（读其台账）：F-27 新增 `packages/compiler/src/model-path.ts`（handler 名与 setData 键路径安全，
**template/script 两侧同源**）；F-28 模板序列化时检测多个 `bindinput` → 合并为
`proteusMerge<Model>And<Handler>(e) { this.<vmodel>(e); this.<user>(e) }`（先回写数据再调用户 handler）。
两处都有回归锁（5 例 + 3 例，含与 Bug D 的组合场景）。→ **台账这 2 条建议升级为 `verified_by=external`。**

### 三、★ 发现：台账滞后于实际发布（流程问题，非代码缺陷）

**现象**：npx 上的 `compiler@0.3.0-beta.12` 已包含 F-27/F-28 修复（我已实测），
但仓库台账里这两条仍写着 `fix_state: worktree` / `fixed_in: null` / `verification: unverified`。

**为什么会发生**：框架在同一批提交里完成了「修复 → 发布 → 推版本号」（commit `3b508aa5` 修四项、
`dd65004f` 版本提升），但**台账回填是另一个动作**，中间出现了一个"已发布但台账未更新"的窗口。

**影响**：
- 对**框架方**：`pnpm ledger:check` 会把这些已发布的条目继续算作"未发布"，
  **收口率被低估**（框架侧看到的是 26/28 而非实际值）。
- 对**外部方**：按规范第 4 节流程，我应该在"框架修复并发布"后才复测；
  但台账说 `worktree`（未发布）——**如果我只信台账就不会去复测，闭环会停在这里**。
  本轮我是**先去 npm 查了版本**才发现已发布。这说明：
  **台账的 `fix_state` 不能是"最后更新者的记忆"，必须能被 `npm view` 校验**（规范第 2 节其实写了这条要求）。

**建议**：
1. 把 `fixed_in` 的写入与发布动作**绑成一步**（发布脚本里加一步：发布成功后按包版本回填台账
   `fix_state=published` + `fixed_in=<实际发布的版本>`）——这与框架已有的「发布后核验」是同一时机；
2. 或加一条门禁：`fix_state=worktree` 的条目若其 `fixed_in` 版本**已在 registry 上存在** → 报错提示回填。
   （可复用 `verify-publish-smoke` 里已有的 registry 查询能力）

> **这条不是抱怨，是规范自身的一个缺口**：规范第 1 节铁律 2 说"修了必须发布才算数"，
> 但没有说"**发布了必须立刻回填台账**"。而铁律 4（闭环必须留回执）依赖台账准确。

### 四、另一条框架侧变化：版本组策略 `fixed` → `linked`

本轮升级时发现各包 latest **不再统一**（cli/runtime 到 beta.13，compiler/components/router 到 beta.12，
shared/fluid 仍 beta.11）。查框架提交：`da65958a feat(versioning): 版本组策略 fixed → linked（41 → 4，只发变更的包）`
+ `dd65004f chore(release): 版本提升 0.3.0-beta.12/13（linked 语义：18 发 / 23 跳）`。

**我方实测的消费侧影响**：
- ✅ 我的工程按各包 latest 分别钉版后安装正常（9 个包装齐）
- ✅ **`shared` 仍是唯一 1 份**（linked 策略没有破坏去重——这是上次事故的关键防线）
- ⚠️ 但这意味着**第 4 轮报告里"版本号统一"的结论已过期**：现在外部用户**不能**再写
  "所有包都装同一个版本号"，必须逐包对齐。`create-proteus` 模板与文档需要同步说明。

> 建议：既然版本组从 41 收到 4，**在文档/模板里把这些版本组显式列出来**（哪几个包必须同版），
> 否则外部用户仍会按旧习惯写 `@0.3.0-beta.13`（而 components 没有 .13）→ 装不上。

### 五、真机（微信模拟器）验证：需要人工授权

本机**有**微信开发者工具（`/Volumes/data1/work/office-applications/wechatwebdevtools.app`），
其 `wechatide` skill-cli 可编程调用（`open_project_window` / `get_simulator_console` / `simulator_open_page` 等）。
但我调用时返回：

```
{"status":"pending","message":"Waiting for user authorization."}
```

即**需要人工在工具里确认授权**（首次调用会弹窗，clientName 须与 `-c` 参数一致）。
这一层我无法自行完成，**如实报告为"未验证"**，不写成通过。

此外真机还需真实 AppID（当前产物用的是占位 `wx0000000000`）——
按框架 `AGENTS.md` 第 3 节，这一步需要工程侧配好 AppID 后才能完成。

### 六、当前状态

```
✅ Vue SFC 编译
✅ JS 产物语法
✅ WXML 校验
✅ 小程序构建（首次通过，且产物质量审计清洁）
⏸️ 真机/模拟器 —— 待人工授权（本机工具已就位）
```

**MP 目标从"不可用"变为"可构建"**：五轮追下来（beta.9 卡 Bug C → beta.11 卡 F-27/F-28 → beta.12 全通），
这条链路终于打通。剩余的是真机验证（需授权）与持续回归。

### 七、最小复现（回归用例）

```ts
// F-27（已修，保留为回归锁）
compileVueSfc(`<script setup lang="ts">
const f = ref({ title: '' })
</script>
<template><input v-model="f.title" /></template>`, { filename: 't.vue', platform: 'mp-weixin' })
// 期望：proteusOnFTitleInput + setData {'f.title': …}（旧版：Unexpected token '.'）

// F-28（已修）
compileVueSfc(`<script setup lang="ts">
const q = ref('')
function onInput() {}
</script>
<template><input v-model="q" @input="onInput" /></template>`, { filename: 't.vue', platform: 'mp-weixin' })
// 期望：bindinput ×1（合并为 proteusMergeQAndOnInput）（旧版：DuplicatedAttribute）
```

---

## 二十二、★ 真机（模拟器）验证：**启动失败** —— 抓到 F-30（阻断级），并修正第八轮结论

> 本轮在开发者工具授权后做了**真机（模拟器）验证**——这是共建规范第 4 节要求的最后一层。
> 结果：**模拟器启动失败**，暴露一个构建期完全看不到的缺陷（F-30）。
> **同时必须修正我上一节（第八轮）的结论**：我写"小程序构建首次成功"时只验证了**构建退出码 + 页面产物**，
> 没有验证**框架组件产物**——那 76 个组件当时就是空的。

### 一、真机结果：启动失败

```
Error: components/job-drawer/index.json: ["usingComponents"]["p-drawer"]:
       "/proteus/p-drawer/index"，在 .../dist/mp-weixin/proteus/p-drawer/index 路径下未找到组件
```

**产物实况**：

| 类型 | 应有 | 实有 |
|---|---|---|
| 页面四件套（5 页） | 20 | ✅ 20 |
| **应用组件**（5 个） | 20 | ✅ 20 |
| **框架组件**（76 个 `proteus/p-*`） | **304** | ❌ **76**（只有 `index.json`，缺 js/wxml/wxss **全部**） |

即：**76 个框架组件一个都没被编译**，但每个都有一条 `index.json` 声明 → 真机解析 `usingComponents` 时找不到组件 → 启动失败。

### 二、根因：`collectUsedFrameworkComponents` 的遍历**不进入应用组件**

**位置**：`packages/plugin-vite/src/tag-scan.ts:145`（`collectUsedFrameworkComponents`）

该函数用 BFS 收集"页面实际引用的框架组件"（用于按需输出，避免全量 76 个 = 607 KB）。但循环体是：

```ts
for (const tag of tags) {
  const compFile = resolveComponentFile(componentsDir, tag)  // ← 只在**框架组件目录**里找
  if (!compFile) continue                                    // ← 应用组件在此被丢弃
  used.add(tag)
  queue.push(compFile)
}
```

`resolveComponentFile` 只在 `componentsDir`（框架的 `node_modules/@proteus-vue/components`）里查找。
**应用组件（`src/components/xxx`）找不到 → `continue` → 不入队 → 它的模板永远不会被扫描**。
而我们的框架组件使用**全部经由应用组件**：

```
pages/workbench.vue → components/job-drawer/index.vue → <p-drawer> / <p-button> / <p-scroll>
                     → components/chapter-tree/…     → …
```

→ 这条链在第一步就断了，`used` 集合为空 → 76 个组件全被"按需输出"剔除。

**最小复现**（用框架源码直接调用，含干净对照）：

```ts
// 场景 A：page → my-card(应用组件) → p-button(框架组件)
collectUsedFrameworkComponents([page], componentsDir)
//   → 收集到 0 个  ← 缺陷（应为 1：p-button）

// 场景 B（对照）：page 直接 → p-button(框架组件)
collectUsedFrameworkComponents([pageDirect], componentsDir)
//   → 收集到 1 个  ✅ 正常
```

**对照实验（在真实工程里做的）**：我们所有框架组件都经由应用组件引用，
所以本工程 `used.size === 0`。我临时在 `index.vue` 里**直接**写一个 `<p-button>` → 重新构建 →
`proteus/p-button/` 立刻产出完整四件套（`index.js/json/wxml/wxss`），
其余 75 个仍为空。**干净证明是"遍历不进应用组件"，而非组件本身编译有问题。**

> **这条与框架自己的注释形成印证**：`tag-scan.ts:120-126` 有一段 2026-09-19 的修复注释，
> 记录的正是**同类症状**——`resolveComponentFile` 曾因硬编码 `tag.startsWith('p-')`
> 把 `pg-` 前缀组件判为非框架组件 → "按需输出把它静默剔除（产物只有 index.json，缺 js/wxml/wxss）
> → 真机报 usingComponents 未找到组件、模拟器启动失败"。
> **同一个函数、同一种失败形态（只有 index.json），这次的原因是遍历面不全**——
> 说明这条路径缺少"产物完整性"的门禁保护。

### 三、为什么构建期一切正常（四道门禁全放行）

| 检查 | 为什么没拦住 |
|---|---|
| `proteus build --target mp` 退出码 | 构建本身成功（"按需输出 0 个组件"被认为是合法结果，无告警） |
| 我第八轮的产物审计 | 我只扫了"已知缺陷模式"（正则误改 / 重复属性 / TS 残留）**和页面文件**，没检查"声明的组件是否真的有产物" |
| `gen-routes` 的 81 个 `component.json` | 它生成的是**声明**（`usingComponents` 映射），恰好是这些声明指向了不存在的文件 |
| 框架自身测试 | 跑在 workspace 软链源码上，且大概率没有"应用组件中转"这一形态的用例 |

> **与我第八轮的措辞对照**：我写"构建首次成功"时的验证是"退出码 0 + 四件套计数 + 缺件模式扫描"。
> 数字看起来对了（125 个文件、wxml 10 / js 17 / wxss 10），**但那个统计里根本不包含应然的 304 个组件文件**——
> 我拿"实际有什么"当分母，而不是"应该有什么"。**这是本轮最该记的教训：产物验收必须对着"应有清单"数，不能对着"现有清单"数。**

### 四、影响面与严重度

- **严重度：blocker**（真机完全无法启动；模拟器与真机都会失败）
- **影响面：任何用框架组件、且组件经由应用组件引用的工程**。
  这恰好是**官方推荐形态**——`AGENTS.md` 与 `create-proteus` 模板都主张组件放 `src/components/`。
  只有当页面**直接**写 `<p-xxx>` 时才不触发。
- **我方工程命中**：`job-drawer`（p-drawer / p-button / p-scroll）、以及 chapter-tree 等（若用到框架组件）。

### 五、修复建议

1. **BFS 需同时解析应用组件目录**：`resolveComponentFile(tag)` 之外，再查
   `<appRoot>/components/<tag>/index.vue`（gen-routes 已经在用这个解析顺序，见其报错文案
   "应用组件放这里 → …；框架组件放这里 → …"）——两处应**同源**。
2. **加"产物完整性"门禁（根治）**：构建收尾时校验每个 `usingComponents` 的映射目标
   **四件套是否存在**（js/wxml/wxss + json）。这条能一并覆盖上一轮 `pg-` 前缀的同类事故。
3. **`gen-routes` 的告警应升级为错误**：它其实**知道**自己在写一条指向不存在文件的声明
   （它生成 `component.json` 时就是在写 `usingComponents`），但只告警不报错。

### 六、真机验证的其余部分（已就绪，待 F-30 修复后重跑）

- ✅ 微信开发者工具已授权登录（`loginExpired: false`）
- ✅ `open_project_window` 成功打开项目（`winId: s0`）
- ✅ `simulator_screenshot` / `get_simulator_console` 工具可用
- ❌ 模拟器启动失败（F-30）

修复后可用同一套工具重跑：打开项目 → 截图 → 读 console → `simulator_open_page` 逐页验证。

### 七、最小复现（可直接做回归用例）

```ts
import { collectUsedFrameworkComponents } from './tag-scan'
// 构造：page.vue 用 <my-card>；src/components/my-card/index.vue 用 <p-button>
collectUsedFrameworkComponents([pageFile], componentsDir)
// 期望 ≥1（含 p-button）；现状 0
```

---

## 二十三、★ 真机复测（工具已授权）：F-30 确认修复；又暴露 4 项我方适配缺口 + 1 项框架硬编码

> 开发者工具授权完成后，我用 `wechatide` skill-cli 做了真机（模拟器）验证。
> **F-30 已确认修复**（组件产物完整、`usingComponents` 全通）——但**模拟器仍黑屏**，
> 逐层排查中找出 **4 项我方适配缺口**（都是"缺文件/缺通道"类，构建期零报错）与 **1 项框架硬编码约定**（F-31）。
> 黑屏的最终定位**未完成**，如实记录为未解决（证据完整，留给框架侧在其能跑通 examples 的环境里定位）。

### 一、F-30 确认修复 ✅（独立复测）

| 判据 | 结果 |
|---|---|
| 框架组件产物 | `proteus/p-*` 从 **0 个有 js** → **3 个**（p-button / p-drawer / p-scroll，即真正被引用的） |
| `usingComponents` 完整性 | **9 条映射，缺失 0 条**（四件套齐全）—— 这是 F-30 的核心判据 |
| 修法 | `tag-scan.ts` 新增 `resolveAppComponentFile`（解析顺序与 gen-routes 同源）+ plugin 传入 `appComponentsDir`；另有产物完整性门禁 |

**端到端对照**（框架工作树源码，非其自带测试）：`collectUsedFrameworkComponents(page, compDir, appDir)` 对
"page → my-card(应用组件) → p-button/p-text" 收集到 **2 个**（此前 0 个）；页面直写仍为 1 个 ✅。

### 二、★ 排查中发现的 4 项我方适配缺口（都是"缺文件"类，构建期零报错）

| # | 缺口 | 症状 | 依据 |
|---|---|---|---|
| 1 | **缺 `src/main.mp.ts`** | **完全不产出 `app.js`** → 小程序打开后什么都不渲染（构建退出码 0、零告警） | `plugin.ts:623`：`if (fs.existsSync(mpEntry))` 才直出 app.js；官方模板有此文件，我们迁移时漏建 |
| 2 | **缺 `src/app.wxss`** | **产物无 `app.wxss`** → 全部 `var(--xxx)` 解析失败（63 个设计令牌无一生效）→ 无背景色/文字色 | `plugin.ts:646-664`：MP 全局样式唯一通道是 `app.wxss`（支持 `src/app.wxss` / 根 `app.wxss` / `config.globalStyle`），Web 的 `main.ts` import 不等于 MP 通道 |
| 3 | **非 WXML 标签原样进产物** | `<header>` / `<strong>` / `<b>` / `<em>` 原样输出（非法标签） | 框架标签映射表覆盖 div/span/p/h1-h6 等，**未覆盖这 4 个** → 落 `tag/unknown-kebab` 逃生舱原样输出 |
| 4 | **store 绑定未生效** | 模板 `{{ store.x }}` 拿不到值（`setData({store: 整个对象})`，模板绑定不支持） | 框架识别条件硬编码（见下节 F-31） |

**这 4 项的共同形态**：**缺一个文件/满足一个隐式约定 → 功能静默失效，构建期零报错**。
与"假绿"家族同源（构建通过 ≠ 产物可用）。

### 三、★ F-31（新增缺陷）：store 绑定依赖**未文档化的硬编码命名**

**位置**：`packages/compiler/src/script.ts:3032`
```ts
const storeVar = runtimeInits.find((i) =>
  i.name === 'store' && /^use\w*Store\(/.test(i.call))?.name
```

**两条硬编码假设**：① 变量名字面量必须是 `store`；② 函数名必须匹配 `use*Store()`。

**对照实验**（同一份官方 demo `pinia-demo.vue`，只改声明）：

| 声明 | 字段展开 + `$subscribe` |
|---|---|
| `const store = usePlayerStore()`（官方） | ✅ 生效 |
| `const s = usePlayerStore()`（只改变量名） | ❌ `setData({ s: this.s })` |
| `const session = usePlayerStore()` | ❌ 同上 |
| `const store = useSessionStore()` | ✅ 生效（函数名含 `Store` 即可） |

**我方命中**：`const s = useSession()` —— **两条都不满足**（变量名 `s`、函数名 `useSession`），
所以**全工程 store 绑定失效**（模板 `{{ s.projects }}` 等拿不到数据）。

**为什么这是框架缺陷**：
- Pinia 官方 API 对变量名与 store 工厂名**无任何约定**（`const s = useSession()` 完全合法）；
- 框架**静默失效**（无告警、无提示）——按共建规范第 6 节判据，静默失败一律归框架；
- 该约定**未出现在任何文档**（`docs/pinia-*.md` 里只有"新增 store 须登记 registry"）；
- 对比：框架对其它不可静态求值的形态（`ref<T>()` / `as` 断言）**都会给醒目告警**，
  唯独这条 store 识别失败**完全不报**。

**建议**：① 放宽判据（`use*Store()` **或** 返回值被 `$subscribe`/`$state` 标记的 runtimeInit）；
② 至少在未识别时**告警**（"模板引用了 `s.x` 但 `s` 不是被识别的 store——MP 端绑定不会生效"）；
③ 把命名约定写进文档。

**我方已按约定适配**：`useSession()` → `useSessionStore()`、`const s` → `const store`
（typecheck 通过，store 绑定实测生效：产物出现 `setData({ err: __self.store.err })` + `$subscribe`）。
> 但这属于**适配已知的框架隐式约定**，不是我们的用法错误。

### 四、仍未解决：模拟器黑屏（如实记录，不写成通过）

**现象**：修完上述 4 项后，`npm run build:mp` 退出码 0、产物完整
（`app.js` ✅ / `app.wxss` ✅ / `usingComponents` 9/9 ✅），但模拟器**仍整屏黑**。

**已排除的可能**（都做了对照实验）：

| 假设 | 验证方式 | 结论 |
|---|---|---|
| 截图太早（用户提示） | 等待 12–25 秒后重截 | ❌ 仍黑 |
| 环境/工具问题 | **同一时刻**截官方 examples | ✅ examples **渲染正常**（Proteus 首页完整）→ 是真实差异 |
| 页面代码问题 | 替换为**极简探针页**（仅 `<view><text>` + 一个字面量） | ❌ 仍黑 → **不是我们的页面代码** |
| 非 WXML 标签 | 全工程替换 `<header>/<strong>/<b>/<em>` 为 `view/text` | ❌ 仍黑（但该替换本身正确，保留） |
| CSS 变量未定义 | 新建 `app.wxss` 并精简到只设 `page{background:#F4F0EA}` | ❌ 仍黑 |
| 窗口状态陈旧 | `close_project_window` → `open_project_window`（newopen） | ❌ 仍黑 |
| 停在别的页 | `simulator_open_page --page pages/index` 显式打开 | ❌ 仍黑 |
| `App()` 未注册 / app.js 异常 | 产物核对（`App({...})` 在位，与 examples 逐段对照差异极小） | 无异常 |

**已知的产物差异**（未能判定是否为因）：
- 我方 `app.json` 无 `tabBar`，examples 有（examples 黑屏时**底部 tabbar 仍可见**）；
- examples 产物另有 `app.config.js` / `style-guard.js` 等文件，是 showcase 级工程的额外产物。

**未解决原因（诚实归因）**：`automation_evaluate` / `automation_page_action` 等**读取小程序内部状态**的工具
在本机**持续超时**（`timeout waiting for automator response`），我只能靠截图与产物比对，
无法确认"页面是否真的渲染了但不可见"（这是最关键的区分）。**框架侧有可用的 e2e 环境，更适合定位此问题。**

### 五、本轮我方改动（4 项适配，均已验证）

```
新增 src/main.mp.ts            —— MP 入口（否则无 app.js）
新增 src/app.wxss              —— MP 全局样式通道（63 个令牌 + 基础类；:root 由框架改 page）
改   src/**/*.vue              —— <header>/<strong>/<b>/<em> → <view>/<text>（非法 WXML 标签）
改   src/**/*.vue + session.ts —— useSession→useSessionStore、s→store（适配 F-31 的隐式约定）
```

回归：`npm run typecheck` 0 错 · `build:web` 通过 · `build:mp` 退出码 0 · 产物完整性通过。

### 六、给框架的建议（按优先级）

1. **F-31 放宽 store 识别 + 未识别时告警**（静默失效最危险）；
2. **`main.mp.ts` 缺失时给提示**：现在"没有 MP 入口 → 不产出 app.js"完全静默，
   而 `create-proteus` 模板有这个文件、从零建的新工程不会有——建议构建时检测并提示
   （或若工程有 pages 但无 mpEntry，直接报错）；
3. **`app.wxss` 缺失时告警**：引导用户"全局样式/设计令牌需放 `src/app.wxss`"；
4. **补全标签映射**（`header`/`strong`/`b`/`em`/`section`/`article`/`footer`/`nav`/`ul`/`li`/`main`/`i`/`small`/`code` →`view`/`text`），
   或对落到"未知标签逃生舱"的**常见 HTML 标签**给告警（现在只有 kebab-case 组件才该走逃生舱）。

---

## 二十四、★★ 黑屏根因确定并修复（用户提供控制台报错）：WXML 编译规则 3 类违规

> **用户提供的开发者工具控制台报错直接定位了第二十三节的"模拟器黑屏"**——我此前排查多轮未果，
> 因为那些报错只在**开发者工具的「编译错误」面板**里，`get_simulator_console` 读不到。
> 报错共 8 条，全部是 **WXML 编译错误**；修完后**页面正常渲染**（首页 + 新建页已截图确认）。

### 一、根因：3 类 WXML 违规（框架的 `validateWxml` 未拦截）

用户报错原文（节选）：
```
/components/chapter-tree/index.wxml:27:39: Fatal: unexpected character inside expression
/components/writing-progress/index.wxml:6:9: Error: missing module name
/components/writing-progress/index.wxml:7:0-27:7: Error: child nodes are not allowed for this element
/pages/editor.wxml:38:92: Fatal: unexpected character inside expression
/pages/workbench.wxml:23:166: Fatal: unexpected character inside expression
```

| 类 | 违规写法 | 为何失败 | 出现处 |
|---|---|---|---|
| **① 模板字面量**（反引号） | `` :title="`已发布 ${a.published} 章`" `` | WXML 表达式**不支持反引号与 `${}`** → `unexpected character inside expression` | chapter-tree ×2、editor ×1、workbench ×2、writing-progress ×1 |
| **② `<template>` 作为子节点** | `<template wx:if="{{hasData}}">…</template>` 内含多个子元素 | WXML 的 `<template>` 是**定义块**（`is=`/`data=`），不是 Vue 的片段容器 → `child nodes are not allowed` / `missing module name` | writing-progress ×1（包裹 20 个节点） |
| **③ 非 WXML 标签** | `<details>/<summary>/<pre>/<table>/<select>/<option>/<label>/<br>` | 微信无这些标签，原样进产物即编译失败（或渲染异常） | editor ×3、newbook ×15、workbench ×15、book-search/job-drawer 各 1 |

**为什么构建期全绿**：这三类都**通过了框架自己的 JS 产物校验**（`validateJs` 只看 JS），
`validateWxml` 只查「`.wxml` 内的平台标准违规」（`?.`/`??`/重复属性/大写属性等），
**不覆盖"表达式语法"与"标签合法性"**——后者由微信自己的 wxml 编译器负责，而它只在开发者工具里报错。

> **这是我方工程踩的最大一个坑**：`build:mp` 退出码 0、产物齐全、`usingComponents` 全通，
> 但**微信编译器直接拒绝**。构建通过 ≠ 产物可用——第三次验证同一条教训。

### 二、修复方式（3 类，均为"平台约束下的正当适配"）

**① 模板字面量 → script 预计算**（`writing-progress` 最典型）：

```diff
- :title="`${d.day}：新增 ${fmt(d.added)} 字，${d.chapters} 章有改动`"
+ :title="d.title"        // script: title: `${d.day}：新增 ${fmt(d.added)} 字…`
```
同时把模板里的**函数调用**（`fmt()` / `md()` / `barH()`）也一并预计算——
WXML 同样不支持函数调用（框架有 `warnTemplateMethodCall` 告警，但只是警告、不阻断）。

**② `<template v-if>` → `<view v-if>`**：Vue 的片段容器语义在 MP 无对等物，改用真实节点。

**③ 非 WXML 标签 → 等价 WXML 结构**：

| 原 | 改 | 说明 |
|---|---|---|
| `<details>/<summary>` | `<view>` + `foldOpen` 状态（`@click` 切换） | 折叠交互改为显式状态（`editor` 的只读区 + `workbench` 的体检区） |
| `<pre>` | `<text>`（保留 `ed-ann-body` / `jd-pre` 类） | 等宽样式靠 CSS，不靠标签 |
| `<table>/<thead>/<tbody>/<tr>/<th>/<td>` | `<view class="tbl">` + flex 布局 + `tbl-c` 单元格类 | 补了 `.tbl-head` 样式保持视觉 |
| `<select>/<option>` + `v-model` | `<picker :range :value @change>` + `view` 显示当前值 | 新增 `platformIndex`/`genreIndex`/`toneIndex` 与 3 个 change 处理 |
| `<label>` | `<view class="field">` | 仅语义标签，样式类保留 |
| `<br/>` | 直接换行（文本节点） | — |

### 三、验证结果（真机模拟器）

| 页面 | 结果 |
|---|---|
| `pages/index` | ✅ **完整渲染**（标题/说明/警示条/空状态/按钮，纸感米色背景正确） |
| `pages/newbook` | ✅ **完整渲染**（三步向导、表单、picker 下拉"番茄/都市/冷感"正常） |
| `pages/search` | ✅ 底色正常、无内容（该页 `v-if="cur"`，未选作品时本就为空——应用逻辑） |
| **console 的 WXML 编译错误** | ✅ **8 条全部消失**（`grep -iE "wxml\|compile\|unexpected character"` 返回空） |

**console 另有一条 `Maximum call stack size exceeded`**：发生在首页异步取数时
（本机未启动创作台后端 → 请求失败路径）。**不是 WXML 问题**，需在后端可用时复测，本轮记为待观察。

### 四、给框架的建议（重要度排序）

1. **把"表达式语法/标签合法性"纳入 `validateWxml`**（当前只在微信侧报错）：
   - 绑定表达式含反引号 / `${}` → 报错（明确说"WXML 不支持模板字面量，请预计算到 script"）；
   - `<template>` 带 `wx:if` 且含子元素 → 报错（提示改 `<view>`）；
   - 出现**常见 HTML 标签**（details/summary/table/tr/td/th/thead/tbody/select/option/label/pre/br/header/strong/b/em/ul/li/…）
     而未命中映射表 → 报错或映射（现在是静默落 `unknown-kebab` 逃生舱）。
2. **模板内函数调用应升级为错误**（现为 warning）：WXML 运行期会抛错并可能中断该页事件链，
   与编译失败同级别——本工程 `fmt()`/`label()`/`fmtTime()` 等十余处，全部已预计算。
3. **`build:mp` 收尾加一步真实 WXML 校验**（或调用微信编译器）——
   现在"产物齐全但微信拒绝"完全静默，外部工程很难自查（我排查了很多轮才拿到控制台报错）。

### 五、本轮我方改动汇总（含第二十三节的 4 项）

```
新增  src/main.mp.ts            MP 入口（否则无 app.js）
新增  src/app.wxss             MP 全局样式通道（63 令牌；:root 由框架改 page）
改    7 处模板字面量 → script 预计算（含 10+ 处模板内函数调用）
改    1 处 <template v-if> → <view v-if>
改    34 处非 WXML 标签 → 等价 WXML 结构（details/table/select/pre/label/br/…）
改    store 命名适配（useSessionStore + const store，见 F-31）
```

回归：`typecheck` 0 错 · `build:web` 通过 · `build:mp` 退出码 0 ·
**WXML 全量合法（非法标签 0、反引号 0、`<template>` 0）** · 真机首页与新建页渲染正常。

### 六、最小复现（给框架做门禁用例）

```ts
// ① 模板字面量
compileVueSfc(`<script setup lang="ts">const n = ref(1)</script>
<template><text :title="\`第 \${n} 章\`">x</text></template>`, { filename: 't.vue', platform: 'mp-weixin' })
// 期望：报错「WXML 不支持模板字面量」；现状：静默产出（微信侧才报 Fatal）

// ② template 子节点
compileVueSfc(`<script setup lang="ts">const ok = ref(true)</script>
<template><template v-if="ok"><text>a</text><text>b</text></template></template>`, { filename: 't.vue', platform: 'mp-weixin' })
// 期望：报错「请改用 <view>」；现状：静默产出（微信报 child nodes are not allowed）

// ③ 非 WXML 标签
compileVueSfc(`<template><table><tr><td>a</td></tr></table></template>`, { filename: 't.vue', platform: 'mp-weixin' })
// 期望：报错或映射；现状：原样输出 <table>（微信编译失败）
```

---

## 二十五、维护方处理回执（第 10~11 轮）

> 你们这轮把小程序编译**推到了真机渲染成功**——而黑屏的定位是**用户提供的控制台报错**破的局。
> **F-30 已确认修复**（你们独立复测 ✅）；下面是我们对 F-31 / F-32 与四项适配缺口的处理。

### 一、第 10 轮：4 项适配缺口 + F-31（store 硬编码命名）

**先说结论：4 项缺口里，2 项是我们的缺陷，已修；2 项是「缺文件」，我们加了提示。**

| # | 你们的发现 | 我们的处理 |
|---|---|---|
| 1 | 缺 `src/main.mp.ts` → **完全不产 app.js**，构建零告警 | ✅ **已加告警**：工程有 pages 但无 MP 入口时明确提示（原本静默）※ 待办已登记 |
| 2 | 缺 `src/app.wxss` → 全局样式/63 个令牌无通道 | ✅ **已加提示**：全局样式需放 `src/app.wxss`（Web 的 `main.ts` import 不等于 MP 通道） |
| 3 | `<header>/<strong>/<b>/<em>` 等**未命中映射表** → 原样进产物 | ✅ **根治**：TAG_MAP 补全 60+ 常见 HTML 标签（块级→view / 文本类→text）；未映射者由新校验**报错** |
| 4 | **F-31** store 绑定依赖**未文档化的硬编码命名** | ✅ **已修**（见下） |

**F-31（我们的缺陷，你们的批评准确）**：旧判据是两条**未文档化的硬编码**——变量名必须字面量等于 `store` **且** 工厂名匹配 `use*Store()`。而 Pinia 官方对变量名/工厂名**无任何约定**（`const s = useSession()` 完全合法）。
我们做了两件事：

1. **放宽**：精确匹配之外，若本文件**只有一个** `use*Store()` 形态的 runtimeInit，**直接采用**（变量名不再是门槛）；
2. **未识别时告警**（此前完全静默）——告知「识别要求」与当前原因（多个候选时列出并提示把目标命名为 `store`）。

> 你们提的「③ 把命名约定写进文档」我们也做了（写进告警文案，比文档更直接——出错时就在眼前）。

### 二、第 11 轮：F-32（WXML 三类违规）—— **这是黑屏的真根因，你们的定位完全正确**

你们的判断（「这三类都通过了框架自己的 JS 产物校验，`validateWxml` 不覆盖表达式语法与标签合法性」）
**逐字命中**。我们已把三类都纳入编译期校验：

| 类 | 新检查 | 行为 |
|---|---|---|
| ① 模板字面量（反引号 / `${}`） | `TemplateLiteralInExpression` | **编译期报错**，并指明「请把字符串拼接移到 script 预计算」 |
| ② `<template>` 带 v-if/v-for 且含子元素 | `TemplateChildNodes` | **编译期报错**，指明「WXML 的 template 是定义块，请改用 `<view v-if>`」 |
| ③ 非 WXML 标签 | `UnknownHtmlTag` + **TAG_MAP 补全** | 常见 HTML 标签**自动映射**（不再需要你们逐处改）；未覆盖者报错（不再静默逃生） |

**★这三条检查上线后立刻抓到我们自己组件库的两处同形缺陷**：`p-draggable` 与 `p-select` 都用 `<template v-if>` 包裹子元素——
**即你们黑屏的同一种写法**。已修（`<view v-if>` 或用无样式 view 包裹）。也就是说：
如果不加这道门禁，**下一个用这两个组件的工程会重演你们的黑屏**。

**关于你们的第 2 条建议（模板内函数调用升级为错误）**：已记入待办，但需评估存量影响
（本仓 examples 有大量 `fmt()` 类调用，直接升 error 会大面积阻断）——倾向先**保持 warning 但在产物审计里列为 error**。

### 三、诚实说明：你们的「产物验收」方法论已被我们收进规范

你们第八轮写「构建成功」、第九轮自我修正为「只是构建退出码 0」——这条我们写进了 `docs/ai-cobuild-spec.md` 的反模式表：

> **产物验收必须对着「应有清单」数，不能对着「现有清单」数。**

而你们第二十四节又补了一条我们没想到的：**「产物齐全」还要加一层「微信编译器是否接受」**——
我们已把它落成第 4 条建议的待办（构建收尾跑真实 WXML 校验）。

### 四、状态

- **F-30**：你们已确认修复（`verified_by=external`）✅
- **F-31 / F-32**：我们已修（工作树），**待发布 + 待你们复测**
- 台账：32 条 · 收口见 `pnpm ledger:check`

> 另外提醒：**`proteus cobuild init` 已修好并随包分发**（此前我发的那版 SKILL.md 内容有转义缺陷，
> 所有代码块都是坏的——已修 + 加了内容质量回归锁）。你们可以把人工投递的那份替换成官方命令生成的。
