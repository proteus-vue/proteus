# Proteus 导航体系（tabBar / navBar）多端一致性方案

> 状态：v1 · 面向 LLM 实现分发
> 定位：**能力原语层第四类**，与 187 语义原语、Morpheus 动画原语、可停靠滚动容器并列
> 目标：承载超级应用（多业务模块、多团队、可动态增删、深链直达）
> 已确认前提：uni-app / 小程序那套 tabBar **不适合超级应用**

---

## §0 结论摘要

### 0.1 用户的判断成立，且有官方证据

uni-app 官方在新版（uni-app x）中**已经移除了 `tabBar` 的 `midButton` 配置**，官方文档原话：

> "uni-app x 不再支持 uni-app 的 app-plus 专用配置以及 tabbar 的 midbutton。这些额外的功能，通过 uni-ui x 的自定义导航栏和 tabbar 组件来满足。"

**这是厂商自己在承认：原生 tabBar 这套静态配置模型撑不住实际需求。**

### 0.2 核心诊断：小程序 tabBar 是「静态配置 + 双栈隔离」模型

| 特征 | 说明 |
|---|---|
| 静态声明 | tabBar 在 `app.json` / `pages.json` 中声明，编译期固化 |
| 数量硬限 | list **最少 2、最多 5** |
| 双栈隔离 | tabBar 栈与普通页面栈**物理隔离** |
| 跳转割裂 | tabBar 页之间只能用 `switchTab`，`navigateTo` 被拦截 |
| 不可动态增删 | `setTabBarItem` 只能改 text/icon，**不能改 list 长度、不能隐藏、不能改 pagePath** |

**这五个特征，每一个都直接违背超级应用的需求。**

### 0.3 本方案的三层模型

| 层 | 概念 | 借鉴来源 |
|---|---|---|
| **L1 分支（branch）** | 每个顶层入口一个**独立导航栈** | Android `saveBackStack` / Flutter `StatefulShellRoute` / 鸿蒙 NavPathStack 独立实例 |
| **L2 栈（stack）** | 分支内的页面栈 | iOS `UINavigationController` |
| **L3 导航栏（bar）** | 页面级顶部栏 | 各端原生 + 自绘兜底 |

**L1 是"承载超级应用"的唯一关键**——没有多栈，超级应用一定做不成。

---

## §1 为什么小程序 / uni-app 那套不适合超级应用（实证）

### 1.1 五条硬限制

| # | 限制 | 事实 | 权威性 |
|---|---|---|---|
| 1 | **list 2–5 个** | 官方文档与社区一致 | 较高 |
| 2 | **`navigateTo` 不能跳 tabBar 页** | 报 "can not navigateTo a tabbar" | 较高 |
| 3 | **该失败不触发 success/fail** | 极易被忽略为静默失败 | 中等 |
| 4 | **不能动态增删** | `setTabBarItem` 只能改 text / iconPath / selectedIconPath | 中等 |
| 5 | **页面栈最大深度 10** | 连续 navigateTo 会栈溢出 | 较高 |

**第 3 条最致命**：它是**静默失败**——不报错、不走回调，开发者只能靠现象反推。这正是你一直批判的"打地鼠"。

### 1.2 图标与样式的静态约束

| 约束 | 说明 |
|---|---|
| 图标大小 | 微信官方：**40kb 上限，建议 81×81px** |
| 图标格式 | 不支持 SVG（运营换图标需重新切图、改路径、提审） |
| 网络图片 | 仅微信 2.7.0+ / 支付宝支持，其他平台不支持 |
| position=top | 仅微信小程序支持 |

**"换个带红点的图标要提审"**——这在超级应用里是致命的，因为红点、角标、徽标是运营高频需求。

### 1.3 uni-app 的 midButton 是跨端灾难

