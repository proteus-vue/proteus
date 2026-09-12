# Proteus 官方演示小程序（showcase）

> **一套 Vue 语义源码 → 微信小程序（Skyline）+ Web**，全面演示 Proteus 框架能力。

## 定位

| 工程 | 职责 |
|---|---|
| **`showcase/`（本目录）** | **对外**官方演示：信息架构、品牌视觉、能力全景 |
| `examples/` | **内部**测试全家桶：编译/渲染边界用例（被 13 个测试当 fixture 引用，勿混用） |

## 信息架构（5 tab + 10 二级页 + 分包详情）

**按官方演示的信息架构组织：tab 页按语义域分组列出全部条目（官网式分组），详情页按分包按需加载。**

```
主包（15 页：5 tab + 10 二级）
首页      品牌立方体 + 框架数据 + 分区入口
组件 ★    分组目录（6 域 / 72 组件，对齐官网）→ 点入分包详情页
语义      编译链路可视化 + 源码/多端对照
能力 ★    分组目录（10 域 / 81 Hook，对齐官网）→ 点入分包详情页
我的      应用信息（app-config）+ 技术栈 + 关于

分包（按大分类独立分包，按需加载）
subpackages/components/pages/<name>    组件详情页（每组件一页，官方形态）
  p-button / p-input（样板已就位；目录页可点击进详情）
subpackages/capabilities/pages/<name>  能力详情页（每 Hook 一页）
  camera（样板已就位）

详情页形态（官方组件文档范式，后续全量页复用）
  —— 演示单元 = <demo-block>（标题+说明+实机演示+代码折叠+输出回显）
  —— API 单元 = <api-table>（Props/Events/Slots）
  —— 目录单元 = <catalog-list>（按域分组，可点击条目带 chevron，未备详情页标「规划中」）

二级页    液态玻璃（真 pg-glass + 强度滑块）
          柔性布局（真 p-grid/p-stack/p-split，容器查询驱动）
          安全区（真 p-safe 避让）
          多渲染后端（分段切换看各后端产物形态）
          转场动效（真跳转触发 halfScreen/slideUp/scaleDown）
          路由（真跳转 + 路由表）/ 状态管理（真 Pinia store）
          i18n（真 locale 切换）/ 在线编译（语义映射对照）/ 关于
```

**为什么分包**：主包有 32 页硬限，且 160 页目标会挤爆主包体积——详情页按「组件 / 能力」大分类各自独立分包，
主包只留导航骨架，详情页按需加载。

## 目录结构

```
showcase/
├── proteus.config.ts     构建期配置（platform/skyline/appid/router.subPackages+tabBar+meta/globalStyle）
├── app.config.ts         运行时配置（app.name/version/features/theme）
├── pages/                主包 15 页（5 tab + 10 二级）
├── subpackages/          ★分包（按大分类）
│   ├── components/pages/    组件详情页（p-button / p-input 样板）
│   └── capabilities/pages/  能力详情页（camera 样板）
├── data/catalog.ts       ★目录数据（AUTO-GENERATED，单一事实源 = 官网内容）
├── components/           应用组件（brand-cube / page-shell / demo-block / api-table / catalog-list）
├── router/               路由单例 + RouterView（Web 端转场）
├── styles/
│   ├── tokens.css        ★设计 token（唯一事实源，Web 与 MP 共用）
│   └── shared.css        跨页复用样式
├── shims/                wx / 事件 / .vue 类型垫片
└── main.ts / main.mp.ts  双端入口
```

### ★目录数据（单一事实源 = 官网内容）

`showcase/data/catalog.ts` 由 `scripts/gen-showcase-catalog.mjs` 从 **官网内容**
（`website/content/components/*.md` + `capabilities/*.md`）生成——**分组 / 排序 / 名称 / 描述不在 showcase 手抄**，
与官网导航同源。`route` 字段由「该条目是否已有详情页文件」自动判定（存在即置路由 → 目录页可点击；否则标「规划中」）。

```bash
node scripts/gen-showcase-catalog.mjs          # 生成 / 重新生成
node scripts/gen-showcase-catalog.mjs --check  # 校验快照（CI；漂移 exit 1）
```

> 新增一个组件详情页 = 放 `subpackages/components/pages/<p-name>.vue`，再跑一次生成器即自动出现在目录页。


## 关键设计

### 品牌
品牌立方体与官网导航 logo、网站 favicon、小程序头像**同源**（`components/brand-cube/index.vue`）。
★颜色硬编码 hex（非 CSS 变量）：MP 把内联 SVG 降级为 base64 data-URI 的 `<image>`，
data-URI 内无宿主样式上下文 → CSS 变量填充会丢失变黑。

### 设计 token（跨端单一事实源）
`styles/tokens.css` 一份文件两端消费：
- **Web**：`main.ts` import（`:root` 命中 html）
- **MP**：`proteus.config.globalStyle` 指向它 → 构建期产出产物根 `app.wxss`（微信全局样式）

★框架构建期把 `:root` 改写为 `page`（WXSS 的根选择器不支持 `:root`，会告警且不生效）——
源文件保持标准 CSS，改写只发生在 MP 产物。

