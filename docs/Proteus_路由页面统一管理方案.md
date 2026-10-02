# Proteus 路由页面统一管理方案

> 版本：v1 · 日期：2026-10-02
> 定位：**独立方案**（路由主线的"页面管理"层）。回答一个具体问题：
> **开发者在一个工程里管理"页面"这件事，应该只有几个入口、几个产物？**
> 上游依据：《Proteus_主流框架路由调研与启示》（9 框架 × 7 问，含 6 条可执行启示）。

---

## 0. 结论摘要（给 LLM / 实现者）

| # | 结论 | 性质 |
|---|---|---|
| 1 | **一个配置入口**：`proteus.config.ts` 的 `router` 段（页面配置 = `router.pages`，`pages.json` 等价物） | 定案 |
| 2 | **一个产物文件**：`routesOutput`（默认 `router/auto-routes.ts`）承载**三份投影**（routes / screens / 类型表） | 定案 |
| 3 | 🔴 **不允许多份导航产物**（本轮删除 `navigation.generated.ts`——"App 注册表"并入统一产物） | 硬约束 |
| 4 | **页面发现是约定式的**（`pages/**/*.vue`）——配置**不重复声明"有哪些页"**，只声明"每页怎么配" | 定案 |
| 5 | 端专属配置（MP 的 `pageJson` 窗口扩展）**随页面配置集中声明**，构建期写入各端产物 | 定案 |
| 6 | 各端**运行时产物**（`app.json` / `page.json` / 打包产物）是**构建输出**，不是"第二个管理入口" | 澄清 |

> **一句话**：**一个 `router` 段管全端页面配置，一个 `auto-routes.ts` 承载全部导航数据，
> 各端运行时产物全部由它们推导出来。**

---

## 1. 用户反馈（本方案的缘起）

> **原话**：「我看了下在开发者项目里面有原来的路由表，还有 App 端导航注册表，**太乱了吧**，
> 跨端框架肯定是**统一路由管理入口**才对啊，还有**页面配置**这个我觉得应该统一放到路由管理里面去，
> 类似于 uni-app **一个 pages.json 管理全端路由页面**一个道理，先统一路由页面管理方案再说后面的。」

**诊断（成立）**：
- 上一批（项目驱动落地）把 App 屏注册表单独产出为 `router/navigation.generated.ts`
  ⇒ 开发者项目里出现**两份 generated**（`auto-routes.ts` + `navigation.generated.ts`），
  且配置面 `router.meta` 这个名字不像"页面配置"；
- 两份产物的**内容是同源的**（同一棵路由树）⇒ 纯冗余，且会漂移（谁先构建谁新）。

---

## 2. 参照：主流框架怎么管"页面"（调研结论摘取）

| 框架 | 配置入口 | 产物 | 形态 | 痛点/优点 |
|---|---|---|---|---|
| **uni-app** | `pages.json`（**唯一**） | 各端构建产物（不入开发者视野） | 配置式 | ✅ 一个文件管全端；❌ 页面清单**手写**（易漏、易与文件不同步）；层级限制无数字 |
| **Taro** | `app.config.ts` + 页面 `*.config.ts` | 同上 | 配置式 | ✅ 编译时类型宏（`definePageConfig`）；❌ 页面清单仍手写 |
| **Next.js** | `app/` 目录（**零配置**）+ 每页 `page.tsx` 特殊文件 | `.next/` | **文件约定式** | ✅ 页面零声明（目录即路由）；❌ 页面级配置无处集中（只能散在文件里） |
| **Nuxt 3** | `pages/` 目录 + 页内 `definePageMeta` | `.nuxt/` | **文件约定式** | ✅ 约定式 + 同文件元信息；❌ 配置分散在各页，跨页巡检成本高 |
| **React Native / Flutter** | 代码里声明（组件树 / 路由表） | 无（运行时） | 代码声明式 | ✅ 灵活；❌ 与文件系统脱钩，无"页面清单"概念 |

**取长补短（本方案的取舍）**：
| 借 | 从哪借 | 为什么 |
|---|---|---|
| **页面清单零声明**（目录自动发现） | Next.js / Nuxt | 消除"清单与文件不同步"（uni-app/Taro 的主要运维痛点） |
| **页面配置集中一处** | uni-app 的 `pages.json` | 跨页巡检/统一改配置（Nuxt 的分散式痛点） |
| **类型化 + 编译期校验** | Taro 的编译时宏（本仓更强：能校验跨路由引用闭合） | "路由不存在 = 编译错误"（启示 6） |
| **配置与产物可反查** | 本仓既有（`--trace-router` / 产物头标注来源） | 黑盒不可接受（本仓铁律 A-02 家族） |