| 端 | midButton 表现 | 权威性 |
|---|---|---|
| **H5** | **完全不识别该字段**，渲染时忽略 | 中等 |
| **微信小程序** | 基础库 ≥ 2.24.4 才能解析，**低于此版本整个 tabBar 渲染失败（白屏）** | 中等 |
| **App 端** | **根本不读该配置** | 中等 |
| 触发条件 | **仅 list 项为偶数时有效**（2、4 个） | 极高（uni-app x 官方文档） |
| 交互 | 无 pagePath，须手动监听 `onTabItemTap` + 调 `switchTab` | 中等 |

**uni-app x 已直接移除该配置。**

### 1.4 自定义 tabBar 的四个坑（社区实证）

| # | 坑 |
|---|---|
| 1 | `custom: true` 是**全局开关**，不能只针对某页启用 |
| 2 | 必须**删掉 pages.json 整个 tabBar 块**，否则引擎仍撑开 **50px 不可见占位层**，导致自定义栏被顶高、凸起按钮被遮挡、安全区计算错乱 |
| 3 | **所有 tab 页必须加 `disableScroll: true`**，否则 iOS 滚动时把自定义栏顶上去 |
| 4 | HBuilderX **不报路径/配置错误，静默失败是常态** |

**这套设计的净结果是：官方路径做不了，自定义路径全是坑。**

### 1.5 结论

> 小程序 tabBar 是 **2017 年微信为"轻量小程序"设计的模型**——它假设应用只有 3–5 个固定入口、结构稳定、不需要动态化。
>
> **超级应用的每一个特征都与之相反。**

这一点应作为对外表述的核心论据。

---

## §2 Flutter 的经验：抄什么、避什么

### 2.1 值得抄：StatefulShellRoute —— 每分支独立栈

go_router 官方文档（权威性较高）：

> "`StatefulShellRoute` creates **separate Navigators for each of its nested branches** (i.e. parallel navigation trees), making it possible to build an app with stateful nested navigation."

对比表：

| | ShellRoute | **StatefulShellRoute** |
|---|---|---|
| 持久底栏 | ✅ | ✅ |
| **每 tab 独立导航栈** | ❌ | ✅ |
| **切 tab 保状态** | ❌ | ✅ |
| 适用 | 简单应用 | **复杂应用（嵌套导航）** |

**这正好是小程序"双栈隔离"想做但做歪的那个东西**——Flutter 做对了：不是隔离成两类互不可达，而是**多个平级栈，各自独立且都可达**。

**这是超级应用的刚需：Instagram / YouTube / Gmail 都是这个模型。**

### 2.2 值得抄：声明式路由（pages 即真相源）

Navigator 1.0 的问题（社区总结，权威性中等）：

- 命令式 push/pop，路由状态**隐式存在于内部栈**
- 难以与 URL、系统返回手势、状态恢复保持同步
- 深链解析、Web 同构、登录重定向需**大量样板代码**
- **路由状态不可序列化**，调试与测试困难

Navigator 2.0 的解法：`pages` 列表即真相源，系统事件通过改变 pages 驱动栈重建。

**这对你尤其重要**——你的整个架构建立在"可序列化、可编译期校验、可 conformance"上。**命令式路由栈是不可校验的，声明式路由是。**

### 2.3 🔴 必须避开：Navigator 2.0 的复杂度灾难

这是本次调研最重要的反向教训：

| 事实 | 说明 |
|---|---|
| 官方承认复杂 | "There is even an issue to make it simpler" |
| 样板代码极多 | `RouterDelegate` + `RouteInformationParser` + `RouteInformationProvider` |
| `MaterialApp.router` **不暴露 `navigatorKey`** | 开发者失去全局访问 `NavigatorState` 的能力，需要自行绕过 |
| 官方推荐用封装 | "生产环境推荐用 go_router 或 auto_route" |
| 第三方库的定位 | NavigationUtils 自述"bridges the simplicity of Navigator 1.0 with the power of Navigator 2.0" |

