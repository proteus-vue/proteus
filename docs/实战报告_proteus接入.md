# 用 proteus 重写创作台前端 · 实战报告

> 目的：拿真实项目验证 proteus 作为**跨端框架**的可用性。
>
> **结论：三处阻断项已修复，工具链可用；另发现一个"外部用户必踩"的依赖去重问题。**
>
> 复测日期：2026-09-19 晚 · 复测版本：cli 0.3.0-beta.4 / plugin-vite 0.2.0-beta.4 / router 0.2.0-beta.4

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

## 六-b、proteus 侧处理回执（2026-09-19 二次，针对本轮新发现）

> 报告中「adapter 单例分裂」一条是**最有价值的发现**——发布事故有报错，而它是**完全静默**的。
> 已按报告建议修复，并扩展到同类风险点。

| 报告建议 | 处理 |
|---|---|
| ① `adapter` 等单例改用 `globalThis`/`Symbol.for` | ✅ **已修**——`shared` 的 adapter 挂 `__PROTEUS_ADAPTER_{WEB,MP}__`；同类风险一并改造：`app-config`（`configRef` **+ `listeners`** 同槽——只共享前者不够，订阅者仍会分裂）、`devtools-runtime` 的 `getProteusTraceBus()`（否则生产者 emit A、面板订阅 B） |
| ② 重发 `devtools-runtime` | ✅ **已完成**——`0.1.1-beta.0` 已发布，实测 **12 个导出**（含 `createFlamegraphCollector` / `createTimelineCollector`），不再是 3 个 |
| ③ `create-proteus` 模板显式声明 `shared` | ✅ **本地模板已有**（`"@proteus-vue/shared": "^0.2.0-beta.0"`；报告所测旧模板无此声明）——实测脚手架工程解析为**单副本** |
| ④ Web 端补路由参数注入 | ✅ **已修**（上一轮）——adapter 当前页保留 `query` + RouterView `v-bind` 透传给页面 |
| ⑤ 旧委托路径加防重入标记 | ⬜ 未处理（待评估——请补充复现路径） |
| ⑥ 组件查找失败报「应放哪」 | ⬜ 待办（已登记） |

**验证方式（双向闭环）**：用两份 dist 副本模拟真实嵌套场景——
修复后：同实例 ✅ + 跨副本事件送达 ✅；修复前形态（模块级单例）：**分裂 ❌ + 静默失败 ❌**（与报告描述一致）。
回归锁含两条结构性断言（「不得退回模块级单例」「listeners 必须与 configRef 同槽」），防止未来重构退化。

## 七、给 proteus 的建议（按优先级）

1. **`adapter` / `traceBus` 等模块级单例改用 `globalThis` 或 `Symbol.for`**
   ——彻底消除"包副本不同 → 单例不共享"（本次最难的 bug）
2. **重发 `devtools-runtime`**（0.1.0 的 dist 缺 8 个导出，CLI 仍 import 它们）
3. **`create-proteus` 模板显式声明 `shared`**，版本与 router/runtime 对齐
4. **Web 端补路由参数注入**（onLoad 或 props 任一条）
5. 旧委托路径加**防重入标记**；递归时报明确错误而不是刷屏
6. 组件查找失败时，报错里**带上"应放哪"**

---

## 八、复测命令

```bash
cd web
npm install                 # 依赖来自 npm
npm run dev                 # → http://localhost:5273（/api 代理到 8760 后端）
npm run build:web           # 生产构建（按页分 chunk）
npm run build:mp            # 小程序构建（需真实 AppID 才能真机验证）
```