---

## 3. 统一模型（本方案的核心）

### 3.1 三个层次，各只有一个入口

```
┌─ ① 页面发现（约定式，零配置）──────────────────────────────┐
│  pages/**/*.vue（+ subPackages 声明）——目录即路由            │
│  name/path 由位置推导（决策 #112）· 页面**清单不手写**        │
└──────────────────────────────────────────────────────────┘
                          ↓ 合并
┌─ ② 页面配置（唯一入口：proteus.config.ts 的 router 段）─────┐
│  router.pages:  { 'pages/user': { title, isTab, transition,  │
│                   requiresAuth, permissions, redirectTo,     │
│                   parent, pageJson, … } }                    │
│  匹配规则：**精确页面路径 > 目录前缀 > 默认**（决策 #113）     │
│  router 段其余：routesOutput / subPackages / customRoute /   │
│                tabBar（都是"项目级路由配置"的一部分）         │
└──────────────────────────────────────────────────────────┘
                          ↓ gen-routes（构建期）
┌─ ③ 统一产物（一个文件：routesOutput）───────────────────────┐
│  export const routes: RouteRecord[]        // Web/MP 路由表  │
│  export const screens/screenNames/tabNames // App 端投影     │
│  declare module … RouteParamsByName        // 类型提示表     │
│  ★三份投影同源（同一棵树、同一次产出）· 产物头标注来源        │
└──────────────────────────────────────────────────────────┘
                          ↓ 各端消费（各自运行时构建产物）
        app.json / page.json / 打包产物（**构建输出，不是入口**）
```

### 3.2 硬约束

| # | 约束 | 违反处理 |
|---|---|---|
| 1 | **一个产物文件**：导航数据只出现在 `routesOutput` | 不得新增 `*-generated.ts` 类第二产物（评审拒绝） |
| 2 | 页面清单**零手写**（目录约定式） | 配置里**不写** `pages` 数组（那是 uni-app 的形态，我们已超越） |
| 3 | 页面配置**只在一处**（`router.pages`） | 页内 `<route>` 块只保留"必须与页面共处"的声明（如 `params` 类型）；其余一律上收 |
| 4 | **跨路由引用必须闭合**（`redirectTo` / `parent` / `tabBar.list[].name`） | 构建期**抛错**（启示 6，已落地） |
| 5 | 端专属页面配置（`pageJson`）**随页面配置集中声明**，构建期写进各端产物 | 手写 `page.json` 会被构建覆盖（写明） |

---

## 4. 与各端的对应关系

| 端 | 消费什么 | 产出什么（构建输出） |
|---|---|---|
| **Web** | `routes`（`createRouter(routes)`） | SPA 产物（`dist/web`） |
| **小程序** | `routes` + `router.tabBar` + 页面 `pageJson` | `app.json`（pages/tabBar/window）+ 每页 `page.json` |
| **App（iOS/Android）** | `screens`（`createAppStack({ screens })`）+ `routes`（统一 API） | App bundle 内的导航注册表（本仓为 bundle 内联） |

★三端**同一份产物**、**同一棵路由树**——改一个页面/加一条配置，三端一起变（这是"一份源码多端"在**路由层**的兑现）。

---

## 5. 页面配置字段（`router.pages` 的取值面）

来源：`RouteMeta`（`packages/contracts/src/route.ts`，跨端契约）。

| 字段 | 类型 | 作用 | 消费端 |
|---|---|---|---|
| `title` | string | 标题（tabBar 文案缺省值 / 页面标题） | 三端 |
| `isTab` | boolean | 是否 tab 根屏 | MP（`app.json.tabBar` 推导）/ App（`tabNames`） |
| `transition` | `slideUp`/`slideDown`/`halfScreen`/`scaleDown`/`none` | 转场（**三端同一枚举**） | Web（Vue Transition）/ MP（routeType）/ App（Morpheus） |
| `requiresAuth` | boolean | 登录拦截（Router 自动守卫） | 三端（`createRouter` 的 authGuard） |
| `permissions` | string[] | 权限拦截（`resource:action`） | 三端（permissionGuard） |
| `redirectTo` | string | 整栈替换目标（**构建期校验存在**） | 三端 |
| `parent` | string | 显式父子（嵌套路由，**构建期校验存在**） | Web（嵌套路由）/ MP / App（tab 栈聚合） |
| `pageJson` | object | **MP 页面窗口扩展**（如半屏页透明背景 `backgroundColorContent`） | MP（写进 `page.json`） |
| `[key]` | unknown | 应用自定义字段（JSON 可序列化） | 透传（`meta` 里可读） |