**也就是说：Flutter 声明式路由的正确性被公认，但它的 API 被认为是失败的——以至于官方自己维护的 go_router 成了事实标准。**

**对你的启示**：
- ✅ 抄**模型**（pages 即真相源、可序列化、深链）
- ❌ 不抄**API 形状**（`RouterDelegate` 那一套）
- 你的路由声明必须是**收敛的、可编译期校验的**，不是让开发者手写 delegate

### 2.4 🔴 IndexedStack 的代价（必须处理）

社区总结（权威性中等）：

> "`IndexedStack` keeps every tab's widget alive off-screen... the tradeoff is that **all tabs are built and kept in memory**, so keep off-screen tabs lightweight or lazy-load their data."

**所有 tab 同时构建并常驻内存。**

对超级应用（几十个模块）这会直接爆内存。所以：

| 策略 | 说明 |
|---|---|
| **保活策略必须可声明** | `keepAlive: none / active / all` |
| 默认 | 建议 `active`（当前 + 相邻），或按模块声明 |
| 不保活的分支 | 销毁视图但**保留栈状态**（序列化），切回时重建 |

**这正是 Android `saveBackStack()` 的语义**——销毁实例、保留状态、可恢复。见 §3.1。

### 2.5 Material 的边界建议（值得采纳）

| 建议 | 说明 |
|---|---|
| 3–5 个顶层目标用 NavigationBar | Material 指南 |
| **超过 5 个 → Drawer / NavigationRail** | Material 指南明确 |
| destination 是同一页的子区块 → 用 TabBar | 不要混用 |
| 需要真实返回栈（结算、向导）→ 不要用底部导航 | 底部导航假设目标是"扁平、平行"的 |
| iOS 风格 → `CupertinoTabBar` | Material 组件不适合 |

**所以"突破 5 个限制"不是简单地允许 20 个 tab，而是要有分层**：顶层 3–5 个 + 其余进 Drawer / 二级入口。

**这条要写进方案，否则"支持无限 tab"是个陷阱**——20 个 tab 挤在底栏是设计灾难，不是能力。

### 2.6 一个 Material 自身的教训

Flutter 3.16 起 Material 3 成为默认主题，官方文档明确：

> "There is an updated version of this component, `NavigationBar`, that's **preferred for new applications**"

**BottomNavigationBar 已降级为 legacy。** 这说明导航组件的形态本身在演进——你的方案不应锁定某一种视觉形态，而应**语义与视觉分离**。

---

## §3 各端原生导航模型矩阵

### 3.1 Android：多返回栈是官方一等公民

Fragment 1.4.0+ 提供（权威性极高）：

| API | 作用 |
|---|---|
| `saveBackStack(name)` | 弹出事务，**并保存** view state / savedInstanceState / **ViewModel** |
| `restoreBackStack(name)` | 恢复 |
| `clearBackStack(name)` | 清除 |

关键事实（官方文档）：

> "those fragment instances **no longer exist in memory** — it is just the state (and any non config state in the form of ViewModel instances)"

**即：销毁实例 + 保留状态 + 可恢复。这正是解决 IndexedStack 内存问题的正确语义。**

**三个硬约束：**

| # | 约束 |
|---|---|
| 1 | 每个事务必须 `setReorderingAllowed(true)` |
| 2 | **绝不能把含 `addToBackStack()` 和不含的事务混在同一个 FragmentManager** |
| 3 | `popBackStack()` 是**销毁操作**——丢失 view state、savedInstanceState、ViewModel |

**另：官方提供 `NavigationUI` 自动处理 bottom navigation 的多返回栈。**

> 对你的意义：**Android 端可以直接用官方多返回栈语义，不必自己造。**

### 3.2 iOS：栈存在，但只加载栈顶 view