### 跨端约束（踩过的坑，写在此避免重犯）
| 约束 | 说明 |
|---|---|
| 组件标签用 kebab-case | `<p-view>` 而非 `<PView>`——MP 编译器按 kebab 扫描注册 |
| 应用组件走目录约定 | `components/<tag>/index.vue`（gen-routes 按此扫描注入 usingComponents） |
| `<p-view>` 默认纵向 | `display:flex; flex-direction:column`——横排须显式 `flex-direction:row` |
| props 用运行时声明 | `defineProps({...})` 而非 `defineProps<T>()`（泛型形式 MP 编译器不支持） |
| `ref` 不带类型实参 | `ref([...])` 而非 `ref<T[]>([...])`（带泛型无法静态求值初值） |
| 全局样式走 `globalStyle` | 页面级 wxss 各自 scoped，变量无法跨页继承 |
| **模板禁内联箭头函数** | `:options="list.map(b => ({…}))"` 的 `=>` 会破坏 WXML 解析（`unmatched parenthesis` → 整页黑屏）→ 移到 computed |
| **store 必须经 computed 进 data** | `useXxxStore()` 直调归 runtimeInit 实例属性 → MP 模板读不到；computed 取值才进 data |
| **指向 tab 页的链接自动 switchTab** | `wx.navigateTo` 对 tabBar 页必失败（静默无反应）→ 框架 `proteusNavigateTo` 已内置 switchTab fallback |
| **代码片段等含 `<` `"` 的文本放 data** | `:code="'<p-button>'">` 的属性字面量含 `<`/`"` 会破坏 WXML 解析（IDE 卡死）→ 存 data 后 `:code="codes.x"` |
| **store 用 `{{ store.x }}` 直接引用** | 编译器据此生成 `$subscribe→setData` 响应式桥；`computed(()=>store.x)` 包装会绕过它（数据不更新） |
| **框架组件主题变量定在 page 级** | 跨组件（demo-block → p-button）设 CSS 变量**不继承**（微信组件样式隔离）→ 组件换肤变量须在 `page`（app.wxss）定义 |
| **★共享组件根节点/容器用原生 `<view>`/`<text>`** | `<p-view class="card">` 的类名经 `root-class` 进组件**内部**，父 wxss 受微信组件样式隔离够不到 → **卡片边框/圆角/内边距/阴影全失效**（真机实测）；原生 `<view>`/`<text>` 类名留在元素上 ✓（Web 端 map 为 proteus-view/text，同样正确）。仅**页面级** wxss 能作用到框架组件 |
| **横排容器用原生 `<view>`** | `<p-view>` 自带 `flex-direction: column`，覆盖 `.row{flex-direction:row}` → 横排一律用原生 `<view>` |
| **演示页截图走框架通道** | `node scripts/showcase-shot.mjs <页>`（wechatide `simulator_screenshot`）——不截桌面、不依赖窗口位置 |
| **★框架组件事件载荷是 `{ value }`（无 detail）** | p-input 等 emit `{ value }`（见 examples 正确接法）；按原生 `e.detail.value` 取值**恒 undefined** → 「输入后结果不变化」 |
| **★框架默认样式不得压过用户主题化** | 框架 `@media (prefers-color-scheme: dark)` 内的 `.proteus-web-button.is-default` 曾与页面 `.p-button[data-v-x]` 同特异性 (0,2,0)，系统暗色下级联使其胜出 → **浅色卡片上按钮白底白字、肉眼"消失"**；修法：框架侧 `:where()` 归零特异性（`packages/built-in-components/src/style.css`） |
| **★E2E 必须断言"渲染可见性"** | 只断言路由/data/文本会漏掉「元素塌陷/不可见/整体消失」。用 `assertPageRendered(driver, { keySelector, minVisibleRatio, expectedCount })`（`@proteus-vue/test-core`）——`test:e2e:showcase` 已接入 `verify` |
| **★输入类组件须显式固定高度** | 只给 padding 时两端 `<input>` 默认盒模型不同 → MP 端又矮又圆（胶囊）+ 占位文字极小，与 Web 严重不符 → `height: var(--p-input-height, 44px)` |
| **★导入的模块常量必须经 computed 进 data** | `import { X } from './data'` 后模板写 `{{X}}`/`:prop="X"` → 编译产物绑到**模块标识符**（非 data）→ MP 运行时 undefined、**整块不渲染**（真机实测：目录页只剩组标题）。修法：`const x = computed(() => X)` → 编译器 onLoad 求值 setData（Web 天然可读，故仅 MP 暴露） |
| **★嵌套 `v-for` 用外层 `<view>` 包裹，勿用 `<template v-for>`** | `g.items` 的双层循环 + 内层 `v-if/v-else`：`<template wx:for>` 包裹会丢节点（MP 只渲染出组标题、条目全空）；改为 `<view v-for>` 包一层即正确。真机实测差异 |
| **组件内 `<a href>` / `<router-link>` 导航（框架已修）** | 编译产物需 WXML `bindtap="proteusNavigateTo"` 与组件 JS `methods.proteusNavigateTo` **同时存在**。2026-09-13 真机 bug：编译器 template 阶段浅拷贝 ctx 丢失 `usesNavigate` 标志 → methods 为空 → 点击无反应；已修（`packages/compiler/src/template.ts`），回归锁 `tests/compiler-component-nav.test.ts`。★改编译器源码后须重建 `packages/compiler/dist`（构建消费 dist）+ 清编译缓存才生效 |

## 命令

```bash
pnpm --filter proteus-showcase dev:web     # Web 开发
pnpm --filter proteus-showcase build:web   # Web 构建 → dist/web
pnpm --filter proteus-showcase build:mp    # 小程序构建 → dist/mp-weixin
```

小程序产物 `dist/mp-weixin` 可直接导入微信开发者工具（appid 见 `proteus.config.ts`）。
`pnpm verify`（仓库根）已包含本工程的双端构建门禁。