---

## 6. 与既有机制的关系（划清边界）

| 机制 | 关系 |
|---|---|
| `<route>` 块（SFC 内） | **保留但收窄**：只承载"必须与页面共处"的声明（`params` 类型、`customRouteKeyName`、极端的页内 pageJson）；**常规页面配置一律上收 `router.pages`**（避免两处配置漂移） |
| `router.meta`（旧名） | **同义别名**（本轮改名 `pages`）：双写时 `pages` 胜并登记 duplicate；旧工程零破坏 |
| `appNavigationOutput` | 🔴 **本轮废弃删除**（App 注册表并入统一产物） |
| `--trace-router` | 不变（决策链反查；`router.pages` 的"精确 > 目录 > 默认"三级匹配仍逐条输出） |
| 跨路由引用校验 | 不变（本轮新增，见 §3.2 约束 4） |

---

## 7. 迁移（对已有工程）

| 情况 | 动作 | 是否必须 |
|---|---|---|
| 用 `router.meta` | 改成 `router.pages`（不改也能跑，但双写会告警） | 建议 |
| 项目里有 `navigation.generated.ts` | **删掉**（它不再被生成；内容已并入 `auto-routes.ts`） | 必须（否则是死文件） |
| 项目里手写页面清单（uni-app 风格 `pages` 数组） | 无此形态（本仓是目录约定式；若确需"只保留部分页面"，用 `platforms`/`webOnly` 门控） | — |
| 页内 `<route>` 块写了常规配置 | 可留（仍生效）；新写法建议上收 `router.pages` | 建议 |

---

## 8. 验收标准

- [x] 开发者项目里**只有一个导航产物**（`routesOutput`；本轮删除第二份）
- [x] 产物承载三份投影（routes / screens / 类型表）且**同源同数**
- [x] 页面配置集中在 `router.pages`（`router.meta` 旧名兼容 + 双写告警）
- [x] 页面清单**零手写**（`pages/**/*.vue` 目录发现）
- [x] 跨路由引用拼错 ⇒ **构建期报错**（附可用路由 + 修法）
- [x] MP 页面窗口扩展（`pageJson`）随页面配置集中声明
- [x] 两端真机消费该产物（判据 ⑨ 组：Android QuickJS + iOS JSC）

---

## 9. 实施记录（2026-10-02）

| 项 | 落点 |
|---|---|
| 配置面统一 | `packages/types/src/router-config.ts`：`RouterSection.pages`（首选）/ `meta`（别名，双写 duplicate）；删 `appNavigationOutput` |
| 产物统一 | `packages/plugin-vite/src/gen-routes.ts`：`writeAutoRoutes` 一次产出 routes + screens/screenNames/tabNames + 类型表；删 `writeAppNavigation` |
| 消费端 | `hosts/shared/bridge/entry-app-project.ts` 改读统一产物（单 import） |
| 测试 | `tests/router-project-driven.test.ts`（单一产物断言 + 不生成第二份）· `tests/router-config.test.ts`（pages/meta 别名与双写） |
| 文档 | 本文件 + 调研文档（`docs/Proteus_主流框架路由调研与启示.md`） |

**实测**：`[gen-routes] 已生成 router/auto-routes.ts（全端统一导航产物：37 路由 · 37 App 屏 · 2 tab + RouteParamsByName）`
—— 一个文件、一次产出、三份投影。

**诚实边界**：
① 各端**运行时产物**（`app.json`/`page.json`）仍会生成——它们是**构建输出**（uni-app 同样如此），
  不是"第二个管理入口"；判断标准是"开发者是否需要维护它"（不需要）。
② `<route>` 块与 `router.pages` 的**双源期**未强制收敛（页内声明仍生效）——收敛纪律见 §6，强制化留待后续。
③ 本方案**只解决"页面管理"**；路由 API 语义（启示 2 go/push 双通道、启示 5 返回意图拦截）仍是独立批次。