| 事实 | 说明 |
|---|---|
| 栈模型 | LIFO，rootViewController 永远在栈底、不可 pop |
| **视图** | `UINavigationController` **一次只 host 一个 view**（栈顶） |
| **控制器** | 全部保留在栈中，直到 pop 才释放 |
| 内存压力 | 非栈顶的 **view 可被销毁**，控制器保留 |
| 集成 | 可嵌入 `UITabBarController`，每 tab 一个 nav |

**"视图销毁、控制器保留"**——这与 Android `saveBackStack` 的语义方向一致（都做了内存优化），但实现不同。

**一个易错点**：返回按钮的内容由**上一个**控制器决定，不是当前控制器（`backBarButtonItem` 属于前一个 VC）。这在跨端统一 API 时必须显式建模。

### 3.3 鸿蒙：NavPathStack 天然多实例

官方文档（权威性极高）：

> "**每个 Navigation 都有自己的路由栈，不可共享**"
> "`NavPathStack` 对象和 Navigation 需要**一一对应，不可复用**"

**这天然就是"每分支独立栈"的模型**——比 Android/iOS 都直接。

但有一个已被社区记录的坑（权威性较低，但技术链条合理）：

| 现象 | 原因 |
|---|---|
| Tabs + Navigation 嵌套后**路由栈混乱** | 每个 Tab 内嵌 Navigation 创建独立 NavPathStack，**Tab 切换时各 Navigation 生命周期不一致** → 栈数据丢失或重建 |
| **系统返回键跨 Tab 跳转** | 返回键默认绑定到当前焦点或**根** Navigation |

社区给出的解法：**每个 Tab 一个独立 NavPathStack，不要全局共享；系统返回键只 pop 当前 Tab 的栈。**

> 这条必须写进方案——它说明**"系统返回的归属"在各端是不同默认行为**，必须显式定义。

### 3.4 Web

| 项 | 说明 |
|---|---|
| 路由 | History API / hash |
| 顶部导航栏 | 无原生，完全自绘 |
| 底部 tab | 无原生，完全自绘 |
| 返回 | 浏览器返回键 + `popstate` |

**Web 完全没有原生导航概念**——所以 Web 端必然是自绘实现，反过来说，**Web 端最容易做到与其他端一致**（因为它没有"原生行为"要迁就）。

### 3.5 小程序（含 Skyline）

| 端 | 说明 |
|---|---|
| tabBar | 见 §1，静态配置 |
| 导航栏 | `navigationBarTitleText` 等**也是静态 JSON 配置**，动态改需 `setNavigationBarTitle` |
| 页面栈 | 深度 10 |
| `navigationStyle: custom` | 可自定义顶部栏，但需自行计算状态栏 + 胶囊按钮高度 |

---

## §4 三层导航模型

### 4.1 模型定义

```
App
 └ RootStack（L2）
    └ Shell（分支容器，L1）
       ├ Branch A ─ stack: [A1 → A2 → A3]
       ├ Branch B ─ stack: [B1]
       └ Branch C ─ stack: [C1 → C2]
```

| 层 | 职责 | 数量 |
|---|---|---|
| **L1 分支** | 顶层入口，各自独立栈 | 3–5 推荐，可更多（见 §2.5） |
| **L2 栈** | 分支内页面栈 | 可配深度上限 |
| **L3 栏** | 顶部导航栏 / 底部 tabBar | 依附于层 |

### 4.2 声明式形态

```vue
<navigation>
  <branch name="home"   root="/home"   keep-alive="active" />
  <branch name="search" root="/search" keep-alive="none"   />
  <branch name="mine"   root="/mine"   keep-alive="active" />
</navigation>
```

**关键：分支是声明的，不是配置的 JSON。**

### 4.3 与小程序模型的关键差异

| | 小程序 | 本方案 |
|---|---|---|
| tab 页与普通页 | **物理隔离，互不可达** | **同一个路由空间，都可达** |
| 切 tab | 强制清空历史栈 | **保留各自栈** |
| 深链到 tab 内子页 | 不支持 | ✅ 支持 |
| 栈深度 | 10 | 可配 |
| tab 数量 | 2–5 | 不限（但按 Material 给分层建议） |
| 动态增删 | 不支持 | ✅ 支持 |

**第一条是根本性差异。** 小程序把 tabBar 做成了"另一类页面"，Flutter/Android/iOS/鸿蒙都是"多个平级栈"。**你应对齐后者。**

---

## §5 tabBar 设计

### 5.1 核心原则：数据驱动，不是静态配置

| | 小程序/uni-app | 本方案 |
|---|---|---|
| 定义位置 | `app.json` / `pages.json`（编译期） | **声明式组件 + 数据源**（运行期可变） |
| 数量 | 编译期固化 | 运行期可变 |
| 图标 | 本地文件、40kb、81px、非 SVG | **矢量、可动态、可网络** |
| 角标/红点 | 有限 API | 声明式 |
| 中间凸起 | 平台碎片化（见 §1.3） | 统一实现 |

### 5.2 打破的四条限制

| # | 限制 | 本方案 |
|---|---|---|
| 1 | 数量 2–5 | **不限**，但 >5 时编译期给出分层建议（Drawer/Rail） |
| 2 | `navigateTo` 不能跳 tab 页 | **统一路由空间**，无此限制 |
| 3 | 不可动态增删 | ✅ 数据源驱动 |
| 4 | 图标静态 | ✅ 矢量 + 网络 |

**注意第 1 条的表述**：不是"我们支持无限 tab"，而是"**不设硬限制，但提供分层指引**"。这比硬上限更成熟，也避免了设计灾难。

### 5.3 安全区与适配（必做）

| 端 | 处理 |
|---|---|
| iOS | `safe-area-inset-bottom`，且**安全区高度动态变化**（横竖屏、机型） |
| Android | 手势导航条高度，部分 ROM 不一致 |
| 鸿蒙 | 类似 |
| 小程序 | `env(safe-area-inset-bottom)` |
| Web | 无 |

**坑（社区实证）**：uni-app 自定义 tabBar 若用 `transform: translateY()` 或 `margin-bottom` 定位凸起按钮，**在真机上会严重偏移甚至随页面滚动**。正确做法是外层 `position: fixed` + 凸起项 `position: absolute` 子项。

**本方案：安全区与凸起定位由框架统一处理，开发者不写定位代码。**

### 5.4 与层级规范的关系

tabBar 属于 **Navigation 层**（WeUI 四层语义之一）。**必须走层级原语，禁止裸 z-index。**

---

## §6 navBar（顶部导航栏）设计

### 6.1 各端形态差异

| 端 | 原生形态 | 特点 |
|---|---|---|
| **iOS** | `UINavigationBar` | large title（iOS 11+）、**返回按钮内容由上一个 VC 决定** |
| **Android** | `TopAppBar`（Compose） | small / center / large 三种 |
| **鸿蒙** | Navigation 的 title 区 | `titleMode` |
| **小程序** | `navigationBar*` 静态配置 | `navigationStyle: custom` 可自绘，但需自算状态栏 + 胶囊高度 |
| **Web** | 无 | 自绘 |

**小程序那条尤其麻烦**：自定义顶部栏要自己算状态栏高度 + 胶囊按钮位置（`wx.getMenuButtonBoundingClientRect()`）。**这又是胶水代码。**

### 6.2 导航条的语义拆分

| 语义元素 | 说明 |
|---|---|
| 返回（back） | **内容由来源页决定**（iOS 语义），需显式建模 |
| 标题（title） | 支持大标题、副标题、自定义视图 |
| 操作区（actions） | 左侧/右侧按钮组 |
| 背景（background） | 纯色/渐变/透明/模糊 |
| **滚动联动** | 折叠、隐藏、变色 |

**"返回按钮由上一个页面决定"**这条必须在 API 上体现——否则开发者会困惑于"为什么我在当前页设置的返回文案不生效"。

### 6.3 滚动联动（与可停靠滚动容器的交叉）

导航栏折叠 / 隐藏 / 变色属于**滚动编排能力**（《可停靠滚动容器与滚动编排能力方案》）。

**依赖关系：navBar 调用滚动编排，滚动编排不知道 navBar 存在。**

---

## §7 声明式路由与深链

### 7.1 必须声明式的理由（三条）

| # | 理由 |
|---|---|
| 1 | **可序列化** → 状态恢复、调试、测试 |
| 2 | **可编译期校验** → conformance、AI 可写可验证 |
| 3 | **深链直达** → 超级应用刚需（从通知/外部直达任意模块任意页） |

**命令式路由栈三条都做不到。**

### 7.2 但不要重蹈 Navigator 2.0 覆辙

| Flutter 的教训 | 本方案 |
|---|---|
| `RouterDelegate` + Parser + Provider 三件套 | ❌ 不暴露 |
| 样板代码极多 | 声明式配置，编译器生成 |
| `navigatorKey` 不可访问 | 提供受控的导航句柄 |
| 官方需 go_router 救场 | **一次做对** |

### 7.3 深链与路由恢复

| 场景 | 要求 |
|---|---|
| 冷启动深链 | 重建完整分支 + 栈 |
| 温启动深链 | 合并到现有栈 |
| 栈状态序列化 | 必须可序列化 |
| 鉴权重定向 | 声明式 guard |

**超级应用的关键：深链必须能直达"某个模块的某个子页面"，且返回时能回到该模块的根。**

小程序做不到这件事（因为 tabBar 栈与普通栈隔离，深链进 tabBar 内子页的路径不存在）。

---

## §8 系统返回的归属（必须显式定义）

### 8.1 各端默认行为不同

| 端 | 默认行为 |
|---|---|
| Android | 当前分支栈顶 pop；栈空则交外层 |
| iOS | 同上，另有左缘手势 |
| **鸿蒙** | 返回键默认绑定**当前焦点或根 Navigation** → 可能跨 Tab 跳转 |
| Web | 浏览器返回 |

**鸿蒙这条是静默差异**——不报错，就是跳错了栈。

### 8.2 本方案规则

| 规则 | 说明 |
|---|---|
| 1 | 返回**只作用于当前活跃分支的栈** |
| 2 | 当前分支栈空 → 交外层 RootStack |
| 3 | RootStack 空 → 交系统（退出/回桌面） |
| 4 | **各端必须显式实现，禁止依赖默认行为** |

**第 4 条是硬约束**——§3.3 鸿蒙那个坑就是依赖默认值导致的。

---

## §9 与既有方案的关系

| 方案 | 关系 |
|---|---|
| **页面层级规范** | tabBar / navBar 属 Navigation 层，**走层级原语，禁止裸 z-index** |
| **可停靠滚动容器** | navBar 折叠/隐藏依赖滚动编排；tab 内容常是滚动容器 |
| **Morpheus** | 转场动画、tab 切换动画归 Morpheus；本方案只做**判定与状态** |
| **单位系统与舍入规范** | 栏高度、图标尺寸走物理像素整数 |
| **多端一致性标准** | 本方案进 L2 几何校验 + 允许差异清单 |
| **原生能力接入** | 不开放任意原生导航 API，同"不开放任意原生调用" |
| **路由系统（既有）** | 复用，不新建 |

---

## §10 里程碑

| ID | 内容 | 估时 | 依赖 |
|---|---|---|---|
| **NB0** | 各端原生导航模型实测（Android saveBackStack / 鸿蒙 NavPathStack / Skyline） | 1 人周 | — |
| **NB1** | 三层模型设计（branch / stack / bar） | 0.5 人周 | NB0 |
| **NB2** | 声明式路由与深链（含序列化、guard） | 1.5 人周 | NB1 |
| **NB3** | 多栈实现 + 保活策略（keepAlive 三档） | 1.5 人周 | NB1 |
| **NB4** | tabBar 组件（数据驱动、安全区、凸起、角标） | 1 人周 | NB1 |
| **NB5** | navBar 组件（返回语义、标题、联动） | 1 人周 | NB1 |
| **NB6** | 系统返回归属统一（含鸿蒙显式实现） | 0.5 人周 | NB3 |
| **NB7** | 五端一致性回归 + 进 L2 校验 | 1 人周 | NB2–NB6 |

**合计 ≈ 8 人周**

**关键路径**：NB0 → NB1 → {NB2, NB3} → NB6 → NB7
NB4/NB5 可与 NB2/NB3 并行。

---

## §11 执行指令（给 LLM）

1. 本方案为**独立方案**，不并入《页面层级规范与多端一致性方案》。
2. **L1 多分支独立栈是核心**，必须有。没有它就无法承载超级应用。
3. tabBar 是**数据驱动的组件**，不是静态 JSON 配置。
4. **不设 tab 数量硬上限**，但 >5 时编译期给出分层建议（Drawer / Rail）。
5. 返回**只作用于当前活跃分支**，各端**显式实现**，禁止依赖默认行为（尤其鸿蒙）。
6. 路由必须**声明式、可序列化**；**不暴露 RouterDelegate 式 API**。
7. 保活策略三档（`none` / `active` / `all`），默认建议 `active`；不保活的分支**保留栈状态可恢复**（对齐 Android `saveBackStack` 语义）。
8. tabBar / navBar **走层级原语，禁止裸 z-index**。
9. 安全区与凸起定位**由框架统一处理**，开发者不写定位代码。
10. 返回按钮语义**由来源页决定**（iOS 语义），API 必须体现。
11. navBar 滚动联动**调用**滚动编排能力，不自己实现。
12. 转场动画**调用 Morpheus**，本方案不自己实现动画。
13. **Android 端优先使用 `saveBackStack` / `restoreBackStack`**，不要自己造；注意三条硬约束（§3.1）。
14. **鸿蒙端每个 Tab 一个 NavPathStack，禁止全局共享**。

---

## §12 风险登记

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | 声明式路由复杂度失控（重蹈 Navigator 2.0） | 🔴 高 | §7.2 明确不暴露 delegate API；NB2 需评审 API 表面积 |
| 2 | 多栈内存占用（IndexedStack 陷阱） | 🔴 高 | 保活策略三档 + 栈状态序列化 |
| 3 | 鸿蒙系统返回跨 Tab 跳转 | 🟡 中 | NB6 显式实现 + 专项回归 |
| 4 | 安全区各端不一致（尤其 iOS 动态变化） | 🟡 中 | 框架统一处理 + 真机矩阵 |
| 5 | tab 数量放开导致设计灾难 | 🟡 中 | >5 编译期分层建议 |
| 6 | 与滚动编排 / Morpheus / 层级规范边界不清 | 🟡 中 | §9 依赖方向写死 |
| 7 | 深链重建栈与各端生命周期不同步 | 🟡 中 | NB2 专项测试 |

---

## §13 待核实项

| # | 内容 | 影响 | 时点 |
|---|---|---|---|
| 1 | 鸿蒙 Tabs + Navigation 嵌套时 NavPathStack 生命周期（社区称切换会丢栈） | NB0 选型 | NB0 |
| 2 | Skyline 是否有 tabBar 相关增强 | NB0 选型 | NB0 |
| 3 | Android `saveBackStack` 在主流 ROM 上的行为一致性 | NB3 实现 | NB0 |
| 4 | 微信小程序 tabBar list 上限的当前版本值 | 对外表述 | 对外前 |
| 5 | iOS 26 对 `UINavigationBar` large title 的行为变更 | NB5 实现 | NB0 |
